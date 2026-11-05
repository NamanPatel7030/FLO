//! End-to-end self test of the real pipeline, run inside the installed app (so it has Flo's
//! keychain + model access):  open -n -a Flo.app --args --selftest /path/report.json
//!
//! speech (macOS `say`) → 16 kHz → configured STT → cleanup gate → (LLM only if needed) → report
//! with transcripts, similarity to the expected text, latency and tokens per call.
use crate::egress::{Egress, Purpose};
use crate::llm::{self, ChatRequest, LlmConfig};
use crate::{intents, prompts, settings, stt, text};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Instant;

struct Case {
    spoken: &'static str,
    expect: &'static str,
}

const CASES: &[Case] = &[
    Case { spoken: "Send the deck to Rahul by Friday.", expect: "Send the deck to Rahul by Friday." },
    Case { spoken: "Um, so, let's meet at five, no wait, six tomorrow.", expect: "Let's meet at six tomorrow." },
    Case { spoken: "I think the the new build is really fast and the notch looks great.", expect: "I think the new build is really fast and the notch looks great." },
];

fn tts_to_16k(text_in: &str, dir: &Path, name: &str) -> anyhow::Result<Vec<f32>> {
    let aiff = dir.join(format!("{name}.aiff"));
    let wav = dir.join(format!("{name}.wav"));
    let ok = std::process::Command::new("say").arg("-o").arg(&aiff).arg(text_in).status()?.success();
    anyhow::ensure!(ok, "say failed");
    let ok = std::process::Command::new("afconvert")
        .args(["-f", "WAVE", "-d", "LEI16@16000", "-c", "1"])
        .arg(&aiff)
        .arg(&wav)
        .status()?
        .success();
    anyhow::ensure!(ok, "afconvert failed");
    let mut r = hound::WavReader::open(&wav)?;
    Ok(r.samples::<i16>().filter_map(|s| s.ok()).map(|s| s as f32 / i16::MAX as f32).collect())
}

async fn transcribe(eg: &Egress, s: &crate::model::Settings, models: &Path, w: &stt::LocalWhisper, samples: Vec<f32>) -> anyhow::Result<String> {
    let samples = crate::audio::trim_silence(&samples);
    if s.stt_provider == "local" {
        let path = stt::model_path(models, &s.stt_model).ok_or_else(|| anyhow::anyhow!("unknown model"))?;
        w.transcribe(&path, &samples, &s.language, "")
    } else {
        let key = crate::secrets::get_api_key(&s.stt_provider).ok_or_else(|| anyhow::anyhow!("no STT key"))?;
        stt::transcribe_cloud(eg, &s.stt_provider, &s.stt_model, &key, &samples, &s.language, "").await
    }
}

pub fn run(out: &str) {
    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("runtime");
    let report = rt.block_on(run_async());
    let _ = std::fs::write(out, serde_json::to_string_pretty(&report).unwrap_or_default());
}

async fn run_async() -> Value {
    let data_dir: PathBuf = dirs::data_dir().unwrap_or_default().join("com.flo.flow");
    let s = settings::load(&data_dir);
    let models = data_dir.join("models");
    let eg = Egress::new();
    let whisper = stt::LocalWhisper::default();
    let cfg = LlmConfig::from_settings(&s);
    let tmp = std::env::temp_dir().join(format!("flo-selftest-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&tmp);
    let mut cases = vec![];

    for (i, c) in CASES.iter().enumerate() {
        let mut row = json!({ "spoken": c.spoken });
        let audio = match tts_to_16k(c.spoken, &tmp, &format!("c{i}")) {
            Ok(a) => a,
            Err(e) => {
                row["error"] = json!(format!("tts: {e}"));
                cases.push(row);
                continue;
            }
        };
        let t0 = Instant::now();
        match transcribe(&eg, &s, &models, &whisper, audio).await {
            Ok(raw) => {
                row["stt_ms"] = json!(t0.elapsed().as_millis());
                row["raw"] = json!(raw);
                let gated = text::needs_llm_cleanup(&raw);
                row["llm_cleanup_needed"] = json!(gated);
                let t1 = Instant::now();
                let final_text = if gated && cfg.is_configured() {
                    let system = prompts::cleanup_system("Notes", &[]);
                    let req = ChatRequest {
                        system: &system,
                        user: &raw,
                        image_b64: None,
                        json: false,
                        purpose: Purpose::Cleanup,
                        cloud_allowed: settings::is_cloud_llm(&s.llm_provider),
                        max_tokens: (text::word_count(&raw) * 2 + 40).min(2000),
                    };
                    match llm::chat(&eg, &cfg, req).await {
                        Ok(o) => text::strip_llm_wrapping(&o),
                        Err(e) => {
                            row["cleanup_error"] = json!(e.to_string());
                            text::basic_cleanup(&raw)
                        }
                    }
                } else {
                    text::basic_cleanup(&raw)
                };
                row["cleanup_ms"] = json!(t1.elapsed().as_millis());
                row["final"] = json!(final_text);
                row["expected"] = json!(c.expect);
                row["similarity"] = json!((text::similarity(&final_text, c.expect) * 100.0).round() / 100.0);
            }
            Err(e) => row["error"] = json!(format!("stt: {e}")),
        }
        cases.push(row);
    }

    // quick commands: no AI, no tokens
    let intents_ok: Vec<Value> = ["open Slack", "google flo dictation app", "play lofi on youtube", "add a to-do to Apollo"]
        .iter()
        .map(|q| json!({ "query": q, "local": intents::parse(q).map(|i| i.reply) }))
        .collect();

    // one small assistant round-trip
    let mut assistant = json!({});
    if cfg.is_configured() {
        let t = Instant::now();
        let system = prompts::assistant_system("Today: test\nProjects:\n- Apollo [active]\n    • Send deck (due 2026-11-07)\n");
        let r = llm::chat(
            &eg,
            &cfg,
            ChatRequest {
                system: &system,
                user: "What's open on Apollo?",
                image_b64: None,
                json: true,
                purpose: Purpose::Assistant,
                cloud_allowed: s.assistant_cloud_allowed,
                max_tokens: 600,
            },
        )
        .await;
        assistant = match r {
            Ok(raw) => {
                let p = prompts::parse_assistant(&raw);
                json!({ "ms": t.elapsed().as_millis(), "reply": p.reply, "actions": p.actions.len() })
            }
            Err(e) => json!({ "error": e.to_string() }),
        };
    }

    let calls: Vec<Value> = eg
        .entries()
        .into_iter()
        .map(|e| json!({ "host": e.host, "purpose": e.purpose, "allowed": e.allowed, "tokens_in": e.tokens_in, "tokens_out": e.tokens_out }))
        .collect();
    let (tin, tout) = eg.entries().iter().fold((0u64, 0u64), |a, e| (a.0 + e.tokens_in.unwrap_or(0), a.1 + e.tokens_out.unwrap_or(0)));
    let _ = std::fs::remove_dir_all(&tmp);
    json!({
        "stt": format!("{} / {}", s.stt_provider, s.stt_model),
        "llm": format!("{} / {}", s.llm_provider, s.llm_model),
        "cases": cases,
        "intents": intents_ok,
        "assistant": assistant,
        "ai_calls": calls,
        "tokens_total": { "in": tin, "out": tout },
    })
}
