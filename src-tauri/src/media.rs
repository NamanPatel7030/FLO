//! Now-playing + media/volume control for the notch "now playing" widget (and voice "volume up").
//! macOS: system-wide Now Playing via an osascript (JXA) helper, AppleScript to Spotify / Music as a
//! fallback, and system volume via osascript. No new dependencies.
use crate::model::NowPlaying;

#[cfg(target_os = "macos")]
fn osa(script: &str) -> Option<String> {
    let out = std::process::Command::new("osascript").arg("-e").arg(script).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

#[cfg(target_os = "macos")]
fn app_running(bundle: &str) -> bool {
    osa(&format!("application id \"{bundle}\" is running")).as_deref() == Some("true")
}

// ── system-wide Now Playing ────────────────────────────────────────────────────────────────
// macOS only lets Apple-signed processes read the system Now Playing (MediaRemote) since 15.4, so a
// small JXA script runs under /usr/bin/osascript (Apple-signed): it reports whatever is playing —
// YouTube in a browser, Spotify, Music, VLC, Podcasts, ... — once a second when it changes (and a
// heartbeat every few seconds), and Flo forwards changes to the notch on `flo://now-playing`.
// If that isn't available, Flo falls back to asking Spotify / Music over AppleScript.

pub const NOW_PLAYING_EVENT: &str = "flo://now-playing";

#[cfg(target_os = "macos")]
const HELPER_JS: &str = r#"
ObjC.import("Foundation"); ObjC.import("AppKit");
function iconFor(id) {
  try {
    const ws = $.NSWorkspace.sharedWorkspace;
    const url = ws.URLForApplicationWithBundleIdentifier(id);
    if (!url || url.isNil()) return { name: id, icon: null };
    const name = ObjC.unwrap($.NSFileManager.defaultManager.displayNameAtPath(url.path)).replace(/\.app$/, "");
    const img = ws.iconForFile(url.path);
    const n = 96;
    const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, n, n, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
    $.NSGraphicsContext.saveGraphicsState;
    $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep));
    img.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, n, n), $.NSZeroRect, $.NSCompositingOperationCopy, 1);
    $.NSGraphicsContext.restoreGraphicsState;
    const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
    return { name, icon: "data:image/png;base64," + ObjC.unwrap(png.base64EncodedStringWithOptions(0)) };
  } catch (e) { return { name: id, icon: null }; }
}
function run(argv) {
  const ppid = Number(argv[0] || 0);
  $.NSBundle.bundleWithPath("/System/Library/PrivateFrameworks/MediaRemote.framework").load;
  const R = $.NSClassFromString("MRNowPlayingRequest");
  if (!R || R.isNil()) { console.log("UNSUPPORTED"); return; }
  const icons = {};
  let last = "", beat = 0;
  while (true) {
    if (ppid && $.NSRunningApplication.runningApplicationWithProcessIdentifier(ppid).isNil()) return;
    let out = null;
    try {
      const item = R.localNowPlayingItem;
      if (item && !item.isNil()) {
        const md = item.metadata;
        const g = (k) => { try { const v = md[k]; return v === undefined ? null : ObjC.unwrap(v); } catch (e) { return null; } };
        const title = g("title");
        if (title) {
          let id = "";
          try { id = ObjC.unwrap(R.localNowPlayingPlayerPath.client.bundleIdentifier) || ""; } catch (e) {}
          if (id && !(id in icons)) icons[id] = iconFor(id);
          const ic = icons[id] || { name: id, icon: null };
          const pos = g("calculatedPlaybackPosition");
          out = { app: ic.name || id || "Media", bundleId: id || null, title: String(title),
                  artist: String(g("trackArtistName") || ""), album: String(g("albumName") || ""),
                  playing: !!ObjC.unwrap(R.localIsPlaying), elapsed: pos === null ? g("elapsedTime") : pos,
                  duration: g("duration"), appIcon: ic.icon };
        }
      }
    } catch (e) {}
    const key = out ? JSON.stringify(Object.assign({}, out, { elapsed: 0 })) : "null";
    beat++;
    if (key !== last || beat >= 5) { last = key; beat = 0; console.log("NP " + JSON.stringify(out)); }
    delay(1);
  }
}
"#;

#[cfg(target_os = "macos")]
mod system {
    use super::*;
    use parking_lot::Mutex;
    use std::io::{BufRead, BufReader};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::OnceLock;
    use tauri::Emitter;

    static LATEST: Mutex<Option<NowPlaying>> = Mutex::new(None);
    /// artwork data URL per track key ("bundle|title"), so a track is looked up once
    static ART: Mutex<Option<(String, Option<String>)>> = Mutex::new(None);
    /// the helper is running and reporting (false → use the AppleScript fallback)
    pub static LIVE: AtomicBool = AtomicBool::new(false);
    static STARTED: AtomicBool = AtomicBool::new(false);
    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    pub fn latest() -> Option<NowPlaying> {
        LATEST.lock().clone()
    }

    /// Parse one helper line. `Some(None)` = nothing playing, `None` = not a now-playing line.
    pub fn parse_line(line: &str, now_ms: i64) -> Option<Option<NowPlaying>> {
        let json = line.trim().strip_prefix("NP ")?;
        if json == "null" {
            return Some(None);
        }
        let mut np: NowPlaying = serde_json::from_str(json).ok()?;
        if np.title.trim().is_empty() {
            return Some(None);
        }
        np.elapsed_at = np.elapsed.map(|_| now_ms);
        np.duration = np.duration.filter(|d| d.is_finite() && *d > 0.0);
        Some(Some(np))
    }

    /// Changes worth telling the UI about (elapsed ticking along doesn't count).
    pub fn differs(a: &Option<NowPlaying>, b: &Option<NowPlaying>) -> bool {
        match (a, b) {
            (None, None) => false,
            (Some(x), Some(y)) => {
                x.title != y.title || x.artist != y.artist || x.playing != y.playing || x.bundle_id != y.bundle_id || x.duration != y.duration
                    // a seek: position jumped by more than the heartbeat interval allows
                    || match (x.elapsed, y.elapsed) {
                        (Some(e1), Some(e2)) => {
                            let dt = (y.elapsed_at.unwrap_or(0) - x.elapsed_at.unwrap_or(0)) as f64 / 1000.0;
                            let expected = if x.playing { e1 + dt } else { e1 };
                            (e2 - expected).abs() > 3.0
                        }
                        _ => false,
                    }
            }
            _ => true,
        }
    }

    pub fn start(app: tauri::AppHandle) {
        let _ = APP.set(app);
        if STARTED.swap(true, Ordering::SeqCst) || std::env::var_os("FLO_NO_NOW_PLAYING").is_some() {
            return;
        }
        std::thread::Builder::new()
            .name("flo-now-playing".into())
            .spawn(|| {
                let mut quick_failures = 0;
                loop {
                    let began = std::time::Instant::now();
                    let unsupported = run_helper();
                    LIVE.store(false, Ordering::SeqCst);
                    if unsupported {
                        log::info!("now playing: system media info unavailable; using Spotify/Music only");
                        return;
                    }
                    quick_failures = if began.elapsed().as_secs() < 10 { quick_failures + 1 } else { 0 };
                    if quick_failures >= 5 {
                        log::warn!("now playing: helper keeps exiting; using Spotify/Music only");
                        return;
                    }
                    std::thread::sleep(std::time::Duration::from_secs(3));
                }
            })
            .ok();
    }

    /// Run the helper until it exits. Returns true if the system API isn't available at all.
    fn run_helper() -> bool {
        let child = std::process::Command::new("/usr/bin/osascript")
            .args(["-l", "JavaScript", "-e", HELPER_JS, &std::process::id().to_string()])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped()) // JXA console.log writes to stderr
            .spawn();
        let Ok(mut child) = child else { return true };
        let Some(err) = child.stderr.take() else { return true };
        for line in BufReader::new(err).lines().map_while(Result::ok) {
            if line.trim() == "UNSUPPORTED" {
                let _ = child.wait();
                return true;
            }
            let now = chrono::Utc::now().timestamp_millis();
            let Some(mut np) = parse_line(&line, now) else { continue };
            LIVE.store(true, Ordering::SeqCst);
            if let Some(n) = np.as_mut() {
                let key = format!("{}|{}", n.bundle_id.clone().unwrap_or_default(), n.title);
                let known = ART.lock().as_ref().filter(|(k, _)| *k == key).map(|(_, a)| a.clone());
                match known {
                    Some(a) => n.artwork = a,
                    None => {
                        *ART.lock() = Some((key.clone(), None));
                        let track = n.clone();
                        std::thread::Builder::new()
                            .name("flo-artwork".into())
                            .spawn(move || resolve_artwork(key, track))
                            .ok();
                    }
                }
            }
            let changed = {
                let mut cur = LATEST.lock();
                let changed = differs(&cur, &np);
                *cur = np.clone();
                changed
            };
            if changed {
                if let Some(app) = APP.get() {
                    let _ = app.emit(NOW_PLAYING_EVENT, np);
                }
            }
        }
        let _ = child.wait();
        false
    }

    /// Find the real thumbnail for the playing track (YouTube video in a browser tab, or Spotify's
    /// cover), fetch it through the egress allow-list and push an updated card.
    fn resolve_artwork(key: String, track: NowPlaying) {
        let Some(url) = super::artwork_url(&track) else { return };
        let Some(app) = APP.get() else { return };
        use tauri::Manager;
        let st = app.state::<crate::state::Shared>();
        let data = tauri::async_runtime::block_on(super::fetch_image(&st, &url));
        let Some(data) = data else { return };
        {
            let mut art = ART.lock();
            if art.as_ref().map(|(k, _)| k != &key).unwrap_or(true) {
                return; // the track changed while we were fetching
            }
            *art = Some((key.clone(), Some(data.clone())));
        }
        let updated = {
            let mut cur = LATEST.lock();
            if let Some(n) = cur.as_mut() {
                if format!("{}|{}", n.bundle_id.clone().unwrap_or_default(), n.title) == key {
                    n.artwork = Some(data);
                }
            }
            cur.clone()
        };
        let _ = app.emit(NOW_PLAYING_EVENT, updated);
    }

    /// MediaRemote command ids
    pub fn command_id(action: &str) -> Option<i32> {
        Some(match action {
            "play" => 0,
            "pause" => 1,
            "playpause" | "toggle" => 2,
            "next" => 4,
            "previous" | "prev" => 5,
            _ => return None,
        })
    }

    pub fn send(cmd: i32) -> bool {
        let js = format!(
            r#"ObjC.import("Foundation");
function run() {{
  $.NSBundle.bundleWithPath("/System/Library/PrivateFrameworks/MediaRemote.framework").load;
  ObjC.bindFunction("MRMediaRemoteSendCommand", ["bool", ["int", "id"]]);
  return $.MRMediaRemoteSendCommand({cmd}, $()) ? "ok" : "no";
}}"#
        );
        std::process::Command::new("/usr/bin/osascript")
            .args(["-l", "JavaScript", "-e", &js])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "ok")
            .unwrap_or(false)
    }
}

/// NX_KEYTYPE_* codes for the keyboard's media keys.
pub fn media_key(action: &str) -> Option<i32> {
    Some(match action {
        "playpause" | "toggle" | "play" | "pause" => 16, // NX_KEYTYPE_PLAY
        "next" => 17,                                     // NX_KEYTYPE_NEXT
        "previous" | "prev" => 18,                        // NX_KEYTYPE_PREVIOUS
        _ => return None,
    })
}

/// YouTube video id from a watch / short / youtu.be / music.youtube.com URL.
pub fn youtube_id(url: &str) -> Option<String> {
    let u = url::Url::parse(url).ok()?;
    let host = u.host_str()?.trim_start_matches("www.").trim_start_matches("m.");
    let id = match host {
        "youtube.com" | "music.youtube.com" => {
            if u.path() == "/watch" {
                u.query_pairs().find(|(k, _)| k == "v").map(|(_, v)| v.to_string())
            } else {
                let mut seg = u.path_segments()?;
                match seg.next()? {
                    "shorts" | "live" | "embed" => seg.next().map(|s| s.to_string()),
                    _ => None,
                }
            }
        }
        "youtu.be" => u.path_segments()?.next().map(|s| s.to_string()),
        _ => None,
    }?;
    (id.len() >= 6 && id.len() <= 20 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')).then_some(id)
}

/// Pick the tab that is playing this title: YouTube page titles are "<title> - YouTube".
pub fn match_tab<'a>(tabs: &'a [(String, String)], title: &str) -> Option<&'a str> {
    let want = title.trim().to_lowercase();
    if want.is_empty() {
        return None;
    }
    tabs.iter()
        .filter(|(url, _)| youtube_id(url).is_some())
        .find(|(_, t)| {
            let t = t.to_lowercase();
            t.contains(&want) || want.contains(t.trim_end_matches(" - youtube").trim_end_matches(" - youtube music").trim())
        })
        .map(|(u, _)| u.as_str())
}

#[cfg(target_os = "macos")]
const BROWSERS: &[(&str, bool)] = &[
    ("com.google.Chrome", true),
    ("com.brave.Browser", true),
    ("com.microsoft.edgemac", true),
    ("company.thebrowser.Browser", true),
    ("com.vivaldi.Vivaldi", true),
    ("com.apple.Safari", false),
];

/// Where the thumbnail of the playing track lives, if Flo can find it.
#[cfg(target_os = "macos")]
fn artwork_url(np: &NowPlaying) -> Option<String> {
    let bundle = np.bundle_id.as_deref().unwrap_or("");
    if bundle == "com.spotify.client" {
        let u = osa(r#"tell application "Spotify" to return artwork url of current track"#)?;
        return u.starts_with("https://i.scdn.co/").then_some(u);
    }
    let &(id, chromium) = BROWSERS.iter().find(|(b, _)| *b == bundle)?;
    // url \t title per tab (Chromium browsers call it `title`, Safari `name`)
    let field = if chromium { "title" } else { "name" };
    let script = format!(
        r#"set out to ""
tell application id "{id}"
  repeat with w in windows
    repeat with t in tabs of w
      set out to out & (URL of t) & tab & ({field} of t) & linefeed
    end repeat
  end repeat
end tell
return out"#
    );
    let raw = osa(&script)?;
    let tabs: Vec<(String, String)> = raw
        .lines()
        .filter_map(|l| l.split_once('\t').map(|(u, t)| (u.to_string(), t.to_string())))
        .collect();
    let url = match_tab(&tabs, &np.title)?;
    let vid = youtube_id(url)?;
    Some(format!("https://i.ytimg.com/vi/{vid}/hqdefault.jpg"))
}

/// Download a small image through the egress allow-list and return it as a data: URL.
#[cfg(target_os = "macos")]
/// Recently shown thumbnails, so switching back to a track (or re-opening the notch) needs no fetch.
static ART_MEM: std::sync::LazyLock<parking_lot::Mutex<crate::cache::TtlCache<String, String>>> =
    std::sync::LazyLock::new(|| parking_lot::Mutex::new(crate::cache::TtlCache::new(std::time::Duration::from_secs(24 * 60 * 60), 24)));

/// A track's thumbnail: memory, then the on-disk cache, then the network (through the allow-list).
async fn fetch_image(st: &crate::state::Shared, url: &str) -> Option<String> {
    if let Some(d) = ART_MEM.lock().get(&url.to_string()) {
        return Some(d);
    }
    if let Some(d) = crate::cache::artwork_get(&st.data_dir, url) {
        ART_MEM.lock().insert(url.to_string(), d.clone());
        return Some(d);
    }
    let d = fetch_image_net(st, url).await?;
    ART_MEM.lock().insert(url.to_string(), d.clone());
    crate::cache::artwork_put(&st.data_dir, url, &d);
    Some(d)
}

async fn fetch_image_net(st: &crate::state::Shared, url: &str) -> Option<String> {
    use base64::Engine;
    use crate::egress::Purpose;
    st.egress.check(url, Purpose::Artwork, true).ok()?;
    let resp = st
        .egress
        .client(Purpose::Artwork, true)
        .get(url)
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let ty = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .filter(|t| t.starts_with("image/"))
        .unwrap_or("image/jpeg")
        .to_string();
    let bytes = resp.bytes().await.ok()?;
    if bytes.is_empty() || bytes.len() > 600_000 {
        return None;
    }
    Some(format!("data:{ty};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

/// Start reading the system Now Playing in the background (macOS; no-op elsewhere).
pub fn init(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    system::start(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// What's playing right now, from any app.
#[cfg(target_os = "macos")]
pub fn now_playing() -> Option<NowPlaying> {
    if system::LIVE.load(std::sync::atomic::Ordering::SeqCst) {
        return system::latest();
    }
    apple_script_now_playing()
}

/// Fallback: whichever music app is playing (Spotify preferred, then Music).
#[cfg(target_os = "macos")]
fn apple_script_now_playing() -> Option<NowPlaying> {
    for (app, bundle) in [("Spotify", "com.spotify.client"), ("Music", "com.apple.Music")] {
        if !app_running(bundle) {
            continue;
        }
        // name\tartist\talbum\tstate\tposition
        let q = format!(
            r#"tell application "{app}"
                if player state is stopped then return ""
                set t to name of current track
                set a to artist of current track
                set al to album of current track
                return t & "\t" & a & "\t" & al & "\t" & (player state as text) & "\t" & (player position as text)
            end tell"#
        );
        let Some(line) = osa(&q) else { continue };
        let f: Vec<&str> = line.split('\t').collect();
        if f.is_empty() || f[0].is_empty() {
            continue;
        }
        let elapsed = f.get(4).and_then(|s| s.parse::<f64>().ok());
        return Some(NowPlaying {
            app: app.into(),
            title: f.first().unwrap_or(&"").to_string(),
            artist: f.get(1).unwrap_or(&"").to_string(),
            album: f.get(2).unwrap_or(&"").to_string(),
            playing: f.get(3).map(|s| s.eq_ignore_ascii_case("playing")).unwrap_or(false),
            elapsed,
            elapsed_at: elapsed.map(|_| chrono::Utc::now().timestamp_millis()),
            bundle_id: Some(bundle.into()),
            ..Default::default()
        });
    }
    None
}

/// action: playpause | play | pause | next | previous — works for whatever app is playing.
#[cfg(target_os = "macos")]
pub fn control(action: &str) -> anyhow::Result<()> {
    let Some(id) = system::command_id(action) else { anyhow::bail!("unknown media action {action}") };
    // 1) the keyboard's media keys: macOS delivers them to whatever is playing (YouTube in a
    //    browser, Spotify, Music, VLC…) exactly like pressing ⏯ / ⏭ / ⏮. Needs Accessibility,
    //    which Flo already has for typing.
    if let Some(key) = media_key(action) {
        if crate::platform::macos_media_key(key) {
            return Ok(());
        }
    }
    // 2) MediaRemote command (works without Accessibility, but some players ignore it)
    if system::send(id) {
        return Ok(());
    }
    let cmd = match action {
        "playpause" | "toggle" => "playpause",
        "next" => "next track",
        "previous" | "prev" => "previous track",
        "pause" => "pause",
        _ => "play",
    };
    for (app, bundle) in [("Spotify", "com.spotify.client"), ("Music", "com.apple.Music")] {
        if app_running(bundle) {
            osa(&format!("tell application \"{app}\" to {cmd}"));
            return Ok(());
        }
    }
    anyhow::bail!("Nothing is playing")
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::system::*;
    use crate::model::NowPlaying;

    #[test]
    fn parses_helper_lines() {
        assert_eq!(parse_line("NP null", 5), Some(None));
        assert_eq!(parse_line("some log", 5), None);
        let np = parse_line(r#"NP {"app":"Google Chrome","bundleId":"com.google.Chrome","title":"Song","artist":"A","album":"","playing":true,"elapsed":12.5,"duration":200,"appIcon":null}"#, 1000)
            .unwrap()
            .unwrap();
        assert_eq!(np.app, "Google Chrome");
        assert_eq!(np.bundle_id.as_deref(), Some("com.google.Chrome"));
        assert_eq!(np.elapsed, Some(12.5));
        assert_eq!(np.elapsed_at, Some(1000));
        assert_eq!(np.duration, Some(200.0));
        // a zero/unknown duration is dropped
        let np = parse_line(r#"NP {"app":"x","title":"t","artist":"","album":"","playing":false,"duration":0}"#, 1).unwrap().unwrap();
        assert_eq!(np.duration, None);
    }

    #[test]
    fn only_real_changes_reach_the_ui() {
        let a = NowPlaying { title: "t".into(), playing: true, elapsed: Some(10.0), elapsed_at: Some(0), ..Default::default() };
        // 5 s later, 5 s further: just ticking
        let b = NowPlaying { elapsed: Some(15.0), elapsed_at: Some(5000), ..a.clone() };
        assert!(!differs(&Some(a.clone()), &Some(b)));
        // paused
        let c = NowPlaying { playing: false, ..a.clone() };
        assert!(differs(&Some(a.clone()), &Some(c)));
        // seek
        let d = NowPlaying { elapsed: Some(80.0), elapsed_at: Some(1000), ..a.clone() };
        assert!(differs(&Some(a.clone()), &Some(d)));
        // stopped
        assert!(differs(&Some(a), &None));
    }

    #[test]
    fn finds_youtube_ids_and_the_playing_tab() {
        use super::{match_tab, youtube_id};
        assert_eq!(youtube_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(youtube_id("https://youtu.be/dQw4w9WgXcQ").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(youtube_id("https://music.youtube.com/watch?v=abcDEF12345").as_deref(), Some("abcDEF12345"));
        assert_eq!(youtube_id("https://www.youtube.com/shorts/abcDEF12345").as_deref(), Some("abcDEF12345"));
        assert_eq!(youtube_id("https://example.com/watch?v=abcDEF12345"), None);
        assert_eq!(youtube_id("https://www.youtube.com/watch?v=<script>"), None);
        let tabs = vec![
            ("https://mail.google.com/".to_string(), "Inbox".to_string()),
            ("https://www.youtube.com/watch?v=abcDEF12345".to_string(), "Charaj | Aghori Muzik | New Navratri Songs - YouTube".to_string()),
        ];
        assert_eq!(match_tab(&tabs, "Charaj | Aghori Muzik | New Navratri Songs"), Some("https://www.youtube.com/watch?v=abcDEF12345"));
        assert_eq!(match_tab(&tabs, "Something else"), None);
    }

    #[test]
    fn media_keys_cover_the_controls() {
        assert_eq!(super::media_key("playpause"), Some(16));
        assert_eq!(super::media_key("next"), Some(17));
        assert_eq!(super::media_key("previous"), Some(18));
        assert_eq!(super::media_key("volume"), None);
    }

    #[test]
    fn maps_media_commands() {
        assert_eq!(command_id("playpause"), Some(2));
        assert_eq!(command_id("next"), Some(4));
        assert_eq!(command_id("previous"), Some(5));
        assert_eq!(command_id("rewind"), None);
    }
}

/// 0..100
#[cfg(target_os = "macos")]
pub fn get_volume() -> Option<u8> {
    osa("output volume of (get volume settings)").and_then(|s| s.parse().ok())
}

#[cfg(target_os = "macos")]
pub fn set_volume(level: u8) -> anyhow::Result<u8> {
    let level = level.min(100);
    osa(&format!("set volume output volume {level}"));
    Ok(level)
}

#[cfg(target_os = "macos")]
pub fn step_volume(delta: i32) -> anyhow::Result<u8> {
    let cur = get_volume().unwrap_or(50) as i32;
    set_volume((cur + delta).clamp(0, 100) as u8)
}

#[cfg(target_os = "macos")]
pub fn set_muted(muted: bool) -> anyhow::Result<()> {
    osa(&format!("set volume output muted {muted}"));
    Ok(())
}

// ── non-macOS stubs (wired for parity; implemented per-OS later) ──────────────
#[cfg(not(target_os = "macos"))]
pub fn now_playing() -> Option<NowPlaying> {
    None
}
#[cfg(not(target_os = "macos"))]
pub fn control(_action: &str) -> anyhow::Result<()> {
    anyhow::bail!("media control not supported on this OS yet")
}
#[cfg(not(target_os = "macos"))]
pub fn get_volume() -> Option<u8> {
    None
}
#[cfg(not(target_os = "macos"))]
pub fn set_volume(level: u8) -> anyhow::Result<u8> {
    Ok(level)
}
#[cfg(not(target_os = "macos"))]
pub fn step_volume(_delta: i32) -> anyhow::Result<u8> {
    Ok(0)
}
#[cfg(not(target_os = "macos"))]
pub fn set_muted(_muted: bool) -> anyhow::Result<()> {
    Ok(())
}
