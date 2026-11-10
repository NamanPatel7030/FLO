//! macOS: CGEventTap (Fn), CGEvent paste, NSWorkspace, notch geometry, NSWindow level, Vision OCR.
#![allow(unexpected_cfgs)]
use super::{FrontApp, HotkeyCallback};
use crate::hotkey::{HotkeyConfig, Machine, Mods};
use crate::model::{IslandGeometry, Permissions};
use anyhow::{anyhow, Result};
use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
use core_graphics::event::{
    CGEvent, CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use objc2_foundation::{NSArray, NSEdgeInsets, NSRect, NSString};
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
    fn CGPreflightListenEventAccess() -> bool;
    fn CGRequestListenEventAccess() -> bool;
    fn CGPreflightPostEventAccess() -> bool;
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
}
#[link(name = "objc")]
extern "C" {
    fn object_setClass(obj: *mut c_void, cls: *const c_void) -> *const c_void;
}

static HOTKEY_ACTIVE: AtomicBool = AtomicBool::new(false);
/// mach port of the active tap, to re-enable it if macOS pauses it (timeout / user input)
static TAP_PORT: std::sync::atomic::AtomicPtr<c_void> = std::sync::atomic::AtomicPtr::new(std::ptr::null_mut());
extern "C" {
    fn CGEventTapEnable(tap: *mut c_void, enable: bool);
}
static HOTKEY_CFG: parking_lot::RwLock<Option<HotkeyConfig>> = parking_lot::RwLock::new(None);

/// Apply the configured push-to-talk combos (takes effect immediately).
pub fn set_hotkeys(cfg: HotkeyConfig) {
    *HOTKEY_CFG.write() = Some(cfg);
}

#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioObjectGetPropertyData(
        id: u32,
        addr: *const AudioAddr,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: *mut u32,
        data: *mut c_void,
    ) -> i32;
}
#[repr(C)]
struct AudioAddr {
    selector: u32,
    scope: u32,
    element: u32,
}
const fn fourcc(s: &[u8; 4]) -> u32 {
    ((s[0] as u32) << 24) | ((s[1] as u32) << 16) | ((s[2] as u32) << 8) | (s[3] as u32)
}

/// Is the default microphone being used by any process right now?
pub fn mic_in_use() -> bool {
    unsafe {
        let glob = fourcc(b"glob");
        let mut dev: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        let a = AudioAddr { selector: fourcc(b"dIn "), scope: glob, element: 0 };
        if AudioObjectGetPropertyData(1, &a, 0, std::ptr::null(), &mut size, &mut dev as *mut u32 as *mut c_void) != 0 || dev == 0 {
            return false;
        }
        let mut running: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        let a = AudioAddr { selector: fourcc(b"gone"), scope: glob, element: 0 };
        AudioObjectGetPropertyData(dev, &a, 0, std::ptr::null(), &mut size, &mut running as *mut u32 as *mut c_void) == 0 && running != 0
    }
}

fn running(pattern: &str, exact: bool) -> bool {
    std::process::Command::new("pgrep")
        .args([if exact { "-x" } else { "-f" }, pattern])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Best guess of which call app is using the mic.
/// Title of the frontmost app's focused window (e.g. "Meet - abc-defg" in Chrome), via AX.
pub fn frontmost_window_title() -> Option<String> {
    let app = frontmost_app();
    if app.pid <= 0 {
        return None;
    }
    unsafe {
        let el = AXUIElementCreateApplication(app.pid);
        if el.is_null() {
            return None;
        }
        AXUIElementSetMessagingTimeout(el, 0.4);
        let win = ax_copy(el, "AXFocusedWindow").or_else(|| ax_copy(el, "AXMainWindow"));
        CFRelease(el as core_foundation::base::CFTypeRef);
        let win = win?;
        let title = ax_copy(win as AXRef, "AXTitle").and_then(|v| cf_to_string(v));
        CFRelease(win);
        title.filter(|t| !t.is_empty())
    }
}

/// Best guess of which call is live. Zoom's media host is the strongest signal; otherwise match the
/// frontmost window title + app name (so browser calls like Google Meet are named correctly) and
/// only attribute a Slack huddle when Slack is actually frontmost.
pub fn detect_call_app() -> String {
    if running("CptHost", true) {
        return "Zoom".into();
    }
    let front = frontmost_app().name;
    let title = frontmost_window_title().unwrap_or_default();
    let hay = format!("{} {}", front, title).to_lowercase();
    for (needle, name) in [
        ("google meet", "Google Meet"),
        ("meet.google", "Google Meet"),
        (" meet ", "Google Meet"),
        ("zoom", "Zoom"),
        ("microsoft teams", "Teams"),
        ("teams", "Teams"),
        ("webex", "Webex"),
        ("whereby", "Whereby"),
        ("google hangouts", "Google Meet"),
        ("facetime", "FaceTime"),
        ("discord", "Discord"),
    ] {
        if hay.contains(needle) {
            return name.into();
        }
    }
    // Slack huddle only when Slack is the active app (a huddle takes focus)
    if front.to_lowercase().contains("slack") {
        return "Slack huddle".into();
    }
    // a browser is frontmost but we can't name the site → generic
    let browser = ["chrome", "safari", "arc", "brave", "edge", "firefox", "vivaldi"].iter().any(|b| front.to_lowercase().contains(b));
    if browser || front.is_empty() {
        "a call".into()
    } else {
        front
    }
}

/// Global cursor position in points (top-left origin) — a single cheap CoreGraphics call,
/// safe off the main thread (no Tauri/AppKit round-trip).
pub fn cursor_location() -> Option<(f64, f64)> {
    let src = CGEventSource::new(CGEventSourceStateID::CombinedSessionState).ok()?;
    let ev = CGEvent::new(src).ok()?;
    let p = ev.location();
    Some((p.x, p.y))
}

/// Pointing-hand cursor while over the island (main thread only).
pub fn set_pointer_cursor() {
    unsafe {
        let c: *mut AnyObject = msg_send![class!(NSCursor), pointingHandCursor];
        if !c.is_null() {
            let _: () = msg_send![c, set];
        }
    }
}

type AXRef = *const c_void;
extern "C" {
    fn AXUIElementCreateSystemWide() -> AXRef;
    fn AXUIElementCreateApplication(pid: i32) -> AXRef;
    fn AXUIElementCopyAttributeValue(el: AXRef, attr: core_foundation::string::CFStringRef, out: *mut core_foundation::base::CFTypeRef) -> i32;
    fn AXUIElementSetMessagingTimeout(el: AXRef, secs: f32) -> i32;
    fn AXUIElementSetAttributeValue(el: AXRef, attr: core_foundation::string::CFStringRef, value: core_foundation::base::CFTypeRef) -> i32;
    fn AXUIElementCopyParameterizedAttributeValue(
        el: AXRef,
        attr: core_foundation::string::CFStringRef,
        param: core_foundation::base::CFTypeRef,
        out: *mut core_foundation::base::CFTypeRef,
    ) -> i32;
    fn AXValueCreate(kind: u32, ptr: *const c_void) -> core_foundation::base::CFTypeRef;
    fn CFHash(cf: core_foundation::base::CFTypeRef) -> usize;
    fn CFRelease(cf: core_foundation::base::CFTypeRef);
}

unsafe fn ax_copy(el: AXRef, attr: &str) -> Option<core_foundation::base::CFTypeRef> {
    use core_foundation::base::TCFType;
    let name = core_foundation::string::CFString::new(attr);
    let mut out: core_foundation::base::CFTypeRef = std::ptr::null();
    (AXUIElementCopyAttributeValue(el, name.as_concrete_TypeRef(), &mut out) == 0 && !out.is_null()).then_some(out)
}

unsafe fn cf_to_string(v: core_foundation::base::CFTypeRef) -> Option<String> {
    use core_foundation::base::{CFType, TCFType};
    let t = CFType::wrap_under_create_rule(v);
    t.downcast::<core_foundation::string::CFString>().map(|s| s.to_string())
}

/// Chromium and Electron apps (Chrome, Slack, Discord, VS Code, Notion…) only build their
/// accessibility tree — and so only expose a text field's value — once an assistive app asks for
/// it with `AXManualAccessibility`. Done once per app (it costs those apps a little memory).
fn enable_app_accessibility(pid: i32) {
    use core_foundation::base::TCFType;
    static DONE: std::sync::OnceLock<parking_lot::Mutex<std::collections::HashSet<i32>>> = std::sync::OnceLock::new();
    if pid <= 0 || !DONE.get_or_init(Default::default).lock().insert(pid) {
        return;
    }
    unsafe {
        let app = AXUIElementCreateApplication(pid);
        if app.is_null() {
            return;
        }
        AXUIElementSetMessagingTimeout(app, 0.3);
        let name = core_foundation::string::CFString::new("AXManualAccessibility");
        let yes = core_foundation::boolean::CFBoolean::true_value();
        AXUIElementSetAttributeValue(app, name.as_concrete_TypeRef(), yes.as_CFTypeRef());
        CFRelease(app as core_foundation::base::CFTypeRef);
    }
}

/// Whole text of a field that has no string `AXValue` (some web/Electron editors), via
/// `AXStringForRange` over `AXNumberOfCharacters`.
unsafe fn ax_text_by_range(el: AXRef) -> Option<String> {
    use core_foundation::base::{CFType, TCFType};
    #[repr(C)]
    struct CFRange {
        location: isize,
        length: isize,
    }
    let n = ax_copy(el, "AXNumberOfCharacters")?;
    let n = CFType::wrap_under_create_rule(n).downcast::<core_foundation::number::CFNumber>().and_then(|n| n.to_i64())?;
    if n <= 0 || n >= 200_000 {
        return None;
    }
    let range = CFRange { location: 0, length: n as isize };
    let param = AXValueCreate(4 /* kAXValueTypeCFRange */, &range as *const CFRange as *const c_void);
    if param.is_null() {
        return None;
    }
    let name = core_foundation::string::CFString::new("AXStringForRange");
    let mut out: core_foundation::base::CFTypeRef = std::ptr::null();
    let ok = AXUIElementCopyParameterizedAttributeValue(el, name.as_concrete_TypeRef(), param, &mut out) == 0 && !out.is_null();
    CFRelease(param);
    if ok {
        cf_to_string(out)
    } else {
        None
    }
}

/// Text of the focused field (identity hash, value). None for secure/password fields.
pub fn focused_text() -> Option<(usize, String)> {
    unsafe {
        let sys = AXUIElementCreateSystemWide();
        if sys.is_null() {
            return None;
        }
        AXUIElementSetMessagingTimeout(sys, 0.5);
        if let Some(app) = ax_copy(sys, "AXFocusedApplication") {
            let mut pid = 0;
            AXUIElementGetPid(app as AXRef, &mut pid);
            CFRelease(app);
            enable_app_accessibility(pid);
        }
        let el = ax_copy(sys, "AXFocusedUIElement");
        CFRelease(sys);
        let el = el?;
        let is_secure = |attr: &str| ax_copy(el, attr).and_then(|v| cf_to_string(v)).map(|s| s == "AXSecureTextField").unwrap_or(false);
        let secure = is_secure("AXSubrole") || is_secure("AXRole");
        let id = CFHash(el);
        let value = if secure { None } else { ax_copy(el, "AXValue").and_then(|v| cf_to_string(v)).or_else(|| ax_text_by_range(el)) };
        CFRelease(el);
        value.filter(|v| v.len() < 200_000).map(|v| (id, v))
    }
}
#[link(name = "Vision", kind = "framework")]
extern "C" {}
#[link(name = "AVFoundation", kind = "framework")]
extern "C" {}

const KEY_V: u16 = 9;
const KEY_C: u16 = 8;

fn post_cmd_key(code: u16) -> Result<()> {
    let src = CGEventSource::new(CGEventSourceStateID::HIDSystemState).map_err(|_| anyhow!("event source"))?;
    let down = CGEvent::new_keyboard_event(src.clone(), code, true).map_err(|_| anyhow!("key event"))?;
    down.set_flags(CGEventFlags::CGEventFlagCommand);
    let up = CGEvent::new_keyboard_event(src, code, false).map_err(|_| anyhow!("key event"))?;
    up.set_flags(CGEventFlags::CGEventFlagCommand);
    down.post(CGEventTapLocation::HID);
    up.post(CGEventTapLocation::HID);
    Ok(())
}

use core_graphics::event::{CGMouseButton, ScrollEventUnit};
use core_graphics::geometry::CGPoint;

/// Move the mouse and left-click at a screen point (logical px, top-left origin).
pub fn click_at(x: f64, y: f64, double: bool) -> Result<()> {
    let src = CGEventSource::new(CGEventSourceStateID::HIDSystemState).map_err(|_| anyhow!("event source"))?;
    let pt = CGPoint::new(x, y);
    let mv = CGEvent::new_mouse_event(src.clone(), CGEventType::MouseMoved, pt, CGMouseButton::Left).map_err(|_| anyhow!("mouse"))?;
    mv.post(CGEventTapLocation::HID);
    std::thread::sleep(std::time::Duration::from_millis(20));
    let do_click = |n: i64| -> Result<()> {
        let down = CGEvent::new_mouse_event(src.clone(), CGEventType::LeftMouseDown, pt, CGMouseButton::Left).map_err(|_| anyhow!("mouse"))?;
        let up = CGEvent::new_mouse_event(src.clone(), CGEventType::LeftMouseUp, pt, CGMouseButton::Left).map_err(|_| anyhow!("mouse"))?;
        down.set_integer_value_field(core_graphics::event::EventField::MOUSE_EVENT_CLICK_STATE, n);
        up.set_integer_value_field(core_graphics::event::EventField::MOUSE_EVENT_CLICK_STATE, n);
        down.post(CGEventTapLocation::HID);
        // a press with zero duration is dropped by some apps (web views, Electron)
        std::thread::sleep(std::time::Duration::from_millis(25));
        up.post(CGEventTapLocation::HID);
        Ok(())
    };
    do_click(1)?;
    if double {
        std::thread::sleep(std::time::Duration::from_millis(40));
        do_click(2)?;
    }
    Ok(())
}

/// May Flo post synthetic mouse / keyboard events? Without this (Accessibility, or the narrower
/// "post events" grant) macOS drops every CGEvent Flo posts, silently: clicks and typing do nothing.
/// An ad-hoc signed update can leave Flo listed as allowed while the grant no longer matches the
/// new build, so this is checked at runtime rather than trusted from the Settings toggle.
pub fn can_post_events() -> bool {
    unsafe { AXIsProcessTrusted() || CGPreflightPostEventAccess() }
}

/// Accessibility roles that `AXPress` activates exactly like a click.
pub fn pressable_role(role: &str) -> bool {
    matches!(
        role,
        "AXButton" | "AXLink" | "AXMenuItem" | "AXMenuBarItem" | "AXCheckBox" | "AXRadioButton" | "AXPopUpButton" | "AXMenuButton" | "AXDisclosureTriangle"
    )
}

extern "C" {
    fn AXUIElementCopyElementAtPosition(app: AXRef, x: f32, y: f32, out: *mut AXRef) -> i32;
    fn AXUIElementPerformAction(el: AXRef, action: core_foundation::string::CFStringRef) -> i32;
    fn AXUIElementGetPid(el: AXRef, pid: *mut i32) -> i32;
}

/// Press the control at a screen point (points, top-left origin) through Accessibility, when the
/// element there (or its parent, e.g. the label inside a button) is a button / link / menu item of
/// another app. Returns the pressed element's role and owning pid, or None when the caller should
/// fall back to a real mouse click (text fields, web content without an accessibility tree, Flo's
/// own windows, or a failed press).
pub fn press_at(x: f64, y: f64) -> Option<(String, i32)> {
    unsafe {
        let sys = AXUIElementCreateSystemWide();
        if sys.is_null() {
            return None;
        }
        AXUIElementSetMessagingTimeout(sys, 0.5);
        let mut hit: AXRef = std::ptr::null();
        let ok = AXUIElementCopyElementAtPosition(sys, x as f32, y as f32, &mut hit) == 0 && !hit.is_null();
        CFRelease(sys);
        if !ok {
            return None;
        }
        let mut pid = 0i32;
        AXUIElementGetPid(hit, &mut pid);
        if pid <= 0 || pid as u32 == std::process::id() {
            CFRelease(hit);
            return None;
        }
        // the element itself, then up to two parents
        let mut el = hit;
        let mut result = None;
        for _ in 0..3 {
            let role = ax_copy(el, "AXRole").and_then(|v| cf_to_string(v)).unwrap_or_default();
            if pressable_role(&role) {
                use core_foundation::base::TCFType;
                let press = core_foundation::string::CFString::new("AXPress");
                if AXUIElementPerformAction(el, press.as_concrete_TypeRef()) == 0 {
                    result = Some((role, pid));
                }
                break;
            }
            let Some(parent) = ax_copy(el, "AXParent") else { break };
            CFRelease(el);
            el = parent as AXRef;
        }
        CFRelease(el);
        result
    }
}

/// Let mouse events pass through a window (or not). Main thread only.
pub fn set_window_ignores_mouse(ns_window: *mut std::ffi::c_void, ignore: bool) {
    if ns_window.is_null() {
        return;
    }
    unsafe {
        let win = ns_window as *mut AnyObject;
        let _: () = msg_send![win, setIgnoresMouseEvents: ignore];
    }
}

/// Type a unicode string wherever the cursor is.
pub fn type_text(text: &str) -> Result<()> {
    let src = CGEventSource::new(CGEventSourceStateID::HIDSystemState).map_err(|_| anyhow!("event source"))?;
    for chunk in text.chars().collect::<Vec<_>>().chunks(20) {
        let s: String = chunk.iter().collect();
        let ev = CGEvent::new_keyboard_event(src.clone(), 0, true).map_err(|_| anyhow!("key"))?;
        ev.set_string(&s);
        ev.post(CGEventTapLocation::HID);
        std::thread::sleep(std::time::Duration::from_millis(6));
    }
    Ok(())
}

/// Press a key by virtual keycode with optional modifiers.
pub fn key_press(keycode: u16, cmd: bool, shift: bool, alt: bool, ctrl: bool) -> Result<()> {
    let src = CGEventSource::new(CGEventSourceStateID::HIDSystemState).map_err(|_| anyhow!("event source"))?;
    let mut flags = CGEventFlags::empty();
    if cmd { flags |= CGEventFlags::CGEventFlagCommand; }
    if shift { flags |= CGEventFlags::CGEventFlagShift; }
    if alt { flags |= CGEventFlags::CGEventFlagAlternate; }
    if ctrl { flags |= CGEventFlags::CGEventFlagControl; }
    let down = CGEvent::new_keyboard_event(src.clone(), keycode, true).map_err(|_| anyhow!("key"))?;
    down.set_flags(flags);
    let up = CGEvent::new_keyboard_event(src, keycode, false).map_err(|_| anyhow!("key"))?;
    up.set_flags(flags);
    down.post(CGEventTapLocation::HID);
    up.post(CGEventTapLocation::HID);
    Ok(())
}

/// Press a keyboard media key (NX_KEYTYPE_PLAY = 16, NEXT = 17, PREVIOUS = 18). macOS delivers it to
/// whatever is playing, exactly like the ⏯ ⏭ ⏮ keys. Needs Accessibility (posting HID events).
pub fn macos_media_key(key: i32) -> bool {
    extern "C" {
        fn CGEventPost(tap: u32, event: *mut std::ffi::c_void);
        fn AXIsProcessTrusted() -> bool;
    }
    if !unsafe { AXIsProcessTrusted() } {
        return false;
    }
    for down in [true, false] {
        // NSEventTypeSystemDefined (14), subtype 8 = media key; data1 = key << 16 | state << 8
        let state: isize = if down { 0xa } else { 0xb };
        let flags: usize = if down { 0xa00 } else { 0xb00 };
        let data1: isize = ((key as isize) << 16) | (state << 8);
        let point = objc2_foundation::NSPoint::new(0.0, 0.0);
        let ctx: *mut AnyObject = std::ptr::null_mut();
        let ev: *mut AnyObject = unsafe {
            msg_send![class!(NSEvent), otherEventWithType: 14usize, location: point, modifierFlags: flags, timestamp: 0.0f64, windowNumber: 0isize, context: ctx, subtype: 8i16, data1: data1, data2: -1isize]
        };
        if ev.is_null() {
            return false;
        }
        let cg: *mut std::ffi::c_void = unsafe { msg_send![ev, CGEvent] };
        if cg.is_null() {
            return false;
        }
        unsafe { CGEventPost(0, cg) }; // kCGHIDEventTap
    }
    true
}

/// Common named keys → virtual keycode.
pub fn keycode_for(name: &str) -> Option<u16> {
    Some(match name.to_lowercase().as_str() {
        "return" | "enter" => 36,
        "tab" => 48,
        "space" => 49,
        "delete" | "backspace" => 51,
        "escape" | "esc" => 53,
        "left" => 123,
        "right" => 124,
        "down" => 125,
        "up" => 126,
        "home" => 115,
        "end" => 119,
        "pageup" => 116,
        "pagedown" => 121,
        // letters / digits (US layout virtual keys), for shortcuts like cmd+L, cmd+T, cmd+F
        "a" => 0, "s" => 1, "d" => 2, "f" => 3, "h" => 4, "g" => 5, "z" => 6, "x" => 7, "c" => 8, "v" => 9,
        "b" => 11, "q" => 12, "w" => 13, "e" => 14, "r" => 15, "y" => 16, "t" => 17,
        "1" => 18, "2" => 19, "3" => 20, "4" => 21, "6" => 22, "5" => 23, "9" => 25, "7" => 26, "8" => 28, "0" => 29,
        "o" => 31, "u" => 32, "i" => 34, "p" => 35, "l" => 37, "j" => 38, "k" => 40, "n" => 45, "m" => 46,
        _ => return None,
    })
}

/// Scroll vertically by `dy` lines (positive = up).
pub fn scroll_by(dy: i32) -> Result<()> {
    let src = CGEventSource::new(CGEventSourceStateID::HIDSystemState).map_err(|_| anyhow!("event source"))?;
    let ev = CGEvent::new_scroll_event(src, ScrollEventUnit::LINE, 1, dy, 0, 0).map_err(|_| anyhow!("scroll"))?;
    ev.post(CGEventTapLocation::HID);
    Ok(())
}

pub fn send_paste_shortcut() -> Result<()> {
    post_cmd_key(KEY_V)
}

pub fn send_copy_shortcut() -> Result<()> {
    post_cmd_key(KEY_C)
}

/// Global push-to-talk listener on its own CFRunLoop thread.
/// Needs Accessibility only: an active event tap from an Accessibility-trusted app receives key
/// events without Input Monitoring (that one only governs listen-only taps). Polls every second and
/// creates the tap the moment the grant appears, so turning the switch on works without restarting
/// Flo. Never asks for Input Monitoring and never tries the tap before a grant (an attempt without
/// one can pop macOS's "Keystroke Receiving" prompt).
pub fn start_hotkeys(cb: HotkeyCallback) {
    let cb: Arc<HotkeyCallback> = Arc::new(cb);
    std::thread::Builder::new()
        .name("flo-hotkey".into())
        .spawn(move || loop {
            let allowed = unsafe { crate::tcc::hotkey_tap_allowed(AXIsProcessTrusted(), CGPreflightListenEventAccess()) };
            if allowed && run_tap(cb.clone()) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_secs(1));
        })
        .ok();
}

/// Returns false if the tap couldn't be created (no permission yet).
fn run_tap(cb: Arc<HotkeyCallback>) -> bool {
    {
        {
            let machine = parking_lot::Mutex::new(Machine::default());
            let tap = CGEventTap::new(
                CGEventTapLocation::Session,
                CGEventTapPlacement::HeadInsertEventTap,
                // active tap (not listen-only) so the Space of ctrl/fn + Space isn't typed into the app
                CGEventTapOptions::Default,
                vec![CGEventType::FlagsChanged, CGEventType::KeyDown],
                move |_proxy, ty, event| {
                    if matches!(ty, CGEventType::TapDisabledByTimeout | CGEventType::TapDisabledByUserInput) {
                        let p = TAP_PORT.load(Ordering::SeqCst);
                        if !p.is_null() {
                            unsafe { CGEventTapEnable(p, true) };
                        }
                        return None;
                    }
                    let ev = match ty {
                        CGEventType::KeyDown => {
                            use core_graphics::event::EventField;
                            let code = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE);
                            let src = event.get_integer_value_field(EventField::EVENT_SOURCE_UNIX_PROCESS_ID);
                            let repeat = event.get_integer_value_field(EventField::KEYBOARD_EVENT_AUTOREPEAT) != 0;
                            if repeat || !crate::hotkey::key_cancels(code, src, std::process::id() as i64) {
                                None
                            } else {
                                let (ev, swallow) = machine.lock().key_down_code(code);
                                if swallow {
                                    event.set_type(CGEventType::Null); // drop the key
                                }
                                ev
                            }
                        }
                        CGEventType::FlagsChanged => {
                            let f = event.get_flags();
                            let mods = Mods {
                                fn_: f.contains(CGEventFlags::CGEventFlagSecondaryFn),
                                ctrl: f.contains(CGEventFlags::CGEventFlagControl),
                                alt: f.contains(CGEventFlags::CGEventFlagAlternate),
                                cmd: f.contains(CGEventFlags::CGEventFlagCommand),
                                shift: f.contains(CGEventFlags::CGEventFlagShift),
                            };
                            let cfg = HOTKEY_CFG.read().unwrap_or_default();
                            machine.lock().update_mods(mods, &cfg)
                        }
                        _ => None,
                    };
                    if let Some(ev) = ev {
                        cb(ev);
                    }
                    None
                },
            );
            match tap {
                Ok(tap) => unsafe {
                    {
                        use core_foundation::base::TCFType;
                        TAP_PORT.store(tap.mach_port.as_concrete_TypeRef() as *mut c_void, Ordering::SeqCst);
                    }
                    let src = tap.mach_port.create_runloop_source(0).expect("runloop source");
                    CFRunLoop::get_current().add_source(&src, kCFRunLoopCommonModes);
                    tap.enable();
                    HOTKEY_ACTIVE.store(true, Ordering::SeqCst);
                    log::info!("fn hotkey listener running");
                    CFRunLoop::run_current();
                    HOTKEY_ACTIVE.store(false, Ordering::SeqCst);
                    true
                },
                Err(_) => {
                    log::warn!("fn listener not allowed yet, waiting for Accessibility");
                    false
                }
            }
        }
    }
}

pub fn frontmost_app() -> FrontApp {
    unsafe {
        let ws: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
        let app: *mut AnyObject = msg_send![ws, frontmostApplication];
        if app.is_null() {
            return FrontApp::default();
        }
        let name: *mut NSString = msg_send![app, localizedName];
        let pid: i32 = msg_send![app, processIdentifier];
        FrontApp { name: if name.is_null() { String::new() } else { (*name).to_string() }, pid }
    }
}

pub fn activate_app(pid: i32) {
    if pid <= 0 || pid as u32 == std::process::id() {
        return;
    }
    unsafe {
        let app: *mut AnyObject = msg_send![class!(NSRunningApplication), runningApplicationWithProcessIdentifier: pid];
        if !app.is_null() {
            let _: bool = msg_send![app, activateWithOptions: 2usize];
        }
    }
}

/// `open -b <bundle> [path]` — activates the app; with a folder, editors focus that project window.
pub fn open_bundle(bundle: &str, path: Option<&str>) -> Result<()> {
    let mut c = std::process::Command::new("open");
    c.arg("-b").arg(bundle);
    if let Some(p) = path {
        c.arg(p);
    }
    if !c.status()?.success() {
        return Err(anyhow!("couldn't open {bundle}"));
    }
    Ok(())
}

pub fn open_app(name: &str) -> Result<()> {
    let st = std::process::Command::new("open").arg("-a").arg(name).status()?;
    if !st.success() {
        return Err(anyhow!("couldn't find an app called “{name}”"));
    }
    Ok(())
}

/// Must run on the main thread.
pub fn island_geometry() -> IslandGeometry {
    unsafe {
        let screens: *mut NSArray<AnyObject> = msg_send![class!(NSScreen), screens];
        let count: usize = if screens.is_null() { 0 } else { msg_send![screens, count] };
        if count == 0 {
            return IslandGeometry { platform: "macos".into(), has_notch: false, notch_width: 200.0, notch_height: 32.0, screen_width: 1440.0 };
        }
        // screens[0] is the one with the menu bar
        let s: *mut AnyObject = msg_send![screens, objectAtIndex: 0usize];
        let frame: NSRect = msg_send![s, frame];
        let insets: NSEdgeInsets = msg_send![s, safeAreaInsets];
        let has_notch = insets.top > 0.0;
        let (notch_w, notch_h) = if has_notch {
            let left: NSRect = msg_send![s, auxiliaryTopLeftArea];
            let right: NSRect = msg_send![s, auxiliaryTopRightArea];
            (frame.size.width - left.size.width - right.size.width, insets.top)
        } else {
            // menu bar height on non-notched displays
            let visible: NSRect = msg_send![s, visibleFrame];
            let mb = (frame.size.height - visible.size.height - visible.origin.y + frame.origin.y).max(24.0);
            (200.0, mb)
        };
        IslandGeometry { platform: "macos".into(), has_notch, notch_width: notch_w, notch_height: notch_h, screen_width: frame.size.width }
    }
}

/// Float the island above the menu bar, on every Space, never in Cmd-Tab. Main thread only.
pub fn configure_island(ns_window: *mut c_void) {
    if ns_window.is_null() {
        return;
    }
    unsafe {
        // Non-activating NSPanel: shows over full-screen apps and never steals keyboard focus
        // from the text field you're dictating into.
        object_setClass(ns_window, class!(NSPanel) as *const _ as *const c_void);
        let w = ns_window as *mut AnyObject;
        let mask: usize = msg_send![w, styleMask];
        let _: () = msg_send![w, setStyleMask: mask | (1usize << 7)]; // NonactivatingPanel
        let _: () = msg_send![w, setFloatingPanel: true];
        let _: () = msg_send![w, setBecomesKeyOnlyIfNeeded: true];
        let _: () = msg_send![w, setHidesOnDeactivate: false];
        let _: () = msg_send![w, setWorksWhenModal: true];
        let _: () = msg_send![w, setLevel: 27isize]; // > NSMainMenuWindowLevel (24)
        let behavior: usize = (1 << 0) | (1 << 4) | (1 << 6) | (1 << 8); // allSpaces|stationary|ignoresCycle|fullScreenAux
        let _: () = msg_send![w, setCollectionBehavior: behavior];
        let _: () = msg_send![w, setHasShadow: false];
        let _: () = msg_send![w, setMovable: false];
    }
}

/// Top-left origin (logical px) for the island so it hangs from the notch.
/// Move AND resize a window in ONE native call. Doing it as set_size + set_position leaves a frame
/// where the window has its new size at its old spot, so the centred notch visibly jumps sideways.
/// `x`, `top` are global top-left coordinates (points); must run on the main thread.
pub fn set_frame_atomic(ns_window: *mut std::ffi::c_void, x: f64, top: f64, w: f64, h: f64) -> bool {
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    if ns_window.is_null() {
        return false;
    }
    unsafe {
        let win = ns_window as *mut AnyObject;
        let screens: *mut AnyObject = msg_send![class!(NSScreen), screens];
        if screens.is_null() {
            return false;
        }
        let count: usize = msg_send![screens, count];
        if count == 0 {
            return false;
        }
        // Cocoa's origin is the bottom-left of the PRIMARY screen; flip the top-left y
        let primary: *mut AnyObject = msg_send![screens, objectAtIndex: 0usize];
        let pf: NSRect = msg_send![primary, frame];
        let frame = NSRect::new(NSPoint::new(x, pf.size.height - top - h), NSSize::new(w, h));
        let _: () = msg_send![win, setFrame: frame, display: objc2::runtime::Bool::YES];
    }
    true
}

/// Fade a window fully in/out instantly (0.0–1.0). An alpha-0 window isn't composited, so it's
/// absent from screenshots, and nothing moves or re-lays out. Must run on the main thread.
pub fn set_window_alpha(ns_window: *mut std::ffi::c_void, alpha: f64) {
    if ns_window.is_null() {
        return;
    }
    unsafe {
        let win = ns_window as *mut AnyObject;
        let _: () = msg_send![win, setAlphaValue: alpha];
    }
}

pub fn island_position(geo: &IslandGeometry, width: f64, _height: f64) -> (f64, f64) {
    ((geo.screen_width - width) / 2.0, 0.0)
}

/// Raw values of every permission probe, as seen from inside Flo's own process.
pub fn diagnostics() -> serde_json::Value {
    unsafe {
        let cls = objc2::runtime::AnyClass::get(c"AVCaptureDevice");
        let mic_raw: isize = match cls {
            Some(c) => {
                let media = NSString::from_str("soun");
                msg_send![c, authorizationStatusForMediaType: &*media]
            }
            None => -1,
        };
        serde_json::json!({
            "exe": std::env::current_exe().ok().map(|p| p.display().to_string()),
            "avcapture_class_loaded": cls.is_some(),
            "mic_status_raw(0=notDetermined,1=restricted,2=denied,3=authorized)": mic_raw,
            "AXIsProcessTrusted": AXIsProcessTrusted(),
            "CGPreflightListenEventAccess": CGPreflightListenEventAccess(),
            "CGPreflightPostEventAccess": CGPreflightPostEventAccess(),
            "CGPreflightScreenCaptureAccess": CGPreflightScreenCaptureAccess(),
        })
    }
}

#[link(name = "proc", kind = "dylib")]
extern "C" {
    fn proc_pidpath(pid: i32, buffer: *mut u8, buffersize: u32) -> i32;
}

fn pid_path(pid: i32) -> Option<String> {
    let mut buf = vec![0u8; 4096];
    let n = unsafe { proc_pidpath(pid, buf.as_mut_ptr(), buf.len() as u32) };
    (n > 0).then(|| String::from_utf8_lossy(&buf[..n as usize]).to_string())
}

fn parent_pid(pid: i32) -> Option<i32> {
    let out = std::process::Command::new("ps").args(["-o", "ppid=", "-p", &pid.to_string()]).output().ok()?;
    String::from_utf8_lossy(&out.stdout).trim().parse().ok()
}

/// Walk up from `pid` to the GUI app hosting it (outermost `.app`), e.g.
/// "/Applications/Visual Studio Code.app" or "/System/Applications/Utilities/Terminal.app".
pub fn host_app_of(pid: i32) -> Option<String> {
    let mut p = pid;
    for _ in 0..24 {
        if p <= 1 {
            break;
        }
        if let Some(path) = pid_path(p) {
            if let Some(i) = path.find(".app/") {
                return Some(path[..i + 4].to_string());
            }
        }
        p = parent_pid(p)?;
    }
    None
}

/// First running editor / terminal, used when an event doesn't know where it came from.
pub fn running_dev_app() -> Option<String> {
    const CANDIDATES: &[&str] = &[
        "/Applications/Cursor.app",
        "/Applications/Visual Studio Code.app",
        "/Applications/Windsurf.app",
        "/Applications/Zed.app",
        "/Applications/iTerm.app",
        "/Applications/Warp.app",
        "/Applications/Ghostty.app",
        "/System/Applications/Utilities/Terminal.app",
    ];
    CANDIDATES.iter().find(|app| {
        std::process::Command::new("pgrep")
            .args(["-f", &format!("{app}/Contents/MacOS/")])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }).map(|s| s.to_string())
}

fn hs_cli() -> Option<&'static str> {
    ["/opt/homebrew/bin/hs", "/usr/local/bin/hs"].into_iter().find(|p| std::path::Path::new(p).exists())
}

/// Focus the app's existing window for this session (Hammerspoon if available), otherwise just
/// bring the app forward. Never opens a new window.
pub fn focus_session_window(app: &str, names: &[String]) -> Result<String> {
    if let Some(hs) = hs_cli() {
        let script = crate::claude::hammerspoon_focus_script(app, names);
        if let Ok(out) = std::process::Command::new(hs).args(["-t", "6", "-c", &script]).output() {
            let text = String::from_utf8_lossy(&out.stdout);
            if out.status.success() {
                if let Some(last) = text.lines().rev().find(|l| !l.starts_with("-- ")) {
                    return Ok(last.trim().to_string());
                }
            }
            log::warn!("hammerspoon focus failed: {}", String::from_utf8_lossy(&out.stderr));
        }
    }
    // no Hammerspoon: activate the app only (no folder → no new window)
    if app.starts_with('/') {
        open_app_path(app, None)?;
    } else {
        open_bundle(app, None)?;
    }
    Ok("activated".into())
}

/// `open -a <app path> [folder]`
pub fn open_app_path(app: &str, path: Option<&str>) -> Result<()> {
    let mut c = std::process::Command::new("open");
    c.arg("-a").arg(app);
    if let Some(p) = path {
        c.arg(p);
    }
    if !c.status()?.success() {
        return Err(anyhow!("couldn't open {app}"));
    }
    Ok(())
}

pub fn permissions() -> Permissions {
    let mic = mic_status() == 3;
    let ax = unsafe { AXIsProcessTrusted() };
    unsafe {
        Permissions {
            microphone: mic,
            accessibility: ax,
            input_monitoring: CGPreflightListenEventAccess(),
            screen: CGPreflightScreenCaptureAccess(),
            hotkey_active: HOTKEY_ACTIVE.load(Ordering::SeqCst),
            accessibility_stale: crate::tcc::accessibility_stale(ax),
            hotkey_problem: None,
        }
    }
}

/// 0 = not determined, 1 = restricted, 2 = denied, 3 = authorized.
fn mic_status() -> isize {
    unsafe {
        let media = NSString::from_str("soun");
        msg_send![class!(AVCaptureDevice), authorizationStatusForMediaType: &*media]
    }
}

/// Ask macOS to trust Flo for Accessibility: shows the system dialog ("Open System Settings") and
/// adds Flo to the list, so the person only flips one switch.
pub fn prompt_accessibility() -> bool {
    unsafe {
        let key = NSString::from_str("AXTrustedCheckOptionPrompt");
        let yes: Retained<AnyObject> = msg_send![class!(NSNumber), numberWithBool: true];
        let dict: Retained<AnyObject> = msg_send![class!(NSDictionary), dictionaryWithObject: &*yes, forKey: &*key];
        AXIsProcessTrustedWithOptions(Retained::as_ptr(&dict) as *const c_void)
    }
}

pub fn accessibility_trusted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

/// One-click fix for a stale grant (after an update the switch looks on but no longer applies):
/// clear Flo's Accessibility record only, then ask again. No relaunch: the key listener polls and
/// starts as soon as the new grant lands.
pub fn reset_accessibility(bundle_id: &str) -> Result<()> {
    let st = std::process::Command::new("/usr/bin/tccutil").args(["reset", "Accessibility", bundle_id]).status()?;
    if !st.success() {
        return Err(anyhow!("tccutil failed"));
    }
    crate::tcc::clear_marker();
    open_permission_settings("accessibility");
    Ok(())
}

pub fn request_microphone() {
    unsafe {
        let media = NSString::from_str("soun");
        let st: isize = msg_send![class!(AVCaptureDevice), authorizationStatusForMediaType: &*media];
        if st == 0 {
            // NotDetermined → opening the mic triggers the system prompt
            if let Ok(r) = crate::audio::Recorder::start(|_| {}) {
                std::thread::sleep(std::time::Duration::from_millis(200));
                let _ = r.stop();
            }
        }
    }
}

pub fn open_permission_settings(kind: &str) {
    let pane = match kind {
        "accessibility" => {
            if prompt_accessibility() {
                return; // already trusted
            }
            "Privacy_Accessibility"
        }
        "input" => {
            unsafe { CGRequestListenEventAccess() };
            "Privacy_ListenEvent"
        }
        "screen" => {
            unsafe { CGRequestScreenCaptureAccess() };
            "Privacy_ScreenCapture"
        }
        "microphone" => match mic_status() {
            // not asked yet: macOS's own one-click prompt is all it takes, no System Settings
            0 => {
                request_microphone();
                return;
            }
            3 => return,
            _ => "Privacy_Microphone",
        },
        _ => "Privacy",
    };
    let _ = std::process::Command::new("open")
        .arg(format!("x-apple.systempreferences:com.apple.preference.security?{pane}"))
        .status();
}

/// Set "Press 🌐 key to: Do Nothing" so holding Fn doesn't open emoji/dictation.
pub fn fix_fn_key() -> Result<String> {
    let st = std::process::Command::new("defaults")
        .args(["write", "com.apple.HIToolbox", "AppleFnUsageType", "-int", "0"])
        .status()?;
    if !st.success() {
        return Err(anyhow!("couldn't update the Globe key setting"));
    }
    Ok("Globe/Fn key set to “Do Nothing”. If the emoji picker still appears, log out and back in once.".into())
}

/// On-device OCR with Apple Vision. `rgba` is width*height*4 bytes.
pub fn ocr(rgba: &[u8], width: u32, height: u32) -> Option<String> {
    use core_graphics::base::{kCGImageAlphaPremultipliedLast, kCGRenderingIntentDefault};
    use core_graphics::color_space::CGColorSpace;
    use core_graphics::data_provider::CGDataProvider;
    use core_graphics::image::CGImage;
    use foreign_types::ForeignType;

    let provider = CGDataProvider::from_buffer(std::sync::Arc::new(rgba.to_vec()));
    let img = CGImage::new(
        width as usize,
        height as usize,
        8,
        32,
        width as usize * 4,
        &CGColorSpace::create_device_rgb(),
        kCGImageAlphaPremultipliedLast,
        &provider,
        false,
        kCGRenderingIntentDefault,
    );
    unsafe {
        let handler: *mut AnyObject = msg_send![class!(VNImageRequestHandler), alloc];
        let empty: Retained<AnyObject> = msg_send![class!(NSDictionary), dictionary];
        let handler: *mut AnyObject = msg_send![handler, initWithCGImage: img.as_ptr() as *mut c_void, options: &*empty];
        if handler.is_null() {
            return None;
        }
        let req: *mut AnyObject = msg_send![class!(VNRecognizeTextRequest), new];
        let _: () = msg_send![req, setRecognitionLevel: 0isize]; // accurate
        let _: () = msg_send![req, setUsesLanguageCorrection: true];
        let _: () = msg_send![req, setAutomaticallyDetectsLanguage: true];
        let reqs: Retained<AnyObject> = msg_send![class!(NSArray), arrayWithObject: req];
        let mut err: *mut AnyObject = std::ptr::null_mut();
        let ok: bool = msg_send![handler, performRequests: &*reqs, error: &mut err];
        let mut out = String::new();
        if ok {
            let results: *mut AnyObject = msg_send![req, results];
            if !results.is_null() {
                let n: usize = msg_send![results, count];
                for i in 0..n {
                    let obs: *mut AnyObject = msg_send![results, objectAtIndex: i];
                    let cands: *mut AnyObject = msg_send![obs, topCandidates: 1usize];
                    let cn: usize = if cands.is_null() { 0 } else { msg_send![cands, count] };
                    if cn > 0 {
                        let c: *mut AnyObject = msg_send![cands, objectAtIndex: 0usize];
                        let s: *mut NSString = msg_send![c, string];
                        if !s.is_null() {
                            out.push_str(&(*s).to_string());
                            out.push('\n');
                        }
                    }
                }
            }
        }
        let _: () = msg_send![req, release];
        let _: () = msg_send![handler, release];
        if out.trim().is_empty() {
            None
        } else {
            Some(out)
        }
    }
}

pub fn has_native_ocr() -> bool {
    true
}
