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
/// a single push-to-talk recording never runs longer than this
const MAX_RECORDING_SECS: u64 = 120;
/// hands-free recordings may run longer
const MAX_HANDS_FREE_SECS: u64 = 600;

/// ctrl/fn + Space: keep listening after the keys are released.
pub fn lock(st: &Shared, mode: Mode) {
    use std::sync::atomic::Ordering;
    let mut g = st.session.lock();
    match g.as_mut() {
        Some(s) => {
            s.locked = true;
            st.state(Phase::Listening, s.mode, Some("hands-free".into()));
        }
        None => st.lock_pending.store(true, Ordering::SeqCst), // start still in progress
    }
    let _ = mode;
}

/// `via_hotkey`: started by holding a key → if the key is already up when we're ready
/// (quick tap released during the ~300 ms start), cancel instead of recording forever.
pub fn start(st: &Shared, mode: Mode, via_hotkey: bool) -> Result<()> {
    if !st.signed_in.load(std::sync::atomic::Ordering::SeqCst) {
        crate::show_dashboard(&st.app, None);
        return Err(anyhow!("Sign in to Flo to start dictating."));
    }
    let mut guard = st.session.lock();
    if guard.is_some() {
        return Ok(());
    }
    let front = st.target_app();
    let selection = if mode == Mode::Assistant { platform::copy_selection() } else { None };
    let app = st.clone();
    let recorder = Recorder::start(move |rms| app.emit(ev::LEVEL, LevelEvent { rms }))
        .map_err(|e| anyhow!("Microphone unavailable ({e}). Allow Flo in System Settings → Privacy → Microphone."))?;
    let s = st.settings();
    let screen = if mode == Mode::Assistant && s.assistant_screen_context && platform::permissions().screen {
        Some(tauri::async_runtime::spawn_blocking(|| attention::capture_focused_text().map(|(_, _, t)| t)))
    } else {
        None
    };
    let locked = st.lock_pending.swap(false, std::sync::atomic::Ordering::SeqCst);
    if via_hotkey && !locked && !st.ptt_down.load(std::sync::atomic::Ordering::SeqCst) {
        // released while we were starting → it was a tap, not push-to-talk
        let _ = recorder.stop();
        st.state(Phase::Idle, mode, None);
        return Ok(());
    }
    let started = Instant::now();
    // speed: start loading the speech model now, in parallel with the user talking
    let local = s.stt_provider == "local";
    if local {
        if let Some(path) = stt::model_path(&st.models_dir, &s.stt_model) {
            let w = st.whisper.clone();
            tauri::async_runtime::spawn_blocking(move || w.warm(&path));
        }
    }
    // speed: transcribe finished sentences while still talking (dictation, on-device)
    let stream = (local && mode == Mode::Dictation).then(|| std::sync::Arc::new(crate::state::StreamBuf::default()));
    let stream_task = stream.clone().map(|buf| tauri::async_runtime::spawn(stream_while_talking(st.clone(), started, buf)));
    *guard = Some(ActiveSession { mode, recorder, front, selection, started, screen, locked, stream, stream_task });
    // emit while holding the lock so a concurrent cancel/stop can't be overtaken by "listening"
    st.state(Phase::Listening, mode, locked.then(|| "hands-free".to_string()));
    drop(guard);
    // watchdog: never record forever (hands-free gets longer)
    let st2 = st.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(MAX_RECORDING_SECS)).await;
        let state = st2.session.lock().as_ref().map(|s| (s.started == started, s.locked));
        let Some((true, locked)) = state else { return };
        if locked {
            tokio::time::sleep(std::time::Duration::from_secs(MAX_HANDS_FREE_SECS - MAX_RECORDING_SECS)).await;
            if st2.session.lock().as_ref().map(|s| s.started != started).unwrap_or(true) {
                return;
            }
        }
        log::warn!("recording hit its time limit — stopping");
        stop(st2).await;
    });
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
            st.state(Phase::Listening, mode, None);
            drop(g);
        }
    }
}

pub fn cancel(st: &Shared) {
    let mut g = st.session.lock();
    let mode = g.as_ref().map(|s| s.mode).unwrap_or(Mode::Dictation);
    if let Some(s) = g.take() {
        let _ = s.recorder.stop();
    }
    // always reset the island, even if there was nothing to cancel
    st.state(Phase::Idle, mode, None);
}

pub async fn stop(st: Shared) {
    let taken = st.session.lock().take();
    let Some(sess) = taken else {
        // nothing recording (e.g. start was cancelled) → make sure the island isn't left spinning
        if st.meeting.lock().is_none() {
            st.state(Phase::Idle, Mode::Dictation, None);
        }
        return;
    };
    let mode = sess.mode;
    if sess.started.elapsed().as_millis() < MIN_HOLD_MS {
        let _ = sess.recorder.stop();
        st.state(Phase::Idle, mode, None);
        return;
    }
    if let Err(e) = finish(&st, sess).await {
        log::warn!("session failed: {e:#}");
        st.finish(Phase::Error, mode, Some(e.to_string()));
    }
}

/// Background transcriber for a dictation: commits each sentence at a natural pause, so on release
/// only the last few seconds still need transcribing.
async fn stream_while_talking(st: Shared, started: Instant, buf: std::sync::Arc<crate::state::StreamBuf>) {
    use crate::livetx::{Action, Segmenter, SLICE_MS};
    use std::sync::atomic::Ordering;
    let mut seg = Segmenter::default();
    let mut context = String::new();
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(SLICE_MS)).await;
        if buf.stop.load(Ordering::SeqCst) {
            break;
        }
        let slice = {
            let g = st.session.lock();
            match g.as_ref() {
                Some(s) if s.started == started => s.recorder.take_samples(),
                _ => break,
            }
        };
        let ms = (slice.len() as u64 * 1000) / audio::TARGET_RATE as u64;
        let rms = audio::rms(&slice);
        buf.pending.lock().extend_from_slice(&slice);
        match seg.push(ms.max(1), rms) {
            Action::Final => {
                let audio_now = std::mem::take(&mut *buf.pending.lock());
                let secs = audio_now.len() as f32 / audio::TARGET_RATE as f32;
                if let Ok(t) = transcribe_with_prompt(&st, audio_now, &context).await {
                    if !t.trim().is_empty() && !stt::is_hallucination(&t, secs) {
                        context = text::truncate_chars(&t, 200);
                        buf.committed.lock().push(t.trim().to_string());
                    }
                }
            }
            Action::Discard => {
                // only drop pure silence; a short word before a pause stays for the next sentence
                let mut p = buf.pending.lock();
                if audio::rms(&p) < 0.006 {
                    p.clear();
                }
            }
            _ => {}
        }
    }
}

async fn finish(st: &Shared, sess: ActiveSession) -> Result<()> {
    let ActiveSession { mode, recorder, front, selection, started, screen, stream, stream_task, .. } = sess;
    let duration_ms = started.elapsed().as_millis() as u64;
    // let the background transcriber finish the sentence it's on, then take what's left
    if let Some(buf) = &stream {
        buf.stop.store(true, std::sync::atomic::Ordering::SeqCst);
    }
    if let Some(t) = stream_task {
        let _ = t.await;
    }
    let mut samples = stream.as_ref().map(|b| std::mem::take(&mut *b.pending.lock())).unwrap_or_default();
    samples.extend(tokio::task::spawn_blocking(move || recorder.stop()).await?);
    let committed: Vec<String> = stream.as_ref().map(|b| b.committed.lock().clone()).unwrap_or_default();
    if committed.is_empty() && audio::rms(&samples) < 0.003 {
        return Err(anyhow!("I didn't hear anything. Check the microphone in System Settings → Sound."));
    }
    st.state(Phase::Transcribing, mode, None);
    let t0 = Instant::now();
    let secs = samples.len() as f32 / audio::TARGET_RATE as f32;
    let tail = if audio::rms(&samples) >= 0.003 {
        let ctx = committed.last().map(|c| text::truncate_chars(c, 200)).unwrap_or_default();
        tokio::time::timeout(std::time::Duration::from_secs(60), transcribe_with_prompt(st, samples, &ctx))
            .await
            .map_err(|_| anyhow!("Transcription took too long. Try a smaller speech model in Settings → Voice."))??
    } else {
        String::new()
    };
    let tail = if stt::is_hallucination(&tail, secs) && !committed.is_empty() { String::new() } else { tail };
    let raw = committed.into_iter().chain(std::iter::once(tail)).filter(|s| !s.trim().is_empty()).collect::<Vec<_>>().join(" ");
    if stt::is_hallucination(&raw, secs.max(1.0)) {
        return Err(anyhow!("Didn't catch that. Try speaking a bit longer."));
    }
    st.emit(ev::TRANSCRIPT, TranscriptEvent { text: raw.clone(), is_final: false });

    match mode {
        Mode::Dictation | Mode::Meeting => {
            let final_text = cleanup(st, &raw, &front.name).await;
            platform::activate_app(front.pid);
            let ft = final_text.clone();
            tokio::task::spawn_blocking(move || platform::paste_text(&ft)).await??;
            save(st, mode, &front.name, &raw, &final_text, duration_ms, t0.elapsed().as_millis() as u64);
            crate::corrections::track(st.clone(), final_text.clone(), front.name.clone());
            st.emit(ev::TRANSCRIPT, TranscriptEvent { text: final_text, is_final: true });
            st.finish(Phase::Done, mode, None);
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
            st.finish(Phase::Done, mode, None);
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
/// Same, with extra context (e.g. the previous sentence in a meeting) for better continuity.
pub async fn transcribe_with_prompt(st: &Shared, samples: Vec<f32>, context: &str) -> Result<String> {
    let s = st.settings();
    let vocab: Vec<String> = st.db.list_dictionary().unwrap_or_default().into_iter().map(|d| d.replacement.unwrap_or(d.word)).collect();
    let mut prompt = vocab.join(", ");
    if !context.trim().is_empty() {
        if !prompt.is_empty() {
            prompt.push_str(". ");
        }
        prompt.push_str(context.trim());
    }
    if s.stt_provider == "local" {
        let path = stt::model_path(&st.models_dir, &s.stt_model).ok_or_else(|| anyhow!("Unknown speech model {}", s.stt_model))?;
        let w = st.whisper.clone();
        let lang = s.language.clone();
        let samples = audio::trim_silence(&samples);
        tokio::task::spawn_blocking(move || w.transcribe(&path, &samples, &lang, &prompt)).await?
    } else {
        // cloud STT bills per second of audio → drop leading/trailing silence
        let samples = audio::trim_silence(&samples);
        let key = crate::secrets::get_api_key_async(&s.stt_provider)
            .await?
            .ok_or_else(|| anyhow!("No API key for {}. Add it in Settings → AI.", s.stt_provider))?;
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
    // free local pass unless the transcript actually needs the LLM (fillers, corrections, long text)
    if !s.cleanup_enabled || !cfg.is_configured() || !text::needs_llm_cleanup(&base) {
        return text::basic_cleanup(&base);
    }
    let vocab: Vec<String> = st.db.list_dictionary().unwrap_or_default().into_iter().map(|d| d.replacement.unwrap_or(d.word)).collect();
    let mut system = prompts::cleanup_system(app, &vocab);
    // short personal style notes ride along; long ones would cost tokens on every dictation
    let sp = s.system_prompt.trim();
    if !sp.is_empty() && sp.len() <= 300 {
        system.push_str(&format!(" Style: {sp}"));
    }
    let req = ChatRequest {
        system: &system,
        user: &base,
        image_b64: None,
        json: false,
        purpose: Purpose::Cleanup,
        cloud_allowed: cfg::is_cloud_llm(&s.llm_provider),
        // output ≈ input length; ~1.4 tokens/word + headroom
        max_tokens: (text::word_count(&base) * 2 + 40).min(2000),
    };
    // speed: AI polish gets 2.5 s; otherwise paste the locally cleaned text right away
    match tokio::time::timeout(std::time::Duration::from_millis(2500), llm::chat(&st.egress, &cfg, req)).await {
        Ok(Ok(out)) => {
            let out = text::strip_ai_dashes(&text::apply_dictionary(&text::strip_llm_wrapping(&out), &dict));
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
