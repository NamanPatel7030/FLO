//! The assistant's screen eval: realistic questions about saved screens (`tests/screen_eval`:
//! billing and pricing pages, an error, an email thread, Slack, Jira, a dashboard, an invoice,
//! code, a form, a long log and a canvas app), asked the way people ask them ("how many credits
//! are left", "who sent the last message", "kitne credits bache hain"), plus a few questions that
//! aren't about the screen.
//!
//! It compares the assistant before this change (the keyword gate, OCR text cut to 2,000
//! characters, no spoken follow-ups) with now, through the same prompt code the app uses
//! (`screen_ctx`, `assistant::core_system`):
//! * offline, always: is the answer in what the model is given (the screen text, the screenshot,
//!   the earlier turn), and is the reply language right? No network.
//! * live, opt-in: asks the real model both prompts and grades the replies by substring, with
//!   latency. `FLO_EVAL_LIVE=1 ANTHROPIC_API_KEY=… cargo test --release --lib screen_eval -- --ignored --nocapture`
//!   (model: `FLO_EVAL_MODEL`, default claude-haiku-5-5). The key is only held in memory.
//!
//! Re-render the fixtures (screenshots + window text) with `node src-tauri/tests/screen_eval/render.mjs`.
#![cfg(test)]

use crate::assistant;
use crate::screen_ctx::{self, ScreenSnap};
use crate::{prompts, text};
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Deserialize, Clone)]
struct Screen {
    id: String,
    app: String,
    title: String,
    url: String,
}

#[derive(Deserialize, Clone)]
struct Case {
    id: String,
    screen: String,
    q: String,
    expect: Vec<String>,
    #[serde(default)]
    forbid: Vec<String>,
    #[serde(default)]
    lang: Option<String>,
    #[serde(default)]
    thread: Vec<(String, String)>,
    #[serde(default)]
    visual: bool,
    #[serde(default)]
    general: bool,
    #[serde(default)]
    insert: bool,
}

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/screen_eval")
}

fn load() -> (Vec<Screen>, Vec<Case>) {
    let screens: Vec<Screen> = serde_json::from_str(&std::fs::read_to_string(dir().join("screens.json")).unwrap()).unwrap();
    let cases: Vec<Case> = serde_json::from_str(&std::fs::read_to_string(dir().join("cases.json")).unwrap()).unwrap();
    (screens, cases)
}

fn read(rel: &str) -> String {
    std::fs::read_to_string(dir().join(rel)).unwrap_or_default()
}

fn png_b64(id: &str) -> Option<String> {
    use base64::Engine;
    std::fs::read(dir().join(format!("png/{id}.png"))).ok().map(|b| base64::engine::general_purpose::STANDARD.encode(b))
}

/// What `screen_ctx::capture` produces for this window: accessibility text, or OCR (with the
/// screenshot taken for it) when accessibility says too little.
fn snapshot(s: &Screen) -> ScreenSnap {
    let ax = read(&format!("ax/{}.txt", s.id));
    let mut jpeg = None;
    let (text, source) = screen_ctx::pick_text(&ax, || {
        jpeg = png_b64(&s.id);
        Some(read(&format!("ax/{}.ocr.txt", s.id)))
    })
    .unwrap_or_default();
    ScreenSnap { app: s.app.clone(), title: s.title.clone(), url: (!s.url.is_empty()).then(|| s.url.clone()), text, source, jpeg }
}

const TODAY: &str = "Today: 2026-11-23 10:00 (Monday)\n";

/// A prompt as the model receives it: system text, and the screenshot when one is attached.
struct Prompt {
    system: String,
    /// the screen part only (to grade recall without matching the rules' examples)
    screen: String,
    image: Option<String>,
}

/// The assistant now (quick mode, a vision model, the user's case: no projects yet).
fn prompt_now(s: &Screen, c: &Case) -> Prompt {
    let snap = snapshot(s);
    let drafting = text::is_writing_request(&c.q);
    let screen = (drafting || !screen_ctx::self_contained(&c.q)).then_some(&snap);
    let section = screen.map(|x| screen_ctx::screen_section(x, &c.q, screen_ctx::SCREEN_BUDGET)).unwrap_or_default();
    let context = format!("{TODAY}Focused app: {}\n\nProjects:\n(none yet)\n{section}", s.app);
    let system = assistant::core_system(&context, &c.q, "quick", screen.is_some(), drafting, &c.thread);
    let image = if drafting {
        png_b64(&s.id)
    } else if screen.is_some() && screen_ctx::want_screenshot(screen, &c.q, true) {
        snap.jpeg.clone().or_else(|| png_b64(&s.id))
    } else {
        None
    };
    Prompt { system, screen: section, image }
}

// ── the assistant before (0.1.10), kept here only to measure against ─────────────────────────────

fn legacy_is_writing(query: &str) -> bool {
    let q = format!(" {} ", query.to_lowercase());
    const CUES: &[&str] = &[
        " draft", " write", " compose", " reply", " respond", " rewrite", " rephrase", " polish", " message", " email", " e-mail", " mail ",
        " dm ", " wish", " congratulat", " caption", " tweet", " post ", " comment", " follow up", " follow-up", " tell them", " tell him",
        " tell her", " text him", " text her", " answer him", " answer her", " make it ", " make a message",
    ];
    CUES.iter().any(|c| q.contains(c))
}

fn legacy_wants_screen(query: &str) -> bool {
    if legacy_is_writing(query) {
        return true;
    }
    let q = format!(" {} ", query.to_lowercase());
    const CUES: &[&str] = &[
        " screen", " this ", " this?", " this.", " these ", " here", " above", " below", " reply", " respond", " answer this", " summari",
        " what does it", " what is this", " explain", " translate", " this email", " this message", " this page", " this doc",
        " on my screen", " that message", " that email", " what am i looking at", " what's this", " what is that", " this error",
        " this code", " fix this", " this chart", " this table", " in front of me", " visible",
    ];
    CUES.iter().any(|c| q.contains(c))
}

fn legacy_hinglish(query: &str) -> bool {
    const HINGLISH: &[&str] = &[
        "hai", "hain", "kya", "kyun", "kaise", "nahi", "nahin", "mujhe", "mera", "meri", "mere", "tum", "aap", "karo", "karna", "kar", "kal",
        "aaj", "abhi", "bhi", "batao", "bata", "chahiye", "kuch", "kaun", "kahan", "yaar", "accha", "acha", "theek", "haan", "matlab", "wala",
        "wali", "raha", "rahi", "hoga", "dena", "lena", "sab", "kitna", "kab", "ka", "ki", "ke", "ko", "mein",
    ];
    let words: Vec<String> = query.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(|w| w.to_lowercase()).collect();
    let hits = words.iter().filter(|w| HINGLISH.contains(&w.as_str())).count();
    hits >= 2 || (hits == 1 && words.len() <= 3)
}

fn prompt_before(s: &Screen, c: &Case) -> Prompt {
    // 0.1.10 read the window by OCR only (the visible pixels), and kept it only on a cue word
    let ocr = read(&format!("ax/{}.ocr.txt", s.id));
    let drafting = legacy_is_writing(&c.q);
    let section = if drafting || legacy_wants_screen(&c.q) {
        format!("\nVisible text on screen (OCR, may be noisy):\n\"\"\"\n{}\n\"\"\"\n", text::truncate_chars(&ocr, 2000))
    } else {
        String::new()
    };
    let context = format!("{TODAY}Focused app: {}\n\nProjects:\n(none yet)\n{section}", s.app);
    let mut system = prompts::assistant_system(&context);
    system.push_str(if legacy_hinglish(&c.q) {
        "\n\nReply language: the request is in Hinglish; reply in Hinglish (Hindi in Roman letters) unless it asks for another language."
    } else {
        "\n\nReply language: English, even when the request looks like another language (speech recognition sometimes mis-hears English as Finnish, Dutch, etc.); if it doesn't make sense, say so in English. Use another language only for text the user explicitly asks to be written or translated in it."
    });
    // spoken requests had no earlier turns
    if drafting {
        system.push_str(prompts::DRAFTING_NOTE);
    }
    Prompt { system, screen: section, image: drafting.then(|| png_b64(&s.id)).flatten() }
}

// ── grading ──────────────────────────────────────────────────────────────────────────────────────

fn norm(s: &str) -> String {
    s.to_lowercase().replace(['\u{a0}', '\u{202f}'], " ")
}

fn has_any(hay: &str, needles: &[String]) -> bool {
    let h = norm(hay);
    needles.iter().any(|n| h.contains(&norm(n)))
}

/// Offline: does the model get what it needs to answer? (None: not a screen question.)
fn recall(p: &Prompt, c: &Case) -> Option<bool> {
    if c.general {
        return None;
    }
    let mut ok = if c.visual { p.image.is_some() } else { has_any(&p.screen, &c.expect) };
    if let Some((q, _)) = c.thread.first() {
        ok &= p.system.contains(q.as_str());
    }
    // a question told it is a writing task gets a draft typed into the app instead of an answer
    ok &= c.insert || !p.system.contains("This is a WRITING task");
    Some(ok)
}

fn lang_ok(p: &Prompt, c: &Case) -> bool {
    match c.lang.as_deref() {
        Some("hinglish") => p.system.contains("reply in Hinglish"),
        _ => !p.system.contains("reply in Hinglish"),
    }
}

fn pct(n: usize, d: usize) -> String {
    if d == 0 {
        "-".into()
    } else {
        format!("{}/{} ({:.0}%)", n, d, 100.0 * n as f64 / d as f64)
    }
}

#[test]
fn every_case_has_its_screen_and_the_fixtures_are_whole() {
    let (screens, cases) = load();
    assert!(cases.len() >= 30, "{} cases", cases.len());
    for c in &cases {
        let s = screens.iter().find(|s| s.id == c.screen).unwrap_or_else(|| panic!("{}: no screen {}", c.id, c.screen));
        assert!(!read(&format!("ax/{}.txt", s.id)).is_empty() || !read(&format!("ax/{}.ocr.txt", s.id)).is_empty(), "{}", s.id);
        assert!(png_b64(&s.id).is_some(), "{}: no screenshot", s.id);
        assert!(c.general || !c.expect.is_empty() || c.insert, "{}: nothing to grade", c.id);
    }
}

/// The offline half runs with the normal tests: the answer must reach the model for every screen
/// question, in the right reply language.
#[test]
fn now_every_screen_answer_reaches_the_model() {
    let (screens, cases) = load();
    let mut misses = vec![];
    for c in &cases {
        let s = screens.iter().find(|s| s.id == c.screen).unwrap();
        let p = prompt_now(s, c);
        if recall(&p, c) == Some(false) || !lang_ok(&p, c) {
            misses.push(c.id.clone());
        }
        // plain arithmetic leaves the screen out; a writing request always has it
        if c.id == "math" {
            assert!(p.screen.is_empty(), "arithmetic doesn't need the screen");
        }
        if c.insert {
            assert!(!p.screen.is_empty() && p.image.is_some(), "a draft reads the screen");
        }
        assert!(p.screen.chars().count() <= screen_ctx::SCREEN_BUDGET + 600, "{}: screen part over budget", c.id);
    }
    assert!(misses.is_empty(), "the answer doesn't reach the model for: {misses:?}");
}

/// The report: before vs now, offline (and live with FLO_EVAL_LIVE=1). `--ignored --nocapture`.
#[test]
#[ignore]
fn screen_eval_report() {
    let (screens, cases) = load();
    let (mut rb, mut rn, mut lb, mut ln, mut screen_cases) = (0, 0, 0, 0, 0);
    let (mut chars_b, mut chars_n) = (0usize, 0usize);
    let mut assembly_us = vec![];
    println!("\n{:<24} {:<8} {:<8} {:>7} {:>7}  question", "case", "before", "now", "ctx-b", "ctx-n");
    for c in &cases {
        let s = screens.iter().find(|s| s.id == c.screen).unwrap();
        let pb = prompt_before(s, c);
        let t = std::time::Instant::now();
        let pn = prompt_now(s, c);
        assembly_us.push(t.elapsed().as_micros());
        let (b, n) = (recall(&pb, c), recall(&pn, c));
        if let (Some(b), Some(n)) = (b, n) {
            screen_cases += 1;
            rb += b as usize;
            rn += n as usize;
        }
        lb += lang_ok(&pb, c) as usize;
        ln += lang_ok(&pn, c) as usize;
        chars_b += pb.system.chars().count();
        chars_n += pn.system.chars().count();
        let mark = |r: Option<bool>| match r {
            Some(true) => "ok",
            Some(false) => "MISS",
            None => "-",
        };
        println!("{:<24} {:<8} {:<8} {:>7} {:>7}  {}", c.id, mark(b), mark(n), pb.system.chars().count(), pn.system.chars().count(), c.q);
    }
    assembly_us.sort();
    println!("\nOFFLINE (is the answer in what the model gets?)");
    println!("  screen recall   before {}   now {}", pct(rb, screen_cases), pct(rn, screen_cases));
    println!("  reply language  before {}   now {}", pct(lb, cases.len()), pct(ln, cases.len()));
    println!("  prompt size     before {} chars avg   now {} chars avg (~{} tokens)", chars_b / cases.len(), chars_n / cases.len(), chars_n / cases.len() / 4);
    println!("  context assembly (trim + prompt) p50 {} µs, max {} µs", assembly_us[assembly_us.len() / 2], assembly_us.last().unwrap());

    if std::env::var("FLO_EVAL_LIVE").as_deref() != Ok("1") {
        println!("\nLIVE: skipped (set FLO_EVAL_LIVE=1 and ANTHROPIC_API_KEY to ask the real model)");
        return;
    }
    let Ok(key) = std::env::var("ANTHROPIC_API_KEY") else {
        println!("\nLIVE: skipped (no ANTHROPIC_API_KEY in the environment)");
        return;
    };
    crate::secrets::use_key_for_tests("anthropic", key.trim());
    let model = std::env::var("FLO_EVAL_MODEL").unwrap_or_else(|_| "claude-haiku-5-5".into());
    let rt = tokio::runtime::Runtime::new().unwrap();
    let egress = crate::egress::Egress::new();
    let cfg = crate::llm::LlmConfig { provider: "anthropic".into(), model: model.clone(), local_url: String::new() };
    let ask = |p: &Prompt, q: &str| -> (Result<String, String>, u128) {
        let t = std::time::Instant::now();
        let r = rt.block_on(crate::llm::chat_ex(
            &egress,
            &cfg,
            crate::llm::ChatRequest {
                system: &p.system,
                user: q,
                image_b64: p.image.as_deref().map(|b| ("image/png", b)),
                json: true,
                purpose: crate::egress::Purpose::Assistant,
                cloud_allowed: true,
                max_tokens: 600,
            },
            crate::llm::Extras::default(),
        ));
        (r.map(|(t, _)| t).map_err(|e| format!("{e:#}")), t.elapsed().as_millis())
    };
    let grade = |raw: &str, c: &Case| -> bool {
        let parsed = prompts::parse_assistant(raw);
        if c.insert {
            return parsed.actions.iter().any(|a| matches!(a, crate::model::AssistantAction::InsertText { .. }));
        }
        let typed: String = parsed.actions.iter().filter_map(|a| match a {
            crate::model::AssistantAction::InsertText { text } => Some(text.as_str()),
            _ => None,
        }).collect();
        let all = format!("{} {typed}", parsed.reply);
        has_any(&all, &c.expect) && !has_any(&all, &c.forbid)
    };
    println!("\nLIVE ({model})");
    let (mut ok_b, mut ok_n) = (0, 0);
    let (mut lat_b, mut lat_n) = (vec![], vec![]);
    for c in &cases {
        let s = screens.iter().find(|s| s.id == c.screen).unwrap();
        let (rb, tb) = ask(&prompt_before(s, c), &c.q);
        let (rn, tn) = ask(&prompt_now(s, c), &c.q);
        let gb = rb.as_deref().map(|r| grade(r, c)).unwrap_or(false);
        let gn = rn.as_deref().map(|r| grade(r, c)).unwrap_or(false);
        ok_b += gb as usize;
        ok_n += gn as usize;
        lat_b.push(tb);
        lat_n.push(tn);
        let reply = |r: &Result<String, String>| match r {
            Ok(raw) => text::truncate_chars(&prompts::parse_assistant(raw).reply.replace('\n', " "), 90),
            Err(e) => format!("ERROR {}", text::truncate_chars(e, 80)),
        };
        println!("{:<24} before {:<4} {:>5} ms | now {:<4} {:>5} ms | {}", c.id, if gb { "ok" } else { "FAIL" }, tb, if gn { "ok" } else { "FAIL" }, tn, reply(&rn));
        if !gb {
            println!("{:<24}   before said: {}", "", reply(&rb));
        }
    }
    let p = |v: &mut Vec<u128>, q: f64| {
        v.sort();
        v[((v.len() as f64 - 1.0) * q).round() as usize]
    };
    println!("\n  answer accuracy  before {}   now {}", pct(ok_b, cases.len()), pct(ok_n, cases.len()));
    println!("  model latency    before p50 {} ms p95 {} ms   now p50 {} ms p95 {} ms", p(&mut lat_b, 0.5), p(&mut lat_b, 0.95), p(&mut lat_n, 0.5), p(&mut lat_n, 0.95));
}
