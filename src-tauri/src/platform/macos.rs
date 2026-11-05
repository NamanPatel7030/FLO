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
    fn CGRequestPostEventAccess() -> bool;
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
}
#[link(name = "objc")]
extern "C" {
    fn object_setClass(obj: *mut c_void, cls: *const c_void) -> *const c_void;
}

static HOTKEY_ACTIVE: AtomicBool = AtomicBool::new(false);
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
pub fn detect_call_app() -> String {
    if running("CptHost", true) {
        return "Zoom".into();
    }
    for (pat, name) in [
        ("MSTeams", "Teams"),
        ("Microsoft Teams", "Teams"),
        ("FaceTime", "FaceTime"),
        ("Webex", "Webex"),
        ("Slack", "Slack huddle"),
        ("Discord", "Discord"),
        ("zoom.us", "Zoom"),
    ] {
        if running(pat, true) {
            return name.into();
        }
    }
    "Google Meet".into()
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
    fn AXUIElementCopyAttributeValue(el: AXRef, attr: core_foundation::string::CFStringRef, out: *mut core_foundation::base::CFTypeRef) -> i32;
    fn AXUIElementSetMessagingTimeout(el: AXRef, secs: f32) -> i32;
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

/// Text of the focused field (identity hash, value). None for secure/password fields.
pub fn focused_text() -> Option<(usize, String)> {
    unsafe {
        let sys = AXUIElementCreateSystemWide();
        if sys.is_null() {
            return None;
        }
        AXUIElementSetMessagingTimeout(sys, 0.5);
        let el = ax_copy(sys, "AXFocusedUIElement");
        CFRelease(sys);
        let el = el?;
        let secure = ax_copy(el, "AXSubrole").and_then(|v| cf_to_string(v)).map(|s| s == "AXSecureTextField").unwrap_or(false);
        let id = CFHash(el);
        let value = if secure { None } else { ax_copy(el, "AXValue").and_then(|v| cf_to_string(v)) };
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

pub fn send_paste_shortcut() -> Result<()> {
    post_cmd_key(KEY_V)
}

pub fn send_copy_shortcut() -> Result<()> {
    post_cmd_key(KEY_C)
}

/// Global push-to-talk listener on its own CFRunLoop thread.
/// Needs Input Monitoring; retries every 2 s until macOS lets us create the tap, so granting the
/// permission works without restarting Flo.
pub fn start_hotkeys(cb: HotkeyCallback) {
    let cb: Arc<HotkeyCallback> = Arc::new(cb);
    std::thread::Builder::new()
        .name("flo-hotkey".into())
        .spawn(move || {
            let mut asked = false;
            loop {
                if unsafe { CGPreflightListenEventAccess() } || asked {
                    if run_tap(cb.clone()) {
                        return;
                    }
                } else {
                    unsafe { CGRequestListenEventAccess() };
                    asked = true;
                }
                std::thread::sleep(std::time::Duration::from_secs(2));
            }
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
                CGEventTapOptions::ListenOnly,
                vec![CGEventType::FlagsChanged, CGEventType::KeyDown],
                move |_proxy, ty, event| {
                    let ev = match ty {
                        CGEventType::KeyDown => machine.lock().key_down(),
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
                    log::warn!("fn listener not allowed yet — waiting for Input Monitoring permission");
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
    let mic = unsafe {
        let media = NSString::from_str("soun");
        let st: isize = msg_send![class!(AVCaptureDevice), authorizationStatusForMediaType: &*media];
        st == 3
    };
    unsafe {
        Permissions {
            microphone: mic,
            accessibility: AXIsProcessTrusted(),
            input_monitoring: CGPreflightListenEventAccess(),
            screen: CGPreflightScreenCaptureAccess(),
            hotkey_active: HOTKEY_ACTIVE.load(Ordering::SeqCst),
        }
    }
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
            unsafe {
                // system prompt + adds Flo to the Accessibility list
                let key = NSString::from_str("AXTrustedCheckOptionPrompt");
                let yes: Retained<AnyObject> = msg_send![class!(NSNumber), numberWithBool: true];
                let dict: Retained<AnyObject> = msg_send![class!(NSDictionary), dictionaryWithObject: &*yes, forKey: &*key];
                AXIsProcessTrustedWithOptions(Retained::as_ptr(&dict) as *const c_void);
                CGRequestPostEventAccess();
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
        "microphone" => {
            request_microphone();
            "Privacy_Microphone"
        }
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
