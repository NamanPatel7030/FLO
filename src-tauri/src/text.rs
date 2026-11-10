//! Pure text utilities (no I/O) — heavily unit tested.
use std::collections::HashSet;

pub fn word_count(s: &str) -> u32 {
    s.split_whitespace().filter(|w| w.chars().any(|c| c.is_alphanumeric())).count() as u32
}

/// Apply personal-dictionary replacements: case-insensitive, whole words only (Unicode aware),
/// multi-word phrases tolerate any whitespace between their words, the longest phrase wins, and
/// one pass over the text — so a replacement is never replaced again and applying twice is a no-op
/// ("app" → "Flo app" doesn't grow into "Flo Flo app"). The replacement is inserted exactly as the
/// user wrote it. `entries`: (heard_as, replacement).
pub fn apply_dictionary(text: &str, entries: &[(String, String)]) -> String {
    struct Rule {
        from: Vec<String>, // lowercased words
        seps: Vec<String>, // non-space separators between them
        to_words: Vec<String>,
        to_seps: Vec<String>,
        to: String,
    }
    let rules: Vec<Rule> = entries
        .iter()
        .filter_map(|(from, to)| {
            let (fw, fs) = split_words(from);
            if fw.is_empty() || from.trim() == to.trim() {
                return None;
            }
            let from: Vec<String> = fw.iter().map(|w| w.to_lowercase()).collect();
            let seps = fs[1..fs.len() - 1].iter().map(|s| squash_space(s)).collect();
            let (tw, ts) = split_words(to);
            let to_words = tw.iter().map(|w| w.to_string()).collect();
            let to_seps = if tw.len() > 1 { ts[1..ts.len() - 1].iter().map(|s| squash_space(s)).collect() } else { vec![] };
            Some(Rule { from, seps, to_words, to_seps, to: to.trim().to_string() })
        })
        .collect();
    if rules.is_empty() {
        return text.to_string();
    }
    let (words, seps) = split_words(text);
    let lower: Vec<String> = words.iter().map(|w| w.to_lowercase()).collect();
    // does rule word sequence `want` (with separators `want_seps`) start at word i? → words used
    let matches_at = |i: usize, want: &[String], want_seps: &[String], exact: bool| -> bool {
        if i + want.len() > words.len() {
            return false;
        }
        want.iter().enumerate().all(|(k, w)| if exact { words[i + k] == w.as_str() } else { lower[i + k] == *w })
            && want_seps.iter().enumerate().all(|(k, s)| squash_space(seps[i + k + 1]) == *s)
    };
    let mut out = String::with_capacity(text.len() + 16);
    out.push_str(seps[0]);
    let mut i = 0;
    while i < words.len() {
        // already the user's spelling (from an earlier pass)? keep it as is
        let keep = rules
            .iter()
            .filter(|r| !r.to_words.is_empty())
            .filter(|r| matches_at(i, &r.to_words, &r.to_seps, true))
            .map(|r| r.to_words.len())
            .max()
            .unwrap_or(0);
        let hit = rules.iter().filter(|r| r.from.len() > keep && matches_at(i, &r.from, &r.seps, false)).max_by_key(|r| r.from.len());
        let used = match hit {
            Some(r) => {
                out.push_str(&r.to);
                r.from.len()
            }
            None => {
                let n = keep.max(1);
                for k in 0..n {
                    if k > 0 {
                        out.push_str(seps[i + k]);
                    }
                    out.push_str(words[i + k]);
                }
                n
            }
        };
        i += used;
        out.push_str(seps[i]);
    }
    out
}

/// Word characters: letters/digits (any script), Indic vowel signs and viramas, joiners, `_ ' -`
/// inside a word.
fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || ('\u{0900}'..='\u{0DFF}').contains(&c) || c == '\u{200C}' || c == '\u{200D}'
}

/// Split into words and the separators around them: `seps.len() == words.len() + 1`, and
/// `seps[0] + words[0] + seps[1] + … + seps[n]` is the original text. Apostrophes and hyphens
/// between letters stay inside the word ("they're", "e-mail").
fn split_words(s: &str) -> (Vec<&str>, Vec<&str>) {
    let mut words = vec![];
    let mut seps = vec![];
    let chars: Vec<(usize, char)> = s.char_indices().collect();
    let mut sep_start = 0;
    let mut k = 0;
    while k < chars.len() {
        if is_word_char(chars[k].1) {
            let ws = chars[k].0;
            let mut j = k + 1;
            while j < chars.len() {
                let c = chars[j].1;
                let joiner = (c == '\'' || c == '’' || c == '-') && j + 1 < chars.len() && is_word_char(chars[j + 1].1);
                if is_word_char(c) || joiner {
                    j += 1;
                } else {
                    break;
                }
            }
            let we = if j < chars.len() { chars[j].0 } else { s.len() };
            seps.push(&s[sep_start..ws]);
            words.push(&s[ws..we]);
            sep_start = we;
            k = j;
        } else {
            k += 1;
        }
    }
    seps.push(&s[sep_start..]);
    (words, seps)
}

/// Whitespace runs → nothing (so "note  book" and "note\nbook" match "note book").
fn squash_space(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).collect()
}

/// Learned words for the speech model's prompt: newest first (`newest_first`), deduplicated
/// case-insensitively, comma separated, at most `max_chars` long. Whisper keeps only the last
/// ~224 prompt tokens, so an unbounded list silently drops words.
pub fn stt_vocab(newest_first: &[String], max_chars: usize) -> String {
    let mut seen = HashSet::new();
    let mut out = String::new();
    for w in newest_first {
        let w = w.trim();
        if w.is_empty() || !seen.insert(w.to_lowercase()) {
            continue;
        }
        let add = if out.is_empty() { w.len() } else { w.len() + 2 };
        if out.len() + add > max_chars {
            break;
        }
        if !out.is_empty() {
            out.push_str(", ");
        }
        out.push_str(w);
    }
    out
}

/// Local, always-on fixes for what the speech model gets wrong around joins and context:
/// a missing space after sentence punctuation ("colors.Like" → "colors. Like"; never inside URLs,
/// emails, numbers, file names or abbreviations), a word misheard here but heard right elsewhere
/// in the same dictation with the same word before it ("light theme … light Thim" → "light
/// theme"), and a capital after a comma on a word that isn't a name ("want, Light" → "want, light").
pub fn tidy_transcript(t: &str) -> String {
    let spaced = space_after_punctuation(t);
    let (words, seps) = split_words(&spaced);
    if words.is_empty() {
        return spaced;
    }
    let mut words: Vec<String> = words.iter().map(|w| w.to_string()).collect();
    prefer_consistent_spelling(&mut words);
    let lower_seen: HashSet<String> = words.iter().filter(|w| w.chars().next().map(char::is_lowercase).unwrap_or(false)).cloned().collect();
    for k in 0..words.len() {
        let sep = seps[k];
        if k == 0 || !sep.contains(',') || sep.contains(['.', '!', '?', '\n']) {
            continue;
        }
        let w = &words[k];
        let mut cs = w.chars();
        let capitalised = cs.next().map(char::is_uppercase).unwrap_or(false) && cs.all(|c| !c.is_uppercase());
        if !capitalised || w == "I" || w.starts_with("I'") || w.starts_with("I’") {
            continue;
        }
        let lower = w.to_lowercase();
        if is_common(&lower) || lower_seen.contains(&lower) {
            words[k] = lower;
        }
    }
    let mut out = String::with_capacity(spaced.len());
    for (k, w) in words.iter().enumerate() {
        out.push_str(seps[k]);
        out.push_str(w);
    }
    out.push_str(seps[words.len()]);
    out
}

/// "colors.Like" → "colors. Like", "want,Light" → "want, Light", "Really?Yes" → "Really? Yes".
fn space_after_punctuation(t: &str) -> String {
    let mut out = String::with_capacity(t.len() + 8);
    for (ti, token) in t.split(' ').enumerate() {
        if ti > 0 {
            out.push(' ');
        }
        if token.contains("://") || token.contains('@') || token.starts_with("www.") {
            out.push_str(token);
            continue;
        }
        let cs: Vec<char> = token.chars().collect();
        for (k, &c) in cs.iter().enumerate() {
            out.push(c);
            let (Some(&prev), Some(&next)) = (k.checked_sub(1).and_then(|p| cs.get(p)), cs.get(k + 1)) else { continue };
            if !prev.is_alphabetic() || !next.is_alphabetic() {
                continue;
            }
            let after_next_lower = cs.get(k + 2).map(|c| c.is_lowercase()).unwrap_or(false);
            // letters right before the punctuation ("U.S" has one: an abbreviation)
            let run = cs[..k].iter().rev().take_while(|c| c.is_alphabetic()).count();
            let add = match c {
                ',' => true,
                '?' | '!' => next.is_uppercase(),
                '.' => next.is_uppercase() && after_next_lower && run >= 2,
                _ => false,
            };
            if add {
                out.push(' ');
            }
        }
    }
    out
}

/// Replace a word with a longer sound-alike that was heard elsewhere in the same text after the
/// same word ("light Thim" next to "light theme"). ASCII words only, never everyday words.
fn prefer_consistent_spelling(words: &mut [String]) {
    let lower: Vec<String> = words.iter().map(|w| w.to_lowercase()).collect();
    let mut swaps: Vec<(String, String)> = vec![];
    for (i, u) in lower.iter().enumerate() {
        if i == 0 || u.len() < 3 || !u.chars().all(|c| c.is_ascii_alphabetic()) || is_common(u) || swaps.iter().any(|(a, _)| a == u) {
            continue;
        }
        for (j, v) in lower.iter().enumerate() {
            if j == 0 || v.len() <= u.len() || !v.chars().all(|c| c.is_ascii_alphabetic()) || is_common(v) || lower[j - 1] != lower[i - 1] {
                continue;
            }
            let d = levenshtein(u, v) as f64 / v.len() as f64;
            if d <= 0.5 && sound_key(u) == sound_key(v) {
                swaps.push((u.clone(), words[j].clone()));
                break;
            }
        }
    }
    for (u, v) in swaps {
        for w in words.iter_mut().filter(|w| w.to_lowercase() == u) {
            *w = v.clone();
        }
    }
}

/// Devanagari → Gujarati script, letter for letter (both follow the ISCII layout, so the code
/// points sit at the same offset in their Unicode blocks). Whisper writes Gujarati speech in
/// Devanagari (its language detector takes it for Hindi, and its Hindi decode of Gujarati is
/// phonetically close), so this turns that into readable Gujarati. Other text passes through.
pub fn devanagari_to_gujarati(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        let u = c as u32;
        if !(0x0900..=0x097F).contains(&u) {
            out.push(c);
            continue;
        }
        let mapped = match u {
            0x093C => continue,                     // nukta: Gujarati doesn't write it
            0x0958..=0x095F => [0x0915, 0x0916, 0x0917, 0x091C, 0x0921, 0x0922, 0x092B, 0x092F][(u - 0x0958) as usize] + 0x180,
            0x0964 | 0x0965 => '.' as u32,          // danda: Gujarati ends sentences with a full stop
            0x0929 => 0x0AA8,                       // ऩ → ન
            0x0931 => 0x0AB0,                       // ऱ → ર
            0x0934 => 0x0AB3,                       // ऴ → ળ
            0x090E | 0x0912 => u + 0x180 - 1,       // short e / o → e / o
            0x0946 | 0x094A => u + 0x180 + 1,
            _ => u + 0x180,
        };
        match char::from_u32(mapped).filter(|m| !is_unassigned_gujarati(*m)) {
            Some(m) => out.push(m),
            None => out.push(c),
        }
    }
    out
}

/// Gujarati → Devanagari, letter for letter (see `devanagari_to_gujarati`). Used to show the Hindi
/// decoder Gujarati context (dictionary words, the previous sentence) in a script it reads.
pub fn gujarati_to_devanagari(s: &str) -> String {
    s.chars()
        .map(|c| match c as u32 {
            u @ 0x0A81..=0x0AFF => char::from_u32(u - 0x180).unwrap_or(c),
            _ => c,
        })
        .collect()
}

fn is_unassigned_gujarati(c: char) -> bool {
    matches!(c as u32, 0x0A80 | 0x0A84 | 0x0A8E | 0x0A92 | 0x0AA9 | 0x0AB1 | 0x0AB4 | 0x0ABA | 0x0ABB | 0x0AC6 | 0x0ACA | 0x0ACE | 0x0ACF | 0x0AD1..=0x0ADF | 0x0AE4 | 0x0AE5 | 0x0AF2..=0x0AF8)
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

/// Everyday words. When both sides of an edit are everyday words ("send" → "sent", "their" →
/// "they're") it's grammar or rewording, not a mishearing — learning it would rewrite that word in
/// every future dictation.
const COMMON_WORDS: &[&str] = &[
    "a", "about", "after", "again", "all", "also", "am", "an", "and", "any", "are", "as", "ask", "asked", "at", "back", "be",
    "because", "been", "before", "being", "but", "by", "call", "came", "can", "can't", "come", "could", "day", "did", "do",
    "does", "done", "don't", "down", "each", "even", "for", "from", "get", "give", "go", "going", "gone", "good", "got",
    "great", "had", "has", "have", "he", "her", "here", "him", "his", "how", "i", "if", "in", "into", "is", "it", "it's",
    "its", "just", "know", "let", "like", "look", "made", "make", "many", "may", "me", "might", "more", "most", "much",
    "must", "my", "need", "new", "no", "not", "now", "of", "off", "ok", "okay", "old", "on", "one", "only", "or", "our",
    "out", "over", "put", "said", "saw", "say", "see", "send", "sent", "set", "she", "should", "so", "some", "take",
    "tell", "than", "that", "the", "their", "them", "then", "there", "these", "they", "they're", "think", "this", "those",
    "three", "time", "to", "today", "told", "too", "took", "two", "up", "us", "use", "used", "very", "want", "was", "way",
    "we", "we're", "well", "went", "were", "what", "when", "where", "which", "who", "why", "will", "with", "won't", "work",
    "would", "yes", "yesterday", "tomorrow", "you", "you're", "your", "four", "five", "week", "really", "still", "right",
];

fn is_common(w: &str) -> bool {
    let w = w.to_lowercase().replace('’', "'");
    COMMON_WORDS.contains(&w.as_str())
}

/// Rough sound key: first letter, then consonants with sound-alike letters merged (c/k/q, s/z,
/// f/v/ph), vowels, h, w, y dropped and repeats collapsed. "tory" and "Tauri" → "tr".
fn sound_key(s: &str) -> String {
    let s: String = s.to_lowercase().chars().filter(|c| c.is_alphabetic()).collect::<String>().replace("ph", "f").replace("ck", "k");
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        let m = match c {
            'c' | 'q' | 'k' => 'k',
            'z' | 's' => 's',
            'v' | 'f' => 'f',
            'a' | 'e' | 'i' | 'o' | 'u' | 'y' | 'h' | 'w' if i > 0 => continue,
            'a' | 'e' | 'i' | 'o' | 'u' | 'y' => 'a',
            c => c,
        };
        if !out.ends_with(m) {
            out.push(m);
        }
    }
    out
}

/// Is `heard` → `corrected` a fix of something the speech model misheard (worth learning for good),
/// rather than a rewrite, a grammar edit, sentence-start capitalisation or a half-typed word?
fn is_mishearing(heard: &[&str], corrected: &[&str], sentence_start: bool) -> bool {
    let key = |ws: &[&str]| ws.iter().map(|w| w.to_lowercase()).collect::<String>();
    let (hk, ck) = (key(heard), key(corrected));
    if heard == corrected {
        return false;
    }
    if hk == ck {
        if heard.len() != corrected.len() {
            return true; // "note book" → "notebook", "icecream" → "ice cream"
        }
        // capitalisation only: must capitalise something, not just the start of a sentence
        if !corrected.iter().any(|w| w.chars().any(|c| c.is_uppercase())) {
            return false;
        }
        let only_first_letter = heard.len() == corrected.len()
            && heard[1..] == corrected[1..]
            && heard[0].chars().skip(1).eq(corrected[0].chars().skip(1));
        if sentence_start && only_first_letter {
            return false;
        }
        return !(heard.len() == 1 && is_common(heard[0]));
    }
    let (hn, cn) = (hk.chars().count(), ck.chars().count());
    if hn < 3 || cn < 3 {
        return false;
    }
    // "app" → "apps", "deploy" → "deployed": inflection, not a mishearing
    let (short, long) = if hn <= cn { (&hk, &ck) } else { (&ck, &hk) };
    if let Some(rest) = long.strip_prefix(short.as_str()) {
        if ["s", "es", "ed", "d", "ing", "'s", "er", "ly", "n't"].contains(&rest) {
            return false;
        }
    }
    if heard.iter().all(|w| is_common(w)) && corrected.iter().all(|w| is_common(w)) {
        return false;
    }
    let d = levenshtein(&hk, &ck) as f64 / hn.max(cn) as f64;
    d <= 0.34 || (d <= 0.6 && sound_key(&hk) == sound_key(&ck))
}

/// Words the user replaced in text Flo pasted. `before` = field content right after the paste,
/// `after` = content once the user edited it. Returns (heard, corrected) pairs; a multi-word fix
/// comes back as one phrase ("new york" → "New York"), split/merged words too ("note book" →
/// "notebook"). Surrounding punctuation is ignored.
pub fn detect_corrections(pasted: &str, before: &str, after: &str) -> Vec<(String, String)> {
    let pasted_words: HashSet<String> = split_words(pasted).0.iter().map(|w| w.to_lowercase()).collect();
    let (a, _) = split_words(before);
    let (b, b_seps) = split_words(after);
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
    // walk the diff into hunks of (deleted words, inserted words, index of the first inserted word in `b`)
    let mut hunks: Vec<(Vec<&str>, Vec<&str>, usize)> = vec![];
    let (mut del, mut ins, mut at) = (vec![], vec![], s);
    let (mut i, mut j) = (0, 0);
    while i < n || j < m {
        if i < n && j < m && am[i] == bm[j] {
            if !del.is_empty() || !ins.is_empty() {
                hunks.push((std::mem::take(&mut del), std::mem::take(&mut ins), at));
            }
            i += 1;
            j += 1;
            at = s + j;
        } else if j < m && (i == n || dp[i][j + 1] >= dp[i + 1][j]) {
            ins.push(bm[j]);
            j += 1;
        } else {
            del.push(am[i]);
            i += 1;
        }
    }
    if !del.is_empty() || !ins.is_empty() {
        hunks.push((del, ins, at));
    }
    let mut out: Vec<(String, String)> = vec![];
    for (del, ins, at) in hunks {
        // pure insertions/deletions aren't fixes; long runs are rewrites
        if del.is_empty() || ins.is_empty() || del.len() > 3 || ins.len() > 3 {
            continue;
        }
        if !del.iter().all(|w| pasted_words.contains(&w.to_lowercase())) {
            continue; // the user edited their own text, not Flo's
        }
        let sentence_start = at == 0 || b_seps[at].contains(['.', '!', '?', '\n', '।']);
        if !is_mishearing(&del, &ins, sentence_start) {
            continue;
        }
        let (heard, corrected) = (del.join(" "), ins.join(" "));
        if !out.iter().any(|(h, _)| h.eq_ignore_ascii_case(&heard)) {
            out.push((heard, corrected));
        }
    }
    out.truncate(3);
    out
}

/// Split a document into ~`size`-char chunks on paragraph/line boundaries.
pub fn chunk_text(s: &str, size: usize) -> Vec<String> {
    let mut out = vec![];
    let mut cur = String::new();
    for para in s.split("\n\n") {
        let para = para.trim();
        if para.is_empty() {
            continue;
        }
        if !cur.is_empty() && cur.len() + para.len() + 2 > size {
            out.push(std::mem::take(&mut cur));
        }
        if para.len() > size {
            // long paragraph: split by lines / hard cut
            for line in para.lines() {
                if cur.len() + line.len() + 1 > size && !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
                let mut l = line;
                while l.len() > size {
                    let cut = l.char_indices().map(|(i, _)| i).take_while(|i| *i <= size).last().unwrap_or(size);
                    out.push(l[..cut].to_string());
                    l = &l[cut..];
                }
                if !cur.is_empty() {
                    cur.push('\n');
                }
                cur.push_str(l);
            }
        } else {
            if !cur.is_empty() {
                cur.push_str("\n\n");
            }
            cur.push_str(para);
        }
    }
    if !cur.trim().is_empty() {
        out.push(cur);
    }
    out
}

/// Pick context for a query without sending everything: pinned docs (trimmed) first, then the
/// highest-scoring chunks by keyword overlap, within `budget` chars total.
pub fn select_context(query: &str, docs: &[(String, String, bool)], budget: usize) -> String {
    // `docs` are the ENABLED docs (pinned flag = priority). Every enabled doc is represented:
    // small docs in full, large docs trimmed to their most query-relevant chunk. Pinned first.
    let q = tokens(query);
    let mut out = String::new();
    let mut used = 0usize;
    const SMALL: usize = 1400;

    let push = |out: &mut String, used: &mut usize, title: &str, body: &str, cap: usize| {
        let piece = truncate_chars(body.trim(), cap.min(budget.saturating_sub(*used)));
        if piece.chars().count() >= 12 {
            *used += piece.len();
            out.push_str(&format!("[{title}]\n{piece}\n\n"));
        }
    };

    // most relevant chunk of a large doc (falls back to its start)
    let best_chunk = |content: &str| -> String {
        if q.is_empty() {
            return truncate_chars(content, SMALL);
        }
        chunk_text(content, 700)
            .into_iter()
            .map(|ch| {
                let hits = q.iter().filter(|w| tokens(&ch).contains(*w)).count();
                (hits, ch)
            })
            .max_by_key(|(h, _)| *h)
            .map(|(h, ch)| if h > 0 { ch } else { truncate_chars(content, SMALL) })
            .unwrap_or_default()
    };

    // pinned first, then the rest — but ALL enabled docs get a slot
    let mut ordered: Vec<&(String, String, bool)> = docs.iter().collect();
    ordered.sort_by_key(|d| !d.2); // pinned (true) first
    for (title, content, _) in ordered {
        if used >= budget {
            break;
        }
        if content.chars().count() <= SMALL {
            push(&mut out, &mut used, title, content, SMALL);
        } else {
            push(&mut out, &mut used, title, &best_chunk(content), 900);
        }
    }
    out.trim_end().to_string()
}

/// Replace em/en dashes (an "AI-written" tell) with plain punctuation.
pub fn strip_ai_dashes(s: &str) -> String {
    let mut t = s.replace(" — ", ", ").replace(" – ", ", ").replace("—", ", ").replace(" -- ", ", ");
    t = t.replace("–", "-");
    while t.contains(",,") {
        t = t.replace(",,", ",");
    }
    t.replace(" ,", ",")
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
/// "Draft / write / reply / wish …" — the user wants text written for the place they're in.
/// These always get the screen (text + screenshot) so the draft answers what's actually there.
pub fn is_writing_request(query: &str) -> bool {
    let q = format!(" {} ", query.to_lowercase());
    const CUES: &[&str] = &[
        " draft", " write", " compose", " reply", " respond", " rewrite", " rephrase", " polish",
        " message", " email", " e-mail", " mail ", " dm ", " wish", " congratulat", " caption", " tweet",
        " post ", " comment", " follow up", " follow-up", " tell them", " tell him", " tell her",
        " text him", " text her", " answer him", " answer her", " make it ", " make a message",
    ];
    CUES.iter().any(|c| q.contains(c))
}

pub fn wants_screen_context(query: &str) -> bool {
    if is_writing_request(query) {
        return true;
    }
    let q = format!(" {} ", query.to_lowercase());
    const CUES: &[&str] = &[
        " screen", " this ", " this?", " this.", " these ", " here", " above", " below", " reply", " respond",
        " answer this", " summari", " what does it", " what is this", " explain", " translate", " this email",
        " this message", " this page", " this doc", " on my screen", " that message", " that email",
        " what am i looking at", " what's this", " what is that", " this error", " this code", " fix this", " this chart",
        " this table", " in front of me", " visible",
    ];
    CUES.iter().any(|c| q.contains(c))
}

/// Which skill does a spoken request invoke? A skill matches when the request contains its name
/// or one of its trigger phrases (whole words, case-insensitive, at least 3 characters). The
/// longest matching phrase wins, so "upwork proposal" beats "proposal". Returns the index.
pub fn match_skill(query: &str, skills: &[(String, String)]) -> Option<usize> {
    let norm = |s: &str| {
        let t = s.to_lowercase().replace(|c: char| !c.is_alphanumeric(), " ");
        format!(" {} ", t.split_whitespace().collect::<Vec<_>>().join(" "))
    };
    let q = norm(query);
    let mut best: Option<(usize, usize)> = None;
    for (i, (name, triggers)) in skills.iter().enumerate() {
        for phrase in std::iter::once(name.as_str()).chain(triggers.split(',')) {
            let p = norm(phrase);
            let core = p.trim();
            if core.chars().count() < 3 || !q.contains(&p) {
                continue;
            }
            if best.map(|(_, len)| core.len() > len).unwrap_or(true) {
                best = Some((i, core.len()));
            }
        }
    }
    best.map(|(i, _)| i)
}

/// Which project does this text belong to? Each candidate has weighted terms (project and client
/// names weigh 2, keywords 1); a term counts when it appears as whole words (case-insensitive,
/// at least 3 characters). Only a single clear winner is returned, never a tie.
pub fn match_project(text: &str, projects: &[(String, Vec<(String, u32)>)]) -> Option<String> {
    let hay = format!(" {} ", text.to_lowercase().replace(|c: char| !c.is_alphanumeric() && c != '@' && c != '.', " "));
    let hay = hay.split_whitespace().collect::<Vec<_>>().join(" ");
    let hay = format!(" {hay} ");
    let mut best: Option<(&String, u32)> = None;
    let mut tie = false;
    for (id, terms) in projects {
        let mut seen = std::collections::HashSet::new();
        let score: u32 = terms
            .iter()
            .filter_map(|(term, w)| {
                let t = term.to_lowercase().replace(|c: char| !c.is_alphanumeric() && c != '@' && c != '.', " ");
                let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
                (t.chars().count() >= 3 && seen.insert(t.clone()) && hay.contains(&format!(" {t} "))).then_some(*w)
            })
            .sum();
        if score == 0 {
            continue;
        }
        match best {
            Some((_, b)) if score < b => {}
            Some((_, b)) if score == b => tie = true,
            _ => {
                best = Some((id, score));
                tie = false;
            }
        }
    }
    if tie {
        None
    } else {
        best.map(|(id, _)| id.clone())
    }
}

/// A deadline written in plain words, relative to `now`: "by next Monday", "tomorrow at 5pm",
/// "in 2 hours", "end of week", "Nov 12", "tonight". Dates without a time get 10:00 (so the
/// 5-minutes-early reminder lands at 9:55). None when the text names no time at all.
pub fn parse_due(text: &str, now: chrono::DateTime<chrono::Local>) -> Option<chrono::DateTime<chrono::Local>> {
    use chrono::{Datelike, Duration, NaiveTime, TimeZone, Weekday};
    let lower = format!(" {} ", text.to_lowercase().replace([',', '.', ';', '!', '?', '(', ')'], " "));
    let words: Vec<&str> = lower.split_whitespace().collect();
    let has = |p: &str| lower.contains(&format!(" {p} "));
    let today = now.date_naive();

    // ── relative offsets: "in 2 hours", "in 30 min", "in an hour", "in 3 days", "in 2 weeks"
    for (i, w) in words.iter().enumerate() {
        if *w != "in" || i + 2 >= words.len() + 1 {
            continue;
        }
        let (n, unit) = match (words.get(i + 1), words.get(i + 2)) {
            (Some(n), Some(u)) => (if *n == "an" || *n == "a" { Some(1) } else { n.parse::<i64>().ok() }, *u),
            _ => continue,
        };
        let Some(n) = n.filter(|n| *n > 0 && *n < 1000) else { continue };
        let d = if unit.starts_with("min") {
            Duration::minutes(n)
        } else if unit.starts_with("hour") || unit.starts_with("hr") {
            Duration::hours(n)
        } else if unit.starts_with("day") {
            Duration::days(n)
        } else if unit.starts_with("week") || unit.starts_with("wk") {
            Duration::weeks(n)
        } else {
            continue;
        };
        return Some(now + d);
    }

    // ── time of day
    let mut time: Option<NaiveTime> = None;
    if has("noon") || has("midday") {
        time = NaiveTime::from_hms_opt(12, 0, 0);
    } else if has("eod") || lower.contains("end of day") || lower.contains("end of the day") {
        time = NaiveTime::from_hms_opt(17, 0, 0);
    } else if has("tonight") {
        time = NaiveTime::from_hms_opt(20, 0, 0);
    }
    for (i, w) in words.iter().enumerate() {
        if time.is_some() {
            break;
        }
        // "5pm", "5:30pm", "17:30", or "5 pm" / "at 5"
        let (body, mut suffix) = if let Some(b) = w.strip_suffix("pm") {
            (b, Some("pm"))
        } else if let Some(b) = w.strip_suffix("am") {
            (b, Some("am"))
        } else {
            (*w, None)
        };
        if suffix.is_none() {
            if let Some(n) = words.get(i + 1) {
                if *n == "pm" || *n == "am" || *n == "p.m" || *n == "a.m" {
                    suffix = Some(if n.starts_with('p') { "pm" } else { "am" });
                }
            }
        }
        let (h, m) = match body.split_once(':') {
            Some((h, m)) => (h.parse::<u32>().ok(), m.parse::<u32>().ok()),
            None => (body.parse::<u32>().ok(), Some(0)),
        };
        let (Some(mut h), Some(m)) = (h, m) else { continue };
        let at_before = i > 0 && words[i - 1] == "at";
        let colon = body.contains(':');
        if suffix.is_none() && !colon && !at_before {
            continue; // a bare number ("3 files") isn't a time
        }
        if m > 59 || h > 23 {
            continue;
        }
        match suffix {
            Some("pm") if h < 12 => h += 12,
            Some("am") if h == 12 => h = 0,
            // "at 5" with no am/pm: working hours → afternoon
            None if !colon && (1..=7).contains(&h) => h += 12,
            _ => {}
        }
        time = NaiveTime::from_hms_opt(h, m, 0);
    }

    // ── date
    const DAYS: [(&str, Weekday); 7] = [
        ("monday", Weekday::Mon),
        ("tuesday", Weekday::Tue),
        ("wednesday", Weekday::Wed),
        ("thursday", Weekday::Thu),
        ("friday", Weekday::Fri),
        ("saturday", Weekday::Sat),
        ("sunday", Weekday::Sun),
    ];
    const MONTHS: [&str; 12] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    let next_weekday = |wd: Weekday| {
        let mut d = today + Duration::days(1);
        while d.weekday() != wd {
            d += Duration::days(1);
        }
        d
    };
    let mut date = None;
    if lower.contains("day after tomorrow") {
        date = Some(today + Duration::days(2));
    } else if has("tomorrow") || has("tmrw") || has("tmr") {
        date = Some(today + Duration::days(1));
    } else if has("today") || has("tonight") || (time.is_some() && (has("eod") || lower.contains("end of day"))) {
        date = Some(today);
    } else if lower.contains("end of week") || lower.contains("end of the week") || has("this week") {
        date = Some(if today.weekday() == Weekday::Fri { today } else { next_weekday(Weekday::Fri) });
        time = time.or(NaiveTime::from_hms_opt(17, 0, 0));
    } else if has("next week") {
        date = Some(next_weekday(Weekday::Mon));
    } else if lower.contains("end of month") || lower.contains("end of the month") {
        let (y, mo) = if today.month() == 12 { (today.year() + 1, 1) } else { (today.year(), today.month() + 1) };
        date = chrono::NaiveDate::from_ymd_opt(y, mo, 1).map(|d| d - Duration::days(1));
        time = time.or(NaiveTime::from_hms_opt(17, 0, 0));
    }
    if date.is_none() {
        // weekday names (full, or abbreviated right after by/on/next/this/till/until)
        for (i, w) in words.iter().enumerate() {
            let w = w.trim_end_matches("'s");
            let cue = i > 0 && matches!(words[i - 1], "by" | "on" | "next" | "this" | "till" | "until" | "before");
            if let Some((_, wd)) = DAYS.iter().find(|(name, _)| w == *name || (cue && w.len() == 3 && name.starts_with(w))) {
                date = Some(next_weekday(*wd));
                break;
            }
        }
    }
    if date.is_none() {
        // "Nov 12", "November 12th", "12 Nov", "12th of November"
        let day_of = |t: &str| t.trim_end_matches(|c: char| c.is_alphabetic()).parse::<u32>().ok().filter(|d| (1..=31).contains(d));
        for (i, w) in words.iter().enumerate() {
            let Some(mi) = MONTHS.iter().position(|m| w.starts_with(m) && (w.len() == 3 || (w.len() > 3 && "januaryfebruarymarchaprilmayjunejulyaugustseptemberoctobernovemberdecember".contains(*w)))) else {
                continue;
            };
            let day = words.get(i + 1).and_then(|t| day_of(t)).or_else(|| {
                let back = if i >= 2 && words[i - 1] == "of" { words.get(i - 2) } else if i >= 1 { words.get(i - 1) } else { None };
                back.and_then(|t| day_of(t))
            });
            let Some(day) = day else { continue }; // "may" / "march" as words, not dates
            let mut y = today.year();
            let mut d = chrono::NaiveDate::from_ymd_opt(y, mi as u32 + 1, day);
            if d.map(|d| d < today).unwrap_or(false) {
                y += 1;
                d = chrono::NaiveDate::from_ymd_opt(y, mi as u32 + 1, day);
            }
            if d.is_some() {
                date = d;
                break;
            }
        }
    }

    let (date, time) = match (date, time) {
        (Some(d), t) => (d, t.unwrap_or_else(|| NaiveTime::from_hms_opt(10, 0, 0).unwrap())),
        // time only: today if it's still ahead, else tomorrow
        (None, Some(t)) => (if now.time() < t { today } else { today + Duration::days(1) }, t),
        (None, None) => return None,
    };
    chrono::Local.from_local_datetime(&date.and_time(time)).earliest()
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

    #[test]
    fn spoken_requests_find_their_skill() {
        let skills = vec![
            ("Upwork proposal".to_string(), "proposal for this job, apply to this job".to_string()),
            ("Slack reply".to_string(), "reply on slack".to_string()),
            ("Proposal".to_string(), "".to_string()),
        ];
        let m = |q: &str| match_skill(q, &skills);
        assert_eq!(m("use my Upwork proposal skill for this post"), Some(0));
        assert_eq!(m("write a proposal for this job"), Some(0)); // trigger phrase
        assert_eq!(m("reply on Slack saying I'll join"), Some(1));
        assert_eq!(m("draft a proposal"), Some(2)); // only the short one matches
        assert_eq!(m("what's the weather"), None);
        assert_eq!(m("slacker"), None); // whole words only
    }


    #[test]
    fn captured_items_find_their_project() {
        let t = |v: &[(&str, u32)]| v.iter().map(|(a, w)| (a.to_string(), *w)).collect::<Vec<_>>();
        let projects = vec![
            ("apollo".to_string(), t(&[("Apollo", 2), ("Northwind", 2), ("Ana", 1), ("#apollo-design", 1)])),
            ("hermes".to_string(), t(&[("Hermes API", 2), ("Stripe", 1), ("Priya", 1)])),
            ("site".to_string(), t(&[("SaaS rebuild", 2), ("Fang", 2), ("ayushi", 1)])),
        ];
        let m = |s: &str| match_project(s, &projects);
        assert_eq!(m("Send updated deck to Northwind").as_deref(), Some("apollo"));
        assert_eq!(m("Ask Priya for Stripe webhook keys").as_deref(), Some("hermes"));
        assert_eq!(m("Prepare plan and SOW with Ayushi").as_deref(), Some("site"));
        assert_eq!(m("Reply in #apollo-design about the cards").as_deref(), Some("apollo"));
        // nothing relevant → nothing guessed; a tie → nothing guessed
        assert_eq!(m("Pay electricity bill"), None);
        assert_eq!(m("Ana and Priya to sync"), None);
        // whole words only: "anagram" is not "Ana"
        assert_eq!(m("solve the anagram"), None);
    }


    fn at(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> chrono::DateTime<chrono::Local> {
        use chrono::TimeZone;
        chrono::Local.with_ymd_and_hms(y, mo, d, h, mi, 0).unwrap()
    }

    #[test]
    fn deadlines_in_plain_words() {
        // Saturday 7 Nov 2026, 08:06 (the meeting in the screenshot)
        let now = at(2026, 11, 7, 8, 6);
        let due = |t: &str| parse_due(t, now);
        assert_eq!(due("Client: Send requirements to Naman by next Monday"), Some(at(2026, 11, 9, 10, 0)));
        assert_eq!(due("send the deck by Friday"), Some(at(2026, 11, 13, 10, 0)));
        assert_eq!(due("call the bank tomorrow at 11am"), Some(at(2026, 11, 8, 11, 0)));
        assert_eq!(due("review PR at 5"), Some(at(2026, 11, 7, 17, 0)));
        assert_eq!(due("pay rent tonight"), Some(at(2026, 11, 7, 20, 0)));
        assert_eq!(due("ping Priya in 2 hours"), Some(at(2026, 11, 7, 10, 6)));
        assert_eq!(due("ship it end of week"), Some(at(2026, 11, 13, 17, 0)));
        assert_eq!(due("demo on Nov 12 at 3:30pm"), Some(at(2026, 11, 12, 15, 30)));
        assert_eq!(due("renewal due 4th December"), Some(at(2026, 12, 4, 10, 0)));
        assert_eq!(due("standup 09:30"), Some(at(2026, 11, 7, 9, 30)));
        // no deadline → no guess
        assert_eq!(due("Prepare plan and SOW after receiving requirements"), None);
        assert_eq!(due("We may march on with 3 files"), None);
        assert_eq!(due("Message and call the client on Microsoft Teams"), None);
    }

    use super::*;

    #[test]
    fn local_cleanup_leaves_hindi_gujarati_and_hinglish_intact() {
        for t in ["कल सुबह 10 बजे मीटिंग है, सबको याद दिला देना।", "કાલે સવારે દસ વાગ્યે મીટિંગ છે.", "Kal subah meeting hai, sabko yaad dila dena."] {
            assert_eq!(basic_cleanup(t), t);
        }
        assert_eq!(basic_cleanup("um मुझे राहुल को invoice भेजना है।"), "मुझे राहुल को invoice भेजना है।");
        let dict = vec![("राहुल".to_string(), "Rahul".to_string())];
        assert_eq!(apply_dictionary("मुझे राहुल को invoice भेजना है।", &dict), "मुझे Rahul को invoice भेजना है।");
    }

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
    fn chunks_on_paragraphs_within_size() {
        let doc = format!("{}\n\n{}\n\n{}", "a ".repeat(200), "b ".repeat(200), "c ".repeat(500));
        let ch = chunk_text(&doc, 700);
        assert!(ch.len() >= 3);
        assert!(ch.iter().all(|c| c.len() <= 700));
    }

    #[test]
    fn selects_only_relevant_context_within_budget() {
        let docs = vec![
            ("About me".to_string(), "I'm Naman. Keep replies short and warm.".to_string(), true),
            ("Apollo notes".to_string(), "Apollo launch: deck due Friday. Rahul owns the invoice.".to_string(), false),
            ("Recipes".to_string(), "Biryani needs saffron and patience.".to_string(), false),
        ];
        let c = select_context("reply to Rahul about the Apollo invoice", &docs, 2500);
        assert!(c.contains("About me")); // pinned always
        assert!(c.contains("Rahul owns the invoice")); // small enabled doc → always in full
        assert!(c.contains("Biryani")); // enabled small doc is included even if off-topic
        assert!(select_context("x", &docs, 10).len() <= 200); // respects a tiny budget
    }

    #[test]
    fn removes_ai_dashes() {
        assert_eq!(strip_ai_dashes("Ship it — today."), "Ship it, today.");
        assert_eq!(strip_ai_dashes("pages 3–5"), "pages 3-5");
        assert_eq!(strip_ai_dashes("well—maybe"), "well, maybe");
        assert_eq!(strip_ai_dashes("no dashes here"), "no dashes here");
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
        // drafting always sees the screen (the request that used to go out blind)
        assert!(wants_screen_context("draft a message to the team for happy Dhanteras"));
    }

    #[test]
    fn writing_requests_are_recognised() {
        assert!(is_writing_request("draft a message to the team for happy Dhanteras"));
        assert!(is_writing_request("write an email to Rahul about the invoice"));
        assert!(is_writing_request("reply saying I'll join at six"));
        assert!(is_writing_request("wish everyone a happy Diwali"));
        assert!(!is_writing_request("open Slack"));
        assert!(!is_writing_request("what's the weather"));
        assert!(!is_writing_request("add a to-do to Apollo: send the deck"));
    }

    #[test]
    fn truncates() {
        assert_eq!(truncate_chars("abcdef", 4), "abc…");
        assert_eq!(truncate_chars("abc", 4), "abc");
    }
}

#[cfg(test)]
mod correction_tests {
    use super::*;

    fn pair(h: &str, c: &str) -> Vec<(String, String)> {
        vec![(h.to_string(), c.to_string())]
    }

    // ── detection ───────────────────────────────────────────────────────────
    #[test]
    fn learns_a_fix_next_to_punctuation() {
        let p = "Deploy the tory, then ping me";
        assert_eq!(detect_corrections(p, p, "Deploy the Tauri, then ping me"), pair("tory", "Tauri"));
    }

    #[test]
    fn learns_split_and_merged_words() {
        let p = "write it in my note book today";
        assert_eq!(detect_corrections(p, p, "write it in my notebook today"), pair("note book", "notebook"));
        let p = "I want icecream now";
        assert_eq!(detect_corrections(p, p, "I want ice cream now"), pair("icecream", "ice cream"));
    }

    #[test]
    fn learns_multi_word_fixes_as_one_phrase() {
        // two separate "new"→"New" / "york"→"York" rules would capitalise every "new" forever
        let p = "we fly to new york soon";
        assert_eq!(detect_corrections(p, p, "we fly to New York soon"), pair("new york", "New York"));
        let p = "ask rahul meta about it";
        assert_eq!(detect_corrections(p, p, "ask Rahul Mehta about it"), pair("rahul meta", "Rahul Mehta"));
    }

    #[test]
    fn learns_sound_alike_names() {
        let p = "thanks Neman for the review";
        assert_eq!(detect_corrections(p, p, "thanks Naman for the review"), pair("Neman", "Naman"));
        let p = "the kubernetis cluster";
        assert_eq!(detect_corrections(p, p, "the Kubernetes cluster"), pair("kubernetis", "Kubernetes"));
    }

    #[test]
    fn ignores_sentence_start_capitalisation_and_common_words() {
        let p = "the plan is ready";
        assert!(detect_corrections(p, p, "The plan is ready").is_empty());
        let p = "ok. the plan is ready";
        assert!(detect_corrections(p, p, "ok. The plan is ready").is_empty());
        // decapitalising is restructuring, not a mishearing
        let p = "Ready now";
        assert!(detect_corrections(p, p, "ready now").is_empty());
    }

    #[test]
    fn ignores_grammar_edits() {
        let p = "I send it yesterday";
        assert!(detect_corrections(p, p, "I sent it yesterday").is_empty());
        let p = "open the two app";
        assert!(detect_corrections(p, p, "open the two apps").is_empty());
        let p = "their going home";
        assert!(detect_corrections(p, p, "they're going home").is_empty());
    }

    #[test]
    fn ignores_half_typed_words_and_wipes() {
        // a snapshot taken mid-typing ("Tau") must not be learned as the fix for "tory"
        let p = "build it with tory today";
        assert!(detect_corrections(p, p, "build it with Tau today").is_empty());
        assert!(detect_corrections(p, p, "").is_empty());
        assert!(detect_corrections(p, p, "x").is_empty());
        // a big rewrite isn't a mishearing
        assert!(detect_corrections(p, p, "ship the whole thing on monday instead").is_empty());
    }

    // ── applying ────────────────────────────────────────────────────────────
    fn d(v: &[(&str, &str)]) -> Vec<(String, String)> {
        v.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect()
    }

    #[test]
    fn applying_twice_changes_nothing_more() {
        let dict = d(&[("app", "Flo app"), ("tory", "Tauri")]);
        let once = apply_dictionary("open the app with tory", &dict);
        assert_eq!(once, "open the Flo app with Tauri");
        assert_eq!(apply_dictionary(&once, &dict), once);
    }

    #[test]
    fn longest_phrase_wins_and_spacing_is_tolerated() {
        let dict = d(&[("note", "Note"), ("note book", "notebook")]);
        assert_eq!(apply_dictionary("my note book is here", &dict), "my notebook is here");
        assert_eq!(apply_dictionary("my note  book is here", &dict), "my notebook is here");
        assert_eq!(apply_dictionary("a Note", &dict), "a Note");
    }

    #[test]
    fn case_insensitive_even_with_non_ascii_text() {
        let dict = d(&[("tory", "Tauri"), ("new york", "New York")]);
        assert_eq!(apply_dictionary("İstanbul trip with Tory", &dict), "İstanbul trip with Tauri");
        assert_eq!(apply_dictionary("TORY, then NEW YORK.", &dict), "Tauri, then New York.");
        assert_eq!(apply_dictionary("history of new yorkers", &dict), "history of new yorkers");
    }

    #[test]
    fn devanagari_words_keep_their_boundaries() {
        let dict = d(&[("राहुल", "Rahul")]);
        assert_eq!(apply_dictionary("राहुलजी आए", &dict), "राहुलजी आए");
        assert_eq!(apply_dictionary("राहुल आए", &dict), "Rahul आए");
    }

    // ── vocabulary bias ─────────────────────────────────────────────────────
    #[test]
    fn stt_vocab_is_deduped_bounded_and_keeps_newest() {
        let newest_first: Vec<String> = ["Tauri", "tauri", "Naman"].iter().map(|s| s.to_string()).chain((0..200).map(|i| format!("Word{i}"))).collect();
        let v = stt_vocab(&newest_first, 120);
        assert!(v.starts_with("Tauri, Naman, Word0"));
        assert!(v.len() <= 120);
        assert!(!v.contains("tauri"));
        assert_eq!(stt_vocab(&[], 100), "");
    }
}

#[cfg(test)]
mod tidy_tests {
    use super::*;

    #[test]
    fn adds_the_missing_space_after_sentence_punctuation() {
        assert_eq!(tidy_transcript("proper combination of colors.Like light theme I want,Light theme"), "proper combination of colors. Like light theme I want, light theme");
        assert_eq!(tidy_transcript("Really?Yes!Great"), "Really? Yes! Great");
    }

    #[test]
    fn leaves_urls_numbers_emails_files_and_abbreviations_alone() {
        for t in [
            "Version 3.5 is out",
            "open https://example.com/a,b?x=1.Done",
            "mail naman@flo.app today",
            "send file.txt and Report.pdf",
            "e.g. this, i.e. that",
            "the U.S. team",
            "use Node.js now",
            "it costs 1,200 rupees",
        ] {
            assert_eq!(tidy_transcript(t), t);
        }
    }

    #[test]
    fn lowercases_mid_sentence_capitals_after_a_comma() {
        assert_eq!(tidy_transcript("I want light, Light is nice"), "I want light, light is nice");
        // names, "I" and words never seen lowercase stay
        assert_eq!(tidy_transcript("Thanks, Naman, I will"), "Thanks, Naman, I will");
        assert_eq!(tidy_transcript("Sure, The plan works"), "Sure, the plan works");
    }

    #[test]
    fn prefers_the_spelling_heard_right_elsewhere_in_the_same_dictation() {
        let t = "Like light theme I want, light Thim and yellow color, light thim and light blue color";
        assert_eq!(tidy_transcript(t), "Like light theme I want, light theme and yellow color, light theme and light blue color");
        // different words in different contexts are left alone
        assert_eq!(tidy_transcript("the team met Tim"), "the team met Tim");
    }

    #[test]
    fn real_dictation_from_0_1_2() {
        let raw = "Create attractive PDF with round corners with green gradients of proper combination of colors.Like light theme I want,Light, Thim and Yellow color Light, Thim and Light Blue color";
        let out = tidy_transcript(raw);
        assert!(out.contains("colors. Like light theme I want, light, theme and"), "{out}");
        assert!(!out.contains("Thim"), "{out}");
    }
}

#[cfg(test)]
mod script_tests {
    use super::*;

    #[test]
    fn devanagari_rescripts_to_gujarati_letter_for_letter() {
        // Whisper's Hindi decode of Gujarati speech (ElevenLabs clip "gu1"), rescripted
        assert_eq!(
            devanagari_to_gujarati("काले सवारे 10 वागे meeting छे, बध्धाने याद करावी दे जो."),
            "કાલે સવારે 10 વાગે meeting છે, બધ્ધાને યાદ કરાવી દે જો."
        );
        // nukta letters lose the nukta (Gujarati doesn't write it), danda becomes a full stop
        assert_eq!(devanagari_to_gujarati("ज़रूर फ़ोन करो।"), "જરૂર ફોન કરો.");
        // chandrabindu, anusvara, candra o
        assert_eq!(devanagari_to_gujarati("हाँ ऑफिस में"), "હાઁ ઑફિસ મેં");
        // letters without a Gujarati twin fall back to the nearest one, never a missing code point
        let out = devanagari_to_gujarati("ऩ ऱ ऴ");
        assert_eq!(out, "ન ર ળ");
        // English and Gujarati text pass through untouched
        assert_eq!(devanagari_to_gujarati("Send it. આજે"), "Send it. આજે");
    }

    #[test]
    fn gujarati_rescripts_to_devanagari_and_back() {
        assert_eq!(gujarati_to_devanagari("આજે મીટિંગ છે, Rahul."), "आजे मीटिंग छे, Rahul.");
        let g = "તમે સાંજે બજારમાંથી દૂધ અને શાકભાજી લાવશો?";
        assert_eq!(devanagari_to_gujarati(&gujarati_to_devanagari(g)), g);
    }
}
