//! Push-to-talk sessions: dictation (speak → clean text pasted) and assistant (speak → action).
use crate::audio::{self, Recorder};
use crate::egress::Purpose;
use crate::llm::{self, ChatRequest, LlmConfig};
use crate::model::*;
use crate::state::{ActiveSession, Shared};
use crate::{assistant, attention, platform, prompts, settings as cfg, stt, text};
use anyhow::{anyhow, Result};
use std::time::Instant;

const MIN_HOLD_MS: u128 = 250;

pub fn start(st: &Shared, mode: Mode) -> Result<()> {
    let mut guard = st.session.lock();
    if guard.is_some() {
        return Ok(());
    }
    let front = st.target_app();
    let selection = if mode == Mode::Assistant { platform::copy_selection() } else { None };
    let app = st.clone();
    let recorder = Recorder::start(move |rms| app.emit(ev::LEVEL, LevelEvent { rms }))?;
    let s = st.settings();
    let screen = if mode == Mode::Assistant && s.assistant_screen_context && platform::permissions().screen {
        Some(tauri::async_runtime::spawn_blocking(|| attention::capture_focused_text().map(|(_, _, t)| t)))
    } else {
        None
    };
    *guard = Some(ActiveSession { mode, recorder, front, selection, started: Instant::now(), screen });
    drop(guard);
    st.state(Phase::Listening, mode, None);
    Ok(())
}

pub fn switch_mode(st: &Shared, mode: Mode) {
    let mut g = st.session.lock();
    if let Some(s) = g.as_mut() {
        if s.mode != mode {
            s.mode = mode;
            if mode == Mode::Assistant && s.selection.is_none() {
                s.selection = platform::copy_selection();
            }
            drop(g);
            st.state(Phase::Listening, mode, None);
        }
    }
}

pub fn cancel(st: &Shared) {
    if let Some(s) = st.session.lock().take() {
        let mode = s.mode;
        let _ = s.recorder.stop();
        st.state(Phase::Idle, mode, None);
    }
}

pub async fn stop(st: Shared) {
    let Some(sess) = st.session.lock().take() else { return };
    let mode = sess.mode;
    if sess.started.elapsed().as_millis() < MIN_HOLD_MS {
        let _ = sess.recorder.stop();
        st.state(Phase::Idle, mode, None);
        return;
    }
    if let Err(e) = finish(&st, sess).await {
        log::warn!("session failed: {e:#}");
        st.state(Phase::Error, mode, Some(e.to_string()));
    }
}

async fn finish(st: &Shared, sess: ActiveSession) -> Result<()> {
    let ActiveSession { mode, recorder, front, selection, started, screen } = sess;
    let duration_ms = started.elapsed().as_millis() as u64;
    let samples = tokio::task::spawn_blocking(move || recorder.stop()).await?;
    if audio::rms(&samples) < 0.003 {
        return Err(anyhow!("Didn't catch that — is the right microphone selected?"));
    }
    st.state(Phase::Transcribing, mode, None);
    let t0 = Instant::now();
    let raw = transcribe(st, samples.clone()).await?;
    let secs = samples.len() as f32 / audio::TARGET_RATE as f32;
    if stt::is_hallucination(&raw, secs) {
        return Err(anyhow!("Didn't catch that"));
    }
    st.emit(ev::TRANSCRIPT, TranscriptEvent { text: raw.clone(), is_final: false });

    match mode {
        Mode::Dictation | Mode::Meeting => {
            let final_text = cleanup(st, &raw, &front.name).await;
            platform::activate_app(front.pid);
            let ft = final_text.clone();
            tokio::task::spawn_blocking(move || platform::paste_text(&ft)).await??;
            save(st, mode, &front.name, &raw, &final_text, duration_ms, t0.elapsed().as_millis() as u64);
            st.emit(ev::TRANSCRIPT, TranscriptEvent { text: final_text, is_final: true });
            st.state(Phase::Done, mode, None);
        }
        Mode::Assistant => {
            st.state(Phase::Thinking, mode, None);
            let screen_text = match screen {
                Some(h) => h.await.ok().flatten(),
                None => None,
            };
            let resp = assistant::run(st, &raw, selection, &front, screen_text).await?;
            save(st, mode, &front.name, &raw, &resp.reply, duration_ms, t0.elapsed().as_millis() as u64);
            let _ = st.db.insert_assistant(&resp);
            st.emit(ev::ASSISTANT, resp);
            st.state(Phase::Done, mode, None);
        }
    }
    Ok(())
}

fn save(st: &Shared, mode: Mode, app: &str, raw: &str, final_text: &str, duration_ms: u64, latency_ms: u64) {
    let d = Dictation {
        id: crate::db::new_id(),
        created_at: chrono::Local::now().to_rfc3339(),
        app: if app.is_empty() { "Unknown".into() } else { app.into() },
        mode,
        raw_text: raw.into(),
        final_text: final_text.into(),
        words: text::word_count(if mode == Mode::Assistant { raw } else { final_text }),
        duration_ms,
        latency_ms,
    };
    if let Err(e) = st.db.insert_dictation(&d) {
        log::error!("save dictation: {e}");
    }
}

/// STT with the configured provider. Personal dictionary words are passed as a prompt hint.
pub async fn transcribe(st: &Shared, samples: Vec<f32>) -> Result<String> {
    let s = st.settings();
    let vocab: Vec<String> = st.db.list_dictionary().unwrap_or_default().into_iter().map(|d| d.replacement.unwrap_or(d.word)).collect();
    let prompt = vocab.join(", ");
    if s.stt_provider == "local" {
        let path = stt::model_path(&st.models_dir, &s.stt_model).ok_or_else(|| anyhow!("Unknown speech model {}", s.stt_model))?;
        let w = st.whisper.clone();
        let lang = s.language.clone();
        tokio::task::spawn_blocking(move || w.transcribe(&path, &samples, &lang, &prompt)).await?
    } else {
        let key = crate::secrets::get_api_key(&s.stt_provider)
            .ok_or_else(|| anyhow!("No API key for {} — add it in Settings → AI.", s.stt_provider))?;
        stt::transcribe_cloud(&st.egress, &s.stt_provider, &s.stt_model, &key, &samples, &s.language, &prompt).await
    }
}

async fn cleanup(st: &Shared, raw: &str, app: &str) -> String {
    let s = st.settings();
    let dict: Vec<(String, String)> = st
        .db
        .list_dictionary()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|d| d.replacement.map(|r| (d.word, r)))
        .collect();
    let base = text::apply_dictionary(raw, &dict);
    let cfg = LlmConfig::from_settings(&s);
    // very short utterances don't need an LLM round-trip
    if !s.cleanup_enabled || !cfg.is_configured() || text::word_count(&base) < 4 {
        return text::basic_cleanup(&base);
    }
    let vocab: Vec<String> = st.db.list_dictionary().unwrap_or_default().into_iter().map(|d| d.replacement.unwrap_or(d.word)).collect();
    let system = prompts::cleanup_system(app, &vocab);
    let req = ChatRequest {
        system: &system,
        user: &base,
        image_b64: None,
        json: false,
        purpose: Purpose::Cleanup,
        cloud_allowed: cfg::is_cloud_llm(&s.llm_provider),
    };
    match tokio::time::timeout(std::time::Duration::from_secs(8), llm::chat(&st.egress, &cfg, req)).await {
        Ok(Ok(out)) => {
            let out = text::apply_dictionary(&text::strip_llm_wrapping(&out), &dict);
            // guard against the model answering instead of cleaning
            let (a, b) = (text::word_count(&base) as f32, text::word_count(&out) as f32);
            if out.is_empty() || b > a * 1.8 + 8.0 {
                text::basic_cleanup(&base)
            } else {
                out
            }
        }
        Ok(Err(e)) => {
            log::warn!("cleanup LLM failed: {e}");
            st.toast("info", format!("AI cleanup skipped: {e}"));
            text::basic_cleanup(&base)
        }
        Err(_) => text::basic_cleanup(&base),
    }
}
