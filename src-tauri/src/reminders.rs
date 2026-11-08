//! To-do reminders: a notification fires 5 minutes before a to-do's due time (the 5-minute lead
//! is baked into `remind_at` when the due time is set). Checks every 30 s. macOS uses a native
//! notification; the notch also shows it. Snooze from the notch re-arms the reminder.
use crate::model::{ev, ToastEvent};
use crate::state::Shared;

#[cfg(target_os = "macos")]
pub(crate) fn notify(title: &str, body: &str) {
    // escape double quotes for AppleScript
    let esc = |s: &str| s.replace('\\', "").replace('"', "'");
    let script = format!("display notification \"{}\" with title \"Flo\" subtitle \"{}\"", esc(body), esc(title));
    let _ = std::process::Command::new("osascript").arg("-e").arg(script).spawn();
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn notify(_title: &str, _body: &str) {}

pub fn spawn(st: Shared) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            let due = match st.db.due_reminders() {
                Ok(d) => d,
                Err(e) => {
                    log::warn!("reminders: {e}");
                    continue;
                }
            };
            for t in due {
                let _ = st.db.mark_reminded(&t.id);
                let when = t.due.as_deref().and_then(friendly_time).unwrap_or_default();
                let body = if when.is_empty() { t.title.clone() } else { format!("{} · due {when}", t.title) };
                if st.settings().system_notifications {
                    notify("Reminder", &body);
                }
                // also surface it in the app + notch
                st.emit(ev::TOAST, ToastEvent { kind: "info".into(), text: format!("Reminder: {body}") });
                st.emit(ev::REMINDER, &t);
            }
        }
    });
}

/// "due 3:00 PM" style time from an RFC3339 string.
fn friendly_time(due: &str) -> Option<String> {
    let t = chrono::DateTime::parse_from_rfc3339(due).ok()?;
    Some(t.format("%-I:%M %p").to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn formats_time() {
        assert_eq!(friendly_time("2026-11-06T15:05:00+05:30").as_deref(), Some("3:05 PM"));
        assert!(friendly_time("not-a-date").is_none());
    }
}
