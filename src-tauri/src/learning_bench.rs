//! Screen-aware vocabulary bench: clips full of names and jargon through on-device Whisper, then
//! the dictation's local steps (`correct` → `local_cleanup` → `correct`, as `session::cleanup`)
//! without and with the words a window would show, plus a learned-edit replay (the user fixes the
//! output twice, the fix is applied on the third dictation). Scored by WER, exact term spelling and
//! the time the correction step adds.
//!
//! python3 scripts/learning-bench-clips.py /tmp/flo-learning-clips
//! FLO_LEARN_MANIFEST=/tmp/flo-learning-clips/manifest.json [FLO_LEARN_MODELS=small-q5_1,large-v3-turbo-q5_0] \
//!   cargo test --release --lib learning_bench -- --ignored --nocapture
use super::*;
use crate::stt::bench::{read_wav, wer};
use crate::stt::{self, LocalWhisper};
use serde_json::Value;

/// Terms spelled exactly (case-sensitive, whole words) in `hyp`.
fn terms_hit(terms: &[String], hyp: &str) -> usize {
    let words: Vec<String> = hyp.split(|c: char| !(c.is_alphanumeric() || c == '\'')).map(|w| w.trim_end_matches("'s").to_string()).collect();
    terms
        .iter()
        .filter(|t| {
            let tw: Vec<&str> = t.split_whitespace().collect();
            words.windows(tw.len()).any(|w| w.iter().zip(&tw).all(|(a, b)| a == b))
        })
        .count()
}

/// The dictation's local steps with a term set (what `session::cleanup` does without AI).
fn finish(raw: &str, set: &TermSet, dict: &[(String, String)]) -> String {
    let (fixed, _) = correct(raw, set);
    correct(&crate::dictation::local_cleanup(&fixed, dict), set).0
}

#[derive(Default)]
struct Score {
    wer: f32,
    hit: usize,
    total: usize,
    n: usize,
    control_changed: usize,
}

impl Score {
    fn add(&mut self, expect: &str, terms: &[String], hyp: &str) {
        self.wer += wer(expect, hyp);
        self.hit += terms_hit(terms, hyp);
        self.total += terms.len();
        self.n += 1;
    }
    fn line(&self, name: &str) -> String {
        format!(
            "{name:<26} WER {:.3}   terms {}/{} ({:.0}%)   control clips changed {}",
            self.wer / self.n.max(1) as f32,
            self.hit,
            self.total,
            100.0 * self.hit as f32 / self.total.max(1) as f32,
            self.control_changed
        )
    }
}

#[test]
#[ignore]
fn learning_bench() {
    let Ok(manifest) = std::env::var("FLO_LEARN_MANIFEST") else {
        eprintln!("set FLO_LEARN_MANIFEST (python3 scripts/learning-bench-clips.py makes the clips)");
        return;
    };
    let models_dir = crate::meeting_sim::data_dir().join("models");
    let clips: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(&manifest).unwrap()).unwrap();
    let s = Settings::default();
    for model in std::env::var("FLO_LEARN_MODELS").unwrap_or_else(|_| "small-q5_1".into()).split(',') {
        let path = stt::model_path(&models_dir, model).unwrap_or_else(|| std::path::PathBuf::from(model));
        assert!(path.exists(), "model {} isn't downloaded", path.display());
        let w = LocalWhisper::default();
        *w.auto_langs.lock() = stt::allowed_languages(&["en".to_string()]);
        w.warm(&path);
        let _ = w.transcribe(&path, &vec![0.0; 16_000], "en", "");
        let (mut base, mut screen, mut prompt, mut both, mut replay) = (Score::default(), Score::default(), Score::default(), Score::default(), Score::default());
        let mut extract_us = vec![];
        let mut correct_us = vec![];
        let db = Db::open_in_memory().unwrap();
        let mut raws = vec![];
        println!("\n== {model} ==");
        for c in &clips {
            let name = c["name"].as_str().unwrap();
            let expect = c["text"].as_str().unwrap();
            let screen_text = c["screen"].as_str().unwrap();
            let terms: Vec<String> = c["terms"].as_array().unwrap().iter().map(|t| t.as_str().unwrap().to_string()).collect();
            let mut audio = vec![0.0f32; 4_000];
            audio.extend(read_wav(c["wav"].as_str().unwrap()));
            audio.extend(vec![0.0f32; 6_400]);
            let raw = w.dictate(&path, &audio, "en", "").unwrap_or_default();
            // the bench that put dictionary words in Whisper's prompt: screen terms there instead
            let t = extract_terms(screen_text, MAX_SCREEN_TERMS);
            let prompt_words: Vec<String> = t.iter().filter(|t| t.kind != TermKind::Code).take(20).map(|t| t.text.clone()).collect();
            let raw_prompted = w.dictate(&path, &audio, "en", &crate::dictation::stt_prompt(&prompt_words, "")).unwrap_or_default();

            let plain = finish(&raw, &TermSet::new(), &[]);
            let t0 = Instant::now();
            let terms_on_screen = extract_terms(screen_text, MAX_SCREEN_TERMS);
            extract_us.push(t0.elapsed().as_micros());
            let ctx = ScreenContext { app: "Slack".into(), terms: terms_on_screen, ..Default::default() };
            let t1 = Instant::now();
            let p = build(&s, "Slack", Some(&ctx), &[], &[], &[], None);
            let with_screen = finish(&raw, &p.terms, &[]);
            correct_us.push(t1.elapsed().as_micros());
            let prompted = finish(&raw_prompted, &TermSet::new(), &[]);

            base.add(expect, &terms, &plain);
            screen.add(expect, &terms, &with_screen);
            prompt.add(expect, &terms, &prompted);
            let prompted_fixed = finish(&raw_prompted, &p.terms, &[]);
            if terms.is_empty() && plain != prompted_fixed {
                both.control_changed += 1;
            }
            both.add(expect, &terms, &prompted_fixed);
            if terms.is_empty() && plain != with_screen {
                screen.control_changed += 1;
            }
            println!("{name:<10} raw    {raw:?}\n           screen {with_screen:?}");
            raws.push((expect.to_string(), terms, raw, plain));
        }
        // learned-edit replay: the user fixes Flo's output in two dictations; the third uses the fixes
        for round in 0..2 {
            for (expect, _, _, plain) in &raws {
                for (heard, corrected) in crate::text::detect_corrections(plain, plain, expect) {
                    let d = decide_edit(&db, &heard, &corrected, "Slack", false, &[]).unwrap();
                    if round == 1 {
                        assert!(matches!(d, EditDecision::Apply | EditDecision::Known), "{heard} → {corrected}: {d:?}");
                    }
                    if d == EditDecision::Apply {
                        db.add_dictionary(&heard, Some(&corrected)).unwrap();
                    }
                }
            }
        }
        let entries = db.list_dictionary_recent().unwrap();
        let dict: Vec<(String, String)> = entries.iter().filter_map(|d| d.replacement.clone().map(|r| (d.word.clone(), r))).collect();
        let words: Vec<String> = entries.iter().map(|d| d.replacement.clone().unwrap_or(d.word.clone())).collect();
        let p = build(&s, "Slack", None, &words, &[], &[], None);
        for (expect, terms, raw, plain) in &raws {
            let out = finish(raw, &p.terms, &dict);
            if terms.is_empty() && *plain != out {
                replay.control_changed += 1;
            }
            replay.add(expect, terms, &out);
        }
        println!("{}", base.line("baseline"));
        println!("{}", prompt.line("screen words in prompt"));
        println!("{}", screen.line("screen correction"));
        println!("{}", both.line("prompt + correction"));
        println!("{}", replay.line("learned-edit replay"));
        println!("learned fixes: {dict:?}");
        let pct = |mut v: Vec<u128>, p: usize| {
            v.sort();
            v[(v.len() * p / 100).min(v.len() - 1)]
        };
        println!(
            "term extraction p50 {} µs max {} µs   correction step (build + correct + cleanup) p50 {} µs max {} µs",
            pct(extract_us.clone(), 50),
            pct(extract_us, 100),
            pct(correct_us.clone(), 50),
            pct(correct_us.clone(), 100)
        );
        assert!(screen.wer <= base.wer + 1e-6, "screen correction made things worse");
        assert_eq!(screen.control_changed, 0, "false corrections on control clips");
        assert!(pct(correct_us, 100) < 30_000, "correction step over 30 ms");
    }
}
