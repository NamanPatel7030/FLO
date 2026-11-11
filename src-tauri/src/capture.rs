//! Task capture: how selective Flo is when it notes to-dos on its own (from the screen, and from
//! meeting action items). The model grades each candidate in the same call that finds it
//! (`prompts::attention_system`); everything here is deterministic, so a level behaves the same
//! on every platform and with every model.
use crate::prompts::ExtractedTodo;
use std::collections::{HashSet, VecDeque};

/// Settings → Privacy → Task capture. Stored in settings as its `as_str()` value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CaptureLevel {
    /// only clear requests, commitments and deadlines with real consequence
    Essential,
    /// essential plus concrete next steps that matter
    #[default]
    Balanced,
    /// everything actionable, including small items
    Comprehensive,
}

impl CaptureLevel {
    /// Tolerant: also accepts the plain words people use ("high level", "medium", "in-depth").
    /// Anything unknown is Balanced.
    pub fn parse(s: &str) -> Self {
        match s.trim().to_lowercase().replace(['-', '_'], " ").as_str() {
            "essential" | "high level" | "high" | "minimal" => Self::Essential,
            "comprehensive" | "in depth" | "indepth" | "detailed" | "everything" => Self::Comprehensive,
            _ => Self::Balanced,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Essential => "essential",
            Self::Balanced => "balanced",
            Self::Comprehensive => "comprehensive",
        }
    }

    /// lowest graded importance (1 to 5) that is kept
    pub fn min_importance(self) -> u8 {
        match self {
            Self::Essential => 4,
            Self::Balanced => 3,
            Self::Comprehensive => 2,
        }
    }

    /// lowest model confidence that is kept
    pub fn min_confidence(self) -> f64 {
        match self {
            Self::Essential => 0.75,
            Self::Balanced => 0.6,
            Self::Comprehensive => 0.5,
        }
    }

    /// most to-dos added from one look at the screen
    pub fn max_per_pass(self) -> usize {
        match self {
            Self::Essential => 2,
            Self::Balanced => 3,
            Self::Comprehensive => 5,
        }
    }

    /// most to-dos Attention adds in any rolling hour
    pub fn max_per_hour(self) -> usize {
        match self {
            Self::Essential => 4,
            Self::Balanced => 10,
            Self::Comprehensive => 24,
        }
    }
}

/// Why a candidate was not added (kept for tests and debug logs).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Skip {
    Vague,
    Done,
    NotForYou,
    Noise,
    BelowLevel,
    LowConfidence,
}

/// What the model says a candidate is (`prompts::attention_system`). Unknown kinds are judged on
/// importance alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    /// request, commitment, deadline, meeting, or not given
    Owed,
    NextStep,
    Minor,
    Noise,
}

fn kind_of(k: Option<&str>) -> Kind {
    match k.unwrap_or("").trim().to_lowercase().replace(['-', ' '], "_").as_str() {
        "next_step" | "step" | "task" => Kind::NextStep,
        "minor" | "routine" | "optional" | "small" => Kind::Minor,
        "noise" | "fyi" | "ad" | "ads" | "ui" | "notification" | "promotion" => Kind::Noise,
        _ => Kind::Owed,
    }
}

/// Words that say nothing about WHAT to do or for whom ("Follow up", "Check this").
const GENERIC: &[&str] = &[
    "check", "review", "look", "into", "at", "follow", "up", "reply", "respond", "read", "see", "do", "it", "this", "that", "these",
    "those", "more", "here", "click", "task", "todo", "something", "stuff", "things", "thing", "item", "items", "update", "updates",
    "now", "later", "please", "the", "a", "an", "to", "on", "for", "and", "of", "with", "out", "get", "go", "buy", "open",
];

/// Too short or too generic to act on later.
pub fn is_vague(title: &str) -> bool {
    let lower = title.to_lowercase();
    let words: Vec<&str> = lower.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();
    let content = words.iter().filter(|w| !GENERIC.contains(w)).count();
    let chars = words.iter().map(|w| w.chars().count()).sum::<usize>();
    content == 0 || (content == 1 && chars < 10)
}

/// Shop prompts, banners and app chrome that a careless model turns into "tasks".
const NOISE: &[&str] = &[
    "to cart", "to your cart", "to bag", "buy now", "shop now", "order now", "sign up for", "subscribe", "cookies", "enable notifications",
    "turn on notifications", "allow notifications", "rate this app", "rate us", "leave a review", "% off", "free shipping", "limited time",
    "claim your", "upgrade to premium", "upgrade to pro", "start free trial", "verify you are human", "captcha", "recommended for you",
];

pub fn is_noise_title(title: &str) -> bool {
    let t = title.to_lowercase();
    NOISE.iter().any(|n| t.contains(n))
}

/// Flo's own windows (dashboard, notch, setup), whatever the build is called.
pub fn is_flo_window(app: &str, title: &str) -> bool {
    let a = app.trim().to_lowercase();
    a == "flo" || a.starts_with("flo ") || a.starts_with("flo-") || title.trim().eq_ignore_ascii_case("flo")
}

const STOP: &[&str] = &[
    "the", "a", "an", "to", "for", "of", "and", "on", "in", "about", "with", "my", "me", "is", "your", "you", "by", "at", "from", "this",
    "that", "please", "re", "regarding",
];

/// Content words, lightly stemmed ("invoices" = "invoice").
fn norm_tokens(s: &str) -> HashSet<String> {
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.chars().count() > 1 && !STOP.contains(w))
        .map(|w| if w.len() > 3 && w.ends_with('s') && !w.ends_with("ss") { w[..w.len() - 1].to_string() } else { w.to_string() })
        .collect()
}

/// Same task in other words: close word overlap, or one title is the other plus detail
/// ("Pay electricity bill" / "Pay the electricity bill by Friday").
pub fn is_duplicate(title: &str, existing: &[String]) -> bool {
    let a = norm_tokens(title);
    if a.is_empty() {
        return false;
    }
    existing.iter().any(|e| {
        let b = norm_tokens(e);
        if b.is_empty() {
            return false;
        }
        let inter = a.intersection(&b).count();
        let jaccard = inter as f64 / a.union(&b).count() as f64;
        let (small, large) = if a.len() <= b.len() { (&a, &b) } else { (&b, &a) };
        let contained = inter == small.len() && (small.len() >= 3 || (small.len() == 2 && large.len() <= 3));
        jaccard >= 0.6 || contained
    })
}

/// Grade one candidate for this level: Ok(importance 1 to 5) or why it was skipped.
pub fn judge(t: &ExtractedTodo, level: CaptureLevel) -> Result<u8, Skip> {
    if is_vague(&t.title) {
        return Err(Skip::Vague);
    }
    if t.done == Some(true) {
        return Err(Skip::Done);
    }
    if t.for_user == Some(false) {
        return Err(Skip::NotForYou);
    }
    let kind = kind_of(t.kind.as_deref());
    if kind == Kind::Noise || is_noise_title(&t.title) {
        return Err(Skip::Noise);
    }
    let mut score = t.importance.map(|i| i.round().clamp(1.0, 5.0) as u8).unwrap_or(3);
    let dated = t.due.as_deref().is_some_and(|d| d.len() >= 10 && d.is_char_boundary(10) && chrono::NaiveDate::parse_from_str(&d[..10], "%Y-%m-%d").is_ok());
    if kind == Kind::Minor {
        score = score.min(2);
    } else if dated {
        score = score.max(3);
    }
    if score < level.min_importance() {
        return Err(Skip::BelowLevel);
    }
    // Essential is for what you owe someone or what is due, not steps in your own work
    if level == CaptureLevel::Essential && kind != Kind::Owed {
        return Err(Skip::BelowLevel);
    }
    if t.confidence.unwrap_or(0.6) < level.min_confidence() {
        return Err(Skip::LowConfidence);
    }
    Ok(score)
}

/// What Attention adds from one model reply: graded, most important first, without repeats of
/// existing to-dos (or of each other), and no more than this look's share and the hour's `room`.
pub fn select(found: Vec<ExtractedTodo>, level: CaptureLevel, existing: &[String], room: usize) -> Vec<ExtractedTodo> {
    let mut graded: Vec<(u8, ExtractedTodo)> = found.into_iter().filter_map(|t| judge(&t, level).ok().map(|s| (s, t))).collect();
    graded.sort_by(|a, b| b.0.cmp(&a.0)); // stable: the model's order breaks ties
    let cap = level.max_per_pass().min(room);
    let mut seen: Vec<String> = existing.to_vec();
    let mut out = vec![];
    for (_, t) in graded {
        if out.len() >= cap {
            break;
        }
        if is_duplicate(&t.title, &seen) {
            continue;
        }
        seen.push(t.title.clone());
        out.push(t);
    }
    out
}

/// Meeting action items: Essential keeps only yours (or unowned ones); every level drops vague ones.
pub fn keep_meeting_item(mine: bool, task: &str, level: CaptureLevel) -> bool {
    !is_vague(task) && (mine || level != CaptureLevel::Essential)
}

/// Rolling one-hour count of to-dos Attention added (unix seconds).
#[derive(Debug, Default)]
pub struct RateWindow {
    added: VecDeque<i64>,
}

impl RateWindow {
    pub const fn new() -> Self {
        Self { added: VecDeque::new() }
    }

    /// How many more may be added now at this level.
    pub fn room(&mut self, now: i64, level: CaptureLevel) -> usize {
        while self.added.front().is_some_and(|t| *t <= now - 3600) {
            self.added.pop_front();
        }
        level.max_per_hour().saturating_sub(self.added.len())
    }

    pub fn record(&mut self, now: i64, n: usize) {
        self.added.extend(std::iter::repeat_n(now, n));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::prompts::parse_attention;
    use CaptureLevel::*;

    fn titles(v: &[ExtractedTodo]) -> Vec<&str> {
        v.iter().map(|t| t.title.as_str()).collect()
    }

    fn todo(title: &str, kind: &str, importance: f64, confidence: f64) -> ExtractedTodo {
        ExtractedTodo { title: title.into(), kind: Some(kind.into()), importance: Some(importance), confidence: Some(confidence), for_user: Some(true), done: Some(false), ..Default::default() }
    }

    /// Run a stubbed model reply through the same steps Attention uses, at every level.
    fn survivors(model_reply: &str, existing: &[String]) -> [Vec<String>; 3] {
        [Essential, Balanced, Comprehensive].map(|l| {
            let found = parse_attention(model_reply, 0.0);
            titles(&select(found, l, existing, l.max_per_hour())).into_iter().map(String::from).collect()
        })
    }

    #[test]
    fn level_parsing_is_tolerant_and_defaults_to_balanced() {
        for (s, l) in [
            ("essential", Essential),
            (" Essential ", Essential),
            ("high level", Essential),
            ("High-Level", Essential),
            ("balanced", Balanced),
            ("medium", Balanced),
            ("comprehensive", Comprehensive),
            ("in-depth", Comprehensive),
            ("In depth", Comprehensive),
            ("", Balanced),
            ("whatever", Balanced),
        ] {
            assert_eq!(CaptureLevel::parse(s), l, "{s:?}");
        }
        for l in [Essential, Balanced, Comprehensive] {
            assert_eq!(CaptureLevel::parse(l.as_str()), l);
        }
        assert_eq!(CaptureLevel::default(), Balanced);
        assert_eq!(crate::model::Settings::default().task_capture, "balanced");
        // settings saved before this option existed load as Balanced
        let old: crate::model::Settings = serde_json::from_str(r#"{"userName":"Parth"}"#).unwrap();
        assert_eq!(CaptureLevel::parse(&old.task_capture), Balanced);
    }

    #[test]
    fn thresholds_get_stricter_from_comprehensive_to_essential() {
        assert!(Essential.min_importance() > Balanced.min_importance());
        assert!(Balanced.min_importance() > Comprehensive.min_importance());
        assert!(Essential.min_confidence() > Balanced.min_confidence());
        assert!(Balanced.min_confidence() > Comprehensive.min_confidence());
        assert!(Essential.max_per_pass() < Balanced.max_per_pass() && Balanced.max_per_pass() < Comprehensive.max_per_pass());
        assert!(Essential.max_per_hour() < Balanced.max_per_hour() && Balanced.max_per_hour() < Comprehensive.max_per_hour());
    }

    #[test]
    fn judge_applies_fixed_thresholds() {
        let ask = todo("Reply to Rahul about the invoice", "request", 4.0, 0.9);
        assert_eq!(judge(&ask, Essential), Ok(4));
        assert_eq!(judge(&ask, Balanced), Ok(4));

        let step = todo("Write the migration for the billing table", "next_step", 3.0, 0.8);
        assert_eq!(judge(&step, Essential), Err(Skip::BelowLevel));
        assert_eq!(judge(&step, Balanced), Ok(3));
        // Essential never takes plain next steps, however important they are graded
        let big_step = todo("Fix the token cache leak before release", "next_step", 4.0, 0.9);
        assert_eq!(judge(&big_step, Essential), Err(Skip::BelowLevel));
        assert_eq!(judge(&big_step, Balanced), Ok(4));

        let small = todo("Update your Slack status", "minor", 4.0, 0.9);
        // minor is capped at 2 even when the model over-grades it
        assert_eq!(judge(&small, Balanced), Err(Skip::BelowLevel));
        assert_eq!(judge(&small, Comprehensive), Ok(2));

        let trivial = todo("React to the lunch order thread", "minor", 1.0, 0.9);
        assert_eq!(judge(&trivial, Comprehensive), Err(Skip::BelowLevel));

        // a dated task is at least medium
        let mut dated = todo("Submit the travel reimbursement form", "deadline", 2.0, 0.8);
        dated.due = Some("2026-11-14".into());
        assert_eq!(judge(&dated, Balanced), Ok(3));

        let unsure = todo("Send Priya the signed contract", "request", 5.0, 0.7);
        assert_eq!(judge(&unsure, Essential), Err(Skip::LowConfidence));
        assert_eq!(judge(&unsure, Balanced), Ok(5));

        let mut done = ask.clone();
        done.done = Some(true);
        assert_eq!(judge(&done, Comprehensive), Err(Skip::Done));
        let mut theirs = ask.clone();
        theirs.for_user = Some(false);
        assert_eq!(judge(&theirs, Comprehensive), Err(Skip::NotForYou));
        assert_eq!(judge(&todo("Open the notifications panel today", "noise", 3.0, 0.9), Comprehensive), Err(Skip::Noise));
        assert_eq!(judge(&todo("Add the earbuds to cart", "next_step", 3.0, 0.9), Comprehensive), Err(Skip::Noise));
        assert_eq!(judge(&todo("Follow up", "request", 5.0, 0.9), Comprehensive), Err(Skip::Vague));

        // an old-style reply with no grades: medium importance, so Balanced keeps a confident one
        let bare = ExtractedTodo { title: "Reply to Rahul about the invoice".into(), confidence: Some(0.8), ..Default::default() };
        assert_eq!(judge(&bare, Balanced), Ok(3));
        assert_eq!(judge(&bare, Essential), Err(Skip::BelowLevel));
    }

    #[test]
    fn vague_and_noise_titles() {
        for t in ["Follow up", "Check this", "Reply", "Look into it", "Read more", "Review PR", "Invoice", "", "  "] {
            assert!(is_vague(t), "{t:?} should be vague");
        }
        for t in ["Reply to Rahul about the invoice", "Call Mom", "Pay the electricity bill", "Update the roadmap", "Review PR #482"] {
            assert!(!is_vague(t), "{t:?} is specific");
        }
        for t in ["Add the earbuds to cart", "Buy now before the deal ends", "Sign up for Prime", "Accept cookies", "Enable notifications for Slack", "Rate this app", "Get 40% off headphones"] {
            assert!(is_noise_title(t), "{t:?} is noise");
        }
        for t in ["Pay the electricity bill", "Order the team lunch for Friday", "Reply to Asha about cart checkout bug"] {
            assert!(!is_noise_title(t), "{t:?} is a task");
        }
    }

    #[test]
    fn flo_windows_are_never_read() {
        assert!(is_flo_window("Flo", "To-dos"));
        assert!(is_flo_window("flo-flow", ""));
        assert!(is_flo_window("Flo Dev", "Settings"));
        assert!(is_flo_window("Google Chrome", "Flo"));
        assert!(!is_flo_window("Slack", "#flow-team"));
        assert!(!is_flo_window("Google Chrome", "Flow state - Wikipedia"));
    }

    #[test]
    fn fuzzy_dedupe_against_existing_todos() {
        let existing = vec!["Review the auth PR for Karan".to_string(), "Pay electricity bill".to_string(), "Send invoices to Acme".to_string()];
        assert!(is_duplicate("Review Karan's auth PR before the 3pm release", &existing));
        assert!(is_duplicate("Pay the electricity bill", &existing));
        assert!(is_duplicate("Send the invoice to Acme", &existing));
        assert!(!is_duplicate("Reply to Karan about the offsite", &existing));
        assert!(!is_duplicate("Pay the internet bill", &existing));
        assert!(!is_duplicate("Book flights", &[]));
    }

    #[test]
    fn select_dedupes_ranks_and_caps() {
        let found = vec![
            todo("Write the migration for the billing table", "next_step", 3.0, 0.8),
            todo("Reply to Rahul about the invoice", "request", 4.0, 0.9),
            todo("Reply to Rahul regarding the invoice", "request", 4.0, 0.9), // same task twice in one reply
            todo("Pay the electricity bill", "deadline", 5.0, 0.95),
            todo("Book the offsite venue for December", "commitment", 4.0, 0.85),
        ];
        let got = select(found.clone(), Balanced, &[], 10);
        // most important first, the repeat dropped, capped at Balanced's 3 per look
        assert_eq!(titles(&got), vec!["Pay the electricity bill", "Reply to Rahul about the invoice", "Book the offsite venue for December"]);
        // already a to-do (open, or done recently): skipped
        let got = select(found.clone(), Balanced, &["Pay electricity bill".into()], 10);
        assert_eq!(titles(&got)[0], "Reply to Rahul about the invoice");
        // the hourly budget is nearly spent
        assert_eq!(select(found.clone(), Balanced, &[], 1).len(), 1);
        assert!(select(found, Balanced, &[], 0).is_empty());
    }

    #[test]
    fn hourly_rate_limit_per_level() {
        let mut w = RateWindow::default();
        let t0 = 1_000_000;
        assert_eq!(w.room(t0, Essential), Essential.max_per_hour());
        w.record(t0, 3);
        assert_eq!(w.room(t0 + 60, Essential), Essential.max_per_hour() - 3);
        assert_eq!(w.room(t0 + 60, Comprehensive), Comprehensive.max_per_hour() - 3);
        w.record(t0 + 60, 50);
        assert_eq!(w.room(t0 + 120, Comprehensive), 0);
        // an hour later the window is clear again
        assert_eq!(w.room(t0 + 3700, Essential), Essential.max_per_hour());
    }

    #[test]
    fn meeting_items_follow_the_level() {
        assert!(keep_meeting_item(true, "Send the pricing deck by Friday", Essential));
        assert!(!keep_meeting_item(false, "Rahul: send the pricing deck", Essential));
        assert!(keep_meeting_item(false, "Rahul: send the pricing deck", Balanced));
        assert!(keep_meeting_item(false, "Rahul: send the pricing deck", Comprehensive));
        assert!(!keep_meeting_item(true, "Follow up", Comprehensive));
    }

    // ── fixtures: realistic noisy screens, with the reply a model gives for them ─────────────

    /// What the model sees for this screen, so the fixture's screen text stays honest.
    fn prompt_for(app: &str, window: &str, screen: &str) -> String {
        let fresh = crate::text::new_lines("", screen).join("\n");
        assert!(crate::text::attention_prefilter(&fresh, "Parth"), "prefilter must pass for {app}");
        crate::prompts::attention_user(app, window, &fresh, "")
    }

    #[test]
    fn fixture_busy_slack_channel() {
        let screen = "#eng-general\n\
Priya Shah 10:02 AM  Morning all! Standup moved to 10:30\n\
Karan 10:05 AM  @Parth can you review the auth PR before the 3pm release?\n\
Dev 10:06 AM  I'll fix the flaky login test today\n\
Priya Shah 10:07 AM  Lunch order closes at 12, react with pizza if you're in\n\
Slackbot  Reminder: update your status\n\
Karan 10:10 AM  also @Parth please send the client the revised estimate by Friday\n\
Meera 10:11 AM  Has anyone seen the new design doc?\n\
Parth 10:12 AM  Done, pushed the hotfix";
        let p = prompt_for("Slack", "#eng-general", screen);
        assert!(p.contains("@Parth can you review the auth PR"));
        let reply = r#"{"todos":[
 {"title":"Review Karan's auth PR before the 3pm release","reason":"@Parth can you review the auth PR before the 3pm release?","person":"Karan","due":"2026-11-11","kind":"request","importance":5,"forUser":true,"done":false,"confidence":0.93},
 {"title":"Send the client the revised estimate","reason":"please send the client the revised estimate by Friday","person":"Karan","due":"2026-11-13","kind":"request","importance":4,"forUser":true,"done":false,"confidence":0.88},
 {"title":"Fix the flaky login test","reason":"I'll fix the flaky login test today","person":"Dev","kind":"commitment","importance":3,"forUser":false,"done":false,"confidence":0.7},
 {"title":"Join the team lunch order before 12","reason":"Lunch order closes at 12","kind":"minor","importance":1,"forUser":true,"done":false,"confidence":0.6},
 {"title":"Update your Slack status","reason":"Slackbot reminder","kind":"minor","importance":2,"forUser":true,"done":false,"confidence":0.6},
 {"title":"Read the new design doc","reason":"Has anyone seen the new design doc?","kind":"next_step","importance":2,"forUser":true,"done":false,"confidence":0.6},
 {"title":"Push the hotfix","reason":"Done, pushed the hotfix","kind":"commitment","importance":4,"forUser":true,"done":true,"confidence":0.8}
]}"#;
        let [e, b, c] = survivors(reply, &[]);
        assert_eq!(e, ["Review Karan's auth PR before the 3pm release", "Send the client the revised estimate"]);
        assert_eq!(b, e);
        assert_eq!(c, ["Review Karan's auth PR before the 3pm release", "Send the client the revised estimate", "Update your Slack status", "Read the new design doc"]);
    }

    #[test]
    fn fixture_email_inbox() {
        let screen = "Inbox (1,204)\nPrimary  Promotions  Social\n\
Amazon  Your order has shipped  Track your package\n\
Rahul Mehta  Invoice #4471 overdue  Hi Parth, could you confirm payment by Thursday?\n\
LinkedIn  You appeared in 12 searches this week\n\
Medium Daily Digest  10 stories about productivity\n\
HDFC Bank  Credit card statement: payment due 15 Nov\n\
Sana (Acme)  Re: Q4 deck  Thanks Parth, looks great! No changes needed.\n\
Google  Security alert: new sign-in on Mac";
        prompt_for("Mail", "Inbox", screen);
        let reply = r#"{"todos":[
 {"title":"Confirm invoice #4471 payment with Rahul","reason":"could you confirm payment by Thursday?","person":"Rahul Mehta","due":"2026-11-12","kind":"request","importance":5,"forUser":true,"done":false,"confidence":0.91},
 {"title":"Pay the HDFC credit card bill","reason":"payment due 15 Nov","person":null,"due":"2026-11-15","kind":"deadline","importance":4,"forUser":true,"done":false,"confidence":0.86},
 {"title":"Check the new sign-in security alert","reason":"new sign-in on Mac","kind":"next_step","importance":3,"forUser":true,"done":false,"confidence":0.65},
 {"title":"Track the Amazon package","reason":"Your order has shipped","kind":"minor","importance":2,"forUser":true,"done":false,"confidence":0.6},
 {"title":"Look at LinkedIn search appearances","reason":"You appeared in 12 searches","kind":"noise","importance":1,"forUser":true,"done":false,"confidence":0.4},
 {"title":"Read the Medium daily digest","reason":"10 stories","kind":"minor","importance":1,"forUser":true,"done":false,"confidence":0.5},
 {"title":"Reply to Sana about the Q4 deck","reason":"No changes needed","person":"Sana","kind":"request","importance":3,"forUser":true,"done":true,"confidence":0.6}
]}"#;
        let [e, b, c] = survivors(reply, &[]);
        assert_eq!(e, ["Confirm invoice #4471 payment with Rahul", "Pay the HDFC credit card bill"]);
        assert_eq!(b, ["Confirm invoice #4471 payment with Rahul", "Pay the HDFC credit card bill", "Check the new sign-in security alert"]);
        assert_eq!(c, ["Confirm invoice #4471 payment with Rahul", "Pay the HDFC credit card bill", "Check the new sign-in security alert", "Track the Amazon package"]);
        // seen again later, with the invoice already a to-do: nothing repeats
        let [e2, ..] = survivors(reply, &["Confirm payment of invoice #4471 with Rahul".into()]);
        assert_eq!(e2, ["Pay the HDFC credit card bill"]);
    }

    #[test]
    fn fixture_code_editor_todo_comments() {
        let screen = "auth.rs\n\
fn refresh_token(&self) -> Result<Token> {\n\
    // TODO: handle expired refresh tokens\n\
    // FIXME(parth): token cache leaks on logout, must fix before release\n\
    // TODO(asha): rename this module\n\
    let t = self.store.get()?;\n\
warning: unused variable `t`\n\
PROBLEMS 3  OUTPUT  TERMINAL";
        prompt_for("Code", "auth.rs - flo", screen);
        let reply = r#"{"todos":[
 {"title":"Fix the token cache leak on logout before release","reason":"FIXME(parth): must fix before release","kind":"next_step","importance":4,"forUser":true,"done":false,"confidence":0.8},
 {"title":"Handle expired refresh tokens in refresh_token","reason":"TODO: handle expired refresh tokens","kind":"minor","importance":2,"forUser":true,"done":false,"confidence":0.7},
 {"title":"Rename the auth module","reason":"TODO(asha)","person":"Asha","kind":"next_step","importance":2,"forUser":false,"done":false,"confidence":0.6},
 {"title":"Fix the unused variable warning","reason":"warning: unused variable","kind":"minor","importance":1,"forUser":true,"done":false,"confidence":0.6},
 {"title":"Check problems","kind":"noise","importance":1,"confidence":0.3}
]}"#;
        let [e, b, c] = survivors(reply, &[]);
        assert!(e.is_empty(), "code comments are never Essential: {e:?}");
        assert_eq!(b, ["Fix the token cache leak on logout before release"]);
        assert_eq!(c, ["Fix the token cache leak on logout before release", "Handle expired refresh tokens in refresh_token"]);
    }

    #[test]
    fn fixture_shopping_site_adds_nothing_even_from_a_careless_model() {
        let screen = "Wireless Earbuds Pro\nDeal of the Day  -40% off\nAdd to Cart  Buy Now\n\
Only 3 left in stock, order soon.\n\
FREE delivery by tomorrow if you order within 2 hrs\n\
Sign up for Prime and save\nCustomers who viewed this also viewed\nAccept cookies";
        prompt_for("Google Chrome", "Amazon.in: Wireless Earbuds Pro", screen);
        // a small model that ignores the rules and grades shop prompts as tasks
        let reply = r#"{"todos":[
 {"title":"Add the earbuds to cart","kind":"next_step","importance":3,"forUser":true,"confidence":0.7},
 {"title":"Sign up for Prime and save","kind":"minor","importance":2,"forUser":true,"confidence":0.6},
 {"title":"Order the earbuds within 2 hours","kind":"noise","importance":3,"forUser":true,"confidence":0.6},
 {"title":"Accept cookies","kind":"next_step","importance":2,"confidence":0.9},
 {"title":"Buy now","importance":3,"confidence":0.9}
]}"#;
        let [e, b, c] = survivors(reply, &[]);
        assert!(e.is_empty() && b.is_empty() && c.is_empty(), "{e:?} {b:?} {c:?}");
    }
}
