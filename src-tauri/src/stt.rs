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

/// Join the sentences decoded at each pause into one transcript. Each one is decoded with the
/// previous sentence as Whisper's prompt, and a short or unclear chunk can come back as a copy of
/// that prompt — those copies used to be joined as is ("…Light Blue color Light Blue color").
/// A chunk that repeats the previous one is dropped, and loops spanning chunks are collapsed.
pub fn join_chunks(chunks: &[String]) -> String {
    let mut kept: Vec<&str> = vec![];
    for c in chunks {
        let c = c.trim();
        if c.is_empty() {
            continue;
        }
        if let Some(prev) = kept.last() {
            let (w, pw) = (norm_words(c), norm_words(prev));
            if w.len() >= 3 && (w == pw || (pw.len() > w.len() && pw.ends_with(&w))) {
                continue;
            }
        }
        kept.push(c);
    }
    collapse_loops(&kept.join(" "))
}

fn norm_words(t: &str) -> Vec<String> {
    t.split_whitespace().map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase()).filter(|w| !w.is_empty()).collect()
}

/// Remove the decoder's repetition loops: the same sentence (or its tail) emitted again and again,
/// a short phrase repeated three or more times in a row, and the cut-off start of yet another
/// copy at the end. Ordinary speech ("very very good", "No, no, I meant…") is left alone.
pub fn collapse_loops(text: &str) -> String {
    let text = collapse_repeat(text.trim());
    // 1) sentence level
    let mut sentences: Vec<String> = vec![];
    let mut cur = String::new();
    for ch in text.chars() {
        cur.push(ch);
        if matches!(ch, '.' | '?' | '!' | '।' | '॥') {
            sentences.push(std::mem::take(&mut cur));
        }
    }
    if !cur.trim().is_empty() {
        sentences.push(cur);
    }
    let mut kept: Vec<String> = vec![];
    for (i, sent) in sentences.iter().enumerate() {
        let w = norm_words(sent);
        if w.is_empty() {
            continue;
        }
        if let Some(prev) = kept.last() {
            let pw = norm_words(prev);
            let last = i == sentences.len() - 1;
            // the same sentence again, or the tail of the previous one again ("…लाब शो. अने शात भाजी लाब शो.")
            let repeat = w == pw || (pw.len() > w.len() && pw.ends_with(&w) && w.len() >= 2 && w.len() * 2 <= pw.len() + 1);
            // an unfinished final copy: the beginning of the previous sentence, cut off
            let cut_copy = last && !sent.trim_end().ends_with(['.', '?', '!', '।']) && pw.len() >= w.len() && {
                let n = w.len();
                pw[..n - 1] == w[..n - 1] && pw[n - 1].starts_with(w[n - 1].as_str())
            };
            if repeat || cut_copy {
                continue;
            }
        }
        kept.push(sent.trim().to_string());
    }
    collapse_phrase_loops(&kept.join(" "))
}

/// 1–6 words repeated ≥3 times in a row (≥4 for a single word) → once, including a cut-off
/// partial copy at the very end. Keeps the punctuation the loop ended with ("at 11 at 11." → "at 11.").
fn collapse_phrase_loops(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    let key: Vec<String> = words.iter().map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase()).collect();
    let mut out: Vec<String> = vec![];
    let mut i = 0;
    'outer: while i < words.len() {
        for n in 1..=6usize {
            if i + n * 2 > words.len() || key[i..i + n].iter().any(|k| k.is_empty()) {
                continue;
            }
            let mut reps = 1;
            while i + n * (reps + 1) <= words.len() && key[i + n * reps..i + n * (reps + 1)] == key[i..i + n] {
                reps += 1;
            }
            let mut end = i + n * reps;
            // the decoder was cut off mid-copy: "प्राव प्राव प्राव प्र"
            let rest = &key[end..];
            let partial = !rest.is_empty() && rest.len() <= n && rest.iter().zip(&key[i..i + n]).all(|(a, b)| b.starts_with(a.as_str()));
            let need = if n == 1 { 4 } else { 3 };
            if reps + usize::from(partial) < need {
                continue;
            }
            // the loop was found one or more words early: "…Yellow color | Light, Thim and Light
            // Blue color | Light, Thim …" read as copies of "color Light … Blue" swallows the last
            // "color". When the copies really start at a capitalised word, start there instead.
            if partial && n >= 3 {
                let k = rest.len();
                let starts_upper = |w: &str| w.chars().next().map(char::is_uppercase).unwrap_or(false);
                let rest_whole = rest.iter().zip(&key[i..i + n]).all(|(a, b)| a == b);
                if rest_whole && k < n && starts_upper(words[i + k]) && !starts_upper(words[i]) {
                    out.extend(words[i..i + k].iter().map(|w| w.to_string()));
                    i += k;
                    continue 'outer;
                }
            }
            if partial {
                end = words.len();
            }
            let last_full_word = words[i + n * reps - 1];
            let punct: String = last_full_word.chars().rev().take_while(|c| !c.is_alphanumeric()).collect::<Vec<_>>().into_iter().rev().collect();
            out.extend(words[i..i + n].iter().map(|w| w.to_string()));
            if let Some(lw) = out.last_mut() {
                *lw = format!("{}{punct}", lw.trim_end_matches(|c: char| !c.is_alphanumeric()));
            }
            i = end;
            continue 'outer;
        }
        out.push(words[i].to_string());
        i += 1;
    }
    out.join(" ")
}

/// Mean token probability at or above which a decode in the remembered language is kept.
/// Measured with `--bench-stt` on large-v3-turbo: right-language decodes 0.90–0.98, wrong-language
/// ones 0.24–0.81 — the high wrong ones were empty or one word repeated, which `plausible` rejects.
/// Too high only costs a detection pass (~0.6 s), never a wrong transcript.
pub const CONFIDENT: f32 = 0.7;

/// Minimum mean token probability for a fast decode in a language the user picked (or that was
/// just detected). Below it the full window decodes again. From the benchmark: garbage fast decodes
/// scored 0.03–0.53, correct ones 0.68–1.0.
pub const ACCEPT: f32 = 0.6;

/// Is a fast decode of a `secs`-long clip good enough to keep? Besides confidence, script and
/// loops: a long clip must not come back with a few words only — the clip-sized window sometimes
/// stops after the first sentence (12.7 s of Hindi → one sentence, in the benchmark).
pub fn accepted(r: &(String, f32), lang: &str, min_conf: f32, secs: f32) -> bool {
    let letters = r.0.chars().filter(|c| c.is_alphanumeric()).count() as f32;
    let too_little = secs >= 4.0 && letters < secs * 3.0;
    r.1 >= min_conf && plausible(&r.0, lang) && !is_degenerate(&r.0) && !too_little
}

/// The prompt Whisper should see for a decode in `lang`. The prompt is the personal dictionary plus
/// the previous sentence; a previous sentence in another script drags the decode into it (Hindi
/// after an English sentence came out as "KAL SUBAH 10 BAJE MEETING HAY"), so such sentences are
/// dropped. Short items (dictionary words, names) always stay.
pub fn prompt_for(lang: &str, prompt: &str) -> String {
    let script_ok = |t: &str| {
        let deva = t.chars().any(|c| ('\u{0900}'..='\u{097F}').contains(&c));
        let guj = t.chars().any(|c| ('\u{0A80}'..='\u{0AFF}').contains(&c));
        match lang {
            "en" => !deva && !guj,
            "hi" | "mr" | "ne" => deva,
            "gu" => guj,
            _ => true,
        }
    };
    let mut pieces: Vec<String> = vec![];
    let mut cur = String::new();
    for ch in prompt.chars() {
        cur.push(ch);
        if matches!(ch, '.' | '?' | '!' | '।') {
            pieces.push(std::mem::take(&mut cur));
        }
    }
    pieces.push(cur);
    pieces
        .into_iter()
        .map(|p| p.trim().to_string())
        .filter(|p| {
            // a dictionary list ("Flo, Rahul, Dhanteras, …") or a short phrase always stays
            let list = p.contains(',') && p.split(',').all(|item| item.split_whitespace().count() <= 3);
            !p.is_empty() && (list || p.split_whitespace().count() < 5 || script_ok(p))
        })
        .collect::<Vec<_>>()
        .join(" ")
}

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

/// Highest-scoring language from (code, logit) pairs.
pub fn pick_language(scored: &[(String, f32)]) -> Option<String> {
    scored.iter().filter(|(_, l)| l.is_finite()).max_by(|a, b| a.1.total_cmp(&b.1)).map(|(c, _)| c.clone())
}

/// Languages "auto" may pick from: the configured ones (Settings `auto_languages`), or English +
/// Hindi when none are configured. Never all 99: a short or unclear English clip otherwise comes
/// out as Finnish or Welsh ("Suurin suurin kautta.").
pub fn allowed_languages(configured: &[String]) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for l in configured.iter().map(|l| l.trim().to_lowercase()) {
        if !l.is_empty() && l != "auto" && !out.contains(&l) {
            out.push(l);
        }
    }
    if out.is_empty() {
        out = vec!["en".into(), "hi".into()];
    }
    out
}

/// Pure (unit-tested): the detected language restricted to `allowed`. `scored` are (code, logit or
/// probability) for any languages, e.g. all 99; when Whisper's top pick isn't allowed, the best
/// allowed one wins, and when no allowed language was scored, the first allowed one.
pub fn pick_allowed_language(scored: &[(String, f32)], allowed: &[String]) -> Option<String> {
    if allowed.is_empty() {
        return pick_language(scored);
    }
    let within: Vec<(String, f32)> = scored.iter().filter(|(c, _)| allowed.contains(c)).cloned().collect();
    pick_language(&within).or_else(|| allowed.first().cloned())
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

/// whisper.cpp decoder settings (see `LocalWhisper::decode_with`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DecodeOpts {
    /// encoder window sized to the clip instead of a fixed 30 s (clips under 20 s)
    pub clip_ctx: bool,
    /// fixed encoder window in frames (50/s; 0 = Whisper's 30 s). Ignored when `clip_ctx`.
    pub audio_ctx: i32,
    /// Whisper's temperature fallback: re-decode (encoder output reused) when the greedy pass
    /// fails its entropy / log-probability checks — what breaks repetition loops
    pub fallback: bool,
    /// stop a runaway decode at a length no real clip of this duration reaches
    pub cap_tokens: bool,
    pub single_segment: bool,
    pub no_timestamps: bool,
}

impl DecodeOpts {
    /// the pre-fix fast path: one greedy pass, no fallback, clip-sized window
    pub const LEGACY_FAST: Self = Self { clip_ctx: true, audio_ctx: 0, fallback: false, cap_tokens: false, single_segment: true, no_timestamps: true };
    /// Flo's first pass: clip-sized window (fast), loops broken by the temperature fallback and a
    /// token cap. In the benchmark this alone took WER from 4.7 (loops) to 0.52 at the same speed.
    pub const FAST: Self = Self { clip_ctx: true, audio_ctx: 0, fallback: true, cap_tokens: true, single_segment: true, no_timestamps: true };
    /// the full 30 s window, used when the fast pass isn't trusted (WER 0.40 in the benchmark)
    pub const ACCURATE: Self = Self { clip_ctx: false, audio_ctx: 0, fallback: true, cap_tokens: true, single_segment: true, no_timestamps: true };
    /// Whisper's defaults: 30 s window, timestamps, temperature fallback
    pub const SAFE: Self = Self { clip_ctx: false, audio_ctx: 0, fallback: true, cap_tokens: false, single_segment: false, no_timestamps: false };
}

/// Upper bound on tokens for a clip: generous for real speech (Devanagari/Gujarati script costs
/// several tokens per word) yet far below the 224-token loops a stuck greedy decoder runs into.
pub fn max_tokens_for(secs: f32, lang: &str) -> i32 {
    let per_sec = if lang == "en" { 8.0 } else { 20.0 };
    ((secs * per_sec) as i32 + 24).min(224)
}

#[derive(Default)]
pub struct LocalWhisper {
    last_used: Mutex<Option<std::time::Instant>>,
    /// language Whisper detected on the last "auto" decode (e.g. "hi", "gu", "en")
    detected: Mutex<Option<String>>,
    /// use the pre-tuning decode settings (benchmark baseline only)
    pub baseline: std::sync::atomic::AtomicBool,
    /// language "auto" only chooses among these (set from `allowed_languages`, never empty in the
    /// app; empty = Whisper's own pick out of 99, benchmark only)
    pub auto_langs: Mutex<Vec<String>>,
    /// last transcribe: timing + confidence (diagnostics / benchmark)
    pub last_timing: Mutex<DecodeTiming>,
    /// clips the fast decoder lost (re-decoded with the safe one) — diagnostics / benchmark
    pub fast_retries: std::sync::atomic::AtomicU32,
    #[cfg(feature = "local-stt")]
    ctx: Mutex<Option<(String, Arc<whisper_rs::WhisperContext>)>>,
    #[cfg(not(feature = "local-stt"))]
    _p: Mutex<Option<Arc<()>>>,
}

impl LocalWhisper {
    /// Free the model now (e.g. a different model or a cloud engine was chosen).
    pub fn unload(&self) {
        #[cfg(feature = "local-stt")]
        {
            if self.ctx.lock().take().is_some() {
                log::info!("unloaded speech model");
            }
        }
        *self.last_used.lock() = None;
    }

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
    /// Every decode starts on the fast path: an encoder window sized to the clip (~0.3 s). That
    /// window is not what Whisper was trained on, and on short or non-English clips it sometimes
    /// loops ("Yes. Yes. Yes…"), switches script or invents text. Loops are cut out
    /// (`collapse_loops`); anything still implausible or unconfident is decoded once more with the
    /// full 30 s window (accurate, ~1 s) — instead of the old retry that only caught loops and
    /// re-ran Whisper's slowest settings.
    ///
    /// `language` "auto" is adaptive: decode in the language used last and keep it when Whisper is
    /// confident; otherwise identify the language among `auto_langs` from the same clip-sized
    /// encoder state (~0.2 s instead of a 30 s window, same accuracy in the benchmark) and decode
    /// again. "hi-en" (Hinglish) is decoded as English steered to Roman-letter Hindi.
    #[cfg(feature = "local-stt")]
    pub fn transcribe(&self, model_file: &Path, samples: &[f32], language: &str, prompt: &str) -> Result<String> {
        let t0 = std::time::Instant::now();
        let mut timing = DecodeTiming::default();
        let lang_in = if language.is_empty() { "auto" } else { language };
        let secs = samples.len() as f32 / audio::TARGET_RATE as f32;
        let (text, confidence) = if lang_in == HINGLISH {
            let p = if prompt.is_empty() { HINGLISH_PROMPT.to_string() } else { format!("{HINGLISH_PROMPT} {}", prompt_for("en", prompt)) };
            self.decode_checked(model_file, samples, "en", &p, ACCEPT)?.0
        } else if lang_in != "auto" {
            self.decode_checked(model_file, samples, lang_in, &prompt_for(lang_in, prompt), ACCEPT)?.0
        } else {
            let cands = self.auto_langs.lock().clone();
            let sticky = self.detected.lock().clone().filter(|l| cands.is_empty() || cands.contains(l));
            let first_lang = sticky.clone().or_else(|| cands.first().cloned()).unwrap_or_else(|| "en".into());
            let (first, mut state) = self.decode_with(model_file, samples, &first_lang, &prompt_for(&first_lang, prompt), DecodeOpts::FAST)?;
            // which language was that? one decoder step on the encoder output we already have
            let td = std::time::Instant::now();
            let lang = self.lang_from_state(model_file, &mut state, &cands).unwrap_or_else(|| first_lang.clone());
            timing.detect_ms = td.elapsed().as_millis();
            timing.detected = true;
            *self.detected.lock() = Some(lang.clone());
            if lang == first_lang {
                if accepted(&first, &lang, ACCEPT, secs) {
                    first
                } else {
                    self.decode_accurate(model_file, samples, &lang, &prompt_for(&lang, prompt))?
                }
            } else {
                // e.g. Hindi after English: the first decode was a translation, not a transcript
                self.decode_checked(model_file, samples, &lang, &prompt_for(&lang, prompt), ACCEPT)?.0
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

    /// Fast decode in a known language; when the result isn't `accepted`, decode again with the
    /// full window. Returns ((text, confidence), escalated).
    #[cfg(feature = "local-stt")]
    fn decode_checked(&self, model_file: &Path, samples: &[f32], lang: &str, prompt: &str, min_conf: f32) -> Result<((String, f32), bool)> {
        if self.baseline.load(std::sync::atomic::Ordering::Relaxed) {
            return Ok((self.decode_with(model_file, samples, lang, prompt, DecodeOpts::SAFE)?.0, false));
        }
        let (fast, _) = self.decode_with(model_file, samples, lang, prompt, DecodeOpts::FAST)?;
        if accepted(&fast, lang, min_conf, samples.len() as f32 / audio::TARGET_RATE as f32) {
            return Ok((fast, false));
        }
        let accurate = self.decode_accurate(model_file, samples, lang, prompt)?;
        // the full window found nothing although the fast pass had plausible text: keep that
        if accurate.0.trim().is_empty() && plausible(&fast.0, lang) && !is_degenerate(&fast.0) {
            return Ok((fast, true));
        }
        Ok((accurate, true))
    }

    /// The full 30 s encoder window Whisper was trained on.
    #[cfg(feature = "local-stt")]
    fn decode_accurate(&self, model_file: &Path, samples: &[f32], lang: &str, prompt: &str) -> Result<(String, f32)> {
        log::info!("stt: fast decode not trusted; decoding with the full window");
        self.fast_retries.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Ok(self.decode_with(model_file, samples, lang, prompt, DecodeOpts::ACCURATE)?.0)
    }

    /// Language among `cands` (all if empty) for the clip a state just decoded: one decoder step
    /// after <|startoftranscript|> on the encoder output that decode left in the state. This is
    /// Whisper's own language detector minus its encoder pass (~1 s on a 30 s window).
    #[cfg(feature = "local-stt")]
    fn lang_from_state(&self, model_file: &Path, state: &mut whisper_rs::WhisperState, cands: &[String]) -> Option<String> {
        let ctx = self.context(model_file).ok()?;
        state.decode(&[ctx.token_sot()], 0, threads()).ok()?;
        let logits = state.get_logits().ok()?;
        let all: Vec<String>;
        let cands = if cands.is_empty() {
            all = (0..=whisper_rs::get_lang_max_id()).filter_map(|i| whisper_rs::get_lang_str(i).map(String::from)).collect();
            &all
        } else {
            cands
        };
        let scored: Vec<(String, f32)> = cands
            .iter()
            .filter_map(|c| {
                let id = whisper_rs::get_lang_id(c)?;
                logits.get(ctx.token_lang(id) as usize).map(|l| (c.clone(), *l))
            })
            .collect();
        pick_allowed_language(&scored, cands)
    }

    /// Most likely language among `cands` from a full 30 s window (the old detector; ~1 s).
    /// Kept for the benchmark comparison with `lang_from_state`.
    #[cfg(all(test, feature = "local-stt"))]
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

    /// One whisper.cpp pass with explicit decoder settings. Also hands back the state, whose
    /// encoder window matches the clip (language detection on it costs one short encode).
    #[cfg(feature = "local-stt")]
    fn decode_with(&self, model_file: &Path, samples: &[f32], lang: &str, prompt: &str, o: DecodeOpts) -> Result<((String, f32), whisper_rs::WhisperState)> {
        use whisper_rs::{FullParams, SamplingStrategy};
        let ctx = self.context(model_file)?;
        let mut state = ctx.create_state().map_err(|e| anyhow!("{e:?}"))?;
        let buf = padded(samples);
        let secs = samples.len() as f32 / audio::TARGET_RATE as f32;
        let mut p = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        p.set_language(Some(lang));
        p.set_translate(false);
        p.set_print_progress(false);
        p.set_print_realtime(false);
        p.set_print_special(false);
        p.set_print_timestamps(false);
        p.set_suppress_blank(true);
        p.set_no_context(true);
        let short = secs < 20.0;
        if o.no_timestamps {
            p.set_no_timestamps(true);
        }
        if short && o.single_segment {
            p.set_single_segment(true);
        }
        if short && o.clip_ctx {
            p.set_audio_ctx(audio_ctx_for(secs));
        } else if o.audio_ctx > 0 && secs + 1.0 < o.audio_ctx as f32 / 50.0 {
            p.set_audio_ctx(o.audio_ctx);
        }
        if !o.fallback {
            p.set_temperature_inc(0.0);
        }
        if o.cap_tokens {
            p.set_max_tokens(max_tokens_for(secs, lang));
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
                // segments don't always start with a space ("colors." + "Like" → "colors.Like")
                if !out.is_empty() && !out.ends_with(char::is_whitespace) && !t.starts_with(char::is_whitespace) {
                    out.push(' ');
                }
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
        Ok(((collapse_loops(&out), mean_confidence(&probs)), state))
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
    if provider == "sarvam" {
        return transcribe_sarvam(egress, model, key, samples, language).await;
    }
    // Whisper-style APIs take ISO-639-1 codes; Hinglish is Hindi speech written in Roman letters,
    // which they produce from an English-language decode steered by a romanized prompt
    let (language, prompt) = match language {
        HINGLISH => ("en", if prompt.is_empty() { HINGLISH_PROMPT.to_string() } else { format!("{HINGLISH_PROMPT} {prompt}") }),
        l => (l, prompt.to_string()),
    };
    let prompt = prompt.as_str();
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


#[cfg(all(test, feature = "local-stt"))]
#[path = "stt_bench.rs"]
mod bench;

/// The "Hinglish" language choice: Hindi/English mixed speech, written in Roman letters.
pub const HINGLISH: &str = "hi-en";
/// Romanized example text that steers Whisper to write Hinglish in Latin script.
pub const HINGLISH_PROMPT: &str = "Haan, main kal office aaunga. Meeting 10 baje hai, please sabko yaad dila dena.";

/// Sarvam AI's longest clip for one synchronous request is 30 s; send slightly less.
const SARVAM_CHUNK_SECS: usize = 28;

/// Flo language setting → Sarvam (`language_code`, `mode`). Hinglish asks for Roman-letter output.
pub fn sarvam_params(language: &str) -> (&'static str, &'static str) {
    match language {
        "hi" => ("hi-IN", "transcribe"),
        "gu" => ("gu-IN", "transcribe"),
        "en" => ("en-IN", "transcribe"),
        "mr" => ("mr-IN", "transcribe"),
        "bn" => ("bn-IN", "transcribe"),
        "ta" => ("ta-IN", "transcribe"),
        "te" => ("te-IN", "transcribe"),
        "kn" => ("kn-IN", "transcribe"),
        "ml" => ("ml-IN", "transcribe"),
        "pa" => ("pa-IN", "transcribe"),
        HINGLISH => ("unknown", "translit"),
        _ => ("unknown", "transcribe"),
    }
}

/// Sarvam AI speech-to-text (Saaras): built for Indian languages and code-mixed speech.
/// https://docs.sarvam.ai/api-reference-docs/speech-to-text/transcribe
async fn transcribe_sarvam(egress: &Egress, model: &str, key: &str, samples: &[f32], language: &str) -> Result<String> {
    let url = "https://api.sarvam.ai/speech-to-text";
    egress.check(url, Purpose::Stt, true)?;
    let model = if model.is_empty() || spec(model).is_some() { "saaras:v3" } else { model };
    let (code, mode) = sarvam_params(language);
    let mut parts = vec![];
    for chunk in samples.chunks(SARVAM_CHUNK_SECS * audio::TARGET_RATE as usize) {
        let wav = audio::encode_wav(chunk, audio::TARGET_RATE)?;
        let bytes = wav.len() as u64;
        let form = reqwest::multipart::Form::new()
            .part("file", reqwest::multipart::Part::bytes(wav).file_name("audio.wav").mime_str("audio/wav")?)
            .text("model", model.to_string())
            .text("mode", mode)
            .text("language_code", code);
        let resp = egress
            .client(Purpose::Stt, true)
            .post(url)
            .header("api-subscription-key", key)
            .multipart(form)
            .timeout(std::time::Duration::from_secs(60))
            .send()
            .await?;
        let status = resp.status();
        let v: serde_json::Value = resp.json().await.unwrap_or_default();
        egress.record(url, Purpose::Stt, bytes);
        if !status.is_success() {
            let msg = v["error"]["message"].as_str().or(v["message"].as_str()).unwrap_or("unknown");
            bail!("Sarvam STT error {status}: {msg}");
        }
        parts.push(v["transcript"].as_str().unwrap_or_default().trim().to_string());
    }
    Ok(parts.into_iter().filter(|p| !p.is_empty()).collect::<Vec<_>>().join(" "))
}

/// Installed speech models other than `in_use` — what "Free up space" removes.
pub fn unused_installed(models_dir: &Path, in_use: &str) -> Vec<&'static ModelSpec> {
    MODELS.iter().filter(|m| m.id != in_use && models_dir.join(m.file).exists()).collect()
}

/// Delete every installed model except `in_use`; returns MB freed. Never touches the model in use.
pub fn remove_unused(models_dir: &Path, in_use: &str) -> u64 {
    unused_installed(models_dir, in_use)
        .into_iter()
        .filter(|m| std::fs::remove_file(models_dir.join(m.file)).is_ok())
        .map(|m| {
            log::info!("removed unused speech model {}", m.id);
            m.size_mb
        })
        .sum()
}

/// The quantized large-v3-turbo transcribes like the full-precision one at about a third of the
/// memory and disk. When it's the model in use, a leftover full-precision copy is dead weight.
pub fn remove_redundant(models_dir: &Path, in_use: &str) -> u64 {
    if in_use != "large-v3-turbo-q5_0" || !models_dir.join("ggml-large-v3-turbo-q5_0.bin").exists() {
        return 0;
    }
    let full = models_dir.join("ggml-large-v3-turbo.bin");
    if full.exists() && std::fs::remove_file(&full).is_ok() {
        log::info!("removed the full-precision large-v3-turbo (the quantized copy is in use)");
        return spec("large-v3-turbo").map(|s| s.size_mb).unwrap_or(0);
    }
    0
}

/// One-time switch from the full-precision large-v3-turbo to the quantized one when it's already
/// downloaded (same accuracy in Flo's benchmark, 560 MB instead of 1.56 GB of RAM). Runs once per
/// install (a marker file in the models folder), so choosing full precision again later sticks.
/// Returns true when it changed the setting.
pub fn prefer_quantized(s: &mut crate::model::Settings, models_dir: &Path) -> bool {
    let marker = models_dir.join(".prefer-quantized");
    if marker.exists() || !models_dir.exists() {
        return false;
    }
    let _ = std::fs::write(&marker, b"1");
    if s.stt_model == "large-v3-turbo" && models_dir.join("ggml-large-v3-turbo-q5_0.bin").exists() {
        s.stt_model = "large-v3-turbo-q5_0".into();
        return true;
    }
    false
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
    fn collapses_decoder_loops_seen_in_the_benchmark() {
        // real outputs of the clip-sized decoder (stt_bench sweep)
        assert_eq!(collapse_loops("Yes. Yes. Yes. Yes. Yes. Yes. Yes."), "Yes.");
        assert_eq!(collapse_loops("Okay, send it. Send it. Send it. Send it."), "Okay, send it.");
        assert_eq!(collapse_loops("Send the deck to Rahul by Friday. Send the deck to Rahul by Friday. Send"), "Send the deck to Rahul by Friday.");
        assert_eq!(
            collapse_loops("आज का काम पूरा हो गया, अब घर जा रहा हूं. आज का काम पूरा हो गया, अब घर जा रहा हू"),
            "आज का काम पूरा हो गया, अब घर जा रहा हूं."
        );
        assert_eq!(collapse_loops("आपाईनी है। आपाईनी है। आपाईनी है। आपाईनी है।"), "आपाईनी है।");
        assert_eq!(collapse_loops("तमे साजी बजारमान थी दूद अने शात भाजी लाब शो. अने शात भाजी लाब शो."), "तमे साजी बजारमान थी दूद अने शात भाजी लाब शो.");
        assert_eq!(collapse_loops("आपको प्राव प्राव प्राव प्राव प्र"), "आपको प्राव");
        assert_eq!(collapse_loops("Chayat call the bank tomorrow at 11 at 11 at 11 at 11."), "Chayat call the bank tomorrow at 11.");
    }

    #[test]
    fn prompt_keeps_dictionary_but_drops_context_in_another_script() {
        let p = "Flo, Rahul, Dhanteras, Slack. Hey team, quick update on the release before Thursday.";
        assert_eq!(prompt_for("hi", p), "Flo, Rahul, Dhanteras, Slack.");
        assert_eq!(prompt_for("en", p), p);
        let hi = "Flo, Rahul. कल सुबह दस बजे मीटिंग है, सबको याद दिला देना।";
        assert_eq!(prompt_for("hi", hi), hi);
        assert_eq!(prompt_for("en", hi), "Flo, Rahul.");
        assert_eq!(prompt_for("gu", hi), "Flo, Rahul.");
        assert_eq!(prompt_for("hi", ""), "");
        let long_dict = "Flo, Rahul Mehta, Dhanteras, Slack, Anthropic, Notion. Send the deck to the whole team today.";
        assert_eq!(prompt_for("hi", long_dict), "Flo, Rahul Mehta, Dhanteras, Slack, Anthropic, Notion.");
    }

    #[test]
    fn acceptance_needs_confidence_script_and_no_loop() {
        assert!(accepted(&("Send the deck to Rahul by Friday.".into(), 0.95), "en", ACCEPT, 3.0));
        assert!(!accepted(&("Send the deck to Rahul by Friday.".into(), 0.4), "en", ACCEPT, 3.0));
        // real fast-path garbage from the benchmark: Gujarati audio decoded as Polish
        assert!(!accepted(&("Z- była jsem mi-tinyng o moze index of milie czytaki.".into(), 0.84), "gu", ACCEPT, 3.0));
        assert!(!accepted(&("KAL SUBAH 10 BAJE MEETING HAY".into(), 0.84), "hi", ACCEPT, 3.0));
        assert!(!accepted(&("it's ".repeat(30), 0.9), "en", ACCEPT, 3.0));
        // 12.7 s of Hindi that came back as its first sentence only
        assert!(!accepted(&("इस हफटे हमें तीन काम पूरे करने हैं।".into(), 0.95), "hi", ACCEPT, 12.7));
        assert!(accepted(&("इस हफटे हमें तीन काम पूरे करने हैं।".into(), 0.95), "hi", ACCEPT, 3.0));
    }

    #[test]
    fn token_cap_leaves_room_for_real_speech() {
        assert_eq!(max_tokens_for(1.0, "en"), 32);
        assert!(max_tokens_for(3.0, "hi") >= 80); // ~10 words of Devanagari
        assert_eq!(max_tokens_for(60.0, "hi"), 224);
    }

    #[test]
    fn real_repetition_in_speech_survives() {
        for t in [
            "Send the deck to Rahul by Friday.",
            "very very good idea",
            "No, no, I meant the other file.",
            "I said yes. Then she said yes.",
            "Thank you. Thank you so much.",
            "कल सुबह 10 बजे मीटिंग है, सब को याद दिला देना.",
        ] {
            assert_eq!(collapse_loops(t), t);
        }
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
    fn finnish_detected_falls_back_to_an_allowed_language() {
        // regression: "Suurin suurin kautta." — Whisper's top pick was Finnish for English speech
        let scored = vec![("fi".to_string(), 4.1), ("en".to_string(), 3.0), ("hi".to_string(), 1.2), ("cy".to_string(), 3.5)];
        let allowed = allowed_languages(&["en".into(), "hi".into(), "gu".into()]);
        assert_eq!(pick_allowed_language(&scored, &allowed).as_deref(), Some("en"));
        // Hindi still wins when it scores best among the allowed
        let scored = vec![("fi".to_string(), 4.1), ("en".to_string(), 1.0), ("hi".to_string(), 3.2)];
        assert_eq!(pick_allowed_language(&scored, &allowed).as_deref(), Some("hi"));
        // nothing allowed was scored → the first allowed language, never Finnish
        assert_eq!(pick_allowed_language(&[("fi".to_string(), 4.1)], &allowed).as_deref(), Some("en"));
    }

    #[test]
    fn allowed_languages_default_to_english_and_hindi() {
        assert_eq!(allowed_languages(&[]), vec!["en", "hi"]);
        assert_eq!(allowed_languages(&["auto".into(), " ".into()]), vec!["en", "hi"]);
        assert_eq!(allowed_languages(&["EN".into(), "gu".into(), "en".into()]), vec!["en", "gu"]);
    }

    #[test]
    fn language_pick_skips_non_finite_logits() {
        let s = vec![("en".to_string(), 1.5), ("hi".to_string(), 3.2), ("gu".to_string(), f32::NAN)];
        assert_eq!(pick_language(&s).as_deref(), Some("hi"));
        assert_eq!(pick_language(&[]), None);
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
    fn sarvam_language_mapping() {
        assert_eq!(sarvam_params("gu"), ("gu-IN", "transcribe"));
        assert_eq!(sarvam_params("hi"), ("hi-IN", "transcribe"));
        assert_eq!(sarvam_params("auto"), ("unknown", "transcribe"));
        assert_eq!(sarvam_params(HINGLISH), ("unknown", "translit"));
    }

    fn model_dir(files: &[&str]) -> PathBuf {
        let d = std::env::temp_dir().join(format!("flo-models-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        for f in files {
            std::fs::write(d.join(f), b"x").unwrap();
        }
        d
    }

    #[test]
    fn redundant_full_precision_copy_goes_only_when_quantized_is_in_use() {
        let d = model_dir(&["ggml-large-v3-turbo-q5_0.bin", "ggml-large-v3-turbo.bin"]);
        // full precision in use → never deleted
        assert_eq!(remove_redundant(&d, "large-v3-turbo"), 0);
        assert!(d.join("ggml-large-v3-turbo.bin").exists());
        assert_eq!(remove_redundant(&d, "large-v3-turbo-q5_0"), 1624);
        assert!(!d.join("ggml-large-v3-turbo.bin").exists());
        assert!(d.join("ggml-large-v3-turbo-q5_0.bin").exists());
        std::fs::remove_dir_all(d).ok();
        // quantized selected but not downloaded → keep the full one (it's all there is)
        let d = model_dir(&["ggml-large-v3-turbo.bin"]);
        assert_eq!(remove_redundant(&d, "large-v3-turbo-q5_0"), 0);
        assert!(d.join("ggml-large-v3-turbo.bin").exists());
        std::fs::remove_dir_all(d).ok();
    }

    #[test]
    fn free_up_space_keeps_the_model_in_use() {
        let d = model_dir(&["ggml-large-v3-turbo-q5_0.bin", "ggml-large-v3-turbo.bin", "ggml-base.en.bin"]);
        assert_eq!(unused_installed(&d, "base.en").len(), 2);
        assert_eq!(remove_unused(&d, "base.en"), 574 + 1624);
        assert!(d.join("ggml-base.en.bin").exists());
        assert!(unused_installed(&d, "base.en").is_empty());
        std::fs::remove_dir_all(d).ok();
    }

    #[test]
    fn prefers_the_quantized_model_only_when_downloaded() {
        let mut s = crate::model::Settings { stt_model: "large-v3-turbo".into(), ..Default::default() };
        let none = model_dir(&["ggml-large-v3-turbo.bin"]);
        assert!(!prefer_quantized(&mut s, &none));
        assert_eq!(s.stt_model, "large-v3-turbo");
        let both = model_dir(&["ggml-large-v3-turbo.bin", "ggml-large-v3-turbo-q5_0.bin"]);
        assert!(prefer_quantized(&mut s, &both));
        assert_eq!(s.stt_model, "large-v3-turbo-q5_0");
        // only once: picking full precision again afterwards is respected
        s.stt_model = "large-v3-turbo".into();
        assert!(!prefer_quantized(&mut s, &both));
        assert_eq!(s.stt_model, "large-v3-turbo");
        std::fs::remove_dir_all(none).ok();
        std::fs::remove_dir_all(both).ok();
    }

    #[test]
    fn catalogue_paths() {
        let d = Path::new("/tmp/m");
        assert_eq!(model_path(d, "base.en").unwrap(), Path::new("/tmp/m/ggml-base.en.bin"));
        assert!(list_models(d).iter().all(|m| !m.installed));
    }
}

#[cfg(test)]
mod join_tests {
    use super::*;

    const REAL: &str = "Create attractive PDF with round corners with green radians of proper combination of colors.Like light theme I want,Light, Thim and Yellow color Light, Thim and Light Blue color Light, Thim and Light Blue color Light, Thim and Light Blue color";

    #[test]
    fn head_already_collapses_a_loop_inside_one_decode() {
        let out = collapse_loops(REAL);
        assert_eq!(out.matches("Light Blue color").count(), 1, "{out}");
    }

    #[test]
    fn pause_chunks_that_echo_the_previous_one_are_dropped() {
        // each sentence is decoded on its own with the previous one as Whisper's prompt; a short or
        // unclear chunk comes back as a copy of that prompt, and the copies were simply joined
        let chunks: Vec<String> = [
            "Create attractive PDF with round corners with green radians of proper combination of colors.",
            "Like light theme I want,",
            "Light, Thim and Yellow color",
            "Light, Thim and Light Blue color",
            "Light, Thim and Light Blue color",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let out = join_chunks(&chunks);
        assert_eq!(out.matches("Light Blue color").count(), 1, "{out}");
        assert!(out.contains("Yellow color"));
        // ordinary speech stays
        assert_eq!(join_chunks(&["It is very very good.".into(), "Thanks.".into()]), "It is very very good. Thanks.");
    }
}
