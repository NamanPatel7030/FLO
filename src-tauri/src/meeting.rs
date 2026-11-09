//! Meeting note-taker: live chunked transcription + rolling summary + action items → to-dos.
//!
//! Two tracks, like Fathom / Granola's bot-free desktop apps:
//! - **mic** → "You"
//! - **call audio** (Core Audio process tap, see `sysaudio.rs`) → "Others", split into
//!   "Speaker 1/2/3" by on-device voice embeddings (`speakers.rs`), or a remembered name.
//!
//! Each track is VAD-chunked and transcribed on its own, then merged by timestamp. On laptop
//! speakers the mic also hears the call → mic chunks that are an echo of the call are dropped
//! (energy-envelope gate before STT + text match after). No call audio (older macOS, permission
//! refused, tap failure) → mic-only, as before, with the reason shown in the note.
use crate::audio::{self, Recorder};
use crate::egress::Purpose;
use crate::llm::{self, ChatRequest, LlmConfig};
use crate::model::*;
use crate::speakers::{self, Cluster, Embedder, Voice};
use crate::state::{MeetingHandle, Shared};
use crate::sysaudio::SystemTap;
use crate::{db, prompts, session, settings as cfg, stt, text};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

const SUMMARY_EVERY_SECS: u64 = 120;
/// final pass sends the whole transcript only below this size; above it, summary + tail
const FULL_TRANSCRIPT_MAX_CHARS: usize = 12_000;
pub const YOU: &str = "You";
pub const OTHERS: &str = "Others";
pub const CAPTURE_DUAL: &str = "mic+call";
pub const CAPTURE_MIC: &str = "mic";
/// 20 ms energy frames for echo detection
const FRAME: usize = (audio::TARGET_RATE / 50) as usize;
/// Call audio kept for later embedding while the voice model downloads: at most 10 min
/// (≈ 38 MB of f32). Beyond that, clips inherit the previous speaker instead of growing memory.
const MAX_KEPT_AUDIO_SECS: f32 = 600.0;

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
            save_meta(&st, &note.id, &MeetingMeta { capture: CAPTURE_MIC.into(), capture_note: Some(e.to_string()), ..Default::default() });
            None
        }
    };
    if tap.is_some() {
        save_meta(&st, &note.id, &MeetingMeta { capture: CAPTURE_DUAL.into(), ..Default::default() });
        ensure_speaker_model(&st);
    }
    let stop = Arc::new(AtomicBool::new(false));
    let task = tauri::async_runtime::spawn(run_loop(st.clone(), note.id.clone(), recorder, tap, stop.clone()));
    *st.meeting.lock() = Some(MeetingHandle { note_id: note.id.clone(), stop, task });
    st.emit(ev::NOTES, ());
    st.emit(ev::MEETING, MeetingEvent { note_id: note.id.clone(), segment: None, summary: None, elapsed_sec: 0.0, live: true, partial: None });
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
        if let Err(e) = speakers::download_model(&st.egress, &st.models_dir).await {
            log::warn!("speaker model download failed: {e}");
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
    st.emit(ev::MEETING, MeetingEvent { note_id: note.id.clone(), segment: None, summary: None, elapsed_sec: note.duration_sec, live: false, partial: None });
    st.state(Phase::Thinking, Mode::Meeting, Some("Writing summary…".into()));
    let st2 = st.clone();
    tauri::async_runtime::spawn(async move {
        let _ = h.task.await;
        st2.finish(Phase::Done, Mode::Meeting, None);
    });
    Ok(note)
}

// ── tracks ─────────────────────────────────────────────────────────────────

/// One audio source being chunked and transcribed.
struct Track {
    mic: bool,
    seg: crate::livetx::Segmenter,
    pending: Vec<f32>,
    seg_start: f64,
    last_text: String,
    /// lock the spoken language after the first clear chunk so it stops drifting into English
    locked_lang: Option<String>,
}

impl Track {
    fn new(mic: bool, lang: Option<String>) -> Self {
        Self { mic, seg: Default::default(), pending: vec![], seg_start: 0.0, last_text: String::new(), locked_lang: lang }
    }
}

/// A call-track segment kept for the post-call speaker pass.
struct CallSeg {
    t: f64,
    secs: f32,
    emb: Option<Vec<f32>>,
    /// audio kept only while no embedding could be computed yet (model still downloading)
    audio: Option<Vec<f32>>,
}

/// Recently committed segment (for echo matching between the tracks).
#[derive(Debug, Clone)]
struct Recent {
    t0: f64,
    t1: f64,
    text: String,
    mic: bool,
}

/// Rolling 20 ms energy envelope with timestamps (last ~30 s).
#[derive(Default)]
struct Envelope {
    frames: VecDeque<(f64, f32)>,
}

impl Envelope {
    fn push(&mut self, t0: f64, samples: &[f32]) {
        for (i, c) in samples.chunks(FRAME).enumerate() {
            self.frames.push_back((t0 + (i * FRAME) as f64 / audio::TARGET_RATE as f64, audio::rms(c)));
        }
        while self.frames.len() > 1500 {
            self.frames.pop_front();
        }
    }
    /// frame energies aligned to [t0, t0 + n frames)
    fn window(&self, t0: f64, n: usize) -> Vec<f32> {
        let step = FRAME as f64 / audio::TARGET_RATE as f64;
        let mut out = vec![0.0f32; n];
        for (t, e) in &self.frames {
            let k = ((t - t0) / step).round();
            if k >= 0.0 && (k as usize) < n {
                out[k as usize] = *e;
            }
        }
        out
    }
}

async fn run_loop(st: Shared, note_id: String, recorder: Recorder, tap: Option<SystemTap>, stop: Arc<AtomicBool>) {
    use crate::livetx::{Action, SLICE_MS};
    let started = Instant::now();
    let mut last_summary = Instant::now();
    let mut segs_since_summary = 0;
    let mut summarized_upto = 0usize; // transcript segments already folded into the summary
    let dual = tap.is_some();
    let recorder = Arc::new(parking_lot::Mutex::new(Some(recorder)));
    let tap = Arc::new(parking_lot::Mutex::new(tap));
    let lang = { let l = st.settings().language; (l != "auto" && !l.is_empty()).then_some(l) };
    let mut tracks = vec![Track::new(true, lang.clone())];
    if dual {
        tracks.push(Track::new(false, lang));
    }
    let mut call_env = Envelope::default();
    let mut recent: VecDeque<Recent> = VecDeque::new();
    let mut call_segs: Vec<CallSeg> = vec![];
    let mut clusters: Vec<Cluster> = vec![];
    let voices = load_voices(&st);
    let mut embedder: Option<Arc<Embedder>> = None;
    let mut next_embedder_try = Instant::now();
    let mut heard_call = false;
    let mut kept_audio_secs = 0.0f32;
    // live previews only with on-device STT (cloud previews would cost per call)
    let local = st.settings().stt_provider == "local";
    loop {
        tokio::time::sleep(Duration::from_millis(SLICE_MS)).await;
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
            if stopping {
                let t = g.take();
                heard_call |= t.as_ref().map(|t| t.heard_anything()).unwrap_or(false);
                t.map(|t| t.stop()).unwrap_or_default()
            } else {
                heard_call |= g.as_ref().map(|t| t.heard_anything()).unwrap_or(false);
                g.as_ref().map(|t| t.take_samples()).unwrap_or_default()
            }
        } else {
            vec![]
        };
        let elapsed = started.elapsed().as_secs_f64();
        if dual {
            call_env.push((elapsed - call_slice.len() as f64 / audio::TARGET_RATE as f64).max(0.0), &call_slice);
            // the voice model may finish downloading mid-meeting
            if embedder.is_none() && speakers::supported() && Instant::now() >= next_embedder_try {
                next_embedder_try = Instant::now() + Duration::from_secs(10);
                let dir = st.models_dir.clone();
                embedder = tokio::task::spawn_blocking(move || Embedder::load(&dir)).await.ok().flatten().map(Arc::new);
            }
        }

        let mut partial_done = false;
        // call track first: its segments are what mic echoes get compared against
        for ti in (0..tracks.len()).rev() {
            let slice = if tracks[ti].mic { &mic_slice } else { &call_slice };
            let tr = &mut tracks[ti];
            if tr.pending.is_empty() {
                tr.seg_start = (elapsed - slice.len() as f64 / audio::TARGET_RATE as f64).max(0.0);
            }
            tr.pending.extend_from_slice(slice);
            let slice_ms = (slice.len() as u64 * 1000) / audio::TARGET_RATE as u64;
            let action = if stopping { tr.seg.flush() } else { tr.seg.push(slice_ms.max(1), audio::rms(slice)) };
            match action {
                Action::Partial if local && !stopping && !partial_done => {
                    if audio::voiced_ms(&tr.pending) < 200 {
                        continue;
                    }
                    // a mic preview while the call is talking is most likely the call's echo
                    if tr.mic && dual && is_echo_by_energy(&tr.pending, &call_env.window(tr.seg_start, tr.pending.len().div_ceil(FRAME))) {
                        continue;
                    }
                    partial_done = true;
                    if let Ok(t) = session::transcribe_lang(&st, tr.pending.clone(), &tr.last_text, tr.locked_lang.clone()).await {
                        if !t.trim().is_empty() && !stt::is_degenerate(&t) {
                            st.emit(ev::MEETING, MeetingEvent { note_id: note_id.clone(), segment: None, summary: None, elapsed_sec: elapsed, live: true, partial: Some(t) });
                        }
                    }
                }
                Action::Final => {
                    let seg_secs = tr.pending.len() as f32 / audio::TARGET_RATE as f32;
                    let seg_samples = std::mem::take(&mut tr.pending);
                    let seg_t0 = tr.seg_start;
                    if audio::voiced_ms(&seg_samples) < 250 {
                        continue; // no real speech in this stretch → don't invent text
                    }
                    if tr.mic && dual && is_echo_by_energy(&seg_samples, &call_env.window(seg_t0, seg_samples.len().div_ceil(FRAME))) {
                        log::info!("meeting: dropped mic chunk at {seg_t0:.1}s (echo of call audio)");
                        continue;
                    }
                    // a quick back-and-forth on the call (no 700 ms pause) is one VAD segment:
                    // cut it where the voice changes so each turn is transcribed and labelled
                    let pieces: Vec<(f64, Vec<f32>)> = match (&embedder, tr.mic) {
                        (Some(e), false) if seg_secs >= speakers::MIN_SPLIT_SECS => {
                            let (e, s) = (e.clone(), seg_samples.clone());
                            let ranges = tokio::task::spawn_blocking(move || speakers::split_turns(&s, audio::TARGET_RATE, |w| e.embed(w))).await.unwrap_or_default();
                            if ranges.len() > 1 {
                                log::info!("meeting: split call segment at {seg_t0:.1}s into {} turns", ranges.len());
                                ranges.into_iter().map(|r| (seg_t0 + r.start as f64 / audio::TARGET_RATE as f64, seg_samples[r].to_vec())).collect()
                            } else {
                                vec![(seg_t0, seg_samples)]
                            }
                        }
                        _ => vec![(seg_t0, seg_samples)],
                    };
                    for (t0, samples) in pieces {
                    let audio_secs = samples.len() as f32 / audio::TARGET_RATE as f32;
                    let t1 = t0 + audio_secs as f64;
                    if audio::voiced_ms(&samples) < 250 {
                        continue;
                    }
                    let res = session::transcribe_lang(&st, samples.clone(), &tr.last_text, tr.locked_lang.clone()).await;
                    let t = match res {
                        Ok(t) if !stt::is_hallucination(&t, audio_secs) && !stt::is_degenerate(&t) => t,
                        Ok(_) => continue,
                        Err(e) => {
                            log::warn!("meeting segment STT failed: {e}");
                            st.toast("error", format!("Meeting transcription: {e}"));
                            continue;
                        }
                    };
                    if tr.locked_lang.is_none() {
                        tr.locked_lang = st.whisper.detected_lang();
                    }
                    tr.last_text = text::truncate_chars(&t, 200);
                    let speaker = if tr.mic {
                        if recent.iter().any(|r| !r.mic && overlaps(t0, t1, r.t0, r.t1, 1.5) && is_echo_text(&t, &r.text)) {
                            log::info!("meeting: dropped mic segment at {t0:.1}s (same words as the call)");
                            continue;
                        }
                        YOU.to_string()
                    } else {
                        // who on the call: voice embedding → cluster → "Speaker N" / remembered name
                        let emb = match &embedder {
                            Some(e) => {
                                let (e, s) = (e.clone(), samples.clone());
                                tokio::task::spawn_blocking(move || e.embed(&s)).await.ok().flatten()
                            }
                            None => None,
                        };
                        let label = emb
                            .as_ref()
                            .and_then(|e| speakers::assign(&mut clusters, e, audio_secs, &voices))
                            .map(|i| clusters[i].label.clone())
                            .unwrap_or_else(|| prev_call_label(&st, &note_id).unwrap_or_else(|| OTHERS.into()));
                        let keep_audio = emb.is_none() && speakers::supported() && kept_audio_secs + audio_secs <= MAX_KEPT_AUDIO_SECS;
                        if keep_audio {
                            kept_audio_secs += audio_secs;
                        }
                        call_segs.push(CallSeg { t: t0, secs: audio_secs, emb, audio: keep_audio.then_some(samples) });
                        label
                    };
                    let segm = MeetingSegment { t: t0, text: t.clone(), speaker: Some(speaker) };
                    let mut removed_echo = false;
                    if let Ok(Some(mut n)) = st.db.get_note(&note_id) {
                        if !tr.mic {
                            // the mic may have committed the same words a moment earlier (speakers, no headphones)
                            for r in recent.iter().filter(|r| r.mic && overlaps(t0, t1, r.t0, r.t1, 1.5) && is_echo_text(&r.text, &t)) {
                                let before = n.transcript.len();
                                n.transcript.retain(|s| !(s.speaker.as_deref() == Some(YOU) && s.t == r.t0 && s.text == r.text));
                                removed_echo |= n.transcript.len() != before;
                            }
                        }
                        insert_sorted(&mut n.transcript, segm.clone());
                        if stop.load(Ordering::SeqCst) {
                            n.live = false; // never resurrect a stopped meeting (checked at write time)
                        }
                        n.duration_sec = elapsed;
                        let _ = st.db.upsert_note(&n);
                    }
                    if removed_echo {
                        recent.retain(|r| !(r.mic && overlaps(t0, t1, r.t0, r.t1, 1.5) && is_echo_text(&r.text, &t)));
                        st.emit(ev::NOTES, ());
                    }
                    recent.push_back(Recent { t0, t1, text: t, mic: tr.mic });
                    while recent.front().is_some_and(|r| r.t1 < elapsed - 30.0) {
                        recent.pop_front();
                    }
                    segs_since_summary += 1;
                    st.emit(ev::MEETING, MeetingEvent { note_id: note_id.clone(), segment: Some(segm), summary: None, elapsed_sec: elapsed, live: !stopping, partial: Some(String::new()) });
                    }
                }
                Action::Discard => tr.pending.clear(),
                _ => {}
            }
        }

        if stopping {
            if dual {
                speaker_pass(&st, &note_id, call_segs, clusters, &voices, heard_call).await;
            }
            finalize(&st, &note_id, elapsed).await;
            break;
        }
        if segs_since_summary >= 2 && last_summary.elapsed() >= Duration::from_secs(SUMMARY_EVERY_SECS) {
            if let Some((sum, upto)) = summarize_incremental(&st, &note_id, summarized_upto).await {
                summarized_upto = upto;
                if let Ok(Some(mut n)) = st.db.get_note(&note_id) {
                    n.summary = sum.summary.clone();
                    let _ = st.db.upsert_note(&n);
                }
                st.emit(ev::MEETING, MeetingEvent { note_id: note_id.clone(), segment: None, summary: Some(sum.summary), elapsed_sec: elapsed, live: true, partial: None });
            }
            last_summary = Instant::now();
            segs_since_summary = 0;
        }
    }
}

/// Short call clips without a usable embedding keep the previous call speaker (turn continuity).
fn prev_call_label(st: &Shared, note_id: &str) -> Option<String> {
    let n = st.db.get_note(note_id).ok()??;
    n.transcript.iter().rev().find(|s| s.speaker.as_deref().is_some_and(|w| w != YOU)).and_then(|s| s.speaker.clone())
}

/// After the call: re-cluster all call segments (better than the live, greedy assignment), name
/// clusters from remembered voices, relabel the transcript and store the clusters for renaming.
async fn speaker_pass(st: &Shared, note_id: &str, mut segs: Vec<CallSeg>, live_clusters: Vec<Cluster>, voices: &[Voice], heard_call: bool) {
    let mut meta = load_meta(st, note_id).unwrap_or_else(|| MeetingMeta { capture: CAPTURE_DUAL.into(), ..Default::default() });
    if !heard_call {
        meta.capture_note = Some("Call audio was silent. If others spoke, allow Flo in System Settings → Privacy & Security → Screen & System Audio Recording.".into());
    }
    // embeddings for clips recorded before the voice model was ready
    if segs.iter().any(|s| s.emb.is_none() && s.audio.is_some()) {
        let dir = st.models_dir.clone();
        let todo: Vec<(usize, Vec<f32>)> = segs.iter_mut().enumerate().filter_map(|(i, s)| s.audio.take().map(|a| (i, a))).collect();
        let done = tokio::task::spawn_blocking(move || {
            let Some(e) = Embedder::load(&dir) else { return vec![] };
            todo.into_iter().map(|(i, a)| (i, e.embed(&a))).collect::<Vec<_>>()
        })
        .await
        .unwrap_or_default();
        for (i, e) in done {
            segs[i].emb = e;
        }
    }
    let with: Vec<&CallSeg> = segs.iter().filter(|s| s.emb.is_some() && s.secs >= speakers::MIN_EMBED_SECS).collect();
    if with.is_empty() {
        meta.speakers = live_clusters;
        save_meta(st, note_id, &meta);
        return;
    }
    let embs: Vec<Vec<f32>> = with.iter().map(|s| s.emb.clone().unwrap_or_default()).collect();
    let weights: Vec<f32> = with.iter().map(|s| s.secs).collect();
    let ids = speakers::agglomerate(&embs, &weights, speakers::SAME_SPEAKER);
    let k = ids.iter().max().map(|m| m + 1).unwrap_or(0);
    let mut cents: Vec<(Vec<f32>, u32)> = vec![(vec![], 0); k];
    for (e, id) in embs.iter().zip(&ids) {
        let (c, n) = &mut cents[*id];
        *c = speakers::blend(c, *n, e, 1);
        *n += 1;
    }
    let centroids: Vec<Vec<f32>> = cents.iter().map(|c| c.0.clone()).collect();
    let labels = speakers::label_clusters(&centroids, voices);
    // every call segment → final label: own cluster, else nearest centroid, else previous speaker
    let label_for = |s: &CallSeg| -> Option<String> {
        let e = s.emb.as_ref()?;
        centroids.iter().enumerate().map(|(i, c)| (i, speakers::cosine(c, e))).max_by(|a, b| a.1.total_cmp(&b.1)).map(|(i, _)| labels[i].clone())
    };
    let final_labels: Vec<(f64, Option<String>)> = segs.iter().map(|s| (s.t, label_for(s))).collect();
    if let Ok(Some(mut n)) = st.db.get_note(note_id) {
        apply_call_labels(&mut n.transcript, &final_labels);
        let _ = st.db.upsert_note(&n);
    }
    meta.speakers = centroids.into_iter().zip(labels).zip(cents.iter().map(|c| c.1)).map(|((centroid, label), count)| Cluster { label, centroid, count }).collect();
    save_meta(st, note_id, &meta);
    st.emit(ev::NOTES, ());
}

/// Relabel call segments (matched by start time; mic segments untouched). Segments without a
/// label inherit the previous call speaker.
fn apply_call_labels(transcript: &mut [MeetingSegment], labels: &[(f64, Option<String>)]) {
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

/// Do two time spans overlap (with `slack` seconds of tolerance)?
pub fn overlaps(a0: f64, a1: f64, b0: f64, b1: f64, slack: f64) -> bool {
    a0 <= b1 + slack && b0 <= a1 + slack
}

fn words(s: &str) -> Vec<String> {
    s.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(|w| w.to_lowercase()).collect()
}

/// The mic text is the call's words heard through the speakers: most of the shorter text's words
/// appear in the other (Whisper hears the echo slightly differently, so not exact equality).
pub fn is_echo_text(mic: &str, call: &str) -> bool {
    let (a, b) = (words(mic), words(call));
    if a.is_empty() || b.is_empty() {
        return false;
    }
    if a.len() < 3 || b.len() < 3 {
        return a == b;
    }
    let (short, long) = if a.len() <= b.len() { (&a, &b) } else { (&b, &a) };
    let mut pool = long.clone();
    let mut common = 0;
    for w in short {
        if let Some(i) = pool.iter().position(|x| x == w) {
            pool.swap_remove(i);
            common += 1;
        }
    }
    common as f32 / short.len() as f32 >= 0.6
}

/// Energy gate: the mic chunk is an echo when (nearly) every voiced mic frame coincides with call
/// audio and the two loudness contours move together (up to 160 ms apart: capture jitter). When
/// you talk, the mic has energy while the call is quiet → not an echo.
pub fn is_echo_by_energy(mic: &[f32], call_env: &[f32]) -> bool {
    let mic_env: Vec<f32> = mic.chunks(FRAME).map(audio::rms).collect();
    let n = mic_env.len().min(call_env.len());
    if n < 15 {
        return false;
    }
    let mut sorted = mic_env.clone();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let floor = sorted[sorted.len() / 5];
    let voiced = |e: f32| e > (floor * 3.0).max(0.01);
    let voiced_idx: Vec<usize> = (0..n).filter(|i| voiced(mic_env[*i])).collect();
    if voiced_idx.len() < 10 {
        return false;
    }
    let call_on = |e: f32| e > 0.004;
    (0..=8usize).any(|lag| {
        let pairs: Vec<(f32, f32)> = voiced_idx.iter().filter(|i| **i >= lag).map(|i| (mic_env[*i], call_env[*i - lag])).collect();
        if pairs.len() < 10 {
            return false;
        }
        let covered = pairs.iter().filter(|(_, c)| call_on(*c)).count() as f32 / pairs.len() as f32;
        if covered < 0.9 {
            return false;
        }
        // loudness contours correlate (log energy, Pearson)
        let all: Vec<(f32, f32)> = (lag..n).map(|i| ((mic_env[i] + 1e-5).ln(), (call_env[i - lag] + 1e-5).ln())).collect();
        pearson(&all) >= 0.6
    })
}

fn pearson(p: &[(f32, f32)]) -> f32 {
    let n = p.len() as f32;
    if n < 2.0 {
        return 0.0;
    }
    let (mx, my) = (p.iter().map(|x| x.0).sum::<f32>() / n, p.iter().map(|x| x.1).sum::<f32>() / n);
    let (mut sxy, mut sxx, mut syy) = (0.0, 0.0, 0.0);
    for (x, y) in p {
        sxy += (x - mx) * (y - my);
        sxx += (x - mx) * (x - mx);
        syy += (y - my) * (y - my);
    }
    if sxx <= 1e-9 || syy <= 1e-9 {
        return 0.0;
    }
    sxy / (sxx.sqrt() * syy.sqrt())
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
/// Returns how many were added (duplicates of open to-dos are skipped).
pub fn file_action_items(db: &crate::db::Db, n: &Note, items: &[String]) -> Result<usize> {
    let mut existing = db.open_todo_titles()?;
    let mut added = 0;
    for item in items {
        let (owner, task) = split_owner(item);
        let mine = owner.as_deref().map(|o| o.eq_ignore_ascii_case(YOU) || o.eq_ignore_ascii_case("me")).unwrap_or(true);
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
    let (parsed, _) = summarize_with(st, &user, false, 700).await?;
    Some((parsed, n.transcript.len()))
}

async fn summarize(st: &Shared, note_id: &str, final_pass: bool) -> Option<(prompts::ParsedSummary, String)> {
    let n = st.db.get_note(note_id).ok()??;
    if n.transcript.is_empty() {
        return None;
    }
    let full = transcript_text(&n);
    let user = if full.len() <= FULL_TRANSCRIPT_MAX_CHARS || n.summary.trim().is_empty() {
        text::truncate_chars(&full, 60_000)
    } else {
        // long meeting: the rolling summary already covers most of it → summary + last ~4k chars
        let tail: String = full.chars().rev().take(4000).collect::<Vec<_>>().into_iter().rev().collect();
        prompts::meeting_update_user(&n.summary, &tail)
    };
    summarize_with(st, &user, final_pass, 1200).await
}

/// Returns the parsed summary and the raw model output (final pass: also carries `speakerNames`).
async fn summarize_with(st: &Shared, user: &str, final_pass: bool, max_tokens: u32) -> Option<(prompts::ParsedSummary, String)> {
    let s = st.settings();
    let cfgl = LlmConfig::from_settings(&s);
    if !cfgl.is_configured() {
        return None;
    }
    let mut system = prompts::meeting_summary_system(final_pass);
    system.push_str(&speaker_prompt_extra(&s.user_name, final_pass));
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

async fn finalize(st: &Shared, note_id: &str, elapsed: f64) {
    let sum = summarize(st, note_id, true).await;
    let Ok(Some(mut n)) = st.db.get_note(note_id) else { return };
    n.live = false;
    n.duration_sec = elapsed;
    if let Some((s, raw)) = sum {
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
        let _ = file_action_items(&st.db, &n, &s.action_items);
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
    st.emit(ev::MEETING, MeetingEvent { note_id: n.id.clone(), segment: None, summary: Some(n.summary.clone()), elapsed_sec: elapsed, live: false, partial: None });
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
    fn action_items_become_dated_linked_todos_with_owners() {
        let db = crate::db::Db::open_in_memory().unwrap();
        let n = note("n1", "Pricing sync");
        let items = vec![
            "You: review the PR tomorrow at 3pm".to_string(),
            "Speaker 2: send the pricing deck by next Monday".to_string(),
            "update the roadmap".to_string(),
            "You: review the PR tomorrow at 3pm".to_string(), // duplicate
        ];
        assert_eq!(file_action_items(&db, &n, &items).unwrap(), 3);
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
    fn overlap_with_slack() {
        assert!(overlaps(0.0, 2.0, 1.0, 3.0, 0.0));
        assert!(!overlaps(0.0, 2.0, 3.0, 4.0, 0.5));
        assert!(overlaps(0.0, 2.0, 3.0, 4.0, 1.5));
    }

    #[test]
    fn echo_text_matching() {
        // the mic heard the call through the speakers, slightly mis-transcribed
        assert!(is_echo_text("we should ship the build on friday", "We should ship the new build on Friday."));
        assert!(is_echo_text("ship it on friday", "Okay, so ship it on Friday then, right?"));
        // different sentences → both kept
        assert!(!is_echo_text("I'll send the deck tonight", "Can you share the pricing sheet?"));
        // very short: only exact
        assert!(is_echo_text("Okay.", "okay"));
        assert!(!is_echo_text("Yes", "No"));
        assert!(!is_echo_text("", "anything"));
    }

    fn tone(secs: f32, amp: f32) -> Vec<f32> {
        (0..(secs * 16_000.0) as usize).map(|i| (i as f32 / 7.0).sin() * amp).collect()
    }

    fn env(s: &[f32]) -> Vec<f32> {
        s.chunks(FRAME).map(audio::rms).collect()
    }

    #[test]
    fn energy_gate_detects_echo_but_not_double_talk() {
        // call: speech bursts with gaps; mic: the same bursts, quieter and 100 ms late
        let mut call = vec![];
        for k in 0..6 {
            call.extend(tone(0.4, 0.2 + 0.05 * k as f32));
            call.extend(vec![0.0; 3200]);
        }
        let mut mic = vec![0.0; 1600];
        mic.extend(call.iter().map(|x| x * 0.3));
        mic.truncate(call.len());
        assert!(is_echo_by_energy(&mic, &env(&call)));
        // you talk while the call is silent → not an echo
        let silent_call = vec![0.0f32; call.len()];
        assert!(!is_echo_by_energy(&mic, &env(&silent_call)));
        // you talk in the call's gaps → not an echo
        let mut you = vec![];
        for _ in 0..6 {
            you.extend(vec![0.0; 6400]);
            you.extend(tone(0.2, 0.3));
        }
        you.truncate(call.len());
        assert!(!is_echo_by_energy(&you, &env(&call)));
        // too short to judge
        assert!(!is_echo_by_energy(&tone(0.1, 0.2), &env(&tone(0.1, 0.2))));
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
    fn meta_roundtrip_defaults() {
        let m: MeetingMeta = serde_json::from_str(r#"{"capture":"mic"}"#).unwrap();
        assert_eq!(m.capture, "mic");
        assert!(m.speakers.is_empty() && m.capture_note.is_none());
    }
}
