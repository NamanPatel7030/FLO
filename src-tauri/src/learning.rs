//! Flo learns, on this computer only.
//!
//! 1. Screen-aware vocabulary: when the Flo key goes down, read the text around the focus (the
//!    focused window's accessibility text; on-device OCR of that window only when accessibility
//!    gives nothing, cached per window) and pull out the names, product names, jargon and
//!    identifiers on it. After speech-to-text, transcript words that sound like one of them and are
//!    spelled close to it are corrected ("tori" → "Tauri", "a venue or" → "Avenuor"), and the top
//!    terms ride along as spelling hints when AI cleanup runs. Everyday words are never touched.
//! 2. Learning from edits: what the user changes in text Flo typed (corrections.rs watches the
//!    field) is counted here; a fix is applied by itself once seen twice, or once when the word is
//!    on screen. Re-asking the assistant with one word changed counts the same way.
//! 3. Per-app style: what the user keeps in each app (length, casual or formal, sign-off, emoji,
//!    the final full stop) becomes a one-line hint for the cleanup prompt.
//!
//! Privacy: everything is stored in Flo's encrypted local database and listed in Settings →
//! Dictionary → Learning ("What Flo learned"), where it can be deleted. Nothing is read in apps on the
//! Attention denylist, in Flo itself, or while a password field is focused. Screen words only go to
//! a cloud AI model when the user allowed Attention to use cloud AI.
use crate::db::Db;
use crate::model::Settings;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

// ── everyday words ───────────────────────────────────────────────────────────────────────────────

/// ~12,500 everyday English words (and their forms), one per line: SCOWL size 10 + 20 english and
/// american lists, lowercase only. Permissive licence (Kevin Atkinson's SCOWL, wordlist.aspell.net);
/// the notice is in learning_words.LICENSE next to this file and must ship with it.
const WORDS: &str = include_str!("learning_words.txt");
/// Function words: a phrase made only of these ("to do", "any one") is never joined into a term.
const FUNCTION_WORDS: &[&str] = &[
    "a", "an", "the", "and", "or", "but", "nor", "so", "yet", "if", "then", "than", "as", "because", "while", "though",
    "of", "to", "in", "on", "at", "by", "for", "with", "from", "into", "onto", "upon", "out", "up", "down", "off", "over",
    "under", "about", "above", "below", "after", "before", "since", "until", "till", "through", "across", "along",
    "around", "between", "among", "against", "without", "within", "via", "per", "near", "behind", "beside", "past",
    "i", "me", "my", "mine", "myself", "we", "us", "our", "ours", "you", "your", "yours", "he", "him", "his", "she", "her",
    "hers", "it", "its", "they", "them", "their", "theirs", "this", "that", "these", "those", "who", "whom", "whose",
    "which", "what", "when", "where", "why", "how", "all", "any", "some", "no", "not", "none", "each", "every", "both",
    "either", "neither", "one", "ones", "other", "another", "such", "own", "same", "few", "many", "much", "more", "most",
    "less", "least", "very", "too", "also", "just", "only", "even", "still", "again", "ever", "never", "always", "now",
    "here", "there", "well", "back", "away", "once", "twice", "is", "am", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "having", "do", "does", "did", "doing", "done", "will", "would", "shall", "should", "can",
    "could", "may", "might", "must", "get", "got", "go", "goes", "going", "went", "make", "made", "let", "lets", "say",
    "said", "see", "know", "think", "want", "need", "like", "use", "take", "give", "come", "put", "set", "way", "thing",
    "things", "time", "day", "new", "old", "good", "great", "two", "three", "first", "last", "next", "yes", "ok",
];
/// Words the everyday list misses (contractions, chat words, weekdays).
const EXTRA_COMMON: &[&str] = &[
    "i'm", "i'll", "i've", "i'd", "it's", "don't", "can't", "won't", "isn't", "didn't", "doesn't", "that's", "there's",
    "you're", "we're", "they're", "let's", "ok", "okay", "yeah", "yep", "nope", "hey", "hi", "hello", "thanks", "thank",
    "lol", "btw", "pls", "am", "pm", "today", "tomorrow", "yesterday", "tonight", "monday", "tuesday", "wednesday",
    "thursday", "friday", "saturday", "sunday", "gonna", "wanna", "gotta", "kinda", "sorta", "cheers", "regards", "dev", "devs", "app", "apps", "repo", "email",
];
/// Window chrome that is on every screen and never what the user means.
const UI_WORDS: &[&str] = &[
    "file", "edit", "view", "window", "help", "search", "settings", "message", "messages", "reply", "replies", "thread",
    "threads", "channel", "channels", "direct", "inbox", "sent", "drafts", "draft", "compose", "send", "share", "new",
    "untitled", "home", "activity", "later", "more", "unread", "mentions", "reactions", "huddle", "huddles", "canvas",
    "bookmarks", "pinned", "members", "online", "away", "today", "yesterday", "edited", "attachments",
];

struct Lexicon {
    words: HashSet<&'static str>,
    function: HashSet<&'static str>,
    extra: HashSet<&'static str>,
    ui: HashSet<&'static str>,
}

fn lexicon() -> &'static Lexicon {
    static L: OnceLock<Lexicon> = OnceLock::new();
    L.get_or_init(|| Lexicon {
        words: WORDS.lines().map(str::trim).filter(|w| !w.is_empty()).collect(),
        function: FUNCTION_WORDS.iter().copied().collect(),
        extra: EXTRA_COMMON.iter().copied().collect(),
        ui: UI_WORDS.iter().copied().collect(),
    })
}

fn norm_word(w: &str) -> String {
    w.to_lowercase().replace('’', "'")
}

/// An everyday English word: never corrected into a term and never extracted as one.
pub fn is_common(w: &str) -> bool {
    let w = norm_word(w);
    let l = lexicon();
    l.words.contains(w.as_str()) || l.extra.contains(w.as_str())
}

fn is_function(w: &str) -> bool {
    let w = norm_word(w);
    let l = lexicon();
    l.function.contains(w.as_str()) || l.extra.contains(w.as_str())
}

fn is_ui(w: &str) -> bool {
    lexicon().ui.contains(norm_word(w).as_str())
}

// ── term extraction ──────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TermKind {
    /// a capitalised name or product ("Priya", "Tauri", "Priya Shah")
    Name,
    /// a mixed-case or all-caps word ("GitHub", "useStore", "AWS")
    Mixed,
    /// a lowercase word that isn't English ("kubectl", "avenuor" in #avenuor-dev)
    Jargon,
    /// a URL, an email or a code identifier (spelling hint for the AI only)
    Code,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Term {
    pub text: String,
    pub kind: TermKind,
    /// times it appears in the text
    pub count: u32,
    /// used as a name (capitalised in the middle of a sentence, or a short label line), so
    /// fixing only its capitals ("priya" → "Priya") is safe
    pub proper: bool,
}

fn is_url(t: &str) -> bool {
    let l = t.to_lowercase();
    l.starts_with("http://") || l.starts_with("https://") || l.starts_with("www.")
}

fn is_email(t: &str) -> bool {
    let Some((a, b)) = t.split_once('@') else { return false };
    !a.is_empty() && b.contains('.') && !b.starts_with('.') && !b.ends_with('.')
}

fn has_vowel(w: &str) -> bool {
    w.chars().any(|c| "aeiouyAEIOUY".contains(c))
}

/// Shape of a single word: (kind, proper-by-shape). None = not a term.
fn shape(w: &str) -> Option<(TermKind, bool)> {
    let letters = w.chars().filter(|c| c.is_alphabetic()).count();
    if letters < 2 || !w.chars().all(|c| c.is_alphanumeric() || c == '\'' || c == '’' || c == '-') {
        return None;
    }
    if w.chars().any(|c| c.is_ascii_digit()) {
        return None; // versions, times, counts
    }
    let upper = w.chars().filter(|c| c.is_uppercase()).count();
    let first_upper = w.chars().next().map(char::is_uppercase).unwrap_or(false);
    if upper == letters {
        // AWS, CI, PR: acronyms
        return (2..=6).contains(&letters).then_some((TermKind::Mixed, true));
    }
    if upper > 1 || (upper == 1 && !first_upper) {
        return Some((TermKind::Mixed, true)); // GitHub, iPhone, useStore
    }
    if letters < 3 || !has_vowel(w) {
        return None;
    }
    if first_upper {
        Some((TermKind::Name, false))
    } else {
        Some((TermKind::Jargon, false))
    }
}

/// Names, product names, jargon and identifiers in screen text, most useful first (at most `max`).
pub fn extract_terms(text: &str, max: usize) -> Vec<Term> {
    let mut found: Vec<Term> = vec![];
    let mut index: HashMap<String, usize> = HashMap::new();
    // lowercase words seen in running text: a capitalised one of these is just a sentence start
    let mut lower_in_prose: HashSet<String> = HashSet::new();
    let mut add = |found: &mut Vec<Term>, text: String, kind: TermKind, proper: bool| {
        if let Some(&i) = index.get(&text) {
            found[i].count += 1;
            found[i].proper |= proper;
        } else {
            index.insert(text.clone(), found.len());
            found.push(Term { text, kind, count: 1, proper });
        }
    };
    for line in text.lines() {
        let tokens: Vec<&str> = line.split_whitespace().collect();
        if tokens.is_empty() {
            continue;
        }
        let label = tokens.len() <= 4;
        let mut sentence_start = true;
        let mut run: Vec<String> = vec![];
        let flush = |run: &mut Vec<String>, found: &mut Vec<Term>, add: &mut dyn FnMut(&mut Vec<Term>, String, TermKind, bool)| {
            if run.len() >= 2 && run.len() <= 3 {
                add(found, run.join(" "), TermKind::Name, true);
            }
            run.clear();
        };
        for raw in tokens {
            let ends = raw.ends_with(['.', '!', '?', ':']);
            let core = raw.trim_matches(|c: char| !(c.is_alphanumeric() || c == '_' || c == '#' || c == '@'));
            if is_url(raw) || is_email(core) {
                flush(&mut run, &mut found, &mut add);
                add(&mut found, core.trim_end_matches(['/', '.']).to_string(), TermKind::Code, false);
                sentence_start = ends;
                continue;
            }
            // #channel / @handle: its words are the user's vocabulary even in lowercase
            if let Some(rest) = core.strip_prefix('#').or_else(|| core.strip_prefix('@')) {
                flush(&mut run, &mut found, &mut add);
                for part in rest.split(['-', '_', '.']) {
                    if let Some((kind, proper)) = shape(part) {
                        if !is_common(part) && !is_ui(part) {
                            add(&mut found, part.to_string(), kind, proper);
                        }
                    }
                }
                sentence_start = ends;
                continue;
            }
            let core = core.trim_matches(|c: char| c == '#' || c == '@');
            // code identifiers: snake_case, dotted.names, call() — hints for the AI only
            let inner = raw.trim_matches(|c: char| !c.is_alphanumeric());
            if inner.contains('_') || inner.contains("::") || raw.contains("()") || (inner.contains('.') && !inner.ends_with('.') && inner.split('.').all(|p| !p.is_empty() && p.chars().all(|c| c.is_alphanumeric()))) {
                flush(&mut run, &mut found, &mut add);
                if inner.chars().filter(|c| c.is_alphabetic()).count() >= 3 {
                    add(&mut found, inner.to_string(), TermKind::Code, false);
                }
                sentence_start = ends;
                continue;
            }
            let word = core.trim_end_matches("'s").trim_end_matches("’s");
            match shape(word) {
                Some((kind, by_shape)) if !is_common(word) && !is_ui(word) => {
                    let proper = by_shape || (kind == TermKind::Name && (!sentence_start || label));
                    if kind == TermKind::Name || kind == TermKind::Mixed {
                        run.push(word.to_string());
                    } else {
                        flush(&mut run, &mut found, &mut add);
                    }
                    add(&mut found, word.to_string(), kind, proper);
                }
                _ => {
                    flush(&mut run, &mut found, &mut add);
                    if word.chars().next().map(char::is_lowercase).unwrap_or(false) {
                        lower_in_prose.insert(word.to_lowercase());
                    }
                }
            }
            if ends || raw.ends_with(',') {
                flush(&mut run, &mut found, &mut add);
            }
            sentence_start = ends;
        }
        flush(&mut run, &mut found, &mut add);
    }
    // merge "avenuor" (channel) into "Avenuor"; a Name also written in lowercase prose isn't proper
    let caps: HashMap<String, usize> = found.iter().enumerate().filter(|(_, t)| t.kind != TermKind::Jargon).map(|(i, t)| (t.text.to_lowercase(), i)).collect();
    let mut drop = vec![false; found.len()];
    for i in 0..found.len() {
        if found[i].kind == TermKind::Jargon {
            if let Some(&j) = caps.get(&found[i].text) {
                found[j].count += found[i].count;
                drop[i] = true;
            }
        } else if found[i].kind == TermKind::Name && !found[i].text.contains(' ') && lower_in_prose.contains(&found[i].text.to_lowercase()) {
            found[i].proper = false;
        }
    }
    let mut out: Vec<Term> = found.into_iter().zip(drop).filter(|(_, d)| !d).map(|(t, _)| t).collect();
    let rank = |t: &Term| -> u32 {
        let base = match t.kind {
            TermKind::Name | TermKind::Mixed => 3,
            TermKind::Jargon => 2,
            TermKind::Code => 1,
        };
        base * 10 + t.count.min(9) + if t.proper { 5 } else { 0 }
    };
    out.sort_by(|a, b| rank(b).cmp(&rank(a)).then_with(|| a.text.cmp(&b.text)));
    out.truncate(max);
    out
}

// ── phonetics ────────────────────────────────────────────────────────────────────────────────────

/// A Metaphone-style sound key: "tori" and "Tauri" → "TR", "pria" → "PR", "avenue or" → "AFNR".
pub fn phonetic_key(s: &str) -> String {
    let w: Vec<char> = s.to_lowercase().chars().filter(|c| c.is_ascii_alphabetic()).collect();
    let n = w.len();
    let at = |k: usize| -> char { w.get(k).copied().unwrap_or('\0') };
    let vowel = |c: char| matches!(c, 'a' | 'e' | 'i' | 'o' | 'u');
    let front = |c: char| matches!(c, 'e' | 'i' | 'y');
    let mut out = String::new();
    let mut push = |c: char| {
        if !out.ends_with(c) {
            out.push(c);
        }
    };
    let mut i = 0;
    if n > 1 && matches!((w[0], w[1]), ('k', 'n') | ('g', 'n') | ('p', 'n') | ('w', 'r') | ('a', 'e')) {
        i = 1;
    }
    while i < n {
        let c = w[i];
        let prev = if i == 0 { '\0' } else { w[i - 1] };
        let next = at(i + 1);
        if c == prev && c != 'c' {
            i += 1;
            continue;
        }
        match c {
            'a' | 'e' | 'i' | 'o' | 'u' => {
                if i == 0 {
                    push('A');
                }
            }
            'b' => {
                if !(prev == 'm' && i + 1 == n) {
                    push('B');
                }
            }
            'c' => {
                if next == 'h' {
                    push('X');
                    i += 1;
                } else if front(next) {
                    push('S');
                } else {
                    push('K');
                }
            }
            'd' => {
                if next == 'g' && front(at(i + 2)) {
                    push('J');
                    i += 1;
                } else {
                    push('T');
                }
            }
            'g' => {
                if next == 'h' {
                    if vowel(at(i + 2)) {
                        push('K');
                    }
                    i += 1;
                } else if next == 'n' && (i + 2 == n) {
                    // "sign": silent
                } else if front(next) {
                    push('J');
                } else {
                    push('K');
                }
            }
            'h' => {
                if vowel(next) && !matches!(prev, 'c' | 's' | 'p' | 't' | 'g') {
                    push('H');
                }
            }
            'k' => {
                if prev != 'c' {
                    push('K');
                }
            }
            'p' => {
                if next == 'h' {
                    push('F');
                    i += 1;
                } else {
                    push('P');
                }
            }
            'q' => push('K'),
            's' => {
                if next == 'h' {
                    push('X');
                    i += 1;
                } else if next == 'i' && matches!(at(i + 2), 'o' | 'a') {
                    push('X');
                } else {
                    push('S');
                }
            }
            't' => {
                if next == 'h' {
                    push('0');
                    i += 1;
                } else if next == 'i' && matches!(at(i + 2), 'o' | 'a') {
                    push('X');
                } else if !(next == 'c' && at(i + 2) == 'h') {
                    push('T');
                }
            }
            'v' => push('F'),
            'w' => {
                if vowel(next) {
                    push('W');
                }
            }
            'x' => {
                push('K');
                push('S');
            }
            'y' => {
                if vowel(next) {
                    push('Y');
                }
            }
            'z' => push('S'),
            c => push(c.to_ascii_uppercase()),
        }
        i += 1;
    }
    out
}

fn similarity(a: &str, b: &str) -> f32 {
    let n = a.chars().count().max(b.chars().count());
    if n == 0 {
        return 1.0;
    }
    1.0 - crate::text::levenshtein(a, b) as f32 / n as f32
}

/// "deploy" → "deployed", "app" → "apps": a different form of the same word, not a mishearing.
fn inflection(a: &str, b: &str) -> bool {
    let (s, l) = if a.len() <= b.len() { (a, b) } else { (b, a) };
    l.strip_prefix(s).map(|rest| ["s", "es", "ed", "d", "ing", "'s", "er", "ers", "ly"].contains(&rest)).unwrap_or(false)
}

// ── correcting a transcript ──────────────────────────────────────────────────────────────────────

/// Where a term comes from, which sets how sure a match must be.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Trust {
    /// on the screen right now
    OnScreen,
    /// in the user's dictionary
    Dictionary,
    /// seen on this app's screens before (at least twice)
    Learned,
}

impl Trust {
    fn threshold(self) -> f32 {
        match self {
            Trust::OnScreen => 0.72,
            Trust::Dictionary => 0.75,
            Trust::Learned => 0.80,
        }
    }
}

#[derive(Debug, Clone)]
struct Candidate {
    text: String,
    /// lowercase letters and digits only ("Priya Shah" → "priyashah")
    joined: String,
    key: String,
    proper: bool,
    trust: Trust,
    words: usize,
}

fn joined(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// The terms one dictation is corrected against.
#[derive(Debug, Clone, Default)]
pub struct TermSet {
    cands: Vec<Candidate>,
    by_joined: HashMap<String, usize>,
    /// (heard, term) pairs the user undid before: never again
    blocked: HashSet<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fix {
    pub from: String,
    pub to: String,
}

impl TermSet {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_empty(&self) -> bool {
        self.cands.is_empty()
    }

    pub fn len(&self) -> usize {
        self.cands.len()
    }

    /// Add a term. The most trusted source wins when the same term comes from several.
    pub fn add(&mut self, text: &str, proper: bool, trust: Trust) {
        let text = text.trim();
        let j = joined(text);
        if j.chars().count() < 3 || (text.split_whitespace().count() == 1 && is_common(text)) {
            return;
        }
        if let Some(&i) = self.by_joined.get(&j) {
            let c = &mut self.cands[i];
            c.proper |= proper;
            if trust < c.trust {
                c.trust = trust;
            }
            return;
        }
        self.by_joined.insert(j.clone(), self.cands.len());
        self.cands.push(Candidate { key: phonetic_key(&j), joined: j, text: text.to_string(), proper, trust, words: text.split_whitespace().count() });
    }

    pub fn block(&mut self, heard: &str, term: &str) {
        self.blocked.insert((joined(heard), joined(term)));
    }

    /// Is this word one of the terms (any spelling of its capitals)?
    pub fn contains(&self, word: &str) -> bool {
        self.by_joined.contains_key(&joined(word))
    }

    pub fn on_screen(&self, word: &str) -> bool {
        self.by_joined.get(&joined(word)).map(|&i| self.cands[i].trust == Trust::OnScreen).unwrap_or(false)
    }

    /// The best term for `words` (1–3 transcript words read as one), with its score.
    fn best_for(&self, words: &[&str]) -> Option<(&Candidate, f32)> {
        let n = words.len();
        if n == 1 && is_common(words[0]) {
            return None;
        }
        if n > 1 && words.iter().all(|w| is_function(w)) {
            return None; // "to do" is never "Todo"
        }
        if words.iter().any(|w| w.chars().any(|c| c.is_ascii_digit())) {
            return None;
        }
        let j = joined(&words.concat());
        let len = j.chars().count();
        if len < 3 {
            return None;
        }
        if let Some(&i) = self.by_joined.get(&j) {
            let c = &self.cands[i];
            let same = words.join(" ") == c.text || (n == 1 && words[0] == c.text);
            // a known term already: fix its capitals / spacing only when that is safe
            if same || self.blocked.contains(&(j.clone(), c.joined.clone())) {
                return None;
            }
            if n == 1 && c.words == 1 && !(c.proper || c.trust == Trust::Dictionary) {
                return None;
            }
            return Some((c, 1.0));
        }
        let key = phonetic_key(&j);
        let first = key.chars().next();
        let mut best: Option<(&Candidate, f32)> = None;
        let mut second = 0.0f32;
        for c in &self.cands {
            let cl = c.joined.chars().count();
            let (s, l) = (cl.min(len) as f32, cl.max(len) as f32);
            if s / l < 0.6 || c.key.chars().next() != first || inflection(&j, &c.joined) {
                continue;
            }
            if n == 1 && c.words > 1 {
                continue;
            }
            if self.blocked.contains(&(j.clone(), c.joined.clone())) {
                continue;
            }
            let score = 0.6 * similarity(&j, &c.joined) + 0.4 * similarity(&key, &c.key);
            let need = c.trust.threshold() + if n > 1 { 0.06 } else { 0.0 };
            if score < need {
                continue;
            }
            match best {
                Some((b, bs)) if score <= bs => {
                    if b.joined != c.joined {
                        second = second.max(score);
                    }
                }
                Some((_, bs)) => {
                    second = second.max(bs);
                    best = Some((c, score));
                }
                None => best = Some((c, score)),
            }
        }
        let (c, s) = best?;
        // two terms fit about as well: don't guess
        if second > 0.0 && s - second < 0.03 {
            return None;
        }
        Some((c, s))
    }

    /// Spelling hints for the AI cleanup: the terms on screen first, then dictionary, then learned.
    pub fn hints(&self, max: usize) -> Vec<String> {
        let mut c: Vec<&Candidate> = self.cands.iter().collect();
        c.sort_by_key(|c| (c.trust, !c.proper));
        c.into_iter().take(max).map(|c| c.text.clone()).collect()
    }
}

struct Tok<'a> {
    start: usize,
    end: usize,
    word: &'a str,
}

fn tokens(text: &str) -> Vec<Tok<'_>> {
    let mut out = vec![];
    let mut start: Option<usize> = None;
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    for (k, &(i, c)) in chars.iter().enumerate() {
        let joiner = (c == '\'' || c == '’' || c == '-') && start.is_some() && chars.get(k + 1).map(|(_, n)| n.is_alphanumeric()).unwrap_or(false);
        if c.is_alphanumeric() || joiner {
            start.get_or_insert(i);
        } else if let Some(s) = start.take() {
            out.push(Tok { start: s, end: i, word: &text[s..i] });
        }
    }
    if let Some(s) = start {
        out.push(Tok { start: s, end: text.len(), word: &text[s..] });
    }
    out
}

/// Correct transcript words that sound like a term and are spelled close to it. Returns the text
/// and the fixes made. Everyday words, numbers and words already spelled as a term stay as they are.
pub fn correct(text: &str, set: &TermSet) -> (String, Vec<Fix>) {
    if set.is_empty() {
        return (text.to_string(), vec![]);
    }
    let toks = tokens(text);
    let mut out = String::with_capacity(text.len() + 8);
    let mut fixes = vec![];
    let mut last = 0;
    let mut i = 0;
    while i < toks.len() {
        let mut pick: Option<(usize, String, f32, &str)> = None; // (n, replacement, score, possessive)
        for n in 1..=3usize {
            if i + n > toks.len() {
                break;
            }
            if n > 1 && !(0..n - 1).all(|k| &text[toks[i + k].end..toks[i + k + 1].start] == " ") {
                break;
            }
            let mut words: Vec<&str> = toks[i..i + n].iter().map(|t| t.word).collect();
            let tail = words[n - 1];
            let poss = ["'s", "’s"].iter().find(|p| tail.len() > 3 && tail.ends_with(*p)).copied().unwrap_or("");
            words[n - 1] = &tail[..tail.len() - poss.len()];
            if let Some((c, score)) = set.best_for(&words) {
                // "on Avenor" is "on" + "Avenuor", not one misheard word: an edge function word
                // stays when the phrase without it fits as well (or already is the term)
                let trimmed = |rest: &[&str]| set.contains(&rest.concat()) || set.best_for(rest).map(|(_, s)| s >= score - 0.05).unwrap_or(false);
                if n > 1 && ((is_function(words[0]) && trimmed(&words[1..])) || (is_function(words[n - 1]) && trimmed(&words[..n - 1]))) {
                    continue;
                }
                if pick.as_ref().map(|p| score > p.2 + 0.01).unwrap_or(true) {
                    pick = Some((n, c.text.clone(), score, poss));
                }
            }
        }
        match pick {
            Some((n, to, _, poss)) => {
                let (s, e) = (toks[i].start, toks[i + n - 1].end);
                out.push_str(&text[last..s]);
                out.push_str(&to);
                out.push_str(poss);
                fixes.push(Fix { from: text[s..e].trim_end_matches(poss).to_string(), to });
                last = e;
                i += n;
            }
            None => i += 1,
        }
    }
    out.push_str(&text[last..]);
    (out, fixes)
}

// ── thresholds ───────────────────────────────────────────────────────────────────────────────────

/// Apply a fix the user made by itself? Once seen twice, or once when the word is on screen.
pub fn should_apply(count: u32, on_screen: bool) -> bool {
    count >= 2 || (count >= 1 && on_screen)
}

/// A re-asked assistant question with one or two words changed ("open tori docs" → "open Tauri
/// docs"): the words that changed, when the rest stayed the same.
pub fn reask_fixes(first: &str, second: &str) -> Vec<(String, String)> {
    let (a, b) = (first.split_whitespace().count(), second.split_whitespace().count());
    if a < 2 || b < 2 || a.abs_diff(b) > 2 || first.trim().eq_ignore_ascii_case(second.trim()) {
        return vec![];
    }
    let fixes = crate::text::detect_corrections(first, first, second);
    let changed: usize = fixes.iter().map(|(h, _)| h.split_whitespace().count()).sum();
    if changed == 0 || changed * 3 > a {
        return vec![];
    }
    fixes
}

// ── per-app style ────────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct StyleSample {
    pub words: u32,
    pub emoji: bool,
    pub signoff: Option<String>,
    pub casual: bool,
    pub formal: bool,
    pub lower_start: bool,
    pub final_period: bool,
}

fn is_emoji(c: char) -> bool {
    matches!(c as u32, 0x1F300..=0x1FAFF | 0x2600..=0x27BF | 0x1F000..=0x1F2FF)
}

const SIGNOFFS: &[&str] = &["thanks", "thank you", "cheers", "best", "best regards", "regards", "kind regards", "warm regards", "thx", "ty", "sincerely", "talk soon"];

/// What one message the user kept says about their style there.
pub fn style_sample(text: &str) -> Option<StyleSample> {
    let t = text.trim();
    let words = t.split_whitespace().count() as u32;
    if words < 2 {
        return None;
    }
    let lines: Vec<&str> = t.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let lower = t.to_lowercase();
    // a sign-off: a short closing line ("Thanks,", "Cheers, Naman") at the end
    let signoff = lines.iter().rev().take(2).find_map(|l| {
        let ll = l.to_lowercase();
        let ll = ll.trim_end_matches([',', '.', '!']);
        SIGNOFFS.iter().find(|s| ll == **s || ll.starts_with(&format!("{s},")) || ll.starts_with(&format!("{s} "))).map(|_| l.to_string())
    });
    let first = t.chars().find(|c| c.is_alphabetic());
    let casual_cues = ["hey", "lol", "haha", "gonna", "wanna", "yeah", "yep", "btw", "pls", "thx", "np", "ya "];
    let formal_cues = ["dear ", "regards", "sincerely", "please find", "i hope this", "kindly", "best wishes"];
    let ends_char = t.chars().rev().find(|c| !c.is_whitespace() && !is_emoji(*c));
    Some(StyleSample {
        words,
        emoji: t.chars().any(is_emoji),
        signoff,
        casual: casual_cues.iter().any(|c| lower.starts_with(c) || lower.contains(&format!(" {c}"))) || t.contains(":)"),
        formal: formal_cues.iter().any(|c| lower.contains(c)),
        lower_start: first.map(char::is_lowercase).unwrap_or(false),
        final_period: ends_char == Some('.'),
    })
}

/// What Flo knows about the user's style in one app.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppStyle {
    pub samples: u32,
    pub words: u32,
    pub emoji: u32,
    pub signoffs: u32,
    pub casual: u32,
    pub formal: u32,
    pub lower_start: u32,
    pub final_period: u32,
    pub last_signoff: String,
}

/// Samples needed before Flo says anything about an app's style.
pub const STYLE_MIN_SAMPLES: u32 = 3;

impl AppStyle {
    pub fn add(&mut self, s: &StyleSample) {
        self.samples += 1;
        self.words += s.words;
        self.emoji += s.emoji as u32;
        self.casual += s.casual as u32;
        self.formal += s.formal as u32;
        self.lower_start += s.lower_start as u32;
        self.final_period += s.final_period as u32;
        if let Some(so) = &s.signoff {
            self.signoffs += 1;
            self.last_signoff = so.chars().take(40).collect();
        }
    }

    fn share(&self, n: u32) -> f32 {
        n as f32 / self.samples.max(1) as f32
    }

    /// The user deletes Flo's final full stop here (most of the time, short messages).
    pub fn drops_final_period(&self) -> bool {
        self.samples >= 5 && self.share(self.final_period) <= 0.2 && self.words / self.samples.max(1) <= 25
    }

    /// One line for the cleanup prompt, or None while there are too few samples.
    pub fn hint(&self, app: &str, with_signoff: bool) -> Option<String> {
        if self.samples < STYLE_MIN_SAMPLES {
            return None;
        }
        let avg = self.words / self.samples;
        let mut parts: Vec<String> = vec![];
        parts.push(if avg <= 15 { "short messages".into() } else if avg <= 60 { "medium-length messages".into() } else { "long messages".into() });
        if self.share(self.formal) >= 0.5 {
            parts.push("formal".into());
        } else if self.share(self.casual) >= 0.4 {
            parts.push("casual".into());
        }
        if self.share(self.lower_start) >= 0.6 {
            parts.push("starts in lowercase".into());
        }
        if self.share(self.final_period) <= 0.2 {
            parts.push("no full stop at the end".into());
        }
        if self.share(self.emoji) >= 0.4 {
            parts.push("uses emoji".into());
        }
        if self.share(self.signoffs) >= 0.5 && with_signoff && !self.last_signoff.is_empty() {
            parts.push(format!("signs off \"{}\"", self.last_signoff.replace('"', "'")));
        } else if self.share(self.signoffs) <= 0.1 {
            parts.push("no sign-off".into());
        }
        let app: String = app.chars().filter(|c| !c.is_control() && *c != '"').take(40).collect();
        Some(format!("In {app} the user writes: {}. Match that punctuation and capitalisation; don't add or remove words.", parts.join(", ")))
    }
}

/// The one style rule applied without AI: no final full stop on a short one-sentence message
/// where the user always removes it.
pub fn apply_style_local(text: &str, style: &AppStyle) -> String {
    let t = text.trim_end();
    if !style.drops_final_period() || !t.ends_with('.') || t.ends_with("..") {
        return text.to_string();
    }
    let body = &t[..t.len() - 1];
    if body.contains(['.', '!', '?', '\n']) {
        return text.to_string(); // several sentences: keep the punctuation
    }
    body.to_string()
}

// ── privacy ──────────────────────────────────────────────────────────────────────────────────────

/// Never read: apps on the Attention denylist, Flo itself, unknown apps.
pub fn denied_app(app: &str, title: &str, denylist: &[String]) -> bool {
    let a = app.to_lowercase();
    a.trim().is_empty()
        || crate::capture::is_flo_window(app, title)
        || a.contains("flo flow")
        || denylist.iter().any(|d| !d.trim().is_empty() && a.contains(&d.trim().to_lowercase()))
}

/// May Flo read the screen around the focus for this dictation?
pub fn screen_allowed(s: &Settings, app: &str, title: &str) -> bool {
    s.learn_from_screen && !denied_app(app, title, &s.attention_denylist)
}

/// May screen words go to the cleanup model? Always for a local model; a cloud model only when the
/// user allowed Attention to send screen text to cloud AI.
pub fn hints_allowed(s: &Settings) -> bool {
    !crate::settings::is_cloud_llm(&s.llm_provider) || s.attention_cloud_allowed
}

// ── storage (Flo's encrypted local database) ─────────────────────────────────────────────────────

pub const SCHEMA: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS learned_terms(term TEXT NOT NULL, app TEXT NOT NULL, kind TEXT NOT NULL, proper INTEGER NOT NULL DEFAULT 0,
      count INTEGER NOT NULL DEFAULT 0, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, PRIMARY KEY(term, app))",
    "CREATE TABLE IF NOT EXISTS learned_fixes(heard TEXT NOT NULL, corrected TEXT NOT NULL, app TEXT NOT NULL, source TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0, applied INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0,
      first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, PRIMARY KEY(heard, corrected))",
    "CREATE TABLE IF NOT EXISTS app_styles(app TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL)",
];

/// Most terms kept (oldest forgotten first).
const MAX_TERMS: i64 = 3000;

pub fn store_terms(db: &Db, app: &str, terms: &[Term]) -> anyhow::Result<()> {
    if terms.is_empty() || app.trim().is_empty() {
        return Ok(());
    }
    let now = crate::db::now();
    db.with_conn(|c| -> anyhow::Result<()> {
        let tx = c.unchecked_transaction()?;
        for t in terms.iter().filter(|t| t.kind != TermKind::Code) {
            let kind = serde_json::to_value(t.kind)?.as_str().unwrap_or("name").to_string();
            tx.execute(
                "INSERT INTO learned_terms VALUES (?1,?2,?3,?4,1,?5,?5)
                 ON CONFLICT(term, app) DO UPDATE SET count = count + 1, last_seen = ?5, proper = MAX(proper, ?4)",
                params![t.text, app, kind, t.proper as i64, now],
            )?;
        }
        tx.execute(
            "DELETE FROM learned_terms WHERE rowid IN (SELECT rowid FROM learned_terms ORDER BY last_seen DESC LIMIT -1 OFFSET ?1)",
            [MAX_TERMS],
        )?;
        tx.commit()?;
        Ok(())
    })
}

/// Terms seen at least twice on this app's screens, newest first: (term, proper).
pub fn stored_terms(db: &Db, app: &str, limit: usize) -> Vec<(String, bool)> {
    db.with_conn(|c| {
        let Ok(mut st) = c.prepare("SELECT term, proper FROM learned_terms WHERE app = ?1 AND count >= 2 ORDER BY last_seen DESC, count DESC LIMIT ?2") else {
            return vec![];
        };
        st.query_map(params![app, limit as i64], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? != 0)))
            .map(|rows| rows.flatten().collect())
            .unwrap_or_default()
    })
}

/// Count a fix the user made ("Pria" → "Priya"). Returns (times seen, already applied, blocked).
pub fn record_fix(db: &Db, heard: &str, corrected: &str, app: &str, source: &str) -> anyhow::Result<(u32, bool, bool)> {
    let now = crate::db::now();
    db.with_conn(|c| -> anyhow::Result<(u32, bool, bool)> {
        c.execute(
            "INSERT INTO learned_fixes VALUES (?1,?2,?3,?4,1,0,0,?5,?5)
             ON CONFLICT(heard, corrected) DO UPDATE SET count = count + 1, last_seen = ?5, app = ?3",
            params![heard.trim(), corrected.trim(), app, source, now],
        )?;
        let (n, applied, blocked): (i64, i64, i64) =
            c.query_row("SELECT count, applied, blocked FROM learned_fixes WHERE heard = ?1 AND corrected = ?2", params![heard.trim(), corrected.trim()], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        Ok((n as u32, applied != 0, blocked != 0))
    })
}

pub fn mark_applied(db: &Db, heard: &str, corrected: &str) -> anyhow::Result<()> {
    db.with_conn(|c| c.execute("UPDATE learned_fixes SET applied = 1 WHERE heard = ?1 AND corrected = ?2", params![heard.trim(), corrected.trim()]))?;
    Ok(())
}

/// The user put back what they said after Flo changed it to a screen term: never make that change
/// again.
pub fn block_fix(db: &Db, heard: &str, term: &str, app: &str) -> anyhow::Result<()> {
    let now = crate::db::now();
    db.with_conn(|c| {
        c.execute(
            "INSERT INTO learned_fixes VALUES (?1,?2,?3,'undo',1,0,1,?4,?4)
             ON CONFLICT(heard, corrected) DO UPDATE SET blocked = 1, last_seen = ?4",
            params![heard.trim(), term.trim(), app, now],
        )
    })?;
    Ok(())
}

/// (heard, term) pairs never to change again.
pub fn blocked_fixes(db: &Db) -> Vec<(String, String)> {
    db.with_conn(|c| {
        let Ok(mut st) = c.prepare("SELECT heard, corrected FROM learned_fixes WHERE blocked = 1") else { return vec![] };
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map(|rows| rows.flatten().collect()).unwrap_or_default()
    })
}

pub fn add_style_sample(db: &Db, app: &str, sample: &StyleSample) -> anyhow::Result<AppStyle> {
    let mut s = app_style(db, app).unwrap_or_default();
    s.add(sample);
    let json = serde_json::to_string(&s)?;
    db.with_conn(|c| {
        c.execute(
            "INSERT INTO app_styles VALUES (?1,?2,?3) ON CONFLICT(app) DO UPDATE SET json = ?2, updated_at = ?3",
            params![app, json, crate::db::now()],
        )
    })?;
    Ok(s)
}

pub fn app_style(db: &Db, app: &str) -> Option<AppStyle> {
    db.with_conn(|c| c.query_row("SELECT json FROM app_styles WHERE app = ?1", [app], |r| r.get::<_, String>(0)).optional().ok().flatten())
        .and_then(|j| serde_json::from_str(&j).ok())
}

// ── what Flo learned (Settings) ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LearnedTerm {
    pub id: String,
    pub term: String,
    pub app: String,
    pub kind: String,
    pub count: u32,
    pub last_seen: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LearnedFix {
    pub id: String,
    pub heard: String,
    pub corrected: String,
    pub app: String,
    /// "edit" | "assistant" | "undo"
    pub source: String,
    pub count: u32,
    pub applied: bool,
    pub blocked: bool,
    pub last_seen: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LearnedStyle {
    pub app: String,
    pub samples: u32,
    pub hint: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct LearningOverview {
    pub terms: Vec<LearnedTerm>,
    pub fixes: Vec<LearnedFix>,
    pub styles: Vec<LearnedStyle>,
}

fn id2(a: &str, b: &str) -> String {
    format!("{a}\u{1f}{b}")
}

pub fn overview(db: &Db) -> LearningOverview {
    db.with_conn(|c| {
        let terms = c
            .prepare("SELECT term, app, kind, count, last_seen FROM learned_terms ORDER BY last_seen DESC, count DESC LIMIT 500")
            .and_then(|mut st| {
                st.query_map([], |r| {
                    let (term, app): (String, String) = (r.get(0)?, r.get(1)?);
                    Ok(LearnedTerm { id: id2(&term, &app), term, app, kind: r.get(2)?, count: r.get::<_, i64>(3)? as u32, last_seen: r.get(4)? })
                })
                .map(|rows| rows.flatten().collect())
            })
            .unwrap_or_default();
        let fixes = c
            .prepare("SELECT heard, corrected, app, source, count, applied, blocked, last_seen FROM learned_fixes ORDER BY last_seen DESC LIMIT 500")
            .and_then(|mut st| {
                st.query_map([], |r| {
                    let (heard, corrected): (String, String) = (r.get(0)?, r.get(1)?);
                    Ok(LearnedFix {
                        id: id2(&heard, &corrected),
                        heard,
                        corrected,
                        app: r.get(2)?,
                        source: r.get(3)?,
                        count: r.get::<_, i64>(4)? as u32,
                        applied: r.get::<_, i64>(5)? != 0,
                        blocked: r.get::<_, i64>(6)? != 0,
                        last_seen: r.get(7)?,
                    })
                })
                .map(|rows| rows.flatten().collect())
            })
            .unwrap_or_default();
        let styles = c
            .prepare("SELECT app, json, updated_at FROM app_styles ORDER BY updated_at DESC")
            .and_then(|mut st| {
                st.query_map([], |r| {
                    let (app, json, updated_at): (String, String, String) = (r.get(0)?, r.get(1)?, r.get(2)?);
                    let s: AppStyle = serde_json::from_str(&json).unwrap_or_default();
                    Ok(LearnedStyle { hint: s.hint(&app, true), samples: s.samples, app, updated_at })
                })
                .map(|rows| rows.flatten().collect())
            })
            .unwrap_or_default();
        LearningOverview { terms, fixes, styles }
    })
}

/// Forget one learned item. A fix that Flo had added to the dictionary leaves it too.
pub fn forget(db: &Db, kind: &str, id: &str) -> anyhow::Result<()> {
    let (a, b) = id.split_once('\u{1f}').unwrap_or((id, ""));
    match kind {
        "term" => {
            db.with_conn(|c| c.execute("DELETE FROM learned_terms WHERE term = ?1 AND app = ?2", params![a, b]))?;
        }
        "fix" => {
            let applied: bool = db
                .with_conn(|c| c.query_row("SELECT applied FROM learned_fixes WHERE heard = ?1 AND corrected = ?2", params![a, b], |r| r.get::<_, i64>(0)).optional())?
                .map(|v| v != 0)
                .unwrap_or(false);
            db.with_conn(|c| c.execute("DELETE FROM learned_fixes WHERE heard = ?1 AND corrected = ?2", params![a, b]))?;
            if applied {
                for d in db.list_dictionary()? {
                    if d.word.eq_ignore_ascii_case(a) && d.replacement.as_deref() == Some(b) {
                        db.remove_dictionary(&d.id)?;
                    }
                }
            }
        }
        "style" => {
            db.with_conn(|c| c.execute("DELETE FROM app_styles WHERE app = ?1", [a]))?;
        }
        _ => anyhow::bail!("unknown kind {kind}"),
    }
    Ok(())
}

/// Forget everything learned (the dictionary entries the user saw saved stay; they're theirs).
pub fn clear(db: &Db) -> anyhow::Result<()> {
    db.with_conn(|c| c.execute_batch("DELETE FROM learned_terms; DELETE FROM learned_fixes; DELETE FROM app_styles;"))?;
    Ok(())
}

// ── screen context at dictation time ─────────────────────────────────────────────────────────────

/// What Flo read around the focus when the key went down.
#[derive(Debug, Clone, Default)]
pub struct ScreenContext {
    pub app: String,
    pub title: String,
    pub terms: Vec<Term>,
    /// "ax" | "ocr" | "cache"
    pub source: &'static str,
    pub ms: u128,
}

/// Accessibility text shorter than this falls back to OCR.
const AX_MIN_CHARS: usize = 80;
const OCR_CACHE_FOR: Duration = Duration::from_secs(120);
const MAX_SCREEN_TERMS: usize = 150;

struct Pending {
    started: Instant,
    ctx: Option<ScreenContext>,
}

static PENDING: parking_lot::Mutex<Option<Pending>> = parking_lot::Mutex::new(None);
/// OCR'd terms per window (app + title), so one window is OCR'd at most every two minutes.
static OCR_CACHE: parking_lot::Mutex<Option<HashMap<String, (Instant, Vec<Term>)>>> = parking_lot::Mutex::new(None);
/// The screen fixes made in the last dictation (to notice when the user puts a word back).
static LAST_FIXES: parking_lot::Mutex<Vec<Fix>> = parking_lot::Mutex::new(Vec::new());
/// The last assistant question (to notice a re-ask).
static LAST_ASK: parking_lot::Mutex<Option<(Instant, String, String)>> = parking_lot::Mutex::new(None);

/// Read the screen around the focus (blocking; call off the main thread). None when not allowed:
/// learning off, a denied app, a password field focused, or nothing readable.
pub fn read_context(s: &Settings, app: &str, screen_permission: bool) -> Option<ScreenContext> {
    let t0 = Instant::now();
    let title = crate::platform::frontmost_window_title().unwrap_or_default();
    if !screen_allowed(s, app, &title) {
        return None;
    }
    // Flo itself in front (the text goes to the last app): its window isn't the target's screen
    if crate::platform::frontmost_app().name != app {
        return None;
    }
    // the platform can't tell a password field from any other: read nothing
    let win = crate::platform::focused_window_text(12_000)?;
    if win.secure {
        log::info!("learning: secure input focused, not reading the screen");
        return None;
    }
    let key = format!("{app}\u{1f}{title}");
    let (terms, source) = if win.text.chars().count() >= AX_MIN_CHARS {
        (extract_terms(&win.text, MAX_SCREEN_TERMS), "ax")
    } else {
        let cached = OCR_CACHE.lock().as_ref().and_then(|m| m.get(&key)).filter(|(at, _)| at.elapsed() < OCR_CACHE_FOR).map(|(_, t)| t.clone());
        match cached {
            Some(t) => (t, "cache"),
            None if screen_permission => {
                let text = crate::attention::capture_focused_text().filter(|(a, t, _)| !denied_app(a, t, &s.attention_denylist)).map(|(_, _, t)| t)?;
                let terms = extract_terms(&format!("{}\n{text}", win.text), MAX_SCREEN_TERMS);
                let mut g = OCR_CACHE.lock();
                let m = g.get_or_insert_with(HashMap::new);
                m.retain(|_, (at, _)| at.elapsed() < OCR_CACHE_FOR);
                m.insert(key, (Instant::now(), terms.clone()));
                (terms, "ocr")
            }
            None => (extract_terms(&win.text, MAX_SCREEN_TERMS), "ax"),
        }
    };
    let mut terms = terms;
    for t in extract_terms(&title, 10) {
        if !terms.iter().any(|x| x.text == t.text) {
            terms.push(t);
        }
    }
    Some(ScreenContext { app: app.to_string(), title, terms, source, ms: t0.elapsed().as_millis() })
}

/// The Flo key went down: read the screen around the focus in the background.
pub fn begin(st: &crate::state::Shared, app: &str) {
    let started = Instant::now();
    *PENDING.lock() = Some(Pending { started, ctx: None });
    let s = st.settings();
    if !s.learn_from_screen {
        return;
    }
    let (st, app) = (st.clone(), app.to_string());
    std::thread::Builder::new()
        .name("flo-screen-words".into())
        .spawn(move || {
            let perm = crate::platform::permissions().screen;
            let ctx = read_context(&s, &app, perm);
            if let Some(c) = &ctx {
                log::info!("learning: {} screen words from {} via {} in {} ms", c.terms.len(), c.app, c.source, c.ms);
                if let Err(e) = store_terms(&st.db, &c.app, &c.terms) {
                    log::warn!("learning: store terms: {e}");
                }
            }
            let mut g = PENDING.lock();
            if let Some(p) = g.as_mut().filter(|p| p.started == started) {
                p.ctx = ctx;
            }
        })
        .ok();
}

/// Attention read a window: remember its words too (no extra capture).
pub fn observe_screen(st: &crate::state::Shared, app: &str, title: &str, text: &str) {
    let s = st.settings();
    if !screen_allowed(&s, app, title) {
        return;
    }
    if let Err(e) = store_terms(&st.db, app, &extract_terms(text, MAX_SCREEN_TERMS)) {
        log::warn!("learning: store attention terms: {e}");
    }
}

/// Everything one dictation is corrected and hinted with.
#[derive(Debug, Clone, Default)]
pub struct Prepared {
    pub terms: TermSet,
    /// spelling hints for the AI cleanup (empty when screen words may not go to that model)
    pub hints: Vec<String>,
    pub style_hint: Option<String>,
    pub style: Option<AppStyle>,
}

/// Build the term set for a dictation into `app`: the screen read at key-down, the user's
/// dictionary words, and words seen on this app's screens before.
pub fn prepare(st: &crate::state::Shared, app: &str) -> Prepared {
    let s = st.settings();
    let ctx = PENDING.lock().as_ref().and_then(|p| p.ctx.clone()).filter(|c| c.app == app);
    let dictionary: Vec<String> = st.db.list_dictionary_recent().unwrap_or_default().into_iter().map(|d| d.replacement.unwrap_or(d.word)).collect();
    let stored = if s.learn_from_screen && !denied_app(app, "", &s.attention_denylist) { stored_terms(&st.db, app, 200) } else { vec![] };
    let blocked = blocked_fixes(&st.db);
    let style = if s.learn_app_style { app_style(&st.db, app) } else { None };
    build(&s, app, ctx.as_ref(), &dictionary, &stored, &blocked, style)
}

/// `prepare` without the app state (unit tested, and used by the bench).
pub fn build(s: &Settings, app: &str, ctx: Option<&ScreenContext>, dictionary: &[String], stored: &[(String, bool)], blocked: &[(String, String)], style: Option<AppStyle>) -> Prepared {
    let mut set = TermSet::new();
    if let Some(c) = ctx {
        for t in c.terms.iter().filter(|t| t.kind != TermKind::Code) {
            set.add(&t.text, t.proper, Trust::OnScreen);
        }
    }
    for w in dictionary {
        set.add(w, true, Trust::Dictionary);
    }
    for (w, proper) in stored {
        set.add(w, *proper, Trust::Learned);
    }
    for (h, t) in blocked {
        set.block(h, t);
    }
    let mut hints = vec![];
    if hints_allowed(s) {
        hints = set.hints(25);
        if let Some(c) = ctx {
            // emails / URLs / identifiers on screen: spelling for the AI only
            for t in c.terms.iter().filter(|t| t.kind == TermKind::Code).take(5) {
                hints.push(t.text.clone());
            }
        }
    }
    let style_hint = style.as_ref().and_then(|st| st.hint(app, hints_allowed(s)));
    Prepared { terms: set, hints, style_hint, style }
}

/// Remember the screen fixes made in this dictation.
pub fn note_fixes(fixes: &[Fix]) {
    *LAST_FIXES.lock() = fixes.to_vec();
}

/// Was `corrected` on screen when the last dictation started?
fn on_screen_now(word: &str) -> bool {
    PENDING.lock().as_ref().and_then(|p| p.ctx.as_ref()).map(|c| c.terms.iter().any(|t| joined(&t.text) == joined(word))).unwrap_or(false)
}

/// What to do with a fix the user made in text Flo typed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditDecision {
    /// counted; offer it in the notch (Save)
    Suggest,
    /// seen often enough (or on screen): saved to the dictionary
    Apply,
    /// the user put back a word Flo had changed to a screen term: that change is blocked
    Reverted,
    /// already applied / blocked: nothing to say
    Known,
}

/// Count one fix the user made in `app` and decide what to do with it.
pub fn decide_edit(db: &Db, heard: &str, corrected: &str, app: &str, on_screen: bool, screen_fixes: &[Fix]) -> anyhow::Result<EditDecision> {
    if screen_fixes.iter().any(|f| f.to.eq_ignore_ascii_case(heard.trim()) && joined(&f.from) == joined(corrected)) {
        block_fix(db, corrected, heard, app)?;
        return Ok(EditDecision::Reverted);
    }
    let (count, applied, blocked) = record_fix(db, heard, corrected, app, "edit")?;
    if applied || blocked {
        return Ok(EditDecision::Known);
    }
    if should_apply(count, on_screen) {
        mark_applied(db, heard, corrected)?;
        return Ok(EditDecision::Apply);
    }
    Ok(EditDecision::Suggest)
}

/// corrections.rs saw the user change words in text Flo typed in `app`. Returns (heard, corrected,
/// saved to the dictionary) for the notch.
pub fn on_edits(st: &crate::state::Shared, app: &str, pairs: Vec<(String, String)>) -> Vec<(String, String, bool)> {
    let fixes = LAST_FIXES.lock().clone();
    let mut out = vec![];
    for (heard, corrected) in pairs {
        let on_screen = on_screen_now(&corrected) || stored_terms(&st.db, app, 400).iter().any(|(t, _)| joined(t) == joined(&corrected));
        match decide_edit(&st.db, &heard, &corrected, app, on_screen, &fixes) {
            Ok(EditDecision::Apply) => {
                let saved = crate::corrections::save(st, &heard, &corrected).is_ok();
                out.push((heard, corrected, saved));
            }
            Ok(EditDecision::Suggest) => out.push((heard, corrected, false)),
            Ok(EditDecision::Reverted) => log::info!("learning: {corrected:?} put back over {heard:?}; won't change it again"),
            Ok(EditDecision::Known) => {}
            Err(e) => log::warn!("learning: record fix: {e}"),
        }
    }
    out
}

/// The user kept `text` in a field in `app`: learn their style there.
pub fn on_kept_text(st: &crate::state::Shared, app: &str, text: &str) {
    let s = st.settings();
    if !s.learn_app_style || denied_app(app, "", &s.attention_denylist) {
        return;
    }
    let text: String = text.chars().take(4000).collect();
    if let Some(sample) = style_sample(&text) {
        if let Err(e) = add_style_sample(&st.db, app, &sample) {
            log::warn!("learning: style: {e}");
        }
    }
}

/// An assistant question: if it re-asks the previous one (within 45 s) with a word or two changed,
/// count those words as fixes (applied once seen twice, like edits).
pub fn on_assistant_query(st: &crate::state::Shared, raw: &str, app: &str) {
    let s = st.settings();
    let prev = LAST_ASK.lock().replace((Instant::now(), raw.to_string(), app.to_string()));
    if !s.learn_corrections || denied_app(app, "", &s.attention_denylist) {
        return;
    }
    let Some((at, first, _)) = prev.filter(|(at, _, a)| at.elapsed() < Duration::from_secs(45) && a == app) else { return };
    let _ = at;
    for (heard, corrected) in reask_fixes(&first, raw) {
        match record_fix(&st.db, &heard, &corrected, app, "assistant") {
            Ok((n, applied, blocked)) if !applied && !blocked && should_apply(n, on_screen_now(&corrected)) => {
                let _ = mark_applied(&st.db, &heard, &corrected);
                if crate::corrections::save(st, &heard, &corrected).is_ok() {
                    log::info!("learning: assistant re-ask {heard:?} → {corrected:?} saved");
                }
            }
            Ok(_) => {}
            Err(e) => log::warn!("learning: assistant fix: {e}"),
        }
    }
}

// ── commands (Settings → Dictionary → Learning) ─────────────────────────────────────────────────────

#[tauri::command(async)]
pub fn learning_overview(st: tauri::State<crate::state::Shared>) -> LearningOverview {
    overview(&st.db)
}

#[tauri::command(async)]
pub fn learning_forget(st: tauri::State<crate::state::Shared>, kind: String, id: String) -> Result<LearningOverview, String> {
    forget(&st.db, &kind, &id).map_err(|e| e.to_string())?;
    Ok(overview(&st.db))
}

#[tauri::command(async)]
pub fn learning_clear(st: tauri::State<crate::state::Shared>) -> Result<LearningOverview, String> {
    clear(&st.db).map_err(|e| e.to_string())?;
    *OCR_CACHE.lock() = None;
    Ok(overview(&st.db))
}

#[cfg(all(test, feature = "local-stt"))]
#[path = "learning_bench.rs"]
mod bench;

#[cfg(test)]
mod tests {
    use super::*;

    const SLACK: &str = "Avenuor\n# avenuor-dev\nDirect messages\nPriya Shah\nRahul Mehta\nPriya Shah 10:42 AM\nthe Tauri build is green on CI, can someone ship it?\nMessage #avenuor-dev";

    fn texts(t: &[Term]) -> Vec<&str> {
        t.iter().map(|t| t.text.as_str()).collect()
    }

    #[test]
    fn extracts_names_products_jargon_and_identifiers() {
        let t = extract_terms(SLACK, 100);
        let names = texts(&t);
        for want in ["Avenuor", "Priya", "Rahul", "Tauri", "Priya Shah", "Shah", "Mehta"] {
            assert!(names.contains(&want), "missing {want} in {names:?}");
        }
        // window chrome and everyday words are not terms
        for no in ["Message", "Direct", "messages", "build", "green", "ship", "AM", "the"] {
            assert!(!names.contains(&no), "{no} should not be a term: {names:?}");
        }
        // the channel's lowercase "avenuor" merges into "Avenuor"
        assert!(!names.contains(&"avenuor"));
        assert!(t.iter().find(|x| x.text == "Avenuor").unwrap().count >= 2);
        assert!(t.iter().find(|x| x.text == "Tauri").unwrap().proper);

        let code = extract_terms("kubectl get pods -n flo\nZustand store, useStore()\nGitHub Actions: release.yml\nmail priya.shah@avenuor.com or see https://tauri.app/start", 100);
        let c = texts(&code);
        assert!(c.contains(&"kubectl") && c.contains(&"Zustand") && c.contains(&"GitHub"), "{c:?}");
        let kind = |w: &str| code.iter().find(|t| t.text == w).map(|t| t.kind);
        assert_eq!(kind("useStore"), Some(TermKind::Code));
        assert_eq!(kind("release.yml"), Some(TermKind::Code));
        assert_eq!(kind("priya.shah@avenuor.com"), Some(TermKind::Code));
        assert_eq!(kind("https://tauri.app/start"), Some(TermKind::Code));
        assert_eq!(kind("GitHub"), Some(TermKind::Mixed));
    }

    #[test]
    fn sentence_start_capitals_are_not_names() {
        let t = extract_terms("Deploying the app now. Deploying again later, deploying is slow", 50);
        let d = t.iter().find(|t| t.text == "Deploying");
        assert!(d.map(|d| !d.proper).unwrap_or(true), "{t:?}");
        // everyday names that are also words never become terms
        let t = extract_terms("Will Turner\nMark Evans\nMay Chen", 50);
        let n = texts(&t);
        assert!(!n.contains(&"Will") && !n.contains(&"Mark") && !n.contains(&"May"), "{n:?}");
    }

    #[test]
    fn phonetic_keys_match_misheard_names() {
        assert_eq!(phonetic_key("tori"), phonetic_key("Tauri"));
        assert_eq!(phonetic_key("a venue or"), phonetic_key("Avenuor"));
        assert_eq!(phonetic_key("Raul"), "RL");
        assert_eq!(phonetic_key("Rahul"), "RHL");
        assert_eq!(phonetic_key("phone"), phonetic_key("fone"));
        assert_eq!(phonetic_key("knight"), "NT");
        assert_ne!(phonetic_key("story"), phonetic_key("Tauri"));
    }

    fn screen_set() -> TermSet {
        let ctx = ScreenContext { app: "Slack".into(), terms: extract_terms(SLACK, 100), ..Default::default() };
        build(&Settings::default(), "Slack", Some(&ctx), &[], &[], &[], None).terms
    }

    #[test]
    fn corrects_misheard_screen_terms() {
        let set = screen_set();
        let (out, fixes) = correct("Send the tori build to pria and Rahul on a venue or.", &set);
        assert_eq!(out, "Send the Tauri build to Priya and Rahul on Avenuor.");
        assert_eq!(fixes.len(), 3, "{fixes:?}");
        assert_eq!(correct("priya's deck", &set).0, "Priya's deck");
        assert_eq!(correct("ask priya shah", &set).0, "ask Priya Shah");
        // the word before a term stays ("on" isn't part of "Avenuor")
        assert_eq!(correct("Rahul on Avenor.", &set).0, "Rahul on Avenuor.");
        assert_eq!(correct("Rahul on a Venue or", &set).0, "Rahul on Avenuor");
        // corrected once, it stays put on a second pass
        assert_eq!(correct("Rahul on Avenuor", &set).0, "Rahul on Avenuor");
        assert_eq!(correct("Avenuor on Monday", &set).0, "Avenuor on Monday");
    }

    #[test]
    fn never_corrects_everyday_words() {
        let set = screen_set();
        for s in [
            "The story is ready, but the tour needs a new date.",
            "I will mark this as done and we may move on.",
            "Let me know when you are free to talk about the budget.",
            "Can you do the to do list today",
            "pray for rain",
        ] {
            assert_eq!(correct(s, &set).0, s, "changed: {s}");
        }
        // will / mark / may on screen as names: still everyday words in a sentence
        let ctx = ScreenContext { app: "Mail".into(), terms: extract_terms("Will Turner\nMark Evans\nMay Chen", 50), ..Default::default() };
        let set = build(&Settings::default(), "Mail", Some(&ctx), &[], &[], &[], None).terms;
        assert_eq!(correct("I will mark it, may be", &set).0, "I will mark it, may be");
    }

    #[test]
    fn learned_terms_need_a_closer_match_than_on_screen_ones() {
        let mut on = TermSet::new();
        on.add("Tauri", true, Trust::OnScreen);
        let mut learned = TermSet::new();
        learned.add("Tauri", true, Trust::Learned);
        assert_eq!(correct("the tori app", &on).0, "the Tauri app");
        assert_eq!(correct("the tori app", &learned).0, "the tori app");
        assert_eq!(correct("the taury app", &learned).0, "the Tauri app");
    }

    #[test]
    fn ambiguous_matches_and_blocked_pairs_are_left_alone() {
        let mut set = TermSet::new();
        set.add("Kiran", true, Trust::OnScreen);
        set.add("Karan", true, Trust::OnScreen);
        assert_eq!(correct("ask kuran", &set).0, "ask kuran");
        let mut set = TermSet::new();
        set.add("Tauri", true, Trust::OnScreen);
        set.block("tori", "Tauri");
        assert_eq!(correct("the tori app", &set).0, "the tori app");
    }

    #[test]
    fn case_only_fixes_need_a_name() {
        let mut set = TermSet::new();
        set.add("Priya", true, Trust::OnScreen);
        set.add("Kubectl", false, Trust::OnScreen); // only ever seen at a line start
        assert_eq!(correct("call priya", &set).0, "call Priya");
        assert_eq!(correct("run kubectl", &set).0, "run kubectl");
    }

    #[test]
    fn everyday_word_list_is_loaded_and_function_words_are_separate() {
        assert!(lexicon().words.len() > 10_000, "{}", lexicon().words.len());
        for w in ["tour", "story", "will", "mark", "may", "budget", "venue", "the"] {
            assert!(is_common(w), "{w}");
        }
        for w in ["tori", "tauri", "priya", "avenuor", "kubectl", "zustand"] {
            assert!(!is_common(w), "{w}");
        }
        assert!(is_function("to") && is_function("do") && !is_function("venue"));
    }

    #[test]
    fn thresholds() {
        assert!(!should_apply(1, false));
        assert!(should_apply(1, true));
        assert!(should_apply(2, false));
        assert!(!should_apply(0, true));
    }

    #[test]
    fn edits_are_counted_and_applied_on_the_second_time_or_when_on_screen() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(decide_edit(&db, "Pria", "Priya", "Slack", false, &[]).unwrap(), EditDecision::Suggest);
        assert_eq!(decide_edit(&db, "Pria", "Priya", "Slack", false, &[]).unwrap(), EditDecision::Apply);
        assert_eq!(decide_edit(&db, "Pria", "Priya", "Slack", false, &[]).unwrap(), EditDecision::Known);
        assert_eq!(decide_edit(&db, "tori", "Tauri", "Slack", true, &[]).unwrap(), EditDecision::Apply);
        let o = overview(&db);
        let f = o.fixes.iter().find(|f| f.heard == "Pria").unwrap();
        assert_eq!((f.count, f.applied, f.app.as_str()), (3, true, "Slack"));
        // the user put back the word Flo changed: blocked, and the next build won't change it
        let fixes = vec![Fix { from: "Raul".into(), to: "Rahul".into() }];
        assert_eq!(decide_edit(&db, "Rahul", "Raul", "Slack", false, &fixes).unwrap(), EditDecision::Reverted);
        let b = blocked_fixes(&db);
        assert_eq!(b, vec![("Raul".to_string(), "Rahul".to_string())]);
        let mut set = TermSet::new();
        set.add("Rahul", true, Trust::OnScreen);
        for (h, t) in &b {
            set.block(h, t);
        }
        assert_eq!(correct("ask Raul", &set).0, "ask Raul");
    }

    #[test]
    fn learned_items_can_be_listed_forgotten_and_cleared() {
        let db = Db::open_in_memory().unwrap();
        store_terms(&db, "Slack", &extract_terms(SLACK, 50)).unwrap();
        assert!(stored_terms(&db, "Slack", 50).is_empty(), "one sighting isn't enough");
        store_terms(&db, "Slack", &extract_terms(SLACK, 50)).unwrap();
        assert!(stored_terms(&db, "Slack", 50).iter().any(|(t, _)| t == "Tauri"));
        record_fix(&db, "Pria", "Priya", "Slack", "edit").unwrap();
        db.add_dictionary("Pria", Some("Priya")).unwrap();
        mark_applied(&db, "Pria", "Priya").unwrap();
        for _ in 0..3 {
            add_style_sample(&db, "Slack", &style_sample("hey can you check this").unwrap()).unwrap();
        }
        let o = overview(&db);
        assert!(!o.terms.is_empty() && o.fixes.len() == 1 && o.styles.len() == 1);
        assert!(o.styles[0].hint.is_some());
        let t = o.terms.iter().find(|t| t.term == "Tauri").unwrap();
        forget(&db, "term", &t.id).unwrap();
        assert!(!overview(&db).terms.iter().any(|t| t.term == "Tauri"));
        // forgetting an applied fix takes it out of the dictionary too
        forget(&db, "fix", &o.fixes[0].id).unwrap();
        assert!(db.list_dictionary().unwrap().is_empty());
        clear(&db).unwrap();
        assert_eq!(overview(&db), LearningOverview::default());
    }

    #[test]
    fn denylisted_apps_and_flo_are_never_read() {
        let s = Settings::default();
        assert!(!screen_allowed(&s, "1Password 8", "Vault"));
        assert!(!screen_allowed(&s, "Flo Flow", ""));
        assert!(!screen_allowed(&s, "", ""));
        assert!(screen_allowed(&s, "Slack", "general"));
        let mut off = s.clone();
        off.learn_from_screen = false;
        assert!(!screen_allowed(&off, "Slack", "general"));
    }

    #[test]
    fn screen_words_reach_a_cloud_model_only_with_consent() {
        let ctx = ScreenContext { app: "Slack".into(), terms: extract_terms(SLACK, 100), ..Default::default() };
        let mut s = Settings::default();
        s.llm_provider = "ollama".into();
        assert!(build(&s, "Slack", Some(&ctx), &[], &[], &[], None).hints.contains(&"Tauri".to_string()));
        s.llm_provider = "anthropic".into();
        s.attention_cloud_allowed = false;
        let p = build(&s, "Slack", Some(&ctx), &[], &[], &[], None);
        assert!(p.hints.is_empty());
        // local correction still works
        assert_eq!(correct("the tori build", &p.terms).0, "the Tauri build");
        s.attention_cloud_allowed = true;
        assert!(!build(&s, "Slack", Some(&ctx), &[], &[], &[], None).hints.is_empty());
    }

    #[test]
    fn style_hints_per_app() {
        let mut slack = AppStyle::default();
        for m in ["hey can you check the build", "yeah looks good 👍", "ok shipping it now", "lol same", "pls review when free"] {
            slack.add(&style_sample(m).unwrap());
        }
        let h = slack.hint("Slack", true).unwrap();
        assert!(h.starts_with("In Slack the user writes: short messages, casual, starts in lowercase, no full stop at the end"), "{h}");
        assert!(h.contains("no sign-off"), "{h}");
        assert!(slack.drops_final_period());
        assert_eq!(apply_style_local("Looks good to me.", &slack), "Looks good to me");
        assert_eq!(apply_style_local("Done. Shipping now.", &slack), "Done. Shipping now.");

        let mut mail = AppStyle::default();
        for m in ["Dear Ravi,\nPlease find the invoice attached.\nBest regards,\nNaman", "Hi team,\nThe release is on track.\nBest regards,\nNaman", "Hello,\nI hope this helps.\nBest regards,\nNaman"] {
            mail.add(&style_sample(m).unwrap());
        }
        let h = mail.hint("Mail", true).unwrap();
        assert!(h.contains("formal") && h.contains("signs off \"Best regards,\""), "{h}");
        // without consent for screen text in the cloud, no sign-off text
        assert!(!mail.hint("Mail", false).unwrap().contains("regards"));
        assert!(!mail.drops_final_period());
        assert_eq!(AppStyle::default().hint("Notes", true), None);
    }

    #[test]
    fn reasked_assistant_questions_yield_the_changed_word() {
        assert_eq!(reask_fixes("open the tori docs", "open the Tauri docs"), vec![("tori".to_string(), "Tauri".to_string())]);
        assert!(reask_fixes("what's the weather", "set a timer for ten minutes").is_empty());
        assert!(reask_fixes("open the tori docs", "open the tori docs").is_empty());
    }

    #[test]
    fn correction_is_fast() {
        let mut big = String::new();
        for i in 0..200 {
            big.push_str(&format!("Person{i} Name{} talked about Projectx{i}\n", i * 7));
        }
        big.push_str(SLACK);
        let ctx = ScreenContext { app: "Slack".into(), terms: extract_terms(&big, 150), ..Default::default() };
        let dict: Vec<String> = (0..100).map(|i| format!("Wordy{i}")).collect();
        let t0 = Instant::now();
        let p = build(&Settings::default(), "Slack", Some(&ctx), &dict, &[], &[], None);
        let text = "Hey team, quick update. Send the tori build to pria and Rahul on a venue or before Friday, and let me know if anything breaks. ".repeat(3);
        let (out, _) = correct(&text, &p.terms);
        let ms = t0.elapsed().as_millis();
        assert!(out.contains("Tauri"));
        assert!(ms < 30 || cfg!(debug_assertions), "correction took {ms} ms");
    }
}

