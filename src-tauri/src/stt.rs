//! Speech-to-text: on-device whisper.cpp, or BYOK OpenAI / Groq.
use crate::audio;
use crate::egress::{Egress, Purpose};
use crate::model::{LocalModel, ModelProgressEvent};
use anyhow::{anyhow, bail, Result};
use futures_util::StreamExt;
use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::AsyncWriteExt;

pub struct ModelSpec {
    pub id: &'static str,
    pub file: &'static str,
    pub label: &'static str,
    pub size_mb: u64,
    pub languages: &'static str,
}

pub const MODELS: &[ModelSpec] = &[
    ModelSpec { id: "large-v3-turbo-q5_0", file: "ggml-large-v3-turbo-q5_0.bin", label: "Whisper Large v3 Turbo (recommended)", size_mb: 574, languages: "99 languages incl. Hindi, Gujarati" },
    ModelSpec { id: "large-v3-turbo", file: "ggml-large-v3-turbo.bin", label: "Whisper Large v3 Turbo (full precision)", size_mb: 1624, languages: "99 languages" },
    ModelSpec { id: "small", file: "ggml-small.bin", label: "Whisper Small (fast)", size_mb: 488, languages: "99 languages" },
    ModelSpec { id: "base.en", file: "ggml-base.en.bin", label: "Whisper Base English (tiny & instant)", size_mb: 148, languages: "English" },
];

pub fn spec(id: &str) -> Option<&'static ModelSpec> {
    MODELS.iter().find(|m| m.id == id)
}

pub fn model_path(models_dir: &Path, id: &str) -> Option<PathBuf> {
    spec(id).map(|s| models_dir.join(s.file))
}

pub fn list_models(models_dir: &Path) -> Vec<LocalModel> {
    MODELS
        .iter()
        .map(|m| LocalModel {
            id: m.id.into(),
            label: m.label.into(),
            size_mb: m.size_mb,
            languages: m.languages.into(),
            installed: models_dir.join(m.file).exists(),
        })
        .collect()
}

pub async fn download_model(egress: &Egress, models_dir: &Path, id: &str, progress: impl Fn(ModelProgressEvent)) -> Result<()> {
    let s = spec(id).ok_or_else(|| anyhow!("unknown model {id}"))?;
    let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}", s.file);
    egress.check(&url, Purpose::ModelDownload, false)?;
    tokio::fs::create_dir_all(models_dir).await?;
    let client = egress.client(Purpose::ModelDownload, false);
    let resp = client.get(&url).send().await?.error_for_status()?;
    let total = resp.content_length().unwrap_or(s.size_mb * 1024 * 1024);
    let tmp = models_dir.join(format!("{}.part", s.file));
    let mut f = tokio::fs::File::create(&tmp).await?;
    let mut received: u64 = 0;
    let mut last_emit = 0u64;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        f.write_all(&chunk).await?;
        received += chunk.len() as u64;
        if received - last_emit > 4 * 1024 * 1024 {
            last_emit = received;
            progress(ModelProgressEvent { id: id.into(), received, total, done: false, error: None });
        }
    }
    f.flush().await?;
    drop(f);
    tokio::fs::rename(&tmp, models_dir.join(s.file)).await?;
    egress.record(&url, Purpose::ModelDownload, received);
    progress(ModelProgressEvent { id: id.into(), received, total, done: true, error: None });
    Ok(())
}

/// Known whisper hallucinations on near-silence.
pub fn is_hallucination(text: &str, seconds: f32) -> bool {
    const H: &[&str] = &[
        "thank you.", "thanks for watching!", "thank you for watching.", "you", "bye.", "[blank_audio]",
        "[music]", "(music)", "subtitles by the amara.org community", "[silence]", ".",
    ];
    let t = text.trim().to_lowercase();
    t.is_empty() || (seconds < 3.0 && H.contains(&t.as_str())) || t == "[blank_audio]"
}

/// Free the model's RAM (~0.6–1.6 GB) after this long without dictation.
const IDLE_UNLOAD_SECS: u64 = 180;

pub fn spawn_idle_unloader(w: Arc<LocalWhisper>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            w.unload_if_idle();
        }
    });
}

#[derive(Default)]
pub struct LocalWhisper {
    last_used: Mutex<Option<std::time::Instant>>,
    #[cfg(feature = "local-stt")]
    ctx: Mutex<Option<(String, Arc<whisper_rs::WhisperContext>)>>,
    #[cfg(not(feature = "local-stt"))]
    _p: Mutex<Option<Arc<()>>>,
}

impl LocalWhisper {
    pub fn unload_if_idle(&self) {
        let idle = self.last_used.lock().map(|t| t.elapsed().as_secs() >= IDLE_UNLOAD_SECS).unwrap_or(false);
        if idle {
            #[cfg(feature = "local-stt")]
            {
                if self.ctx.lock().take().is_some() {
                    log::info!("unloaded speech model after idle");
                }
            }
            *self.last_used.lock() = None;
        }
    }

    #[cfg(feature = "local-stt")]
    pub fn transcribe(&self, model_file: &Path, samples: &[f32], language: &str, prompt: &str) -> Result<String> {
        use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};
        if !model_file.exists() {
            bail!("Speech model not downloaded yet. Open Settings → Voice and download it.");
        }
        *self.last_used.lock() = Some(std::time::Instant::now());
        let key = model_file.to_string_lossy().to_string();
        let ctx = {
            let mut g = self.ctx.lock();
            match g.as_ref() {
                Some((k, c)) if *k == key => c.clone(),
                _ => {
                    let c = Arc::new(
                        WhisperContext::new_with_params(&key, WhisperContextParameters::default())
                            .map_err(|e| anyhow!("load model: {e:?}"))?,
                    );
                    *g = Some((key.clone(), c.clone()));
                    c
                }
            }
        };
        let mut state = ctx.create_state().map_err(|e| anyhow!("{e:?}"))?;
        let mut p = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        let lang = if language.is_empty() { "auto" } else { language };
        p.set_language(Some(lang));
        p.set_translate(false);
        p.set_print_progress(false);
        p.set_print_realtime(false);
        p.set_print_special(false);
        p.set_print_timestamps(false);
        p.set_suppress_blank(true);
        p.set_no_context(true);
        p.set_n_threads(std::thread::available_parallelism().map(|n| n.get().min(8) as i32).unwrap_or(4));
        if !prompt.is_empty() {
            p.set_initial_prompt(prompt);
        }
        // whisper needs ≥1s of audio
        let mut buf = samples.to_vec();
        if buf.len() < audio::TARGET_RATE as usize {
            buf.resize(audio::TARGET_RATE as usize + 1600, 0.0);
        }
        state.full(p, &buf).map_err(|e| anyhow!("whisper: {e:?}"))?;
        let n = state.full_n_segments().map_err(|e| anyhow!("{e:?}"))?;
        let mut out = String::new();
        for i in 0..n {
            if let Ok(t) = state.full_get_segment_text(i) {
                out.push_str(&t);
            }
        }
        Ok(out.trim().to_string())
    }

    #[cfg(not(feature = "local-stt"))]
    pub fn transcribe(&self, _m: &Path, _s: &[f32], _l: &str, _p: &str) -> Result<String> {
        bail!("This build has no on-device speech model. Choose OpenAI or Groq in Settings → Voice.")
    }
}

pub async fn transcribe_cloud(egress: &Egress, provider: &str, model: &str, key: &str, samples: &[f32], language: &str, prompt: &str) -> Result<String> {
    let (base, default_model) = match provider {
        "openai" => ("https://api.openai.com/v1", "gpt-4o-mini-transcribe"),
        "groq" => ("https://api.groq.com/openai/v1", "whisper-large-v3-turbo"),
        p => bail!("unsupported STT provider {p}"),
    };
    let model = if model.is_empty() || spec(model).is_some() { default_model } else { model };
    let url = format!("{base}/audio/transcriptions");
    egress.check(&url, Purpose::Stt, true)?;
    let wav = audio::encode_wav(samples, audio::TARGET_RATE)?;
    let bytes = wav.len() as u64;
    let mut form = reqwest::multipart::Form::new()
        .part("file", reqwest::multipart::Part::bytes(wav).file_name("audio.wav").mime_str("audio/wav")?)
        .text("model", model.to_string())
        .text("response_format", "json");
    if !language.is_empty() && language != "auto" {
        form = form.text("language", language.to_string());
    }
    if !prompt.is_empty() {
        form = form.text("prompt", prompt.to_string());
    }
    let resp = egress
        .client(Purpose::Stt, true)
        .post(&url)
        .bearer_auth(key)
        .multipart(form)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await?;
    let status = resp.status();
    let v: serde_json::Value = resp.json().await?;
    egress.record(&url, Purpose::Stt, bytes);
    if !status.is_success() {
        bail!("{provider} STT error {status}: {}", v["error"]["message"].as_str().unwrap_or("unknown"));
    }
    Ok(v["text"].as_str().unwrap_or_default().trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hallucinations_filtered_only_when_short() {
        assert!(is_hallucination("Thank you.", 1.0));
        assert!(!is_hallucination("Thank you.", 6.0));
        assert!(is_hallucination("  ", 10.0));
        assert!(!is_hallucination("Send the deck", 1.0));
    }

    #[test]
    fn catalogue_paths() {
        let d = Path::new("/tmp/m");
        assert_eq!(model_path(d, "base.en").unwrap(), Path::new("/tmp/m/ggml-base.en.bin"));
        assert!(list_models(d).iter().all(|m| !m.installed));
    }
}
