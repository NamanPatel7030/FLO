//! Pure text utilities (no I/O) — heavily unit tested.
use std::collections::HashSet;

pub fn word_count(s: &str) -> u32 {
    s.split_whitespace().filter(|w| w.chars().any(|c| c.is_alphanumeric())).count() as u32
}

/// Apply personal-dictionary replacements, case-insensitive, whole-word.
/// `entries`: (heard_as, replacement). Entries without replacement are only used as STT hints.
pub fn apply_dictionary(text: &str, entries: &[(String, String)]) -> String {
    let mut out = text.to_string();
    for (from, to) in entries {
        if from.trim().is_empty() {
            continue;
        }
        out = replace_whole_word_ci(&out, from, to);
    }
    out
}

fn replace_whole_word_ci(hay: &str, needle: &str, rep: &str) -> String {
    let lower_hay = hay.to_lowercase();
    let lower_needle = needle.to_lowercase();
    // Only safe when lowercasing doesn't change byte lengths (ASCII / most scripts).
    if lower_hay.len() != hay.len() {
        return hay.replace(needle, rep);
    }
    let mut out = String::with_capacity(hay.len());
    let mut i = 0;
    let bytes = hay.as_bytes();
    while let Some(pos) = lower_hay[i..].find(&lower_needle) {
        let start = i + pos;
        let end = start + needle.len();
        let before_ok = start == 0 || !is_word_byte(bytes[start - 1]);
        let after_ok = end >= bytes.len() || !is_word_byte(bytes[end]);
        out.push_str(&hay[i..start]);
        if before_ok && after_ok {
            out.push_str(rep);
        } else {
            out.push_str(&hay[start..end]);
        }
        i = end;
    }
    out.push_str(&hay[i..]);
    out
}

fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

const FILLERS: &[&str] = &["um", "uh", "erm", "uhm", "hmm", "mm"];

/// Rule-based cleanup used when no LLM is configured (or it fails).
pub fn basic_cleanup(raw: &str) -> String {
    let mut words: Vec<String> = Vec::new();
    for w in raw.split_whitespace() {
        let bare: String = w.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase();
        if FILLERS.contains(&bare.as_str()) {
            // keep trailing punctuation of the filler on the previous word
            continue;
        }
        // collapse immediate repeats ("the the")
        if let Some(prev) = words.last() {
            if prev.to_lowercase() == w.to_lowercase() && w.chars().all(|c| c.is_alphabetic()) {
                continue;
            }
        }
        words.push(w.to_string());
    }
    let mut s = words.join(" ");
    s = s.replace(" ,", ",").replace(",,", ",").replace(" .", ".");
    let s = s.trim().trim_start_matches(|c: char| c == ',' || c == ' ').to_string();
    let mut chars = s.chars();
    match chars.next() {
        Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

/// Strip common LLM wrappers: code fences, "Here is…:" preambles, surrounding quotes.
pub fn strip_llm_wrapping(s: &str) -> String {
    let mut t = s.trim().to_string();
    if t.starts_with("```") {
        t = t.trim_start_matches("```").to_string();
        if let Some(nl) = t.find('\n') {
            t = t[nl + 1..].to_string();
        }
        t = t.trim_end().trim_end_matches("```").trim().to_string();
    }
    // remove <think>…</think> blocks emitted by reasoning models
    while let (Some(a), Some(b)) = (t.find("<think>"), t.find("</think>")) {
        if b > a {
            t = format!("{}{}", &t[..a], &t[b + 8..]).trim().to_string();
        } else {
            break;
        }
    }
    if t.len() >= 2 && t.starts_with('"') && t.ends_with('"') && t.matches('"').count() == 2 {
        t = t[1..t.len() - 1].to_string();
    }
    t
}

/// Find the first balanced top-level JSON object in `s`.
pub fn extract_json_object(s: &str) -> Option<String> {
    let s = strip_llm_wrapping(s);
    let bytes = s.as_bytes();
    let start = s.find('{')?;
    let mut depth = 0i32;
    let mut in_str = false;
    let mut esc = false;
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        if in_str {
            if esc {
                esc = false;
            } else if b == b'\\' {
                esc = true;
            } else if b == b'"' {
                in_str = false;
            }
            continue;
        }
        match b {
            b'"' => in_str = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(s[start..=i].to_string());
                }
            }
            _ => {}
        }
    }
    None
}

fn tokens(s: &str) -> HashSet<String> {
    const STOP: &[&str] = &["the", "a", "an", "to", "for", "of", "and", "on", "in", "about", "with", "my", "me", "is"];
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() > 1 && !STOP.contains(w))
        .map(|w| w.to_string())
        .collect()
}

/// Jaccard similarity of content tokens, 0..1.
pub fn similarity(a: &str, b: &str) -> f64 {
    let (ta, tb) = (tokens(a), tokens(b));
    if ta.is_empty() || tb.is_empty() {
        return 0.0;
    }
    let inter = ta.intersection(&tb).count() as f64;
    let uni = ta.union(&tb).count() as f64;
    inter / uni
}

pub fn is_duplicate_todo(new_title: &str, existing: &[String]) -> bool {
    existing.iter().any(|e| similarity(new_title, e) >= 0.6)
}

/// Lines in `current` that weren't in `previous` (trimmed, non-trivial).
pub fn new_lines(previous: &str, current: &str) -> Vec<String> {
    let prev: HashSet<&str> = previous.lines().map(|l| l.trim()).collect();
    let mut seen = HashSet::new();
    current
        .lines()
        .map(|l| l.trim())
        .filter(|l| l.chars().filter(|c| c.is_alphanumeric()).count() >= 4)
        .filter(|l| !prev.contains(l))
        .filter(|l| seen.insert(*l))
        .map(|l| l.to_string())
        .collect()
}

/// Cheap local signal that screen text might contain something actionable for the user.
pub fn attention_prefilter(text: &str, user_name: &str) -> bool {
    let t = text.to_lowercase();
    const CUES: &[&str] = &[
        "can you", "could you", "would you", "please", "pls", "asap", "eod", "by tomorrow", "by monday",
        "by friday", "deadline", "due ", "reminder", "follow up", "follow-up", "waiting for", "let me know",
        "any update", "review", "approve", "send me", "?", "@", "invoice", "meeting at", "call at",
        "kal", "karna", "bhejo", "jaldi",
    ];
    if !user_name.trim().is_empty() && t.contains(&user_name.to_lowercase()) {
        return true;
    }
    CUES.iter().any(|c| t.contains(c))
}

/// Pick the best matching item for a fuzzy spoken reference ("the deck one").
pub fn best_match<'a>(query: &str, candidates: &'a [(String, String)]) -> Option<&'a (String, String)> {
    let q = query.to_lowercase();
    let mut best: Option<(&(String, String), f64)> = None;
    for c in candidates {
        let name = c.1.to_lowercase();
        let mut score = similarity(&q, &name);
        if name.contains(&q) || q.contains(&name) {
            score += 0.5;
        }
        if score > best.map(|b| b.1).unwrap_or(0.0) {
            best = Some((c, score));
        }
    }
    best.filter(|b| b.1 >= 0.25).map(|b| b.0)
}

pub fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut t: String = s.chars().take(max.saturating_sub(1)).collect();
        t.push('…');
        t
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_words() {
        assert_eq!(word_count("Hello, world — it's me"), 4);
        assert_eq!(word_count("   "), 0);
    }

    #[test]
    fn dictionary_whole_word_case_insensitive() {
        let d = vec![("flo flow".to_string(), "Flo Flow".to_string()), ("tory".into(), "Tauri".into())];
        assert_eq!(apply_dictionary("I built flo flow with tory", &d), "I built Flo Flow with Tauri");
        assert_eq!(apply_dictionary("history", &d), "history");
    }

    #[test]
    fn cleanup_removes_fillers_and_repeats() {
        assert_eq!(basic_cleanup("um so the the plan is uh ready"), "So the plan is ready");
        assert_eq!(basic_cleanup(""), "");
    }

    #[test]
    fn strips_wrapping() {
        assert_eq!(strip_llm_wrapping("```\nhello\n```"), "hello");
        assert_eq!(strip_llm_wrapping("<think>hmm</think>Hi there"), "Hi there");
        assert_eq!(strip_llm_wrapping("\"quoted\""), "quoted");
    }

    #[test]
    fn extracts_json_from_prose() {
        let s = "Sure! ```json\n{\"reply\":\"ok {x}\",\"actions\":[{\"type\":\"stop_meeting\"}]}\n``` done";
        let j = extract_json_object(s).unwrap();
        let v: serde_json::Value = serde_json::from_str(&j).unwrap();
        assert_eq!(v["reply"], "ok {x}");
        assert!(extract_json_object("no json here").is_none());
    }

    #[test]
    fn dedups_similar_todos() {
        let existing = vec!["Reply to Rahul about the invoice".to_string()];
        assert!(is_duplicate_todo("reply to Rahul about invoice", &existing));
        assert!(!is_duplicate_todo("Book flights to Goa", &existing));
    }

    #[test]
    fn new_lines_only() {
        let a = "Inbox\nHi there\n";
        let b = "Inbox\nHi there\nCan you send the deck by Friday?\nok\n";
        assert_eq!(new_lines(a, b), vec!["Can you send the deck by Friday?".to_string()]);
    }

    #[test]
    fn prefilter_detects_requests() {
        assert!(attention_prefilter("Hey, can you review the PR?", ""));
        assert!(attention_prefilter("Parth the build is green", "Parth"));
        assert!(!attention_prefilter("Weather today sunny", "Parth"));
    }

    #[test]
    fn fuzzy_best_match() {
        let c = vec![
            ("1".to_string(), "Send the deck to Apollo".to_string()),
            ("2".to_string(), "Pay electricity bill".to_string()),
        ];
        assert_eq!(best_match("the deck", &c).unwrap().0, "1");
        assert!(best_match("zebra", &c).is_none());
    }

    #[test]
    fn truncates() {
        assert_eq!(truncate_chars("abcdef", 4), "abc…");
        assert_eq!(truncate_chars("abc", 4), "abc");
    }
}
