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
    let mut known_voices: Vec<String> = st.db.list_voices().unwrap_or_default().into_iter().map(|v| v.0).collect();
    known_voices.sort_by_key(|n| n.to_lowercase());
    load_meta(st, note_id).map(|m| MeetingInfo {
        capture: m.capture,
        capture_note: m.capture_note,
        voiced: m.speakers.into_iter().filter(|c| !c.centroid.is_empty()).map(|c| c.label).collect(),
        suggestions: m.suggested,
        known_voices,
        attendees: m.attendees,
    })
}

fn load_voices(st: &Shared) -> Vec<Voice> {
    st.db
        .list_voices()
        .unwrap_or_default()
        .into_iter()
        .map(|(name, blob, samples)| Voice { name, embedding: speakers::blob_to_embedding(&blob), samples })
        .collect()
}

pub fn start(st: Shared, title: Option<String>, project_id: Option<String>) -> Result<Note> {
    start_with_attendees(st, title, project_id, vec![])
}

/// Start meeting notes with the guest names from a calendar invite (google.rs "Take notes").
pub fn start_with_attendees(st: Shared, title: Option<String>, project_id: Option<String>, attendees: Vec<String>) -> Result<Note> {
    let attendees = clean_attendees(&attendees);
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
    let recorder = Recorder::start(move |rms| {
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
            save_meta(&st, &note.id, &MeetingMeta { capture: CAPTURE_MIC.into(), capture_note: Some(e.to_string()), attendees: attendees.clone(), ..Default::default() });
            None
        }
    };
    if tap.is_some() {
        save_meta(&st, &note.id, &MeetingMeta { capture: CAPTURE_DUAL.into(), attendees: attendees.clone(), ..Default::default() });
        ensure_speaker_model(&st);
    }
    let stop = Arc::new(AtomicBool::new(false));
    let task = tauri::async_runtime::spawn(run_loop(st.clone(), note.id.clone(), recorder, tap, stop.clone()));
    *st.meeting.lock() = Some(MeetingHandle { note_id: note.id.clone(), stop, task });
    st.emit(ev::NOTES, ());
    st.emit(ev::MEETING, MeetingEvent { note_id: note.id.clone(), segment: None, summary: None, elapsed_sec: 0.0, live: true, partial: None, partial_speaker: None });
    st.state(Phase::Listening, Mode::Meeting, Some(note.title.clone()));
    Ok(note)
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
    Finish(tokio::sync::oneshot::Sender<(Vec<CallSeg>, Vec<Cluster>, meetpipe::Stats)>),
}

/// The app's speech engine for the worker thread (on-device Whisper or the cloud STT).
struct AppStt(Shared);

impl Transcriber for AppStt {
    fn transcribe(&mut self, samples: &[f32], context: &str, lang: Option<&str>) -> Result<String> {
        tauri::async_runtime::block_on(session::transcribe_lang(&self.0, samples.to_vec(), context, lang.map(String::from)))
    }
    fn detected_lang(&self) -> Option<String> {
        if self.0.settings().stt_provider == "local" { self.0.whisper.detected_lang() } else { None }
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
    let (tx, rx) = std::sync::mpsc::channel::<Msg>();
    if let Err(e) = spawn_worker(st.clone(), note_id.clone(), dual, lang, rx, inflight.clone(), committed.clone(), stop.clone(), started) {
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
            let (call_segs, clusters, stats) = done.unwrap_or_default();
            log::info!("meeting: finished after {elapsed:.0}s: {}", serde_json::to_string(&stats).unwrap_or_default());
            if dual {
                speaker_pass(&st, &note_id, call_segs, clusters, heard_call).await;
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
) -> std::io::Result<()> {
    std::thread::Builder::new().name("flo-meeting-stt".into()).spawn(move || {
        let mut p = Processor::new(AppStt(st.clone()), dual, load_voices(&st), lang);
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
                    let changes = p.handle(job);
                    apply_changes(&st, &note_id, &stop, started.elapsed().as_secs_f64(), changes, &committed, &mut last_error_toast);
                    inflight.fetch_sub(1, Ordering::SeqCst);
                }
                Msg::Finish(reply) => {
                    let _ = reply.send((std::mem::take(&mut p.call_segs), std::mem::take(&mut p.clusters), p.stats.clone()));
                    break;
                }
            }
        }
    })?;
    Ok(())
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
                    n.transcript.retain(|s| !(s.t == segm.t && s.text == segm.text && s.speaker == segm.speaker));
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
async fn speaker_pass(st: &Shared, note_id: &str, mut segs: Vec<CallSeg>, live_clusters: Vec<Cluster>, heard_call: bool) {
    let mut meta = load_meta(st, note_id).unwrap_or_else(|| MeetingMeta { capture: CAPTURE_DUAL.into(), ..Default::default() });
    if !heard_call {
        meta.capture_note = Some("Call audio was silent. If others spoke, allow Flo in System Settings → Privacy & Security → Screen & System Audio Recording.".into());
    }
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
    let Some((final_labels, clusters)) = meetpipe::recluster(&segs, &voices) else {
        meta.speakers = live_clusters;
        save_meta(st, note_id, &meta);
        return;
    };
    if let Ok(Some(mut n)) = st.db.get_note(note_id) {
        apply_call_labels(&mut n.transcript, &final_labels);
        let _ = st.db.upsert_note(&n);
    }
    meta.speakers = clusters;
    save_meta(st, note_id, &meta);
    st.emit(ev::NOTES, ());
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
            let merged = match meta.speakers.iter_mut().find(|c| c.label == to) {
                Some(c) => {
                    c.centroid = speakers::blend(&c.centroid, c.count, &moved.centroid, moved.count);
                    c.count += moved.count;
                    c.clone()
                }
                None => {
                    let c = Cluster { label: to.clone(), ..moved };
                    meta.speakers.push(c.clone());
                    c
                }
            };
            if to != YOU && !merged.centroid.is_empty() {
                let voices = load_voices(st);
                let (emb, samples) = match voices.iter().find(|v| v.name == to) {
                    Some(v) => (speakers::blend(&v.embedding, v.samples, &merged.centroid, merged.count), v.samples + merged.count),
                    None => (merged.centroid.clone(), merged.count),
                };
                st.db.upsert_voice(&to, &speakers::embedding_to_blob(&emb), samples)?;
            }
            meta.suggested.remove(from);
            save_meta(st, note_id, &meta);
        } else if meta.suggested.remove(from).is_some() {
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
    let attendees = load_meta(st, note_id).map(|m| m.attendees).unwrap_or_default();
    let (parsed, _) = summarize_with(st, &user, false, 700, &attendees).await?;
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
    let long = full.len() > FULL_TRANSCRIPT_MAX_CHARS && !n.summary.trim().is_empty();
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
    let attendees = load_meta(st, note_id).map(|m| m.attendees).unwrap_or_default();
    summarize_with(st, &user, true, 1200, &attendees).await.map(|(p, raw)| (p, raw, long))
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

/// Returns the parsed summary and the raw model output (final pass: also carries `speakerNames`).
async fn summarize_with(st: &Shared, user: &str, final_pass: bool, max_tokens: u32, attendees: &[String]) -> Option<(prompts::ParsedSummary, String)> {
    let s = st.settings();
    let cfgl = LlmConfig::from_settings(&s);
    if !cfgl.is_configured() {
        return None;
    }
    let mut system = prompts::meeting_summary_system(final_pass);
    system.push_str(&speaker_prompt_extra(&s.user_name, final_pass));
    system.push_str(&attendee_prompt_extra(attendees));
    if !s.system_prompt.trim().is_empty() {
        system.push_str(&format!("\nUser's instructions: {}", text::truncate_chars(s.system_prompt.trim(), 1000)));
    }
    let body = user.to_string();
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
                meta.suggested = names;
                save_meta(st, note_id, &meta);
            }
        }
        if !s.summary.is_empty() {
            n.summary = s.summary;
        }
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
    crate::push::notify(st, crate::push::meeting_payload(&n.title, &n.id, n.action_items.len())); // phone, only while Away
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
}
