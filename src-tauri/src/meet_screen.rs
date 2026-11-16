//! Reads the meeting app's window while someone on the call talks, to see *who* is talking
//! (the "speaking" indicator / the spotlighted tile). Feeds `speaker_names::LiveNames`.
//!
//! Privacy: runs only during a meeting the user is recording, only while the call track has
//! speech, at most every `SAMPLE_EVERY` (1.5 s); reads accessibility text of the meeting app
//! (Zoom / Teams / the browser tab with Meet) and falls back to on-device OCR (macOS Vision) of
//! that one window, only with Screen Recording permission and never for apps on the Attention
//! denylist. Only the extracted participant name is kept; no image or text is stored or sent.
use crate::speaker_names::{self, OcrLine, ScreenObs};
use std::time::Duration;

pub const SAMPLE_EVERY: Duration = Duration::from_millis(1500);
/// OCR is heavier than AX: at most this often.
pub const OCR_EVERY: Duration = Duration::from_millis(3000);

/// Apps that host calls (process / window name fragments, lowercase).
const MEETING_APPS: &[&str] = &["zoom.us", "zoom", "microsoft teams", "teams", "webex", "slack", "facetime", "discord", "whereby"];
const BROWSERS: &[&str] = &["google chrome", "chrome", "arc", "safari", "microsoft edge", "brave browser", "firefox", "dia"];
const MEETING_TITLES: &[&str] = &["meet -", "meet.google.com", "google meet", "zoom meeting", "zoom", "teams", "huddle", "webex", "whereby"];

/// Is this window (app name, title) a meeting window worth reading?
pub fn is_meeting_window(app: &str, title: &str) -> bool {
    let (a, t) = (app.to_lowercase(), title.to_lowercase());
    if MEETING_APPS.iter().any(|m| a == *m || a.starts_with(m)) {
        // Slack / Teams main windows aren't calls: the huddle / meeting window has a telling title
        return !(a.starts_with("slack") && !t.contains("huddle"));
    }
    BROWSERS.iter().any(|b| a == *b || a.starts_with(b)) && MEETING_TITLES.iter().any(|m| t.contains(m))
}

/// Attention denylist check (same rule as attention.rs: case-insensitive substring).
pub fn denied(app: &str, denylist: &[String]) -> bool {
    let a = app.to_lowercase();
    a.is_empty() || denylist.iter().any(|d| !d.trim().is_empty() && a.contains(&d.trim().to_lowercase()))
}

/// What one look at the meeting window gave.
#[derive(Debug, Clone, Default)]
#[allow(dead_code)] // app / title: for logs and future per-app parsing
pub struct Snapshot {
    pub app: String,
    pub title: String,
    pub ax_strings: Vec<String>,
    pub ocr: Vec<OcrLine>,
}

/// The largest visible meeting window (not Flo's own, not denylisted): its accessibility strings,
/// and (with `allow_ocr` and Screen Recording permission) an OCR pass over it.
pub fn snapshot(allow_ocr: bool, denylist: &[String]) -> Option<Snapshot> {
    let me = std::process::id();
    let w = xcap::Window::all()
        .ok()?
        .into_iter()
        .filter(|w| !w.is_minimized().unwrap_or(true) && w.pid().map(|p| p != me).unwrap_or(false))
        .filter(|w| {
            let (a, t) = (w.app_name().unwrap_or_default(), w.title().unwrap_or_default());
            is_meeting_window(&a, &t) && !denied(&a, denylist) && !crate::capture::is_flo_window(&a, &t)
        })
        .max_by_key(|w| w.width().unwrap_or(0) as u64 * w.height().unwrap_or(0) as u64)?;
    let app = w.app_name().unwrap_or_default();
    let title = w.title().unwrap_or_default();
    #[cfg(target_os = "macos")]
    let ax_strings = crate::platform::window_ax_strings(w.pid().unwrap_or(0) as i32, &title);
    #[cfg(not(target_os = "macos"))]
    let ax_strings: Vec<String> = vec![];
    #[allow(unused_mut)]
    let mut ocr = vec![];
    #[cfg(target_os = "macos")]
    if allow_ocr && speaker_names::active_from_ax(&ax_strings, &[]).is_none() {
        if let Ok(img) = w.capture_image() {
            let (iw, ih) = (img.width(), img.height());
            if iw >= 200 && ih >= 150 {
                ocr = crate::platform::ocr_lines(img.as_raw(), iw, ih).into_iter().map(|(text, x, y, w, h)| OcrLine { text, x, y, w, h }).collect();
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = allow_ocr;
    Some(Snapshot { app, title, ax_strings, ocr })
}

/// One reading: who the meeting window shows as speaking right now.
pub fn read_active(candidates: &[String], denylist: &[String], allow_ocr: bool) -> Option<(String, f32)> {
    let w = snapshot(allow_ocr, denylist)?;
    if let Some(a) = speaker_names::active_from_ax(&w.ax_strings, candidates) {
        return Some(a);
    }
    // names in the AX tree (participant list / tile labels) widen the candidate set for OCR
    let mut cands = candidates.to_vec();
    if cands.is_empty() {
        for s in &w.ax_strings {
            if let Some(n) = speaker_names::clean_display_name(s) {
                if n.split_whitespace().count() >= 2 && !cands.contains(&n) {
                    cands.push(n);
                }
            }
        }
    }
    let lines: Vec<OcrLine> = w.ocr;
    speaker_names::active_from_ocr(&lines, &cands)
}

/// The sampler loop: every `SAMPLE_EVERY` while `call_speaking()` says the call track has speech.
pub async fn run(
    names: std::sync::Arc<parking_lot::Mutex<speaker_names::LiveNames>>,
    started: std::time::Instant,
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    call_speaking: std::sync::Arc<std::sync::atomic::AtomicBool>,
    denylist: Vec<String>,
) {
    use std::sync::atomic::Ordering;
    let mut last_ocr = std::time::Instant::now() - OCR_EVERY;
    let mut misses = 0u32;
    while !stop.load(Ordering::SeqCst) {
        tokio::time::sleep(SAMPLE_EVERY).await;
        if !call_speaking.load(Ordering::SeqCst) {
            continue;
        }
        let allow_ocr = last_ocr.elapsed() >= OCR_EVERY && crate::platform::permissions().screen;
        if allow_ocr {
            last_ocr = std::time::Instant::now();
        }
        let cands = names.lock().attendees.clone();
        let dl = denylist.clone();
        let t = started.elapsed().as_secs_f64();
        let got = tokio::task::spawn_blocking(move || read_active(&cands, &dl, allow_ocr)).await.ok().flatten();
        match got {
            Some((name, weight)) => {
                misses = 0;
                names.lock().add_obs(ScreenObs { t, name, weight });
            }
            None => {
                misses += 1;
                // nothing readable for a minute of call speech: slow down (no meeting window)
                if misses > 40 {
                    tokio::time::sleep(Duration::from_secs(10)).await;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn meeting_windows() {
        assert!(is_meeting_window("zoom.us", "Zoom Meeting"));
        assert!(is_meeting_window("Microsoft Teams", "Weekly sync | Microsoft Teams"));
        assert!(is_meeting_window("Google Chrome", "Meet - abc-defg-hij"));
        assert!(is_meeting_window("Arc", "Google Meet"));
        assert!(!is_meeting_window("Google Chrome", "Inbox - Gmail"));
        assert!(!is_meeting_window("Slack", "general - Acme"));
        assert!(is_meeting_window("Slack", "Huddle: design"));
        assert!(!is_meeting_window("Xcode", "Meet - x"));
    }

    #[test]
    fn denylist_is_respected() {
        let d = vec!["1Password".to_string(), "zoom".to_string()];
        assert!(denied("zoom.us", &d));
        assert!(!denied("Google Chrome", &d));
        assert!(denied("", &d));
    }
}
