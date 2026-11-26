//! Who is "Speaker 2"? Real names for the voices of a meeting, from local signals only.
//!
//! Like Fathom / Wispr Flow's notetakers (no bot joins the call), names come from what this Mac
//! already sees and hears; nothing leaves the device:
//!
//! 1. **Voice memory**: every name the user gives or confirms stores that voice's centroid
//!    (`voices` table). A later call cluster takes a remembered name only when it is clearly that
//!    voice: cosine ≥ `speakers::KNOWN_VOICE` *and* ahead of the second-best voice by
//!    `speakers::VOICE_MARGIN` (see `speakers::match_voice`). The user's own voice is learned from
//!    the mic track (`SELF_VOICE`), so the call app playing it back is still "You".
//! 2. **The meeting window**: while someone on the call talks, the meeting app's window is read
//!    every ~1.5 s (accessibility text first, on-device OCR as the fallback; `meet_screen.rs`).
//!    Each sample yields at most one *active speaker* name ("Rahul is speaking", the highlighted /
//!    spotlighted tile). Samples are matched to the voice cluster talking at that moment and
//!    tallied; a cluster is named after the participant who is active while it talks, if that
//!    participant is clearly *its* participant (not a name that is always on screen).
//! 3. **The calendar**: guests of an overlapping event are the candidate set (OCR names are
//!    snapped to them; a 1:1 with one guest suggests that guest).
//! 4. **Self-introductions** ("Hi, I'm Rahul", "main Rahul bol raha hoon"): a weak hint.
//!
//! Wrong names are worse than "Speaker 2": a name is *applied* only at `APPLY` confidence or
//! more, shown as a one-click "Rahul?" suggestion between `SUGGEST` and `APPLY`, and dropped below.
//! Everything here is pure and unit-tested; `meeting.rs` and `meeting_sim.rs` run the same code.
use crate::speakers::{self, Cluster, Voice};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Names at or above this confidence replace the generic label in the transcript.
pub const APPLY: f32 = 0.75;
/// Names at or above this (and below `APPLY`) are offered as "Rahul?" with one-click confirm.
pub const SUGGEST: f32 = 0.35;
/// The user's own voice in the `voices` table (learned from the mic track, never shown as a name).
pub const SELF_VOICE: &str = crate::meeting::YOU;
/// Screen evidence: a cluster needs this much vote weight before it can be named from the screen.
pub const MIN_SCREEN_WEIGHT: f32 = 2.0;
/// ... and this share of its votes going to one participant.
pub const SCREEN_SHARE: f32 = 0.6;
/// ... and that participant's votes must land on this cluster at least this often (a name that is
/// "active" whatever voice talks, like a pinned tile or your own self-view, names nobody).
pub const SCREEN_EXCLUSIVE: f32 = 0.6;
/// An active-speaker indicator lags the voice by a few hundred ms and lingers after it stops.
pub const INDICATOR_LEAD: f64 = 0.2;
pub const INDICATOR_LINGER: f64 = 1.2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    /// remembered voice
    Voice,
    /// the meeting window (active speaker)
    Screen,
    /// "Hi, I'm Rahul"
    Intro,
    /// a 1:1 calendar event with one guest
    Calendar,
    /// the user named / confirmed it
    User,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NameGuess {
    pub name: String,
    pub confidence: f32,
    pub source: Source,
}

// ── names on screen ────────────────────────────────────────────────────────

/// Words that appear next to names in meeting apps but are not names themselves.
const UI_WORDS: &[&str] = &[
    "mute", "unmute", "muted", "unmuted", "video", "camera", "stop", "start", "share", "screen", "sharing", "participants", "participant", "chat",
    "leave", "end", "meeting", "record", "recording", "reactions", "raise", "hand", "more", "options", "settings", "view", "gallery", "speaker",
    "speaking", "presenting", "presentation", "present", "captions", "details", "join", "joined", "host", "co-host", "cohost", "guest", "you",
    "me", "people", "everyone", "call", "audio", "microphone", "mic", "security", "apps", "whiteboard", "notes", "breakout", "rooms", "invite",
    "waiting", "room", "admit", "pin", "spotlight", "minimize", "fullscreen", "full", "exit", "zoom", "teams", "meet", "google", "slack",
    "huddle", "webex", "connecting", "reconnecting", "unstable", "connection", "network", "turn", "on", "off", "and", "others", "other",
    "activities", "layout", "is", "are", "the", "a", "an", "of", "to", "in", "with", "now", "live", "react", "filters", "effects", "background",
    "transcript", "ai", "companion", "summary", "new", "open", "close", "show", "hide", "help", "search", "calendar", "files", "activity",
];

/// A participant name as a meeting app labels a tile / list row, cleaned of decorations:
/// "Rahul Sharma (Host)" / "Rahul Sharma, Co-host" / "Rahul Sharma | Acme" / "Rahul's screen" →
/// "Rahul Sharma" / "Rahul". None when the text isn't name-like (buttons, sentences, numbers).
pub fn clean_display_name(raw: &str) -> Option<String> {
    let mut s = raw.trim().to_string();
    // drop bracketed tags: (Host) (me) [Guest] (Presentation) (External)
    for (open, close) in [('(', ')'), ('[', ']')] {
        while let (Some(a), Some(b)) = (s.find(open), s.find(close)) {
            if b <= a {
                break;
            }
            s.replace_range(a..=b, " ");
        }
    }
    // "Name | Company", "Name - Company", "Name, Host", "Name · speaking"
    for sep in [" | ", " - ", " – ", " · ", " • ", ","] {
        if let Some(i) = s.find(sep) {
            s.truncate(i);
        }
    }
    let s = s.trim().trim_end_matches("'s screen").trim_end_matches("’s screen").trim_end_matches("'s").trim_end_matches("’s");
    let s: String = s.chars().filter(|c| c.is_alphabetic() || *c == ' ' || *c == '.' || *c == '-' || *c == '\'').collect();
    let words: Vec<&str> = s.split_whitespace().collect();
    if words.is_empty() || words.len() > 4 || s.chars().count() > 40 {
        return None;
    }
    let lower: Vec<String> = words.iter().map(|w| w.to_lowercase()).collect();
    if lower.iter().all(|w| UI_WORDS.contains(&w.trim_matches('.'))) || lower.iter().any(|w| UI_WORDS.contains(&w.as_str()) && words.len() == 1) {
        return None;
    }
    // names start with a capital letter (Latin), or are in a script without case
    let first = words[0].chars().next()?;
    if first.is_lowercase() || !first.is_alphabetic() {
        return None;
    }
    // a name has at least one word of 2+ letters
    if !words.iter().any(|w| w.chars().filter(|c| c.is_alphabetic()).count() >= 2) {
        return None;
    }
    Some(words.join(" "))
}

fn fold(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ä' | 'ã' | 'å' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'ö' | 'õ' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ñ' => 'n',
            'ç' => 'c',
            c => c,
        })
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .to_lowercase()
}

fn tokens(s: &str) -> Vec<String> {
    fold(s).split_whitespace().map(str::to_string).collect()
}

/// Levenshtein distance (chars).
pub fn edit_distance(a: &str, b: &str) -> usize {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for (i, x) in a.iter().enumerate() {
        let mut cur = vec![i + 1; b.len() + 1];
        for (j, y) in b.iter().enumerate() {
            cur[j + 1] = (prev[j] + usize::from(x != y)).min(prev[j + 1] + 1).min(cur[j] + 1);
        }
        prev = cur;
    }
    prev[b.len()]
}

fn similar_word(a: &str, b: &str) -> f32 {
    if a == b {
        return 1.0;
    }
    let n = a.chars().count().max(b.chars().count());
    if n < 4 {
        return 0.0; // short words must match exactly ("Raj" ≠ "Ram")
    }
    1.0 - edit_distance(a, b) as f32 / n as f32
}

/// How well an on-screen / spoken name matches a candidate (attendee, known voice). 1.0 = same
/// name; first name + surname initial ("Rahul S.") or first name alone ≈ 0.85; OCR slips
/// ("Rahu1 Sharma" → "Rahul Sharma") by edit distance.
pub fn name_score(raw: &str, candidate: &str) -> f32 {
    let (r, c) = (tokens(raw), tokens(candidate));
    if r.is_empty() || c.is_empty() {
        return 0.0;
    }
    if r == c {
        return 1.0;
    }
    let whole = similar_word(&r.join(" "), &c.join(" "));
    // every raw word matches a candidate word (or is its initial), first names agree
    let first = similar_word(&r[0], &c[0]);
    let all_covered = r.iter().all(|w| c.iter().any(|x| similar_word(w, x) >= 0.8 || (w.chars().count() == 1 && x.starts_with(w.as_str()))));
    let partial = if first >= 0.8 && all_covered {
        0.85 * first + if r.len() == c.len() { 0.15 } else { 0.0 }
    } else if r.len() == 1 && c.iter().skip(1).any(|x| similar_word(&r[0], x) >= 0.9) {
        0.6 // surname only
    } else {
        0.0
    };
    whole.max(partial)
}

/// The candidate a name refers to: the best match at ≥ 0.75, and clearly better (by 0.1) than any
/// other candidate (two "Rahul"s on the invite → no guess from "Rahul" alone).
pub fn match_candidate(raw: &str, candidates: &[String]) -> Option<(String, f32)> {
    let mut scored: Vec<(&String, f32)> = candidates.iter().map(|c| (c, name_score(raw, c))).collect();
    scored.sort_by(|a, b| b.1.total_cmp(&a.1));
    let (best, s) = *scored.first()?;
    if s < 0.75 {
        return None;
    }
    if scored.get(1).is_some_and(|x| x.1 > s - 0.1 && !x.0.eq_ignore_ascii_case(best)) {
        return None;
    }
    Some((best.clone(), s))
}

/// One line of OCR text with its box (any unit, y grows downward).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OcrLine {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

/// "Rahul is speaking", "Speaking: Rahul", "Rahul (speaking)", "Active speaker, Rahul",
/// "Rahul is presenting" → (name, weight). Presenting is weaker (the presenter often isn't the
/// one talking).
pub fn active_from_text(text: &str) -> Option<(String, f32)> {
    let t = text.trim();
    let l = t.to_lowercase();
    if t.chars().count() > 120 || l.len() != t.len() {
        return None; // long text is content, not a status label (and byte offsets must agree)
    }
    let cut = |a: usize, b: usize| -> Option<String> { clean_display_name(t.get(a..b)?) };
    for (cue, w) in [("speaking", 0.9f32), ("talking", 0.9), ("presenting", 0.25)] {
        let Some(i) = l.find(cue) else { continue };
        // the status ends the label (or is followed by more status: "speaking, muted")
        let rest = l[i + cue.len()..].trim_start_matches([')', ']', ' ']);
        if !(rest.is_empty() || rest.starts_with(',') || rest.starts_with('·') || rest.starts_with('-')) {
            continue;
        }
        // "Rahul Sharma is speaking" / "Rahul Sharma, speaking" / "Rahul Sharma (Speaking)"
        let head = t[..i].trim_end_matches([',', '(', '[', ' ', '-', '·', ':']);
        let (head, w) = match head.strip_suffix(" is").or_else(|| head.strip_suffix(" Is")) {
            Some(h) => (h, w + 0.1),
            None => (head, w),
        };
        if let Some(n) = clean_display_name(head) {
            return Some((n, w.min(1.0)));
        }
    }
    for (cue, w) in [("active speaker:", 1.0f32), ("active speaker,", 1.0), ("speaking:", 1.0), ("now speaking:", 1.0), ("presenting:", 0.3)] {
        if let Some(i) = l.find(cue) {
            let a = i + cue.len();
            if let Some(n) = cut(a, t.len()) {
                return Some((n, w));
            }
        }
    }
    None
}

/// Accessibility strings of the meeting window (titles, descriptions, values) → the active
/// speaker. Only explicit "speaking" wording counts: tile names alone say nothing about who talks.
pub fn active_from_ax(strings: &[String], candidates: &[String]) -> Option<(String, f32)> {
    let mut found: Vec<(String, f32)> = strings.iter().filter_map(|s| active_from_text(s)).collect();
    found.sort_by(|a, b| b.1.total_cmp(&a.1));
    let top = found.first()?.clone();
    // two different people "speaking" in one snapshot → ambiguous, unless one is much stronger
    if found.iter().any(|f| f.1 >= top.1 && name_score(&f.0, &top.0) < 0.75) {
        return None;
    }
    Some(snap(top, candidates))
}

/// OCR of the meeting window → the active speaker: explicit text first ("Rahul is speaking"),
/// else the name label of the *largest* tile (speaker view / spotlight puts the active speaker on
/// the big tile; its name label is the tallest name on screen). In a gallery of equal tiles no
/// name stands out and nothing is returned.
pub fn active_from_ocr(lines: &[OcrLine], candidates: &[String]) -> Option<(String, f32)> {
    let explicit: Vec<String> = lines.iter().map(|l| l.text.clone()).collect();
    if let Some(a) = active_from_ax(&explicit, candidates) {
        return Some(a);
    }
    if candidates.is_empty() {
        return None; // without a guest list a big caption could be anything (slides, chat)
    }
    let mut names: Vec<(String, f32)> = lines
        .iter()
        .filter_map(|l| {
            let n = clean_display_name(&l.text)?;
            let (c, _) = match_candidate(&n, candidates)?;
            Some((c, l.h))
        })
        .collect();
    names.sort_by(|a, b| b.1.total_cmp(&a.1));
    let (top, h) = names.first()?.clone();
    let next = names.iter().find(|(n, _)| *n != top).map(|x| x.1).unwrap_or(0.0);
    (h >= next * 1.5 || (next == 0.0 && names.len() == 1)).then_some((top, 0.6))
}

/// Snap a name to the guest list when it clearly refers to one guest ("Rahul S." → "Rahul Sharma").
fn snap((name, w): (String, f32), candidates: &[String]) -> (String, f32) {
    match match_candidate(&name, candidates) {
        Some((c, _)) => (c, w),
        None => (name, w),
    }
}

// ── voting: screen samples × voice clusters ────────────────────────────────

/// One active-speaker reading of the meeting window (seconds since the meeting started).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScreenObs {
    pub t: f64,
    pub name: String,
    pub weight: f32,
}

/// A stretch of speech with its current label ("You", "Speaker 2", "Rahul").
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Turn {
    pub t0: f64,
    pub t1: f64,
    pub label: String,
}

/// label → participant → vote weight. A reading counts for the one label talking when it was
/// taken (allowing for the indicator's lag); readings while two labels overlap, or nobody talks,
/// are skipped.
pub fn tally(turns: &[Turn], obs: &[ScreenObs]) -> BTreeMap<String, BTreeMap<String, f32>> {
    let mut out: BTreeMap<String, BTreeMap<String, f32>> = BTreeMap::new();
    for o in obs {
        let mut who: Vec<&str> = turns.iter().filter(|t| o.t >= t.t0 + INDICATOR_LEAD && o.t <= t.t1 + INDICATOR_LINGER).map(|t| t.label.as_str()).collect();
        who.sort();
        who.dedup();
        if who.len() == 1 {
            *out.entry(who[0].to_string()).or_default().entry(o.name.clone()).or_default() += o.weight;
        }
    }
    out
}

/// Screen-based name per label (not for `you`): the participant with most of the label's votes,
/// if they are mostly *this* label's (one-to-one, best first). Confidence grows with the share,
/// the exclusivity and the number of votes (≈ 0.75 after ~8 clean readings ≈ 12 s of talk).
/// Also returns the user's own display name (the participant active while "You" talk).
pub fn decide_screen(votes: &BTreeMap<String, BTreeMap<String, f32>>, you: &str) -> (BTreeMap<String, NameGuess>, Option<String>) {
    let mut per_name: BTreeMap<&str, f32> = BTreeMap::new();
    for m in votes.values() {
        for (n, w) in m {
            *per_name.entry(n.as_str()).or_default() += w;
        }
    }
    let top_of = |m: &BTreeMap<String, f32>| -> Option<(String, f32, f32)> {
        let total: f32 = m.values().sum();
        let (n, w) = m.iter().max_by(|a, b| a.1.total_cmp(b.1))?;
        Some((n.clone(), *w, total))
    };
    let self_name = votes.get(you).and_then(top_of).filter(|(n, w, total)| *total >= MIN_SCREEN_WEIGHT && w / total >= SCREEN_SHARE && w / per_name[n.as_str()] >= SCREEN_EXCLUSIVE).map(|x| x.0);
    let mut cands: Vec<(String, NameGuess)> = vec![];
    for (label, m) in votes {
        if label == you {
            continue;
        }
        let Some((name, w, total)) = top_of(m) else { continue };
        if Some(&name) == self_name.as_ref() {
            continue;
        }
        let share = w / total;
        let excl = w / per_name[name.as_str()];
        if total < MIN_SCREEN_WEIGHT || share < SCREEN_SHARE || excl < SCREEN_EXCLUSIVE {
            continue;
        }
        let conf = (share * excl).sqrt() * (w / (w + 2.0)) * 1.1;
        cands.push((label.clone(), NameGuess { name, confidence: conf.min(0.98), source: Source::Screen }));
    }
    (one_to_one(cands), self_name)
}

/// Greedy, best first: each label gets at most one name and each name at most one label.
fn one_to_one(mut cands: Vec<(String, NameGuess)>) -> BTreeMap<String, NameGuess> {
    cands.sort_by(|a, b| b.1.confidence.total_cmp(&a.1.confidence));
    let mut out: BTreeMap<String, NameGuess> = BTreeMap::new();
    for (label, g) in cands {
        if out.contains_key(&label) || out.values().any(|x| x.name.eq_ignore_ascii_case(&g.name)) {
            continue;
        }
        out.insert(label, g);
    }
    out
}

// ── self-introductions ─────────────────────────────────────────────────────

/// Capitalised words that follow "I'm" without being a name.
const NOT_NAMES: &[&str] = &[
    "sorry", "sure", "fine", "good", "great", "here", "not", "just", "so", "going", "glad", "happy", "back", "done", "ready", "okay", "ok", "doing",
    "still", "also", "really", "actually", "looking", "trying", "working", "thinking", "muted", "from", "with", "the", "a", "an", "excited",
    "sharing", "on", "in", "at", "afraid", "aware", "new", "late", "free", "available", "busy", "well", "alright", "all", "very", "pretty",
    "totally", "calling", "speaking", "joining", "hearing", "seeing", "sharing", "english", "hindi", "indian", "american", "talking", "there",
    "fully", "almost", "currently", "sir", "madam", "ma'am", "bhai", "yaar", "hello", "hi", "hey", "thanks", "thank", "you", "your", "manager",
    "engineer", "designer", "developer", "lead", "head", "founder", "ceo", "cto", "pm",
];

fn name_after(words: &[&str]) -> Option<String> {
    // up to two capitalised words; stop at the first that isn't one
    let mut out: Vec<String> = vec![];
    for w in words.iter().take(2) {
        let w = w.trim_matches(|c: char| !c.is_alphabetic());
        let Some(first) = w.chars().next() else { break };
        let caseless = !first.is_lowercase() && !first.is_uppercase();
        if w.chars().count() < 2 || (!first.is_uppercase() && !caseless) || NOT_NAMES.contains(&w.to_lowercase().as_str()) {
            break;
        }
        out.push(w.to_string());
        if caseless {
            break; // Devanagari has no capitals to tell where the name ends: one word only
        }
    }
    // one word is safest: "I'm Rahul Sharma" → "Rahul Sharma" only when both look like names
    (!out.is_empty()).then(|| out.join(" "))
}

/// A speaker naming themselves: "Hi, I'm Rahul", "my name is Rahul", "this is Rahul from Acme",
/// "Rahul here", "myself Rahul", "main Rahul bol raha hoon", "mera naam Rahul hai",
/// "मैं राहुल बोल रहा हूँ", "मेरा नाम राहुल है". Names must be capitalised (Whisper capitalises
/// proper nouns), so "I'm going" / "I'm sure" are not names.
pub fn parse_intro(text: &str) -> Option<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let low: Vec<String> = words.iter().map(|w| w.trim_matches(|c: char| !c.is_alphanumeric() && c != '\'' && c != '’').to_lowercase().replace('’', "'")).collect();
    let at = |i: usize| low.get(i).map(String::as_str).unwrap_or("");
    for i in 0..low.len() {
        let after: Option<usize> = match at(i) {
            "i'm" | "im" if i + 1 < low.len() => Some(i + 1),
            "i" if at(i + 1) == "am" => Some(i + 2),
            "name" if at(i + 1) == "is" && matches!(at(i.wrapping_sub(1)), "my") => Some(i + 2),
            "naam" if matches!(at(i.wrapping_sub(1)), "mera" | "meraa") => Some(i + 1),
            "this" if at(i + 1) == "is" && i <= 2 => Some(i + 2),
            "myself" if i <= 2 => Some(i + 1),
            "main" | "mai" | "mein" if matches!(at(i + 2), "bol" | "baat") || at(i + 3) == "bol" => Some(i + 1),
            "मैं" | "मै" if words.get(i + 2).is_some_and(|w| w.starts_with("बोल")) => Some(i + 1),
            "मेरा" if words.get(i + 1).is_some_and(|w| w.starts_with("नाम")) => Some(i + 2),
            _ => None,
        };
        if let Some(a) = after {
            // "this is Rahul" must be the start of the line ("so this is Rahul's deck" isn't)
            let name = name_after(&words[a.min(words.len())..]);
            if let Some(n) = name {
                if words.get(a).is_some_and(|w| w.ends_with("'s") || w.ends_with("’s")) {
                    continue;
                }
                return Some(n);
            }
        }
        // "Rahul here." / "Hey, Rahul here." at the start of a short line
        if i <= 2 && at(i + 1) == "here" && words.len() <= i + 4 && (0..i).all(|j| matches!(at(j), "hi" | "hey" | "hello" | "haan" | "ok" | "okay" | "yes" | "yeah" | "yep")) {
            if let Some(n) = name_after(&words[i..i + 1]) {
                return Some(n);
            }
        }
    }
    None
}

// ── putting the signals together ───────────────────────────────────────────

/// Everything known about a meeting's voices after the call.
#[derive(Debug, Clone, Default)]
pub struct NamingInput {
    /// call clusters after re-clustering; labels are "Speaker N" or a remembered name
    pub clusters: Vec<Cluster>,
    /// voices Flo remembers (including `SELF_VOICE`)
    pub voices: Vec<Voice>,
    /// every turn of the meeting with its final label (mic turns are "You")
    pub turns: Vec<Turn>,
    pub screen: Vec<ScreenObs>,
    /// (label, text) of each transcript line, for self-introductions
    pub lines: Vec<(String, String)>,
    /// guest names from an overlapping calendar event (without the user)
    pub attendees: Vec<String>,
    /// the user's own names (Settings name, Google account), never given to someone else
    pub self_names: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamingOutcome {
    /// generic label → name to write into the transcript (confidence ≥ `APPLY`)
    pub apply: BTreeMap<String, NameGuess>,
    /// generic label → "Name?" suggestion (`SUGGEST` ≤ confidence < `APPLY`)
    pub suggest: BTreeMap<String, NameGuess>,
    /// labels that were remembered names, with how sure the voice match is
    pub kept: BTreeMap<String, NameGuess>,
    /// remembered names taken off a cluster because the screen clearly showed someone else
    pub demoted: BTreeMap<String, String>,
    /// the user's display name in the meeting app, if the screen showed it while they talked
    pub self_display: Option<String>,
}

/// Map a voice-match cosine (≥ the threshold) to a confidence in [0.75, 0.98].
pub fn voice_confidence(sim: f32) -> f32 {
    (APPLY + (sim - speakers::KNOWN_VOICE).max(0.0) / 0.15 * 0.23).min(0.98)
}

fn is_self(name: &str, self_names: &[String]) -> bool {
    name.eq_ignore_ascii_case(crate::meeting::YOU) || self_names.iter().any(|s| !s.trim().is_empty() && name_score(name, s) >= 0.85)
}

/// Decide names for every call cluster. Voice memory first (already in the labels), then the
/// screen, then introductions and the calendar. Conflicts never produce a name: a remembered
/// voice the screen clearly contradicts is demoted to a suggestion.
pub fn resolve(input: &NamingInput) -> NamingOutcome {
    let mut out = NamingOutcome::default();
    let you = crate::meeting::YOU;
    let votes = tally(&input.turns, &input.screen);
    let (screen, self_display) = decide_screen(&votes, you);
    out.self_display = self_display.clone();
    let mut self_names = input.self_names.clone();
    self_names.extend(self_display);
    let candidates: Vec<String> = input.attendees.iter().filter(|a| !is_self(a, &self_names)).cloned().collect();
    let generic: Vec<&Cluster> = input.clusters.iter().filter(|c| crate::meeting::is_generic_label(&c.label)).collect();
    let mut taken: Vec<String> = input.clusters.iter().filter(|c| !crate::meeting::is_generic_label(&c.label) && c.label != you).map(|c| c.label.clone()).collect();

    // 1) remembered voices: keep, unless the screen clearly shows another participant
    for c in input.clusters.iter().filter(|c| !crate::meeting::is_generic_label(&c.label) && c.label != you) {
        let sim = input.voices.iter().find(|v| v.name == c.label).map(|v| speakers::cosine(&v.embedding, &c.centroid)).unwrap_or(speakers::KNOWN_VOICE);
        let kept = NameGuess { name: c.label.clone(), confidence: voice_confidence(sim), source: Source::Voice };
        match screen.get(&c.label) {
            Some(s) if name_score(&s.name, &c.label) < 0.75 && s.confidence >= SUGGEST => {
                out.demoted.insert(c.label.clone(), s.name.clone());
                taken.retain(|t| t != &c.label);
            }
            _ => {
                out.kept.insert(c.label.clone(), kept);
            }
        }
    }

    // 2) per generic label: screen, intro, calendar
    let intros: BTreeMap<&str, Vec<String>> = input.lines.iter().fold(BTreeMap::new(), |mut m, (label, text)| {
        if let Some(n) = parse_intro(text) {
            m.entry(label.as_str()).or_insert_with(Vec::new).push(n);
        }
        m
    });
    let one_on_one = (candidates.len() == 1 && generic.len() == 1).then(|| candidates[0].clone());
    let mut cands: Vec<(String, NameGuess)> = vec![];
    for c in &generic {
        let label = c.label.as_str();
        let screen_g = screen.get(label).cloned().map(|mut g| {
            if let Some((cand, _)) = match_candidate(&g.name, &candidates) {
                g.name = cand;
            }
            g
        });
        let intro_g = intros.get(label).and_then(|ns| {
            // the same name every time this voice introduces itself; snapped to a guest if possible
            let n = ns.first()?;
            if ns.iter().any(|x| name_score(x, n) < 0.75) {
                return None;
            }
            Some(match match_candidate(n, &candidates) {
                Some((cand, _)) => NameGuess { name: cand, confidence: 0.55, source: Source::Intro },
                None => NameGuess { name: n.clone(), confidence: 0.45, source: Source::Intro },
            })
        });
        let cal_g = one_on_one.clone().map(|n| NameGuess { name: n, confidence: 0.5, source: Source::Calendar });
        let mut best: Option<NameGuess> = None;
        for g in [screen_g, intro_g, cal_g].into_iter().flatten() {
            best = Some(match best {
                None => g,
                // agreeing signals add up; disagreeing ones keep the stronger, a notch less sure
                Some(b) if name_score(&b.name, &g.name) >= 0.75 => {
                    let (hi, lo) = if b.confidence >= g.confidence { (b, g) } else { (g, b) };
                    NameGuess { confidence: (hi.confidence + lo.confidence * 0.35).min(0.98), ..hi }
                }
                Some(b) => {
                    let hi = if b.confidence >= g.confidence { b } else { g };
                    NameGuess { confidence: hi.confidence - 0.15, ..hi }
                }
            });
        }
        if let Some(g) = best.filter(|g| g.confidence >= SUGGEST && !is_self(&g.name, &self_names) && !crate::meeting::is_generic_label(&g.name)) {
            cands.push((label.to_string(), g));
        }
    }
    // demoted clusters keep their screen name as a suggestion
    for (label, name) in &out.demoted {
        if let Some(g) = screen.get(label) {
            cands.push((label.clone(), NameGuess { name: name.clone(), confidence: g.confidence.min(APPLY - 0.05), source: Source::Screen }));
        }
    }
    for (label, g) in one_to_one(cands) {
        if taken.iter().any(|t| name_score(t, &g.name) >= 0.85) {
            continue; // a remembered voice already carries this name
        }
        if g.confidence >= APPLY {
            taken.push(g.name.clone());
            out.apply.insert(label, g);
        } else {
            out.suggest.insert(label, g);
        }
    }
    out
}

/// Live naming during the call (notch + live transcript): only screen names at `APPLY`.
#[derive(Debug, Clone, Default)]
pub struct LiveNames {
    pub turns: Vec<Turn>,
    pub screen: Vec<ScreenObs>,
    pub attendees: Vec<String>,
    /// label → name (confident)
    pub names: BTreeMap<String, String>,
    /// seconds since the meeting started when the first name appeared
    pub first_name_at: Option<f64>,
}

impl LiveNames {
    pub fn add_turn(&mut self, t: Turn) {
        self.turns.push(t);
        if self.turns.len() > 4000 {
            self.turns.drain(..1000);
        }
        self.recompute();
    }
    pub fn add_obs(&mut self, o: ScreenObs) {
        self.screen.push(o);
        if self.screen.len() > 4000 {
            self.screen.drain(..1000);
        }
        self.recompute();
    }
    fn recompute(&mut self) {
        let (s, _) = decide_screen(&tally(&self.turns, &self.screen), crate::meeting::YOU);
        let names: BTreeMap<String, String> = s
            .into_iter()
            .filter(|(l, g)| g.confidence >= APPLY && crate::meeting::is_generic_label(l))
            .map(|(l, g)| {
                let n = match_candidate(&g.name, &self.attendees).map(|x| x.0).unwrap_or(g.name);
                (l, n)
            })
            .collect();
        if self.first_name_at.is_none() && !names.is_empty() {
            self.first_name_at = self.turns.iter().map(|t| t.t1).fold(None, |a: Option<f64>, b| Some(a.map_or(b, |a| a.max(b))));
        }
        self.names = names;
    }
    /// The name to show for a label right now.
    pub fn display(&self, label: &str) -> String {
        self.names.get(label).cloned().unwrap_or_else(|| label.to_string())
    }
}

/// Centroid of the user's mic embeddings (the `SELF_VOICE`), blended into what is stored.
pub fn self_voice_update(stored: Option<&Voice>, mic_embs: &[Vec<f32>]) -> Option<(Vec<f32>, u32)> {
    if mic_embs.len() < 3 {
        return None; // too little of your voice to trust
    }
    let mut c: Vec<f32> = vec![];
    for (i, e) in mic_embs.iter().enumerate() {
        c = speakers::blend(&c, i as u32, e, 1);
    }
    let n = mic_embs.len() as u32;
    Some(match stored {
        Some(v) if v.embedding.len() == c.len() => (speakers::blend(&v.embedding, v.samples.min(200), &c, n), (v.samples + n).min(10_000)),
        _ => (c, n),
    })
}

// ── calendar ───────────────────────────────────────────────────────────────

/// The calendar event this meeting is (the timed, not-declined event whose span, widened by 10
/// min before and 5 after, contains `now`; closest start wins) → (title, guest names without the
/// user, `self` = the user's own attendee name if listed).
pub fn overlapping_event(events: &[crate::google::CalendarEvent], now: chrono::DateTime<chrono::Utc>) -> Option<(String, Vec<String>, Option<String>)> {
    use crate::google::{end_of, others, start_of};
    let e = events
        .iter()
        .filter(|e| !e.all_day && !e.declined)
        .filter_map(|e| {
            let (s, en) = (start_of(e, &chrono::Utc)?, end_of(e, &chrono::Utc)?);
            (s - chrono::Duration::minutes(10) <= now && now <= en + chrono::Duration::minutes(5)).then_some((e, (now - s).num_seconds().abs()))
        })
        .min_by_key(|x| x.1)?
        .0;
    let name_of = |a: &crate::google::CalendarAttendee| if a.name.trim().is_empty() { crate::google::name_from_email(&a.email) } else { a.name.clone() };
    let guests: Vec<String> = others(e).into_iter().map(name_of).filter(|n| !n.trim().is_empty()).collect();
    let me = e.attendees.iter().find(|a| a.is_self).map(name_of).filter(|n| !n.trim().is_empty());
    Some((e.title.clone(), crate::meeting::clean_attendees(&guests), me))
}

// ── voice memory (local DB) ────────────────────────────────────────────────

/// A remembered voice as the UI lists it (no embedding).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownVoice {
    pub name: String,
    pub samples: u32,
    pub updated_at: String,
}

pub fn load_voices(db: &crate::db::Db) -> Vec<Voice> {
    db.list_voices().unwrap_or_default().into_iter().map(|(name, blob, samples)| Voice { name, embedding: speakers::blob_to_embedding(&blob), samples }).collect()
}

/// Voices the user named (the user's own voice isn't listed).
pub fn known_voices(db: &crate::db::Db) -> Vec<KnownVoice> {
    db.voice_summaries().unwrap_or_default().into_iter().filter(|(n, _, _)| n != SELF_VOICE).map(|(name, samples, updated_at)| KnownVoice { name, samples, updated_at }).collect()
}

/// Add `count` segments' worth of a voice (centroid) to `name`'s memory (created if new).
pub fn train_voice(db: &crate::db::Db, name: &str, centroid: &[f32], count: u32) -> anyhow::Result<()> {
    if centroid.is_empty() || name.trim().is_empty() {
        return Ok(());
    }
    let voices = load_voices(db);
    let (emb, samples) = match voices.iter().find(|v| v.name == name) {
        Some(v) if v.embedding.len() == centroid.len() => (speakers::blend(&v.embedding, v.samples, centroid, count), v.samples + count),
        _ => (centroid.to_vec(), count),
    };
    db.upsert_voice(name, &speakers::embedding_to_blob(&emb), samples.min(100_000))
}

/// "Rahul S." and "Rahul" are the same person: fold `from` into `into` (weighted) and forget `from`.
pub fn merge_voices(db: &crate::db::Db, from: &str, into: &str) -> anyhow::Result<()> {
    if from == into {
        return Ok(());
    }
    let voices = load_voices(db);
    let Some(f) = voices.iter().find(|v| v.name == from) else { anyhow::bail!("No remembered voice called {from}") };
    match voices.iter().find(|v| v.name == into) {
        Some(_) => train_voice(db, into, &f.embedding, f.samples)?,
        None => db.upsert_voice(into, &speakers::embedding_to_blob(&f.embedding), f.samples)?,
    }
    db.delete_voice(from)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_memory_trains_merges_and_forgets() {
        let db = crate::db::Db::open_in_memory().unwrap();
        let e = |x: f32| speakers::normalize(vec![1.0, x, 0.0]);
        train_voice(&db, "Rahul", &e(0.0), 4).unwrap();
        train_voice(&db, "Rahul", &e(0.2), 4).unwrap();
        train_voice(&db, "Rahul S.", &e(0.1), 2).unwrap();
        train_voice(&db, SELF_VOICE, &speakers::normalize(vec![0.0, 0.0, 1.0]), 9).unwrap();
        let v = load_voices(&db);
        let r = v.iter().find(|v| v.name == "Rahul").unwrap();
        assert_eq!(r.samples, 8);
        assert!(speakers::cosine(&r.embedding, &e(0.1)) > 0.99, "blended centroid");
        // the user's own voice is stored but never listed as a name
        assert_eq!(known_voices(&db).iter().map(|k| k.name.as_str()).collect::<Vec<_>>(), vec!["Rahul", "Rahul S."]);
        merge_voices(&db, "Rahul S.", "Rahul").unwrap();
        let k = known_voices(&db);
        assert_eq!(k.len(), 1);
        assert_eq!(k[0].samples, 10);
        assert!(merge_voices(&db, "Nobody", "Rahul").is_err());
        merge_voices(&db, "Rahul", "Rahul Sharma").unwrap(); // rename = merge into a new name
        assert_eq!(known_voices(&db)[0].name, "Rahul Sharma");
        assert!(db.delete_voice("Rahul Sharma").unwrap());
        assert!(!db.delete_voice("Rahul Sharma").unwrap());
        assert!(known_voices(&db).is_empty());
        // embeddings survive the BLOB round trip
        assert_eq!(load_voices(&db)[0].embedding.len(), 3);
    }

    #[test]
    fn calendar_event_overlapping_the_meeting_gives_the_guests() {
        use crate::google::{CalendarAttendee, CalendarEvent};
        let a = |n: &str, email: &str, me: bool, r: &str| CalendarAttendee { name: n.into(), email: email.into(), is_self: me, response: r.into(), ..Default::default() };
        let ev = |id: &str, start: &str, end: &str, att: Vec<CalendarAttendee>| CalendarEvent {
            id: id.into(),
            calendar_id: "c".into(),
            title: id.into(),
            start: start.into(),
            end: end.into(),
            all_day: false,
            location: None,
            join_url: None,
            join_kind: None,
            attendees: att,
            declined: false,
            html_link: None,
            ..Default::default()
        };
        let events = vec![
            ev("Standup", "2026-11-16T09:00:00Z", "2026-11-16T09:15:00Z", vec![a("Sam Lee", "sam@x.com", false, "accepted")]),
            ev("Design review", "2026-11-16T10:00:00Z", "2026-11-16T11:00:00Z", vec![
                a("Jake Miller", "jake@x.com", true, "accepted"),
                a("", "priya.patel@x.com", false, "accepted"),
                a("Rahul Sharma", "rahul@x.com", false, "tentative"),
                a("Declined Dan", "dan@x.com", false, "declined"),
            ]),
            CalendarEvent { all_day: true, ..ev("Holiday", "2026-11-16", "2026-11-17", vec![]) },
        ];
        let at = |s: &str| chrono::DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&chrono::Utc);
        let (title, guests, me) = overlapping_event(&events, at("2026-11-16T09:55:00Z")).unwrap();
        assert_eq!(title, "Design review");
        assert_eq!(guests, vec![s("Priya Patel"), s("Rahul Sharma")]);
        assert_eq!(me.as_deref(), Some("Jake Miller"));
        assert_eq!(overlapping_event(&events, at("2026-11-16T09:05:00Z")).unwrap().0, "Standup");
        assert!(overlapping_event(&events, at("2026-11-16T13:00:00Z")).is_none(), "the all-day event doesn't count");
    }

    fn s(x: &str) -> String {
        x.to_string()
    }
    fn turn(t0: f64, t1: f64, l: &str) -> Turn {
        Turn { t0, t1, label: l.into() }
    }
    fn obs(t: f64, n: &str) -> ScreenObs {
        ScreenObs { t, name: n.into(), weight: 1.0 }
    }

    #[test]
    fn display_names_are_cleaned_and_buttons_rejected() {
        assert_eq!(clean_display_name("Rahul Sharma (Host)").as_deref(), Some("Rahul Sharma"));
        assert_eq!(clean_display_name("Rahul Sharma, Co-host").as_deref(), Some("Rahul Sharma"));
        assert_eq!(clean_display_name("Priya Patel | Acme Inc").as_deref(), Some("Priya Patel"));
        assert_eq!(clean_display_name("Rahul's screen").as_deref(), Some("Rahul"));
        assert_eq!(clean_display_name("  Jake (me) ").as_deref(), Some("Jake"));
        assert_eq!(clean_display_name("राहुल").as_deref(), Some("राहुल"));
        for junk in ["Mute", "Stop Video", "Participants", "Share Screen", "12:30", "", "leave meeting", "you", "a", "This is a very long sentence that is not a name"] {
            assert_eq!(clean_display_name(junk), None, "{junk}");
        }
    }

    #[test]
    fn attendee_fuzzy_matching() {
        let c = vec![s("Rahul Sharma"), s("Priya Patel"), s("Daniel Kim")];
        assert_eq!(match_candidate("Rahul Sharma", &c).unwrap().0, "Rahul Sharma");
        assert_eq!(match_candidate("rahul", &c).unwrap().0, "Rahul Sharma");
        assert_eq!(match_candidate("Rahul S.", &c).unwrap().0, "Rahul Sharma");
        assert_eq!(match_candidate("Rahu1 Sharma", &c).unwrap().0, "Rahul Sharma"); // OCR slip
        assert_eq!(match_candidate("Priya", &c).unwrap().0, "Priya Patel");
        assert_eq!(match_candidate("Dan", &c), None); // short names must match exactly
        assert_eq!(match_candidate("Meera", &c), None);
        assert_eq!(match_candidate("Rahul", &[]), None);
        // two Rahuls on the invite: "Rahul" alone is ambiguous, the full name isn't
        let two = vec![s("Rahul Sharma"), s("Rahul Verma")];
        assert_eq!(match_candidate("Rahul", &two), None);
        assert_eq!(match_candidate("Rahul Verma", &two).unwrap().0, "Rahul Verma");
        assert!(name_score("Rahul", "Raj") < 0.5);
    }

    #[test]
    fn active_speaker_from_text_and_ax() {
        assert_eq!(active_from_text("Rahul Sharma is speaking"), Some((s("Rahul Sharma"), 1.0)));
        assert_eq!(active_from_text("Priya Patel, speaking"), Some((s("Priya Patel"), 0.9)));
        assert_eq!(active_from_text("Priya (Speaking)"), Some((s("Priya"), 0.9)));
        assert_eq!(active_from_text("Active speaker: Daniel Kim"), Some((s("Daniel Kim"), 1.0)));
        assert_eq!(active_from_text("Rahul is presenting").map(|x| x.1), Some(0.35));
        assert_eq!(active_from_text("Rahul Sharma, speaking, muted").map(|x| x.0), Some(s("Rahul Sharma")));
        assert_eq!(active_from_text("Mute"), None);
        assert_eq!(active_from_text("Public speaking tips"), None);
        let c = vec![s("Rahul Sharma"), s("Priya Patel")];
        let ax = vec![s("Mute"), s("Rahul S. is speaking"), s("Priya Patel")];
        assert_eq!(active_from_ax(&ax, &c), Some((s("Rahul Sharma"), 1.0)));
        // two people "speaking" at once → no reading
        assert_eq!(active_from_ax(&[s("Rahul is speaking"), s("Priya is speaking")], &c), None);
        assert_eq!(active_from_ax(&[s("Chat"), s("Priya Patel")], &c), None, "a tile name alone isn't 'speaking'");
    }

    #[test]
    fn ocr_picks_the_big_tile_only_when_it_stands_out() {
        let c = vec![s("Rahul Sharma"), s("Priya Patel"), s("Jake Miller")];
        let l = |t: &str, h: f32| OcrLine { text: t.into(), x: 0.0, y: 0.0, w: 100.0, h };
        // speaker view: Priya's name on the big tile, small strip names
        let speaker_view = vec![l("Priya Patel", 28.0), l("Rahul Sharma", 12.0), l("Jake Miller (me)", 12.0), l("Mute", 14.0)];
        assert_eq!(active_from_ocr(&speaker_view, &c), Some((s("Priya Patel"), 0.6)));
        // gallery: equal tiles → nothing
        let gallery = vec![l("Priya Patel", 14.0), l("Rahul Sharma", 14.0), l("Jake Miller", 14.0)];
        assert_eq!(active_from_ocr(&gallery, &c), None);
        // explicit text wins
        let explicit = vec![l("Rahul Sharma is speaking", 10.0), l("Priya Patel", 28.0)];
        assert_eq!(active_from_ocr(&explicit, &c).unwrap().0, "Rahul Sharma");
        // no guest list → don't guess from big captions
        assert_eq!(active_from_ocr(&speaker_view, &[]), None);
    }

    #[test]
    fn votes_follow_the_voice_talking_at_the_time() {
        let turns = vec![turn(0.0, 5.0, "Speaker 1"), turn(5.5, 10.0, "Speaker 2"), turn(9.0, 12.0, "You")];
        let o = vec![obs(1.0, "Rahul"), obs(3.0, "Rahul"), obs(6.0, "Rahul"), obs(7.5, "Priya"), obs(9.5, "Priya"), obs(20.0, "Rahul"), obs(5.1, "Rahul")];
        let v = tally(&turns, &o);
        assert_eq!(v["Speaker 1"]["Rahul"], 3.0, "{v:?}"); // 1.0, 3.0 and 5.1 (indicator lingers)
        // 6.0 is during Speaker 2 but within Speaker 1's linger window → ambiguous, skipped
        assert_eq!(v["Speaker 2"].get("Rahul"), None, "{v:?}");
        assert_eq!(v["Speaker 2"]["Priya"], 1.0); // 9.5 overlaps "You" → skipped
        assert!(!v.contains_key("You"));
    }

    #[test]
    fn screen_decision_needs_votes_share_and_exclusivity() {
        let mut v: BTreeMap<String, BTreeMap<String, f32>> = BTreeMap::new();
        let mut put = |l: &str, n: &str, w: f32| *v.entry(l.into()).or_default().entry(n.into()).or_default() += w;
        put("Speaker 1", "Rahul", 9.0);
        put("Speaker 1", "Priya", 1.0);
        put("Speaker 2", "Priya", 7.0);
        put("Speaker 3", "Daniel", 1.0); // too few votes
        put("You", "Jake", 5.0);
        put("Speaker 4", "Jake", 1.0);
        put("Speaker 4", "Board", 1.5); // a pinned tile active whatever the voice
        put("Speaker 1", "Board", 2.0);
        let (d, me) = decide_screen(&v, "You");
        assert_eq!(me.as_deref(), Some("Jake"));
        assert_eq!(d["Speaker 1"].name, "Rahul");
        assert!(d["Speaker 1"].confidence >= APPLY, "{:?}", d["Speaker 1"]);
        assert_eq!(d["Speaker 2"].name, "Priya");
        assert!(!d.contains_key("Speaker 3"));
        assert!(!d.contains_key("Speaker 4"), "{d:?}");
        // a name active for every voice is exclusive to none
        let mut v2: BTreeMap<String, BTreeMap<String, f32>> = BTreeMap::new();
        v2.entry("Speaker 1".into()).or_default().insert("Board".into(), 5.0);
        v2.entry("Speaker 2".into()).or_default().insert("Board".into(), 5.0);
        assert!(decide_screen(&v2, "You").0.is_empty());
        // confidence rises with evidence
        let conf = |w: f32| {
            let mut m: BTreeMap<String, BTreeMap<String, f32>> = BTreeMap::new();
            m.entry("Speaker 1".into()).or_default().insert("Rahul".into(), w);
            decide_screen(&m, "You").0.get("Speaker 1").map(|g| g.confidence).unwrap_or(0.0)
        };
        assert!(conf(2.0) < APPLY && conf(2.0) >= SUGGEST);
        assert!(conf(8.0) >= APPLY);
        assert!(conf(1.0) == 0.0);
    }

    #[test]
    fn intros_in_english_and_hinglish() {
        assert_eq!(parse_intro("Hi everyone, I'm Rahul from the design team.").as_deref(), Some("Rahul"));
        assert_eq!(parse_intro("Hello, my name is Priya Patel.").as_deref(), Some("Priya Patel"));
        assert_eq!(parse_intro("This is Daniel, can you hear me?").as_deref(), Some("Daniel"));
        assert_eq!(parse_intro("Rahul here.").as_deref(), Some("Rahul"));
        assert_eq!(parse_intro("Myself Arjun, I handle sales.").as_deref(), Some("Arjun"));
        assert_eq!(parse_intro("Haan, main Rahul bol raha hoon.").as_deref(), Some("Rahul"));
        assert_eq!(parse_intro("Mera naam Priya hai.").as_deref(), Some("Priya"));
        assert_eq!(parse_intro("नमस्ते, मैं राहुल बोल रहा हूँ।").as_deref(), Some("राहुल"));
        assert_eq!(parse_intro("मेरा नाम प्रिया है").as_deref(), Some("प्रिया"));
        for no in ["I'm going to share my screen.", "I'm sure that works.", "I am not sure.", "So this is Rahul's deck.", "I'm Sorry, what?", "this is great", "Main kal bhej dunga", "I'm muted"] {
            assert_eq!(parse_intro(no), None, "{no}");
        }
    }

    fn cl(label: &str, c: &[f32]) -> Cluster {
        Cluster { label: label.into(), centroid: speakers::normalize(c.to_vec()), count: 5 }
    }

    #[test]
    fn resolve_combines_signals_and_never_guesses_weakly() {
        let mut screen = vec![];
        let mut turns = vec![];
        for k in 0..10 {
            let t = k as f64 * 10.0;
            turns.push(turn(t, t + 4.0, "Speaker 1"));
            turns.push(turn(t + 5.0, t + 9.0, "Speaker 2"));
            screen.push(obs(t + 1.0, "Rahul S."));
            screen.push(obs(t + 2.5, "Rahul S."));
            screen.push(obs(t + 6.0, "Priya Patel")); // inside Speaker 1's linger? 6.0 > 4+1.2 → no
        }
        let input = NamingInput {
            clusters: vec![cl("Speaker 1", &[1.0, 0.0]), cl("Speaker 2", &[0.0, 1.0]), cl("Speaker 3", &[1.0, 1.0])],
            turns,
            screen,
            lines: vec![(s("Speaker 3"), s("Hi, I'm Daniel."))],
            attendees: vec![s("Rahul Sharma"), s("Priya Patel"), s("Jake Miller")],
            self_names: vec![s("Jake")],
            ..Default::default()
        };
        let o = resolve(&input);
        assert_eq!(o.apply["Speaker 1"].name, "Rahul Sharma", "{o:?}");
        assert_eq!(o.apply["Speaker 2"].name, "Priya Patel", "{o:?}");
        assert_eq!(o.suggest["Speaker 3"].name, "Daniel");
        assert_eq!(o.suggest["Speaker 3"].source, Source::Intro);
        assert!(!o.apply.contains_key("Speaker 3"));
    }

    #[test]
    fn one_on_one_calendar_suggests_and_intro_agrees() {
        let input = NamingInput {
            clusters: vec![cl("Speaker 1", &[1.0, 0.0])],
            attendees: vec![s("Jake Miller"), s("Rahul Sharma")],
            self_names: vec![s("Jake Miller")],
            ..Default::default()
        };
        let o = resolve(&input);
        assert_eq!(o.suggest["Speaker 1"].name, "Rahul Sharma");
        assert!(o.apply.is_empty());
        // + the voice introduces itself as Rahul → stronger, still only a suggestion
        let o = resolve(&NamingInput { lines: vec![(s("Speaker 1"), s("Hey, Rahul here."))], ..input.clone() });
        let g = &o.suggest["Speaker 1"];
        assert!(g.name == "Rahul Sharma" && g.confidence > 0.55 && g.confidence < APPLY, "{g:?}");
        // the user is never named after themselves
        let o = resolve(&NamingInput { lines: vec![(s("Speaker 1"), s("I'm Jake."))], attendees: vec![], ..input });
        assert!(o.suggest.is_empty() && o.apply.is_empty(), "{o:?}");
    }

    #[test]
    fn remembered_voice_is_kept_or_demoted_by_a_clear_screen_contradiction() {
        let voices = vec![Voice { name: s("Rahul"), embedding: speakers::normalize(vec![1.0, 0.0]), samples: 9 }];
        let base = NamingInput { clusters: vec![cl("Rahul", &[1.0, 0.05])], voices, ..Default::default() };
        let o = resolve(&base);
        assert_eq!(o.kept["Rahul"].source, Source::Voice);
        assert!(o.kept["Rahul"].confidence >= APPLY);
        let turns: Vec<Turn> = (0..10).map(|k| turn(k as f64 * 5.0, k as f64 * 5.0 + 4.0, "Rahul")).collect();
        let screen: Vec<ScreenObs> = (0..10).flat_map(|k| [obs(k as f64 * 5.0 + 1.0, "Arjun"), obs(k as f64 * 5.0 + 3.0, "Arjun")]).collect();
        let o = resolve(&NamingInput { turns, screen, ..base });
        assert_eq!(o.demoted.get("Rahul").map(String::as_str), Some("Arjun"));
        assert!(o.kept.is_empty() && o.apply.is_empty());
        assert_eq!(o.suggest["Rahul"].name, "Arjun");
        assert!(o.suggest["Rahul"].confidence < APPLY);
    }

    #[test]
    fn live_names_appear_once_confident() {
        let mut l = LiveNames { attendees: vec![s("Rahul Sharma")], ..Default::default() };
        l.add_turn(turn(0.0, 3.0, "Speaker 1"));
        l.add_obs(obs(1.0, "Rahul"));
        assert_eq!(l.display("Speaker 1"), "Speaker 1");
        for k in 1..8 {
            let t = k as f64 * 4.0;
            l.add_turn(turn(t, t + 3.0, "Speaker 1"));
            l.add_obs(obs(t + 1.0, "Rahul"));
            l.add_obs(obs(t + 2.5, "Rahul"));
        }
        assert_eq!(l.display("Speaker 1"), "Rahul Sharma");
        assert!(l.first_name_at.is_some());
        assert_eq!(l.display("Speaker 9"), "Speaker 9");
    }

    #[test]
    fn self_voice_needs_enough_mic_speech() {
        let e = |x: f32| speakers::normalize(vec![1.0, x]);
        assert!(self_voice_update(None, &[e(0.0), e(0.1)]).is_none());
        let (c, n) = self_voice_update(None, &[e(0.0), e(0.1), e(0.05)]).unwrap();
        assert_eq!(n, 3);
        assert!(speakers::cosine(&c, &e(0.05)) > 0.99);
        let stored = Voice { name: s(SELF_VOICE), embedding: e(0.0), samples: 10 };
        assert_eq!(self_voice_update(Some(&stored), &[e(0.0), e(0.1), e(0.05)]).unwrap().1, 13);
    }

    #[test]
    fn edit_distance_basics() {
        assert_eq!(edit_distance("kitten", "sitting"), 3);
        assert_eq!(edit_distance("", "ab"), 2);
        assert_eq!(edit_distance("rahul", "rahul"), 0);
    }
}
