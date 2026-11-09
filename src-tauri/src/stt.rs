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

/// The decoder sometimes emits the whole sentence twice in a row ("A. A."); keep one copy.
/// Only an exact back-to-back repeat of the full text (≥ 3 words) is collapsed.
pub fn collapse_repeat(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    let n = words.len();
    if n >= 6 && n % 2 == 0 {
        let norm = |w: &[&str]| w.iter().map(|x| x.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase()).collect::<Vec<_>>();
        if norm(&words[..n / 2]) == norm(&words[n / 2..]) {
            return words[..n / 2].join(" ");
        }
    }
    text.to_string()
}

/// Mean token probability at or above which a decode in the remembered language is kept.
/// Measured with `--bench-stt` on large-v3-turbo: right-language decodes 0.90–0.98, wrong-language
/// ones 0.24–0.81 — the high wrong ones were empty or one word repeated, which `plausible` rejects.
/// Too high only costs a detection pass (~0.6 s), never a wrong transcript.
pub const CONFIDENT: f32 = 0.7;

/// Does `text` look like a real transcript in `lang`? Rejects empty output, a single word repeated
/// ("झाल झाल झाल झाल"), and text in the wrong script (Hindi decoded as English letters or vice versa).
pub fn plausible(text: &str, lang: &str) -> bool {
    let t = text.trim();
    if t.is_empty() {
        return false;
    }
    let words: Vec<String> = t.split_whitespace().map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase()).filter(|w| !w.is_empty()).collect();
    if words.len() >= 3 && words.iter().all(|w| *w == words[0]) {
        return false;
    }
    let devanagari = t.chars().any(|c| ('\u{0900}'..='\u{097F}').contains(&c));
    let gujarati = t.chars().any(|c| ('\u{0A80}'..='\u{0AFF}').contains(&c));
    match lang {
        "hi" | "mr" | "ne" => devanagari,
        "gu" => gujarati,
        "en" => !devanagari && !gujarati,
        _ => true,
    }
}

/// Timing / confidence of the last `transcribe` (diagnostics + benchmark).
#[derive(Debug, Clone, Copy, Default)]
pub struct DecodeTiming {
    pub detect_ms: u128,
    pub total_ms: u128,
    /// language detection ran for this clip
    pub detected: bool,
    pub confidence: f32,
}

/// Mean of token probabilities (0 when there are none — an empty decode is never "confident").
pub fn mean_confidence(probs: &[f32]) -> f32 {
    if probs.is_empty() {
        0.0
    } else {
        probs.iter().sum::<f32>() / probs.len() as f32
    }
}

fn threads() -> usize {
    std::thread::available_parallelism().map(|n| n.get().min(8)).unwrap_or(4)
}

/// Whisper needs ≥1 s of audio.
fn padded(samples: &[f32]) -> Vec<f32> {
    let mut buf = samples.to_vec();
    if buf.len() < audio::TARGET_RATE as usize {
        buf.resize(audio::TARGET_RATE as usize + 1600, 0.0);
    }
    buf
}

/// Pure helper (unit-tested): highest-probability candidate whose language id is known.
pub fn best_candidate(probs: &[f32], cands: &[String], id_of: impl Fn(&str) -> Option<usize>) -> Option<String> {
    cands
        .iter()
        .filter_map(|c| Some((c, *probs.get(id_of(c)?)?)))
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(c, _)| c.clone())
}

/// Known whisper hallucinations on near-silence.
/// A degenerate repetition loop (e.g. "it's it's it's…") — the failure mode of greedy decoding
/// without temperature fallback. Returns true when one short phrase dominates the output.
pub fn is_degenerate(text: &str) -> bool {
    // Character-level loop: catches glued/hyphenated repeats like "a-tri-tri-tri-tri…" that have
    // no spaces, so the word-based checks below would never see them.
    if has_char_loop(text) {
        return true;
    }
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.len() < 12 {
        return false;
    }
    // longest run of a repeating 1–3 word phrase
    for span in 1..=3 {
        let mut run = 1;
        let mut i = span;
        while i + span <= words.len() {
            if words[i..i + span].eq_ignore_ascii_case_slice(&words[i - span..i]) {
                run += 1;
                if run * span >= 10 && (run * span) as f32 >= words.len() as f32 * 0.6 {
                    return true;
                }
            } else {
                run = 1;
            }
            i += span;
        }
    }
    // unique-word ratio: heavy repetition → few distinct words
    let distinct: std::collections::HashSet<String> = words.iter().map(|w| w.to_lowercase()).collect();
    distinct.len() * 4 <= words.len()
}

/// A short character pattern repeating consecutively and dominating the text — the signature of a
/// decoder stuck in a loop (e.g. "tritritritri…" after hyphens/spaces are stripped).
fn has_char_loop(text: &str) -> bool {
    let c: Vec<char> = text.chars().filter(|ch| ch.is_alphanumeric()).flat_map(|ch| ch.to_lowercase()).take(2000).collect();
    let n = c.len();
    if n < 24 {
        return false;
    }
    for p in 1..=12usize {
        if p * 6 > n {
            break;
        }
        let mut i = 0;
        while i + p * 2 <= n {
            let mut run = 1;
            let mut j = i + p;
            while j + p <= n && c[j..j + p] == c[i..i + p] {
                run += 1;
                j += p;
            }
            // ≥6 consecutive repeats of the block, covering ≥60% of the whole string
            if run >= 6 && (run * p * 5) >= (n * 3) {
                return true;
            }
            i = if run > 1 { j } else { i + 1 };
        }
    }
    false
}

trait EqIgnoreAsciiCaseSlice {
    fn eq_ignore_ascii_case_slice(&self, other: &Self) -> bool;
}
impl EqIgnoreAsciiCaseSlice for [&str] {
    fn eq_ignore_ascii_case_slice(&self, other: &Self) -> bool {
        self.len() == other.len() && self.iter().zip(other).all(|(a, b)| a.eq_ignore_ascii_case(b))
    }
}

pub fn is_hallucination(text: &str, seconds: f32) -> bool {
    const H: &[&str] = &[
        "thank you.", "thanks for watching!", "thank you for watching.", "you", "bye.", "[blank_audio]",
        "[music]", "(music)", "subtitles by the amara.org community", "[silence]", ".",
    ];
    let t = text.trim().to_lowercase();
    t.is_empty() || (seconds < 3.0 && H.contains(&t.as_str())) || t == "[blank_audio]"
}

/// Free the model's RAM (~0.6–1.6 GB) after this long without dictation (Settings → Voice,
/// "Keep the speech model ready"; default 10 minutes).
pub static IDLE_UNLOAD_SECS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(600);

pub fn set_keep_warm_mins(mins: u32) {
    IDLE_UNLOAD_SECS.store(u64::from(mins) * 60, std::sync::atomic::Ordering::Relaxed);
}

pub fn spawn_idle_unloader(w: Arc<LocalWhisper>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            w.unload_if_idle();
        }
    });
}

/// Encoder window for a clip: whisper always encodes 30 s (1500 frames) unless told otherwise;
/// a 3 s sentence only needs ~200. 50 frames/s, +1 s margin, rounded up to 64, clamped.
pub fn audio_ctx_for(secs: f32) -> i32 {
    let frames = ((secs + 1.0) * 50.0).ceil() as i32;
    (((frames + 63) / 64) * 64).clamp(384, 1500)
}

#[derive(Default)]
pub struct LocalWhisper {
    last_used: Mutex<Option<std::time::Instant>>,
    /// language Whisper detected on the last "auto" decode (e.g. "hi", "gu", "en")
    detected: Mutex<Option<String>>,
    /// use the pre-tuning decode settings (benchmark baseline only)
    pub baseline: std::sync::atomic::AtomicBool,
    /// language "auto" only chooses among these (empty = Whisper's own pick out of 99)
    pub auto_langs: Mutex<Vec<String>>,
    /// last transcribe: timing + confidence (diagnostics / benchmark)
    pub last_timing: Mutex<DecodeTiming>,
    #[cfg(feature = "local-stt")]
    ctx: Mutex<Option<(String, Arc<whisper_rs::WhisperContext>)>>,
    #[cfg(not(feature = "local-stt"))]
    _p: Mutex<Option<Arc<()>>>,
}

impl LocalWhisper {
    pub fn unload_if_idle(&self) {
        let keep = IDLE_UNLOAD_SECS.load(std::sync::atomic::Ordering::Relaxed);
        let idle = self.last_used.lock().map(|t| t.elapsed().as_secs() >= keep).unwrap_or(false);
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

    /// Load (or reuse) the model. Called on key press so it's ready by the time you release.
    #[cfg(feature = "local-stt")]
    fn context(&self, model_file: &Path) -> Result<Arc<whisper_rs::WhisperContext>> {
        use whisper_rs::{WhisperContext, WhisperContextParameters};
        if !model_file.exists() {
            bail!("Speech model not downloaded yet. Open Settings → Voice and download it.");
        }
        *self.last_used.lock() = Some(std::time::Instant::now());
        let key = model_file.to_string_lossy().to_string();
        let mut g = self.ctx.lock();
        Ok(match g.as_ref() {
            Some((k, c)) if *k == key => c.clone(),
            _ => {
                let mut cp = WhisperContextParameters::default();
                // flash attention: faster decoding on Metal (no word-level DTW needed for dictation)
                cp.flash_attn(!self.baseline.load(std::sync::atomic::Ordering::Relaxed));
                let c = Arc::new(WhisperContext::new_with_params(&key, cp).map_err(|e| anyhow!("load model: {e:?}"))?);
                *g = Some((key, c.clone()));
                c
            }
        })
    }

    #[cfg(feature = "local-stt")]
    pub fn warm(&self, model_file: &Path) {
        let t = std::time::Instant::now();
        let was_loaded = self.is_loaded();
        if self.context(model_file).is_ok() {
            log::info!("speech model ready in {} ms ({})", t.elapsed().as_millis(), if was_loaded { "warm" } else { "cold load" });
        }
    }

    /// The model is in memory (the next dictation skips loading it).
    #[cfg(feature = "local-stt")]
    pub fn is_loaded(&self) -> bool {
        self.ctx.lock().is_some()
    }

    #[cfg(not(feature = "local-stt"))]
    pub fn warm(&self, _model_file: &Path) {}

    /// Transcribe a clip.
    ///
    /// `language` "auto" is adaptive: decode straight away in the language used last (~200 ms) and
    /// keep it if Whisper is confident; otherwise detect the language among `auto_langs` on a
    /// *separate* state and decode again. Whisper is never asked to auto-detect inside the decoding
    /// state — its detector encodes a full 30 s window while the fast decoder uses a clip-sized one,
    /// and mixing the two corrupted output ("Remind me to call the bank…" → "and the") and cost ~2.4 s.
    #[cfg(feature = "local-stt")]
    pub fn transcribe(&self, model_file: &Path, samples: &[f32], language: &str, prompt: &str) -> Result<String> {
        let t0 = std::time::Instant::now();
        let mut timing = DecodeTiming::default();
        let lang_in = if language.is_empty() { "auto" } else { language };
        let (text, confidence) = if lang_in != "auto" {
            self.decode_checked(model_file, samples, lang_in, prompt)?
        } else {
            let cands = self.auto_langs.lock().clone();
            let sticky = self.detected.lock().clone().filter(|l| cands.is_empty() || cands.contains(l));
            let first = match &sticky {
                Some(l) => Some((l.clone(), self.decode_checked(model_file, samples, l, prompt)?)),
                None => None,
            };
            match first {
                Some((l, r)) if r.1 >= CONFIDENT && plausible(&r.0, &l) => r,
                first => {
                    let td = std::time::Instant::now();
                    let lang = self.detect_language(model_file, samples, &cands)?;
                    timing.detect_ms = td.elapsed().as_millis();
                    timing.detected = true;
                    *self.detected.lock() = Some(lang.clone());
                    match first {
                        // detection agrees with the sticky language → the first decode stands
                        Some((l, r)) if l == lang => r,
                        _ => self.decode_checked(model_file, samples, &lang, prompt)?,
                    }
                }
            }
        };
        timing.total_ms = t0.elapsed().as_millis();
        timing.confidence = confidence;
        *self.last_timing.lock() = timing;
        log::info!(
            "stt: {} ms (detect {} ms) lang={:?} conf={:.2}",
            timing.total_ms,
            timing.detect_ms,
            self.detected.lock().clone(),
            confidence
        );
        Ok(text)
    }

    /// One decode in a known language; if the fast decoder degenerates into a repetition loop,
    /// retry once with the safe decoder (temperature fallback on). Returns (text, confidence).
    #[cfg(feature = "local-stt")]
    fn decode_checked(&self, model_file: &Path, samples: &[f32], lang: &str, prompt: &str) -> Result<(String, f32)> {
        let safe_mode = self.baseline.load(std::sync::atomic::Ordering::Relaxed);
        let out = self.decode_once(model_file, samples, lang, prompt, safe_mode)?;
        if !safe_mode && is_degenerate(&out.0) {
            log::warn!("fast STT degenerated; retrying this clip with the safe decoder");
            return self.decode_once(model_file, samples, lang, prompt, true);
        }
        Ok(out)
    }

    /// Most likely language among `cands` (all languages if empty), on a fresh state so the
    /// decoding state never sees the detector's full-window encode.
    #[cfg(feature = "local-stt")]
    fn detect_language(&self, model_file: &Path, samples: &[f32], cands: &[String]) -> Result<String> {
        let ctx = self.context(model_file)?;
        let mut state = ctx.create_state().map_err(|e| anyhow!("{e:?}"))?;
        let threads = threads();
        let buf = padded(samples);
        state.pcm_to_mel(&buf, threads).map_err(|e| anyhow!("mel: {e:?}"))?;
        let (top, probs) = state.lang_detect(0, threads).map_err(|e| anyhow!("language detect: {e:?}"))?;
        let picked = if cands.is_empty() {
            whisper_rs::get_lang_str(top).map(|s| s.to_string())
        } else {
            best_candidate(&probs, cands, |c| whisper_rs::get_lang_id(c).map(|i| i as usize))
        };
        Ok(picked.unwrap_or_else(|| "en".into()))
    }

    #[cfg(feature = "local-stt")]
    fn decode_once(&self, model_file: &Path, samples: &[f32], lang: &str, prompt: &str, safe_mode: bool) -> Result<(String, f32)> {
        use whisper_rs::{FullParams, SamplingStrategy};
        let ctx = self.context(model_file)?;
        let mut state = ctx.create_state().map_err(|e| anyhow!("{e:?}"))?;
        let buf = padded(samples);
        let mut p = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        p.set_language(Some(lang));
        p.set_translate(false);
        p.set_print_progress(false);
        p.set_print_realtime(false);
        p.set_print_special(false);
        p.set_print_timestamps(false);
        p.set_suppress_blank(true);
        p.set_no_context(true);
        if !safe_mode {
            p.set_no_timestamps(true);
            let secs = samples.len() as f32 / audio::TARGET_RATE as f32;
            if secs < 20.0 {
                // short clip: max speed — one greedy pass (no temperature fallback re-decodes) and
                // an encoder window sized to the clip instead of a fixed 30 s.
                p.set_temperature_inc(0.0);
                p.set_single_segment(true);
                p.set_audio_ctx(audio_ctx_for(secs));
            }
            // longer clips keep Whisper's default temperature fallback: greedy decoding over many
            // seconds can get stuck repeating a token forever, and the fallback is what breaks it.
        }
        p.set_n_threads(threads() as i32);
        if !prompt.is_empty() {
            p.set_initial_prompt(prompt);
        }
        state.full(p, &buf).map_err(|e| anyhow!("whisper: {e:?}"))?;
        let eot = ctx.token_eot();
        let n = state.full_n_segments().map_err(|e| anyhow!("{e:?}"))?;
        let mut out = String::new();
        let mut probs = vec![];
        for i in 0..n {
            if let Ok(t) = state.full_get_segment_text(i) {
                out.push_str(&t);
            }
            for j in 0..state.full_n_tokens(i).unwrap_or(0) {
                if let Ok(d) = state.full_get_token_data(i, j) {
                    if d.id < eot {
                        probs.push(d.p);
                    }
                }
            }
        }
        Ok((collapse_repeat(out.trim()), mean_confidence(&probs)))
    }

    /// Language Whisper last auto-detected ("hi", "gu", "en", …), if any.
    pub fn detected_lang(&self) -> Option<String> {
        self.detected.lock().clone()
    }

    /// Forget the remembered language: the next "auto" clip runs detection.
    pub fn forget_language(&self) {
        *self.detected.lock() = None;
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


/// First-word latency with a cold vs a warm model: `cargo test --release --lib warm_model_latency -- --ignored --nocapture`.
#[cfg(all(test, feature = "local-stt"))]
mod latency {
    use super::*;
    #[test]
    #[ignore]
    fn warm_model_latency() {
        let dir = dirs::data_dir().unwrap().join("com.flo.flow/models");
        let model = ["ggml-large-v3-turbo-q5_0.bin", "ggml-large-v3-turbo.bin", "ggml-base.en.bin"].iter().map(|f| dir.join(f)).find(|p| p.exists());
        let Some(model) = model else { return };
        let w = LocalWhisper::default();
        let clip = vec![0.0f32; 16_000 * 2];
        let t = std::time::Instant::now();
        let _ = w.transcribe(&model, &clip, "en", "");
        let cold = t.elapsed().as_millis();
        let t = std::time::Instant::now();
        let _ = w.transcribe(&model, &clip, "en", "");
        let warm = t.elapsed().as_millis();
        println!("model {}: first transcription cold {cold} ms, warm {warm} ms", model.file_name().unwrap().to_string_lossy());
        assert!(w.is_loaded());
    }
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
    fn audio_ctx_scales_with_clip_length() {
        assert_eq!(audio_ctx_for(1.0), 384); // floor keeps very short clips accurate
        assert_eq!(audio_ctx_for(6.0), 384);
        assert_eq!(audio_ctx_for(10.0), 576);
        assert_eq!(audio_ctx_for(40.0), 1500);
        assert_eq!(audio_ctx_for(20.0) % 64, 0);
    }

    #[test]
    fn detects_degenerate_repetition() {
        assert!(is_degenerate(&"it's ".repeat(40)));
        assert!(is_degenerate("the end of the world, it's the end of the world, it's the end of the world, it's the end"));
        assert!(is_degenerate("a-tri-tri-tri-tri-tri-tri-tri-tri-tri-tri-tri-tri-tri-tri-tri-tri")); // glued, no spaces
        assert!(is_degenerate(&"tri".repeat(30))); // fully glued loop
        assert!(!is_degenerate("Send the deck to Rahul by Friday and let's meet at six tomorrow afternoon."));
        assert!(!is_degenerate("The quarterly report covers revenue, retention and the roadmap for next year.")); // normal long speech
        assert!(!is_degenerate("okay")); // too short to judge
    }

    #[test]
    fn collapses_a_sentence_said_twice() {
        assert_eq!(
            collapse_repeat("आज का काम पूरा हो गया, अब घर जा रहा हूं. आज का काम पूरा हो गया, अब घर जा रहा हूं."),
            "आज का काम पूरा हो गया, अब घर जा रहा हूं."
        );
        // a real repeated phrase inside a longer sentence is left alone
        assert_eq!(collapse_repeat("very very good idea"), "very very good idea");
        assert_eq!(collapse_repeat("Send the deck to Rahul by Friday."), "Send the deck to Rahul by Friday.");
    }

    #[test]
    fn plausibility_catches_wrong_language_decodes() {
        // real wrong-language outputs from the benchmark
        assert!(!plausible("झाल झाल झाल झाल", "hi"));
        assert!(!plausible("", "hi"));
        assert!(!plausible("Today's work is full of people. I'm going to go home.", "hi"));
        assert!(!plausible("जो द्राफ एक टेम विशिंग एक बाप्पी धनते रस?", "en"));
        // right-language outputs pass, including Hinglish (English words inside Hindi)
        assert!(plausible("मुझी राहुल को invoice भेजना है।", "hi"));
        assert!(plausible("Send the deck to Rahul by Friday", "en"));
        assert!(plausible("કાલે મીટિંગ છે", "gu"));
        assert!(plausible("ok", "en"));
    }

    #[test]
    fn empty_decode_is_never_confident() {
        assert_eq!(mean_confidence(&[]), 0.0);
        assert!((mean_confidence(&[0.9, 0.7]) - 0.8).abs() < 1e-6);
        assert!(mean_confidence(&[0.2, 0.3]) < CONFIDENT);
    }

    #[test]
    fn best_candidate_ignores_languages_outside_the_set() {
        // ids: en=0, hi=1, ur=2, gu=3 — Urdu scores highest but isn't a candidate → Hindi wins
        let probs = [0.10, 0.30, 0.55, 0.05];
        let id = |c: &str| ["en", "hi", "ur", "gu"].iter().position(|x| *x == c);
        let cands: Vec<String> = ["en", "hi", "gu"].iter().map(|s| s.to_string()).collect();
        assert_eq!(best_candidate(&probs, &cands, id).as_deref(), Some("hi"));
        // unknown codes are skipped, not a panic
        let odd: Vec<String> = vec!["xx".into(), "en".into()];
        assert_eq!(best_candidate(&probs, &odd, id).as_deref(), Some("en"));
        assert_eq!(best_candidate(&probs, &[], id), None);
    }

    #[test]
    fn catalogue_paths() {
        let d = Path::new("/tmp/m");
        assert_eq!(model_path(d, "base.en").unwrap(), Path::new("/tmp/m/ggml-base.en.bin"));
        assert!(list_models(d).iter().all(|m| !m.installed));
    }
}
