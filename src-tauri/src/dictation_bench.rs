//! Dictation / assistant accuracy harness: recorded clips through the Flo key's own pipeline
//! (`dictation::on_slice` while "talking" in 300 ms slices, `LocalWhisper::dictate` for each
//! sentence and the tail, `final_transcript`, `local_cleanup`) under the conditions a real
//! microphone produces, scored by word error rate per scenario, language and config.
//!
//! python3 scripts/dictation-bench-clips.py /tmp/flo-dictation-clips
//! FLO_DICT_MANIFEST=/tmp/flo-dictation-clips/manifest.json \
//!   FLO_DICT_CONFIGS='model=small-q5_1,auto=en|hi|gu;model=large-v3-turbo-q5_0,auto=en|hi' \
//!   cargo test --release --lib dictation_bench -- --ignored --nocapture
//!
//! Config keys (`;` between configs, `,` between keys): model (id in the models folder or a path),
//! lang (auto | en | hi | hi-en | fixed = each clip in its own language), auto (languages Auto
//! picks from, `|`-separated), prompt (1 = the dictionary words below as the speech model's
//! prompt), norm (0 = no input gain normalization), beam (beam size; 0/1 = greedy).
//! FLO_DICT_SCENARIOS=clean,quiet,… limits the scenarios; FLO_DICT_ONLY=prefix limits the clips;
//! FLO_DICT_OUT=report.json writes every row; FLO_DICT_DEBUG=1 prints the sentences decoded while
//! talking and the language detector's scores; FLO_DICT_DIRECT=1 decodes each recording in one
//! piece (no streaming), to tell decoder errors from segmentation ones.
//!
//! Scenarios: clean (key pressed 0.25 s early, released 0.4 s late), quiet (-30 dB), silence (1.5 s
//! before, 2 s after), onset (the first 200 ms of speech lost to a late start), noisy (room noise
//! 10 dB under the voice). All sit on a -65 dBFS room floor, like a real microphone.
use super::*;
use crate::livetx::Segmenter;
use crate::stt::bench::{read_wav, wer};
use crate::stt::{self, LocalWhisper};
use serde_json::{json, Value};
use std::path::PathBuf;

/// The words a user would have in their dictionary for these clips.
const VOCAB: &[&str] = &["Flo", "Priya", "Rahul", "Taj", "Slack"];

#[derive(Debug, Clone)]
struct Config {
    name: String,
    model: PathBuf,
    lang: String,
    auto: Vec<String>,
    prompt: bool,
    norm: bool,
    beam: u32,
}

fn parse_config(spec: &str, models: &std::path::Path) -> Config {
    let mut c = Config { name: spec.to_string(), model: PathBuf::new(), lang: "auto".into(), auto: vec!["en".into(), "hi".into(), "gu".into()], prompt: false, norm: true, beam: 0 };
    let mut model = "small-q5_1".to_string();
    for kv in spec.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
        match k {
            "model" => model = v.to_string(),
            "lang" => c.lang = v.to_string(),
            "auto" => c.auto = v.split('|').map(String::from).collect(),
            "prompt" => c.prompt = v != "0",
            "norm" => c.norm = v != "0",
            "beam" => c.beam = v.parse().unwrap_or(0),
            _ => panic!("unknown config key {k}"),
        }
    }
    c.model = stt::model_path(models, &model).unwrap_or_else(|| PathBuf::from(&model));
    c
}

/// Deterministic noise (xorshift), low-passed so it sounds like a fan / room rather than hiss.
fn room_noise(n: usize, rms_target: f32, seed: u32) -> Vec<f32> {
    let mut x = seed.max(1);
    let mut y = 0.0f32;
    let raw: Vec<f32> = (0..n)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            let w = (x as f32 / u32::MAX as f32) * 2.0 - 1.0;
            y = y * 0.85 + w * 0.15;
            y
        })
        .collect();
    let r = audio::rms(&raw).max(1e-9);
    raw.iter().map(|v| v * rms_target / r).collect()
}

fn db(x: f32) -> f32 {
    10f32.powf(x / 20.0)
}

/// Level of the speech itself (RMS of the louder 20 ms frames), not diluted by pauses.
fn speech_rms(s: &[f32]) -> f32 {
    let mut e: Vec<f32> = s.chunks(320).map(audio::rms).collect();
    e.sort_by(|a, b| b.total_cmp(a));
    let top = &e[..(e.len() / 2).max(1)];
    (top.iter().map(|v| v * v).sum::<f32>() / top.len() as f32).sqrt()
}

fn mix(a: &[f32], b: &[f32]) -> Vec<f32> {
    (0..a.len().max(b.len())).map(|i| a.get(i).copied().unwrap_or(0.0) + b.get(i).copied().unwrap_or(0.0)).collect()
}

/// What the microphone hands over when the key is held around `clip` (16 kHz).
fn scenario(name: &str, clip: &[f32]) -> Vec<f32> {
    const SR: usize = 16_000;
    // a real microphone is never digital zero: a -65 dBFS room floor under everything
    let floor = |n: usize, seed: u32| room_noise(n, db(-65.0), seed);
    let wrap = |speech: &[f32], lead: f32, trail: f32| {
        let mut v = floor((lead * SR as f32) as usize, 7);
        v.extend_from_slice(speech);
        v.extend(vec![0.0; (trail * SR as f32) as usize]);
        mix(&v, &floor(v.len(), 11))
    };
    match name {
        // key pressed a moment before speaking, released a moment after
        "clean" => wrap(clip, 0.25, 0.4),
        // speaking softly / far from the mic: 30 dB quieter, same room floor
        "quiet" => wrap(&clip.iter().map(|v| v * db(-30.0)).collect::<Vec<_>>(), 0.25, 0.4),
        // a long hold: 1.5 s before the first word, 2 s after the last
        "silence" => wrap(clip, 1.5, 2.0),
        // the first word started as the key went down: the first 200 ms of speech never arrive
        "onset" => {
            let first = clip.chunks(320).position(|c| audio::rms(c) > 0.01).unwrap_or(0) * 320;
            wrap(&clip[(first + SR / 5).min(clip.len())..], 0.0, 0.4)
        }
        // a fan / café at 10 dB below the voice
        "noisy" => {
            let v = wrap(clip, 0.25, 0.4);
            let n = room_noise(v.len(), speech_rms(clip) * db(-10.0), 23);
            mix(&v, &n)
        }
        _ => panic!("unknown scenario {name}"),
    }
}

/// What a dictation produces from `mic`: the same steps as `session::finish`. Returns the text,
/// the decode time spent after the key was released (the wait the user sees) and the total.
fn run_pipeline(w: &LocalWhisper, c: &Config, mic: &[f32], lang: &str) -> (String, u128, u128) {
    let vocab: Vec<String> = if c.prompt { VOCAB.iter().rev().map(|s| s.to_string()).collect() } else { vec![] };
    let mut seg = Segmenter::default();
    let mut pending = vec![];
    let mut committed: Vec<String> = vec![];
    let mut context = String::new();
    let slice = (crate::livetx::SLICE_MS as usize) * 16;
    let t_all = std::time::Instant::now();
    if std::env::var_os("FLO_DICT_DIRECT").is_some() {
        // one decode of the whole recording, no streaming (to tell decoder errors from segmentation)
        let t = w.dictate(&c.model, mic, lang, &stt_prompt(&vocab, "")).unwrap_or_default();
        let ms = t_all.elapsed().as_millis();
        return (local_cleanup(&t, &[]), ms, ms);
    }
    let mut rest: &[f32] = &[];
    for ch in mic.chunks(slice) {
        if ch.len() < slice {
            rest = ch;
            break;
        }
        if let Some(a) = on_slice(&mut seg, &mut pending, ch) {
            let secs = a.len() as f32 / 16_000.0;
            if let Ok(t) = w.dictate(&c.model, &a, lang, &stt_prompt(&vocab, &context)) {
                if keep_chunk(&t, secs) {
                    context = crate::text::truncate_chars(&t, 200);
                    committed.push(t.trim().to_string());
                }
            }
        }
    }
    let mut samples = std::mem::take(&mut pending);
    samples.extend_from_slice(rest);
    let tail_voiced = audio::voiced_ms(&samples);
    if committed.is_empty() && tail_voiced < MIN_TAIL_VOICED_MS {
        return (String::new(), 0, t_all.elapsed().as_millis()); // "I didn't hear anything"
    }
    let secs = samples.len() as f32 / 16_000.0;
    let t_tail = std::time::Instant::now();
    let tail = if tail_voiced >= MIN_TAIL_VOICED_MS {
        let ctx = committed.last().map(|c| crate::text::truncate_chars(c, 200)).unwrap_or_default();
        w.dictate(&c.model, &samples, lang, &stt_prompt(&vocab, &ctx)).unwrap_or_default()
    } else {
        String::new()
    };
    let tail_ms = t_tail.elapsed().as_millis();
    if std::env::var_os("FLO_DICT_DEBUG").is_some() {
        eprintln!("   committed {committed:?} tail {:.1}s {tail:?}", samples.len() as f32 / 16_000.0);
    }
    let raw = final_transcript(committed, tail, secs).unwrap_or_default();
    (local_cleanup(&raw, &[]), tail_ms, t_all.elapsed().as_millis())
}

/// Spoken-number and spelling variants Whisper flips between, so WER counts words, not formatting.
fn canon(s: &str) -> String {
    const NUM: &[&str] = &["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
    let s = s.replace('%', " percent").replace("to-do", "todo").replace("To-do", "todo").replace("to do", "todo");
    s.split_whitespace()
        .map(|w| {
            let core: String = w.chars().filter(|c| c.is_alphanumeric()).collect();
            match core.parse::<usize>() {
                Ok(n) if n < NUM.len() => NUM[n].to_string(),
                _ => w.to_string(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn score(expect: &str, alt: Option<&str>, hyp: &str) -> f32 {
    let a = wer(&canon(expect), &canon(hyp));
    alt.map(|b| a.min(wer(&canon(b), &canon(hyp)))).unwrap_or(a)
}

fn pct(mut v: Vec<u128>, p: usize) -> u128 {
    if v.is_empty() {
        return 0;
    }
    v.sort();
    v[(v.len() * p / 100).min(v.len() - 1)]
}

#[test]
#[ignore]
fn dictation_bench() {
    let Ok(manifest) = std::env::var("FLO_DICT_MANIFEST") else {
        eprintln!("set FLO_DICT_MANIFEST (python3 scripts/dictation-bench-clips.py makes the clips)");
        return;
    };
    let models = crate::meeting_sim::data_dir().join("models");
    let configs: Vec<Config> = std::env::var("FLO_DICT_CONFIGS")
        .unwrap_or_else(|_| "model=small-q5_1".into())
        .split(';')
        .filter(|s| !s.trim().is_empty())
        .map(|s| parse_config(s, &models))
        .collect();
    let scenarios: Vec<String> =
        std::env::var("FLO_DICT_SCENARIOS").unwrap_or_else(|_| "clean,quiet,silence,onset,noisy".into()).split(',').map(String::from).collect();
    let only = std::env::var("FLO_DICT_ONLY").unwrap_or_default();
    let clips: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(&manifest).unwrap()).unwrap();
    let clips: Vec<&Value> = clips.iter().filter(|c| only.is_empty() || c["name"].as_str().unwrap().starts_with(&only)).collect();
    let mut rows = vec![];
    let mut summaries = vec![];
    for c in &configs {
        assert!(c.model.exists(), "model {} isn't downloaded", c.model.display());
        let w = LocalWhisper::default();
        *w.auto_langs.lock() = stt::allowed_languages(&c.auto);
        w.set_bench_knobs(c.norm, c.beam);
        w.warm(&c.model);
        let _ = w.transcribe(&c.model, &vec![0.0; 16_000], "en", ""); // Metal kernels compile on the first decode
        let mut cfg_rows: Vec<Value> = vec![];
        for clip in &clips {
            let name = clip["name"].as_str().unwrap();
            let clang = clip["lang"].as_str().unwrap();
            let expect = clip["text"].as_str().unwrap();
            let alt = clip["alt"].as_str();
            let audio_clip = read_wav(clip["wav"].as_str().unwrap());
            let lang = if c.lang == "fixed" { clang.to_string() } else { c.lang.clone() };
            for sc in &scenarios {
                let mic = scenario(sc, &audio_clip);
                let (text, tail_ms, total_ms) = run_pipeline(&w, c, &mic, &lang);
                let e = score(expect, alt, &text);
                println!("[{}] {name:8} {sc:8} wer {e:.2} tail {tail_ms:4} ms lang {:?} | {text}", c.name, w.detected_lang());
                let row = json!({
                    "config": c.name, "clip": name, "lang": clang, "kind": clip["kind"], "scenario": sc,
                    "secs": (audio_clip.len() as f32 / 1600.0).round() / 10.0, "wer": e, "tail_ms": tail_ms, "total_ms": total_ms,
                    "detected": w.detected_lang(), "empty": text.trim().is_empty(), "text": text,
                });
                cfg_rows.push(row);
            }
        }
        // summary: by scenario, by language group, by kind
        let group = |f: &dyn Fn(&Value) -> bool| -> (f64, usize) {
            let sel: Vec<&Value> = cfg_rows.iter().filter(|r| f(r)).collect();
            let n = sel.len();
            ((sel.iter().map(|r| r["wer"].as_f64().unwrap().min(1.0)).sum::<f64>() / n.max(1) as f64 * 1000.0).round() / 1000.0, n)
        };
        let mut sum = serde_json::Map::new();
        for sc in &scenarios {
            sum.insert(sc.clone(), json!(group(&|r| r["scenario"] == sc.as_str()).0));
        }
        sum.insert("indian_en".into(), json!(group(&|r| r["clip"].as_str().unwrap().starts_with("in_en")).0));
        sum.insert("us_en".into(), json!(group(&|r| r["clip"].as_str().unwrap().starts_with("us_en")).0));
        sum.insert("hindi".into(), json!(group(&|r| r["lang"] == "hi").0));
        sum.insert("hinglish".into(), json!(group(&|r| r["lang"] == "hi-en").0));
        sum.insert("assistant".into(), json!(group(&|r| r["kind"] == "assistant").0));
        sum.insert("all".into(), json!(group(&|_| true).0));
        sum.insert("empty".into(), json!(cfg_rows.iter().filter(|r| r["empty"].as_bool().unwrap()).count()));
        let clean: Vec<&Value> = cfg_rows.iter().filter(|r| r["scenario"] == "clean").collect();
        sum.insert("tail_ms_p50".into(), json!(pct(clean.iter().map(|r| r["tail_ms"].as_u64().unwrap() as u128).collect(), 50)));
        // a ~5 s clip, decoded end to end (no streaming head start): the worst case at release
        let five: Vec<u128> = clean.iter().filter(|r| (4.0..=6.5).contains(&r["secs"].as_f64().unwrap())).map(|r| r["total_ms"].as_u64().unwrap() as u128).collect();
        sum.insert("five_sec_total_ms_p50".into(), json!(pct(five, 50)));
        println!("\n== {} ==\n{}", c.name, serde_json::to_string_pretty(&sum).unwrap());
        summaries.push(json!({ "config": c.name, "summary": sum }));
        rows.extend(cfg_rows);
    }
    println!("\nconfig | {} | indian_en | us_en | hindi | hinglish | assistant | all | empty | tail p50 ms | 5 s clip p50 ms", scenarios.join(" | "));
    for s in &summaries {
        let m = &s["summary"];
        let cells: Vec<String> = scenarios.iter().map(|k| format!("{:.3}", m[k].as_f64().unwrap())).collect();
        println!(
            "{} | {} | {:.3} | {:.3} | {:.3} | {:.3} | {:.3} | {:.3} | {} | {} | {}",
            s["config"].as_str().unwrap(),
            cells.join(" | "),
            m["indian_en"].as_f64().unwrap(),
            m["us_en"].as_f64().unwrap(),
            m["hindi"].as_f64().unwrap(),
            m["hinglish"].as_f64().unwrap(),
            m["assistant"].as_f64().unwrap(),
            m["all"].as_f64().unwrap(),
            m["empty"],
            m["tail_ms_p50"],
            m["five_sec_total_ms_p50"]
        );
    }
    if let Ok(out) = std::env::var("FLO_DICT_OUT") {
        std::fs::write(out, serde_json::to_string_pretty(&json!({ "summaries": summaries, "rows": rows })).unwrap()).unwrap();
    }
}

#[test]
fn scenarios_shape_the_audio_like_a_microphone() {
    let clip: Vec<f32> = (0..16_000).map(|i| (i as f32 / 6.0).sin() * 0.1).collect();
    let quiet = scenario("quiet", &clip);
    assert!(speech_rms(&quiet) < speech_rms(&clip) * 0.05);
    assert!(scenario("silence", &clip).len() > clip.len() + 16_000 * 3);
    assert_eq!(scenario("onset", &clip).len(), clip.len() - 16_000 / 5 + 6_400);
    assert!(!audio::is_digital_silence(&scenario("clean", &vec![0.0; 1600])));
    assert_eq!(canon("ten percent of 4 to-do"), "ten percent of four todo");
    assert_eq!(score("Kal meeting hai", Some("कल मीटिंग है"), "कल मीटिंग है।"), 0.0);
}
