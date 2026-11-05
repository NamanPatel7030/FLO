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

fn norm_word(w: &str) -> String {
    w.trim_matches(|c: char| !c.is_alphanumeric() && c != '\'' && c != '-').to_string()
}

pub fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut cur = vec![i; b.len() + 1];
        for j in 1..=b.len() {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            cur[j] = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
        }
        prev = cur;
    }
    prev[b.len()]
}

/// Looks like a spelling fix of the same word (not a rewrite)?
fn similar_word(a: &str, b: &str) -> bool {
    let (la, lb) = (a.to_lowercase(), b.to_lowercase());
    if la == lb {
        return a != b; // capitalisation fix ("tauri" → "Tauri")
    }
    let d = levenshtein(&la, &lb);
    let longest = la.chars().count().max(lb.chars().count());
    longest >= 3 && (d as f64 / longest as f64) <= 0.5 || (la.chars().next() == lb.chars().next() && d <= 3 && longest >= 4)
}

/// Words the user replaced in text Flo pasted. `before` = field content right after the paste,
/// `after` = content once the user edited it. Returns (heard, corrected) pairs.
pub fn detect_corrections(pasted: &str, before: &str, after: &str) -> Vec<(String, String)> {
    let pasted_words: std::collections::HashSet<String> = pasted.split_whitespace().map(|w| norm_word(w).to_lowercase()).collect();
    let a: Vec<String> = before.split_whitespace().map(norm_word).filter(|w| !w.is_empty()).collect();
    let b: Vec<String> = after.split_whitespace().map(norm_word).filter(|w| !w.is_empty()).collect();
    if a.is_empty() || b.is_empty() || a.len() > 3000 || b.len() > 3000 || a == b {
        return vec![];
    }
    // trim common prefix/suffix, then LCS on the middle
    let mut s = 0;
    while s < a.len() && s < b.len() && a[s] == b[s] {
        s += 1;
    }
    let mut e = 0;
    while e < a.len() - s && e < b.len() - s && a[a.len() - 1 - e] == b[b.len() - 1 - e] {
        e += 1;
    }
    let (am, bm) = (&a[s..a.len() - e], &b[s..b.len() - e]);
    if am.len() > 400 || bm.len() > 400 {
        return vec![];
    }
    let (n, m) = (am.len(), bm.len());
    let mut dp = vec![vec![0u16; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            dp[i][j] = if am[i] == bm[j] { dp[i + 1][j + 1] + 1 } else { dp[i + 1][j].max(dp[i][j + 1]) };
        }
    }
    // walk the diff; collect runs of (deleted, inserted)
    let (mut i, mut j) = (0, 0);
    let mut out: Vec<(String, String)> = vec![];
    let mut del: Vec<&String> = vec![];
    let mut ins: Vec<&String> = vec![];
    let flush = |del: &mut Vec<&String>, ins: &mut Vec<&String>, out: &mut Vec<(String, String)>| {
        if !del.is_empty() && del.len() == ins.len() && del.len() <= 2 {
            for (d, n) in del.iter().zip(ins.iter()) {
                if d != n && pasted_words.contains(&d.to_lowercase()) && similar_word(d, n) && !out.iter().any(|(h, _)| h == *d) {
                    out.push(((*d).clone(), (*n).clone()));
                }
            }
        }
        del.clear();
        ins.clear();
    };
    while i < n || j < m {
        if i < n && j < m && am[i] == bm[j] {
            flush(&mut del, &mut ins, &mut out);
            i += 1;
            j += 1;
        } else if j < m && (i == n || dp[i][j + 1] >= dp[i + 1][j]) {
            ins.push(&bm[j]);
            j += 1;
        } else {
            del.push(&am[i]);
            i += 1;
        }
    }
    flush(&mut del, &mut ins, &mut out);
    out.truncate(3);
    out
}

/// Does this transcript need LLM cleanup, or is the free local pass good enough?
/// LLM only for: fillers/self-corrections, spoken formatting, or long dictation.
pub fn needs_llm_cleanup(raw: &str) -> bool {
    let words = word_count(raw);
    if words < 4 {
        return false;
    }
    let t = format!(" {} ", raw.to_lowercase());
    const CUES: &[&str] = &[
        " um ", " uh ", " erm ", " like, ", " you know", " i mean", " sorry,", " no wait", " no, ", " actually, ",
        " scratch that", " new line", " new paragraph", " bullet", " number one", " comma ", " full stop", " period ",
        " question mark", " i mean,",
    ];
    if CUES.iter().any(|c| t.contains(c)) {
        return true;
    }
    // immediate repeats ("the the", "I I") = disfluent speech
    let ws: Vec<&str> = raw.split_whitespace().collect();
    if ws.windows(2).any(|p| p[0].eq_ignore_ascii_case(p[1]) && p[0].chars().all(|c| c.is_alphabetic())) {
        return true;
    }
    words > 40
}

/// Should the assistant see the screen for this request? (OCR text is the biggest prompt cost.)
pub fn wants_screen_context(query: &str) -> bool {
    let q = format!(" {} ", query.to_lowercase());
    const CUES: &[&str] = &[
        " screen", " this ", " this?", " this.", " these ", " here", " above", " below", " reply", " respond",
        " answer this", " summari", " what does it", " what is this", " explain", " translate", " this email",
        " this message", " this page", " this doc", " on my screen", " that message", " that email",
    ];
    CUES.iter().any(|c| q.contains(c))
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
    fn detects_spelling_fixes_in_pasted_text() {
        let pasted = "I built it with tory and rust";
        let before = "Notes: I built it with tory and rust. Thanks";
        let after = "Notes: I built it with Tauri and rust. Thanks";
        assert_eq!(detect_corrections(pasted, before, after), vec![("tory".to_string(), "Tauri".to_string())]);
        // capitalisation-only fix counts
        assert_eq!(detect_corrections("call naman", "call naman", "call Naman"), vec![("naman".into(), "Naman".into())]);
    }

    #[test]
    fn ignores_rewrites_and_untouched_text() {
        // completely different word → a rewrite, not a mishearing
        assert!(detect_corrections("send the deck", "send the deck", "send the invoice").is_empty());
        // edits outside what Flo pasted are ignored
        assert!(detect_corrections("hello there", "Dear Jhon, hello there", "Dear John, hello there").is_empty());
        assert!(detect_corrections("same", "same", "same").is_empty());
        // added words aren't corrections
        assert!(detect_corrections("ship it", "ship it", "ship it today").is_empty());
    }

    #[test]
    fn levenshtein_basics() {
        assert_eq!(levenshtein("tory", "tauri"), 3);
        assert_eq!(levenshtein("", "ab"), 2);
    }

    #[test]
    fn cleanup_gate_saves_tokens() {
        assert!(!needs_llm_cleanup("Send the deck to Rahul by Friday."));
        assert!(!needs_llm_cleanup("ok"));
        assert!(needs_llm_cleanup("um so send the deck to Rahul"));
        assert!(needs_llm_cleanup("meet at 5 no wait 6 tomorrow"));
        assert!(needs_llm_cleanup("first point new line second point"));
        assert!(needs_llm_cleanup("I I think we should ship"));
        assert!(needs_llm_cleanup(&"word ".repeat(45)));
    }

    #[test]
    fn screen_context_only_when_relevant() {
        assert!(wants_screen_context("reply to this saying I'll join"));
        assert!(wants_screen_context("what's on my screen"));
        assert!(!wants_screen_context("add a to-do to Apollo: send the deck"));
        assert!(!wants_screen_context("what's blocked across my projects"));
    }

    #[test]
    fn truncates() {
        assert_eq!(truncate_chars("abcdef", 4), "abc…");
        assert_eq!(truncate_chars("abc", 4), "abc");
    }
}
