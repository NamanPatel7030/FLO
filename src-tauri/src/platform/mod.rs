//! OS integration facade. Each function has a macOS, a Windows and a Linux implementation; the
//! pure helpers they share (key maps, parsers) live at the bottom of this file and are unit tested
//! on every OS.
use crate::hotkey::HotkeyEvent;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::*;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::*;

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod other;
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub use other::*;

/// Focused application at the moment a session starts.
#[derive(Debug, Clone, Default)]
pub struct FrontApp {
    pub name: String,
    pub pid: i32,
}

pub type HotkeyCallback = Box<dyn Fn(HotkeyEvent) + Send + Sync + 'static>;

/// Save clipboard, put `text`, paste, restore after a delay (runs restore on a helper thread).
///
/// If the paste keys can't be pressed (e.g. a Wayland desktop without `wtype` / `ydotool`), the
/// words are left on the clipboard and the error tells the person to press Ctrl+V.
pub fn paste_text(text: &str) -> anyhow::Result<()> {
    let mut cb = arboard::Clipboard::new()?;
    let previous = cb.get_text().ok();
    cb.set_text(text.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(40));
    if let Err(e) = send_paste_shortcut() {
        keep_clipboard_alive(cb);
        return Err(e);
    }
    let pasted = text.to_string();
    #[cfg(target_os = "macos")]
    drop(cb);
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(600));
        // Linux: this process serves the clipboard (X11 / Wayland), so the same handle must stay
        // alive until the target app has read it; the macOS handle isn't Send, so open a new one
        #[cfg(not(target_os = "macos"))]
        let restore = Ok::<_, arboard::Error>(cb);
        #[cfg(target_os = "macos")]
        let restore = arboard::Clipboard::new();
        if let (Some(prev), Ok(mut cb)) = (previous, restore) {
            // only restore if the clipboard still holds what we pasted (user didn't copy meanwhile)
            if cb.get_text().ok().as_deref() == Some(pasted.as_str()) {
                let _ = cb.set_text(prev);
            }
        }
    });
    Ok(())
}

/// Keep serving the clipboard for a while after a failed paste, so the person can still press
/// Ctrl+V (on Linux the clipboard owner is this handle; dropping it would empty the clipboard).
#[cfg(not(target_os = "macos"))]
fn keep_clipboard_alive(cb: arboard::Clipboard) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(120));
        drop(cb);
    });
}
#[cfg(target_os = "macos")]
fn keep_clipboard_alive(_cb: arboard::Clipboard) {}

/// Copy the current selection via simulated copy; restores the clipboard.
pub fn copy_selection() -> Option<String> {
    let mut cb = arboard::Clipboard::new().ok()?;
    let previous = cb.get_text().ok();
    let sentinel = format!("__flo_{}__", uuid::Uuid::new_v4().simple());
    cb.set_text(sentinel.clone()).ok()?;
    send_copy_shortcut().ok()?;
    let mut got = None;
    for _ in 0..12 {
        std::thread::sleep(std::time::Duration::from_millis(25));
        if let Ok(t) = cb.get_text() {
            if t != sentinel {
                got = Some(t);
                break;
            }
        }
    }
    match previous {
        Some(p) => {
            let _ = cb.set_text(p);
        }
        None => {
            let _ = cb.clear();
        }
    }
    got.filter(|s| !s.trim().is_empty())
}

// ── pure helpers shared by the Windows and Linux backends (unit tested everywhere) ──────────────

/// Name the live call from the frontmost app / window title and the apps currently using the mic.
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub fn call_label(front: &str, title: &str, mic_users: &[String]) -> String {
    let hay = format!("{} {} {}", front, title, mic_users.join(" ")).to_lowercase();
    for (needle, name) in [
        ("google meet", "Google Meet"),
        ("meet.google", "Google Meet"),
        (" meet ", "Google Meet"),
        ("zoom", "Zoom"),
        ("microsoft teams", "Teams"),
        ("teams", "Teams"),
        ("webex", "Webex"),
        ("whereby", "Whereby"),
        ("skype", "Skype"),
        ("discord", "Discord"),
    ] {
        if hay.contains(needle) {
            return name.into();
        }
    }
    let slack = |s: &str| s.to_lowercase().contains("slack");
    if slack(front) || mic_users.iter().any(|u| slack(u)) {
        return "Slack huddle".into();
    }
    "a call".into()
}

/// Windows virtual-key code (low-level hook) → key. `scan` 0x21D is the fake left Ctrl that AltGr
/// sends on international layouts; it must not count as Ctrl.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn vk_to_pckey(vk: u32, scan: u32) -> Option<crate::hotkey::PcKey> {
    use crate::hotkey::PcKey;
    Some(match vk {
        0xA2 if scan == 0x21D => return None,
        0xA2 | 0x11 => PcKey::Ctrl(false),
        0xA3 => PcKey::Ctrl(true),
        0xA4 | 0x12 => PcKey::Alt(false),
        0xA5 => PcKey::Alt(true),
        0x5B => PcKey::Win(false),
        0x5C => PcKey::Win(true),
        0xA0 | 0x10 => PcKey::Shift(false),
        0xA1 => PcKey::Shift(true),
        0x20 => PcKey::Space,
        0x1B => PcKey::Esc,
        other => PcKey::Other(other),
    })
}

/// Linux evdev key code (input-event-codes.h) → key.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn evdev_to_pckey(code: u16) -> crate::hotkey::PcKey {
    use crate::hotkey::PcKey;
    match code {
        29 => PcKey::Ctrl(false),
        97 => PcKey::Ctrl(true),
        56 => PcKey::Alt(false),
        100 => PcKey::Alt(true),
        125 => PcKey::Win(false),
        126 => PcKey::Win(true),
        42 => PcKey::Shift(false),
        54 => PcKey::Shift(true),
        57 => PcKey::Space,
        1 => PcKey::Esc,
        other => PcKey::Other(other as u32),
    }
}

/// Keyboards in /proc/bus/input/devices → their event nodes ("event3"). A keyboard reports key
/// events (EV bit 1) and has the letter keys (KEY_Q..KEY_P are bits 16..25 of the key bitmap).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn keyboard_event_nodes(devices: &str) -> Vec<String> {
    let mut out = Vec::new();
    for block in devices.split("\n\n") {
        let mut handlers: Vec<String> = Vec::new();
        let (mut ev_key, mut letters) = (false, false);
        for line in block.lines() {
            if let Some(h) = line.strip_prefix("H: Handlers=") {
                handlers = h.split_whitespace().filter(|w| w.starts_with("event")).map(String::from).collect();
            } else if let Some(ev) = line.strip_prefix("B: EV=") {
                ev_key = u64::from_str_radix(ev.trim(), 16).map(|v| v & 0x2 != 0).unwrap_or(false);
            } else if let Some(keys) = line.strip_prefix("B: KEY=") {
                // the bitmap is printed as hex words, most significant first; bit 16.. is the last word
                letters = keys.split_whitespace().last().and_then(|w| u64::from_str_radix(w, 16).ok()).map(|v| v & 0x3ff_0000 == 0x3ff_0000).unwrap_or(false);
            }
        }
        if ev_key && letters {
            out.extend(handlers);
        }
    }
    out
}

/// Is this a Wayland session? (Global key hooks and synthetic input are restricted there.)
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn is_wayland(session_type: Option<&str>, wayland_display: Option<&str>) -> bool {
    match session_type.map(|s| s.to_ascii_lowercase()) {
        Some(t) if t == "wayland" => true,
        Some(t) if t == "x11" => false,
        _ => wayland_display.is_some_and(|d| !d.is_empty()),
    }
}

/// Windows microphone privacy switches (registry "Value" strings: "Allow" / "Deny"): the
/// device-wide one, the per-user one and "Let desktop apps access your microphone". Any "Deny"
/// blocks Flo; a missing value means the default (allowed).
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn mic_consent_allowed(values: &[Option<String>]) -> bool {
    !values.iter().flatten().any(|v| v.trim().eq_ignore_ascii_case("deny"))
}

/// A CapabilityAccessManager consent-store key name → a readable app name.
/// "C:#Program Files#Zoom#bin#Zoom.exe" → "Zoom"; "MicrosoftTeams_8wekyb3d8bbwe" → "MicrosoftTeams".
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn consent_key_app(key: &str) -> String {
    let last = key.rsplit(['#', '\\']).next().unwrap_or(key);
    let base = last.strip_suffix(".exe").or_else(|| last.strip_suffix(".EXE")).unwrap_or(last);
    // packaged apps: Name_publisherhash
    base.split('_').next().unwrap_or(base).to_string()
}

/// One entry of `pactl list source-outputs` (an app recording from a microphone).
#[derive(Debug, Clone, PartialEq, Default)]
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub struct SourceOutput {
    pub app: String,
    pub pid: Option<u32>,
    pub binary: String,
    /// recording from a monitor (speaker loopback) rather than a microphone
    pub monitor: bool,
}

/// Parse `pactl list source-outputs` (PulseAudio or PipeWire's pipewire-pulse).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn parse_source_outputs(text: &str) -> Vec<SourceOutput> {
    let mut out: Vec<SourceOutput> = Vec::new();
    let unq = |v: &str| v.trim().trim_matches('"').to_string();
    for line in text.lines() {
        let t = line.trim();
        if t.starts_with("Source Output #") {
            out.push(SourceOutput::default());
            continue;
        }
        let Some(cur) = out.last_mut() else { continue };
        if let Some((k, v)) = t.split_once(" = ") {
            match k.trim() {
                "application.name" => cur.app = unq(v),
                "application.process.id" => cur.pid = unq(v).parse().ok(),
                "application.process.binary" => cur.binary = unq(v),
                "stream.capture.sink" => cur.monitor |= unq(v) == "true",
                _ => {}
            }
        } else if let Some(v) = t.strip_prefix("Source: ") {
            cur.monitor |= v.trim().ends_with(".monitor");
        }
    }
    out
}

/// The playing app's name from a Windows media AppUserModelID ("Spotify.exe", "MSEdge",
/// "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify") or an MPRIS bus name
/// ("org.mpris.MediaPlayer2.spotify", "org.mpris.MediaPlayer2.firefox.instance_1_23").
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub fn media_app_name(id: &str) -> String {
    let id = id.strip_prefix("org.mpris.MediaPlayer2.").map(|r| r.split('.').next().unwrap_or(r)).unwrap_or(id);
    let id = id.rsplit('!').next().unwrap_or(id);
    let id = id.rsplit(['\\', '/']).next().unwrap_or(id);
    let id = id.strip_suffix(".exe").or_else(|| id.strip_suffix(".EXE")).unwrap_or(id);
    let known = [("spotify", "Spotify"), ("msedge", "Microsoft Edge"), ("chrome", "Chrome"), ("chromium", "Chromium"), ("firefox", "Firefox"), ("brave", "Brave"), ("vlc", "VLC"), ("zunemusic", "Media Player"), ("music", "Music")];
    let low = id.to_lowercase();
    if let Some((_, name)) = known.iter().find(|(k, _)| low.contains(k)) {
        return name.to_string();
    }
    let mut c = id.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

/// "Volume: front-left: 32768 /  50% / -18.06 dB,   front-right: …" → 50 (`pactl get-sink-volume`).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn parse_pactl_volume(s: &str) -> Option<u8> {
    let pct = s.split('/').find_map(|part| part.trim().strip_suffix('%')?.trim().parse::<u32>().ok())?;
    Some(pct.min(100) as u8)
}

/// Is this app a terminal emulator? (They paste with Ctrl+Shift+V; Ctrl+V is a control character.)
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn is_terminal(app: &str) -> bool {
    let a = app.to_lowercase();
    ["terminal", "konsole", "alacritty", "kitty", "xterm", "wezterm", "tilix", "terminator", "foot", "ghostty", "urxvt", "st-256color", "yakuake", "guake"]
        .iter()
        .any(|t| a.contains(t))
}

/// Common key names → Windows virtual-key codes (also the key ids the Linux backend maps).
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub fn pc_keycode_for(name: &str) -> Option<u16> {
    let n = name.to_lowercase();
    Some(match n.as_str() {
        "return" | "enter" => 0x0D,
        "tab" => 0x09,
        "space" => 0x20,
        "delete" | "backspace" => 0x08,
        "forwarddelete" | "del" => 0x2E,
        "escape" | "esc" => 0x1B,
        "left" => 0x25,
        "up" => 0x26,
        "right" => 0x27,
        "down" => 0x28,
        "home" => 0x24,
        "end" => 0x23,
        "pageup" => 0x21,
        "pagedown" => 0x22,
        _ => {
            let mut it = n.chars();
            match (it.next(), it.next()) {
                (Some(c), None) if c.is_ascii_lowercase() || c.is_ascii_digit() => c.to_ascii_uppercase() as u16,
                _ => return None,
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hotkey::PcKey;

    #[test]
    fn names_calls_from_window_title_and_mic_users() {
        assert_eq!(call_label("Google Chrome", "Meet - abc-defg-hij", &[]), "Google Meet");
        assert_eq!(call_label("Explorer", "", &["Zoom".into()]), "Zoom");
        assert_eq!(call_label("Code", "main.rs", &["MicrosoftTeams".into()]), "Teams");
        assert_eq!(call_label("slack", "", &[]), "Slack huddle");
        assert_eq!(call_label("firefox", "Inbox", &[]), "a call");
    }

    #[test]
    fn windows_virtual_keys() {
        assert_eq!(vk_to_pckey(0xA3, 0x1D), Some(PcKey::Ctrl(true)));
        assert_eq!(vk_to_pckey(0xA2, 0x21D), None); // AltGr's fake Ctrl
        assert_eq!(vk_to_pckey(0x5B, 0), Some(PcKey::Win(false)));
        assert_eq!(vk_to_pckey(0x20, 0), Some(PcKey::Space));
        assert_eq!(vk_to_pckey(0x31, 0), Some(PcKey::Other(0x31)));
    }

    #[test]
    fn evdev_keys() {
        assert_eq!(evdev_to_pckey(97), PcKey::Ctrl(true));
        assert_eq!(evdev_to_pckey(125), PcKey::Win(false));
        assert_eq!(evdev_to_pckey(57), PcKey::Space);
        assert_eq!(evdev_to_pckey(30), PcKey::Other(30));
    }

    #[test]
    fn finds_keyboards_in_proc_devices() {
        let devs = "I: Bus=0019 Vendor=0000 Product=0001 Version=0000\nN: Name=\"Power Button\"\nH: Handlers=kbd event0 \nB: EV=3\nB: KEY=10000000000000 0\n\nI: Bus=0011 Vendor=0001 Product=0001 Version=ab41\nN: Name=\"AT Translated Set 2 keyboard\"\nH: Handlers=sysrq kbd leds event3 \nB: EV=120013\nB: KEY=402000000 3803078f800d001 feffffdfffefffff fffffffffffffffe\n\nI: Bus=0003\nN: Name=\"Mouse\"\nH: Handlers=mouse0 event5\nB: EV=17\nB: KEY=1f0000 0 0 0 0\n";
        assert_eq!(keyboard_event_nodes(devs), vec!["event3".to_string()]);
    }

    #[test]
    fn detects_wayland() {
        assert!(is_wayland(Some("wayland"), None));
        assert!(!is_wayland(Some("x11"), Some("wayland-0")));
        assert!(is_wayland(None, Some("wayland-0")));
        assert!(!is_wayland(None, None));
    }

    #[test]
    fn microphone_privacy_switches() {
        assert!(mic_consent_allowed(&[None, Some("Allow".into()), None]));
        assert!(!mic_consent_allowed(&[Some("Allow".into()), Some("Deny".into())]));
        assert!(mic_consent_allowed(&[]));
    }

    #[test]
    fn consent_store_app_names() {
        assert_eq!(consent_key_app("C:#Program Files#Zoom#bin#Zoom.exe"), "Zoom");
        assert_eq!(consent_key_app("MicrosoftTeams_8wekyb3d8bbwe"), "MicrosoftTeams");
        assert_eq!(consent_key_app("C:#Users#me#AppData#Local#Discord#app-1.0#Discord.exe"), "Discord");
    }

    #[test]
    fn parses_pactl_source_outputs() {
        let t = "Source Output #42\n\tDriver: protocol-native.c\n\tSource: 1\n\tProperties:\n\t\tapplication.name = \"ZOOM VoiceEngine\"\n\t\tapplication.process.id = \"4242\"\n\t\tapplication.process.binary = \"zoom\"\n\nSource Output #43\n\tSource: alsa_output.pci.analog-stereo.monitor\n\tProperties:\n\t\tapplication.name = \"parec\"\n";
        let v = parse_source_outputs(t);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0], SourceOutput { app: "ZOOM VoiceEngine".into(), pid: Some(4242), binary: "zoom".into(), monitor: false });
        assert!(v[1].monitor);
    }

    #[test]
    fn media_app_names() {
        assert_eq!(media_app_name("Spotify.exe"), "Spotify");
        assert_eq!(media_app_name("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"), "Spotify");
        assert_eq!(media_app_name("MSEdge"), "Microsoft Edge");
        assert_eq!(media_app_name("org.mpris.MediaPlayer2.firefox.instance_1_23"), "Firefox");
        assert_eq!(media_app_name("org.mpris.MediaPlayer2.rhythmbox"), "Rhythmbox");
    }

    #[test]
    fn pactl_volume() {
        assert_eq!(parse_pactl_volume("Volume: front-left: 32768 /  50% / -18.06 dB,   front-right: 32768 /  50% / -18.06 dB"), Some(50));
        assert_eq!(parse_pactl_volume("Volume: mono: 98304 / 150% / 10.57 dB"), Some(100));
        assert_eq!(parse_pactl_volume("garbage"), None);
    }

    #[test]
    fn terminals_paste_with_shift() {
        assert!(is_terminal("gnome-terminal-server"));
        assert!(is_terminal("Alacritty"));
        assert!(!is_terminal("firefox"));
    }

    #[test]
    fn pc_key_names() {
        assert_eq!(pc_keycode_for("Return"), Some(0x0D));
        assert_eq!(pc_keycode_for("l"), Some(b'L' as u16));
        assert_eq!(pc_keycode_for("7"), Some(b'7' as u16));
        assert_eq!(pc_keycode_for("f13"), None);
    }
}
