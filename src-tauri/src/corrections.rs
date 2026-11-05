//! Learn from the user's fixes: after Flo pastes, watch the focused field for ~30 s; if the user
//! changes a word Flo typed into a similar word ("tory" → "Tauri"), offer it as a dictionary entry.
use crate::model::{ev, CorrectionEvent};
use crate::state::Shared;
use crate::{platform, text};
use std::time::Duration;

pub fn track(st: Shared, pasted: String, app: String) {
    if !st.settings().learn_corrections || pasted.split_whitespace().count() < 1 {
        return;
    }
    std::thread::Builder::new()
        .name("flo-learn".into())
        .spawn(move || {
            std::thread::sleep(Duration::from_millis(450));
            let Some((field, before)) = platform::focused_text() else { return };
            // only fields that actually contain what we pasted
            let first: Vec<&str> = pasted.split_whitespace().take(3).collect();
            if !first.iter().all(|w| before.contains(w.trim_matches(|c: char| !c.is_alphanumeric()))) {
                return;
            }
            let mut last = before.clone();
            let mut stable = 0;
            for _ in 0..24 {
                std::thread::sleep(Duration::from_millis(1250));
                if st.session.lock().is_some() {
                    break; // a new dictation started
                }
                match platform::focused_text() {
                    Some((id, now)) if id == field => {
                        if now != last {
                            last = now;
                            stable = 0;
                        } else if last != before {
                            stable += 1;
                            if stable >= 2 {
                                break; // edits settled
                            }
                        }
                    }
                    _ => break, // focus moved away — use what we saw last
                }
            }
            if last == before {
                return;
            }
            for (heard, corrected) in text::detect_corrections(&pasted, &before, &last) {
                st.emit(ev::CORRECTION, CorrectionEvent { id: crate::db::new_id(), heard, corrected, app: app.clone() });
            }
        })
        .ok();
}
