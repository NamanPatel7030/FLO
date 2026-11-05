//! Windows: low-level keyboard hook (rdev), SendInput paste (enigo), bottom-right island.
use super::{FrontApp, HotkeyCallback};
use crate::hotkey::Machine;
use crate::model::{IslandGeometry, Permissions};
use anyhow::{anyhow, Result};
use enigo::{Direction, Enigo, Key, Keyboard, Settings as EnigoSettings};
use std::ffi::c_void;

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

/// Hold Right Ctrl = dictation, hold Right Alt = assistant.
pub fn start_hotkeys(cb: HotkeyCallback) {
    std::thread::Builder::new()
        .name("flo-hotkey".into())
        .spawn(move || {
            let mut machine = Machine::default();
            let mut rctrl = false;
            let mut ralt = false;
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
                log::error!("keyboard hook failed: {e:?}");
            }
        })
        .ok();
}

pub fn frontmost_app() -> FrontApp {
    match active_win_pos_rs::get_active_window() {
        Ok(w) => FrontApp { name: w.app_name, pid: w.process_id as i32 },
        Err(_) => FrontApp::default(),
    }
}

pub fn activate_app(_pid: i32) {
    // Island window is non-activating on Windows; nothing to restore.
}

pub fn diagnostics() -> serde_json::Value {
    serde_json::json!({})
}
pub fn host_app_of(_pid: i32) -> Option<String> {
    None
}
pub fn running_dev_app() -> Option<String> {
    None
}
pub fn open_app_path(_app: &str, _path: Option<&str>) -> Result<()> {
    Ok(())
}
pub fn focus_session_window(_app: &str, _names: &[String]) -> Result<String> {
    Ok(String::new())
}
pub fn open_bundle(_bundle: &str, path: Option<&str>) -> Result<()> {
    if let Some(p) = path {
        std::process::Command::new("explorer").arg(p).status()?;
    }
    Ok(())
}

pub fn open_app(name: &str) -> Result<()> {
    std::process::Command::new("cmd").args(["/C", "start", "", name]).status()?;
    Ok(())
}

pub fn island_geometry() -> IslandGeometry {
    IslandGeometry { platform: "windows".into(), has_notch: false, notch_width: 64.0, notch_height: 64.0, screen_width: 0.0 }
}

pub fn configure_island(_ns_window: *mut c_void) {}

/// Bottom-right of the work area (above the taskbar), 16px margin. Caller passes work area via geo.
pub fn island_position(_geo: &IslandGeometry, _width: f64, _height: f64) -> (f64, f64) {
    (0.0, 0.0) // computed in lib.rs from the monitor work area
}

pub fn permissions() -> Permissions {
    Permissions { microphone: true, accessibility: true, input_monitoring: true, screen: true, hotkey_active: true }
}

pub fn open_permission_settings(kind: &str) {
    let uri = match kind {
        "microphone" => "ms-settings:privacy-microphone",
        _ => "ms-settings:privacy",
    };
    let _ = std::process::Command::new("cmd").args(["/C", "start", "", uri]).status();
}

pub fn fix_fn_key() -> Result<String> {
    Ok("Not needed on Windows — hold Right Ctrl to dictate, Right Alt for the assistant.".into())
}

pub fn ocr(_rgba: &[u8], _w: u32, _h: u32) -> Option<String> {
    None
}

pub fn has_native_ocr() -> bool {
    false
}
