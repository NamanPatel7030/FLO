//! Linux (X11; Wayland with limits): rdev keyboard hook, enigo paste, bottom-right island.
//! Wayland compositors block global key hooks and synthetic input for security — on Wayland,
//! bind a desktop shortcut to `flo-flow --toggle-dictation` instead (see README).
use super::{FrontApp, HotkeyCallback};
use crate::hotkey::Machine;
use crate::model::{IslandGeometry, Permissions};
use anyhow::{anyhow, Result};
use enigo::{Direction, Enigo, Key, Keyboard, Settings as EnigoSettings};
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};

static HOTKEY_ACTIVE: AtomicBool = AtomicBool::new(false);

fn ctrl_combo(ch: char) -> Result<()> {
    let mut e = Enigo::new(&EnigoSettings::default()).map_err(|e| anyhow!("{e:?}"))?;
    e.key(Key::Control, Direction::Press).map_err(|e| anyhow!("{e:?}"))?;
    e.key(Key::Unicode(ch), Direction::Click).map_err(|e| anyhow!("{e:?}"))?;
    e.key(Key::Control, Direction::Release).map_err(|e| anyhow!("{e:?}"))?;
    Ok(())
}

pub fn send_paste_shortcut() -> Result<()> {
    ctrl_combo('v')
}

pub fn send_copy_shortcut() -> Result<()> {
    ctrl_combo('c')
}

/// Hold Right Ctrl = dictation, hold Right Alt (AltGr) = assistant.
pub fn start_hotkeys(cb: HotkeyCallback) {
    std::thread::Builder::new()
        .name("flo-hotkey".into())
        .spawn(move || {
            let mut machine = Machine::default();
            let (mut rctrl, mut ralt) = (false, false);
            HOTKEY_ACTIVE.store(true, Ordering::SeqCst);
            let res = rdev::listen(move |ev| {
                let changed = match ev.event_type {
                    rdev::EventType::KeyPress(rdev::Key::ControlRight) => { rctrl = true; true }
                    rdev::EventType::KeyRelease(rdev::Key::ControlRight) => { rctrl = false; true }
                    rdev::EventType::KeyPress(rdev::Key::AltGr) => { ralt = true; true }
                    rdev::EventType::KeyRelease(rdev::Key::AltGr) => { ralt = false; true }
                    _ => false,
                };
                if changed {
                    if let Some(e) = machine.update_two_keys(rctrl, ralt) {
                        cb(e);
                    }
                }
            });
            if let Err(e) = res {
                HOTKEY_ACTIVE.store(false, Ordering::SeqCst);
                log::error!("keyboard hook failed (Wayland? use a desktop shortcut): {e:?}");
            }
        })
        .ok();
}

pub fn set_hotkeys(_cfg: crate::hotkey::HotkeyConfig) {}

pub fn frontmost_app() -> FrontApp {
    match active_win_pos_rs::get_active_window() {
        Ok(w) => FrontApp { name: w.app_name, pid: w.process_id as i32 },
        Err(_) => FrontApp::default(),
    }
}

pub fn activate_app(_pid: i32) {}

pub fn open_app(name: &str) -> Result<()> {
    // try the desktop launcher name first, then the binary
    let lower = name.to_lowercase().replace(' ', "-");
    for cmd in [&["gtk-launch", lower.as_str()][..], &[lower.as_str()][..]] {
        if std::process::Command::new(cmd[0]).args(&cmd[1..]).spawn().is_ok() {
            return Ok(());
        }
    }
    Err(anyhow!("couldn't find an app called “{name}”"))
}

pub fn island_geometry() -> IslandGeometry {
    IslandGeometry { platform: "linux".into(), has_notch: false, notch_width: 64.0, notch_height: 64.0, screen_width: 0.0 }
}

pub fn configure_island(_w: *mut c_void) {}

pub fn island_position(_g: &IslandGeometry, _w: f64, _h: f64) -> (f64, f64) {
    (0.0, 0.0) // bottom-right computed in lib.rs from the monitor work area
}

pub fn permissions() -> Permissions {
    Permissions { microphone: true, accessibility: true, input_monitoring: true, screen: true, hotkey_active: HOTKEY_ACTIVE.load(Ordering::SeqCst) }
}

pub fn open_permission_settings(_kind: &str) {}

pub fn fix_fn_key() -> Result<String> {
    Ok("Not needed on Linux. Hold Right Ctrl to dictate, Right Alt for the assistant.".into())
}

pub fn ocr(_rgba: &[u8], _w: u32, _h: u32) -> Option<String> {
    None
}

pub fn has_native_ocr() -> bool {
    false
}

pub fn mic_in_use() -> bool {
    false
}

pub fn detect_call_app() -> String {
    "a call".into()
}

pub fn set_pointer_cursor() {}
pub fn cursor_location() -> Option<(f64, f64)> {
    None
}

pub fn focused_text() -> Option<(usize, String)> {
    None
}

pub fn diagnostics() -> serde_json::Value {
    serde_json::json!({ "platform": "linux", "hotkey_active": HOTKEY_ACTIVE.load(Ordering::SeqCst) })
}

pub fn host_app_of(_pid: i32) -> Option<String> {
    None
}

pub fn running_dev_app() -> Option<String> {
    None
}

pub fn open_app_path(app: &str, path: Option<&str>) -> Result<()> {
    let mut c = std::process::Command::new(app);
    if let Some(p) = path {
        c.arg(p);
    }
    c.spawn()?;
    Ok(())
}

pub fn focus_session_window(app: &str, _names: &[String]) -> Result<String> {
    // best effort: wmctrl can raise a window by application name if installed
    let _ = std::process::Command::new("wmctrl").args(["-x", "-a", app]).status();
    Ok("activated".into())
}

pub fn click_at(_x: f64, _y: f64, _double: bool) -> Result<()> { Ok(()) }
pub fn type_text(_t: &str) -> Result<()> { Ok(()) }
pub fn key_press(_k: u16, _c: bool, _s: bool, _a: bool, _ct: bool) -> Result<()> { Ok(()) }
pub fn keycode_for(_n: &str) -> Option<u16> { None }
pub fn scroll_by(_dy: i32) -> Result<()> { Ok(()) }
pub fn open_bundle(_bundle: &str, path: Option<&str>) -> Result<()> {
    if let Some(p) = path {
        std::process::Command::new("xdg-open").arg(p).spawn()?;
    }
    Ok(())
}
