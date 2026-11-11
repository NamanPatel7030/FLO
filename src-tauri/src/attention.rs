//! Attention: periodically reads the focused window (on-device OCR, screenshots never saved),
//! keeps only NEW text, and asks the (local by default) LLM for actionable to-dos.
use crate::egress::Purpose;
use crate::llm::{self, ChatRequest, LlmConfig};
use crate::model::*;
use crate::state::Shared;
use crate::capture::{self, CaptureLevel};
use crate::{platform, prompts, text};
use std::sync::atomic::Ordering;
use std::time::Duration;

/// Capture the focused window → (app, title, text). OCR on macOS; None elsewhere.
pub fn capture_focused_text() -> Option<(String, String, String)> {
    let windows = xcap::Window::all().ok()?;
    let me = std::process::id();
    let w = windows.into_iter().find(|w| {
        w.is_focused().unwrap_or(false) && !w.is_minimized().unwrap_or(false) && w.pid().map(|p| p != me).unwrap_or(true)
    })?;
    let app = w.app_name().unwrap_or_default();
    let title = w.title().unwrap_or_default();
    if !platform::has_native_ocr() {
        return None;
    }
    let img = w.capture_image().ok()?;
    let (iw, ih) = (img.width(), img.height());
    if iw < 50 || ih < 50 {
        return None;
    }
    let text = platform::ocr(img.as_raw(), iw, ih)?;
    Some((app, title, text))
}

/// Can Attention use the configured AI model? None = yes, Some(reason) = no (so don't even capture).
pub fn blocked_reason(s: &crate::model::Settings) -> Option<String> {
    let cfg = LlmConfig::from_settings(s);
    if !cfg.is_configured() {
        return Some("Pick an AI model in Settings → AI to find to-dos on screen.".into());
    }
    if crate::settings::is_cloud_llm(&s.llm_provider) && !s.attention_cloud_allowed {
        return Some("Attention keeps screen text on this Mac. Use a local model (Ollama / LM Studio), or allow “Attention may use cloud AI” in Privacy.".into());
    }
    None
}

/// Focused window as a compact JPEG (longest side ≤ `max_side`) → (app, base64). For "Go deeper".
pub fn capture_focused_jpeg(max_side: u32) -> Option<(String, String)> {
    use base64::Engine;
    use xcap::image::{codecs::jpeg::JpegEncoder, DynamicImage};
    let me = std::process::id();
    let w = xcap::Window::all().ok()?.into_iter().find(|w| {
        w.is_focused().unwrap_or(false) && !w.is_minimized().unwrap_or(false) && w.pid().map(|p| p != me).unwrap_or(true)
    })?;
    let app = w.app_name().unwrap_or_default();
    let img = DynamicImage::ImageRgba8(w.capture_image().ok()?);
    let img = if img.width().max(img.height()) > max_side { img.resize(max_side, max_side, xcap::image::imageops::FilterType::Triangle) } else { img };
    let rgb = img.to_rgb8();
    let mut buf = Vec::new();
    JpegEncoder::new_with_quality(&mut buf, 72).encode_image(&rgb).ok()?;
    Some((app, base64::engine::general_purpose::STANDARD.encode(buf)))
}

pub fn status(st: &Shared) -> AttentionStatus {
    let mut s = st.attention.lock().clone();
    let settings = st.settings();
    s.blocked = if settings.attention_enabled { blocked_reason(&settings) } else { None };
    s.enabled = st.settings().attention_enabled;
    s.paused = st.attention_paused.load(Ordering::SeqCst);
    s.captures_today = st.attention_captures.load(Ordering::SeqCst);
    s
}

fn denied(app: &str, denylist: &[String]) -> bool {
    let a = app.to_lowercase();
    a.is_empty() || crate::capture::is_flo_window(app, "") || a.contains("flo flow") || denylist.iter().any(|d| !d.trim().is_empty() && a.contains(&d.to_lowercase()))
}

pub fn spawn(st: Shared) {
    tauri::async_runtime::spawn(async move {
        let mut last_day = chrono::Local::now().date_naive();
        loop {
            let s = st.settings();
            let interval = s.attention_interval_sec.clamp(5, 600);
            tokio::time::sleep(Duration::from_secs(interval)).await;
            let today = chrono::Local::now().date_naive();
            if today != last_day {
                st.attention_captures.store(0, Ordering::SeqCst);
                last_day = today;
            }
            if !s.attention_enabled || st.attention_paused.load(Ordering::SeqCst) || st.session.lock().is_some() {
                continue;
            }
            // no usable model → don't read the screen at all (and don't spam blocked calls)
            if blocked_reason(&s).is_some() {
                continue;
            }
            if !platform::permissions().screen {
                continue;
            }
            let front = platform::frontmost_app();
            if denied(&front.name, &s.attention_denylist) {
                continue;
            }
            let Ok(Some((app, title, screen))) = tokio::task::spawn_blocking(capture_focused_text).await else { continue };
            if denied(&app, &s.attention_denylist) || capture::is_flo_window(&app, &title) {
                continue;
            }
            st.attention_captures.fetch_add(1, Ordering::SeqCst);
            {
                let mut a = st.attention.lock();
                a.last_capture_at = Some(chrono::Local::now().to_rfc3339());
                a.last_app = Some(app.clone());
            }
            if let Err(e) = process(&st, &app, &title, &screen).await {
                log::warn!("attention: {e:#}");
            }
        }
    });
}

async fn process(st: &Shared, app: &str, title: &str, screen: &str) -> anyhow::Result<()> {
    let key = format!("{app}::{title}");
    let prev = st.db.last_snapshot(&key)?.unwrap_or_default();
    st.db.save_snapshot(&key, app, screen)?;
    let fresh = text::new_lines(&prev, screen);
    let fresh_text = fresh.join("\n");
    if fresh_text.len() < 20 {
        return Ok(());
    }
    let s = st.settings();
    if !text::attention_prefilter(&fresh_text, &s.user_name) {
        return Ok(());
    }
    let cfgl = LlmConfig::from_settings(&s);
    if !cfgl.is_configured() {
        return Ok(());
    }
    let system = prompts::attention_system(&s.user_name, &chrono::Local::now().format("%Y-%m-%d (%A)").to_string());
    // at most one AI call per app every 90 s
    {
        static LAST: parking_lot::Mutex<Option<std::collections::HashMap<String, std::time::Instant>>> = parking_lot::Mutex::new(None);
        let mut g = LAST.lock();
        let map = g.get_or_insert_with(Default::default);
        if map.get(app).map(|t| t.elapsed() < Duration::from_secs(90)).unwrap_or(false) {
            return Ok(());
        }
        map.insert(app.to_string(), std::time::Instant::now());
    }
    // a little of the rest of the window, so the model can tell a direct ask from a busy channel
    let rest: Vec<&str> = screen.lines().map(str::trim).filter(|l| !l.is_empty() && !fresh.iter().any(|f| f == l)).collect();
    let user = prompts::attention_user(app, title, &fresh_text, &rest.join("\n"));
    let raw = llm::chat(
        &st.egress,
        &cfgl,
        ChatRequest {
            system: &system,
            user: &user,
            image_b64: None,
            json: true,
            purpose: Purpose::Attention,
            cloud_allowed: s.attention_cloud_allowed,
            max_tokens: 700,
        },
    )
    .await?;
    // the model grades; the user's Task capture level decides, with fixed thresholds (capture.rs)
    let level = CaptureLevel::parse(&s.task_capture);
    let found = prompts::parse_attention(&raw, 0.0);
    if found.is_empty() {
        return Ok(());
    }
    let now = chrono::Utc::now().timestamp();
    let room = RATE.lock().room(now, level);
    let existing = st.db.capture_seen_titles()?;
    let candidates = found.len();
    let picked = capture::select(found, level, &existing, room);
    log::info!("attention: task capture {} kept {} of {candidates} from {app}", level.as_str(), picked.len());
    if picked.is_empty() {
        return Ok(());
    }
    RATE.lock().record(now, picked.len());
    for t in picked {
        let todo = Todo {
            id: crate::db::new_id(),
            title: t.title.clone(),
            reason: t.reason,
            person: t.person.filter(|p| !p.is_empty() && p != "null"),
            app: Some(app.to_string()),
            source: "attention".into(),
            status: "open".into(),
            due: t.due.filter(|d| d.len() == 10),
            confidence: t.confidence,
            created_at: chrono::Local::now().to_rfc3339(),
            ..Default::default()
        };
        st.db.insert_todo(&todo)?;
        st.toast("info", format!("New to-do from {app}: {}", t.title));
    }
    st.emit(ev::TODOS, ());
    Ok(())
}

/// To-dos Attention added in the last hour (Task capture's hourly limit).
static RATE: parking_lot::Mutex<capture::RateWindow> = parking_lot::Mutex::new(capture::RateWindow::new());

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocked_when_cloud_model_not_allowed() {
        let mut s = crate::model::Settings::default();
        s.llm_provider = "anthropic".into();
        s.attention_cloud_allowed = false;
        assert!(blocked_reason(&s).is_some());
        s.attention_cloud_allowed = true;
        assert!(blocked_reason(&s).is_none());
        s.llm_provider = "ollama".into();
        s.attention_cloud_allowed = false;
        assert!(blocked_reason(&s).is_none());
    }

    #[test]
    fn denylist_and_self() {
        let d = vec!["1Password".to_string()];
        assert!(denied("1Password 8", &d));
        assert!(denied("Flo Flow", &d));
        assert!(denied("", &d));
        assert!(!denied("Slack", &d));
    }
}
