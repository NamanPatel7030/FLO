//! Attention: periodically reads the focused window (on-device OCR, screenshots never saved),
//! keeps only NEW text, and asks the (local by default) LLM for actionable to-dos.
use crate::egress::Purpose;
use crate::llm::{self, ChatRequest, LlmConfig};
use crate::model::*;
use crate::state::Shared;
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

pub fn status(st: &Shared) -> AttentionStatus {
    let mut s = st.attention.lock().clone();
    s.enabled = st.settings().attention_enabled;
    s.paused = st.attention_paused.load(Ordering::SeqCst);
    s.captures_today = st.attention_captures.load(Ordering::SeqCst);
    s
}

fn denied(app: &str, denylist: &[String]) -> bool {
    let a = app.to_lowercase();
    a.is_empty() || a.contains("flo flow") || a == "flo-flow" || denylist.iter().any(|d| !d.trim().is_empty() && a.contains(&d.to_lowercase()))
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
            if !platform::permissions().screen {
                continue;
            }
            let front = platform::frontmost_app();
            if denied(&front.name, &s.attention_denylist) {
                continue;
            }
            let Ok(Some((app, title, screen))) = tokio::task::spawn_blocking(capture_focused_text).await else { continue };
            if denied(&app, &s.attention_denylist) {
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
    let user = format!("App: {app}\nWindow: {title}\nNew text on screen:\n{}", text::truncate_chars(&fresh_text, 6000));
    let raw = llm::chat(
        &st.egress,
        &cfgl,
        ChatRequest { system: &system, user: &user, image_b64: None, json: true, purpose: Purpose::Attention, cloud_allowed: s.attention_cloud_allowed },
    )
    .await?;
    let found = prompts::parse_attention(&raw, 0.6);
    if found.is_empty() {
        return Ok(());
    }
    let mut existing = st.db.open_todo_titles()?;
    let mut added = 0;
    for t in found.into_iter().take(5) {
        if text::is_duplicate_todo(&t.title, &existing) {
            continue;
        }
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
        existing.push(t.title.clone());
        added += 1;
        st.toast("info", format!("New to-do from {app}: {}", t.title));
    }
    if added > 0 {
        st.emit(ev::TODOS, ());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn denylist_and_self() {
        let d = vec!["1Password".to_string()];
        assert!(denied("1Password 8", &d));
        assert!(denied("Flo Flow", &d));
        assert!(denied("", &d));
        assert!(!denied("Slack", &d));
    }
}
