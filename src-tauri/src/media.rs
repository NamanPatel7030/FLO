//! Now-playing + media/volume control for the notch "now playing" widget (and voice "volume up").
//! macOS: AppleScript to Spotify / Music, and system volume via osascript. No new dependencies.
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

/// Current track from whichever music app is playing (Spotify preferred, then Music).
#[cfg(target_os = "macos")]
pub fn now_playing() -> Option<NowPlaying> {
    for (app, bundle) in [("Spotify", "com.spotify.client"), ("Music", "com.apple.Music")] {
        if !app_running(bundle) {
            continue;
        }
        // name\tartist\talbum\tstate\tposition\tduration  (unit: Spotify ms→, Music seconds)
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
        return Some(NowPlaying {
            app: app.into(),
            title: f.first().unwrap_or(&"").to_string(),
            artist: f.get(1).unwrap_or(&"").to_string(),
            album: f.get(2).unwrap_or(&"").to_string(),
            playing: f.get(3).map(|s| s.eq_ignore_ascii_case("playing")).unwrap_or(false),
            elapsed: f.get(4).and_then(|s| s.parse::<f64>().ok()),
        });
    }
    None
}

/// action: playpause | next | previous
#[cfg(target_os = "macos")]
pub fn control(action: &str) -> anyhow::Result<()> {
    let cmd = match action {
        "playpause" | "toggle" => "playpause",
        "next" => "next track",
        "previous" | "prev" => "previous track",
        "pause" => "pause",
        "play" => "play",
        _ => anyhow::bail!("unknown media action {action}"),
    };
    // whichever music app is running
    for (app, bundle) in [("Spotify", "com.spotify.client"), ("Music", "com.apple.Music")] {
        if app_running(bundle) {
            osa(&format!("tell application \"{app}\" to {cmd}"));
            return Ok(());
        }
    }
    anyhow::bail!("No music app is open")
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
