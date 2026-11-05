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

const CHUNK_SECS: u64 = 10;
const SUMMARY_EVERY_SECS: u64 = 60;

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
    st.emit(ev::MEETING, MeetingEvent { note_id: note.id.clone(), segment: None, summary: None, elapsed_sec: 0.0, live: true });
    st.state(Phase::Listening, Mode::Meeting, Some(note.title.clone()));
    Ok(note)
}

pub async fn stop(st: Shared) -> Result<Note> {
    let h = st.meeting.lock().take().ok_or_else(|| anyhow!("No meeting is running"))?;
    h.stop.store(true, Ordering::SeqCst);
    st.state(Phase::Thinking, Mode::Meeting, Some("Writing summary…".into()));
    let _ = h.task.await;
    let note = st.db.get_note(&h.note_id)?.ok_or_else(|| anyhow!("note missing"))?;
    st.state(Phase::Done, Mode::Meeting, None);
    Ok(note)
}

async fn run_loop(st: Shared, note_id: String, recorder: Recorder, stop: Arc<AtomicBool>) {
    let started = Instant::now();
    let mut chunk_start = 0.0f64;
    let mut last_summary = Instant::now();
    let mut segs_since_summary = 0;
    let recorder = Arc::new(parking_lot::Mutex::new(Some(recorder)));
    loop {
        // wait for the next chunk boundary (or stop)
        let deadline = Instant::now() + Duration::from_secs(CHUNK_SECS);
        while Instant::now() < deadline && !stop.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        let stopping = stop.load(Ordering::SeqCst);
        let samples = {
            let mut g = recorder.lock();
            if stopping {
                g.take().map(|r| r.stop()).unwrap_or_default()
            } else {
                g.as_ref().map(|r| r.take_samples()).unwrap_or_default()
            }
        };
        let elapsed = started.elapsed().as_secs_f64();
        if audio::rms(&samples) > 0.004 {
            match session::transcribe(&st, samples.clone()).await {
                Ok(t) if !stt::is_hallucination(&t, samples.len() as f32 / audio::TARGET_RATE as f32) => {
                    let seg = MeetingSegment { t: chunk_start, text: t };
                    if let Ok(Some(mut n)) = st.db.get_note(&note_id) {
                        n.transcript.push(seg.clone());
                        n.duration_sec = elapsed;
                        let _ = st.db.upsert_note(&n);
                    }
                    segs_since_summary += 1;
                    st.emit(ev::MEETING, MeetingEvent { note_id: note_id.clone(), segment: Some(seg), summary: None, elapsed_sec: elapsed, live: true });
                }
                Ok(_) => {}
                Err(e) => {
                    log::warn!("meeting chunk STT failed: {e}");
                    st.toast("error", format!("Meeting transcription: {e}"));
                }
            }
        }
        chunk_start = elapsed;

        if stopping {
            finalize(&st, &note_id, elapsed).await;
            break;
        }
        if segs_since_summary >= 2 && last_summary.elapsed() >= Duration::from_secs(SUMMARY_EVERY_SECS) {
            if let Some(sum) = summarize(&st, &note_id, false).await {
                if let Ok(Some(mut n)) = st.db.get_note(&note_id) {
                    n.summary = sum.summary.clone();
                    let _ = st.db.upsert_note(&n);
                }
                st.emit(ev::MEETING, MeetingEvent { note_id: note_id.clone(), segment: None, summary: Some(sum.summary), elapsed_sec: elapsed, live: true });
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

async fn summarize(st: &Shared, note_id: &str, final_pass: bool) -> Option<prompts::ParsedSummary> {
    let n = st.db.get_note(note_id).ok()??;
    if n.transcript.is_empty() {
        return None;
    }
    let s = st.settings();
    let cfgl = LlmConfig::from_settings(&s);
    if !cfgl.is_configured() {
        return None;
    }
    let system = prompts::meeting_summary_system(final_pass);
    let body = text::truncate_chars(&transcript_text(&n), 60_000);
    let req = ChatRequest { system: &system, user: &body, image_b64: None, json: true, purpose: Purpose::Meeting, cloud_allowed: cfg::is_cloud_llm(&s.llm_provider) };
    match llm::chat(&st.egress, &cfgl, req).await {
        Ok(raw) => Some(prompts::parse_summary(&raw)),
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
    st.emit(ev::NOTES, ());
    st.emit(ev::MEETING, MeetingEvent { note_id: n.id.clone(), segment: None, summary: Some(n.summary.clone()), elapsed_sec: elapsed, live: false });
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
