//! Linux. X11: rdev (XRecord) push-to-talk hook, XTest input via enigo, EWMH (x11rb) for the active
//! window, MIT-SCREEN-SAVER for idle time. Wayland: compositors block global key hooks and
//! synthetic input for other apps, so push-to-talk reads the keyboards directly (evdev, needs the
//! `input` group) and paste / typing go through `wtype` or `ydotool` when installed; without them
//! the words are left on the clipboard for Ctrl+V. Microphone and "is a call using the mic" come
//! from PulseAudio / PipeWire (`pactl`), OCR from the `tesseract` CLI when installed.
use super::{FrontApp, HotkeyCallback};
use crate::hotkey::{HotkeyConfig, PcKey, PcKeys};
use crate::model::{IslandGeometry, Permissions};
use anyhow::{anyhow, Result};
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings as EnigoSettings};
use std::ffi::c_void;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

static HOTKEY_ACTIVE: AtomicBool = AtomicBool::new(false);
static HOTKEY_CFG: parking_lot::RwLock<Option<HotkeyConfig>> = parking_lot::RwLock::new(None);
/// Why push-to-talk isn't running (shown in setup), e.g. "add yourself to the input group".
static HOTKEY_PROBLEM: parking_lot::Mutex<Option<String>> = parking_lot::Mutex::new(None);
/// Key events before this time (unix ms) come from Flo's own typing (XTest / ydotool): ignore them.
static SYNTH_UNTIL: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn synthesizing(ms: u64) {
    SYNTH_UNTIL.store(now_ms() + ms, Ordering::SeqCst);
}

fn wayland() -> bool {
    super::is_wayland(std::env::var("XDG_SESSION_TYPE").ok().as_deref(), std::env::var("WAYLAND_DISPLAY").ok().as_deref())
}

/// GTK draws through Wayland itself (not XWayland): windows can't be placed or read back.
static NATIVE_WAYLAND: AtomicBool = AtomicBool::new(false);

/// Before GTK starts: prefer XWayland on a Wayland session and work around WebKitGTK's DMA-BUF
/// renderer (see `platform::linux_env_overrides` for why). Runs on the main thread before any
/// other thread exists, so setting the environment is safe.
pub fn prepare_env() {
    let get = |k: &str| std::env::var(k).ok();
    for (k, v) in super::linux_env_overrides(&get) {
        log::info!("linux: {k}={v}");
        std::env::set_var(k, v);
    }
    let x11 = std::env::var("GDK_BACKEND").is_ok_and(|b| b.trim().starts_with("x11"));
    NATIVE_WAYLAND.store(wayland() && !x11, Ordering::SeqCst);
}

pub fn native_wayland() -> bool {
    NATIVE_WAYLAND.load(Ordering::SeqCst)
}

/// Is a compositor running (so a transparent window really is see-through)? Asked on the main
/// thread (GTK), from island_geometry. Without one the island draws as a solid tile.
fn composited() -> bool {
    gtk::gdk::Screen::default().map(|s| s.is_composited()).unwrap_or(true)
}

/// Is `bin` on PATH?
fn have(bin: &str) -> bool {
    std::env::var_os("PATH").is_some_and(|p| std::env::split_paths(&p).any(|d| d.join(bin).is_file()))
}

fn run_ok(cmd: &str, args: &[&str]) -> bool {
    Command::new(cmd).args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
}

fn enigo() -> Result<Enigo> {
    Enigo::new(&EnigoSettings::default()).map_err(|e| anyhow!("can't send input (no X11 display?): {e:?}"))
}

const NO_TYPING_TOOL: &str = "Copied to the clipboard: press Ctrl+V to paste. (On Wayland, install wtype or ydotool so Flo can paste for you.)";

/// Press Ctrl(+Shift)+key in the focused app.
fn ctrl_combo(ch: char, shift: bool) -> Result<()> {
    synthesizing(400);
    if wayland() {
        let k = ch.to_string();
        let mut args = vec!["-M", "ctrl"];
        if shift {
            args.extend(["-M", "shift"]);
        }
        args.extend(["-k", k.as_str()]);
        if shift {
            args.extend(["-m", "shift"]);
        }
        args.extend(["-m", "ctrl"]);
        if have("wtype") && run_ok("wtype", &args) {
            return Ok(());
        }
        // ydotool speaks evdev codes: 29 = left Ctrl, 42 = left Shift, 47 = V, 46 = C
        let code = if ch == 'v' { "47" } else { "46" };
        let mut seq: Vec<String> = vec!["29:1".into()];
        if shift {
            seq.push("42:1".into());
        }
        seq.extend([format!("{code}:1"), format!("{code}:0")]);
        if shift {
            seq.push("42:0".into());
        }
        seq.push("29:0".into());
        let mut args: Vec<&str> = vec!["key"];
        args.extend(seq.iter().map(|s| s.as_str()));
        if have("ydotool") && run_ok("ydotool", &args) {
            return Ok(());
        }
        return Err(anyhow!(NO_TYPING_TOOL));
    }
    let mut e = enigo()?;
    // let go of Super / Alt held for push-to-talk, so this isn't Super+Ctrl+V
    for k in [Key::Meta, Key::Alt] {
        let _ = e.key(k, Direction::Release);
    }
    e.key(Key::Control, Direction::Press).map_err(|e| anyhow!("{e:?}"))?;
    if shift {
        e.key(Key::Shift, Direction::Press).map_err(|e| anyhow!("{e:?}"))?;
    }
    e.key(Key::Unicode(ch), Direction::Click).map_err(|e| anyhow!("{e:?}"))?;
    if shift {
        e.key(Key::Shift, Direction::Release).map_err(|e| anyhow!("{e:?}"))?;
    }
    e.key(Key::Control, Direction::Release).map_err(|e| anyhow!("{e:?}"))?;
    Ok(())
}

/// Ctrl+V, or Ctrl+Shift+V in a terminal (where Ctrl+V is a control character).
pub fn send_paste_shortcut() -> Result<()> {
    ctrl_combo('v', super::is_terminal(&frontmost_app().name))
}

pub fn send_copy_shortcut() -> Result<()> {
    ctrl_combo('c', super::is_terminal(&frontmost_app().name))
}

// ── push-to-talk ────────────────────────────────────────────────────────────────────────────────

/// Apply the configured push-to-talk combos (takes effect immediately). `fn` means Ctrl+Super here.
pub fn set_hotkeys(cfg: HotkeyConfig) {
    *HOTKEY_CFG.write() = Some(cfg.for_pc());
}

fn hotkey_cfg() -> HotkeyConfig {
    HOTKEY_CFG.read().unwrap_or_else(|| HotkeyConfig::default().for_pc())
}

/// Shared by every key source: feed one event, fire the callback outside the lock.
struct Feeder {
    keys: parking_lot::Mutex<PcKeys>,
    cb: HotkeyCallback,
}

impl Feeder {
    fn feed(&self, key: PcKey, down: bool) {
        if now_ms() < SYNTH_UNTIL.load(Ordering::SeqCst) {
            return;
        }
        let ev = self.keys.lock().feed(key, down, &hotkey_cfg()).0;
        if let Some(ev) = ev {
            (self.cb)(ev);
        }
    }
}

fn rdev_key(k: rdev::Key) -> PcKey {
    use rdev::Key as K;
    match k {
        K::ControlLeft => PcKey::Ctrl(false),
        K::ControlRight => PcKey::Ctrl(true),
        K::Alt => PcKey::Alt(false),
        K::AltGr => PcKey::Alt(true),
        K::MetaLeft => PcKey::Win(false),
        K::MetaRight => PcKey::Win(true),
        K::ShiftLeft => PcKey::Shift(false),
        K::ShiftRight => PcKey::Shift(true),
        K::Space => PcKey::Space,
        K::Escape => PcKey::Esc,
        K::Unknown(n) => PcKey::Other(0x10000 + n),
        other => {
            // a stable id per key (repeats are recognised by it)
            use std::hash::{Hash, Hasher};
            let mut h = std::collections::hash_map::DefaultHasher::new();
            format!("{other:?}").hash(&mut h);
            PcKey::Other((h.finish() & 0xffff) as u32)
        }
    }
}

/// Read every keyboard under /dev/input (Wayland, or X11 when XRecord is missing). Needs read
/// access to the event nodes (the `input` group). Returns how many keyboards are being read.
fn start_evdev(feeder: Arc<Feeder>) -> std::result::Result<usize, String> {
    let devices = std::fs::read_to_string("/proc/bus/input/devices").map_err(|e| format!("can't list keyboards: {e}"))?;
    let nodes = super::keyboard_event_nodes(&devices);
    if nodes.is_empty() {
        return Err("no keyboard found under /dev/input".into());
    }
    let mut opened = 0;
    let mut denied = false;
    for node in nodes {
        let path = format!("/dev/input/{node}");
        match std::fs::File::open(&path) {
            Ok(mut f) => {
                opened += 1;
                let feeder = feeder.clone();
                std::thread::Builder::new()
                    .name(format!("flo-evdev-{node}"))
                    .spawn(move || {
                        use std::io::Read;
                        // struct input_event on 64-bit: timeval (16 bytes), u16 type, u16 code, i32 value
                        let mut buf = [0u8; 24];
                        while f.read_exact(&mut buf).is_ok() {
                            let ty = u16::from_ne_bytes([buf[16], buf[17]]);
                            let code = u16::from_ne_bytes([buf[18], buf[19]]);
                            let value = i32::from_ne_bytes([buf[20], buf[21], buf[22], buf[23]]);
                            // EV_KEY; value 1 = down, 0 = up, 2 = auto-repeat (ignored)
                            if ty == 1 && value != 2 {
                                feeder.feed(super::evdev_to_pckey(code), value == 1);
                            }
                        }
                        log::warn!("stopped reading {path}");
                    })
                    .ok();
            }
            Err(e) => {
                denied |= e.kind() == std::io::ErrorKind::PermissionDenied;
            }
        }
    }
    if opened > 0 {
        Ok(opened)
    } else if denied {
        Err("Flo can't read the keyboard. Run `sudo usermod -aG input $USER`, then log out and back in.".into())
    } else {
        Err("couldn't open any keyboard device".into())
    }
}

/// Hold Ctrl → dictation, hold Ctrl+Super → assistant (configurable in Settings).
/// X11: XRecord via rdev. Wayland (or no XRecord): the keyboards' evdev nodes.
pub fn start_hotkeys(cb: HotkeyCallback) {
    let feeder = Arc::new(Feeder { keys: parking_lot::Mutex::new(PcKeys::default()), cb });
    std::thread::Builder::new()
        .name("flo-hotkey".into())
        .spawn(move || {
            let evdev = |feeder: Arc<Feeder>| match start_evdev(feeder) {
                Ok(n) => {
                    HOTKEY_ACTIVE.store(true, Ordering::SeqCst);
                    *HOTKEY_PROBLEM.lock() = None;
                    log::info!("push-to-talk: reading {n} keyboard(s) via evdev");
                    true
                }
                Err(e) => {
                    log::warn!("push-to-talk via evdev: {e}");
                    *HOTKEY_PROBLEM.lock() = Some(e);
                    false
                }
            };
            if wayland() {
                // retry every few seconds: the group change takes effect on the next login, and a
                // keyboard may be plugged in later
                while !evdev(feeder.clone()) {
                    std::thread::sleep(Duration::from_secs(5));
                }
                return;
            }
            HOTKEY_ACTIVE.store(true, Ordering::SeqCst);
            let f2 = feeder.clone();
            let res = rdev::listen(move |ev| match ev.event_type {
                rdev::EventType::KeyPress(k) => f2.feed(rdev_key(k), true),
                rdev::EventType::KeyRelease(k) => f2.feed(rdev_key(k), false),
                _ => {}
            });
            HOTKEY_ACTIVE.store(false, Ordering::SeqCst);
            log::error!("X11 keyboard hook failed ({res:?}); trying evdev");
            while !evdev(feeder.clone()) {
                std::thread::sleep(Duration::from_secs(5));
            }
        })
        .ok();
}

// ── windows / apps (X11 EWMH) ───────────────────────────────────────────────────────────────────

mod x11 {
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{AtomEnum, ClientMessageEvent, ConnectionExt, EventMask, Window};
    use x11rb::rust_connection::RustConnection;

    pub fn connect() -> Option<(RustConnection, Window)> {
        let (c, screen) = x11rb::connect(None).ok()?;
        let root = c.setup().roots.get(screen)?.root;
        Some((c, root))
    }

    fn atom(c: &RustConnection, name: &str) -> Option<u32> {
        Some(c.intern_atom(false, name.as_bytes()).ok()?.reply().ok()?.atom)
    }

    fn cardinals(c: &RustConnection, w: Window, prop: &str, ty: AtomEnum) -> Vec<u32> {
        let Some(a) = atom(c, prop) else { return vec![] };
        c.get_property(false, w, a, ty, 0, 4096).ok().and_then(|r| r.reply().ok()).and_then(|r| r.value32().map(|v| v.collect())).unwrap_or_default()
    }

    pub fn windows_of(pid: u32) -> Vec<Window> {
        let Some((c, root)) = connect() else { return vec![] };
        cardinals(&c, root, "_NET_CLIENT_LIST", AtomEnum::WINDOW).into_iter().filter(|w| cardinals(&c, *w, "_NET_WM_PID", AtomEnum::CARDINAL).first() == Some(&pid)).collect()
    }

    /// Ask the window manager to activate a window (EWMH _NET_ACTIVE_WINDOW, source = pager).
    pub fn activate(w: Window) -> Option<()> {
        let (c, root) = connect()?;
        let a = atom(&c, "_NET_ACTIVE_WINDOW")?;
        let ev = ClientMessageEvent::new(32, w, a, [2u32, 0, 0, 0, 0]);
        c.send_event(false, root, EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY, ev).ok()?;
        c.flush().ok()
    }

    /// (window, title, WM_CLASS) of every managed window.
    pub fn client_windows() -> Vec<(Window, String, String)> {
        let Some((c, root)) = connect() else { return vec![] };
        let (Some(utf8), Some(net_name)) = (atom(&c, "UTF8_STRING"), atom(&c, "_NET_WM_NAME")) else { return vec![] };
        cardinals(&c, root, "_NET_CLIENT_LIST", AtomEnum::WINDOW)
            .into_iter()
            .map(|w| {
                let title = c.get_property(false, w, net_name, utf8, 0, 1024).ok().and_then(|r| r.reply().ok()).map(|r| String::from_utf8_lossy(&r.value).into_owned()).unwrap_or_default();
                let class = c
                    .get_property(false, w, AtomEnum::WM_CLASS, AtomEnum::STRING, 0, 256)
                    .ok()
                    .and_then(|r| r.reply().ok())
                    .map(|r| String::from_utf8_lossy(&r.value).replace('\0', " ").trim().to_string())
                    .unwrap_or_default();
                (w, title, class)
            })
            .collect()
    }

    /// Milliseconds since the last keyboard / mouse input (MIT-SCREEN-SAVER).
    pub fn idle_ms() -> Option<u32> {
        use x11rb::protocol::screensaver::ConnectionExt as _;
        let (c, root) = connect()?;
        let info = c.screensaver_query_info(root).ok()?.reply().ok()?;
        Some(info.ms_since_user_input)
    }
}

pub fn frontmost_app() -> FrontApp {
    match active_win_pos_rs::get_active_window() {
        Ok(w) => FrontApp { name: w.app_name, pid: w.process_id as i32 },
        Err(_) => FrontApp::default(),
    }
}

pub fn frontmost_window_title() -> Option<String> {
    active_win_pos_rs::get_active_window().ok().map(|w| w.title).filter(|t| !t.is_empty())
}

pub fn activate_app(pid: i32) {
    if pid <= 0 || pid as u32 == std::process::id() {
        return;
    }
    if let Some(w) = x11::windows_of(pid as u32).first() {
        x11::activate(*w);
    }
}

pub fn open_app(name: &str) -> Result<()> {
    // the desktop launcher name first (gtk-launch firefox), then the binary
    let lower = name.to_lowercase().replace(' ', "-");
    if have("gtk-launch") && run_ok("gtk-launch", &[lower.as_str()]) {
        return Ok(());
    }
    if Command::new(&lower).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().is_ok() {
        return Ok(());
    }
    Err(anyhow!("couldn't find an app called “{name}”"))
}

pub fn island_geometry() -> IslandGeometry {
    // no notch: a floating pill (top centre unless dragged); lib.rs fills in the screen width
    IslandGeometry { platform: "linux".into(), has_notch: false, notch_width: 0.0, notch_height: 0.0, screen_width: 0.0, opaque: !composited() }
}

/// Keep-above and skip-taskbar are set when the window is built (tauri / GTK).
pub fn configure_island(_w: *mut c_void) {}

pub fn island_position(_g: &IslandGeometry, _w: f64, _h: f64) -> (f64, f64) {
    (0.0, 0.0) // top centre of the work area, computed in lib.rs from the monitor
}

// ── microphone (PulseAudio / PipeWire) ──────────────────────────────────────────────────────────

fn pactl(args: &[&str]) -> Option<String> {
    let out = Command::new("pactl").args(args).env("LC_ALL", "C").stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Apps recording from a microphone right now (not Flo, not speaker-monitor capture).
fn mic_users() -> Vec<String> {
    let me = std::process::id();
    let Some(text) = pactl(&["list", "source-outputs"]) else { return vec![] };
    super::parse_source_outputs(&text)
        .into_iter()
        .filter(|o| !o.monitor && o.pid != Some(me))
        .map(|o| if o.binary.is_empty() { o.app } else { o.binary })
        .filter(|n| !n.is_empty())
        .collect()
}

pub fn mic_in_use() -> bool {
    !mic_users().is_empty()
}

pub fn detect_call_app() -> String {
    super::call_label(&frontmost_app().name, &frontmost_window_title().unwrap_or_default(), &mic_users())
}

static MIC_CACHE: parking_lot::Mutex<Option<(std::time::Instant, bool)>> = parking_lot::Mutex::new(None);

/// Is there a microphone? `pactl` lists the sources (monitors excluded); without pactl, ask ALSA
/// through cpal. Linux has no per-app microphone permission (Flatpak/Snap portals aside).
fn mic_available() -> bool {
    if let Some((t, v)) = *MIC_CACHE.lock() {
        if t.elapsed() < Duration::from_secs(10) {
            return v;
        }
    }
    let v = match pactl(&["list", "short", "sources"]) {
        Some(t) => t.lines().any(|l| l.split('\t').nth(1).is_some_and(|name| !name.ends_with(".monitor"))),
        None => {
            use cpal::traits::HostTrait;
            cpal::default_host().default_input_device().is_some()
        }
    };
    *MIC_CACHE.lock() = Some((std::time::Instant::now(), v));
    v
}

pub fn permissions() -> Permissions {
    let hotkey = HOTKEY_ACTIVE.load(Ordering::SeqCst);
    let problem = if hotkey { None } else { hotkey_problem() };
    let mic = mic_available();
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().to_lowercase();
    let probe = super::LinuxProbe {
        wayland: wayland(),
        gnome: desktop.contains("gnome") || desktop.contains("unity"),
        mic,
        hotkey_active: hotkey,
        hotkey_problem: problem.clone(),
        wtype: have("wtype"),
        ydotool: have("ydotool"),
        ydotoold: ydotoold_running(),
        portal: portal_installed(),
        tesseract: have("tesseract"),
        autostart: autostart_file().is_some_and(|f| f.is_file()),
    };
    Permissions { microphone: mic, accessibility: true, input_monitoring: hotkey, screen: true, hotkey_active: hotkey, accessibility_stale: false, hotkey_problem: problem, checks: super::linux_checks(&probe) }
}

/// ydotool 1.x talks to its daemon over a socket ($YDOTOOL_SOCKET, else /run/user/UID or /tmp).
fn ydotoold_running() -> bool {
    if let Ok(p) = std::env::var("YDOTOOL_SOCKET") {
        return std::path::Path::new(&p).exists();
    }
    let runtime = std::env::var("XDG_RUNTIME_DIR").ok().map(|d| std::path::PathBuf::from(d).join(".ydotool_socket"));
    runtime.into_iter().chain([std::path::PathBuf::from("/tmp/.ydotool_socket")]).any(|p| p.exists())
}

/// xdg-desktop-portal is D-Bus activatable (its service file is installed).
fn portal_installed() -> bool {
    let dirs = std::env::var("XDG_DATA_DIRS").unwrap_or_else(|_| "/usr/local/share:/usr/share".into());
    dirs.split(':').filter(|d| !d.is_empty()).any(|d| std::path::Path::new(d).join("dbus-1/services/org.freedesktop.portal.Desktop.service").is_file())
}

/// ~/.config/autostart/flo.desktop
fn autostart_file() -> Option<std::path::PathBuf> {
    dirs::config_dir().map(|d| d.join("autostart").join("flo.desktop"))
}

/// The command that starts this Flo: the AppImage when run from one, else the installed binary.
fn launch_command() -> Option<String> {
    if let Ok(img) = std::env::var("APPIMAGE") {
        return Some(img);
    }
    std::env::current_exe().ok().map(|p| p.display().to_string())
}

fn enable_autostart() -> Result<()> {
    let file = autostart_file().ok_or_else(|| anyhow!("no config directory"))?;
    let exe = launch_command().ok_or_else(|| anyhow!("can't tell where Flo is installed"))?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&file, super::autostart_desktop_entry(&exe))?;
    Ok(())
}

/// "Fix" on a check: the sound settings for the microphone; start-at-login writes the autostart
/// entry. The other checks are fixed with the terminal command shown next to them.
pub fn open_permission_settings(kind: &str) {
    match kind {
        "microphone" => {
            for (bin, args) in [("gnome-control-center", &["sound"][..]), ("systemsettings", &["kcm_pulseaudio"][..]), ("pavucontrol", &["-t", "4"][..]), ("xfce4-pulseaudio-plugin", &[][..])] {
                if have(bin) && Command::new(bin).args(args).spawn().is_ok() {
                    return;
                }
            }
        }
        "autostart" => {
            if let Err(e) = enable_autostart() {
                log::warn!("start at login: {e}");
            }
        }
        _ => {}
    }
}

pub fn fix_fn_key() -> Result<String> {
    Ok("Not needed on Linux. Hold Ctrl to dictate, Ctrl + Super for the assistant (change them in Settings).".into())
}

// ── OCR (tesseract CLI, on-device) ──────────────────────────────────────────────────────────────

pub fn ocr(rgba: &[u8], w: u32, h: u32) -> Option<String> {
    if !has_native_ocr() {
        return None;
    }
    let img = image::RgbaImage::from_raw(w, h, rgba.to_vec())?;
    let path = std::env::temp_dir().join(format!("flo-ocr-{}.png", uuid::Uuid::new_v4().simple()));
    img.save(&path).ok()?;
    let out = Command::new("tesseract").arg(&path).arg("stdout").stdin(Stdio::null()).stderr(Stdio::null()).output();
    let _ = std::fs::remove_file(&path);
    let out = out.ok()?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !text.is_empty()).then_some(text)
}

pub fn has_native_ocr() -> bool {
    have("tesseract")
}

pub fn set_pointer_cursor() {}

/// None: the hover tracker then uses Tauri's cursor and window positions.
pub fn cursor_location() -> Option<(f64, f64)> {
    None
}

/// AT-SPI isn't wired up yet, so corrections learning (re-reading the field you dictated into)
/// is off on Linux.
pub fn focused_text() -> Option<(usize, String)> {
    None
}

pub fn diagnostics() -> serde_json::Value {
    serde_json::json!({
        "platform": "linux",
        "wayland": wayland(),
        "hotkey_active": HOTKEY_ACTIVE.load(Ordering::SeqCst),
        "hotkey_problem": HOTKEY_PROBLEM.lock().clone(),
        "wtype": have("wtype"),
        "ydotool": have("ydotool"),
        "tesseract": have("tesseract"),
        "pactl": have("pactl"),
    })
}

/// Why push-to-talk isn't running, for setup ("add yourself to the input group").
pub fn hotkey_problem() -> Option<String> {
    HOTKEY_PROBLEM.lock().clone()
}

/// The process's executable (walks up to the first ancestor with a window).
pub fn host_app_of(pid: i32) -> Option<String> {
    let mut p = pid as u32;
    for _ in 0..16 {
        if !x11::windows_of(p).is_empty() {
            return std::fs::read_link(format!("/proc/{p}/exe")).ok().map(|x| x.display().to_string());
        }
        let stat = std::fs::read_to_string(format!("/proc/{p}/stat")).ok()?;
        // pid (comm) state ppid ...: comm may contain spaces, so split after the last ')'
        p = stat.rsplit_once(')')?.1.split_whitespace().nth(1)?.parse().ok()?;
        if p <= 1 {
            break;
        }
    }
    None
}

/// First running editor / terminal, used when an event doesn't know where it came from.
pub fn running_dev_app() -> Option<String> {
    const EDITORS: &[&str] = &["cursor", "code", "windsurf", "zed", "gnome-terminal", "konsole", "kitty", "alacritty", "wezterm", "ghostty"];
    let wins = x11::client_windows();
    EDITORS.iter().find(|e| wins.iter().any(|(_, _, class)| class.to_lowercase().split(' ').any(|c| c == **e))).map(|s| s.to_string())
}

pub fn open_app_path(app: &str, path: Option<&str>) -> Result<()> {
    let mut c = Command::new(app);
    if let Some(p) = path {
        c.arg(p);
    }
    c.spawn()?;
    Ok(())
}

/// Focus the window for a coding session: a window of `app` whose title mentions the project.
pub fn focus_session_window(app: &str, names: &[String]) -> Result<String> {
    let stem = app.rsplit('/').next().unwrap_or(app).to_lowercase();
    let wins: Vec<_> = x11::client_windows().into_iter().filter(|(_, _, class)| class.to_lowercase().contains(&stem)).collect();
    let lower: Vec<String> = names.iter().map(|n| n.to_lowercase()).filter(|n| !n.is_empty()).collect();
    if let Some((w, title, _)) = wins.iter().find(|(_, t, _)| lower.iter().any(|n| t.to_lowercase().contains(n))).or_else(|| wins.first()) {
        x11::activate(*w);
        return Ok(format!("focused {title}"));
    }
    // no X11 (Wayland): wmctrl can't help either; start the app instead
    let _ = Command::new("wmctrl").args(["-x", "-a", &stem]).status();
    Ok("activated".into())
}

// ── agent input ─────────────────────────────────────────────────────────────────────────────────

/// Move the mouse and left-click at a screen point (pixels, top-left origin).
pub fn click_at(x: f64, y: f64, double: bool) -> Result<()> {
    synthesizing(300);
    if wayland() && have("ydotool") {
        let (xs, ys) = (format!("{}", x.round() as i64), format!("{}", y.round() as i64));
        if run_ok("ydotool", &["mousemove", "--absolute", "-x", &xs, "-y", &ys]) {
            let n = if double { "2" } else { "1" };
            if run_ok("ydotool", &["click", "--repeat", n, "0xC0"]) {
                return Ok(());
            }
        }
    }
    let mut e = enigo()?;
    e.move_mouse(x.round() as i32, y.round() as i32, Coordinate::Abs).map_err(|e| anyhow!("{e:?}"))?;
    std::thread::sleep(Duration::from_millis(20));
    for i in 0..if double { 2 } else { 1 } {
        if i > 0 {
            std::thread::sleep(Duration::from_millis(40));
        }
        e.button(Button::Left, Direction::Press).map_err(|e| anyhow!("{e:?}"))?;
        std::thread::sleep(Duration::from_millis(25));
        e.button(Button::Left, Direction::Release).map_err(|e| anyhow!("{e:?}"))?;
    }
    Ok(())
}

/// Type a unicode string wherever the cursor is.
pub fn type_text(text: &str) -> Result<()> {
    synthesizing(200 + 15 * text.chars().count() as u64);
    if wayland() {
        if have("wtype") && run_ok("wtype", &["--", text]) {
            return Ok(());
        }
        if have("ydotool") && run_ok("ydotool", &["type", "--", text]) {
            return Ok(());
        }
    }
    enigo()?.text(text).map_err(|e| anyhow!("{e:?}"))
}

/// Windows virtual-key code (from `keycode_for`) → enigo key / xkb keysym name (for wtype).
fn vk_key(vk: u16) -> Option<(Key, String)> {
    Some(match vk {
        0x0D => (Key::Return, "Return".into()),
        0x09 => (Key::Tab, "Tab".into()),
        0x20 => (Key::Space, "space".into()),
        0x08 => (Key::Backspace, "BackSpace".into()),
        0x2E => (Key::Delete, "Delete".into()),
        0x1B => (Key::Escape, "Escape".into()),
        0x25 => (Key::LeftArrow, "Left".into()),
        0x26 => (Key::UpArrow, "Up".into()),
        0x27 => (Key::RightArrow, "Right".into()),
        0x28 => (Key::DownArrow, "Down".into()),
        0x24 => (Key::Home, "Home".into()),
        0x23 => (Key::End, "End".into()),
        0x21 => (Key::PageUp, "Prior".into()),
        0x22 => (Key::PageDown, "Next".into()),
        c @ (0x30..=0x39 | 0x41..=0x5A) => {
            let ch = (c as u8 as char).to_ascii_lowercase();
            (Key::Unicode(ch), ch.to_string())
        }
        _ => return None,
    })
}

/// Press a key with modifiers. `cmd` means Ctrl here (the agent speaks macOS shortcuts).
pub fn key_press(keycode: u16, cmd: bool, shift: bool, alt: bool, ctrl: bool) -> Result<()> {
    let (key, name) = vk_key(keycode).ok_or_else(|| anyhow!("unsupported key"))?;
    synthesizing(300);
    if wayland() && have("wtype") {
        let mut args: Vec<&str> = Vec::new();
        let mods: Vec<&str> = [(cmd || ctrl, "ctrl"), (shift, "shift"), (alt, "alt")].into_iter().filter(|(on, _)| *on).map(|(_, m)| m).collect();
        for m in &mods {
            args.extend(["-M", m]);
        }
        args.extend(["-k", name.as_str()]);
        for m in mods.iter().rev() {
            args.extend(["-m", m]);
        }
        if run_ok("wtype", &args) {
            return Ok(());
        }
    }
    let mut e = enigo()?;
    let mods: Vec<Key> = [(cmd || ctrl, Key::Control), (shift, Key::Shift), (alt, Key::Alt)].into_iter().filter(|(on, _)| *on).map(|(_, k)| k).collect();
    for m in &mods {
        e.key(*m, Direction::Press).map_err(|e| anyhow!("{e:?}"))?;
    }
    let r = e.key(key, Direction::Click).map_err(|e| anyhow!("{e:?}"));
    for m in mods.iter().rev() {
        let _ = e.key(*m, Direction::Release);
    }
    r
}

pub fn keycode_for(name: &str) -> Option<u16> {
    super::pc_keycode_for(name)
}

/// Scroll vertically by `dy` lines (positive = up).
pub fn scroll_by(dy: i32) -> Result<()> {
    synthesizing(200);
    enigo()?.scroll(-dy, Axis::Vertical).map_err(|e| anyhow!("{e:?}"))
}

pub fn open_bundle(_bundle: &str, path: Option<&str>) -> Result<()> {
    if let Some(p) = path {
        Command::new("xdg-open").arg(p).spawn()?;
    }
    Ok(())
}

// ── media (MPRIS over D-Bus) + volume (pactl) ───────────────────────────────────────────────────

mod mpris {
    use std::collections::HashMap;
    use zbus::blocking::{fdo::DBusProxy, Connection, Proxy};
    use zbus::zvariant::OwnedValue;

    const PREFIX: &str = "org.mpris.MediaPlayer2.";
    const PLAYER: &str = "org.mpris.MediaPlayer2.Player";
    const PATH: &str = "/org/mpris/MediaPlayer2";

    pub struct Player {
        pub bus: String,
        pub status: String,
        pub meta: HashMap<String, OwnedValue>,
        pub position_us: Option<i64>,
        proxy: Proxy<'static>,
    }

    fn players(conn: &Connection) -> Vec<Player> {
        let Ok(dbus) = DBusProxy::new(conn) else { return vec![] };
        let Ok(names) = dbus.list_names() else {
            // the bus went away (session restart): reconnect next time
            *BUS.lock() = None;
            return vec![];
        };
        names
            .into_iter()
            .map(|n| n.to_string())
            .filter(|n| n.starts_with(PREFIX))
            .filter_map(|bus| {
                let proxy = Proxy::new(conn, bus.clone(), PATH, PLAYER).ok()?;
                let status: String = proxy.get_property("PlaybackStatus").ok()?;
                let meta: HashMap<String, OwnedValue> = proxy.get_property("Metadata").unwrap_or_default();
                let position_us: Option<i64> = proxy.get_property("Position").ok();
                Some(Player { bus, status, meta, position_us, proxy })
            })
            .collect()
    }

    /// One session-bus connection for the whole app (a new one per poll cost a full D-Bus
    /// handshake), with a short method timeout: a hung player (a busy browser) must never stall
    /// the caller for zbus's default 25 s.
    static BUS: parking_lot::Mutex<Option<Connection>> = parking_lot::Mutex::new(None);

    fn bus() -> Option<Connection> {
        let mut g = BUS.lock();
        if let Some(c) = g.as_ref() {
            return Some(c.clone());
        }
        let c = zbus::blocking::connection::Builder::session().ok()?.method_timeout(std::time::Duration::from_millis(800)).build().ok()?;
        *g = Some(c.clone());
        Some(c)
    }

    /// The player to show / control: a playing one first, else a paused one.
    pub fn current() -> Option<Player> {
        let conn = bus()?;
        let mut ps = players(&conn);
        let i = ps.iter().position(|p| p.status == "Playing").or_else(|| ps.iter().position(|p| p.status == "Paused"))?;
        Some(ps.swap_remove(i))
    }

    impl Player {
        pub fn text(&self, key: &str) -> String {
            self.meta.get(key).and_then(|v| String::try_from(v.try_clone().ok()?).ok()).unwrap_or_default()
        }
        pub fn text_list(&self, key: &str) -> String {
            self.meta.get(key).and_then(|v| Vec::<String>::try_from(v.try_clone().ok()?).ok()).map(|v| v.join(", ")).unwrap_or_default()
        }
        pub fn length_us(&self) -> Option<i64> {
            let v = self.meta.get("mpris:length")?.try_clone().ok()?;
            i64::try_from(v.try_clone().ok()?).ok().or_else(|| u64::try_from(v).ok().map(|u| u as i64))
        }
        pub fn call(&self, method: &str) -> zbus::Result<()> {
            self.proxy.call_method(method, &()).map(|_| ())
        }
    }
}

/// What's playing in any MPRIS player (Spotify, browsers, VLC, Rhythmbox…).
pub fn now_playing() -> Option<crate::model::NowPlaying> {
    let p = mpris::current()?;
    let title = p.text("xesam:title");
    if title.is_empty() {
        return None;
    }
    let duration = p.length_us().filter(|l| *l > 0).map(|l| l as f64 / 1e6);
    let art = p.text("mpris:artUrl");
    Some(crate::model::NowPlaying {
        app: super::media_app_name(&p.bus),
        title,
        artist: p.text_list("xesam:artist"),
        album: p.text("xesam:album"),
        playing: p.status == "Playing",
        elapsed: duration.and(p.position_us.map(|u| u as f64 / 1e6)),
        duration,
        elapsed_at: Some(chrono::Utc::now().timestamp_millis()),
        bundle_id: Some(p.bus.clone()),
        artwork: art.starts_with("https://").then_some(art),
        ..Default::default()
    })
}

/// play / pause / playpause / next / previous on the current MPRIS player.
pub fn media_control(action: &str) -> Result<()> {
    let method = match action {
        "play" => "Play",
        "pause" => "Pause",
        "playpause" | "toggle" => "PlayPause",
        "next" => "Next",
        "previous" | "prev" => "Previous",
        other => return Err(anyhow!("unknown media action {other}")),
    };
    let p = mpris::current().ok_or_else(|| anyhow!("Nothing is playing"))?;
    p.call(method).map_err(|e| anyhow!("media control: {e}"))
}

/// Speaker volume 0–100 of the default sink.
pub fn get_volume() -> Option<u8> {
    pactl(&["get-sink-volume", "@DEFAULT_SINK@"]).and_then(|s| super::parse_pactl_volume(&s))
}

pub fn set_volume(level: u8) -> Result<u8> {
    let level = level.min(100);
    if !run_ok("pactl", &["set-sink-volume", "@DEFAULT_SINK@", &format!("{level}%")]) {
        return Err(anyhow!("couldn't change the volume (pactl missing?)"));
    }
    if level > 0 {
        run_ok("pactl", &["set-sink-mute", "@DEFAULT_SINK@", "0"]);
    }
    Ok(level)
}

pub fn set_muted(muted: bool) -> Result<()> {
    if !run_ok("pactl", &["set-sink-mute", "@DEFAULT_SINK@", if muted { "1" } else { "0" }]) {
        return Err(anyhow!("couldn't mute (pactl missing?)"));
    }
    Ok(())
}

/// Seconds since the last keyboard / mouse input (X11 only).
pub fn idle_seconds() -> Option<f64> {
    if wayland() {
        return None;
    }
    x11::idle_ms().map(|ms| ms as f64 / 1000.0)
}
