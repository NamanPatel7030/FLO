//! Voice computer-control agent. Given a goal ("open Chrome, search YouTube for lofi, play the
//! first video"), Flo loops: screenshot the screen → ask a vision model for the single next action
//! → perform it (open app/url, click, type, key, scroll) → repeat, until done or aborted.
//!
//! Safety: the user triggers it by voice; it runs on the configured BYOK cloud vision model (needs
//! `assistant_cloud_allowed`); it is capped at a number of steps; the user can abort any time; and
//! the model is told to STOP and ask before anything irreversible or outward-facing (send, post,
//! buy, delete). Everything it does, the user could do by hand.
use crate::egress::Purpose;
use crate::llm::{self, ChatRequest, LlmConfig};
use crate::model::ev;
use crate::state::Shared;
use crate::{platform, settings as cfg, text};
use anyhow::{anyhow, bail, Result};
use base64::Engine;
use serde_json::json;
use std::sync::atomic::Ordering;

const MAX_STEPS: usize = 14;
const IMG_MAX_W: u32 = 1366;

fn system_prompt() -> String {
    r#"You control a macOS computer to accomplish the user's GOAL, like a person using the mouse and keyboard. Each turn you are given a screenshot of the whole screen (its pixel size is stated) and the actions taken so far. Reply with ONE next action as a single JSON object, nothing else:
{"action":"open_app","name":"Safari"}
{"action":"open_url","url":"https://youtube.com/results?search_query=lofi"}
{"action":"click","x":<px>,"y":<px>,"what":"the first video thumbnail"}
{"action":"double_click","x":<px>,"y":<px>,"what":"..."}
{"action":"type","text":"lofi beats"}            // types wherever the cursor is
{"action":"key","name":"return"}                  // return|tab|space|escape|up|down|left|right|pagedown|pageup; add "cmd":true/"shift"/"alt"/"ctrl"
{"action":"scroll","dy":-4}                        // negative scrolls down
{"action":"wait","ms":800}
{"action":"done","summary":"Playing the lofi video."}
{"action":"confirm","summary":"About to send the email to Rahul — confirm?"}  // REQUIRED before anything that sends/posts/buys/deletes or is hard to undo

Rules:
- x,y are pixel coordinates IN THE PROVIDED SCREENSHOT (top-left origin). Aim for the centre of the target.
- Prefer open_url over clicking when a direct URL exists (e.g. a YouTube search). Prefer open_app to launch apps.
- Do ONE thing per turn; you will see the result in the next screenshot. Use wait after navigation.
- NEVER do anything irreversible or outward-facing (send a message, post, pay, delete, change settings) without first returning a "confirm" action and waiting.
- When the goal is achieved, return "done". Output only the JSON."#.to_string()
}

struct Shot {
    b64: String,
    img_w: u32,
    img_h: u32,
    screen_w: f64,
    screen_h: f64,
}

fn capture() -> Result<Shot> {
    let mons = xcap::Monitor::all().map_err(|e| anyhow!("screen: {e}"))?;
    let m = mons.iter().find(|m| m.is_primary().unwrap_or(false)).or_else(|| mons.first()).ok_or_else(|| anyhow!("no display"))?;
    let scale = m.scale_factor().unwrap_or(2.0).max(1.0) as f64;
    let img = xcap::image::DynamicImage::ImageRgba8(m.capture_image().map_err(|e| anyhow!("capture: {e}"))?);
    let (pw, ph) = (img.width(), img.height());
    let img = if pw > IMG_MAX_W { img.resize(IMG_MAX_W, IMG_MAX_W * ph / pw, xcap::image::imageops::FilterType::Triangle) } else { img };
    let (iw, ih) = (img.width(), img.height());
    let mut buf = Vec::new();
    xcap::image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 70).encode_image(&img.to_rgb8()).map_err(|e| anyhow!("jpeg: {e}"))?;
    Ok(Shot {
        b64: base64::engine::general_purpose::STANDARD.encode(buf),
        img_w: iw,
        img_h: ih,
        screen_w: pw as f64 / scale,
        screen_h: ph as f64 / scale,
    })
}

fn emit(st: &Shared, kind: &str, text: &str) {
    st.emit(ev::AGENT, json!({ "kind": kind, "text": text }));
}

/// Run the agent toward `goal`. Returns a short result summary.
pub async fn run(st: &Shared, goal: &str) -> Result<String> {
    let s = st.settings();
    if !s.assistant_cloud_allowed || !cfg::is_cloud_llm(&s.llm_provider) {
        bail!("Screen control needs a cloud vision model. Pick OpenAI, Anthropic or Gemini in Settings → AI and allow cloud for the assistant.");
    }
    if !llm::supports_vision(&s.llm_provider) {
        bail!("Your AI provider can't see the screen. Use Anthropic, OpenAI or Gemini for screen control.");
    }
    let cfgl = LlmConfig::from_settings(&s);
    st.agent_abort.store(false, Ordering::SeqCst);
    emit(st, "start", goal);
    let mut history: Vec<String> = vec![];

    for step in 0..MAX_STEPS {
        if st.agent_abort.load(Ordering::SeqCst) {
            emit(st, "aborted", "Stopped.");
            return Ok("Stopped.".into());
        }
        let shot = tokio::task::spawn_blocking(capture).await??;
        let user = format!(
            "GOAL: {goal}\nScreenshot size: {}x{} px.\nActions so far:\n{}\n\nReturn the single next action as JSON.",
            shot.img_w,
            shot.img_h,
            if history.is_empty() { "(none)".into() } else { history.join("\n") }
        );
        let raw = llm::chat(
            &st.egress,
            &cfgl,
            ChatRequest {
                system: &system_prompt(),
                user: &user,
                image_b64: Some(("image/jpeg", &shot.b64)),
                json: true,
                purpose: Purpose::Assistant,
                cloud_allowed: true,
                max_tokens: 300,
            },
        )
        .await?;
        let v: serde_json::Value = text::extract_json_object(&raw).and_then(|j| serde_json::from_str(&j).ok()).ok_or_else(|| anyhow!("agent gave no action"))?;
        let action = v["action"].as_str().unwrap_or("done").to_string();
        let action = action.as_str();

        // map screenshot pixels → screen points
        let sx = |px: f64| px * shot.screen_w / shot.img_w as f64;
        let sy = |py: f64| py * shot.screen_h / shot.img_h as f64;

        match action {
            "done" => {
                let sum = v["summary"].as_str().unwrap_or("Done.").to_string();
                emit(st, "done", &sum);
                return Ok(sum);
            }
            "confirm" => {
                let q = v["summary"].as_str().unwrap_or("Confirm this step?").to_string();
                emit(st, "confirm", &q);
                // v1: stop and hand control back rather than act without explicit UI confirmation
                return Ok(format!("Paused: {q} (confirm actions aren't automated yet)"));
            }
            "open_app" => {
                let name = v["name"].as_str().unwrap_or_default();
                platform::open_app(name)?;
                history.push(format!("opened app {name}"));
                emit(st, "step", &format!("Opening {name}"));
            }
            "open_url" => {
                let url = v["url"].as_str().unwrap_or_default();
                let u = url::Url::parse(url)?;
                if !matches!(u.scheme(), "http" | "https") {
                    bail!("refused non-web url");
                }
                tauri_plugin_opener::open_url(u.as_str(), None::<&str>)?;
                history.push(format!("opened {url}"));
                emit(st, "step", &format!("Opening {}", u.host_str().unwrap_or("page")));
            }
            "click" | "double_click" => {
                let (x, y) = (sx(v["x"].as_f64().unwrap_or(0.0)), sy(v["y"].as_f64().unwrap_or(0.0)));
                let what = v["what"].as_str().unwrap_or("").to_string();
                let dbl = action == "double_click";
                let wl = what.clone();
                tokio::task::spawn_blocking(move || platform::click_at(x, y, dbl)).await??;
                let what = wl;
                history.push(format!("clicked {what}"));
                emit(st, "step", &format!("Clicking {what}"));
            }
            "type" => {
                let t = v["text"].as_str().unwrap_or("").to_string();
                let tt = t.clone();
                tokio::task::spawn_blocking(move || platform::type_text(&tt)).await??;
                history.push(format!("typed \"{}\"", text::truncate_chars(&t, 40)));
                emit(st, "step", &format!("Typing “{}”", text::truncate_chars(&t, 40)));
            }
            "key" => {
                let name = v["name"].as_str().unwrap_or_default().to_string();
                let code = platform::keycode_for(&name).ok_or_else(|| anyhow!("unknown key {name}"))?;
                let (c, sh, al, ct) = (v["cmd"].as_bool().unwrap_or(false), v["shift"].as_bool().unwrap_or(false), v["alt"].as_bool().unwrap_or(false), v["ctrl"].as_bool().unwrap_or(false));
                tokio::task::spawn_blocking(move || platform::key_press(code, c, sh, al, ct)).await??;
                history.push(format!("pressed {name}"));
                emit(st, "step", &format!("Pressing {name}"));
            }
            "scroll" => {
                let dy = v["dy"].as_i64().unwrap_or(-3) as i32;
                tokio::task::spawn_blocking(move || platform::scroll_by(dy)).await??;
                history.push("scrolled".into());
            }
            "wait" => {
                let ms = v["ms"].as_u64().unwrap_or(600).min(4000);
                tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
            }
            other => bail!("unknown action {other}"),
        }
        let _ = step;
        tokio::time::sleep(std::time::Duration::from_millis(550)).await;
    }
    emit(st, "done", "Reached the step limit.");
    Ok("Reached the step limit; stopping.".into())
}
