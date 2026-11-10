//! Learn from the user's fixes: after Flo pastes, watch the focused field for ~45 s; if the user
//! changes a word Flo typed into a similar word ("tory" → "Tauri"), save it to the dictionary
//! straight away and tell them in the notch (with Undo). The dictionary is then applied to every
//! later dictation (final step, after AI cleanup), and its words bias the speech model and the
//! cleanup prompt, so the same mistake doesn't come back.
//!
//! The field is often sent and cleared right after the fix (Enter in Slack), so we compare
//! against the last snapshot that still holds what Flo typed — and only one the user had finished
//! typing (seen unchanged on two polls in a row), so a half-typed "Tau" is never learned.
use crate::model::{ev, CorrectionEvent, DictionaryEntry};
use crate::state::Shared;
use crate::{platform, text};
use std::time::{Duration, Instant};

/// Poll interval while watching the field (an accessibility read costs well under a millisecond).
const POLL: Duration = Duration::from_millis(250);
/// How long we watch at most after a paste.
const WATCH_FOR: Duration = Duration::from_secs(45);
/// Polls without a change after an edit before we call the edit finished (~3 s).
const SETTLE_POLLS: u32 = 12;

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

#[derive(Debug, PartialEq, Eq)]
pub enum Step {
    Continue,
    Stop,
}

/// Follows the field's content after a paste and decides which snapshot to learn from.
pub struct Watcher {
    pasted: String,
    before: String,
    /// latest snapshot that still holds the paste
    last: String,
    /// latest snapshot seen unchanged on two polls in a row (the user had stopped typing)
    settled: String,
    idle: u32,
}

impl Watcher {
    pub fn new(pasted: &str, before: &str) -> Self {
        Self { pasted: pasted.into(), before: before.into(), last: before.into(), settled: before.into(), idle: 0 }
    }

    /// Feed the next read of the focused field (`None`: focus moved / unreadable).
    pub fn observe(&mut self, now: Option<&str>) -> Step {
        let Some(now) = now else { return Step::Stop };
        if now != self.last {
            if !holds_paste(&self.pasted, now) {
                return Step::Stop; // sent / cleared / rewritten: keep what we had
            }
            self.last = now.to_string();
            self.idle = 0;
            return Step::Continue;
        }
        self.idle += 1;
        self.settled = self.last.clone();
        if self.settled != self.before && self.idle >= SETTLE_POLLS {
            return Step::Stop;
        }
        Step::Continue
    }

    /// The fixes to learn. Normally from the settled snapshot; if the user was still typing more of
    /// it when they hit Enter (the newest snapshot only grew from the settled one), the newest one.
    pub fn corrections(&self) -> Vec<(String, String)> {
        let text = if self.last != self.settled && grew(&self.settled, &self.last) { &self.last } else { &self.settled };
        if *text == self.before {
            return vec![];
        }
        text::detect_corrections(&self.pasted, &self.before, text)
    }
}

/// Is `b` just `a` with more text typed at one spot?
fn grew(a: &str, b: &str) -> bool {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    if b.len() <= a.len() {
        return false;
    }
    let p = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let q = a[p..].iter().rev().zip(b[p..].iter().rev()).take_while(|(x, y)| x == y).count();
    p + q >= a.len()
}

/// What saving "heard → corrected" does to the dictionary: (entry ids to remove, add the pair?).
/// If one of the user's own rules produced the word they just fixed back ("flow" → "Flo", then
/// "Flo" → "flow"), that rule goes and no reverse rule is added.
pub fn plan_save(existing: &[DictionaryEntry], heard: &str, corrected: &str) -> (Vec<String>, bool) {
    let eq = |a: &str, b: &str| a.trim().to_lowercase() == b.trim().to_lowercase();
    if existing.iter().any(|d| eq(&d.word, heard) && d.replacement.as_deref().map(str::trim) == Some(corrected.trim())) {
        return (vec![], false);
    }
    let conflicts: Vec<String> =
        existing.iter().filter(|d| eq(&d.word, corrected) && d.replacement.as_deref().map(|r| eq(r, heard)).unwrap_or(false)).map(|d| d.id.clone()).collect();
    if !conflicts.is_empty() {
        return (conflicts, false);
    }
    (existing.iter().filter(|d| eq(&d.word, heard)).map(|d| d.id.clone()).collect(), true)
}

/// Save "heard → corrected" to the dictionary (replacing an older entry for the same word).
pub fn save(st: &Shared, heard: &str, corrected: &str) -> anyhow::Result<()> {
    let (remove, add) = plan_save(&st.db.list_dictionary()?, heard, corrected);
    for id in remove {
        st.db.remove_dictionary(&id)?;
    }
    if add {
        st.db.add_dictionary(heard, Some(corrected))?;
    }
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
            // the paste lands asynchronously (and Electron/Chrome build their accessibility tree on
            // first ask), so give the field a few tries to show what we typed
            let mut first = None;
            for wait in [450u64, 400, 600, 800] {
                std::thread::sleep(Duration::from_millis(wait));
                if let Some((id, now)) = platform::focused_text() {
                    if holds_paste(&pasted, &now) {
                        first = Some((id, now));
                        break;
                    }
                }
            }
            // not readable (password field, app without accessibility text) or not where we pasted
            let Some((field, before)) = first else { return };
            let mut w = Watcher::new(&pasted, &before);
            let t0 = Instant::now();
            while t0.elapsed() < WATCH_FOR {
                std::thread::sleep(POLL);
                if st.session.lock().is_some() {
                    break; // a new dictation started
                }
                let now = platform::focused_text().filter(|(id, _)| *id == field).map(|(_, v)| v);
                if w.observe(now.as_deref()) == Step::Stop {
                    break;
                }
            }
            for (heard, corrected) in w.corrections() {
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

    fn entry(id: &str, w: &str, r: &str) -> DictionaryEntry {
        DictionaryEntry { id: id.into(), word: w.into(), replacement: Some(r.into()) }
    }

    #[test]
    fn saving_replaces_same_word_and_drops_the_rule_that_caused_the_mistake() {
        let existing = vec![entry("1", "Tory", "Tory app"), entry("2", "flow", "Flo"), entry("3", "naman", "Naman")];
        // a new fix for the same heard word replaces the old one
        assert_eq!(plan_save(&existing, "tory", "Tauri"), (vec!["1".to_string()], true));
        // Flo typed "Flo" because of rule flow→Flo and the user changed it back: drop that rule,
        // don't add the reverse (it would turn every "Flo" into "flow")
        assert_eq!(plan_save(&existing, "Flo", "flow"), (vec!["2".to_string()], false));
        // already known: nothing to do
        assert_eq!(plan_save(&existing, "naman", "Naman"), (vec![], false));
    }

    #[test]
    fn learns_from_the_finished_word_not_a_half_typed_snapshot() {
        let pasted = "build it with tory today";
        let mut w = Watcher::new(pasted, pasted);
        // user selects "tory" and starts typing; pauses mid-word long enough to look settled
        for snap in ["build it with  today", "build it with Tau today", "build it with Tau today", "build it with Tauri today"] {
            assert_eq!(w.observe(Some(snap)), Step::Continue);
        }
        // then hits Enter (Slack empties the field) before another poll saw the finished word twice
        assert_eq!(w.observe(Some("")), Step::Stop);
        assert_eq!(w.corrections(), vec![("tory".to_string(), "Tauri".to_string())]);
    }

    #[test]
    fn learns_after_edits_settle_and_ignores_wipes_and_focus_changes() {
        let pasted = "ask Neman about the deck";
        let mut w = Watcher::new(pasted, pasted);
        w.observe(Some("ask Naman about the deck"));
        w.observe(Some("ask Naman about the deck"));
        let mut stopped = false;
        for _ in 0..40 {
            if w.observe(Some("ask Naman about the deck")) == Step::Stop {
                stopped = true;
                break;
            }
        }
        assert!(stopped, "stops once edits have settled");
        assert_eq!(w.corrections(), vec![("Neman".to_string(), "Naman".to_string())]);

        // the user deleted everything: nothing learned
        let mut w = Watcher::new(pasted, pasted);
        assert_eq!(w.observe(Some("")), Step::Stop);
        assert!(w.corrections().is_empty());
        // focus moved before any edit: nothing learned
        let mut w = Watcher::new(pasted, pasted);
        assert_eq!(w.observe(None), Step::Stop);
        assert!(w.corrections().is_empty());
    }
}
