//! Microphone capture → 16 kHz mono f32, with live level metering.
use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use parking_lot::Mutex;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

pub const TARGET_RATE: u32 = 16_000;

struct Shared {
    buf: Vec<f32>,
    rate: u32,
}

pub struct Recorder {
    shared: Arc<Mutex<Shared>>,
    stop_tx: mpsc::Sender<()>,
    thread: Option<std::thread::JoinHandle<()>>,
}

// ── microphone lifetime accounting ──────────────────────────────────────────
//
// The macOS microphone indicator stays on for as long as any input stream exists, so Flo counts
// them where it matters: a `StreamToken` lives inside each stream's data callback, which the audio
// backend frees only when the stream is really gone. (cpal 0.15 on macOS never freed a stream
// opened on an enumerated device: its disconnect listener held the stream itself, so every
// recording left the microphone running and filling memory until Flo quit.)

static OPEN_STREAMS: AtomicUsize = AtomicUsize::new(0);

/// Input streams that exist right now (opened and not yet freed by the audio backend).
pub fn open_streams() -> usize {
    OPEN_STREAMS.load(Ordering::SeqCst)
}

/// Counts one input stream from creation until the backend drops its data callback.
pub(crate) struct StreamToken {
    path: &'static str,
}

impl StreamToken {
    pub(crate) fn new(path: &'static str) -> Self {
        let n = OPEN_STREAMS.fetch_add(1, Ordering::SeqCst) + 1;
        log::info!("mic streams open: {n} ({path})");
        Self { path }
    }
}

impl Drop for StreamToken {
    fn drop(&mut self) {
        let n = OPEN_STREAMS.fetch_sub(1, Ordering::SeqCst).saturating_sub(1);
        log::info!("mic streams open: {n} ({} closed)", self.path);
        if n == 0 {
            log::info!("microphone released");
        }
    }
}

/// A recorder whose capture thread is running, so the watchdog can close it by name.
struct LiveRecorder {
    id: u64,
    path: &'static str,
    since: Instant,
    stop: mpsc::Sender<()>,
}

static LIVE: Mutex<Vec<LiveRecorder>> = Mutex::new(Vec::new());
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn register(path: &'static str, stop: &mpsc::Sender<()>) -> u64 {
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    LIVE.lock().push(LiveRecorder { id, path, since: Instant::now(), stop: stop.clone() });
    id
}

fn unregister(id: u64) {
    LIVE.lock().retain(|r| r.id != id);
}

/// Recorders whose capture thread is still running: (path, seconds open).
#[cfg(test)]
pub fn live_recorders() -> Vec<(&'static str, u64)> {
    LIVE.lock().iter().map(|r| (r.path, r.since.elapsed().as_secs())).collect()
}

/// How long the microphone may stay open with nothing recording before the watchdog closes it.
/// Longer than any legitimate gap (a recorder opens a moment before its session is stored).
pub const WATCHDOG_GRACE: Duration = Duration::from_secs(4);

/// The watchdog's decision, kept pure for tests: which recorders (ids) to close now. `idle_since`
/// is when "something open, nothing recording" began (reset whenever that isn't the case).
fn lingering(in_use: bool, open: bool, now: Instant, idle_since: &mut Option<Instant>, live: &[(u64, Instant)], grace: Duration) -> Vec<u64> {
    if in_use || !open {
        *idle_since = None;
        return vec![];
    }
    let since = *idle_since.get_or_insert(now);
    if now.duration_since(since) < grace {
        return vec![];
    }
    live.iter().filter(|(_, opened)| now.duration_since(*opened) >= grace).map(|(id, _)| *id).collect()
}

/// One watchdog pass. Returns the paths it closed.
fn watchdog_pass(in_use: bool, idle_since: &mut Option<Instant>, warned_orphans: &mut bool, grace: Duration) -> Vec<&'static str> {
    let open = open_streams() > 0 || !LIVE.lock().is_empty();
    let now = Instant::now();
    let snapshot: Vec<(u64, Instant)> = LIVE.lock().iter().map(|r| (r.id, r.since)).collect();
    let ids = lingering(in_use, open, now, idle_since, &snapshot, grace);
    let mut closed = vec![];
    for id in ids {
        let rec = LIVE.lock().iter().find(|r| r.id == id).map(|r| (r.path, r.stop.clone(), r.since));
        if let Some((path, stop, since)) = rec {
            log::warn!("microphone left open by {path} for {}s with nothing recording; closing it", since.elapsed().as_secs());
            let _ = stop.send(());
            unregister(id); // its thread exits on the signal; never signal it twice
            closed.push(path);
        }
    }
    // streams nobody owns any more (the backend didn't free them): say so once
    let orphans = idle_since.is_some_and(|s| now.duration_since(s) >= grace * 2) && LIVE.lock().is_empty() && open_streams() > 0;
    if orphans && !*warned_orphans {
        log::error!("{} microphone stream(s) still open with no recorder: the audio backend did not release them", open_streams());
    }
    *warned_orphans = orphans;
    closed
}

/// Safety net: every second, if `in_use` says nothing should be recording (no push-to-talk
/// session, meeting or agent mode) but a recorder is still running, close it within
/// `WATCHDOG_GRACE` and log a warning naming the path that left it open.
pub fn spawn_watchdog(in_use: impl Fn() -> bool + Send + 'static) {
    let _ = std::thread::Builder::new().name("flo-mic-watchdog".into()).spawn(move || {
        let mut idle_since = None;
        let mut warned = false;
        loop {
            std::thread::sleep(Duration::from_secs(1));
            watchdog_pass(in_use(), &mut idle_since, &mut warned, WATCHDOG_GRACE);
        }
    });
}

/// Input devices that delivered pure zeros this run (a Bluetooth speaker that macOS made the
/// default input, a muted USB mic, a virtual device). Skipped while another microphone exists.
static SILENT_DEVICES: Mutex<Vec<(String, Instant)>> = Mutex::new(Vec::new());
/// A silent mark expires: AirPods and some USB mics send zeros for a moment while they wake up.
const SILENT_FOR: Duration = Duration::from_secs(300);

fn silent_now() -> Vec<String> {
    let mut sd = SILENT_DEVICES.lock();
    sd.retain(|(_, t)| t.elapsed() < SILENT_FOR);
    sd.iter().map(|(n, _)| n.clone()).collect()
}
/// The device the last recording actually used, for messages ("Stone 350 sends no sound").
static LAST_DEVICE: Mutex<String> = Mutex::new(String::new());

/// How long the first audio may be pure zeros before we try another microphone.
const SILENT_PROBE: Duration = Duration::from_millis(350);

/// Name of the microphone the last recording used.
pub fn last_device_name() -> String {
    LAST_DEVICE.lock().clone()
}

/// Order to try input devices in: the system default first unless it already proved silent this
/// run, then a built-in microphone, then any other input.
pub(crate) fn device_order(default: Option<&str>, all: &[String], silent: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |n: &str, out: &mut Vec<String>| {
        if !out.iter().any(|o| o == n) {
            out.push(n.to_string());
        }
    };
    let builtin = |n: &str| {
        let l = n.to_lowercase();
        l.contains("macbook") || l.contains("built-in") || l.contains("internal") || l.contains("microphone array")
    };
    if let Some(d) = default {
        if !silent.iter().any(|s| s == d) {
            push(d, &mut out);
        }
    }
    for n in all.iter().filter(|n| builtin(n) && !silent.contains(n)) {
        push(n, &mut out);
    }
    for n in all.iter().filter(|n| !silent.contains(n)) {
        push(n, &mut out);
    }
    // every device proved silent: still try the default so the user gets a clear message
    if out.is_empty() {
        if let Some(d) = default {
            push(d, &mut out);
        }
    }
    out
}

fn open_stream(dev: &cpal::Device, sh: &Arc<Mutex<Shared>>, level: &Arc<Mutex<dyn LevelFeed + Send>>, path: &'static str) -> Result<cpal::Stream> {
    let cfg = dev.default_input_config()?;
    let channels = cfg.channels() as usize;
    {
        let mut s = sh.lock();
        s.buf.clear();
        s.rate = cfg.sample_rate().0;
    }
    let err_fn = |e| log::error!("audio stream error: {e}");
    let stream_cfg: cpal::StreamConfig = cfg.clone().into();
    macro_rules! build {
        ($t:ty, $conv:expr) => {{
            let sh2 = sh.clone();
            let lv = level.clone();
            // freed with the callback, i.e. only when the backend really lets go of the stream
            let token = StreamToken::new(path);
            dev.build_input_stream(
                &stream_cfg,
                move |data: &[$t], _| {
                    let _ = &token;
                    let mono: Vec<f32> =
                        data.chunks(channels).map(|f| f.iter().map(|s| $conv(*s)).sum::<f32>() / channels as f32).collect();
                    lv.lock().feed_samples(&mono);
                    sh2.lock().buf.extend_from_slice(&mono);
                },
                err_fn,
                None,
            )?
        }};
    }
    let stream = match cfg.sample_format() {
        cpal::SampleFormat::F32 => build!(f32, |s: f32| s),
        cpal::SampleFormat::I16 => build!(i16, |s: i16| s as f32 / i16::MAX as f32),
        cpal::SampleFormat::U16 => build!(u16, |s: u16| (s as f32 - 32768.0) / 32768.0),
        cpal::SampleFormat::I32 => build!(i32, |s: i32| s as f32 / i32::MAX as f32),
        f => return Err(anyhow!("unsupported sample format {f:?}")),
    };
    stream.play()?;
    Ok(stream)
}

/// Owns the cpal stream (it is !Send on macOS) from opening to closing; see `Recorder::start`.
fn capture_thread(path: &'static str, sh: Arc<Mutex<Shared>>, stop_rx: mpsc::Receiver<()>, ready_tx: mpsc::Sender<Result<()>>, on_level: impl Fn(f32) + Send + 'static) {
    let host = cpal::default_host();
    let level: Arc<Mutex<dyn LevelFeed + Send>> = Arc::new(Mutex::new(LevelMeter::new(on_level)));
    let devices: Vec<cpal::Device> = host.input_devices().map(|d| d.collect()).unwrap_or_default();
    let names: Vec<String> = devices.iter().map(|d| d.name().unwrap_or_default()).collect();
    let default = host.default_input_device().and_then(|d| d.name().ok());
    let order = device_order(default.as_deref(), &names, &silent_now());
    let find = |n: &str| devices.iter().zip(&names).find(|(_, dn)| dn.as_str() == n).map(|(d, _)| d.clone());

    // open the first device that starts
    let mut idx = 0;
    let mut current: Option<(cpal::Stream, String)> = None;
    let mut last_err = anyhow!("No microphone found. Connect one, or choose one in System Settings → Sound → Input.");
    while idx < order.len() {
        let name = order[idx].clone();
        idx += 1;
        let Some(dev) = find(&name) else { continue };
        match open_stream(&dev, &sh, &level, path) {
            Ok(s) => {
                current = Some((s, name));
                break;
            }
            Err(e) => {
                log::warn!("microphone {name}: {e}");
                last_err = e;
            }
        }
    }
    let Some((mut stream, mut name)) = current else {
        let _ = ready_tx.send(Err(last_err));
        return;
    };
    *LAST_DEVICE.lock() = name.clone();
    let _ = ready_tx.send(Ok(()));

    // watch the first moments: pure zeros with another mic available → switch
    let mut probe_until = Instant::now() + SILENT_PROBE;
    loop {
        match stop_rx.recv_timeout(Duration::from_millis(50)) {
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if Instant::now() < probe_until || idx >= order.len() {
            continue;
        }
        let silent = {
            let s = sh.lock();
            !s.buf.is_empty() && is_digital_silence(&s.buf)
        };
        if !silent {
            idx = order.len(); // this one works: stop probing
            continue;
        }
        log::warn!("microphone {name} sends only silence; trying another");
        {
            let mut sd = SILENT_DEVICES.lock();
            sd.retain(|(n, _)| n != &name);
            sd.push((name.clone(), Instant::now()));
        }
        let mut switched = false;
        while idx < order.len() {
            let next = order[idx].clone();
            idx += 1;
            let Some(dev) = find(&next) else { continue };
            close(std::mem::replace(&mut stream, match open_stream(&dev, &sh, &level, path) {
                Ok(s) => s,
                Err(e) => {
                    log::warn!("microphone {next}: {e}");
                    continue;
                }
            }));
            log::info!("microphone: switched from {name} to {next}");
            name = next;
            *LAST_DEVICE.lock() = name.clone();
            probe_until = Instant::now() + SILENT_PROBE;
            switched = true;
            break;
        }
        if !switched {
            idx = order.len();
        }
    }
    close(stream);
}

/// Stop the device first, then free the stream: a stopped stream turns the microphone (and the
/// macOS indicator) off even if a backend keeps the object alive.
fn close(stream: cpal::Stream) {
    let _ = stream.pause();
    drop(stream);
}

trait LevelFeed {
    fn feed_samples(&mut self, s: &[f32]);
}
impl<F: Fn(f32)> LevelFeed for LevelMeter<F> {
    fn feed_samples(&mut self, s: &[f32]) {
        self.feed(s)
    }
}

impl Recorder {
    /// Start recording. Uses the system's default input, but if it delivers pure zeros for the
    /// first moments (a Bluetooth speaker macOS made the default input, a muted mic) and another
    /// microphone exists, switches to that one mid-press and remembers the silent device for the
    /// rest of the run. `on_level` receives 0..1 ~30×/s. `path` names who opened the microphone
    /// ("dictation", "meeting", …) in the log and in the watchdog's warning.
    pub fn start_as(path: &'static str, on_level: impl Fn(f32) + Send + 'static) -> Result<Self> {
        let shared = Arc::new(Mutex::new(Shared { buf: Vec::new(), rate: TARGET_RATE }));
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        // desktop E2E test builds only (inert in release builds; see e2e.rs)
        if let Some(wav) = crate::e2e::wav_input() {
            return Self::start_from_wav(&wav, shared, stop_tx, stop_rx, on_level, path);
        }
        let (ready_tx, ready_rx) = mpsc::channel::<Result<()>>();
        let sh = shared.clone();
        let id = register(path, &stop_tx);
        // cpal::Stream is !Send on macOS → own it on a dedicated thread.
        let spawned = std::thread::Builder::new().name("flo-audio".into()).spawn(move || {
            capture_thread(path, sh, stop_rx, ready_tx, on_level);
            unregister(id);
        });
        let thread = match spawned {
            Ok(t) => t,
            Err(e) => {
                unregister(id);
                return Err(e.into());
            }
        };
        ready_rx.recv_timeout(Duration::from_secs(5)).map_err(|_| anyhow!("microphone did not start"))??;
        Ok(Self { shared, stop_tx, thread: Some(thread) })
    }

    /// E2E test mode: play a WAV file into the recording in real time (20 ms frames), then
    /// near-silence until stopped, as a microphone would deliver it.
    fn start_from_wav(wav: &std::path::Path, shared: Arc<Mutex<Shared>>, stop_tx: mpsc::Sender<()>, stop_rx: mpsc::Receiver<()>, on_level: impl Fn(f32) + Send + 'static, path: &'static str) -> Result<Self> {
        let (samples, rate) = crate::e2e::read_wav(wav)?;
        *LAST_DEVICE.lock() = "E2E WAV".into();
        Self::start_samples(samples, rate, shared, stop_tx, stop_rx, on_level, path)
    }

    /// A recorder fed from memory instead of a device (E2E builds and tests). It is counted and
    /// watched exactly like a real microphone.
    fn start_samples(samples: Vec<f32>, rate: u32, shared: Arc<Mutex<Shared>>, stop_tx: mpsc::Sender<()>, stop_rx: mpsc::Receiver<()>, on_level: impl Fn(f32) + Send + 'static, path: &'static str) -> Result<Self> {
        shared.lock().rate = rate;
        let sh = shared.clone();
        let id = register(path, &stop_tx);
        let token = StreamToken::new(path);
        let thread = std::thread::Builder::new().name("flo-audio-e2e".into()).spawn(move || {
            let _token = token;
            let mut level = LevelMeter::new(on_level);
            let frame = (rate as usize / 50).max(1);
            let hush: Vec<f32> = (0..frame).map(|i| if i % 2 == 0 { 1e-4 } else { -1e-4 }).collect();
            let mut at = 0;
            loop {
                match stop_rx.recv_timeout(Duration::from_millis(20)) {
                    Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
                let chunk = if at < samples.len() {
                    let end = (at + frame).min(samples.len());
                    let c = &samples[at..end];
                    at = end;
                    c
                } else {
                    &hush[..]
                };
                level.feed(chunk);
                sh.lock().buf.extend_from_slice(chunk);
            }
            unregister(id);
        })?;
        Ok(Self { shared, stop_tx, thread: Some(thread) })
    }

    #[cfg(test)]
    pub(crate) fn start_fake(path: &'static str) -> Self {
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let shared = Arc::new(Mutex::new(Shared { buf: Vec::new(), rate: TARGET_RATE }));
        Self::start_samples(vec![0.05; 3200], TARGET_RATE, shared, stop_tx, stop_rx, |_| {}, path).expect("fake recorder")
    }

    /// Drain everything captured so far, resampled to 16 kHz.
    pub fn take_samples(&self) -> Vec<f32> {
        let mut s = self.shared.lock();
        let raw = std::mem::take(&mut s.buf);
        resample(&raw, s.rate, TARGET_RATE)
    }

    pub fn stop(mut self) -> Vec<f32> {
        let _ = self.stop_tx.send(());
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
        self.take_samples()
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        let _ = self.stop_tx.send(());
    }
}

struct LevelMeter<F: Fn(f32)> {
    cb: F,
    acc: f64,
    n: usize,
    last: Instant,
    smooth: f32,
}

impl<F: Fn(f32)> LevelMeter<F> {
    fn new(cb: F) -> Self {
        Self { cb, acc: 0.0, n: 0, last: Instant::now(), smooth: 0.0 }
    }
    fn feed(&mut self, s: &[f32]) {
        for x in s {
            self.acc += (*x as f64) * (*x as f64);
        }
        self.n += s.len();
        if self.last.elapsed() >= Duration::from_millis(33) && self.n > 0 {
            let rms = (self.acc / self.n as f64).sqrt() as f32;
            // perceptual scaling: speech RMS ~0.02–0.2
            let v = ((rms * 8.0).sqrt()).clamp(0.0, 1.0);
            self.smooth = self.smooth * 0.5 + v * 0.5;
            (self.cb)(self.smooth);
            self.acc = 0.0;
            self.n = 0;
            self.last = Instant::now();
        }
    }
}

/// Linear-interpolation resampler (adequate for speech → STT).
pub fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from as f64 / to as f64;
    let out_len = ((input.len() as f64) / ratio).floor() as usize;
    (0..out_len)
        .map(|i| {
            let pos = i as f64 * ratio;
            let i0 = pos.floor() as usize;
            let i1 = (i0 + 1).min(input.len() - 1);
            let frac = (pos - i0 as f64) as f32;
            input[i0] * (1.0 - frac) + input[i1] * frac
        })
        .collect()
}

/// Drop leading/trailing silence (keeps 0.25 s padding). Saves cloud STT seconds and local compute.
pub fn trim_silence(s: &[f32]) -> Vec<f32> {
    let win = (TARGET_RATE / 50) as usize; // 20 ms
    if s.len() < win * 4 {
        return s.to_vec();
    }
    let chunks: Vec<&[f32]> = s.chunks(win).collect();
    // same rule as `voiced_ms`: a fixed 0.012 cut softly spoken first/last words off
    // (never stricter than the old 0.012, so loud speech without pauses keeps its soft onsets)
    let thresh = speech_threshold(&chunks.iter().map(|c| rms(c)).collect::<Vec<_>>()).min(0.012);
    let loud = |c: &[f32]| rms(c) > thresh;
    let first = chunks.iter().position(|c| loud(c));
    let last = chunks.iter().rposition(|c| loud(c));
    match (first, last) {
        (Some(a), Some(b)) => {
            let pad = (TARGET_RATE / 4) as usize;
            let start = (a * win).saturating_sub(pad);
            let end = ((b + 1) * win + pad).min(s.len());
            s[start..end].to_vec()
        }
        _ => s.to_vec(),
    }
}

/// Level of the speech in a clip: RMS of its loudest fifth of 20 ms frames (words, not the pauses
/// between them), so a clip with long silences isn't judged quiet.
pub fn speech_level(s: &[f32]) -> f32 {
    let win = (TARGET_RATE / 50) as usize;
    let mut e: Vec<f32> = s.chunks(win).map(rms).collect();
    if e.is_empty() {
        return 0.0;
    }
    e.sort_by(|a, b| b.total_cmp(a));
    let top = &e[..e.len().div_ceil(5)];
    (top.iter().map(|v| v * v).sum::<f32>() / top.len() as f32).sqrt()
}

/// dBFS of a linear level (-120 for silence).
pub fn dbfs(level: f32) -> f32 {
    if level <= 1e-6 {
        -120.0
    } else {
        20.0 * level.log10()
    }
}

/// Speech level the speech model hears best: about -20 dBFS, where a normal voice close to a
/// laptop mic sits. Whisper's log-mel input is not level-independent, so a soft or distant voice
/// (-40…-50 dBFS) decodes worse than the same words at a normal level.
pub const TARGET_SPEECH_LEVEL: f32 = 0.1;
/// Most gain applied (+30 dB): enough for a voice 30 dB under normal, not so much that the room
/// noise of a recording without speech is blown up into something that sounds like words.
pub const MAX_GAIN: f32 = 31.6;

/// Gain for a clip whose speech is at `level` with peak `peak`: up to `TARGET_SPEECH_LEVEL`
/// (never down: a loud clip is left alone), at most `MAX_GAIN`, and never past full scale.
pub fn normalize_gain(level: f32, peak: f32) -> f32 {
    if level <= 1e-6 {
        return 1.0;
    }
    let g = (TARGET_SPEECH_LEVEL / level).clamp(1.0, MAX_GAIN);
    if peak > 0.0 {
        g.min(0.98 / peak).max(1.0)
    } else {
        g
    }
}

/// The clip brought to a normal speech level (see `normalize_gain`). Returns the audio and the
/// gain used.
pub fn normalize_speech(s: &[f32]) -> (Vec<f32>, f32) {
    let peak = s.iter().fold(0.0f32, |m, v| m.max(v.abs()));
    let g = normalize_gain(speech_level(s), peak);
    if (g - 1.0).abs() < 0.05 {
        return (s.to_vec(), 1.0);
    }
    (s.iter().map(|v| v * g).collect(), g)
}

/// RMS of a buffer — used to skip silent recordings.
/// Milliseconds of speech-level audio (voice-activity detection). We only transcribe clips with
/// real speech so Whisper can't hallucinate a sentence out of silence/background hum.
/// Adapts to the noise floor: a frame counts as "voiced" only if it's clearly above it.
pub fn voiced_ms(s: &[f32]) -> u32 {
    let win = (TARGET_RATE / 50) as usize; // 20 ms frames
    if s.len() < win {
        return 0;
    }
    let energies: Vec<f32> = s.chunks(win).map(rms).collect();
    let thresh = speech_threshold(&energies);
    let voiced = energies.iter().filter(|e| **e > thresh).count();
    (voiced as u32) * 20
}

/// Frame level above which a 20 ms frame is speech: clearly above the noise floor (20th percentile
/// of frame energy) AND above an absolute minimum. The minimum used to be 0.015 (-36 dBFS), which
/// rejected normal speech on a quiet or distant mic (~-40 dBFS) as "I didn't hear anything"
/// although Whisper transcribes it fine; steady noise is excluded by the floor-relative test.
fn speech_threshold(energies: &[f32]) -> f32 {
    if energies.is_empty() {
        return MIN_SPEECH_RMS;
    }
    let mut sorted = energies.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    (sorted[sorted.len() / 5] * 3.0).max(MIN_SPEECH_RMS)
}

/// Quietest 20 ms frame level that can count as speech (-46 dBFS).
pub const MIN_SPEECH_RMS: f32 = 0.005;

/// The input delivered (near) zeros: a muted / disconnected mic or a device still starting up
/// (e.g. AirPods switching to their microphone), as opposed to a room where nobody spoke.
pub fn is_digital_silence(s: &[f32]) -> bool {
    s.iter().all(|x| x.abs() < 0.0005)
}

pub fn rms(s: &[f32]) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    (s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32).sqrt()
}

/// 16-bit PCM WAV bytes for cloud STT upload.
pub fn encode_wav(samples: &[f32], rate: u32) -> Result<Vec<u8>> {
    let spec = hound::WavSpec { channels: 1, sample_rate: rate, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let mut cur = std::io::Cursor::new(Vec::new());
    {
        let mut w = hound::WavWriter::new(&mut cur, spec)?;
        for s in samples {
            w.write_sample((s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)?;
        }
        w.finalize()?;
    }
    Ok(cur.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_halves_length() {
        let v: Vec<f32> = (0..48_000).map(|i| (i as f32 / 100.0).sin()).collect();
        let r = resample(&v, 48_000, 16_000);
        assert_eq!(r.len(), 16_000);
        assert!((r[100] - v[300]).abs() < 1e-3);
    }

    #[test]
    fn trims_silence_with_padding() {
        let mut v = vec![0.0f32; 16_000]; // 1 s silence
        v.extend((0..8_000).map(|i| (i as f32 / 20.0).sin() * 0.3)); // 0.5 s speech
        v.extend(vec![0.0f32; 32_000]); // 2 s silence
        let t = trim_silence(&v);
        assert!(t.len() <= 16_000 && t.len() > 8_000, "len {}", t.len()); // 0.5 s speech + 2×0.25 s padding
        assert_eq!(trim_silence(&[0.0; 10]).len(), 10);
    }

    #[test]
    fn voiced_ms_detects_speech_not_silence() {
        let sr = TARGET_RATE as usize;
        // 2 s of near-silence (tiny noise) → ~0 voiced
        let mut silence: Vec<f32> = (0..2 * sr).map(|i| ((i as f32 * 0.7).sin()) * 0.002).collect();
        assert!(voiced_ms(&silence) < 120, "silence voiced {}", voiced_ms(&silence));
        // add 0.5 s of loud speech-level tone → clearly voiced
        silence.extend((0..sr / 2).map(|i| (i as f32 / 8.0).sin() * 0.25));
        assert!(voiced_ms(&silence) >= 300, "speech voiced {}", voiced_ms(&silence));
    }

    /// speech-like: 180 ms syllables at `level` with 60 ms dips to a tenth of it (no real silence)
    fn talking(secs: f32, level: f32) -> Vec<f32> {
        let sr = TARGET_RATE as usize;
        (0..(secs * sr as f32) as usize)
            .map(|i| {
                let in_dip = (i % (sr * 240 / 1000)) >= sr * 180 / 1000;
                (i as f32 / 6.0).sin() * level * 1.414 * if in_dip { 0.1 } else { 1.0 }
            })
            .collect()
    }

    #[test]
    fn trimming_keeps_a_softly_spoken_last_word() {
        let mut v = vec![0.0f32; 8_000];
        v.extend(talking(1.0, 0.1)); // normal speech
        v.extend(talking(0.4, 0.008)); // trailing word, much softer
        v.extend(vec![0.0f32; 16_000]);
        let t = trim_silence(&v);
        // keeps the soft word (0.4 s) + padding, drops most of the 1 s of silence
        assert!(t.len() >= 16_000 + 6_400, "len {}", t.len());
        assert!(t.len() < v.len() - 8_000, "len {}", t.len());
    }

    #[test]
    fn quiet_microphone_speech_still_counts_as_speech() {
        // a laptop mic a little far away: speech around -40 dBFS (RMS ~0.01), the level at which
        // users got "I didn't hear anything" although Whisper transcribes it fine
        let quiet = talking(2.0, 0.01);
        assert!(voiced_ms(&quiet) >= 1000, "quiet speech voiced {}", voiced_ms(&quiet));
        // a tail that is all speech (no leading silence to learn the noise floor from)
        let loud = talking(2.0, 0.15);
        assert!(voiced_ms(&loud) >= 1000, "continuous speech voiced {}", voiced_ms(&loud));
    }

    #[test]
    fn steady_background_noise_is_not_speech() {
        // fan / room hum: constant level, even a fairly loud one
        for level in [0.003f32, 0.006, 0.02] {
            let hum: Vec<f32> = (0..TARGET_RATE as usize * 2).map(|i| (i as f32 * 0.37).sin() * level * 1.414).collect();
            assert!(voiced_ms(&hum) < 100, "hum {level} voiced {}", voiced_ms(&hum));
        }
        assert_eq!(voiced_ms(&vec![0.0; 32_000]), 0);
    }

    #[test]
    fn digital_silence_is_detected() {
        assert!(is_digital_silence(&vec![0.0; 16_000]));
        assert!(is_digital_silence(&vec![0.00002; 16_000]));
        assert!(!is_digital_silence(&talking(1.0, 0.005)));
        assert!(is_digital_silence(&[]));
    }

    #[test]
    fn quiet_speech_is_brought_up_to_a_normal_level() {
        let quiet = talking(2.0, 0.003); // -50 dBFS: a soft voice far from the mic
        let (out, g) = normalize_speech(&quiet);
        assert!(g > 20.0, "gain {g}");
        assert!((speech_level(&out) - TARGET_SPEECH_LEVEL).abs() < 0.02, "level {}", speech_level(&out));
        // gain is capped: a whisper at -70 dBFS is not turned into a shout
        let (_, g) = normalize_speech(&talking(1.0, 0.0003));
        assert!((g - MAX_GAIN).abs() < 0.01);
    }

    #[test]
    fn loud_speech_and_silence_are_left_alone() {
        let loud = talking(1.0, 0.2);
        assert_eq!(normalize_speech(&loud), (loud.clone(), 1.0));
        let silence = vec![0.0f32; 16_000];
        assert_eq!(normalize_speech(&silence).1, 1.0);
        // never clips: a loud peak limits the gain
        assert!(normalize_gain(0.01, 0.5) <= 0.98 / 0.5 + 1e-6);
    }

    #[test]
    fn speech_level_ignores_pauses() {
        let mut v = vec![0.0f32; 32_000];
        v.extend(talking(1.0, 0.05));
        assert!((speech_level(&v) - 0.05).abs() < 0.02, "level {}", speech_level(&v));
        assert_eq!(dbfs(0.0), -120.0);
        assert!((dbfs(0.1) + 20.0).abs() < 0.01);
    }

    #[test]
    fn rms_and_wav() {
        assert_eq!(rms(&[]), 0.0);
        assert!((rms(&[0.5, -0.5]) - 0.5).abs() < 1e-6);
        let wav = encode_wav(&[0.0, 0.5, -0.5], 16_000).unwrap();
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(wav.len(), 44 + 6);
    }
}

#[cfg(test)]
mod device_order_tests {
    use super::device_order;
    fn v(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }
    #[test]
    fn default_first_then_builtin_then_others() {
        let all = v(&["Stone 350", "MacBook Pro Microphone", "USB Mic"]);
        assert_eq!(device_order(Some("Stone 350"), &all, &[]), v(&["Stone 350", "MacBook Pro Microphone", "USB Mic"]));
    }
    #[test]
    fn a_silent_default_is_skipped_for_the_builtin_mic() {
        let all = v(&["Stone 350", "MacBook Pro Microphone"]);
        assert_eq!(device_order(Some("Stone 350"), &all, &v(&["Stone 350"])), v(&["MacBook Pro Microphone"]));
    }
    #[test]
    fn when_everything_is_silent_the_default_is_still_tried() {
        let all = v(&["Stone 350"]);
        assert_eq!(device_order(Some("Stone 350"), &all, &v(&["Stone 350"])), v(&["Stone 350"]));
    }
    #[test]
    fn windows_and_linux_builtin_names_count() {
        let all = v(&["Headset (BT)", "Microphone Array (Realtek)"]);
        assert_eq!(device_order(Some("Headset (BT)"), &all, &v(&["Headset (BT)"])), v(&["Microphone Array (Realtek)"]));
    }
}

#[cfg(test)]
mod mic_lifetime {
    //! Every way a recording ends must close the microphone (stream count back to where it was).
    use super::*;

    /// the counters are process-wide: these tests take turns
    static SERIAL: Mutex<()> = Mutex::new(());

    fn settle(want: usize) -> usize {
        let t = Instant::now();
        while open_streams() != want && t.elapsed() < Duration::from_secs(2) {
            std::thread::sleep(Duration::from_millis(10));
        }
        open_streams()
    }

    #[test]
    fn stop_closes_the_microphone() {
        let _g = SERIAL.lock();
        let base = open_streams();
        let r = Recorder::start_fake("dictation");
        assert_eq!(open_streams(), base + 1);
        assert!(live_recorders().iter().any(|(p, _)| *p == "dictation"));
        let _ = r.stop();
        assert_eq!(settle(base), base);
        assert!(!live_recorders().iter().any(|(p, _)| *p == "dictation"));
    }

    /// cancel, a tap released during start, an error after the mic opened (signed out, no
    /// model, assistant failure): the recorder is simply dropped
    #[test]
    fn dropping_without_stop_closes_the_microphone() {
        let _g = SERIAL.lock();
        let base = open_streams();
        let r = Recorder::start_fake("assistant");
        assert_eq!(open_streams(), base + 1);
        drop(r);
        assert_eq!(settle(base), base);
    }

    /// fn pressed five times in a few seconds, some presses ending before they started
    #[test]
    fn rapid_presses_leave_nothing_open() {
        let _g = SERIAL.lock();
        let base = open_streams();
        for i in 0..20 {
            let r = Recorder::start_fake("assistant");
            if i % 2 == 0 {
                let _ = r.stop();
            } else {
                drop(r);
            }
        }
        assert_eq!(settle(base), base);
    }

    /// a new recorder put where the old one was (agent mode started twice, a session replaced)
    #[test]
    fn a_replaced_recorder_is_closed() {
        let _g = SERIAL.lock();
        let base = open_streams();
        let mut slot = Some(Recorder::start_fake("hands-free"));
        assert_eq!(open_streams(), base + 1);
        drop(slot.replace(Recorder::start_fake("hands-free")));
        assert_eq!(settle(base + 1), base + 1);
        drop(slot.take());
        assert_eq!(settle(base), base);
    }

    #[test]
    fn watchdog_closes_a_recorder_nobody_stopped() {
        let _g = SERIAL.lock();
        let base = open_streams();
        // kept somewhere and never dropped: only the watchdog can close it
        std::mem::forget(Recorder::start_fake("leaky test path"));
        assert_eq!(open_streams(), base + 1);
        let (mut idle, mut warned) = (None, false);
        // something is recording → hands off
        assert!(watchdog_pass(true, &mut idle, &mut warned, Duration::ZERO).is_empty());
        assert_eq!(open_streams(), base + 1);
        // nothing is → closed, by name
        let closed = watchdog_pass(false, &mut idle, &mut warned, Duration::ZERO);
        assert_eq!(closed, vec!["leaky test path"]);
        assert_eq!(settle(base), base);
        assert!(!live_recorders().iter().any(|(p, _)| *p == "leaky test path"));
    }

    #[test]
    fn watchdog_waits_out_the_grace_period() {
        let t0 = Instant::now();
        let g = Duration::from_secs(4);
        let live = [(1u64, t0)];
        let mut idle = None;
        // a recorder opens a moment before its session is stored: not closed then
        assert!(lingering(false, true, t0, &mut idle, &live, g).is_empty());
        assert!(lingering(false, true, t0 + Duration::from_secs(3), &mut idle, &live, g).is_empty());
        assert_eq!(lingering(false, true, t0 + Duration::from_secs(4), &mut idle, &live, g), vec![1]);
        // a session starting resets the clock
        assert!(lingering(true, true, t0 + Duration::from_secs(5), &mut idle, &live, g).is_empty());
        assert_eq!(idle, None);
        assert!(lingering(false, true, t0 + Duration::from_secs(6), &mut idle, &live, g).is_empty());
        // nothing open → nothing to do
        assert!(lingering(false, false, t0 + Duration::from_secs(60), &mut idle, &live, g).is_empty());
    }
}

#[cfg(test)]
mod live_mic_probe {
    /// Manual check on a real Mac: `cargo test --release --lib live_mic_probe -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn records_from_a_working_microphone() {
        let r = super::Recorder::start_as("live probe", |_| {}).expect("start");
        std::thread::sleep(std::time::Duration::from_millis(1500));
        let s = r.stop();
        println!("device={} samples={} silent={} rms={:.5}", super::last_device_name(), s.len(), super::is_digital_silence(&s), super::rms(&s));
    }

    /// The real microphone is released when a recording ends: the stream count (held by the
    /// backend's data callback) is back to zero. With cpal 0.15 on macOS it stayed at one per
    /// recording forever. `cargo test --release --lib live_mic_probe -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_microphone_is_released_after_every_recording() {
        use std::time::{Duration, Instant};
        let _ = env_logger::builder().is_test(true).filter_level(log::LevelFilter::Info).try_init();
        let wait_zero = || {
            let t = Instant::now();
            while super::open_streams() != 0 && t.elapsed() < Duration::from_secs(3) {
                std::thread::sleep(Duration::from_millis(20));
            }
            super::open_streams()
        };
        // stop
        let t = Instant::now();
        let r = super::Recorder::start_as("live stop", |_| {}).expect("start");
        assert_eq!(super::open_streams(), 1);
        std::thread::sleep(Duration::from_millis(2000));
        let s = r.stop();
        let secs = t.elapsed().as_secs_f64();
        println!("captured {:.2}s of audio in {secs:.2}s wall ({:.2}x)", s.len() as f64 / 16_000.0, s.len() as f64 / 16_000.0 / secs);
        assert_eq!(wait_zero(), 0, "stopped recorder left the microphone open");
        // dropped (cancel / error paths)
        drop(super::Recorder::start_as("live drop", |_| {}).expect("start"));
        assert_eq!(wait_zero(), 0, "dropped recorder left the microphone open");
        // rapid presses
        for _ in 0..5 {
            let r = super::Recorder::start_as("live rapid", |_| {}).expect("start");
            std::thread::sleep(Duration::from_millis(150));
            let _ = r.stop();
        }
        assert_eq!(wait_zero(), 0, "rapid presses left the microphone open");
    }
}
