//! Meeting note-taker: live chunked transcription + rolling summary + action items → to-dos.
//!
//! Two tracks, like Fathom / Granola's bot-free desktop apps:
//! - **mic** → "You"
//! - **call audio** (Core Audio process tap, see `sysaudio.rs`) → "Others", split into
//!   "Speaker 1/2/3" by on-device voice embeddings (`speakers.rs`), or a remembered name.
//!
//! Each track is VAD-chunked and transcribed on its own, then merged by timestamp. The audio
//! pipeline itself (timeline, VAD, echo handling, dedupe, speaker labels) is `meetpipe.rs`, so the
//! simulator (`meeting_sim.rs`) tests exactly what runs live. No call audio (older macOS,
//! permission refused, tap failure) → mic-only, as before, with the reason shown in the note.
use crate::audio::Recorder;
use crate::egress::Purpose;
use crate::llm::{self, ChatRequest, LlmConfig};
use crate::meetpipe::{self, CallSeg, Capture, Change, Job, Processor, Transcriber};
use crate::model::*;
use crate::speakers::{self, Cluster, Embedder, Voice};
use crate::state::{MeetingHandle, Shared};
use crate::sysaudio::SystemTap;
use crate::{db, prompts, session, settings as cfg, stt, text};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

const SUMMARY_EVERY_SECS: u64 = 120;
/// final pass sends the whole transcript only below this size; above it, summary + tail
const FULL_TRANSCRIPT_MAX_CHARS: usize = 12_000;
/// with a cloud model (large context) the final pass reads the whole transcript up to this size
const FULL_TRANSCRIPT_MAX_CHARS_CLOUD: usize = 48_000;
pub const YOU: &str = "You";
pub const OTHERS: &str = "Others";
pub const CAPTURE_DUAL: &str = "mic+call";
pub const CAPTURE_MIC: &str = "mic";

static MODEL_DOWNLOADING: AtomicBool = AtomicBool::new(false);

/// Per-meeting speaker state, persisted in `meeting_meta` (JSON).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingMeta {
    /// "mic+call" or "mic"
    pub capture: String,
    /// why call audio isn't captured (mic-only), or a warning about it
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capture_note: Option<String>,
    /// voice clusters of the call track (centroid embeddings stay on this Mac)
    #[serde(default)]
    pub speakers: Vec<Cluster>,
    /// names the conversation reveals for generic labels ("Speaker 2" → "Riya": she introduced
    /// herself / was addressed by name). Shown as a one-click suggestion, never applied silently.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub suggested: BTreeMap<String, String>,
    /// guest names from the calendar invite (Connect with Google → "Take notes"). Offered as
    /// speaker names and given to the summary as hints; never applied silently.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attendees: Vec<String>,
    /// how each name was found (speaker_names.rs): applied / remembered names keyed by the name,
    /// "Name?" suggestions keyed by the generic label; with confidence and source
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub name_info: BTreeMap<String, crate::speaker_names::NameGuess>,
    /// active-speaker readings of the meeting window (participant names + times only)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub screen: Vec<crate::speaker_names::ScreenObs>,
    /// the calendar meeting these notes were taken in (automatic notes / "Take notes")
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event: Option<EventLink>,
}

/// A calendar invite guest, as kept with the note (for names, the summary and a follow-up draft).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Guest {
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub email: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub organizer: bool,
}

/// The calendar meeting a note belongs to.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EventLink {
    pub event_id: String,
    /// event id + start (Home links notes by this)
    pub occurrence: String,
    pub title: String,
    pub start: String,
    pub end: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// the other guests (not declined), organizer marked
    #[serde(default)]
    pub guests: Vec<Guest>,
    /// the user's own name on the invite
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub self_name: Option<String>,
    /// started by automatic notes (not a click)
    #[serde(default)]
    pub auto: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html_link: Option<String>,
}

impl EventLink {
    pub fn from_event(e: &crate::google::CalendarEvent, auto: bool) -> EventLink {
        let name_of = |a: &crate::google::CalendarAttendee| if a.name.trim().is_empty() { crate::google::name_from_email(&a.email) } else { a.name.trim().to_string() };
        EventLink {
            event_id: e.id.clone(),
            occurrence: crate::google::alert_id(e),
            title: e.title.clone(),
            start: e.start.clone(),
            end: e.end.clone(),
            description: e.description.clone(),
            guests: crate::google::others(e).into_iter().map(|a| Guest { name: name_of(a), email: a.email.clone(), organizer: a.organizer }).filter(|g| !g.name.is_empty()).take(30).collect(),
            self_name: e.attendees.iter().find(|a| a.is_self).map(name_of).filter(|n| !n.is_empty()),
            auto,
            html_link: e.html_link.clone(),
        }
    }

    /// Guest names for speaker naming (cleaned, ≤ 20).
    pub fn guest_names(&self) -> Vec<String> {
        clean_attendees(&self.guests.iter().map(|g| g.name.clone()).collect::<Vec<_>>())
    }
}

/// The calendar meeting a note was taken in, for the Notes page.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventInfo {
    pub event_id: String,
    pub occurrence: String,
    pub title: String,
    pub start: String,
    pub end: String,
    pub guests: Vec<Guest>,
    pub auto: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html_link: Option<String>,
}

/// What the Notes UI needs (no embeddings).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingInfo {
    pub capture: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capture_note: Option<String>,
    /// speakers whose voice Flo can remember when renamed
    pub voiced: Vec<String>,
    /// "Speaker 2" → "Riya" guesses from the conversation (confirm with one click)
    pub suggestions: BTreeMap<String, String>,
    /// names of every voice Flo remembers (rename autocomplete)
    pub known_voices: Vec<String>,
    /// guest names from the calendar invite this meeting was started from
    pub attendees: Vec<String>,
    /// label → how sure Flo is of that name and where it came from (voice / screen / intro…)
    pub name_info: BTreeMap<String, crate::speaker_names::NameGuess>,
    /// the calendar meeting these notes belong to
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event: Option<EventInfo>,
}

fn load_meta(st: &Shared, note_id: &str) -> Option<MeetingMeta> {
    st.db.meeting_meta(note_id).ok().flatten().and_then(|j| serde_json::from_str(&j).ok())
}

fn save_meta(st: &Shared, note_id: &str, m: &MeetingMeta) {
    if let Ok(j) = serde_json::to_string(m) {
        let _ = st.db.set_meeting_meta(note_id, &j);
    }
}

pub fn info(st: &Shared, note_id: &str) -> Option<MeetingInfo> {
    let mut known_voices: Vec<String> = crate::speaker_names::known_voices(&st.db).into_iter().map(|v| v.name).collect();
    known_voices.sort_by_key(|n| n.to_lowercase());
    load_meta(st, note_id).map(|m| MeetingInfo {
        capture: m.capture,
        capture_note: m.capture_note,
        voiced: m.speakers.into_iter().filter(|c| !c.centroid.is_empty()).map(|c| c.label).collect(),
        suggestions: m.suggested,
        known_voices,
        attendees: m.attendees,
        name_info: m.name_info,
        event: m.event.map(|e| EventInfo { event_id: e.event_id, occurrence: e.occurrence, title: e.title, start: e.start, end: e.end, guests: e.guests, auto: e.auto, html_link: e.html_link }),
    })
}

fn load_voices(st: &Shared) -> Vec<Voice> {
    crate::speaker_names::load_voices(&st.db)
}

/// When the recording's call track last had speech (unix s; 0 = not yet / no recording).
static CALL_AUDIO_AT: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

/// Seconds since someone on the call was last heard (automatic notes: is the call still on?).
/// None when nothing records or no call audio was heard yet.
pub fn call_audio_ago() -> Option<u64> {
    let at = CALL_AUDIO_AT.load(Ordering::SeqCst);
    (at > 0).then(|| (chrono::Utc::now().timestamp() - at).max(0) as u64)
}

pub fn start(st: Shared, title: Option<String>, project_id: Option<String>) -> Result<Note> {
    start_with_attendees(st, title, project_id, vec![])
}

/// Start meeting notes with the guest names from a calendar invite (google.rs "Take notes").
pub fn start_with_attendees(st: Shared, title: Option<String>, project_id: Option<String>, attendees: Vec<String>) -> Result<Note> {
    let mut attendees = clean_attendees(&attendees);
    let mut event = None;
    if attendees.is_empty() {
        // no invite given: the calendar event happening now names the likely speakers
        if let Some(e) = calendar_event_now(&st) {
            attendees = EventLink::from_event(&e, false).guest_names();
            event = Some(e);
        }
    }
    let link = event.as_ref().map(|e| EventLink::from_event(e, false));
    start_inner(st, title, project_id, attendees, link)
}

/// Notes for a calendar meeting (automatic notes, or "Take notes" on its card): titled with the
/// event, its guests as the speaker candidates from the first second, its invite as context for
/// the summary, and filed under the event on Home. `part` > 1: the call was rejoined.
pub fn start_for_event(st: Shared, e: &crate::google::CalendarEvent, auto: bool, part: u32) -> Result<Note> {
    let link = EventLink::from_event(e, auto);
    let title = if part > 1 { format!("{} (part {part})", e.title) } else { e.title.clone() };
    let occ = link.occurrence.clone();
    let note = start_inner(st.clone(), Some(title), None, link.guest_names(), Some(link))?;
    crate::google::link_note(&st, &occ, &note.id);
    Ok(note)
}

/// The timed calendar event overlapping now (cache only), for notes started without an invite.
fn calendar_event_now(st: &Shared) -> Option<crate::google::CalendarEvent> {
    if !crate::google::calendar_on(&st.settings().google) {
        return None;
    }
    let events = crate::google::cached_events(st);
    let (title, _, _) = crate::speaker_names::overlapping_event(&events, chrono::Utc::now())?;
    let now = chrono::Utc::now();
    events
        .into_iter()
        .filter(|e| e.title == title && !e.all_day && !e.declined)
        .min_by_key(|e| crate::google::start_of(e, &chrono::Utc).map(|s| (now - s).num_seconds().abs()).unwrap_or(i64::MAX))
}

fn start_inner(st: Shared, title: Option<String>, project_id: Option<String>, attendees: Vec<String>, event: Option<EventLink>) -> Result<Note> {
    if st.meeting.lock().is_some() {
        return Err(anyhow!("A meeting is already being recorded"));
    }
    let title = title.filter(|t| !t.trim().is_empty()).unwrap_or_else(|| format!("Meeting {}", chrono::Local::now().format("%b %-d, %H:%M")));
    let note = Note {
        id: db::new_id(),
        title,
        kind: "meeting".into(),
        project_id,
        transcript: vec![],
        summary: String::new(),
        action_items: vec![],
        duration_sec: 0.0,
        created_at: chrono::Local::now().to_rfc3339(),
        live: true,
    };
    st.db.upsert_note(&note)?;
    let app = st.clone();
    let recorder = Recorder::start_as("meeting", move |rms| {
        // only drive the island waveform when no push-to-talk session is active
        if app.session.lock().is_none() {
            app.emit(ev::LEVEL, LevelEvent { rms });
        }
    })?;
    // the other side of the call; any failure → mic-only with the reason in the note
    let tap = match SystemTap::start() {
        Ok(t) => Some(t),
        Err(e) => {
            log::warn!("call audio unavailable, recording mic only: {e}");
            save_meta(&st, &note.id, &MeetingMeta { capture: CAPTURE_MIC.into(), capture_note: Some(e.to_string()), attendees: attendees.clone(), event: event.clone(), ..Default::default() });
            None
        }
    };
    if tap.is_some() {
        save_meta(&st, &note.id, &MeetingMeta { capture: CAPTURE_DUAL.into(), attendees: attendees.clone(), event: event.clone(), ..Default::default() });
        ensure_speaker_model(&st);
    }
    CALL_AUDIO_AT.store(0, Ordering::SeqCst);
    let stop = Arc::new(AtomicBool::new(false));
    let task = tauri::async_runtime::spawn(run_loop(st.clone(), note.id.clone(), recorder, tap, stop.clone()));
    *st.meeting.lock() = Some(MeetingHandle { note_id: note.id.clone(), stop, task });
    st.emit(ev::NOTES, ());
    st.emit(ev::MEETING, MeetingEvent { note_id: note.id.clone(), segment: None, summary: None, elapsed_sec: 0.0, live: true, partial: None, partial_speaker: None });
    st.state(Phase::Listening, Mode::Meeting, Some(note.title.clone()));
    Ok(note)
}

/// After a meeting with Hindi in it, written in Roman letters by Flo's own transliteration: point
/// to the Hinglish model (Settings → Voice → Meeting notes), unless it's on disk, Hinglish isn't
/// wanted, or Flo is about to fetch it by itself.
fn hinglish_model_hint(st: &Shared, hindi_lines: u32) {
    let s = st.settings();
    let installed = stt::model_path(&st.models_dir, stt::HINGLISH_MODEL).is_some_and(|p| p.exists());
    let fetching = stt::hinglish_auto_fetch(&s, stt::this_machine_runs_large(), stt::total_ram_gb(), installed, st.models_dir.join(stt::NO_AUTO_HINGLISH).exists())
        && stt::free_disk_gb(&st.models_dir).is_none_or(|gb| gb >= stt::HINGLISH_FREE_GB);
    if hindi_lines > 0 && !installed && !fetching && !stt::meeting_models(&s).is_empty() {
        st.toast("info", "Hindi was written in Roman letters by Flo. For more precise Hinglish, download Whisper Hinglish in Settings → Voice.".to_string());
    }
}

/// Fetch the 28 MB voice model the first time call audio is captured (background, once).
fn ensure_speaker_model(st: &Shared) {
    if !speakers::supported() || speakers::model_installed(&st.models_dir) || MODEL_DOWNLOADING.swap(true, Ordering::SeqCst) {
        return;
    }
    let st = st.clone();
    tauri::async_runtime::spawn(async move {
        log::info!("downloading speaker model");
        match speakers::download_model(&st.egress, &st.models_dir).await {
            Ok(()) => log::info!("speaker model ready"),
            Err(e) => log::warn!("speaker model download failed: {e}"),
        }
        MODEL_DOWNLOADING.store(false, Ordering::SeqCst);
    });
}

/// Stops recording immediately (the mic closes within ~200 ms) and returns at once; the last
/// chunk + final summary + action items are written in the background. Safe to call twice.
pub async fn stop(st: Shared) -> Result<Note> {
    let taken = st.meeting.lock().take();
    let Some(h) = taken else {
        // already stopped (e.g. double click) — not an error
        return st
            .db
            .list_notes()?
            .into_iter()
            .find(|n| n.kind == "meeting")
            .ok_or_else(|| anyhow!("No meeting is running"));
    };
    h.stop.store(true, Ordering::SeqCst);
    CALL_AUDIO_AT.store(0, Ordering::SeqCst);
    let mut note = st.db.get_note(&h.note_id)?.ok_or_else(|| anyhow!("note missing"))?;
    note.live = false;
    st.db.upsert_note(&note)?;
    st.emit(ev::NOTES, ());
    st.emit(ev::MEETING, MeetingEvent { note_id: note.id.clone(), segment: None, summary: None, elapsed_sec: note.duration_sec, live: false, partial: None, partial_speaker: None });
    st.state(Phase::Thinking, Mode::Meeting, Some("Writing summary…".into()));
    let st2 = st.clone();
    tauri::async_runtime::spawn(async move {
        let _ = h.task.await;
        st2.finish(Phase::Done, Mode::Meeting, None);
    });
    Ok(note)
}

// ── capture loop + transcription worker ────────────────────────────────────

/// Messages to the transcription worker.
enum Msg {
    Job(Job),
    Finish(tokio::sync::oneshot::Sender<WorkerDone>),
}

/// What the worker hands back when the meeting stops.
#[derive(Default)]
struct WorkerDone {
    call_segs: Vec<CallSeg>,
    clusters: Vec<Cluster>,
    stats: meetpipe::Stats,
    turns: Vec<crate::speaker_names::Turn>,
    mic_embs: Vec<Vec<f32>>,
}

type LiveNamesRef = Arc<parking_lot::Mutex<crate::speaker_names::LiveNames>>;

/// The app's speech engine for the worker thread (on-device Whisper or the cloud STT).
struct AppStt(Shared);

impl Transcriber for AppStt {
    fn transcribe(&mut self, samples: &[f32], context: &str, req: &meetpipe::LangReq) -> Result<stt::Heard> {
        let st = &self.0;
        let s = st.settings();
        if s.stt_provider != "local" {
            // a cloud engine: the language set in Settings, or its own detection
            let text = tauri::async_runtime::block_on(session::transcribe_lang(st, samples.to_vec(), context, req.fixed.map(String::from)))?;
            return Ok(stt::Heard { raw: text.clone(), text, lang: req.fixed.unwrap_or_default().to_string() });
        }
        let path = stt::model_path(&st.models_dir, &s.stt_model).ok_or_else(|| anyhow!("Unknown speech model {}", s.stt_model))?;
        *st.whisper.auto_langs.lock() = stt::allowed_languages(&s.auto_languages);
        // the user's words bias the model, as in dictation (newest first, bounded)
        let vocab: Vec<String> = st.db.list_dictionary_recent().unwrap_or_default().into_iter().map(|d| d.replacement.unwrap_or(d.word)).collect();
        let prompt = crate::dictation::stt_prompt(&vocab, context);
        st.whisper.meeting_clip(&path, samples, req.fixed.unwrap_or("auto"), &prompt, req.hint, req.hindi, req.preview)
    }
}

/// Capture never waits for speech-to-text: every 300 ms it drains both devices, cuts sentences
/// (meetpipe::Capture) and queues them for the worker thread, which transcribes, removes echoes,
/// labels speakers and writes the note. A slow clip only delays text, never timing or VAD.
async fn run_loop(st: Shared, note_id: String, recorder: Recorder, tap: Option<SystemTap>, stop: Arc<AtomicBool>) {
    let started = Instant::now();
    let mut last_summary = Instant::now();
    let mut summarized_upto = 0usize; // transcript segments already folded into the summary
    let mut committed_at_summary = 0usize;
    let dual = tap.is_some();
    let recorder = Arc::new(parking_lot::Mutex::new(Some(recorder)));
    let tap = Arc::new(parking_lot::Mutex::new(tap));
    let settings = st.settings();
    let lang = { let l = settings.language.clone(); (l != "auto" && !l.is_empty()).then_some(l) };
    // live previews only with on-device STT (cloud previews would cost per call)
    let local = settings.stt_provider == "local";
    if local {
        // load the model now: the first sentence must not wait for a cold load
        if let Some(path) = stt::model_path(&st.models_dir, &settings.stt_model) {
            let w = st.whisper.clone();
            tauri::async_runtime::spawn_blocking(move || w.warm(&path));
        }
    }
    let inflight = Arc::new(AtomicUsize::new(0));
    let committed = Arc::new(AtomicUsize::new(0));
    // speaker naming: who the meeting window shows as speaking while the call track talks
    let live_names: LiveNamesRef = Arc::new(parking_lot::Mutex::new(crate::speaker_names::LiveNames {
        attendees: load_meta(&st, &note_id).map(|m| m.attendees).unwrap_or_default(),
        ..Default::default()
    }));
    let call_speaking = Arc::new(AtomicBool::new(false));
    let mut call_quiet_since = Instant::now();
    if dual {
        tauri::async_runtime::spawn(crate::meet_screen::run(live_names.clone(), started, stop.clone(), call_speaking.clone(), settings.attention_denylist.clone()));
    }
    let (tx, rx) = std::sync::mpsc::channel::<Msg>();
    if let Err(e) = spawn_worker(st.clone(), note_id.clone(), dual, lang, rx, inflight.clone(), committed.clone(), stop.clone(), started, live_names.clone()) {
        log::error!("meeting worker didn't start: {e}");
    }
    let mut capture = Capture::new(dual);
    let mut heard_call = false;
    let mut max_queue = 0usize;
    loop {
        tokio::time::sleep(Duration::from_millis(crate::livetx::SLICE_MS)).await;
        let stopping = stop.load(Ordering::SeqCst);
        let mic_slice = {
            let mut g = recorder.lock();
            if stopping {
                g.take().map(|r| r.stop()).unwrap_or_default()
            } else {
                g.as_ref().map(|r| r.take_samples()).unwrap_or_default()
            }
        };
        let call_slice = if dual {
            let mut g = tap.lock();
            heard_call |= g.as_ref().map(|t| t.heard_anything()).unwrap_or(false);
            if stopping {
                g.take().map(|t| t.stop()).unwrap_or_default()
            } else {
                g.as_ref().map(|t| t.take_samples()).unwrap_or_default()
            }
        } else {
            vec![]
        };
        let elapsed = started.elapsed().as_secs_f64();
        // the screen sampler only looks while someone on the call is (or just was) talking
        if dual {
            if crate::audio::rms(&call_slice) >= crate::livetx::SPEECH_RMS {
                call_quiet_since = Instant::now();
                CALL_AUDIO_AT.store(chrono::Utc::now().timestamp(), Ordering::SeqCst);
                call_speaking.store(true, Ordering::SeqCst);
            } else if call_quiet_since.elapsed() > Duration::from_millis(1500) {
                call_speaking.store(false, Ordering::SeqCst);
            }
        }
        let mut jobs = capture.push(&mic_slice, &call_slice, elapsed);
        if stopping {
            jobs.extend(capture.flush());
        }
        for job in jobs {
            // a preview only when the worker is idle (finals always go first, nothing piles up)
            if job.chunk.partial && (!local || stopping || inflight.load(Ordering::SeqCst) > 0) {
                continue;
            }
            let q = inflight.fetch_add(1, Ordering::SeqCst) + 1;
            if q > max_queue && q >= 4 {
                max_queue = q;
                log::warn!("meeting: transcription is {q} chunks behind");
            }
            if tx.send(Msg::Job(job)).is_err() {
                inflight.fetch_sub(1, Ordering::SeqCst);
            }
        }

        if stopping {
            let (otx, orx) = tokio::sync::oneshot::channel();
            let done = if tx.send(Msg::Finish(otx)).is_ok() { orx.await.ok() } else { None };
            let done = done.unwrap_or_default();
            log::info!("meeting: finished after {elapsed:.0}s: {}", serde_json::to_string(&done.stats).unwrap_or_default());
            hinglish_model_hint(&st, done.stats.hindi_lines);
            let screen = live_names.lock().screen.clone();
            if dual {
                speaker_pass(&st, &note_id, done, screen, heard_call).await;
            } else {
                learn_self_voice(&st, &done.mic_embs);
            }
            finalize(&st, &note_id, elapsed, summarized_upto).await;
            break;
        }
        let n = committed.load(Ordering::SeqCst);
        if n >= committed_at_summary + 2 && last_summary.elapsed() >= Duration::from_secs(SUMMARY_EVERY_SECS) {
            if let Some((sum, upto)) = summarize_incremental(&st, &note_id, summarized_upto).await {
                summarized_upto = upto;
                if let Ok(Some(mut n)) = st.db.get_note(&note_id) {
                    n.summary = sum.summary.clone();
                    // early action items survive into long meetings' final pass
                    n.action_items = merge_action_items(&n.action_items, &sum.action_items);
                    let _ = st.db.upsert_note(&n);
                }
                st.emit(ev::MEETING, MeetingEvent { note_id: note_id.clone(), segment: None, summary: Some(sum.summary), elapsed_sec: elapsed, live: true, partial: None, partial_speaker: None });
            }
            last_summary = Instant::now();
            committed_at_summary = n;
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn spawn_worker(
    st: Shared,
    note_id: String,
    dual: bool,
    lang: Option<String>,
    rx: std::sync::mpsc::Receiver<Msg>,
    inflight: Arc<AtomicUsize>,
    committed: Arc<AtomicUsize>,
    stop: Arc<AtomicBool>,
    started: Instant,
    live_names: LiveNamesRef,
) -> std::io::Result<()> {
    std::thread::Builder::new().name("flo-meeting-stt".into()).spawn(move || {
        let mut p = Processor::new(AppStt(st.clone()), dual, load_voices(&st), lang);
        p.hindi = stt::HindiScript::from_setting(&st.settings().meeting_hindi);
        let mut next_embedder_try = Instant::now();
        let mut last_error_toast: Option<Instant> = None;
        while let Ok(msg) = rx.recv() {
            match msg {
                Msg::Job(job) => {
                    // the voice model may finish downloading mid-meeting
                    if dual && p.embedder.is_none() && speakers::supported() && Instant::now() >= next_embedder_try {
                        next_embedder_try = Instant::now() + Duration::from_secs(10);
                        p.embedder = Embedder::load(&st.models_dir).map(Arc::new);
                        if p.embedder.is_some() {
                            log::info!("meeting: speaker model loaded");
                        }
                    }
                    let seen = p.turns.len();
                    let mut changes = p.handle(job);
                    // live names: new turns feed the screen vote; call lines show a confident name
                    if p.turns.len() > seen {
                        let mut ln = live_names.lock();
                        for t in &p.turns[seen..] {
                            ln.add_turn(t.clone());
                        }
                        name_changes(&ln, &mut changes);
                    } else {
                        name_changes(&live_names.lock(), &mut changes);
                    }
                    apply_changes(&st, &note_id, &stop, started.elapsed().as_secs_f64(), changes, &committed, &mut last_error_toast);
                    inflight.fetch_sub(1, Ordering::SeqCst);
                }
                Msg::Finish(reply) => {
                    let _ = reply.send(WorkerDone {
                        call_segs: std::mem::take(&mut p.call_segs),
                        clusters: std::mem::take(&mut p.clusters),
                        stats: p.stats.clone(),
                        turns: std::mem::take(&mut p.turns),
                        mic_embs: std::mem::take(&mut p.mic_embs),
                    });
                    break;
                }
            }
        }
    })?;
    Ok(())
}

/// Live names: a call line / preview labelled "Speaker 2" shows the participant the meeting
/// window confidently names for that voice ("Rahul"). The post-call pass decides for good.
pub fn name_changes(names: &crate::speaker_names::LiveNames, changes: &mut [Change]) {
    for ch in changes.iter_mut() {
        match ch {
            Change::Add(s) => {
                if let Some(sp) = s.speaker.as_mut() {
                    *sp = names.display(sp);
                }
            }
            Change::Partial { speaker, .. } => *speaker = names.display(speaker),
            _ => {}
        }
    }
}

/// Write the worker's results into the note and tell the UI.
fn apply_changes(st: &Shared, note_id: &str, stop: &AtomicBool, elapsed: f64, changes: Vec<Change>, committed: &AtomicUsize, last_error_toast: &mut Option<Instant>) {
    for ch in changes {
        let stopped = stop.load(Ordering::SeqCst);
        match ch {
            Change::Add(segm) => {
                if let Ok(Some(mut n)) = st.db.get_note(note_id) {
                    insert_sorted(&mut n.transcript, segm.clone());
                    if stopped {
                        n.live = false; // never resurrect a stopped meeting (checked at write time)
                    }
                    n.duration_sec = n.duration_sec.max(elapsed);
                    let _ = st.db.upsert_note(&n);
                }
                committed.fetch_add(1, Ordering::SeqCst);
                st.emit(ev::MEETING, MeetingEvent { note_id: note_id.to_string(), segment: Some(segm), summary: None, elapsed_sec: elapsed, live: !stopped, partial: Some(String::new()), partial_speaker: None });
            }
            Change::Remove(segm) => {
                if let Ok(Some(mut n)) = st.db.get_note(note_id) {
                    // by time + words (the stored label may be a live name, see `name_changes`)
                    n.transcript.retain(|s| !(s.t == segm.t && s.text == segm.text));
                    let _ = st.db.upsert_note(&n);
                }
                st.emit(ev::NOTES, ());
            }
            Change::Partial { text, speaker } => {
                if !stopped {
                    st.emit(ev::MEETING, MeetingEvent { note_id: note_id.to_string(), segment: None, summary: None, elapsed_sec: elapsed, live: true, partial: Some(text), partial_speaker: Some(speaker) });
                }
            }
            Change::Error(e) => {
                // once a minute at most: a broken engine must not bury the screen in toasts
                if last_error_toast.is_none_or(|t| t.elapsed() >= Duration::from_secs(60)) {
                    *last_error_toast = Some(Instant::now());
                    st.toast("error", format!("Meeting transcription: {e}"));
                }
            }
        }
    }
}

/// After the call: re-cluster all call segments (better than the live, greedy assignment), name
/// clusters from remembered voices, relabel the transcript and store the clusters for renaming.
async fn speaker_pass(st: &Shared, note_id: &str, done: WorkerDone, screen: Vec<crate::speaker_names::ScreenObs>, heard_call: bool) {
    let WorkerDone { call_segs: mut segs, clusters: live_clusters, turns, mic_embs, .. } = done;
    let mut meta = load_meta(st, note_id).unwrap_or_else(|| MeetingMeta { capture: CAPTURE_DUAL.into(), ..Default::default() });
    if !heard_call {
        meta.capture_note = Some("Call audio was silent. If others spoke, allow Flo in System Settings → Privacy & Security → Screen & System Audio Recording.".into());
    }
    learn_self_voice(st, &mic_embs);
    meta.screen = screen.iter().rev().take(3000).rev().cloned().collect();
    let voices = load_voices(st);
    // embeddings for clips recorded before the voice model was ready
    if segs.iter().any(|s| s.emb.is_none() && s.audio.is_some()) {
        let dir = st.models_dir.clone();
        segs = tokio::task::spawn_blocking(move || {
            if let Some(e) = Embedder::load(&dir) {
                meetpipe::fill_embeddings(&mut segs, &e);
            }
            segs
        })
        .await
        .unwrap_or_default();
    }
    let Some((final_labels, mut clusters)) = meetpipe::recluster(&segs, &voices) else {
        meta.speakers = live_clusters;
        save_meta(st, note_id, &meta);
        return;
    };
    if let Ok(Some(mut n)) = st.db.get_note(note_id) {
        apply_call_labels(&mut n.transcript, &final_labels);
        let settings = st.settings();
        // the user under every name they may show up as: Settings, and their name on the invite
        let mut self_names: Vec<String> = [settings.user_name.clone()].into_iter().filter(|s| !s.trim().is_empty()).collect();
        if let Some(n) = meta.event.as_ref().and_then(|e| e.self_name.clone()) {
            if !self_names.iter().any(|s| s.eq_ignore_ascii_case(&n)) {
                self_names.push(n);
            }
        }
        let named = name_speakers(&mut n.transcript, &mut clusters, &final_labels, &turns, &screen, &voices, &meta.attendees, &self_names);
        if !named.outcome.apply.is_empty() || !named.outcome.suggest.is_empty() || !named.outcome.demoted.is_empty() {
            log::info!("meeting: speaker names: {}", serde_json::to_string(&named.outcome).unwrap_or_default());
        }
        meta.suggested = named.suggested;
        meta.name_info = named.name_info;
        let _ = st.db.upsert_note(&n);
    }
    meta.speakers = clusters;
    save_meta(st, note_id, &meta);
    st.emit(ev::NOTES, ());
}

/// Store / refresh the user's own voice from this meeting's mic track (`SELF_VOICE`), so the call
/// app playing it back is labelled "You" and never confused with someone else.
fn learn_self_voice(st: &Shared, mic_embs: &[Vec<f32>]) {
    let voices = load_voices(st);
    let stored = voices.iter().find(|v| v.name == crate::speaker_names::SELF_VOICE);
    if let Some((emb, n)) = crate::speaker_names::self_voice_update(stored, mic_embs) {
        let _ = st.db.upsert_voice(crate::speaker_names::SELF_VOICE, &speakers::embedding_to_blob(&emb), n);
    }
}

/// Result of naming a meeting's speakers.
#[derive(Debug, Clone, Default)]
pub struct Named {
    pub outcome: crate::speaker_names::NamingOutcome,
    /// generic label → "Name?" (one-click confirm in the note)
    pub suggested: BTreeMap<String, String>,
    pub name_info: BTreeMap<String, crate::speaker_names::NameGuess>,
}

/// After re-clustering: decide names from voice memory, the meeting window, intros and the
/// calendar (speaker_names::resolve) and write the confident ones into the transcript and the
/// clusters. Pure (the live pass and the simulator share it).
#[allow(clippy::too_many_arguments)]
pub fn name_speakers(
    transcript: &mut [MeetingSegment],
    clusters: &mut [Cluster],
    final_labels: &[(f64, Option<String>)],
    turns: &[crate::speaker_names::Turn],
    screen: &[crate::speaker_names::ScreenObs],
    voices: &[Voice],
    attendees: &[String],
    self_names: &[String],
) -> Named {
    use crate::speaker_names as sn;
    // turns with their final labels (call turns by start time; your turns stay "You")
    let final_turns: Vec<sn::Turn> = turns
        .iter()
        .filter_map(|t| {
            if t.label == YOU {
                return Some(t.clone());
            }
            let l = final_labels.iter().find(|(s, _)| (*s - t.t0).abs() < 1e-6)?.1.clone()?;
            Some(sn::Turn { label: l, ..t.clone() })
        })
        .collect();
    let input = sn::NamingInput {
        clusters: clusters.to_vec(),
        voices: voices.to_vec(),
        turns: final_turns,
        screen: screen.to_vec(),
        lines: transcript.iter().filter_map(|s| Some((s.speaker.clone()?, s.text.clone()))).collect(),
        attendees: attendees.to_vec(),
        self_names: self_names.to_vec(),
    };
    let outcome = sn::resolve(&input);
    let mut named = Named { outcome: outcome.clone(), ..Default::default() };
    let relabel = |from: &str, to: &str, transcript: &mut [MeetingSegment], clusters: &mut [Cluster]| {
        speakers::relabel(transcript, from, to);
        for c in clusters.iter_mut().filter(|c| c.label == from) {
            c.label = to.to_string();
        }
    };
    // remembered names the screen contradicts go back to "Speaker N" (+ a suggestion)
    let mut suggest = outcome.suggest.clone();
    for old in outcome.demoted.keys() {
        let taken: Vec<String> = clusters.iter().map(|c| c.label.clone()).collect();
        let generic = speakers::next_speaker_label(&taken.iter().map(String::as_str).collect::<Vec<_>>());
        relabel(old, &generic, transcript, clusters);
        if let Some(g) = suggest.remove(old) {
            suggest.insert(generic, g);
        }
    }
    for (label, g) in &outcome.apply {
        relabel(label, &g.name, transcript, clusters);
        named.name_info.insert(g.name.clone(), g.clone());
    }
    for (label, g) in &outcome.kept {
        named.name_info.insert(label.clone(), g.clone());
    }
    for (label, g) in suggest {
        named.suggested.insert(label.clone(), g.name.clone());
        named.name_info.insert(label, g);
    }
    named
}

/// Relabel call segments (matched by start time; mic segments untouched). Segments without a
/// label inherit the previous call speaker.
pub fn apply_call_labels(transcript: &mut [MeetingSegment], labels: &[(f64, Option<String>)]) {
    let mut prev: Option<String> = None;
    for s in transcript.iter_mut() {
        if s.speaker.as_deref() == Some(YOU) {
            continue;
        }
        if let Some((_, l)) = labels.iter().find(|(t, _)| *t == s.t) {
            if let Some(l) = l.clone().or_else(|| prev.clone()) {
                s.speaker = Some(l);
            }
        }
        prev = s.speaker.clone();
    }
}

/// Rename a speaker in one note ("Speaker 2" → "Rahul"); Flo remembers the voice for next time.
pub fn rename_speaker(st: &Shared, note_id: &str, from: &str, to: &str) -> Result<Note> {
    let to = text::truncate_chars(to.trim(), 40);
    if to.is_empty() || to == from {
        return st.db.get_note(note_id)?.ok_or_else(|| anyhow!("note missing"));
    }
    let mut n = st.db.get_note(note_id)?.ok_or_else(|| anyhow!("note missing"))?;
    speakers::relabel(&mut n.transcript, from, &to);
    // generic labels in the summary / action items follow the rename
    if from.starts_with("Speaker ") || from == OTHERS {
        n.summary = replace_word(&n.summary, from, &to);
        n.action_items = n.action_items.iter().map(|a| replace_word(a, from, &to)).collect();
    }
    st.db.upsert_note(&n)?;
    if rename_note_todos(&st.db, note_id, from, &to)? > 0 {
        st.emit(ev::TODOS, ());
    }
    if let Some(mut meta) = load_meta(st, note_id) {
        if let Some(i) = meta.speakers.iter().position(|c| c.label == from) {
            let moved = meta.speakers.remove(i);
            let (moved_centroid, moved_count) = (moved.centroid.clone(), moved.count);
            match meta.speakers.iter_mut().find(|c| c.label == to) {
                Some(c) => {
                    c.centroid = speakers::blend(&c.centroid, c.count, &moved.centroid, moved.count);
                    c.count += moved.count;
                }
                None => meta.speakers.push(Cluster { label: to.clone(), ..moved }),
            }
            // naming / confirming a voice trains Flo's voice memory (the moved cluster's share)
            if to != YOU && !moved_centroid.is_empty() {
                crate::speaker_names::train_voice(&st.db, &to, &moved_centroid, moved_count)?;
            }
            meta.suggested.remove(from);
            meta.name_info.remove(from);
            meta.name_info.insert(to.clone(), crate::speaker_names::NameGuess { name: to.clone(), confidence: 1.0, source: crate::speaker_names::Source::User });
            save_meta(st, note_id, &meta);
        } else if meta.suggested.remove(from).is_some() | meta.name_info.remove(from).is_some() {
            save_meta(st, note_id, &meta);
        }
    }
    st.emit(ev::NOTES, ());
    Ok(n)
}

/// "Yes, that's Rahul": confirm a name Flo found (screen / remembered voice) without renaming it.
/// Flo remembers the voice under that name and the name counts as the user's.
pub fn confirm_speaker(st: &Shared, note_id: &str, label: &str) -> Result<Note> {
    let n = st.db.get_note(note_id)?.ok_or_else(|| anyhow!("note missing"))?;
    if let Some(mut meta) = load_meta(st, note_id) {
        if let Some(c) = meta.speakers.iter().find(|c| c.label == label) {
            if label != YOU && !is_generic_label(label) && !c.centroid.is_empty() {
                crate::speaker_names::train_voice(&st.db, label, &c.centroid, c.count)?;
            }
        }
        if !is_generic_label(label) {
            meta.name_info.insert(label.to_string(), crate::speaker_names::NameGuess { name: label.to_string(), confidence: 1.0, source: crate::speaker_names::Source::User });
            save_meta(st, note_id, &meta);
        }
    }
    st.emit(ev::NOTES, ());
    Ok(n)
}

/// The meeting's to-dos follow a speaker rename ("Speaker 2: send deck" → "Rahul: send deck").
fn rename_note_todos(db: &crate::db::Db, note_id: &str, from: &str, to: &str) -> Result<usize> {
    let mut changed = 0;
    for t in db.todos_for_note(note_id)? {
        let owned = t.person.as_deref() == Some(from);
        let title = replace_word(&t.title, from, to);
        if owned || title != t.title {
            let person = if owned { Some(to) } else { t.person.as_deref() };
            db.set_todo_title_person(&t.id, &title, person)?;
            changed += 1;
        }
    }
    Ok(changed)
}

// ── pure helpers (unit tested) ─────────────────────────────────────────────

/// Insert keeping the transcript ordered by start time (stable for equal times).
pub fn insert_sorted(v: &mut Vec<MeetingSegment>, s: MeetingSegment) {
    let at = v.iter().rposition(|x| x.t <= s.t).map(|i| i + 1).unwrap_or(0);
    v.insert(at, s);
}

/// "Rahul: send the deck by Friday" → (Some("Rahul"), "send the deck by Friday").
/// Only a short name-like prefix counts as an owner (not "Note: …" sentences or times like "10:30").
pub fn split_owner(item: &str) -> (Option<String>, String) {
    let item = item.trim();
    if let Some((who, task)) = item.split_once(':') {
        // "10:30" is a time, not "Owner: task"
        if task.starts_with(|c: char| c.is_ascii_digit()) {
            return (None, item.to_string());
        }
        let who = who.trim();
        let task = task.trim();
        let name_like = !who.is_empty()
            && who.chars().count() <= 30
            && who.split_whitespace().count() <= 3
            && who.chars().next().is_some_and(|c| c.is_alphabetic())
            && who.chars().all(|c| c.is_alphanumeric() || c == ' ' || c == '.' || c == '-' || c == '\'');
        if name_like && !task.is_empty() {
            return (Some(who.to_string()), task.to_string());
        }
    }
    (None, item.to_string())
}

/// Turn a meeting's action items into to-dos linked to the note: the owner becomes the to-do's
/// person, a deadline in the words dates it (and arms a reminder, via `insert_todo`), and the
/// meeting is the "why". Your own items read as plain tasks; others' keep "Owner: task".
/// Returns how many were added (duplicates of open to-dos are skipped). Task capture: Essential
/// files only your own (or unowned) items; every level skips vague ones like "follow up".
pub fn file_action_items(db: &crate::db::Db, n: &Note, items: &[String], level: crate::capture::CaptureLevel) -> Result<usize> {
    let mut existing = db.open_todo_titles()?;
    let mut added = 0;
    for item in items {
        let (owner, task) = split_owner(item);
        let mine = owner.as_deref().map(|o| o.eq_ignore_ascii_case(YOU) || o.eq_ignore_ascii_case("me")).unwrap_or(true);
        if !crate::capture::keep_meeting_item(mine, &task, level) {
            continue;
        }
        let title = if mine { task.clone() } else { format!("{}: {task}", owner.as_deref().unwrap_or_default()) };
        if title.is_empty() || text::is_duplicate_todo(&title, &existing) || text::is_duplicate_todo(&task, &existing) {
            continue;
        }
        let t = Todo {
            id: crate::db::new_id(),
            title: title.clone(),
            reason: Some(format!("Action item from the meeting “{}”", n.title)),
            person: if mine { None } else { owner },
            source: "meeting".into(),
            status: "open".into(),
            project_id: n.project_id.clone(),
            created_at: crate::db::now(),
            note_id: Some(n.id.clone()),
            ..Default::default()
        };
        db.insert_todo(&t)?;
        existing.push(title);
        added += 1;
    }
    Ok(added)
}

/// Replace whole-word occurrences ("Speaker 2" but not "Speaker 21").
fn replace_word(s: &str, from: &str, to: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find(from) {
        let before_ok = rest[..i].chars().last().map(|c| !c.is_alphanumeric()).unwrap_or(true);
        let after = &rest[i + from.len()..];
        let after_ok = after.chars().next().map(|c| !c.is_alphanumeric()).unwrap_or(true);
        out.push_str(&rest[..i]);
        out.push_str(if before_ok && after_ok { to } else { from });
        rest = after;
    }
    out.push_str(rest);
    out
}

/// Extra system-prompt lines: who `You` is, and (final pass) ask for names the conversation
/// reveals for `Speaker N` labels.
pub fn speaker_prompt_extra(user_name: &str, final_pass: bool) -> String {
    let mut out = String::new();
    let name = user_name.trim();
    if !name.is_empty() {
        out.push_str(&format!("\n`You` is {}, the user. Keep the label `You` in action items.", text::truncate_chars(name, 40)));
    }
    if final_pass {
        out.push_str(
            "\nIf the conversation makes a `Speaker N`'s real name certain (they introduce themselves, or are addressed by name and answer), \
add \"speakerNames\":{\"Speaker N\":\"Name\"} to the JSON. Only first names actually spoken in the transcript; omit anyone you are unsure about.",
        );
    }
    out
}

/// Calendar guest names, cleaned for prompts and the rename list: trimmed, name-like, ≤ 40 chars,
/// no duplicates, at most 20.
pub fn clean_attendees(names: &[String]) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for n in names {
        let n = n.split_whitespace().collect::<Vec<_>>().join(" ");
        let n = n.trim_matches(|c: char| c == '"' || c == '\'' || c == ',');
        if n.is_empty() || n.chars().count() > 40 || n.contains('@') || !n.chars().next().is_some_and(|c| c.is_alphabetic()) {
            continue;
        }
        if out.iter().any(|o| o.eq_ignore_ascii_case(n)) {
            continue;
        }
        out.push(n.to_string());
        if out.len() >= 20 {
            break;
        }
    }
    out
}

/// Extra system-prompt line naming the calendar guests, so `Speaker N` names can come from them.
pub fn attendee_prompt_extra(attendees: &[String]) -> String {
    let a = clean_attendees(attendees);
    if a.is_empty() {
        return String::new();
    }
    format!(
        "\nThe calendar invite lists these guests: {}. They are likely speakers, but only use a name for a `Speaker N` when the transcript supports it.",
        a.join(", ")
    )
}

/// Parse the model's `speakerNames` and keep only safe suggestions: the label is a generic one
/// still present in the transcript, the name is short and name-like, and no two labels get the
/// same name (or a name someone in the transcript already has).
pub fn speaker_name_suggestions(raw: &str, transcript: &[MeetingSegment]) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    let Some(j) = text::extract_json_object(raw) else { return out };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&j) else { return out };
    let Some(map) = v.get("speakerNames").and_then(|m| m.as_object()) else { return out };
    let present: Vec<&str> = transcript.iter().filter_map(|s| s.speaker.as_deref()).collect();
    let mut used: Vec<String> = present.iter().filter(|l| !is_generic_label(l)).map(|l| l.to_lowercase()).collect();
    for (label, name) in map {
        let Some(name) = name.as_str().map(str::trim) else { continue };
        let name_like = !name.is_empty()
            && name.chars().count() <= 30
            && name.split_whitespace().count() <= 3
            && name.chars().next().is_some_and(|c| c.is_alphabetic())
            && name.chars().all(|c| c.is_alphabetic() || c == ' ' || c == '.' || c == '-' || c == '\'')
            && !is_generic_label(name)
            && !name.eq_ignore_ascii_case(YOU);
        if !name_like || !is_generic_label(label) || !present.contains(&label.as_str()) || used.contains(&name.to_lowercase()) {
            continue;
        }
        used.push(name.to_lowercase());
        out.insert(label.clone(), name.to_string());
    }
    out
}

/// "Speaker 3" / "Others": labels that are placeholders, not names.
pub fn is_generic_label(l: &str) -> bool {
    l == OTHERS || l.strip_prefix("Speaker ").is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
}

fn seg_line(s: &MeetingSegment) -> String {
    let ts = format!("[{:02}:{:02}]", (s.t as u64) / 60, (s.t as u64) % 60);
    match s.speaker.as_deref() {
        Some(w) if !w.is_empty() => format!("{ts} {w}: {}", s.text),
        _ => format!("{ts} {}", s.text),
    }
}

/// Transcript for the LLM, with speakers ("[01:15] Rahul: Ship it") so action items get owners.
pub fn transcript_text(n: &Note) -> String {
    n.transcript.iter().map(seg_line).collect::<Vec<_>>().join("\n")
}

/// Rolling update: previous summary + only segments after `from` (flat cost per update).
async fn summarize_incremental(st: &Shared, note_id: &str, from: usize) -> Option<(prompts::ParsedSummary, usize)> {
    let n = st.db.get_note(note_id).ok()??;
    if n.transcript.len() <= from {
        return None;
    }
    let new_lines = n.transcript[from..].iter().map(seg_line).collect::<Vec<_>>().join("\n");
    let user = prompts::meeting_update_user(&n.summary, &new_lines);
    let meta = load_meta(st, note_id).unwrap_or_default();
    let (parsed, _) = summarize_with(st, &user, false, 700, &meta).await?;
    Some((parsed, n.transcript.len()))
}

/// Final pass. Returns the summary, the raw output and whether this was a long meeting (rolling
/// summary + the lines after it, instead of the whole transcript).
async fn summarize(st: &Shared, note_id: &str, summarized_upto: usize) -> Option<(prompts::ParsedSummary, String, bool)> {
    let n = st.db.get_note(note_id).ok()??;
    if n.transcript.is_empty() {
        return None;
    }
    let full = transcript_text(&n);
    // detailed notes want the whole transcript: up to ~an hour with a cloud model
    let max = if cfg::is_cloud_llm(&st.settings().llm_provider) { FULL_TRANSCRIPT_MAX_CHARS_CLOUD } else { FULL_TRANSCRIPT_MAX_CHARS };
    let long = full.len() > max && !n.summary.trim().is_empty();
    let user = if !long {
        text::truncate_chars(&full, 60_000)
    } else {
        // long meeting: the rolling summary covers everything up to `summarized_upto` → send it,
        // the action items found so far, and every line after it (the newest 12k chars at most)
        let from = summarized_upto.min(n.transcript.len());
        let rest = n.transcript[from..].iter().map(seg_line).collect::<Vec<_>>().join("\n");
        let tail: String = rest.chars().rev().take(FULL_TRANSCRIPT_MAX_CHARS).collect::<Vec<_>>().into_iter().rev().collect();
        prompts::meeting_final_long_user(&n.summary, &n.action_items, &tail)
    };
    let meta = load_meta(st, note_id).unwrap_or_default();
    summarize_with(st, &user, true, 3000, &meta).await.map(|(p, raw)| (p, raw, long))
}

/// Action items of a long meeting: the final pass's list plus earlier ones it didn't repeat.
pub fn merge_action_items(earlier: &[String], latest: &[String]) -> Vec<String> {
    let mut out: Vec<String> = latest.iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    for e in earlier {
        let e = e.trim();
        if !e.is_empty() && !text::is_duplicate_todo(e, &out) {
            out.push(e.to_string());
        }
    }
    out
}

/// The user's name for `You`: Settings, else their name on the calendar invite.
pub fn user_display_name(s: &crate::model::Settings, meta: &MeetingMeta) -> String {
    let n = s.user_name.trim();
    if !n.is_empty() {
        return n.to_string();
    }
    meta.event.as_ref().and_then(|e| e.self_name.clone()).unwrap_or_default()
}

/// System prompt + user message for a summary call: the live rolling summary, or (final pass) the
/// detailed notes, with who `You` is, the invite's guests as name hints and the invite as context.
pub fn summary_request(s: &crate::model::Settings, user: &str, final_pass: bool, meta: &MeetingMeta) -> (String, String) {
    let mut system = if final_pass { prompts::meeting_notes_system(&s.meeting_summary_language) } else { prompts::meeting_summary_system_in(false, &s.meeting_summary_language) };
    let me = user_display_name(s, meta);
    system.push_str(&speaker_prompt_extra(&me, final_pass));
    if final_pass && !me.is_empty() {
        let first = me.split_whitespace().next().unwrap_or(&me);
        system.push_str(&format!(" In the notes (not the action items), call `You` {}.", text::truncate_chars(first, 30)));
    }
    system.push_str(&attendee_prompt_extra(&meta.attendees));
    if !s.system_prompt.trim().is_empty() {
        system.push_str(&format!("\nUser's instructions: {}", text::truncate_chars(s.system_prompt.trim(), 1000)));
    }
    let body = match meta.event.as_ref().filter(|_| final_pass) {
        Some(e) => {
            let organizer = e.guests.iter().find(|g| g.organizer).map(|g| g.name.clone());
            let guests: Vec<String> = e.guests.iter().map(|g| g.name.clone()).collect();
            format!("{}{user}", prompts::meeting_context(&e.title, organizer.as_deref(), &guests, e.description.as_deref()))
        }
        None => user.to_string(),
    };
    (system, body)
}

/// Owners the model wrote as the user's own name ("Jake: send the deck") are the user's items:
/// write them as `You` so they file as your to-dos. A first name alone counts only when no guest
/// shares it.
pub fn owners_as_you(items: &[String], user_names: &[String], guests: &[String]) -> Vec<String> {
    let first = |n: &str| n.split_whitespace().next().unwrap_or("").to_lowercase();
    let guest_firsts: Vec<String> = guests.iter().map(|g| first(g)).collect();
    let is_me = |o: &str| {
        user_names.iter().any(|n| {
            let n = n.trim();
            !n.is_empty() && (o.eq_ignore_ascii_case(n) || (o.to_lowercase() == first(n) && !guest_firsts.contains(&first(n))))
        })
    };
    items
        .iter()
        .map(|item| match split_owner(item) {
            (Some(o), task) if is_me(&o) => format!("{YOU}: {task}"),
            _ => item.clone(),
        })
        .collect()
}

/// Returns the parsed summary and the raw model output (final pass: also carries `speakerNames`).
async fn summarize_with(st: &Shared, user: &str, final_pass: bool, max_tokens: u32, meta: &MeetingMeta) -> Option<(prompts::ParsedSummary, String)> {
    let s = st.settings();
    let cfgl = LlmConfig::from_settings(&s);
    if !cfgl.is_configured() {
        return None;
    }
    let (system, body) = summary_request(&s, user, final_pass, meta);
    let req = ChatRequest {
        system: &system,
        user: &body,
        image_b64: None,
        json: true,
        purpose: Purpose::Meeting,
        cloud_allowed: cfg::is_cloud_llm(&s.llm_provider),
        max_tokens,
    };
    match llm::chat(&st.egress, &cfgl, req).await {
        Ok(raw) => {
            let mut p = prompts::parse_summary(&raw);
            p.summary = text::strip_ai_dashes(&p.summary);
            p.action_items = p.action_items.iter().map(|a| text::strip_ai_dashes(a)).collect();
            Some((p, raw))
        }
        Err(e) => {
            log::warn!("meeting summary failed: {e}");
            if final_pass {
                st.toast("error", format!("Couldn't summarize the meeting: {e}"));
            }
            None
        }
    }
}

async fn finalize(st: &Shared, note_id: &str, elapsed: f64, summarized_upto: usize) {
    let sum = summarize(st, note_id, summarized_upto).await;
    let Ok(Some(mut n)) = st.db.get_note(note_id) else { return };
    n.live = false;
    n.duration_sec = elapsed;
    if n.transcript.is_empty() {
        st.toast("info", "No speech was captured in this meeting. Check the microphone in Settings → Voice.");
    } else if sum.is_none() && !LlmConfig::from_settings(&st.settings()).is_configured() {
        st.toast("info", "Transcript saved. Add an AI model in Settings → AI for a summary and action items.");
    }
    if let Some((mut s, raw, long)) = sum {
        if long {
            s.action_items = merge_action_items(&n.action_items, &s.action_items);
        }
        let names = speaker_name_suggestions(&raw, &n.transcript);
        if !names.is_empty() {
            if let Some(mut meta) = load_meta(st, note_id) {
                // the speaker pass's own suggestions (screen / intro / calendar) stay; the model
                // only fills in labels nothing else had a guess for
                for (label, name) in names {
                    meta.suggested.entry(label).or_insert(name);
                }
                save_meta(st, note_id, &meta);
            }
        }
        if !s.summary.is_empty() {
            n.summary = s.summary;
        }
        let meta = load_meta(st, note_id).unwrap_or_default();
        let settings = st.settings();
        let me: Vec<String> = [settings.user_name.clone(), meta.event.as_ref().and_then(|e| e.self_name.clone()).unwrap_or_default()].into_iter().filter(|x| !x.trim().is_empty()).collect();
        s.action_items = owners_as_you(&s.action_items, &me, &meta.attendees);
        n.action_items = s.action_items.clone();
        if n.title.starts_with("Meeting ") && !s.title.trim().is_empty() {
            n.title = s.title.trim().to_string();
        }
        // a meeting not started under a project is filed by what it was about (client, people, keywords)
        if n.project_id.is_none() {
            n.project_id = st.db.project_for(&format!("{} {}", n.title, n.summary));
        }
        let _ = file_action_items(&st.db, &n, &s.action_items, crate::capture::CaptureLevel::parse(&st.settings().task_capture));
        if !s.action_items.is_empty() {
            st.emit(ev::TODOS, ());
            st.emit(ev::PROJECTS, ());
        }
    }
    let _ = st.db.upsert_note(&n);
    if st.settings().vault_auto {
        let proj = n.project_id.as_ref().and_then(|pid| st.db.get_project(pid).ok().flatten()).map(|p| p.name);
        let _ = crate::vault::record_meeting(st, &n, proj.as_deref());
        let _ = crate::vault::touch_daily(st, &format!("Meeting: [[{}]]", n.title));
        st.emit(ev::VAULT, ());
    }
    st.emit(ev::NOTES, ());
    st.emit(ev::MEETING, MeetingEvent { note_id: n.id.clone(), segment: None, summary: Some(n.summary.clone()), elapsed_sec: elapsed, live: false, partial: None, partial_speaker: None });
    st.toast("success", format!("Notes ready: {}", n.title));
    if st.settings().system_notifications && !n.transcript.is_empty() {
        crate::reminders::notify(&format!("Notes ready: {}", n.title), &notes_ready_body(&n));
    }
    if load_meta(st, note_id).is_some_and(|m| m.event.is_some()) {
        st.emit(crate::google::EV_AGENDA, ());
    }
    crate::push::notify(st, crate::push::meeting_payload(&n.title, &n.id, n.action_items.len())); // phone, only while Away
}

/// "3 action items · 42 min" for the Notes-ready notification.
pub fn notes_ready_body(n: &Note) -> String {
    let mins = (n.duration_sec / 60.0).round().max(1.0) as u64;
    match n.action_items.len() {
        0 => format!("{mins} min meeting. Open Flo for the summary."),
        1 => format!("1 action item · {mins} min"),
        k => format!("{k} action items · {mins} min"),
    }
}

// ── follow-up email (a draft only: Flo never sends it) ─────────────────────────

/// A follow-up email to the guests, written from the notes. Never sent by Flo: the user copies
/// it or opens it in Gmail's compose window and sends it themselves.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FollowupDraft {
    /// guest addresses from the invite (the user excluded)
    pub to: Vec<String>,
    pub subject: String,
    pub body: String,
}

pub fn followup_recipients(meta: &MeetingMeta) -> Vec<String> {
    meta.event.as_ref().map(|e| e.guests.iter().filter(|g| crate::gmail::is_address(&g.email)).map(|g| g.email.clone()).collect()).unwrap_or_default()
}

pub async fn followup_draft(st: &Shared, note_id: &str) -> Result<FollowupDraft> {
    let n = st.db.get_note(note_id)?.ok_or_else(|| anyhow!("Note not found"))?;
    if n.summary.trim().is_empty() {
        return Err(anyhow!("This meeting has no summary yet"));
    }
    let meta = load_meta(st, note_id).unwrap_or_default();
    let s = st.settings();
    let cfgl = LlmConfig::from_settings(&s);
    if !cfgl.is_configured() {
        return Err(anyhow!("Add an AI model in Settings → AI to draft emails"));
    }
    let me = user_display_name(&s, &meta);
    let system = prompts::followup_email_system(&me);
    let user = prompts::followup_email_user(&n.title, &meta.attendees, &n.summary, &n.action_items);
    let req = ChatRequest { system: &system, user: &user, image_b64: None, json: true, purpose: Purpose::Meeting, cloud_allowed: cfg::is_cloud_llm(&s.llm_provider), max_tokens: 900 };
    let raw = llm::chat(&st.egress, &cfgl, req).await?;
    let (subject, body) = prompts::parse_followup(&raw, &n.title);
    Ok(FollowupDraft { to: followup_recipients(&meta), subject, body: text::strip_ai_dashes(&body) })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(t: f64, text: &str, who: &str) -> MeetingSegment {
        MeetingSegment { t, text: text.into(), speaker: Some(who.into()) }
    }

    fn note(id: &str, title: &str) -> Note {
        Note {
            id: id.into(),
            title: title.into(),
            kind: "meeting".into(),
            project_id: None,
            transcript: vec![],
            summary: String::new(),
            action_items: vec![],
            duration_sec: 0.0,
            created_at: crate::db::now(),
            live: false,
        }
    }

    #[test]
    fn splits_owner_from_action_item() {
        assert_eq!(split_owner("Rahul: send the deck"), (Some("Rahul".into()), "send the deck".into()));
        assert_eq!(split_owner("Speaker 2: book the venue"), (Some("Speaker 2".into()), "book the venue".into()));
        assert_eq!(split_owner("review the PR"), (None, "review the PR".into()));
        assert_eq!(split_owner("Call at 10:30 tomorrow"), (None, "Call at 10:30 tomorrow".into()));
        assert_eq!(split_owner("We agreed on the following plan for launch: ship"), (None, "We agreed on the following plan for launch: ship".into()));
    }

    #[test]
    fn essential_capture_keeps_only_your_meeting_items() {
        let db = crate::db::Db::open_in_memory().unwrap();
        let n = note("n2", "Weekly sync");
        let items = vec![
            "You: send the revised estimate to Acme by Friday".to_string(),
            "Rahul: update the pricing page".to_string(),
            "book the offsite venue".to_string(),
            "You: follow up".to_string(),
        ];
        assert_eq!(file_action_items(&db, &n, &items, crate::capture::CaptureLevel::Essential).unwrap(), 2);
        let titles: Vec<String> = db.todos_for_note("n2").unwrap().into_iter().map(|t| t.title).collect();
        assert!(titles.contains(&"send the revised estimate to Acme by Friday".to_string()), "{titles:?}");
        assert!(titles.contains(&"book the offsite venue".to_string()));
        // Comprehensive also tracks what others owe, but never a vague "follow up"
        let db = crate::db::Db::open_in_memory().unwrap();
        assert_eq!(file_action_items(&db, &n, &items, crate::capture::CaptureLevel::Comprehensive).unwrap(), 3);
    }

    #[test]
    fn action_items_become_dated_linked_todos_with_owners() {
        let db = crate::db::Db::open_in_memory().unwrap();
        let n = note("n1", "Pricing sync");
        let items = vec![
            "You: review the PR tomorrow at 3pm".to_string(),
            "Speaker 2: send the pricing deck by next Monday".to_string(),
            "update the roadmap".to_string(),
            "You: review the PR tomorrow at 3pm".to_string(), // duplicate
        ];
        assert_eq!(file_action_items(&db, &n, &items, crate::capture::CaptureLevel::Balanced).unwrap(), 3);
        let todos = db.todos_for_note("n1").unwrap();
        assert_eq!(todos.len(), 3);
        let mine = todos.iter().find(|t| t.title == "review the PR tomorrow at 3pm").expect("own item is a plain task");
        assert!(mine.person.is_none());
        assert!(mine.due.is_some() && mine.remind_at.is_some(), "dated + reminder: {mine:?}");
        assert!(mine.reason.as_deref().unwrap().contains("Pricing sync"));
        let theirs = todos.iter().find(|t| t.person.as_deref() == Some("Speaker 2")).unwrap();
        assert!(theirs.title.starts_with("Speaker 2: send"));
        assert!(theirs.due.as_deref().unwrap().contains("T10:00"));
        // rename follows into the to-dos
        assert_eq!(rename_note_todos(&db, "n1", "Speaker 2", "Rahul").unwrap(), 1);
        let renamed = db.todos_for_note("n1").unwrap().into_iter().find(|t| t.id == theirs.id).unwrap();
        assert_eq!(renamed.person.as_deref(), Some("Rahul"));
        assert!(renamed.title.starts_with("Rahul: send"), "{}", renamed.title);
        assert_eq!(renamed.note_id.as_deref(), Some("n1"));
    }

    #[test]
    fn formats_transcript_with_timestamps_and_speakers() {
        let mut n = Note {
            id: "1".into(),
            title: "t".into(),
            kind: "meeting".into(),
            project_id: None,
            transcript: vec![MeetingSegment { t: 0.0, text: "Hi".into(), speaker: None }, MeetingSegment { t: 75.0, text: "Ship it".into(), speaker: None }],
            summary: String::new(),
            action_items: vec![],
            duration_sec: 80.0,
            created_at: String::new(),
            live: false,
        };
        assert_eq!(transcript_text(&n), "[00:00] Hi\n[01:15] Ship it");
        n.transcript[1].speaker = Some("Rahul".into());
        assert_eq!(transcript_text(&n), "[00:00] Hi\n[01:15] Rahul: Ship it");
    }

    #[test]
    fn two_tracks_merge_by_timestamp() {
        let mut v = vec![];
        // tracks finalize out of order: mic 0 s, call 4 s, then a call chunk that started at 2 s
        insert_sorted(&mut v, seg(0.0, "hello", YOU));
        insert_sorted(&mut v, seg(4.0, "late", OTHERS));
        insert_sorted(&mut v, seg(2.0, "early", OTHERS));
        insert_sorted(&mut v, seg(4.0, "same time, after", YOU));
        let order: Vec<&str> = v.iter().map(|s| s.text.as_str()).collect();
        assert_eq!(order, vec!["hello", "early", "late", "same time, after"]);
        insert_sorted(&mut v, seg(-1.0, "first", YOU));
        assert_eq!(v[0].text, "first");
    }

    #[test]
    fn long_meetings_keep_early_action_items() {
        let earlier = vec!["Speaker 1: send the pricing deck by Friday".to_string(), "You: book the venue".to_string()];
        // the final pass only saw the last part of the meeting
        let latest = vec!["You: book the venue tomorrow".to_string(), "Speaker 2: share the roadmap".to_string()];
        let m = merge_action_items(&earlier, &latest);
        assert_eq!(m, vec!["You: book the venue tomorrow", "Speaker 2: share the roadmap", "Speaker 1: send the pricing deck by Friday"]);
        assert!(merge_action_items(&[], &[]).is_empty());
        let p = prompts::meeting_final_long_user("- pricing", &earlier, "[10:00] You: ok");
        assert!(p.contains("send the pricing deck") && p.contains("[10:00] You: ok") && p.contains("ALL action items"));
        assert!(!p.contains('\u{2014}'), "no em dashes");
    }

    #[test]
    fn call_labels_apply_by_time_and_inherit() {
        let mut t = vec![seg(0.0, "a", YOU), seg(1.0, "b", OTHERS), seg(2.0, "c", OTHERS), seg(3.0, "d", YOU), seg(4.0, "e", OTHERS)];
        apply_call_labels(&mut t, &[(1.0, Some("Speaker 1".into())), (2.0, None), (4.0, Some("Rahul".into()))]);
        let who: Vec<_> = t.iter().map(|s| s.speaker.clone().unwrap()).collect();
        assert_eq!(who, vec!["You", "Speaker 1", "Speaker 1", "You", "Rahul"]);
    }

    #[test]
    fn whole_word_replace() {
        assert_eq!(replace_word("Speaker 2 owns it; Speaker 21 too", "Speaker 2", "Rahul"), "Rahul owns it; Speaker 21 too");
        assert_eq!(replace_word("Ask Speaker 2.", "Speaker 2", "Rahul"), "Ask Rahul.");
        assert_eq!(replace_word("nothing", "Speaker 2", "Rahul"), "nothing");
    }

    #[test]
    fn speaker_name_suggestions_are_safe() {
        let t = vec![seg(0.0, "Hi Riya", YOU), seg(1.0, "Hi!", "Speaker 1"), seg(2.0, "I'm Arjun", "Speaker 2"), seg(3.0, "ok", "Meera")];
        let raw = r#"```json
{"title":"x","summary":"- a","actionItems":[],"speakerNames":{"Speaker 1":"Riya","Speaker 2":"Arjun","Speaker 9":"Ghost","You":"Bob"}}
```"#;
        let s = speaker_name_suggestions(raw, &t);
        assert_eq!(s.into_iter().collect::<Vec<_>>(), vec![("Speaker 1".into(), "Riya".into()), ("Speaker 2".into(), "Arjun".into())]);
        // junk / duplicates / already-present names / non-generic labels are dropped
        let raw = r#"{"speakerNames":{"Speaker 1":"Meera","Speaker 2":"Speaker 3","Meera":"Riya"}}"#;
        assert!(speaker_name_suggestions(raw, &t).is_empty());
        let raw = r#"{"speakerNames":{"Speaker 1":"Riya","Speaker 2":"riya"}}"#;
        assert_eq!(speaker_name_suggestions(raw, &t).len(), 1);
        let raw = r#"{"speakerNames":{"Speaker 1":"DROP TABLE; --","Speaker 2":42}}"#;
        assert!(speaker_name_suggestions(raw, &t).is_empty());
        assert!(speaker_name_suggestions("no json", &t).is_empty());
        assert!(speaker_name_suggestions(r#"{"title":"x"}"#, &t).is_empty());
    }

    #[test]
    fn generic_labels() {
        assert!(is_generic_label("Speaker 2") && is_generic_label("Speaker 12") && is_generic_label(OTHERS));
        assert!(!is_generic_label("Speaker") && !is_generic_label("Speaker X") && !is_generic_label("Riya") && !is_generic_label(YOU));
    }

    #[test]
    fn prompt_names_the_user_and_asks_for_names_only_at_the_end() {
        let p = speaker_prompt_extra("Parth", true);
        assert!(p.contains("`You` is Parth") && p.contains("speakerNames"));
        let live = speaker_prompt_extra("", false);
        assert!(live.is_empty());
        assert!(!speaker_prompt_extra("Parth", false).contains("speakerNames"));
        assert!(!p.contains('\u{2014}'), "no em dashes");
    }

    #[test]
    fn calendar_attendees_are_cleaned_and_offered_as_hints() {
        let a = clean_attendees(&["  Priya  Shah ".into(), "priya shah".into(), "rahul@example.com".into(), "".into(), "Rahul".into(), "x".repeat(41)]);
        assert_eq!(a, vec!["Priya Shah".to_string(), "Rahul".to_string()]);
        let p = attendee_prompt_extra(&a);
        assert!(p.contains("Priya Shah, Rahul") && p.contains("Speaker N"));
        assert!(!p.contains('\u{2014}'), "no em dashes");
        assert!(attendee_prompt_extra(&[]).is_empty());
        let m: MeetingMeta = serde_json::from_str(r#"{"capture":"mic","attendees":["Priya"]}"#).unwrap();
        assert_eq!(m.attendees, vec!["Priya".to_string()]);
        // old metas without attendees still load, and empty lists aren't written
        assert!(serde_json::to_string(&MeetingMeta::default()).unwrap().find("attendees").is_none());
    }

    #[test]
    fn meta_roundtrip_defaults() {
        let m: MeetingMeta = serde_json::from_str(r#"{"capture":"mic"}"#).unwrap();
        assert_eq!(m.capture, "mic");
        assert!(m.speakers.is_empty() && m.capture_note.is_none());
    }

    fn s(x: &str) -> String {
        x.to_string()
    }

    fn invite() -> crate::google::CalendarEvent {
        use crate::google::CalendarAttendee;
        let p = |n: &str, e: &str, me: bool, r: &str, org: bool| CalendarAttendee { name: n.into(), email: e.into(), is_self: me, response: r.into(), organizer: org };
        crate::google::CalendarEvent {
            id: "ev1".into(),
            title: "Pricing review".into(),
            start: "2026-11-26T10:00:00Z".into(),
            end: "2026-11-26T10:30:00Z".into(),
            join_url: Some("https://meet.google.com/abc-defg-hij".into()),
            join_kind: Some("meet".into()),
            description: Some("Agenda: Q3 pricing".into()),
            attendees: vec![
                p("Jake Patel", "jakeinworld.99@gmail.com", true, "accepted", false),
                p("Priya Patel", "priya@x.com", false, "accepted", true),
                p("", "rahul.sharma@x.com", false, "needsAction", false),
                p("Declined Dan", "dan@x.com", false, "declined", false),
            ],
            ..Default::default()
        }
    }

    #[test]
    fn calendar_invite_becomes_the_notes_context() {
        let link = EventLink::from_event(&invite(), true);
        assert_eq!(link.occurrence, "ev1@2026-11-26T10:00:00Z");
        // the guests are the speaker candidates from the start: no decliners, not the user
        assert_eq!(link.guest_names(), vec![s("Priya Patel"), s("Rahul Sharma")]);
        assert_eq!(link.self_name.as_deref(), Some("Jake Patel"));
        assert!(link.guests[0].organizer && link.auto);
        // round trip in the meta, and old metas without an event still load
        let meta = MeetingMeta { attendees: link.guest_names(), event: Some(link.clone()), ..Default::default() };
        let back: MeetingMeta = serde_json::from_str(&serde_json::to_string(&meta).unwrap()).unwrap();
        assert_eq!(back.event, Some(link));
        assert_eq!(followup_recipients(&back), vec![s("priya@x.com"), s("rahul.sharma@x.com")]);
        // the final notes get the invite as background; the live summary doesn't
        let mut st = crate::model::Settings::default();
        st.user_name = String::new();
        let (system, user) = summary_request(&st, "[00:05] Priya Patel: hi", true, &meta);
        assert!(system.contains("## Key points"), "{system}");
        assert!(system.contains("`You` is Jake Patel"), "the invite names the user when Settings doesn't: {system}");
        assert!(system.contains("call `You` Jake"));
        assert!(system.contains("Priya Patel, Rahul Sharma"));
        assert!(user.starts_with("Background from the calendar invite") && user.contains("Organizer: Priya Patel") && user.contains("Agenda: Q3 pricing") && user.ends_with("[00:05] Priya Patel: hi"));
        let (live_sys, live_user) = summary_request(&st, "x", false, &meta);
        assert!(!live_sys.contains("## Key points") && live_user == "x");
        st.user_name = "Jake".into();
        assert!(summary_request(&st, "x", true, &meta).0.contains("`You` is Jake, the user"));
    }

    #[test]
    fn owners_named_like_the_user_file_as_yours() {
        let items = vec![s("Jake: send the deck (due Friday)"), s("Jake Patel: book the room"), s("Priya Patel: update copy"), s("ship it"), s("You: review")];
        let me = vec![s("Jake Patel")];
        assert_eq!(owners_as_you(&items, &me, &[s("Priya Patel")]), vec![s("You: send the deck (due Friday)"), s("You: book the room"), s("Priya Patel: update copy"), s("ship it"), s("You: review")]);
        // another Jake in the meeting: only the full name is the user
        assert_eq!(owners_as_you(&items[..2], &me, &[s("Jake Miller")]), vec![s("Jake: send the deck (due Friday)"), s("You: book the room")]);
    }

    #[test]
    fn notes_ready_notification() {
        let mut n = note("n", "Sync");
        n.duration_sec = 1500.0;
        assert_eq!(notes_ready_body(&n), "25 min meeting. Open Flo for the summary.");
        n.action_items = vec![s("a"), s("b")];
        assert_eq!(notes_ready_body(&n), "2 action items · 25 min");
    }
}
