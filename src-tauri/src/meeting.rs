//! Meeting note-taker: live chunked transcription + rolling summary + action items → to-dos.
//! v1 records the microphone (captures the room / speakers); system-audio capture is next.
use crate::audio::{self, Recorder};
use crate::egress::Purpose;
use crate::llm::{self, ChatRequest, LlmConfig};
use crate::model::*;
use crate::state::{MeetingHandle, Shared};
use crate::{db, prompts, session, settings as cfg, stt, text};
use anyhow::{anyhow, Result};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

const SUMMARY_EVERY_SECS: u64 = 120;
/// final pass sends the whole transcript only below this size; above it, summary + tail
const FULL_TRANSCRIPT_MAX_CHARS: usize = 12_000;

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
    let stop = Arc::new(AtomicBool::new(false));
    let task = tauri::async_runtime::spawn(run_loop(st.clone(), note.id.clone(), recorder, stop.clone()));
    *st.meeting.lock() = Some(MeetingHandle { note_id: note.id.clone(), stop, task });
    st.emit(ev::NOTES, ());
    st.emit(ev::MEETING, MeetingEvent { note_id: note.id.clone(), segment: None, summary: None, elapsed_sec: 0.0, live: true, partial: None });
    st.state(Phase::Listening, Mode::Meeting, Some(note.title.clone()));
    Ok(note)
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

async fn run_loop(st: Shared, note_id: String, recorder: Recorder, stop: Arc<AtomicBool>) {
    use crate::livetx::{Action, Segmenter, SLICE_MS};
    let started = Instant::now();
    let mut seg_start = 0.0f64;
    let mut last_summary = Instant::now();
    let mut segs_since_summary = 0;
    let mut summarized_upto = 0usize; // transcript segments already folded into the summary
    let recorder = Arc::new(parking_lot::Mutex::new(Some(recorder)));
    let mut seg = Segmenter::default();
    let mut pending: Vec<f32> = Vec::new();
    let mut last_text = String::new(); // context prompt for the next segment
    // live previews only with on-device STT (cloud previews would cost per call)
    let local = st.settings().stt_provider == "local";
    loop {
        tokio::time::sleep(Duration::from_millis(SLICE_MS)).await;
        let stopping = stop.load(Ordering::SeqCst);
        let slice = {
            let mut g = recorder.lock();
            if stopping {
                g.take().map(|r| r.stop()).unwrap_or_default()
            } else {
                g.as_ref().map(|r| r.take_samples()).unwrap_or_default()
            }
        };
        let elapsed = started.elapsed().as_secs_f64();
        if pending.is_empty() {
            seg_start = (elapsed - slice.len() as f64 / audio::TARGET_RATE as f64).max(0.0);
        }
        pending.extend_from_slice(&slice);
        let slice_ms = (slice.len() as u64 * 1000) / audio::TARGET_RATE as u64;
        let action = if stopping { seg.flush() } else { seg.push(slice_ms.max(1), audio::rms(&slice)) };

        match action {
            Action::Partial if local && !stopping => {
                if audio::voiced_ms(&pending) < 200 {
                    continue;
                }
                if let Ok(t) = session::transcribe_with_prompt(&st, pending.clone(), &last_text).await {
                    if !t.trim().is_empty() && !stt::is_degenerate(&t) {
                        st.emit(ev::MEETING, MeetingEvent { note_id: note_id.clone(), segment: None, summary: None, elapsed_sec: elapsed, live: true, partial: Some(t) });
                    }
                }
            }
            Action::Final => {
                let audio_secs = pending.len() as f32 / audio::TARGET_RATE as f32;
                let samples = std::mem::take(&mut pending);
                if audio::voiced_ms(&samples) < 250 {
                    continue; // no real speech in this stretch → don't invent text
                }
                match session::transcribe_with_prompt(&st, samples, &last_text).await {
                    Ok(t) if !stt::is_hallucination(&t, audio_secs) && !stt::is_degenerate(&t) => {
                        last_text = text::truncate_chars(&t, 200);
                        let segm = MeetingSegment { t: seg_start, text: t };
                        if let Ok(Some(mut n)) = st.db.get_note(&note_id) {
                            n.transcript.push(segm.clone());
                            if stop.load(Ordering::SeqCst) {
                                n.live = false; // never resurrect a stopped meeting (checked at write time)
                            }
                            n.duration_sec = elapsed;
                            let _ = st.db.upsert_note(&n);
                        }
                        segs_since_summary += 1;
                        st.emit(ev::MEETING, MeetingEvent { note_id: note_id.clone(), segment: Some(segm), summary: None, elapsed_sec: elapsed, live: !stopping, partial: Some(String::new()) });
                    }
                    Ok(_) => {}
                    Err(e) => {
                        log::warn!("meeting segment STT failed: {e}");
                        st.toast("error", format!("Meeting transcription: {e}"));
                    }
                }
            }
            Action::Discard => pending.clear(),
            _ => {}
        }

        if stopping {
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

pub fn transcript_text(n: &Note) -> String {
    n.transcript
        .iter()
        .map(|s| format!("[{:02}:{:02}] {}", (s.t as u64) / 60, (s.t as u64) % 60, s.text))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Rolling update: previous summary + only segments after `from` (flat cost per update).
async fn summarize_incremental(st: &Shared, note_id: &str, from: usize) -> Option<(prompts::ParsedSummary, usize)> {
    let n = st.db.get_note(note_id).ok()??;
    if n.transcript.len() <= from {
        return None;
    }
    let new_lines = n.transcript[from..]
        .iter()
        .map(|s| format!("[{:02}:{:02}] {}", (s.t as u64) / 60, (s.t as u64) % 60, s.text))
        .collect::<Vec<_>>()
        .join("\n");
    let user = prompts::meeting_update_user(&n.summary, &new_lines);
    let parsed = summarize_with(st, &user, false, 700).await?;
    Some((parsed, n.transcript.len()))
}

async fn summarize(st: &Shared, note_id: &str, final_pass: bool) -> Option<prompts::ParsedSummary> {
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

async fn summarize_with(st: &Shared, user: &str, final_pass: bool, max_tokens: u32) -> Option<prompts::ParsedSummary> {
    let s = st.settings();
    let cfgl = LlmConfig::from_settings(&s);
    if !cfgl.is_configured() {
        return None;
    }
    let mut system = prompts::meeting_summary_system(final_pass);
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
            Some(p)
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
    if let Some(s) = sum {
        if !s.summary.is_empty() {
            n.summary = s.summary;
        }
        n.action_items = s.action_items.clone();
        if n.title.starts_with("Meeting ") && !s.title.trim().is_empty() {
            n.title = s.title.trim().to_string();
        }
        let existing = st.db.open_todo_titles().unwrap_or_default();
        for item in &s.action_items {
            if !text::is_duplicate_todo(item, &existing) {
                let _ = st.db.add_todo(item, "meeting", n.project_id.clone(), None);
            }
        }
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_transcript_with_timestamps() {
        let n = Note {
            id: "1".into(),
            title: "t".into(),
            kind: "meeting".into(),
            project_id: None,
            transcript: vec![MeetingSegment { t: 0.0, text: "Hi".into() }, MeetingSegment { t: 75.0, text: "Ship it".into() }],
            summary: String::new(),
            action_items: vec![],
            duration_sec: 80.0,
            created_at: String::new(),
            live: false,
        };
        assert_eq!(transcript_text(&n), "[00:00] Hi\n[01:15] Ship it");
    }
}
