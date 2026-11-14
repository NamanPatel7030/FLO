//! On-device speech-to-text through sherpa-onnx (ONNX Runtime, CPU): the non-Whisper engines.
//! In the model list: NVIDIA Parakeet TDT 0.6B v2 (a transducer: punctuated, cased English with
//! numbers written as digits). Also runnable for benchmarks: Parakeet v3 (+24 European languages)
//! and Qwen3-ASR 0.6B (an audio LLM, 30 languages incl. Hindi; behind Whisper Large v3 on Hindi
//! and English in Flo's dictation bench, so not offered). `stt::LocalWhisper` hands a clip here
//! when the chosen model's engine isn't whisper.cpp, so every caller (dictation, assistant,
//! hands-free, meetings) works unchanged.
//!
//! Only built where sherpa-onnx is (macOS with the `diarize` feature); elsewhere these models are
//! not offered (`supported()`).
use anyhow::Result;
use std::path::Path;

/// The ONNX model families Flo runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Family {
    /// NeMo transducer (Parakeet TDT): encoder / decoder / joiner .onnx + tokens.txt
    NemoTransducer,
    /// Qwen3-ASR: conv_frontend / encoder / decoder .onnx + tokenizer/ (vocab.json, merges.txt)
    Qwen3,
}

/// Can this build run ONNX speech models?
pub const fn supported() -> bool {
    cfg!(all(target_os = "macos", feature = "diarize"))
}

/// Languages a family transcribes (ISO 639-1). Parakeet v3: the 25 European languages it was
/// trained on; Qwen3-ASR: its 30 (Chinese dialects left out).
pub fn languages(f: Family) -> &'static [&'static str] {
    match f {
        Family::NemoTransducer => &[
            "en", "bg", "hr", "cs", "da", "nl", "et", "fi", "fr", "de", "el", "hu", "it", "lv", "lt", "mt", "pl", "pt", "ro", "sk", "sl", "es", "sv", "ru", "uk",
        ],
        Family::Qwen3 => &[
            "zh", "en", "yue", "ar", "de", "fr", "es", "pt", "id", "it", "ko", "ru", "th", "vi", "ja", "tr", "hi", "ms", "nl", "sv", "da", "fi", "pl", "cs", "fil", "fa", "el", "hu", "mk", "ro",
        ],
    }
}

/// Can `f` transcribe `lang` ("auto" and Hinglish count as Hindi + English)?
pub fn hears(f: Family, lang: &str) -> bool {
    match lang {
        "auto" | "" => true,
        "hi-en" => languages(f).contains(&"hi"),
        l => languages(f).contains(&l),
    }
}

/// Qwen3-ASR prefixes its transcript with the language it heard ("language English<asr_text>…")
/// in some exports; keep only the transcript.
pub fn clean_text(raw: &str) -> String {
    let t = raw.rsplit("<asr_text>").next().unwrap_or(raw);
    t.replace("<|im_end|>", "").trim().to_string()
}

#[cfg(all(target_os = "macos", feature = "diarize"))]
mod imp {
    use super::*;
    use anyhow::anyhow;
    use parking_lot::Mutex;
    use std::sync::Arc;

    #[derive(Default)]
    pub struct OnnxAsr {
        rec: Mutex<Option<(String, Arc<sherpa_onnx::OfflineRecognizer>)>>,
    }

    fn threads() -> i32 {
        std::thread::available_parallelism().map(|n| n.get().clamp(2, 8) as i32).unwrap_or(4)
    }

    fn file(dir: &Path, name: &str) -> Option<String> {
        Some(dir.join(name).to_string_lossy().into_owned())
    }

    /// The model file in `dir` that is there: the int8 build when present.
    fn pick(dir: &Path, stem: &str) -> Option<String> {
        let int8 = dir.join(format!("{stem}.int8.onnx"));
        if int8.exists() {
            return Some(int8.to_string_lossy().into_owned());
        }
        file(dir, &format!("{stem}.onnx"))
    }

    pub fn config(dir: &Path, f: Family) -> sherpa_onnx::OfflineRecognizerConfig {
        let mut c = sherpa_onnx::OfflineRecognizerConfig::default();
        c.model_config.num_threads = threads();
        c.model_config.provider = Some("cpu".into());
        c.model_config.debug = false;
        match f {
            Family::NemoTransducer => {
                c.model_config.transducer.encoder = pick(dir, "encoder");
                c.model_config.transducer.decoder = pick(dir, "decoder");
                c.model_config.transducer.joiner = pick(dir, "joiner");
                c.model_config.tokens = file(dir, "tokens.txt");
                c.model_config.model_type = Some("nemo_transducer".into());
                c.decoding_method = Some("greedy_search".into());
            }
            Family::Qwen3 => {
                c.model_config.qwen3_asr.conv_frontend = pick(dir, "conv_frontend");
                c.model_config.qwen3_asr.encoder = pick(dir, "encoder");
                c.model_config.qwen3_asr.decoder = pick(dir, "decoder");
                c.model_config.qwen3_asr.tokenizer = file(dir, "tokenizer");
                c.model_config.qwen3_asr.max_new_tokens = 256;
            }
        }
        c
    }

    impl OnnxAsr {
        fn recognizer(&self, dir: &Path, f: Family) -> Result<Arc<sherpa_onnx::OfflineRecognizer>> {
            if !dir.is_dir() {
                anyhow::bail!("Speech model not downloaded yet. Open Settings → Voice and download it.");
            }
            let key = dir.to_string_lossy().to_string();
            let mut g = self.rec.lock();
            if let Some((k, r)) = g.as_ref() {
                if *k == key {
                    return Ok(r.clone());
                }
            }
            *g = None; // free the old model before loading the next
            let t = std::time::Instant::now();
            let r = Arc::new(sherpa_onnx::OfflineRecognizer::create(&config(dir, f)).ok_or_else(|| anyhow!("couldn't load the speech model in {key}"))?);
            log::info!("onnx speech model loaded in {} ms", t.elapsed().as_millis());
            *g = Some((key, r.clone()));
            Ok(r)
        }

        pub fn load(&self, dir: &Path, f: Family) -> Result<()> {
            self.recognizer(dir, f).map(|_| ())
        }

        pub fn is_loaded(&self) -> bool {
            self.rec.lock().is_some()
        }

        pub fn unload(&self) -> bool {
            self.rec.lock().take().is_some()
        }

        /// One clip (16 kHz mono) → text. `hotwords` (the user's dictionary words) bias the
        /// transducer's search where the model supports it.
        pub fn transcribe(&self, dir: &Path, f: Family, samples: &[f32]) -> Result<String> {
            let r = self.recognizer(dir, f)?;
            let s = r.create_stream();
            // a little trailing silence lets the transducer flush its last word
            let mut buf = samples.to_vec();
            buf.extend(std::iter::repeat_n(0.0f32, crate::audio::TARGET_RATE as usize / 2));
            s.accept_waveform(crate::audio::TARGET_RATE as i32, &buf);
            r.decode(&s);
            let res = s.get_result().ok_or_else(|| anyhow!("no result from the speech model"))?;
            Ok(clean_text(&res.text))
        }
    }
}

#[cfg(not(all(target_os = "macos", feature = "diarize")))]
mod imp {
    use super::*;

    #[derive(Default)]
    pub struct OnnxAsr;

    impl OnnxAsr {
        pub fn load(&self, _dir: &Path, _f: Family) -> Result<()> {
            anyhow::bail!("This build can't run this speech model. Choose a Whisper model in Settings → Voice.")
        }
        pub fn is_loaded(&self) -> bool {
            false
        }
        pub fn unload(&self) -> bool {
            false
        }
        pub fn transcribe(&self, _dir: &Path, _f: Family, _samples: &[f32]) -> Result<String> {
            anyhow::bail!("This build can't run this speech model. Choose a Whisper model in Settings → Voice.")
        }
    }
}

pub use imp::OnnxAsr;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qwen_language_prefix_is_dropped() {
        assert_eq!(clean_text("language Hindi<asr_text>कल मीटिंग है।"), "कल मीटिंग है।");
        assert_eq!(clean_text(" Send it. "), "Send it.");
    }

    /// Raw output and decode time of an ONNX model on the bench clips, outside the dictation
    /// pipeline: FLO_ONNX_MODEL=<model folder> FLO_DICT_MANIFEST=…/manifest.json
    /// cargo test --release --lib onnx_probe -- --ignored --nocapture
    #[cfg(all(target_os = "macos", feature = "diarize", feature = "local-stt"))]
    #[test]
    #[ignore]
    fn onnx_probe() {
        let (Ok(dir), Ok(man)) = (std::env::var("FLO_ONNX_MODEL"), std::env::var("FLO_DICT_MANIFEST")) else {
            eprintln!("set FLO_ONNX_MODEL and FLO_DICT_MANIFEST");
            return;
        };
        let dir = std::path::PathBuf::from(dir);
        let f = crate::stt::onnx_family(&dir).expect("an ONNX model folder");
        let asr = OnnxAsr::default();
        let t = std::time::Instant::now();
        asr.load(&dir, f).unwrap();
        println!("load {} ms", t.elapsed().as_millis());
        let clips: Vec<serde_json::Value> = serde_json::from_str(&std::fs::read_to_string(man).unwrap()).unwrap();
        let mut rtf = vec![];
        for c in &clips {
            let s = crate::stt::bench::read_wav(c["wav"].as_str().unwrap());
            let t = std::time::Instant::now();
            let text = asr.transcribe(&dir, f, &s).unwrap();
            let ms = t.elapsed().as_millis();
            let secs = s.len() as f32 / 16_000.0;
            rtf.push(ms as f32 / 1000.0 / secs);
            println!("{:9} {:4.1}s {:5} ms | {text}", c["name"].as_str().unwrap(), secs, ms);
        }
        rtf.sort_by(|a, b| a.total_cmp(b));
        println!("RTF p50 {:.3} (decode time / audio time); RAM {:?} MB", rtf[rtf.len() / 2], crate::stt::bench::footprint_mb());
    }

    #[test]
    fn language_coverage() {
        assert!(hears(Family::NemoTransducer, "en"));
        assert!(!hears(Family::NemoTransducer, "hi"));
        assert!(!hears(Family::NemoTransducer, "hi-en"));
        assert!(hears(Family::Qwen3, "hi"));
        assert!(hears(Family::Qwen3, "hi-en"));
        assert!(!hears(Family::Qwen3, "gu"));
    }
}
