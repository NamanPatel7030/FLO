//! Agent mode: hands-free, continuous voice control.
//!
//! Toggle it with a double-tap of the assistant key (fn), the island's "Agent" quick action, or the
//! `toggle_agent_mode` command. While it's on, the mic stays open; speech is cut into utterances at
//! natural pauses, transcribed, and each one goes straight to the assistant as a request — no key
//! press. If the assistant decides to operate the screen, the computer-control agent runs every
//! step by itself.
//!
//! While the agent is executing, Flo keeps listening:
//! - "stop" / "cancel" / "wait" aborts the agent (agent mode stays on);
//! - any other speech is queued (one slot, latest wins) and runs as the next request when the
//!   agent finishes.
//!
//! When the agent hits a confirm step (send / post / buy / delete) it pauses and asks; a spoken
//! "yes" lets it continue, "no" stops it, and no clear answer within ~15 s counts as no. Agent mode
//! never confirms anything by itself.
//!
//! Safety: a persistent island pill shows that Flo is listening (plus the macOS mic indicator);
//! agent mode turns itself off after 5 minutes of quiet; saying "stop" while idle (or "stop
//! listening") or double-tapping fn turns it off. Audio is ignored while a push-to-talk session or
//! a meeting recording is running. Flo emits no sound cues in agent mode (cues only follow the
//! push-to-talk state), so it can't hear itself.
use crate::audio::{self, Recorder};
use crate::livetx::{SLICE_MS, SPEECH_RMS};
use crate::model::ev;
use crate::state::Shared;
use crate::{agent, assistant, session, stt, text};
use anyhow::{anyhow, Result};
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// payload: {active, phase, heard?, queued?, message?}
pub const EVENT: &str = "flo://handsfree";
/// agent mode switches itself off after this much quiet
pub const IDLE_EXIT_SECS: u64 = 300;
/// transcribe nothing with less voiced audio than this (a breath, a click, a chime)
pub const MIN_VOICED_MS: u32 = 250;
/// a new request needs at least this much voiced audio (short words only count as stop / yes / no)
pub const MIN_REQUEST_VOICED_MS: u32 = 600;
/// longer than this is a conversation or lyrics, not a request to Flo
const MAX_REQUEST_WORDS: usize = 40;

// ── utterance detection (pure) ──────────────────────────────────────────────

/// Pause that ends an utterance (a little longer than meeting captions: commands have
/// mid-sentence pauses like "open Chrome … and search for lofi").
pub const PAUSE_MS: u64 = 800;
/// Shortest speech worth cutting as an utterance ("yes", "stop").
pub const MIN_SPEECH_MS: u64 = 300;
/// One utterance never runs longer than this.
pub const MAX_UTTERANCE_MS: u64 = 15_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cut {
    /// keep listening
    None,
    /// the pending audio is one finished utterance → transcribe it
    Utterance,
    /// the pending audio was only noise → drop it
    Silence,
}

/// Like `livetx::Segmenter`, but cuts short words too (yes / no / stop matter here).
#[derive(Debug, Default)]
pub struct Detector {
    pending_ms: u64,
    speech_ms: u64,
    quiet_ms: u64,
}

impl Detector {
    pub fn push(&mut self, slice_ms: u64, rms: f32) -> Cut {
        self.pending_ms += slice_ms;
        if rms >= SPEECH_RMS {
            self.speech_ms += slice_ms;
            self.quiet_ms = 0;
        } else {
            self.quiet_ms += slice_ms;
        }
        let cut = if self.speech_ms == 0 {
            if self.pending_ms >= 2_000 {
                Cut::Silence
            } else {
                Cut::None
            }
        } else if self.speech_ms >= MIN_SPEECH_MS && (self.quiet_ms >= PAUSE_MS || self.pending_ms >= MAX_UTTERANCE_MS) {
            Cut::Utterance
        } else if self.speech_ms < MIN_SPEECH_MS && (self.quiet_ms >= 1_500 || self.pending_ms >= MAX_UTTERANCE_MS) {
            Cut::Silence // a blip (cough, click) followed by quiet
        } else {
            Cut::None
        };
        if cut != Cut::None {
            *self = Detector::default();
        }
        cut
    }

    pub fn reset(&mut self) {
        *self = Detector::default();
    }
}

// ── understanding what was said (pure) ──────────────────────────────────────

/// What agent mode is doing right now (decides how speech is read).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Phase {
    Listening = 0,
    /// the assistant is working out a request
    Thinking = 1,
    /// the screen agent is executing steps
    Acting = 2,
    /// the screen agent is paused on a yes/no question
    Confirming = 3,
}

impl Phase {
    fn as_str(self) -> &'static str {
        match self {
            Phase::Listening => "listening",
            Phase::Thinking => "thinking",
            Phase::Acting => "acting",
            Phase::Confirming => "confirming",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Intent {
    /// a new request for the assistant
    Request(String),
    /// abort the running agent (agent mode stays on)
    AbortAgent,
    /// turn agent mode off
    Exit,
    /// answer the agent's confirm question
    Confirm(bool),
    /// run this after the current request / agent finishes
    Queue(String),
    Ignore,
}

/// lower-case words with punctuation stripped (keeps Devanagari / Gujarati letters)
fn words(t: &str) -> Vec<String> {
    t.to_lowercase()
        .replace('’', "'")
        .split(|c: char| c.is_whitespace() || (c.is_ascii_punctuation() && c != '\'') || matches!(c, '।' | '…' | '“' | '”' | '‘' | '’'))
        .map(|w| w.trim_matches('\'').to_string())
        .filter(|w| !w.is_empty())
        .collect()
}

fn has_phrase(ws: &[String], phrase: &str) -> bool {
    let p: Vec<&str> = phrase.split(' ').collect();
    ws.windows(p.len()).any(|w| w.iter().zip(&p).all(|(a, b)| a == b))
}

/// Spoken yes / no, in English, Hindi and Gujarati (romanised or native script).
/// "no" wins over "yes" ("yes… no wait"). Anything unclear → None.
pub fn parse_yes_no(t: &str) -> Option<bool> {
    const NO: &[&str] = &[
        "no", "nope", "nah", "cancel", "stop", "don't", "dont", "not", "never", "nahi", "nahin", "nai", "mat", "na", "naa", "ruko", "नहीं", "नही", "ना",
        "मत", "ના", "નહીં", "નથી",
    ];
    const NO_PHRASES: &[&str] = &["do not", "don't do it", "hold on", "wait"];
    const YES: &[&str] = &[
        "yes", "yeah", "yea", "yep", "yup", "sure", "ok", "okay", "confirm", "confirmed", "proceed", "correct", "absolutely", "haan", "han", "ha", "haa",
        "hanji", "ji", "theek", "thik", "chalo", "हाँ", "हां", "हा", "जी", "ठीक", "હા", "હાં", "ચાલો",
    ];
    const YES_PHRASES: &[&str] = &["do it", "go ahead", "send it", "go for it", "of course", "kar do", "karo"];
    let ws = words(t);
    if ws.is_empty() || ws.len() > 8 {
        return None;
    }
    // "ha ha" is laughter, not a yes
    if ws.len() >= 2 && ws.iter().all(|w| w == "ha") {
        return None;
    }
    if ws.iter().any(|w| NO.contains(&w.as_str())) || NO_PHRASES.iter().any(|p| has_phrase(&ws, p)) {
        return Some(false);
    }
    if ws.iter().any(|w| YES.contains(&w.as_str())) || YES_PHRASES.iter().any(|p| has_phrase(&ws, p)) {
        return Some(true);
    }
    None
}

/// "stop", "cancel that", "wait!", "ruko" — a short command to halt the agent.
pub fn is_stop_command(t: &str) -> bool {
    const STOP: &[&str] = &["stop", "cancel", "wait", "abort", "halt", "pause", "enough", "ruko", "bas", "रुको", "बस", "રોકો", "બસ"];
    let ws = words(t);
    !ws.is_empty() && ws.len() <= 4 && ws.iter().any(|w| STOP.contains(&w.as_str()))
}

/// "stop listening", "exit agent mode", "go to sleep" — turn agent mode off.
pub fn is_exit_command(t: &str) -> bool {
    const EXIT: &[&str] = &[
        "stop listening", "exit agent", "agent mode off", "turn off agent", "stop agent mode", "end agent mode", "close agent mode", "go to sleep",
        "that's all", "thats all",
    ];
    let ws = words(t);
    ws.len() <= 7 && EXIT.iter().any(|p| has_phrase(&ws, p))
}

/// Drop a leading wake word: "Hey Flo, open Chrome" → "open Chrome".
pub fn strip_wake(t: &str) -> String {
    let s = t.trim();
    let lower = s.to_lowercase();
    for w in ["hey flo", "hey flow", "ok flo", "okay flo", "flo", "flow"] {
        if let Some(rest) = lower.strip_prefix(w) {
            if rest.is_empty() || rest.starts_with([',', ' ', '.', '!', ':']) {
                return s.get(w.len()..).unwrap_or("").trim_start_matches([',', ' ', '.', '!', ':']).trim().to_string();
            }
        }
    }
    s.to_string()
}

/// A transcript worth acting on? Rejects empty text, Whisper hallucinations and loops.
pub fn accept_transcript(raw: &str, secs: f32) -> Option<String> {
    let t = raw.trim();
    if t.is_empty() || stt::is_hallucination(t, secs) || stt::is_degenerate(t) {
        return None;
    }
    let t = strip_wake(t);
    (!words(&t).is_empty()).then_some(t)
}

/// Decide what an utterance means given what agent mode is doing.
pub fn classify(phase: Phase, t: &str, voiced_ms: u32) -> Intent {
    match phase {
        Phase::Confirming => match parse_yes_no(t) {
            Some(b) => Intent::Confirm(b),
            None if is_stop_command(t) => Intent::AbortAgent,
            None => Intent::Ignore, // keep waiting; silence becomes a "no" at the timeout
        },
        Phase::Acting | Phase::Thinking => {
            if is_exit_command(t) {
                Intent::Exit
            } else if is_stop_command(t) {
                Intent::AbortAgent
            } else if voiced_ms >= MIN_REQUEST_VOICED_MS && words(t).len() >= 2 && words(t).len() <= MAX_REQUEST_WORDS {
                Intent::Queue(t.to_string())
            } else {
                Intent::Ignore
            }
        }
        Phase::Listening => {
            if is_exit_command(t) || is_stop_command(t) {
                Intent::Exit
            } else if voiced_ms >= MIN_REQUEST_VOICED_MS && words(t).len() <= MAX_REQUEST_WORDS {
                Intent::Request(t.to_string())
            } else {
                Intent::Ignore
            }
        }
    }
}

/// Auto-exit after a long quiet stretch (never while the agent is busy).
pub fn should_idle_exit(quiet: Duration, busy: bool) -> bool {
    !busy && quiet >= Duration::from_secs(IDLE_EXIT_SECS)
}

// ── runtime ─────────────────────────────────────────────────────────────────

static ACTIVE: AtomicBool = AtomicBool::new(false);
/// bumps on every start/stop so a stale loop exits
static GEN: AtomicU64 = AtomicU64::new(0);
/// the assistant is handling a request (Phase::Thinking)
static BUSY: AtomicU8 = AtomicU8::new(0);
static REC: Mutex<Option<Recorder>> = Mutex::new(None);
static QUEUED: Mutex<Option<String>> = Mutex::new(None);
static HEARD: Mutex<String> = Mutex::new(String::new());

pub fn is_active() -> bool {
    ACTIVE.load(Ordering::SeqCst)
}

fn phase_now() -> Phase {
    if agent::pending_confirm().is_some() {
        Phase::Confirming
    } else if agent::is_running() {
        Phase::Acting
    } else if BUSY.load(Ordering::SeqCst) > 0 {
        Phase::Thinking
    } else {
        Phase::Listening
    }
}

fn emit(st: &Shared, message: Option<&str>) {
    let heard = HEARD.lock().map(|h| h.clone()).unwrap_or_default();
    let queued = QUEUED.lock().ok().and_then(|q| q.clone());
    st.emit(
        EVENT,
        json!({
            "active": is_active(),
            "phase": phase_now().as_str(),
            "heard": if heard.is_empty() { None } else { Some(heard) },
            "queued": queued,
            "message": message,
        }),
    );
}

fn set_heard(t: &str) {
    if let Ok(mut h) = HEARD.lock() {
        *h = text::truncate_chars(t, 120);
    }
}

/// Turn agent mode on or off. Returns the new state. Blocking (opens the mic).
pub fn toggle(st: &Shared) -> Result<bool> {
    if is_active() {
        stop(st, None);
        Ok(false)
    } else {
        start(st)?;
        Ok(true)
    }
}

pub fn start(st: &Shared) -> Result<()> {
    if !st.signed_in.load(Ordering::SeqCst) {
        crate::show_dashboard(&st.app, None);
        return Err(anyhow!("Sign in to Flo to use agent mode."));
    }
    if is_active() {
        return Ok(());
    }
    let rec = Recorder::start(|_| {}).map_err(|e| anyhow!("Microphone unavailable ({e}). Allow Flo in System Settings → Privacy → Microphone."))?;
    if let Ok(mut r) = REC.lock() {
        *r = Some(rec);
    }
    if let Ok(mut q) = QUEUED.lock() {
        *q = None;
    }
    set_heard("");
    ACTIVE.store(true, Ordering::SeqCst);
    let gen = GEN.fetch_add(1, Ordering::SeqCst) + 1;
    log::info!("agent mode on");
    emit(st, None);
    // warm the local speech model so the first request isn't slow
    let s = st.settings();
    if s.stt_provider == "local" {
        if let Some(path) = stt::model_path(&st.models_dir, &s.stt_model) {
            let w = st.whisper.clone();
            tauri::async_runtime::spawn_blocking(move || w.warm(&path));
        }
    }
    tauri::async_runtime::spawn(listen_loop(st.clone(), gen));
    Ok(())
}

/// Turn agent mode off (the running agent, if any, keeps its own Stop button).
pub fn stop(st: &Shared, message: Option<&str>) {
    let was = ACTIVE.swap(false, Ordering::SeqCst);
    GEN.fetch_add(1, Ordering::SeqCst);
    let rec = REC.lock().ok().and_then(|mut r| r.take());
    if let Some(r) = rec {
        std::thread::spawn(move || drop(r.stop()));
    }
    if let Ok(mut q) = QUEUED.lock() {
        *q = None;
    }
    if was {
        log::info!("agent mode off");
    }
    emit(st, message);
}

async fn listen_loop(st: Shared, gen: u64) {
    let mut det = Detector::default();
    let mut pending: Vec<f32> = Vec::new();
    let mut last_activity = Instant::now();
    let mut context = String::new();
    loop {
        tokio::time::sleep(Duration::from_millis(SLICE_MS)).await;
        if !is_active() || GEN.load(Ordering::SeqCst) != gen {
            break;
        }
        let Some(slice) = REC.lock().ok().and_then(|r| r.as_ref().map(|r| r.take_samples())) else { break };
        let phase = phase_now();
        let busy = phase != Phase::Listening;
        // push-to-talk or a meeting owns the conversation right now → don't act on what we hear
        if st.session.lock().is_some() || st.meeting.lock().is_some() {
            pending.clear();
            det.reset();
            last_activity = Instant::now();
            continue;
        }
        if busy {
            last_activity = Instant::now();
        }
        if should_idle_exit(last_activity.elapsed(), busy) {
            stop(&st, Some("Agent mode off after 5 minutes of quiet."));
            break;
        }
        let ms = (slice.len() as u64 * 1000 / audio::TARGET_RATE as u64).max(1);
        let rms = audio::rms(&slice);
        pending.extend_from_slice(&slice);
        match det.push(ms, rms) {
            Cut::None => {}
            Cut::Silence => pending.clear(),
            Cut::Utterance => {
                let utter = std::mem::take(&mut pending);
                let voiced = audio::voiced_ms(&utter);
                if voiced < MIN_VOICED_MS {
                    continue;
                }
                let secs = utter.len() as f32 / audio::TARGET_RATE as f32;
                let raw = match tokio::time::timeout(Duration::from_secs(30), session::transcribe_with_prompt(&st, utter, &context)).await {
                    Ok(Ok(t)) => t,
                    Ok(Err(e)) => {
                        log::warn!("agent mode: transcription failed: {e:#}");
                        continue;
                    }
                    Err(_) => continue,
                };
                if !is_active() || GEN.load(Ordering::SeqCst) != gen {
                    break;
                }
                let Some(t) = accept_transcript(&raw, secs) else { continue };
                last_activity = Instant::now();
                context = text::truncate_chars(&t, 120);
                handle(&st, phase_now(), &t, voiced);
            }
        }
    }
}

fn handle(st: &Shared, phase: Phase, t: &str, voiced: u32) {
    let intent = classify(phase, t, voiced);
    // log what kind of utterance it was, never the words themselves
    let kind = match &intent {
        Intent::Request(_) => "request",
        Intent::AbortAgent => "abort",
        Intent::Exit => "exit",
        Intent::Confirm(_) => "confirm",
        Intent::Queue(_) => "queue",
        Intent::Ignore => "ignored",
    };
    log::info!("agent mode ({}): {kind}", phase.as_str());
    match intent {
        Intent::Ignore => {}
        Intent::Exit => stop(st, Some("Agent mode off.")),
        Intent::Confirm(yes) => {
            set_heard(t);
            agent::answer_confirm(yes);
            emit(st, None);
        }
        Intent::AbortAgent => {
            set_heard(t);
            agent::answer_confirm(false);
            st.agent_abort.store(true, Ordering::SeqCst);
            if let Ok(mut q) = QUEUED.lock() {
                *q = None;
            }
            emit(st, Some("Stopping…"));
        }
        Intent::Queue(q) => {
            if let Ok(mut slot) = QUEUED.lock() {
                *slot = Some(q);
            }
            emit(st, None);
        }
        Intent::Request(r) => {
            set_heard(&r);
            let busy = Busy::hold();
            emit(st, None);
            tauri::async_runtime::spawn(run_requests(st.clone(), r, busy));
        }
    }
}

/// Holds one count of BUSY ("thinking") and gives it back however the request ends, even if
/// the task panics, so the pill can't get stuck on "working".
struct Busy;
impl Busy {
    fn hold() -> Self {
        BUSY.fetch_add(1, Ordering::SeqCst);
        Busy
    }
}
impl Drop for Busy {
    fn drop(&mut self) {
        // every Busy added exactly one in hold(), so this never underflows
        BUSY.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Upper bound for one request in agent mode (the assistant has its own, shorter, AI time limit;
/// this also covers everything around it).
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(180);
/// How long to wait for a screen run the assistant just started to show up.
const AGENT_START_WAIT: Duration = Duration::from_secs(3);

/// Run a request end to end (assistant → maybe the screen agent, waiting for all its steps), then
/// whatever was queued meanwhile. Always ends with a visible result or error and a log line.
async fn run_requests(st: Shared, first: String, busy: Busy) {
    let mut busy = Some(busy);
    let mut next = Some(first);
    while let Some(req) = next.take() {
        if busy.is_none() {
            busy = Some(Busy::hold());
            emit(&st, None);
        }
        let before = agent::runs_started();
        let front = st.target_app();
        let t0 = Instant::now();
        let outcome = tokio::time::timeout(REQUEST_TIMEOUT, assistant::run(&st, &req, None, &front, None)).await;
        match outcome {
            Ok(Ok(mut resp)) => {
                let automate = assistant::handed_to_screen(&resp);
                log::info!("agent mode request: answered in {} ms{}", t0.elapsed().as_millis(), if automate { ", screen control" } else { "" });
                assistant::log_exchange(&st, &mut resp, "notch");
                st.emit(ev::ASSISTANT, resp);
                if automate {
                    // the agent is spawned in the background: wait for it to start, then to finish
                    let t1 = Instant::now();
                    while agent::runs_started() == before && t1.elapsed() < AGENT_START_WAIT {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                    }
                    busy = None; // "acting" now, not "thinking"
                    emit(&st, None);
                    // the agent stops itself at its deadline; this bound is only a safety net
                    let t2 = Instant::now();
                    while agent::is_running() && t2.elapsed() < agent::RUN_DEADLINE + Duration::from_secs(30) {
                        tokio::time::sleep(Duration::from_millis(250)).await;
                    }
                }
            }
            Ok(Err(e)) => {
                log::warn!("agent mode request failed after {} ms: {e:#}", t0.elapsed().as_millis());
                st.emit(ev::AGENT, json!({ "kind": "error", "text": e.to_string() }));
            }
            Err(_) => {
                log::warn!("agent mode request timed out after {} s", REQUEST_TIMEOUT.as_secs());
                st.emit(ev::AGENT, json!({ "kind": "error", "text": "That took too long, so I stopped. Try again." }));
            }
        }
        if is_active() {
            next = QUEUED.lock().ok().and_then(|mut q| q.take());
            if let Some(n) = &next {
                set_heard(n);
            }
        }
    }
    drop(busy);
    if is_active() {
        emit(&st, None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(d: &mut Detector, slices: &[(u64, f32)]) -> Vec<Cut> {
        slices.iter().map(|(ms, r)| d.push(*ms, *r)).filter(|c| *c != Cut::None).collect()
    }

    #[test]
    fn utterance_cut_at_a_pause() {
        let mut d = Detector::default();
        let mut v = vec![(300, 0.05); 5]; // 1.5 s "open chrome and search lofi"
        v.extend(vec![(300, 0.0); 3]); // 0.9 s pause
        assert_eq!(feed(&mut d, &v), vec![Cut::Utterance]);
    }

    #[test]
    fn a_single_short_word_still_counts() {
        let mut d = Detector::default();
        let mut v = vec![(300, 0.05); 1]; // "yes"
        v.extend(vec![(300, 0.0); 3]);
        assert_eq!(feed(&mut d, &v), vec![Cut::Utterance]);
    }

    #[test]
    fn silence_and_blips_are_dropped() {
        let mut d = Detector::default();
        assert_eq!(feed(&mut d, &vec![(300, 0.0); 7]), vec![Cut::Silence]);
        let mut v = vec![(100, 0.05); 1]; // a click
        v.extend(vec![(300, 0.0); 6]);
        assert_eq!(feed(&mut d, &v), vec![Cut::Silence]);
    }

    #[test]
    fn a_short_mid_sentence_pause_doesnt_split() {
        let mut d = Detector::default();
        let mut v = vec![(300, 0.05); 3];
        v.extend(vec![(300, 0.0); 2]); // 600 ms hesitation
        v.extend(vec![(300, 0.05); 3]);
        v.extend(vec![(300, 0.0); 3]);
        assert_eq!(feed(&mut d, &v), vec![Cut::Utterance]);
    }

    #[test]
    fn endless_talk_is_cut() {
        let mut d = Detector::default();
        assert!(feed(&mut d, &vec![(300, 0.05); 60]).contains(&Cut::Utterance));
    }

    #[test]
    fn yes_no_multilingual() {
        for y in ["Yes.", "yeah", "Sure!", "do it", "Go ahead", "haan", "Ha", "haan ji", "हाँ", "હા", "Okay, send it"] {
            assert_eq!(parse_yes_no(y), Some(true), "{y}");
        }
        for n in ["No.", "nope", "Cancel", "nahi", "Nahin", "नहीं", "ના", "don't", "no, don't send it", "Yes... no wait"] {
            assert_eq!(parse_yes_no(n), Some(false), "{n}");
        }
        for u in ["what's the weather", "", "hmm", "ha ha", "I need to think about the email draft that Rahul sent me earlier today"] {
            assert_eq!(parse_yes_no(u), None, "{u}");
        }
    }

    #[test]
    fn stop_and_exit_commands() {
        assert!(is_stop_command("Stop!"));
        assert!(is_stop_command("wait wait"));
        assert!(is_stop_command("cancel that"));
        assert!(is_stop_command("ruko"));
        assert!(!is_stop_command("wait for the page to load and then click the first video"));
        assert!(!is_stop_command("open chrome"));
        assert!(is_exit_command("Flo, stop listening."));
        assert!(is_exit_command("exit agent mode"));
        assert!(!is_exit_command("open the agent mode docs and read me the section about turning it off please now"));
    }

    #[test]
    fn wake_word_and_hallucinations() {
        assert_eq!(strip_wake("Hey Flo, open Chrome"), "open Chrome");
        assert_eq!(strip_wake("Flo open Slack"), "open Slack");
        assert_eq!(strip_wake("Flowers for mom"), "Flowers for mom");
        assert_eq!(accept_transcript("Thank you.", 1.0), None);
        assert_eq!(accept_transcript("   ", 1.0), None);
        assert_eq!(accept_transcript("Flo,", 1.0), None);
        assert_eq!(accept_transcript("Open Chrome.", 1.2).as_deref(), Some("Open Chrome."));
    }

    #[test]
    fn classify_by_phase() {
        // idle: requests need real speech; "stop" exits
        assert_eq!(classify(Phase::Listening, "open Chrome", 900), Intent::Request("open Chrome".into()));
        assert_eq!(classify(Phase::Listening, "open", 300), Intent::Ignore);
        assert_eq!(classify(Phase::Listening, "stop", 300), Intent::Exit);
        // acting: stop aborts the agent, other speech is queued, noise ignored
        assert_eq!(classify(Phase::Acting, "stop", 300), Intent::AbortAgent);
        assert_eq!(classify(Phase::Acting, "then open Slack", 900), Intent::Queue("then open Slack".into()));
        assert_eq!(classify(Phase::Acting, "um", 300), Intent::Ignore);
        assert_eq!(classify(Phase::Acting, "stop listening", 700), Intent::Exit);
        // confirming: yes/no answer it; chatter waits for the timeout
        assert_eq!(classify(Phase::Confirming, "yes", 280), Intent::Confirm(true));
        assert_eq!(classify(Phase::Confirming, "nahi", 280), Intent::Confirm(false));
        assert_eq!(classify(Phase::Confirming, "what is this page", 900), Intent::Ignore);
        // lyrics / a long conversation is not a request
        let long = "la ".repeat(50);
        assert_eq!(classify(Phase::Listening, &long, 9000), Intent::Ignore);
    }

    #[test]
    fn busy_is_released_however_a_request_ends() {
        let base = BUSY.load(Ordering::SeqCst);
        {
            let _a = Busy::hold();
            let _b = Busy::hold();
            assert_eq!(BUSY.load(Ordering::SeqCst), base + 2);
        }
        assert_eq!(BUSY.load(Ordering::SeqCst), base);
        // a panicking request still gives its count back
        let r = std::panic::catch_unwind(|| {
            let _c = Busy::hold();
            panic!("boom");
        });
        assert!(r.is_err());
        assert_eq!(BUSY.load(Ordering::SeqCst), base);
    }

    #[test]
    fn idle_exit_only_when_quiet_and_not_busy() {
        assert!(should_idle_exit(Duration::from_secs(IDLE_EXIT_SECS), false));
        assert!(!should_idle_exit(Duration::from_secs(IDLE_EXIT_SECS), true));
        assert!(!should_idle_exit(Duration::from_secs(60), false));
    }
}
