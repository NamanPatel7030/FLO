//! Windows: low-level keyboard hook (WH_KEYBOARD_LL) for push-to-talk, SendInput (enigo) for
//! paste / typing / clicks, Win32 for the frontmost window, the CapabilityAccessManager consent
//! store for the microphone privacy switch and "is a call using the mic", UI Automation for the
//! focused field, Windows.Media.Ocr for on-device OCR, and a non-activating tool window for the
//! island (top centre of the primary display's work area).
use super::{FrontApp, HotkeyCallback};
use crate::hotkey::{HotkeyConfig, PcKey, PcKeys};
use crate::model::{IslandGeometry, Permissions};
use anyhow::{anyhow, Result};
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings as EnigoSettings};
use std::ffi::c_void;
use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use windows::core::{BOOL, PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, EnumWindows, GetForegroundWindow, GetMessageW, GetWindowLongPtrW, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow, SetWindowLongPtrW, SetWindowPos, SetWindowsHookExW, ShowWindow,
    TranslateMessage, GWL_EXSTYLE, HC_ACTION, KBDLLHOOKSTRUCT, LLKHF_INJECTED, MSG, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    SWP_NOZORDER, SW_RESTORE, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

/// Don't flash a console window for helper commands.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn enigo() -> Result<Enigo> {
    Enigo::new(&EnigoSettings::default()).map_err(|e| anyhow!("can't send input: {e:?}"))
}

fn vk_input(vk: u16, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT { wVk: VIRTUAL_KEY(vk), wScan: 0, dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) }, time: 0, dwExtraInfo: 0 },
        },
    }
}

fn send_vks(events: &[(u16, bool)]) {
    let inputs: Vec<INPUT> = events.iter().map(|(vk, up)| vk_input(*vk, *up)).collect();
    unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
}

fn held(vk: i32) -> bool {
    (unsafe { GetAsyncKeyState(vk) } as u16 & 0x8000) != 0
}

/// An unassigned virtual key. Tapping it while Win / Alt is down stops the Start menu / the
/// window menu bar from opening when that key is let go (Flo's own Win+Ctrl push-to-talk).
const VK_MASK: u16 = 0xE8;

/// Let go of the Win / Alt / Shift keys the person is holding for push-to-talk, so the Ctrl+C / Ctrl+V
/// Flo sends isn't seen as Win+Ctrl+C. The physical key up later is harmless.
fn release_held_modifiers() {
    let mut ev: Vec<(u16, bool)> = Vec::new();
    let held_any: Vec<u16> = [0x5B_u16, 0x5C, 0xA4, 0xA5, 0xA0, 0xA1].into_iter().filter(|vk| held(*vk as i32)).collect();
    if held_any.is_empty() {
        return;
    }
    ev.push((VK_MASK, false));
    ev.push((VK_MASK, true));
    ev.extend(held_any.into_iter().map(|vk| (vk, true)));
    send_vks(&ev);
}

fn ctrl_combo(ch: char) -> Result<()> {
    release_held_modifiers();
    let mut e = enigo()?;
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

// ── push-to-talk: WH_KEYBOARD_LL ────────────────────────────────────────────────────────────────

static HOTKEY_ACTIVE: AtomicBool = AtomicBool::new(false);
static HOTKEY_CFG: parking_lot::RwLock<Option<HotkeyConfig>> = parking_lot::RwLock::new(None);

struct HookState {
    keys: PcKeys,
    cb: Arc<HotkeyCallback>,
    /// a push-to-talk event fired while Win was down: mask its key up (no Start menu)
    win_used: bool,
}
static HOOK: parking_lot::Mutex<Option<HookState>> = parking_lot::Mutex::new(None);

/// Apply the configured push-to-talk combos (takes effect immediately). `fn` means Ctrl+Win here.
pub fn set_hotkeys(cfg: HotkeyConfig) {
    *HOTKEY_CFG.write() = Some(cfg.for_pc());
}

fn hotkey_cfg() -> HotkeyConfig {
    HOTKEY_CFG.read().unwrap_or_else(|| HotkeyConfig::default().for_pc())
}

unsafe extern "system" fn keyboard_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 && lparam.0 != 0 {
        let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        let msg = wparam.0 as u32;
        let down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
        let up = msg == WM_KEYUP || msg == WM_SYSKEYUP;
        // Flo's own SendInput (paste, typing) is flagged injected: never treat it as the hotkey
        if (down || up) && (kb.flags.0 & LLKHF_INJECTED.0) == 0 {
            if let Some(key) = super::vk_to_pckey(kb.vkCode, kb.scanCode) {
                let cfg = hotkey_cfg();
                let mut fire = None;
                let mut swallow = false;
                let mut mask_win = false;
                if let Some(st) = HOOK.lock().as_mut() {
                    let (ev, sw) = st.keys.feed(key, down, &cfg);
                    swallow = sw;
                    if ev.is_some() && st.keys.mods().cmd {
                        st.win_used = true;
                    }
                    if matches!(key, PcKey::Win(_)) && up && st.win_used {
                        st.win_used = false;
                        mask_win = true;
                    }
                    fire = ev.map(|e| (e, st.cb.clone()));
                }
                if mask_win {
                    send_vks(&[(VK_MASK, false), (VK_MASK, true)]);
                }
                if let Some((ev, cb)) = fire {
                    cb(ev);
                }
                if swallow {
                    return LRESULT(1);
                }
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

/// Hold Ctrl → dictation, hold Ctrl+Win → assistant (configurable in Settings). Ctrl+Space or
/// Ctrl+Win+Space keeps listening hands-free; any other key while holding cancels (Ctrl+C works).
pub fn start_hotkeys(cb: HotkeyCallback) {
    let cb: Arc<HotkeyCallback> = Arc::new(cb);
    std::thread::Builder::new()
        .name("flo-hotkey".into())
        .spawn(move || unsafe {
            *HOOK.lock() = Some(HookState { keys: PcKeys::default(), cb, win_used: false });
            let module = GetModuleHandleW(PCWSTR::null()).ok();
            match SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), module.map(|m| m.into()), 0) {
                Ok(_hook) => {
                    HOTKEY_ACTIVE.store(true, Ordering::SeqCst);
                    log::info!("keyboard hook running");
                    // a low-level hook is called on this thread's message loop
                    let mut msg = MSG::default();
                    while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                        let _ = TranslateMessage(&msg);
                        DispatchMessageW(&msg);
                    }
                    HOTKEY_ACTIVE.store(false, Ordering::SeqCst);
                }
                Err(e) => log::error!("keyboard hook failed: {e}"),
            }
        })
        .ok();
}

// ── windows / apps ──────────────────────────────────────────────────────────────────────────────

fn window_title(hwnd: HWND) -> String {
    unsafe {
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return String::new();
        }
        let mut buf = vec![0u16; len as usize + 1];
        let n = GetWindowTextW(hwnd, &mut buf);
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }
}

fn window_pid(hwnd: HWND) -> u32 {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    pid
}

fn process_path(pid: u32) -> Option<String> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = vec![0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(h);
        ok.then(|| String::from_utf16_lossy(&buf[..len as usize]))
    }
}

/// "C:\Program Files\Google\Chrome\Application\chrome.exe" → "chrome"
fn exe_stem(path: &str) -> String {
    let file = path.rsplit(['\\', '/']).next().unwrap_or(path);
    file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(file).to_string()
}

pub fn frontmost_app() -> FrontApp {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return FrontApp::default();
    }
    let pid = window_pid(hwnd);
    let name = process_path(pid).map(|p| exe_stem(&p)).unwrap_or_default();
    FrontApp { name, pid: pid as i32 }
}

/// Title of the foreground window (e.g. "Meet - abc-defg-hij - Google Chrome").
pub fn frontmost_window_title() -> Option<String> {
    let hwnd = unsafe { GetForegroundWindow() };
    (!hwnd.0.is_null()).then(|| window_title(hwnd)).filter(|t| !t.is_empty())
}

/// Top-level visible windows: (hwnd, pid, title).
fn top_windows() -> Vec<(HWND, u32, String)> {
    unsafe extern "system" fn each(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let out = &mut *(lparam.0 as *mut Vec<(HWND, u32, String)>);
        if IsWindowVisible(hwnd).as_bool() {
            let title = window_title(hwnd);
            if !title.is_empty() {
                out.push((hwnd, window_pid(hwnd), title));
            }
        }
        BOOL(1)
    }
    let mut out: Vec<(HWND, u32, String)> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(each), LPARAM(&mut out as *mut _ as isize));
    }
    out
}

fn raise(hwnd: HWND) {
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        // Windows only lets the foreground process hand over focus; a (masked) Alt tap makes the
        // system treat Flo as the last input source, the documented way around that lock
        send_vks(&[(0xA4, false), (VK_MASK, false), (VK_MASK, true), (0xA4, true)]);
        let _ = SetForegroundWindow(hwnd);
    }
}

/// Bring the app that had focus when the session started back to the front.
pub fn activate_app(pid: i32) {
    if pid <= 0 || pid as u32 == std::process::id() {
        return;
    }
    if let Some((hwnd, _, _)) = top_windows().into_iter().find(|(_, p, _)| *p == pid as u32) {
        raise(hwnd);
    }
}

pub fn diagnostics() -> serde_json::Value {
    serde_json::json!({
        "platform": "windows",
        "hotkey_active": HOTKEY_ACTIVE.load(Ordering::SeqCst),
        "microphone_allowed": mic_allowed(),
        "frontmost": frontmost_app().name,
    })
}

/// Walk up from `pid` to the GUI app hosting it: the first ancestor with a visible window.
/// Runs on every Claude / Cursor hook event: one process snapshot for the whole walk (it used to
/// take a full system snapshot for each of up to 16 ancestors).
pub fn host_app_of(pid: i32) -> Option<String> {
    let wins = top_windows();
    let parents = parent_pids();
    let p = super::first_windowed_ancestor(pid as u32, |p| wins.iter().any(|(_, wp, _)| *wp == p), |p| parents.get(&p).copied().filter(|q| *q != 0 && *q != p))?;
    process_path(p)
}

/// pid → parent pid of every process, from one ToolHelp snapshot.
fn parent_pids() -> std::collections::HashMap<u32, u32> {
    use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    let mut out = std::collections::HashMap::new();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
        let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        if Process32FirstW(snap, &mut e).is_ok() {
            loop {
                out.insert(e.th32ProcessID, e.th32ParentProcessID);
                if Process32NextW(snap, &mut e).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    out
}

/// First running editor / terminal (by its window's process), when an event doesn't say where it came from.
pub fn running_dev_app() -> Option<String> {
    const EDITORS: &[&str] = &["cursor", "code", "windsurf", "zed", "windowsterminal", "wezterm-gui", "alacritty", "warp"];
    let wins = top_windows();
    for want in EDITORS {
        for (_, pid, _) in &wins {
            if let Some(path) = process_path(*pid) {
                if exe_stem(&path).eq_ignore_ascii_case(want) {
                    return Some(path);
                }
            }
        }
    }
    None
}

/// Launch an app (an .exe path or a name `start` knows), optionally with a folder.
pub fn open_app_path(app: &str, path: Option<&str>) -> Result<()> {
    let mut c = std::process::Command::new("cmd");
    c.args(["/C", "start", "", app]).creation_flags(CREATE_NO_WINDOW);
    if let Some(p) = path {
        c.arg(p);
    }
    if !c.status()?.success() {
        return Err(anyhow!("couldn't open {app}"));
    }
    Ok(())
}

/// Focus the editor / terminal window for a coding session: a window of `app` whose title mentions
/// one of `names` (the project folder), else any window of `app`.
pub fn focus_session_window(app: &str, names: &[String]) -> Result<String> {
    let stem = exe_stem(app).to_lowercase();
    let wins: Vec<(HWND, String)> = top_windows()
        .into_iter()
        .filter(|(_, pid, _)| process_path(*pid).map(|p| exe_stem(&p).to_lowercase() == stem).unwrap_or(false))
        .map(|(h, _, t)| (h, t))
        .collect();
    let lower: Vec<String> = names.iter().map(|n| n.to_lowercase()).filter(|n| !n.is_empty()).collect();
    if let Some((h, t)) = wins.iter().find(|(_, t)| lower.iter().any(|n| t.to_lowercase().contains(n))).or_else(|| wins.first()) {
        raise(*h);
        return Ok(format!("focused {t}"));
    }
    if app.contains('\\') || app.contains('/') {
        open_app_path(app, None)?;
    }
    Ok("activated".into())
}

pub fn set_pointer_cursor() {}

/// None: the hover tracker then uses Tauri's cursor and window positions (physical pixels).
pub fn cursor_location() -> Option<(f64, f64)> {
    None
}

// ── agent input (SendInput via enigo) ───────────────────────────────────────────────────────────

/// Move the mouse and left-click at a screen point (physical pixels of the virtual desktop, the
/// coordinate system the screenshot's monitor frame is reported in).
pub fn click_at(x: f64, y: f64, double: bool) -> Result<()> {
    let mut e = enigo()?;
    e.move_mouse(x.round() as i32, y.round() as i32, Coordinate::Abs).map_err(|e| anyhow!("{e:?}"))?;
    std::thread::sleep(std::time::Duration::from_millis(20));
    for i in 0..if double { 2 } else { 1 } {
        if i > 0 {
            std::thread::sleep(std::time::Duration::from_millis(40));
        }
        e.button(Button::Left, Direction::Press).map_err(|e| anyhow!("{e:?}"))?;
        std::thread::sleep(std::time::Duration::from_millis(25));
        e.button(Button::Left, Direction::Release).map_err(|e| anyhow!("{e:?}"))?;
    }
    Ok(())
}

/// Type a unicode string wherever the cursor is (KEYEVENTF_UNICODE, any language).
pub fn type_text(text: &str) -> Result<()> {
    release_held_modifiers();
    enigo()?.text(text).map_err(|e| anyhow!("{e:?}"))
}

/// Press a key (virtual-key code from `keycode_for`) with modifiers. `cmd` means Ctrl here: the
/// agent speaks macOS shortcuts (cmd+L, cmd+T) and Windows uses Ctrl for the same things.
pub fn key_press(keycode: u16, cmd: bool, shift: bool, alt: bool, ctrl: bool) -> Result<()> {
    let mut mods: Vec<u16> = Vec::new();
    if cmd || ctrl {
        mods.push(0x11);
    }
    if shift {
        mods.push(0x10);
    }
    if alt {
        mods.push(0x12);
    }
    let mut ev: Vec<(u16, bool)> = mods.iter().map(|m| (*m, false)).collect();
    ev.push((keycode, false));
    ev.push((keycode, true));
    ev.extend(mods.iter().rev().map(|m| (*m, true)));
    send_vks(&ev);
    Ok(())
}

pub fn keycode_for(name: &str) -> Option<u16> {
    super::pc_keycode_for(name)
}

/// Scroll vertically by `dy` lines (positive = up).
pub fn scroll_by(dy: i32) -> Result<()> {
    enigo()?.scroll(-dy, Axis::Vertical).map_err(|e| anyhow!("{e:?}"))
}

pub fn open_bundle(_bundle: &str, path: Option<&str>) -> Result<()> {
    if let Some(p) = path {
        std::process::Command::new("explorer").arg(p).status()?;
    }
    Ok(())
}

pub fn open_app(name: &str) -> Result<()> {
    let st = std::process::Command::new("cmd").args(["/C", "start", "", name]).creation_flags(CREATE_NO_WINDOW).status()?;
    if !st.success() {
        return Err(anyhow!("couldn't find an app called “{name}”"));
    }
    Ok(())
}

// ── island ──────────────────────────────────────────────────────────────────────────────────────

pub fn island_geometry() -> IslandGeometry {
    // no notch: a floating pill at the top centre; lib.rs fills in the screen width
    IslandGeometry { platform: "windows".into(), has_notch: false, notch_width: 0.0, notch_height: 0.0, screen_width: 0.0, opaque: false }
}

/// Make the island a tool window that never takes focus: clicking it leaves the keyboard in the
/// app you're dictating into, and it stays out of the taskbar and Alt+Tab.
pub fn configure_island(hwnd: *mut c_void) {
    if hwnd.is_null() {
        return;
    }
    unsafe {
        let h = HWND(hwnd);
        let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
        let new = (ex | WS_EX_TOOLWINDOW.0 as isize | WS_EX_NOACTIVATE.0 as isize) & !(WS_EX_APPWINDOW.0 as isize);
        SetWindowLongPtrW(h, GWL_EXSTYLE, new);
        let _ = SetWindowPos(h, None, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    }
}

pub fn island_position(_geo: &IslandGeometry, _width: f64, _height: f64) -> (f64, f64) {
    (0.0, 0.0) // top centre of the work area, computed in lib.rs from the monitor
}

// ── microphone ──────────────────────────────────────────────────────────────────────────────────

mod reg {
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY, KEY_READ, REG_VALUE_TYPE};

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub struct Key(HKEY);
    impl Drop for Key {
        fn drop(&mut self) {
            unsafe {
                let _ = RegCloseKey(self.0);
            }
        }
    }

    impl Key {
        pub fn open(root: HKEY, path: &str) -> Option<Key> {
            let p = wide(path);
            let mut h = HKEY::default();
            unsafe { RegOpenKeyExW(root, PCWSTR(p.as_ptr()), Some(0), KEY_READ, &mut h).ok().ok()? };
            Some(Key(h))
        }

        pub fn sub(&self, name: &str) -> Option<Key> {
            Key::open(self.0, name)
        }

        fn raw(&self, name: &str) -> Option<(REG_VALUE_TYPE, Vec<u8>)> {
            let n = wide(name);
            let mut ty = REG_VALUE_TYPE::default();
            let mut len = 0u32;
            unsafe {
                RegQueryValueExW(self.0, PCWSTR(n.as_ptr()), None, Some(&mut ty), None, Some(&mut len)).ok().ok()?;
                let mut buf = vec![0u8; len as usize];
                RegQueryValueExW(self.0, PCWSTR(n.as_ptr()), None, Some(&mut ty), Some(buf.as_mut_ptr()), Some(&mut len)).ok().ok()?;
                buf.truncate(len as usize);
                Some((ty, buf))
            }
        }

        pub fn string(&self, name: &str) -> Option<String> {
            let (_, b) = self.raw(name)?;
            let w: Vec<u16> = b.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).take_while(|c| *c != 0).collect();
            Some(String::from_utf16_lossy(&w))
        }

        pub fn qword(&self, name: &str) -> Option<u64> {
            let (_, b) = self.raw(name)?;
            (b.len() >= 8).then(|| u64::from_le_bytes(b[..8].try_into().unwrap()))
        }

        pub fn subkeys(&self) -> Vec<String> {
            let mut out = Vec::new();
            for i in 0.. {
                let mut buf = vec![0u16; 512];
                let mut len = buf.len() as u32;
                let r = unsafe { RegEnumKeyExW(self.0, i, Some(windows::core::PWSTR(buf.as_mut_ptr())), &mut len, None, None, None, None) };
                if r.is_err() {
                    break;
                }
                out.push(String::from_utf16_lossy(&buf[..len as usize]));
            }
            out
        }
    }
}

const MIC_STORE: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";

/// The Settings → Privacy → Microphone switches allow desktop apps (Flo) to use the mic.
fn mic_allowed() -> bool {
    use windows::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    let machine = reg::Key::open(HKEY_LOCAL_MACHINE, MIC_STORE).and_then(|k| k.string("Value"));
    let user_key = reg::Key::open(HKEY_CURRENT_USER, MIC_STORE);
    let user = user_key.as_ref().and_then(|k| k.string("Value"));
    let desktop = user_key.as_ref().and_then(|k| k.sub("NonPackaged")).and_then(|k| k.string("Value"));
    super::mic_consent_allowed(&[machine, user, desktop])
}

/// Apps recording from a microphone right now (consent-store entries with a start time and no
/// stop time), excluding Flo itself.
fn mic_users() -> Vec<String> {
    use windows::Win32::System::Registry::HKEY_CURRENT_USER;
    let Some(root) = reg::Key::open(HKEY_CURRENT_USER, MIC_STORE) else { return vec![] };
    let me = std::env::current_exe().ok().map(|p| p.display().to_string().replace('\\', "#").to_lowercase()).unwrap_or_default();
    let live = |k: &reg::Key| k.qword("LastUsedTimeStart").unwrap_or(0) > 0 && k.qword("LastUsedTimeStop") == Some(0);
    let mut out = Vec::new();
    for name in root.subkeys() {
        let Some(k) = root.sub(&name) else { continue };
        if name == "NonPackaged" {
            for exe in k.subkeys() {
                if exe.to_lowercase() == me {
                    continue;
                }
                if k.sub(&exe).is_some_and(|e| live(&e)) {
                    out.push(super::consent_key_app(&exe));
                }
            }
        } else if live(&k) {
            out.push(super::consent_key_app(&name));
        }
    }
    out
}

pub fn mic_in_use() -> bool {
    !mic_users().is_empty()
}

pub fn detect_call_app() -> String {
    super::call_label(&frontmost_app().name, &frontmost_window_title().unwrap_or_default(), &mic_users())
}

// ── focused text field (UI Automation) ──────────────────────────────────────────────────────────

/// Text of the focused field (identity hash, value) via UI Automation's Value pattern (edit
/// boxes, browsers' text fields) or Text pattern (rich editors). None for password fields.
pub fn focused_text() -> Option<(usize, String)> {
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
    use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation, IUIAutomationTextPattern, IUIAutomationValuePattern, UIA_TextPatternId, UIA_ValuePatternId};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let uia: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
        let el = uia.GetFocusedElement().ok()?;
        if el.CurrentIsPassword().map(|b| b.as_bool()).unwrap_or(true) {
            return None;
        }
        let id = el.GetRuntimeId().ok().map(|sa| {
            use std::hash::{Hash, Hasher};
            let mut h = std::collections::hash_map::DefaultHasher::new();
            // the runtime id is a SAFEARRAY of i32; hashing its pointer would change per call, so
            // hash the element's process + name + control type instead
            let _ = windows::Win32::System::Ole::SafeArrayDestroy(sa);
            el.CurrentProcessId().unwrap_or(0).hash(&mut h);
            el.CurrentName().map(|s| s.to_string()).unwrap_or_default().hash(&mut h);
            el.CurrentControlType().map(|c| c.0).unwrap_or(0).hash(&mut h);
            el.CurrentAutomationId().map(|s| s.to_string()).unwrap_or_default().hash(&mut h);
            h.finish() as usize
        })?;
        let value = el
            .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
            .ok()
            .and_then(|p| p.CurrentValue().ok())
            .map(|b| b.to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                let tp = el.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId).ok()?;
                tp.DocumentRange().ok()?.GetText(200_000).ok().map(|b| b.to_string())
            })?;
        (value.len() < 200_000).then_some((id, value))
    }
}

// ── permissions ─────────────────────────────────────────────────────────────────────────────────

pub fn permissions() -> Permissions {
    let hotkey = HOTKEY_ACTIVE.load(Ordering::SeqCst);
    let mic = mic_allowed();
    // Windows has no Accessibility / Input Monitoring / Screen Recording grants for desktop apps
    let probe = super::WindowsProbe { mic, hotkey_active: hotkey, ocr: ocr_available(), autostart: autostart_enabled() };
    Permissions { microphone: mic, accessibility: true, input_monitoring: hotkey, screen: true, hotkey_active: hotkey, accessibility_stale: false, hotkey_problem: None, checks: super::windows_checks(&probe) }
}

/// Text recognition languages only change in Settings: ask WinRT once a minute, not every poll.
fn ocr_available() -> bool {
    static CACHE: parking_lot::Mutex<Option<(std::time::Instant, bool)>> = parking_lot::Mutex::new(None);
    if let Some((t, v)) = *CACHE.lock() {
        if t.elapsed() < std::time::Duration::from_secs(60) {
            return v;
        }
    }
    let v = has_native_ocr();
    *CACHE.lock() = Some((std::time::Instant::now(), v));
    v
}

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

/// Start at login: a "Flo" value under HKCU\...\Run.
fn autostart_enabled() -> bool {
    use windows::Win32::System::Registry::HKEY_CURRENT_USER;
    reg::Key::open(HKEY_CURRENT_USER, RUN_KEY).and_then(|k| k.string("Flo")).is_some_and(|v| !v.trim().is_empty())
}

fn enable_autostart() -> Result<()> {
    let exe = std::env::current_exe()?;
    let value = format!("\"{}\"", exe.display());
    let ok = std::process::Command::new("reg")
        .args(["add", &format!("HKCU\\{RUN_KEY}"), "/v", "Flo", "/t", "REG_SZ", "/d", &value, "/f"])
        .creation_flags(CREATE_NO_WINDOW)
        .status()?
        .success();
    if !ok {
        return Err(anyhow!("couldn't add Flo to startup apps"));
    }
    Ok(())
}

pub fn open_permission_settings(kind: &str) {
    if kind == "autostart" {
        if let Err(e) = enable_autostart() {
            log::warn!("start at login: {e}");
        }
        return;
    }
    let uri = match kind {
        "microphone" => "ms-settings:privacy-microphone",
        "screen" => "ms-settings:privacy-graphicsCaptureProgrammatic",
        "notifications" => "ms-settings:notifications",
        "ocr" => "ms-settings:regionlanguage",
        _ => "ms-settings:privacy",
    };
    let _ = std::process::Command::new("cmd").args(["/C", "start", "", uri]).creation_flags(CREATE_NO_WINDOW).status();
}

pub fn fix_fn_key() -> Result<String> {
    Ok("Not needed on Windows. Hold Ctrl to dictate, Ctrl + Win for the assistant (change them in Settings).".into())
}

// ── OCR (Windows.Media.Ocr, on-device) ──────────────────────────────────────────────────────────

pub fn ocr(rgba: &[u8], width: u32, height: u32) -> Option<String> {
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;
    if rgba.len() < (width as usize) * (height as usize) * 4 {
        return None;
    }
    // OCR is limited to OcrEngine::MaxImageDimension (10000 px) per side; screens are well under
    let run = || -> windows::core::Result<String> {
        let engine = OcrEngine::TryCreateFromUserProfileLanguages()?;
        let writer = DataWriter::new()?;
        writer.WriteBytes(rgba)?;
        let buffer = writer.DetachBuffer()?;
        let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Rgba8, width as i32, height as i32)?;
        let result = engine.RecognizeAsync(&bitmap)?.join()?;
        let mut lines = Vec::new();
        for line in result.Lines()? {
            lines.push(line.Text()?.to_string());
        }
        Ok(lines.join("\n"))
    };
    run().ok().filter(|t| !t.trim().is_empty())
}

pub fn has_native_ocr() -> bool {
    windows::Media::Ocr::OcrEngine::TryCreateFromUserProfileLanguages().is_ok()
}

/// Seconds since the last keyboard / mouse input (for "away" presence).
pub fn idle_seconds() -> Option<f64> {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut li = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    unsafe {
        if !GetLastInputInfo(&mut li).as_bool() {
            return None;
        }
        Some(GetTickCount().wrapping_sub(li.dwTime) as f64 / 1000.0)
    }
}

// ── media (Global System Media Transport Controls) + volume (Core Audio endpoint) ──────────────

fn media_session() -> windows::core::Result<windows::Media::Control::GlobalSystemMediaTransportControlsSession> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager as Manager;
    Manager::RequestAsync()?.join()?.GetCurrentSession()
}

/// What's playing in any app that reports to Windows' media overlay (Spotify, browsers, players).
pub fn now_playing() -> Option<crate::model::NowPlaying> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status;
    let run = || -> windows::core::Result<Option<crate::model::NowPlaying>> {
        let s = media_session()?;
        let props = s.TryGetMediaPropertiesAsync()?.join()?;
        let title = props.Title()?.to_string();
        if title.is_empty() {
            return Ok(None);
        }
        let playing = s.GetPlaybackInfo()?.PlaybackStatus()? == Status::Playing;
        let tl = s.GetTimelineProperties()?;
        // TimeSpan is in 100 ns ticks
        let secs = |t: windows::Foundation::TimeSpan| t.Duration as f64 / 10_000_000.0;
        let (pos, end) = (secs(tl.Position()?), secs(tl.EndTime()?));
        let app_id = s.SourceAppUserModelId()?.to_string();
        Ok(Some(crate::model::NowPlaying {
            app: super::media_app_name(&app_id),
            title,
            artist: props.Artist()?.to_string(),
            album: props.AlbumTitle()?.to_string(),
            playing,
            elapsed: (end > 0.0).then_some(pos),
            duration: (end > 0.0).then_some(end),
            elapsed_at: Some(chrono::Utc::now().timestamp_millis()),
            bundle_id: Some(app_id),
            ..Default::default()
        }))
    };
    run().ok().flatten()
}

/// play / pause / playpause / next / previous on the current media session.
pub fn media_control(action: &str) -> Result<()> {
    let s = media_session().map_err(|_| anyhow!("Nothing is playing"))?;
    let ok = match action {
        "play" => s.TryPlayAsync(),
        "pause" => s.TryPauseAsync(),
        "playpause" | "toggle" => s.TryTogglePlayPauseAsync(),
        "next" => s.TrySkipNextAsync(),
        "previous" | "prev" => s.TrySkipPreviousAsync(),
        other => return Err(anyhow!("unknown media action {other}")),
    }
    .and_then(|op| op.join())
    .map_err(|e| anyhow!("media control: {e}"))?;
    if !ok {
        return Err(anyhow!("the player didn't accept “{action}”"));
    }
    Ok(())
}

fn endpoint_volume() -> Result<windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume> {
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let dev = en.GetDefaultAudioEndpoint(eRender, eConsole)?;
        Ok(dev.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)?)
    }
}

/// Speaker volume 0–100.
pub fn get_volume() -> Option<u8> {
    let v = endpoint_volume().ok()?;
    let level = unsafe { v.GetMasterVolumeLevelScalar() }.ok()?;
    Some((level * 100.0).round().clamp(0.0, 100.0) as u8)
}

pub fn set_volume(level: u8) -> Result<u8> {
    let level = level.min(100);
    let v = endpoint_volume()?;
    unsafe {
        v.SetMasterVolumeLevelScalar(level as f32 / 100.0, std::ptr::null())?;
        if level > 0 {
            v.SetMute(false, std::ptr::null())?;
        }
    }
    Ok(level)
}

pub fn set_muted(muted: bool) -> Result<()> {
    unsafe { endpoint_volume()?.SetMute(muted, std::ptr::null())? };
    Ok(())
}

/// Escape text for the toast XML.
fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

/// Show a Windows toast notification. Installed builds use Flo's AppUserModelID (the NSIS / MSI
/// installer puts it on the Start-menu shortcut); dev builds borrow PowerShell's, which always exists.
pub fn toast(title: &str, body: &str) -> Result<()> {
    use windows::core::HSTRING;
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};
    const POWERSHELL_ID: &str = r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe";
    let app_id = if cfg!(debug_assertions) { POWERSHELL_ID } else { "com.flo.flow" };
    let xml = format!(
        "<toast><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual></toast>",
        xml_escape(title),
        xml_escape(body)
    );
    let doc = XmlDocument::new()?;
    doc.LoadXml(&HSTRING::from(xml))?;
    let toast = ToastNotification::CreateToastNotification(&doc)?;
    ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))?.Show(&toast)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn exe_stems() {
        assert_eq!(super::exe_stem(r"C:\Program Files\Google\Chrome\Application\chrome.exe"), "chrome");
        assert_eq!(super::exe_stem("Zoom.EXE"), "Zoom");
    }
}
