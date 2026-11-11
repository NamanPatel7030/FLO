//! Fallback for unsupported OSes (Linux): compile-only stubs.
use super::{FrontApp, HotkeyCallback};
use crate::model::{IslandGeometry, Permissions};
use anyhow::{bail, Result};
use std::ffi::c_void;

pub fn send_paste_shortcut() -> Result<()> { bail!("unsupported OS") }
pub fn send_copy_shortcut() -> Result<()> { bail!("unsupported OS") }
pub fn start_hotkeys(_cb: HotkeyCallback) {}
pub fn frontmost_app() -> FrontApp { FrontApp::default() }
pub fn activate_app(_pid: i32) {}
pub fn open_app(_name: &str) -> Result<()> { bail!("unsupported OS") }
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
pub fn set_hotkeys(_cfg: crate::hotkey::HotkeyConfig) {}
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
pub fn focus_session_window(_app: &str, _names: &[String]) -> Result<String> {
    Ok(String::new())
}
pub fn click_at(_x: f64, _y: f64, _double: bool) -> Result<()> { Ok(()) }
pub fn type_text(_t: &str) -> Result<()> { Ok(()) }
pub fn key_press(_k: u16, _c: bool, _s: bool, _a: bool, _ct: bool) -> Result<()> { Ok(()) }
pub fn keycode_for(_n: &str) -> Option<u16> { None }
pub fn scroll_by(_dy: i32) -> Result<()> { Ok(()) }
pub fn open_bundle(_b: &str, _p: Option<&str>) -> Result<()> { bail!("unsupported OS") }
pub fn island_geometry() -> IslandGeometry {
    IslandGeometry { platform: "linux".into(), has_notch: false, notch_width: 64.0, notch_height: 64.0, screen_width: 0.0, opaque: false }
}
pub fn configure_island(_w: *mut c_void) {}
pub fn island_position(_g: &IslandGeometry, _w: f64, _h: f64) -> (f64, f64) { (0.0, 0.0) }
pub fn permissions() -> Permissions { Permissions { microphone: true, accessibility: true, input_monitoring: true, screen: true, hotkey_active: false, accessibility_stale: false, hotkey_problem: None, checks: Vec::new() } }
pub fn open_permission_settings(_kind: &str) {}
pub fn fix_fn_key() -> Result<String> { Ok(String::new()) }
pub fn ocr(_rgba: &[u8], _w: u32, _h: u32) -> Option<String> { None }
pub fn has_native_ocr() -> bool { false }
