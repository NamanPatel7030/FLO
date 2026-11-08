//! Call audio ("the other side of the meeting") captured separately from the microphone.
//!
//! macOS 14.2+: a Core Audio **process tap** (`AudioHardwareCreateProcessTap`) — the same
//! mechanism bot-free note takers (Fathom's desktop app, Granola) use. We build a *global* tap
//! that excludes Flo's own process (so it hears Zoom / Meet in any browser / Teams / Slack /
//! FaceTime without guessing helper processes), wrap it in a private aggregate device and read it
//! with an IOProc. The tap is un-muted: the user still hears the call. Needs
//! `NSAudioCaptureUsageDescription` in Info.plist; macOS asks the user once
//! ("System Audio Recording Only"), much lighter than Screen Recording.
//!
//! Anything unavailable (older macOS, denied permission, tap/aggregate failure, other OS) is an
//! `Err` with a human-readable reason → the meeting falls back to mic-only.
use crate::audio::{self, TARGET_RATE};
use anyhow::{anyhow, Result};
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Kill switch (tests; `FLO_NO_CALL_AUDIO=1` for users who want mic-only meetings).
static FORCE_OFF: AtomicBool = AtomicBool::new(false);

/// Samples captured since the last `take_samples`, at the device rate (mono).
struct Buf {
    data: Vec<f32>,
    rate: u32,
    /// any non-zero sample ever seen (a fully-zero tap usually means permission was refused)
    nonzero: bool,
}

pub struct SystemTap {
    buf: Arc<Mutex<Buf>>,
    #[cfg(target_os = "macos")]
    inner: Option<mac::Tap>,
}

impl SystemTap {
    /// Start capturing all system audio except Flo's own output.
    pub fn start() -> Result<Self> {
        if FORCE_OFF.load(Ordering::Relaxed) || std::env::var_os("FLO_NO_CALL_AUDIO").is_some() {
            return Err(anyhow!("Call audio capture is turned off"));
        }
        let buf = Arc::new(Mutex::new(Buf { data: Vec::new(), rate: TARGET_RATE, nonzero: false }));
        #[cfg(target_os = "macos")]
        {
            let inner = mac::Tap::start(buf.clone())?;
            Ok(Self { buf, inner: Some(inner) })
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = buf;
            Err(anyhow!("Call audio capture is only available on macOS 14.2 or later"))
        }
    }

    /// Drain everything captured so far, as 16 kHz mono.
    pub fn take_samples(&self) -> Vec<f32> {
        let mut b = self.buf.lock();
        let raw = std::mem::take(&mut b.data);
        audio::resample(&raw, b.rate, TARGET_RATE)
    }

    /// True once any non-silent sample arrived.
    pub fn heard_anything(&self) -> bool {
        self.buf.lock().nonzero
    }

    pub fn stop(mut self) -> Vec<f32> {
        #[cfg(target_os = "macos")]
        if let Some(t) = self.inner.take() {
            t.stop();
        }
        self.take_samples()
    }
}

impl Drop for SystemTap {
    fn drop(&mut self) {
        #[cfg(target_os = "macos")]
        if let Some(t) = self.inner.take() {
            t.stop();
        }
    }
}

/// Push interleaved/planar float frames (already downmixed by the caller) into the buffer.
fn push(buf: &Mutex<Buf>, mono: &[f32]) {
    let mut b = buf.lock();
    if !b.nonzero && mono.iter().any(|x| *x != 0.0) {
        b.nonzero = true;
    }
    // cap at ~2 min of 48 kHz audio if nobody drains (should never happen in a meeting)
    if b.data.len() < 48_000 * 120 {
        b.data.extend_from_slice(mono);
    }
}

/// Downmix `n_buffers` float buffers (interleaved when 1 buffer, planar when several) to mono.
/// `bufs[i] = (channels_in_buffer, samples)`.
pub(crate) fn downmix(bufs: &[(usize, &[f32])]) -> Vec<f32> {
    let Some(&(ch0, first)) = bufs.first() else { return vec![] };
    let ch0 = ch0.max(1);
    let frames = first.len() / ch0;
    let total_ch: usize = bufs.iter().map(|(c, _)| (*c).max(1)).sum();
    let mut out = vec![0.0f32; frames];
    for (ch, data) in bufs {
        let ch = (*ch).max(1);
        for (i, o) in out.iter_mut().enumerate() {
            for c in 0..ch {
                if let Some(v) = data.get(i * ch + c) {
                    *o += *v;
                }
            }
        }
    }
    let k = 1.0 / total_ch as f32;
    out.iter_mut().for_each(|x| *x *= k);
    out
}

/// `--tap-probe <seconds> <out.wav>`: record system audio for N seconds, write a 16 kHz WAV and a
/// `<out.wav>.json` report (rms, samples, error). For verifying the tap on a real Mac.
pub fn probe(secs: f32, out: &str) {
    let report = match SystemTap::start() {
        Ok(tap) => {
            std::thread::sleep(std::time::Duration::from_secs_f32(secs.clamp(1.0, 600.0)));
            let heard = tap.heard_anything();
            let s = tap.stop();
            let wav = audio::encode_wav(&s, TARGET_RATE).unwrap_or_default();
            let _ = std::fs::write(out, wav);
            serde_json::json!({ "ok": true, "seconds": s.len() as f32 / TARGET_RATE as f32, "rms": audio::rms(&s),
                "voicedMs": audio::voiced_ms(&s), "heardAnything": heard, "wav": out })
        }
        Err(e) => serde_json::json!({ "ok": false, "error": e.to_string() }),
    };
    let txt = serde_json::to_string_pretty(&report).unwrap_or_default();
    println!("{txt}");
    let _ = std::fs::write(format!("{out}.json"), txt);
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{push, Buf};
    use anyhow::{anyhow, bail, Result};
    use core_foundation::array::CFArray;
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::{CFString, CFStringRef};
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::{class, msg_send};
    use objc2_foundation::NSString;
    use parking_lot::Mutex;
    use std::ffi::{c_char, c_void, CStr};
    use std::sync::Arc;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Addr {
        selector: u32,
        scope: u32,
        element: u32,
    }

    #[repr(C)]
    #[derive(Clone, Copy, Default, Debug)]
    struct Asbd {
        sample_rate: f64,
        format_id: u32,
        format_flags: u32,
        bytes_per_packet: u32,
        frames_per_packet: u32,
        bytes_per_frame: u32,
        channels_per_frame: u32,
        bits_per_channel: u32,
        reserved: u32,
    }

    #[repr(C)]
    struct AudioBuffer {
        channels: u32,
        bytes: u32,
        data: *mut c_void,
    }

    #[repr(C)]
    struct AudioBufferList {
        count: u32,
        buffers: [AudioBuffer; 1],
    }

    type IoProc = extern "C" fn(u32, *const c_void, *const AudioBufferList, *const c_void, *mut AudioBufferList, *const c_void, *mut c_void) -> i32;
    type IoProcId = Option<IoProc>;

    #[link(name = "CoreAudio", kind = "framework")]
    extern "C" {
        fn AudioObjectGetPropertyData(id: u32, addr: *const Addr, qsize: u32, qdata: *const c_void, size: *mut u32, data: *mut c_void) -> i32;
        fn AudioHardwareCreateAggregateDevice(desc: *const c_void, out: *mut u32) -> i32;
        fn AudioHardwareDestroyAggregateDevice(id: u32) -> i32;
        fn AudioDeviceCreateIOProcID(dev: u32, proc_: IoProc, client: *mut c_void, out: *mut IoProcId) -> i32;
        fn AudioDeviceDestroyIOProcID(dev: u32, id: IoProcId) -> i32;
        fn AudioDeviceStart(dev: u32, id: IoProcId) -> i32;
        fn AudioDeviceStop(dev: u32, id: IoProcId) -> i32;
    }

    extern "C" {
        fn dlopen(path: *const c_char, mode: i32) -> *mut c_void;
        fn dlsym(handle: *mut c_void, sym: *const c_char) -> *mut c_void;
        fn getpid() -> i32;
    }
    const RTLD_LAZY: i32 = 1;

    type CreateTapFn = unsafe extern "C" fn(*mut AnyObject, *mut u32) -> i32;
    type DestroyTapFn = unsafe extern "C" fn(u32) -> i32;
    type TccPreflightFn = unsafe extern "C" fn(CFStringRef, *const c_void) -> i32;

    const fn fourcc(c: &[u8; 4]) -> u32 {
        ((c[0] as u32) << 24) | ((c[1] as u32) << 16) | ((c[2] as u32) << 8) | c[3] as u32
    }
    const GLOB: u32 = fourcc(b"glob");
    const SYSTEM_OBJECT: u32 = 1;
    const FLOAT_FLAG: u32 = 1; // kAudioFormatFlagIsFloat

    fn sym(lib: &CStr, name: &CStr) -> *mut c_void {
        unsafe {
            let h = dlopen(lib.as_ptr(), RTLD_LAZY);
            if h.is_null() {
                return std::ptr::null_mut();
            }
            dlsym(h, name.as_ptr())
        }
    }

    const CORE_AUDIO: &CStr = c"/System/Library/Frameworks/CoreAudio.framework/CoreAudio";

    /// 0 = granted, 1 = denied, anything else = not decided yet (macOS asks on first use).
    /// `TCCAccessPreflight` is private SPI; when it's missing we just try.
    fn audio_capture_preflight() -> Option<i32> {
        let f = sym(c"/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC", c"TCCAccessPreflight");
        if f.is_null() {
            return None;
        }
        let f: TccPreflightFn = unsafe { std::mem::transmute(f) };
        let svc = CFString::new("kTCCServiceAudioCapture");
        Some(unsafe { f(svc.as_concrete_TypeRef(), std::ptr::null()) })
    }

    fn get<T: Default>(id: u32, selector: &[u8; 4], qualifier: Option<&i32>) -> Result<T> {
        let a = Addr { selector: fourcc(selector), scope: GLOB, element: 0 };
        let mut v = T::default();
        let mut size = std::mem::size_of::<T>() as u32;
        let (qs, qd) = match qualifier {
            Some(q) => (4u32, q as *const i32 as *const c_void),
            None => (0, std::ptr::null()),
        };
        let st = unsafe { AudioObjectGetPropertyData(id, &a, qs, qd, &mut size, &mut v as *mut T as *mut c_void) };
        if st != 0 {
            bail!("CoreAudio property {} failed ({st})", String::from_utf8_lossy(selector));
        }
        Ok(v)
    }

    fn default_output_uid() -> Option<CFString> {
        let dev: u32 = get(SYSTEM_OBJECT, b"dOut", None).ok()?;
        if dev == 0 {
            return None;
        }
        let a = Addr { selector: fourcc(b"uid "), scope: GLOB, element: 0 };
        let mut s: CFStringRef = std::ptr::null();
        let mut size = std::mem::size_of::<CFStringRef>() as u32;
        let st = unsafe { AudioObjectGetPropertyData(dev, &a, 0, std::ptr::null(), &mut size, &mut s as *mut CFStringRef as *mut c_void) };
        (st == 0 && !s.is_null()).then(|| unsafe { CFString::wrap_under_create_rule(s) })
    }

    struct Ctx {
        buf: Arc<Mutex<Buf>>,
    }

    extern "C" fn io_proc(_dev: u32, _now: *const c_void, input: *const AudioBufferList, _t: *const c_void, _out: *mut AudioBufferList, _ot: *const c_void, client: *mut c_void) -> i32 {
        if input.is_null() || client.is_null() {
            return 0;
        }
        unsafe {
            let ctx = &*(client as *const Ctx);
            let n = (*input).count as usize;
            if n == 0 {
                return 0;
            }
            let first = (*input).buffers.as_ptr();
            let mut bufs: Vec<(usize, &[f32])> = Vec::with_capacity(n);
            for i in 0..n {
                let b = &*first.add(i);
                if b.data.is_null() {
                    continue;
                }
                let len = b.bytes as usize / 4;
                bufs.push((b.channels as usize, std::slice::from_raw_parts(b.data as *const f32, len)));
            }
            let mono = super::downmix(&bufs);
            push(&ctx.buf, &mono);
        }
        0
    }

    pub struct Tap {
        tap_id: u32,
        agg_id: u32,
        proc_id: IoProcId,
        ctx: *mut Ctx,
        desc: *mut AnyObject,
        destroy_tap: DestroyTapFn,
    }
    // Core Audio object ids + a heap context only touched by the IOProc until stop() → safe to move.
    unsafe impl Send for Tap {}

    impl Tap {
        pub fn start(buf: Arc<Mutex<Buf>>) -> Result<Tap> {
            let create = sym(CORE_AUDIO, c"AudioHardwareCreateProcessTap");
            let destroy = sym(CORE_AUDIO, c"AudioHardwareDestroyProcessTap");
            let Some(cls) = AnyClass::get(c"CATapDescription") else {
                bail!("Call audio capture needs macOS 14.2 or later");
            };
            if create.is_null() || destroy.is_null() {
                bail!("Call audio capture needs macOS 14.2 or later");
            }
            if audio_capture_preflight() == Some(1) {
                bail!("Flo isn't allowed to record system audio. Enable Flo in System Settings → Privacy & Security → Screen & System Audio Recording");
            }
            let create: CreateTapFn = unsafe { std::mem::transmute(create) };
            let destroy_tap: DestroyTapFn = unsafe { std::mem::transmute(destroy) };

            // exclude Flo itself (our own sounds / TTS); 0 when Flo isn't an audio client yet
            let pid = unsafe { getpid() };
            let own: u32 = get(SYSTEM_OBJECT, b"id2p", Some(&pid)).unwrap_or(0);

            let (desc, tap_uid) = objc2::rc::autoreleasepool(|_| unsafe {
                let arr: *mut AnyObject = if own != 0 {
                    let num: *mut AnyObject = msg_send![class!(NSNumber), numberWithUnsignedInt: own];
                    msg_send![class!(NSArray), arrayWithObject: num]
                } else {
                    msg_send![class!(NSArray), array]
                };
                let alloc: *mut AnyObject = msg_send![cls, alloc];
                let desc: *mut AnyObject = msg_send![alloc, initStereoGlobalTapButExcludeProcesses: arr];
                if desc.is_null() {
                    return (desc, String::new());
                }
                let name = NSString::from_str("Flo call audio");
                let _: () = msg_send![desc, setName: &*name];
                let _: () = msg_send![desc, setPrivate: true];
                let _: () = msg_send![desc, setMuteBehavior: 0isize]; // CATapUnmuted
                let uuid: *mut AnyObject = msg_send![desc, UUID];
                let s: *mut NSString = msg_send![uuid, UUIDString];
                let uid = if s.is_null() { String::new() } else { (*s).to_string() };
                (desc, uid)
            });
            if desc.is_null() || tap_uid.is_empty() {
                bail!("Couldn't describe the system audio tap");
            }
            let release = |d: *mut AnyObject| unsafe {
                let _: () = msg_send![d, release];
            };

            let mut tap_id = 0u32;
            let st = unsafe { create(desc, &mut tap_id) };
            if st != 0 || tap_id == 0 {
                release(desc);
                bail!("macOS refused the system audio tap ({st})");
            }
            let fmt: Asbd = match get(tap_id, b"tfmt", None) {
                Ok(f) => f,
                Err(e) => {
                    unsafe { destroy_tap(tap_id) };
                    release(desc);
                    return Err(e);
                }
            };
            if fmt.format_flags & FLOAT_FLAG == 0 || fmt.bits_per_channel != 32 || fmt.sample_rate < 8000.0 {
                unsafe { destroy_tap(tap_id) };
                release(desc);
                bail!("Unsupported call audio format {fmt:?}");
            }
            buf.lock().rate = fmt.sample_rate.round() as u32;

            // private aggregate device = default output (clock) + our tap
            let k = |s: &str| CFString::new(s);
            let agg_uid = uuid::Uuid::new_v4().to_string();
            let tap_entry = CFDictionary::from_CFType_pairs(&[
                (k("uid"), CFString::new(&tap_uid).as_CFType()),
                (k("drift"), CFBoolean::true_value().as_CFType()),
            ]);
            let mut pairs: Vec<(CFString, CFType)> = vec![
                (k("name"), CFString::new("Flo call audio").as_CFType()),
                (k("uid"), CFString::new(&agg_uid).as_CFType()),
                (k("private"), CFNumber::from(1i32).as_CFType()),
                (k("stacked"), CFNumber::from(0i32).as_CFType()),
                (k("tapautostart"), CFNumber::from(1i32).as_CFType()),
                (k("taps"), CFArray::from_CFTypes(&[tap_entry.as_CFType()]).as_CFType()),
            ];
            if let Some(out_uid) = default_output_uid() {
                let sub = CFDictionary::from_CFType_pairs(&[(k("uid"), out_uid.as_CFType())]);
                pairs.push((k("master"), out_uid.as_CFType()));
                pairs.push((k("subdevices"), CFArray::from_CFTypes(&[sub.as_CFType()]).as_CFType()));
            }
            let dict = CFDictionary::from_CFType_pairs(&pairs);
            let mut agg_id = 0u32;
            let st = unsafe { AudioHardwareCreateAggregateDevice(dict.as_concrete_TypeRef() as *const c_void, &mut agg_id) };
            if st != 0 || agg_id == 0 {
                unsafe { destroy_tap(tap_id) };
                release(desc);
                bail!("Couldn't create the call audio device ({st})");
            }

            let ctx = Box::into_raw(Box::new(Ctx { buf }));
            let mut proc_id: IoProcId = None;
            let st = unsafe { AudioDeviceCreateIOProcID(agg_id, io_proc, ctx as *mut c_void, &mut proc_id) };
            let fail = |msg: String, proc_id: IoProcId| unsafe {
                if proc_id.is_some() {
                    AudioDeviceDestroyIOProcID(agg_id, proc_id);
                }
                AudioHardwareDestroyAggregateDevice(agg_id);
                destroy_tap(tap_id);
                drop(Box::from_raw(ctx));
                release(desc);
                anyhow!(msg)
            };
            if st != 0 || proc_id.is_none() {
                return Err(fail(format!("Couldn't read call audio ({st})"), proc_id));
            }
            let st = unsafe { AudioDeviceStart(agg_id, proc_id) };
            if st != 0 {
                return Err(fail(format!("Couldn't start call audio ({st})"), proc_id));
            }
            log::info!("system audio tap started: {} Hz, {} ch, excluded own process {own}", fmt.sample_rate, fmt.channels_per_frame);
            Ok(Tap { tap_id, agg_id, proc_id, ctx, desc, destroy_tap })
        }

        pub fn stop(self) {
            unsafe {
                AudioDeviceStop(self.agg_id, self.proc_id);
                AudioDeviceDestroyIOProcID(self.agg_id, self.proc_id);
                AudioHardwareDestroyAggregateDevice(self.agg_id);
                (self.destroy_tap)(self.tap_id);
                // the IOProc is gone → nobody references the context any more
                drop(Box::from_raw(self.ctx));
                let _: () = msg_send![self.desc, release];
            }
            log::info!("system audio tap stopped");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downmix_interleaved_and_planar() {
        // one interleaved stereo buffer: L=1, R=0 → 0.5
        let inter = [1.0f32, 0.0, 1.0, 0.0];
        assert_eq!(downmix(&[(2, &inter)]), vec![0.5, 0.5]);
        // two planar mono buffers
        let l = [1.0f32, 1.0];
        let r = [0.0f32, -1.0];
        assert_eq!(downmix(&[(1, &l), (1, &r)]), vec![0.5, 0.0]);
        assert!(downmix(&[]).is_empty());
    }

    #[test]
    fn push_tracks_nonzero_and_caps() {
        let b = Mutex::new(Buf { data: vec![], rate: 48_000, nonzero: false });
        push(&b, &[0.0; 10]);
        assert!(!b.lock().nonzero);
        push(&b, &[0.0, 0.1]);
        assert!(b.lock().nonzero);
        assert_eq!(b.lock().data.len(), 12);
    }

    /// When capture is unavailable, start() returns a human reason (→ mic-only), never panics.
    /// (Doesn't touch the real tap: that would raise a macOS permission prompt during tests.)
    #[test]
    fn start_degrades_gracefully() {
        FORCE_OFF.store(true, Ordering::Relaxed);
        let r = SystemTap::start();
        FORCE_OFF.store(false, Ordering::Relaxed);
        let e = r.err().expect("must fail when unavailable");
        assert!(e.to_string().contains("turned off"));
    }
}
