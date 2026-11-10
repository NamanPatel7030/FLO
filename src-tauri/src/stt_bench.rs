//! Reproducible on-device STT benchmark (accuracy, latency, fast-path degeneration, memory).
//!
//! Clips: a manifest of 16 kHz mono WAVs with their expected text and language (made with macOS
//! `say`; see `scripts/stt-bench-clips.py` at the repo root). Each clip runs under four conditions a real
//! microphone produces: clean, quiet (low input gain), noisy, and "streamed" (the previous
//! sentence + dictionary words passed as the prompt, like `session::stream_while_talking`).
//!
//! FLO_BENCH_MANIFEST=…/manifest.json FLO_BENCH_MODEL=…/ggml-large-v3-turbo-q5_0.bin \
//! FLO_BENCH_OUT=report.json cargo test --release --lib stt_bench -- --ignored --nocapture
//!
//! Optional: FLO_BENCH_LANG=auto (default: auto with en/hi/gu, like the user's settings) or
//! FLO_BENCH_LANG=fixed (each clip decoded in its own language).
use super::*;
use serde_json::{json, Value};

/// Lowercase, drop punctuation and the spelling variants Whisper flips between in Hindi
/// (chandrabindu ↔ anusvara, nukta), so WER measures words, not orthography.
pub fn normalize(s: &str) -> Vec<String> {
    let cleaned: String = s
        .chars()
        .filter(|c| *c != '\u{093C}' && *c != '\u{0ABC}') // nukta (Devanagari, Gujarati)
        .map(|c| match c {
            '\u{0901}' => '\u{0902}', // ँ → ं
            '\u{0A81}' => '\u{0A82}', // ઁ → ં
            '\u{0964}' | '\u{0965}' => ' ', // danda: sentence punctuation
            c if c.is_alphanumeric() || c.is_whitespace() || is_indic_mark(c) => c,
            _ => ' ',
        })
        .collect();
    cleaned.split_whitespace().map(|w| w.to_lowercase()).collect()
}

fn is_indic_mark(c: char) -> bool {
    ('\u{0900}'..='\u{097F}').contains(&c) || ('\u{0A80}'..='\u{0AFF}').contains(&c)
}

fn edit_distance<T: PartialEq>(a: &[T], b: &[T]) -> usize {
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for (i, x) in a.iter().enumerate() {
        let mut cur = vec![i + 1; b.len() + 1];
        for (j, y) in b.iter().enumerate() {
            cur[j + 1] = (prev[j] + usize::from(x != y)).min(prev[j + 1] + 1).min(cur[j] + 1);
        }
        prev = cur;
    }
    prev[b.len()]
}

/// Word error rate of `hyp` against `reference` (0 = perfect; can exceed 1 for runaway output).
pub fn wer(reference: &str, hyp: &str) -> f32 {
    let (r, h) = (normalize(reference), normalize(hyp));
    if r.is_empty() {
        return if h.is_empty() { 0.0 } else { 1.0 };
    }
    edit_distance(&r, &h) as f32 / r.len() as f32
}

/// Character error rate (spaces ignored) — fairer than WER for Indic scripts.
pub fn cer(reference: &str, hyp: &str) -> f32 {
    let r: Vec<char> = normalize(reference).concat().chars().collect();
    let h: Vec<char> = normalize(hyp).concat().chars().collect();
    if r.is_empty() {
        return if h.is_empty() { 0.0 } else { 1.0 };
    }
    edit_distance(&r, &h) as f32 / r.len() as f32
}

/// Physical memory footprint of this process in MB (what Activity Monitor shows), via footprint(1).
pub fn footprint_mb() -> Option<f64> {
    let out = std::process::Command::new("footprint").arg(std::process::id().to_string()).output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout);
    let line = s.lines().find(|l| l.contains("Footprint:"))?;
    let rest = line.split("Footprint:").nth(1)?.trim();
    let mut it = rest.split_whitespace();
    let v: f64 = it.next()?.parse().ok()?;
    Some(match it.next()? {
        "KB" => v / 1024.0,
        "MB" => v,
        "GB" => v * 1024.0,
        _ => v / (1024.0 * 1024.0),
    })
}

fn read_wav(path: &str) -> Vec<f32> {
    let mut r = hound::WavReader::open(path).expect("wav");
    r.samples::<i16>().filter_map(|s| s.ok()).map(|s| s as f32 / i16::MAX as f32).collect()
}

/// Deterministic pseudo-random noise (xorshift), so every run hears the same noise.
fn add_noise(s: &[f32], level: f32) -> Vec<f32> {
    let mut x: u32 = 0x9e37_79b9;
    s.iter()
        .map(|v| {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            v + ((x as f32 / u32::MAX as f32) * 2.0 - 1.0) * level * 1.732
        })
        .collect()
}

#[test]
#[ignore]
fn stt_bench() {
    let (Ok(manifest), Ok(model)) = (std::env::var("FLO_BENCH_MANIFEST"), std::env::var("FLO_BENCH_MODEL")) else {
        eprintln!("set FLO_BENCH_MANIFEST and FLO_BENCH_MODEL");
        return;
    };
    let out = std::env::var("FLO_BENCH_OUT").unwrap_or_else(|_| "stt-bench.json".into());
    let fixed = std::env::var("FLO_BENCH_LANG").map(|v| v == "fixed").unwrap_or(false);
    let clips: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(&manifest).unwrap()).unwrap();
    let model = PathBuf::from(model);
    let mem_start = footprint_mb();
    let w = LocalWhisper::default();
    // FLO_BENCH_AUTO_LANGS=en,hi → the default allowed set; unset → en/hi/gu like the user's settings
    let auto: Vec<String> = std::env::var("FLO_BENCH_AUTO_LANGS").unwrap_or_else(|_| "en,hi,gu".into()).split(',').map(String::from).collect();
    *w.auto_langs.lock() = allowed_languages(&auto);
    let t = std::time::Instant::now();
    w.warm(&model);
    let load_ms = t.elapsed().as_millis();
    let mem_loaded = footprint_mb();
    // first decode compiles Metal kernels: keep it out of the numbers
    let _ = w.transcribe(&model, &vec![0.0; 16_000], "en", "");
    let dictionary = "Flo, Rahul, Dhanteras, Slack";
    let mut rows = vec![];
    let mut prev_text = String::new();
    let mut mem_peak = mem_loaded.unwrap_or(0.0);
    for c in &clips {
        let name = c["name"].as_str().unwrap();
        let lang = c["lang"].as_str().unwrap();
        let expect = c["text"].as_str().unwrap();
        let clean = read_wav(c["wav"].as_str().unwrap());
        let conditions: [(&str, Vec<f32>, String); 4] = [
            ("clean", clean.clone(), String::new()),
            ("quiet", clean.iter().map(|v| v * 0.08).collect(), String::new()),
            ("noisy", add_noise(&clean, 0.01), String::new()),
            ("streamed", clean.clone(), format!("{dictionary}. {}", text_tail(&prev_text))),
        ];
        for (cond, audio, prompt) in conditions {
            let audio = crate::audio::trim_silence(&audio);
            let secs = audio.len() as f32 / 16_000.0;
            let retries_before = w.fast_retries.load(std::sync::atomic::Ordering::Relaxed);
            let language = if fixed { lang } else { "auto" };
            let t = std::time::Instant::now();
            let text = w.transcribe(&model, &audio, language, &prompt).unwrap_or_else(|e| format!("<error {e}>"));
            let ms = t.elapsed().as_millis();
            let timing = *w.last_timing.lock();
            let retried = w.fast_retries.load(std::sync::atomic::Ordering::Relaxed) > retries_before;
            let row = json!({
                "clip": name, "lang": lang, "cond": cond, "secs": (secs * 10.0).round() / 10.0, "ms": ms,
                "detect_ms": timing.detect_ms, "detected": w.detected_lang(), "conf": (timing.confidence * 100.0).round() / 100.0,
                "retried": retried, "degenerate": is_degenerate(&text), "script_ok": script_ok(&text, lang),
                "wer": (wer(expect, &text) * 1000.0).round() / 1000.0, "cer": (cer(expect, &text) * 1000.0).round() / 1000.0,
                "text": text,
            });
            println!("{name:10} {cond:8} {ms:5} ms wer {:.2} cer {:.2} script {:5} lang {:?} | {}", row["wer"].as_f64().unwrap(), row["cer"].as_f64().unwrap(), script_ok(&text, lang), w.detected_lang(), row["text"].as_str().unwrap());
            rows.push(row);
        }
        prev_text = expect.to_string();
        mem_peak = mem_peak.max(footprint_mb().unwrap_or(0.0));
    }
    // summary per language and condition
    let mut summary = serde_json::Map::new();
    for key in ["en", "hi", "gu", "hi-en", "clean", "quiet", "noisy", "streamed", "all"] {
        let sel: Vec<&Value> = rows.iter().filter(|r| key == "all" || r["lang"] == key || r["cond"] == key).collect();
        if sel.is_empty() {
            continue;
        }
        let avg = |f: &str| sel.iter().map(|r| r[f].as_f64().unwrap_or(0.0)).sum::<f64>() / sel.len() as f64;
        let mut ms: Vec<u64> = sel.iter().map(|r| r["ms"].as_u64().unwrap_or(0)).collect();
        ms.sort();
        summary.insert(
            key.into(),
            json!({
                "n": sel.len(), "wer": (avg("wer") * 1000.0).round() / 1000.0, "cer": (avg("cer") * 1000.0).round() / 1000.0,
                "ms_mean": avg("ms").round(), "ms_p50": ms[ms.len() / 2], "ms_p90": ms[(ms.len() * 9 / 10).min(ms.len() - 1)],
                "retries": sel.iter().filter(|r| r["retried"].as_bool().unwrap_or(false)).count(),
                "script_wrong": sel.iter().filter(|r| !r["script_ok"].as_bool().unwrap_or(false)).count(),
                "degenerate_final": sel.iter().filter(|r| r["degenerate"].as_bool().unwrap_or(false)).count(),
                "wrong_lang": sel.iter().filter(|r| r["detected"].as_str().is_some_and(|d| d != r["lang"].as_str().unwrap_or(""))).count(),
            }),
        );
    }
    w.ctx.lock().take();
    let mem_unloaded = footprint_mb();
    let report = json!({
        "model": model.file_name().unwrap().to_string_lossy(), "mode": if fixed { "fixed" } else { "auto" },
        "load_ms": load_ms, "mem_mb": { "start": mem_start, "loaded": mem_loaded, "peak": mem_peak, "after_unload": mem_unloaded },
        "summary": summary, "rows": rows,
    });
    println!("{}", serde_json::to_string_pretty(&report["summary"]).unwrap());
    println!("memory {}", report["mem_mb"]);
    std::fs::write(&out, serde_json::to_string_pretty(&report).unwrap()).unwrap();
}

/// Decoder settings side by side, each clip in its own language (isolates decoding from language
/// detection), plus language detection on the clip-sized state vs the full 30 s window.
/// FLO_BENCH_MANIFEST=… FLO_BENCH_MODEL=… cargo test --release --lib stt_sweep -- --ignored --nocapture
#[test]
#[ignore]
fn stt_sweep() {
    let (Ok(manifest), Ok(model)) = (std::env::var("FLO_BENCH_MANIFEST"), std::env::var("FLO_BENCH_MODEL")) else { return };
    let clips: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(&manifest).unwrap()).unwrap();
    let model = PathBuf::from(model);
    let w = LocalWhisper::default();
    w.warm(&model);
    let _ = w.decode_with(&model, &vec![0.0; 16_000], "en", "", DecodeOpts::SAFE);
    let base = DecodeOpts { clip_ctx: true, audio_ctx: 0, fallback: true, cap_tokens: true, single_segment: true, no_timestamps: true };
    let variants: Vec<(&str, DecodeOpts)> = match std::env::var("FLO_SWEEP").as_deref() {
        Ok("all") => vec![
            ("legacy_fast", DecodeOpts::LEGACY_FAST),
            ("clip+fallback+cap", base),
            ("clip+cap", DecodeOpts { fallback: false, ..base }),
            ("full+fallback+cap", DecodeOpts { clip_ctx: false, ..base }),
            ("full_greedy+cap", DecodeOpts { clip_ctx: false, fallback: false, ..base }),
            ("safe", DecodeOpts::SAFE),
        ],
        _ => vec![
            ("clip+fallback+cap", base),
            ("ctx768+fallback+cap", DecodeOpts { clip_ctx: false, audio_ctx: 768, ..base }),
            ("full_greedy+cap", DecodeOpts { clip_ctx: false, fallback: false, ..base }),
        ],
    };
    let cands: Vec<String> = ["en", "hi", "gu"].iter().map(|s| s.to_string()).collect();
    let mut agg: std::collections::BTreeMap<String, (f64, f64, u128, usize, usize, usize, Vec<u128>)> = Default::default();
    let mut det = (0usize, 0usize, 0u128, 0u128, 0usize);
    let mut prev = String::new();
    for c in &clips {
        let name = c["name"].as_str().unwrap();
        let lang = c["lang"].as_str().unwrap();
        let expect = c["text"].as_str().unwrap();
        let clean = crate::audio::trim_silence(&read_wav(c["wav"].as_str().unwrap()));
        let conds = [("clean", clean.clone(), String::new()), ("noisy", add_noise(&clean, 0.01), String::new()), ("streamed", clean.clone(), format!("Flo, Rahul, Dhanteras, Slack. {}", text_tail(&prev)))];
        for (cond, audio, prompt) in &conds {
            for (vname, o) in &variants {
                let t = std::time::Instant::now();
                let r = w.decode_with(&model, audio, lang, prompt, *o);
                let ms = t.elapsed().as_millis();
                let ((text, conf), state) = match r {
                    Ok(v) => v,
                    Err(e) => {
                        println!("{name} {cond} {vname} error {e}");
                        continue;
                    }
                };
                let e = agg.entry(vname.to_string()).or_default();
                e.0 += wer(expect, &text) as f64;
                e.1 += cer(expect, &text) as f64;
                e.2 += ms;
                e.3 += 1;
                e.4 += usize::from(text.trim().is_empty());
                e.5 += usize::from(is_degenerate(&text));
                e.6.push(ms);
                println!("{name:10} {cond:8} {vname:18} {ms:5} ms wer {:.2} conf {conf:.2} plausible {} | {text}", wer(expect, &text), plausible(&text, lang));
                if *vname == "clip+fallback+cap" && *cond != "streamed" {
                    // language detection on the decode's own (clip-sized) state
                    let mut state = state;
                    let t = std::time::Instant::now();
                    let small = w.lang_from_state(&model, &mut state, &cands);
                    let small_ms = t.elapsed().as_millis();
                    let t = std::time::Instant::now();
                    let full = w.detect_language(&model, audio, &cands).ok();
                    let full_ms = t.elapsed().as_millis();
                    det.0 += usize::from(small.as_deref() == Some(lang));
                    det.1 += usize::from(full.as_deref() == Some(lang));
                    det.2 += small_ms;
                    det.3 += full_ms;
                    det.4 += 1;
                    println!("    detect: decoder-step {small:?} {small_ms} ms | full-window {full:?} {full_ms} ms (truth {lang})");
                }
            }
        }
        prev = expect.to_string();
    }
    println!("\nvariant              n   WER    CER   ms_mean  ms_p90 empty degenerate");
    for (k, (wsum, csum, ms, n, empty, degen, mut all)) in agg {
        all.sort();
        let p90 = all[(all.len() * 9 / 10).min(all.len() - 1)];
        println!("{k:18} {n:3} {:.3} {:.3} {:7.0} {p90:7} {empty:5} {degen:5}", wsum / n as f64, csum / n as f64, ms as f64 / n as f64);
    }
    println!(
        "language detection: decoder-step correct {}/{} mean {} ms | full-window correct {}/{} mean {} ms",
        det.0,
        det.4,
        det.2 / det.4.max(1) as u128,
        det.1,
        det.4,
        det.3 / det.4.max(1) as u128
    );
}

/// Where the time goes: state creation (Metal init), and encoder cost by window size.
#[test]
#[ignore]
fn stt_micro() {
    let Ok(model) = std::env::var("FLO_BENCH_MODEL") else { return };
    let model = PathBuf::from(model);
    let w = LocalWhisper::default();
    w.warm(&model);
    let ctx = w.context(&model).unwrap();
    let t = std::time::Instant::now();
    for _ in 0..5 {
        drop(ctx.create_state().unwrap());
    }
    println!("create_state: {} ms each", t.elapsed().as_millis() / 5);
    let audio: Vec<f32> = (0..16_000 * 3).map(|i| (i as f32 / 9.0).sin() * 0.1).collect();
    let mut state = ctx.create_state().unwrap();
    state.pcm_to_mel(&audio, threads()).unwrap();
    let _ = state.lang_detect(0, threads());
    for n in [384, 512, 768, 1024, 1500] {
        // prime the state's window with a 1-token decode at this size, then time detection (encode + 1 step)
        let mut p = whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::Greedy { best_of: 1 });
        p.set_audio_ctx(n);
        p.set_max_tokens(1);
        p.set_language(Some("en"));
        let t = std::time::Instant::now();
        state.full(p, &audio).unwrap();
        let full_ms = t.elapsed().as_millis();
        let t = std::time::Instant::now();
        let _ = state.lang_detect(0, threads());
        println!("audio_ctx {n:4}: encode+1 token {} ms (whisper_full 1 token incl. mel {full_ms} ms)", t.elapsed().as_millis());
    }
}

/// How much speech the voice-activity gate finds in each clip (it decides "I didn't hear anything").
#[test]
#[ignore]
fn vad_bench() {
    let Ok(manifest) = std::env::var("FLO_BENCH_MANIFEST") else { return };
    let clips: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(&manifest).unwrap()).unwrap();
    for c in &clips {
        let clean = read_wav(c["wav"].as_str().unwrap());
        let secs = clean.len() as f32 / 16_000.0;
        let quiet: Vec<f32> = clean.iter().map(|v| v * 0.08).collect();
        let trimmed = crate::audio::trim_silence(&clean);
        println!(
            "{:10} {:5.1}s rms {:.3} voiced clean {:5} trimmed {:5} quiet {:5} quiet-noisy {:5}",
            c["name"].as_str().unwrap(),
            secs,
            crate::audio::rms(&clean),
            crate::audio::voiced_ms(&clean),
            crate::audio::voiced_ms(&trimmed),
            crate::audio::voiced_ms(&quiet),
            crate::audio::voiced_ms(&add_noise(&quiet, 0.003)),
        );
    }
}

/// Is `text` written in the script `lang` should come out in? English and Hinglish: Latin only;
/// Hindi: Devanagari; Gujarati: Gujarati script (no Devanagari).
pub fn script_ok(text: &str, lang: &str) -> bool {
    let deva = text.chars().filter(|c| ('\u{0900}'..='\u{097F}').contains(c)).count();
    let guj = text.chars().filter(|c| ('\u{0A80}'..='\u{0AFF}').contains(c)).count();
    let other = text.chars().filter(|c| c.is_alphabetic() && !c.is_ascii() && !('\u{0900}'..='\u{097F}').contains(c) && !('\u{0A80}'..='\u{0AFF}').contains(c)).count();
    match lang {
        "en" | "hi-en" => deva + guj + other == 0 && text.chars().any(|c| c.is_ascii_alphabetic()),
        "hi" => deva > 0 && guj == 0 && other == 0,
        "gu" => guj > 0 && deva == 0 && other == 0,
        _ => true,
    }
}

fn text_tail(s: &str) -> String {
    crate::text::truncate_chars(s, 200)
}

#[cfg(test)]
mod metric_tests {
    use super::*;

    #[test]
    fn wer_ignores_case_punctuation_and_hindi_spelling_variants() {
        assert_eq!(wer("Send the deck to Rahul by Friday.", "send the deck to rahul by friday"), 0.0);
        assert_eq!(wer("घर जा रहा हूँ।", "घर जा रहा हूं"), 0.0);
        assert_eq!(wer("हाँ।", "हाँ"), 0.0);
        assert!((wer("a b c d", "a x c d") - 0.25).abs() < 1e-6);
        assert!(wer("a b", "a b a b a b a b") > 1.0); // runaway output counts against it
        assert!(cer("કાલે મીટિંગ છે", "કાલે મીટીંગ છે") > 0.0);
    }

    #[test]
    fn script_check_per_language() {
        assert!(script_ok("Send it.", "en"));
        assert!(!script_ok("प्लीस सेंड", "en"));
        assert!(script_ok("कल meeting है", "hi"));
        assert!(!script_ok("काले सवारे 10 वागे meeting छे", "gu"));
        assert!(script_ok("કાલે સવારે 10 વાગે meeting છે", "gu"));
        assert!(!script_ok("Aš nuca am pôruta", "gu"));
        assert!(script_ok("Kal meeting hai", "hi-en"));
    }
}

/// Gujarati / Hindi / English probe: each clip decoded in every candidate language (fast and full
/// window), Whisper's full-window language probabilities, and the Hindi decode re-scripted to
/// Gujarati. Shows what the model can do per language, independent of detection.
/// FLO_BENCH_MANIFEST=… FLO_BENCH_MODEL=… cargo test --release --lib stt_lang_probe -- --ignored --nocapture
#[test]
#[ignore]
fn stt_lang_probe() {
    let (Ok(manifest), Ok(model)) = (std::env::var("FLO_BENCH_MANIFEST"), std::env::var("FLO_BENCH_MODEL")) else { return };
    let only = std::env::var("FLO_PROBE_ONLY").unwrap_or_default();
    let clips: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(&manifest).unwrap()).unwrap();
    let model = PathBuf::from(model);
    let w = LocalWhisper::default();
    w.warm(&model);
    let _ = w.decode_with(&model, &vec![0.0; 16_000], "en", "", DecodeOpts::SAFE);
    for c in &clips {
        let name = c["name"].as_str().unwrap();
        if !only.is_empty() && !name.starts_with(&only) {
            continue;
        }
        let expect = c["text"].as_str().unwrap();
        let audio = crate::audio::trim_silence(&read_wav(c["wav"].as_str().unwrap()));
        let ctx = w.context(&model).unwrap();
        let mut state = ctx.create_state().unwrap();
        state.pcm_to_mel(&padded(&audio), threads()).unwrap();
        let (_, probs) = state.lang_detect(0, threads()).unwrap();
        let p = |l: &str| whisper_rs::get_lang_id(l).and_then(|i| probs.get(i as usize).copied()).unwrap_or(0.0);
        let mut top: Vec<(usize, f32)> = probs.iter().copied().enumerate().collect();
        top.sort_by(|a, b| b.1.total_cmp(&a.1));
        let top3: Vec<String> = top.iter().take(3).map(|(i, v)| format!("{}:{v:.2}", whisper_rs::get_lang_str(*i as i32).unwrap_or("?"))).collect();
        println!("{name:10} [{}] LID en {:.2} hi {:.2} gu {:.2} | top {}", c["lang"], p("en"), p("hi"), p("gu"), top3.join(" "));
        for lang in ["en", "hi", "gu"] {
            for (oname, o) in [("fast", DecodeOpts::FAST), ("full", DecodeOpts::ACCURATE)] {
                let ((text, conf), _) = w.decode_with(&model, &audio, lang, &prompt_for(lang, ""), o).unwrap();
                let extra = if lang == "hi" { format!(" | as gu: cer {:.2}", cer(expect, &crate::text::devanagari_to_gujarati(&text))) } else { String::new() };
                println!("   {lang} {oname}: cer {:.2} conf {conf:.2}{extra} | {text}", cer(expect, &text));
            }
        }
    }
}
