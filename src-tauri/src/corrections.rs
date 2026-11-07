//! Learn from the user's fixes: after Flo pastes, watch the focused field for ~45 s; if the user
//! changes a word Flo typed into a similar word ("tory" → "Tauri"), save it to the dictionary
//! straight away and tell them in the notch (with Undo).
//!
//! The field is often sent and cleared right after the fix (Enter in Slack), so we keep the last
//! snapshot that still holds what Flo typed and compare against that, not the emptied field.
use crate::model::{ev, CorrectionEvent};
use crate::state::Shared;
use crate::{platform, text};
use std::time::Duration;

/// Does the field still hold (most of) what Flo typed? Half the dictated words present.
pub fn holds_paste(pasted: &str, field: &str) -> bool {
    let norm = |w: &str| w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase();
    let words: Vec<String> = pasted.split_whitespace().map(norm).filter(|w| !w.is_empty()).collect();
    if words.is_empty() {
        return false;
    }
    let have: std::collections::HashSet<String> = field.split_whitespace().map(norm).collect();
    let hits = words.iter().filter(|w| have.contains(*w)).count();
    hits * 2 >= words.len()
}

/// Save "heard → corrected" to the dictionary (replacing an older entry for the same word).
pub fn save(st: &Shared, heard: &str, corrected: &str) -> anyhow::Result<()> {
    let existing = st.db.list_dictionary()?;
    for d in existing.iter().filter(|d| d.word.eq_ignore_ascii_case(heard)) {
        st.db.remove_dictionary(&d.id)?;
    }
    st.db.add_dictionary(heard, Some(corrected))?;
    Ok(())
}

/// Undo a learned correction (the notch's Undo).
pub fn undo(st: &Shared, heard: &str, corrected: &str) -> anyhow::Result<()> {
    for d in st.db.list_dictionary()? {
        if d.word.eq_ignore_ascii_case(heard) && d.replacement.as_deref().map(|r| r == corrected).unwrap_or(true) {
            st.db.remove_dictionary(&d.id)?;
        }
    }
    Ok(())
}

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
            // last snapshot that still holds the dictation (what we compare against)
            let mut good = before.clone();
            let mut stable = 0;
            for _ in 0..36 {
                std::thread::sleep(Duration::from_millis(1250));
                if st.session.lock().is_some() {
                    break; // a new dictation started
                }
                match platform::focused_text() {
                    Some((id, now)) if id == field => {
                        if now != last {
                            last = now.clone();
                            stable = 0;
                            if holds_paste(&pasted, &now) {
                                good = now;
                            } else {
                                break; // sent / cleared / rewritten — keep the last good snapshot
                            }
                        } else if good != before {
                            stable += 1;
                            if stable >= 3 {
                                break; // edits settled
                            }
                        }
                    }
                    _ => break, // focus moved away — use the last good snapshot
                }
            }
            if good == before {
                return;
            }
            for (heard, corrected) in text::detect_corrections(&pasted, &before, &good) {
                let saved = match save(&st, &heard, &corrected) {
                    Ok(()) => true,
                    Err(e) => {
                        log::warn!("save correction {heard} → {corrected}: {e}");
                        false
                    }
                };
                log::info!("learned correction {heard:?} → {corrected:?} in {app} (saved={saved})");
                st.emit(ev::CORRECTION, CorrectionEvent { id: crate::db::new_id(), heard, corrected, app: app.clone(), saved });
            }
        })
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_when_the_field_was_sent_or_cleared() {
        let pasted = "Can you deploy the tory app to staging today";
        assert!(holds_paste(pasted, "Can you deploy the Tauri app to staging today"));
        assert!(holds_paste(pasted, "Hey team, can you deploy the Tauri app to staging today?"));
        assert!(!holds_paste(pasted, "")); // Enter in Slack empties the field
        assert!(!holds_paste(pasted, "lunch?")); // focus is now a different message
    }
}
