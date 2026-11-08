//! Auto-continue a Claude Code session once its usage limit resets.
//!
//! When Claude Code stops because of a usage / rate limit ("You've hit your session limit · resets
//! 9am (Europe/London)", "Claude AI usage limit reached|1731000000", "API Error: 429 …"), Flo works
//! out when the limit resets and, if auto-continue is on (Settings, or per session), resumes the
//! session headlessly a minute after the reset:
//!
//!   claude --resume <session id> --print --output-format stream-json --verbose "<continue prompt>"
//!
//! in the session's folder. No permission-bypass flags: anything that needs permission goes through
//! Claude Code's normal rules (and Flo's PermissionRequest hook when that's installed). Typing in
//! the session after the limit cancels auto-continue for it. A run that hits the limit again waits
//! again (at most 3 tries a day). A reset missed while the Mac slept is picked up on wake / startup
//! within 12 hours.
//!
//! Detection sources: the session transcript's last entry (Claude Code writes the limit as a
//! synthetic assistant message, `isApiErrorMessage: true`), Stop / Notification hook payloads, and
//! the resumed run's own output. State lives in `<data dir>/autocontinue.json` (one entry per
//! session); run logs in `<data dir>/autocontinue/<session id>.log`.
use crate::model::{ev, ClaudeEvent, ClaudeSession};
use crate::state::Shared;
use anyhow::{anyhow, bail, Result};
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, NaiveTime, TimeZone, Weekday};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::State;

/// payload: AutoContinueView[] (every entry, newest first)
pub const EVENT: &str = "flo://autocontinue";
/// payload: { sessionId, line } — one new line of a resumed run's log
pub const LOG_EVENT: &str = "flo://autocontinue-log";

pub const DEFAULT_PROMPT: &str = "Continue where you left off.";
/// resume this long after the announced reset (limits don't always lift on the dot)
pub const GRACE_SECS: i64 = 60;
/// no reset time given (a bare 429 / rate_limit_error): try again after this long
pub const BACKOFF_MINS: i64 = 15;
/// resume attempts per session per day before Flo stops and asks you
pub const MAX_CYCLES_PER_DAY: u32 = 3;
/// a reset missed (Mac asleep / Flo closed) is still acted on within this window
pub const MISSED_WINDOW_HOURS: i64 = 12;

pub const WAITING: &str = "waiting";
pub const RESUMING: &str = "resuming";
pub const RESUMED: &str = "resumed";
pub const FAILED: &str = "failed";
pub const CANCELLED: &str = "cancelled";

// ── detection ───────────────────────────────────────────────────────────────

/// Does this text say Claude stopped because of a usage / rate limit? (Not a context-window limit,
/// and not the "Opus limit reached, now using Sonnet" fallback notice, which doesn't stop anything.)
pub fn is_limit_text(t: &str) -> bool {
    let l = t.to_lowercase();
    let has = |s: &str| l.contains(s);
    if has("context") || has("prompt is too long") || has("now using") || has("switching to") {
        return false;
    }
    (has("limit") && (has("reached") || has("hit your") || has("exceeded") || has("resets") || has("reset at") || has("will reset")))
        || has("rate_limit")
        || (has("429") && (has("api error") || has("too many requests") || has("rate")))
}

/// Text of a transcript line's message (string content or the text blocks).
fn entry_text(v: &Value) -> String {
    match &v["message"]["content"] {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("\n"),
        _ => v["content"].as_str().unwrap_or("").to_string(),
    }
}

/// A limit found at the end of a transcript: (message, when it was written).
#[derive(Debug, Clone, PartialEq)]
pub struct Found {
    pub text: String,
    pub at: Option<DateTime<Local>>,
}

/// Is the transcript's last turn a usage-limit stop? Reads from the end: the last assistant entry
/// must be the limit message (an API-error entry, or a short message that reads like one) with no
/// user prompt / tool result after it. Bookkeeping `system` lines are skipped.
pub fn limit_from_transcript(jsonl: &str) -> Option<Found> {
    for line in jsonl.lines().rev() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        let at = v["timestamp"].as_str().and_then(|t| DateTime::parse_from_rfc3339(t).ok()).map(|t| t.with_timezone(&Local));
        match v["type"].as_str().unwrap_or("") {
            "user" => {
                // a meta / injected reminder line is not the user moving on
                if v["isMeta"].as_bool() == Some(true) {
                    continue;
                }
                return None;
            }
            "assistant" => {
                let text = entry_text(&v);
                let api_error = v["isApiErrorMessage"].as_bool() == Some(true) || v["error"].is_string() || v["message"]["model"] == "<synthetic>";
                let t = text.trim();
                return ((api_error || t.chars().count() <= 300) && is_limit_text(t)).then(|| Found { text: crate::text::truncate_chars(t, 300), at });
            }
            "system" => {
                let text = entry_text(&v);
                let t = text.trim();
                if !t.is_empty() && t.chars().count() <= 300 && is_limit_text(t) {
                    return Some(Found { text: t.to_string(), at });
                }
            }
            _ => {}
        }
    }
    None
}

// ── reset time parsing ─────────────────────────────────────────────────────

/// UTC offset (seconds east) of an IANA zone at a UNIX time; None = unknown zone.
pub type OffsetFn<'a> = &'a dyn Fn(&str, i64) -> Option<i32>;

#[derive(Debug, Clone, PartialEq)]
pub struct Reset {
    pub at: Option<DateTime<Local>>,
    /// e.g. "Couldn't read the time zone Mars/Base; assumed this Mac's time"
    pub note: Option<String>,
}

fn weekday_of(t: &str) -> Option<Weekday> {
    let days = [
        ("mon", Weekday::Mon),
        ("tue", Weekday::Tue),
        ("wed", Weekday::Wed),
        ("thu", Weekday::Thu),
        ("fri", Weekday::Fri),
        ("sat", Weekday::Sat),
        ("sun", Weekday::Sun),
    ];
    if t.len() < 3 {
        return None;
    }
    let full = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "tues", "thur", "thurs"];
    days.iter().find(|(p, _)| t.starts_with(p) && (t.len() == 3 || full.contains(&t))).map(|(_, d)| *d)
}

fn month_of(t: &str) -> Option<u32> {
    const M: [&str; 12] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    if t.len() < 3 || t.chars().any(|c| !c.is_ascii_alphabetic()) {
        return None;
    }
    M.iter().position(|m| t.starts_with(m)).map(|i| i as u32 + 1)
}

/// "3pm", "3:30pm", "11:30" + "pm", "15:00", "9am" → (time, used the next token).
fn parse_clock(t: &str, next: Option<&str>) -> Option<(NaiveTime, bool)> {
    let t = t.replace('.', "");
    let next = next.map(|n| n.replace('.', ""));
    let (core, mer, used) = if let Some(c) = t.strip_suffix("am") {
        (c.to_string(), Some(false), false)
    } else if let Some(c) = t.strip_suffix("pm") {
        (c.to_string(), Some(true), false)
    } else if next.as_deref() == Some("am") {
        (t.clone(), Some(false), true)
    } else if next.as_deref() == Some("pm") {
        (t.clone(), Some(true), true)
    } else {
        (t.clone(), None, false)
    };
    let (h, m) = match core.split_once(':') {
        Some((h, m)) => (h.parse::<u32>().ok()?, m.parse::<u32>().ok()?),
        None => (core.parse::<u32>().ok()?, 0),
    };
    if m > 59 {
        return None;
    }
    let h = match mer {
        Some(pm) => {
            if !(1..=12).contains(&h) {
                return None;
            }
            h % 12 + if pm { 12 } else { 0 }
        }
        // a bare number is too ambiguous; a 24-hour time needs the colon
        None if core.contains(':') && h < 24 => h,
        None => return None,
    };
    Some((NaiveTime::from_hms_opt(h, m, 0)?, used))
}

/// "(Asia/Kolkata)" anywhere in the text → "Asia/Kolkata".
fn tz_in(text: &str) -> Option<String> {
    text.split('(').skip(1).filter_map(|r| r.split(')').next()).map(str::trim).find(|z| valid_tz(z)).map(String::from)
}

fn valid_tz(z: &str) -> bool {
    let u = z.to_ascii_uppercase();
    (u == "UTC" || u == "GMT")
        || (z.len() < 64
            && z.contains('/')
            && !z.contains("..")
            && !z.starts_with('/')
            && z.chars().next().map(|c| c.is_ascii_alphabetic()).unwrap_or(false)
            && z.chars().all(|c| c.is_ascii_alphanumeric() || "/_+-".contains(c)))
}

/// A wall-clock date + time in `tz` (None = this Mac's zone) as a local instant.
fn instant_in(d: NaiveDate, t: NaiveTime, tz: Option<&str>, off: OffsetFn) -> Option<DateTime<Local>> {
    let naive = d.and_time(t);
    let Some(tz) = tz else { return Local.from_local_datetime(&naive).earliest() };
    let guess = naive.and_utc().timestamp();
    let o1 = off(tz, guess)? as i64;
    let mut epoch = guess - o1;
    let o2 = off(tz, epoch)? as i64;
    if o2 != o1 {
        epoch = guess - o2; // crossed a DST change
    }
    Local.timestamp_opt(epoch, 0).single()
}

/// When does the limit in `text` reset? `base` = when the limit was hit. Handles an epoch suffix
/// ("…|1731000000"), "resets 3pm", "reset at 3:30 PM (Asia/Kolkata)", "resets Mon 9am",
/// "resets Nov 10, 9am", "resets in 2h". A time already past rolls to the next day; a weekday means
/// the next such day.
pub fn parse_reset_with(text: &str, base: DateTime<Local>, off: OffsetFn) -> Reset {
    // "Claude AI usage limit reached|1731000000" (seconds; milliseconds tolerated)
    if let Some(i) = text.find('|') {
        let digits: String = text[i + 1..].chars().take_while(|c| c.is_ascii_digit()).collect();
        if digits.len() >= 10 {
            if let Ok(mut n) = digits.parse::<i64>() {
                if digits.len() >= 13 {
                    n /= 1000;
                }
                return Reset { at: Local.timestamp_opt(n, 0).single(), note: None };
            }
        }
    }
    let l = text.to_lowercase();
    let Some(idx) = l.find("reset") else { return Reset { at: None, note: None } };
    let rest = l[idx + 5..].replace('(', " (");
    let toks: Vec<&str> = rest.split(|c: char| c.is_whitespace() || c == ',').filter(|t| !t.is_empty()).collect();
    let (mut wd, mut md, mut time, mut rel_mins, mut tomorrow) = (None::<Weekday>, None::<(u32, u32)>, None::<NaiveTime>, None::<i64>, false);
    let mut i = 0;
    while i < toks.len() && i < 10 && time.is_none() {
        let raw = toks[i];
        if raw.starts_with('(') {
            break;
        }
        let t = raw.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != ':' && c != '.').trim_end_matches('.');
        let next = toks.get(i + 1).map(|n| n.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '.'));
        if t.is_empty() || ["s", "at", "on", "will", "your", "limit", "the", "by", "around"].contains(&t) {
            i += 1;
            continue;
        }
        if t == "in" {
            // "resets in 2h 30m" / "in 45 minutes"
            let mut mins = 0i64;
            let mut j = i + 1;
            while j < toks.len() && j < i + 5 {
                let s = toks[j].trim_matches(|c: char| !c.is_ascii_alphanumeric());
                let num: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
                let unit_inline: String = s.chars().skip_while(|c| c.is_ascii_digit()).collect();
                let Ok(n) = num.parse::<i64>() else { break };
                let (unit, step) = if unit_inline.is_empty() {
                    (toks.get(j + 1).map(|u| u.trim_matches(|c: char| !c.is_ascii_alphanumeric()).to_string()).unwrap_or_default(), 2)
                } else {
                    (unit_inline, 1)
                };
                if unit.starts_with('h') {
                    mins += n * 60;
                } else if unit.starts_with('m') {
                    mins += n;
                } else {
                    break;
                }
                j += step;
            }
            if mins > 0 {
                rel_mins = Some(mins);
            }
            break;
        }
        if t == "today" {
            i += 1;
            continue;
        }
        if t == "tomorrow" {
            tomorrow = true;
            i += 1;
            continue;
        }
        if let Some(d) = weekday_of(t) {
            wd = Some(d);
            i += 1;
            continue;
        }
        if let Some(m) = month_of(t) {
            if let Some(day) = next.and_then(|n| n.trim_end_matches(|c: char| c.is_ascii_alphabetic()).parse::<u32>().ok()).filter(|d| (1..=31).contains(d)) {
                md = Some((m, day));
                i += 2;
                continue;
            }
        }
        if let Some((clock, used)) = parse_clock(t, next) {
            time = Some(clock);
            i += if used { 2 } else { 1 };
            continue;
        }
        i += 1;
    }
    if let Some(m) = rel_mins {
        return Reset { at: Some(base + Duration::minutes(m)), note: None };
    }
    let Some(time) = time else { return Reset { at: None, note: None } };
    let mut tz = tz_in(text);
    let mut note = None;
    if let Some(z) = tz.as_deref() {
        if off(z, base.timestamp()).is_none() {
            note = Some(format!("Couldn't read the time zone {z}; assumed this Mac's time"));
            tz = None;
        }
    }
    let base_day = base.date_naive();
    let earliest = base - Duration::minutes(2);
    let at = (-1..=8).filter_map(|k| base_day.checked_add_signed(Duration::days(k))).find_map(|d| {
        if wd.map(|w| d.weekday() != w).unwrap_or(false) {
            return None;
        }
        if md.map(|(m, day)| d.month() != m || d.day() != day).unwrap_or(false) {
            return None;
        }
        let at = instant_in(d, time, tz.as_deref(), off)?;
        let after_tomorrow_start = !tomorrow || d > base_day;
        (at > earliest && after_tomorrow_start).then_some(at)
    });
    // a month-day beyond the 9-day window (rare): take it at face value this year / next
    let at = at.or_else(|| {
        let (m, day) = md?;
        let y = base.year();
        let d = NaiveDate::from_ymd_opt(y, m, day).filter(|d| *d >= base_day).or_else(|| NaiveDate::from_ymd_opt(y + 1, m, day))?;
        instant_in(d, time, tz.as_deref(), off)
    });
    Reset { at, note }
}

/// The IANA name of this Mac's zone (from the /etc/localtime link).
fn local_zone_name() -> Option<String> {
    let p = std::fs::read_link("/etc/localtime").ok()?;
    let s = p.to_string_lossy().to_string();
    s.split("zoneinfo/").nth(1).map(String::from)
}

/// "+0530" → 19800
fn parse_z(s: &str) -> Option<i32> {
    let s = s.trim();
    if s.len() != 5 {
        return None;
    }
    let sign = match &s[..1] {
        "+" => 1,
        "-" => -1,
        _ => return None,
    };
    let h: i32 = s[1..3].parse().ok()?;
    let m: i32 = s[3..5].parse().ok()?;
    Some(sign * (h * 3600 + m * 60))
}

/// The real offset lookup: UTC/GMT, this Mac's own zone, or (macOS) the system tz database via
/// `/bin/date` with TZ set — no extra crates. Unknown names → None (the caller assumes local time).
pub fn system_offset(tz: &str, epoch: i64) -> Option<i32> {
    let u = tz.to_ascii_uppercase();
    if u == "UTC" || u == "GMT" {
        return Some(0);
    }
    if !valid_tz(tz) {
        return None;
    }
    if local_zone_name().as_deref() == Some(tz) {
        return Local.timestamp_opt(epoch, 0).single().map(|d| d.offset().local_minus_utc());
    }
    #[cfg(target_os = "macos")]
    {
        // `date` silently falls back to UTC for an unknown TZ, so the zone file must exist
        if !Path::new("/usr/share/zoneinfo").join(tz).is_file() {
            return None;
        }
        let out = std::process::Command::new("/bin/date").env_clear().env("TZ", tz).arg("-r").arg(epoch.to_string()).arg("+%z").output().ok()?;
        out.status.success().then(|| parse_z(&String::from_utf8_lossy(&out.stdout))).flatten()
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

pub fn parse_reset(text: &str, base: DateTime<Local>) -> Reset {
    parse_reset_with(text, base, &system_offset)
}

/// "3:00 PM" today, "tomorrow 9:00 AM", "Mon 9:00 AM" this week, else "Nov 20, 9:00 AM".
pub fn time_label(t: DateTime<Local>, now: DateTime<Local>) -> String {
    let clock = t.format("%-I:%M %p").to_string();
    let days = (t.date_naive() - now.date_naive()).num_days();
    match days {
        0 => clock,
        1 => format!("tomorrow {clock}"),
        2..=6 => format!("{} {clock}", t.format("%a")),
        _ => format!("{}, {clock}", t.format("%b %-d")),
    }
}

// ── state ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Pending {
    pub session_id: String,
    pub project: String,
    pub cwd: String,
    /// when Claude hit the limit (RFC 3339)
    pub limited_at: String,
    /// when the limit lifts (None = not given: retry every BACKOFF_MINS)
    pub resets_at: Option<String>,
    /// when Flo acts next (reset + grace, or the back-off)
    pub next_check_at: String,
    /// the limit message, as Claude Code wrote it
    pub reason: String,
    /// waiting | resuming | resumed | failed | cancelled
    pub status: String,
    /// per-session override of Settings → "Auto-continue when limits reset" (None = follow it)
    pub enabled: Option<bool>,
    /// resume attempts on `cycle_day`
    pub cycles: u32,
    pub cycle_day: String,
    /// why it's failed / cancelled, or what happened last
    pub detail: Option<String>,
    pub tz_note: Option<String>,
    /// identifies the limit message (transcript timestamp) so a cancelled one isn't re-added
    pub source_key: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    #[serde(flatten)]
    pub p: Pending,
    /// auto-continue is on for this session (its override, else the global setting)
    pub auto: bool,
}

fn parse_time(s: &str) -> Option<DateTime<Local>> {
    DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Local))
}

pub fn cycles_today(p: &Pending, now: DateTime<Local>) -> u32 {
    if p.cycle_day == now.date_naive().to_string() {
        p.cycles
    } else {
        0
    }
}

/// A new waiting entry for a limit hit at `limited_at` (reset parsed from the message).
pub fn new_pending(session_id: &str, project: &str, cwd: &str, reason: &str, limited_at: DateTime<Local>, reset: &Reset, source_key: Option<String>) -> Pending {
    let next = match reset.at {
        Some(r) => r + Duration::seconds(GRACE_SECS),
        None => limited_at + Duration::minutes(BACKOFF_MINS),
    };
    Pending {
        session_id: session_id.into(),
        project: project.into(),
        cwd: cwd.into(),
        limited_at: limited_at.to_rfc3339(),
        resets_at: reset.at.map(|r| r.to_rfc3339()),
        next_check_at: next.to_rfc3339(),
        reason: crate::text::truncate_chars(reason.trim(), 300),
        status: WAITING.into(),
        tz_note: reset.note.clone(),
        source_key,
        updated_at: Local::now().to_rfc3339(),
        ..Default::default()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Due {
    /// nothing to do yet (not due, auto-continue off, or not waiting)
    Wait,
    Resume,
    /// the reset passed more than MISSED_WINDOW_HOURS ago
    Expire,
    /// MAX_CYCLES_PER_DAY reached
    Cap,
    /// a newer session runs in the same folder
    Superseded,
}

/// What to do with a waiting entry now. `latest` = it's still the newest session for its folder.
pub fn decide(p: &Pending, global: bool, now: DateTime<Local>, latest: bool) -> Due {
    if p.status != WAITING {
        return Due::Wait;
    }
    let Some(next) = parse_time(&p.next_check_at) else { return Due::Expire };
    if now < next {
        return Due::Wait;
    }
    if now - next > Duration::hours(MISSED_WINDOW_HOURS) {
        return Due::Expire;
    }
    if !p.enabled.unwrap_or(global) {
        return Due::Wait;
    }
    if !latest {
        return Due::Superseded;
    }
    if cycles_today(p, now) >= MAX_CYCLES_PER_DAY {
        return Due::Cap;
    }
    Due::Resume
}

/// The user typed in the session (UserPromptSubmit): a waiting auto-continue is cancelled.
/// While Flo's own resume runs its prompt also arrives here, so `resuming` is left alone.
pub fn on_user_prompt(p: &mut Pending) -> bool {
    if p.status != WAITING {
        return false;
    }
    p.status = CANCELLED.into();
    p.detail = Some("You continued the session yourself.".into());
    p.updated_at = Local::now().to_rfc3339();
    true
}

/// Is `session_id` still the newest session in its folder?
pub fn is_latest(session_id: &str, cwd: &str, sessions: &[ClaudeSession]) -> bool {
    let mine = sessions.iter().find(|s| s.session_id == session_id).map(|s| s.updated_at.clone());
    !sessions.iter().any(|s| s.session_id != session_id && s.cwd == cwd && mine.as_ref().map(|m| s.updated_at > *m).unwrap_or(true))
}

// ── the resume command ─────────────────────────────────────────────────────

/// Claude Code session ids are UUIDs; anything else is refused (it's passed as an argument).
pub fn valid_session_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && !id.starts_with('-') && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Arguments for the headless resume. Never any permission-bypass flag.
pub fn resume_args(session_id: &str, prompt: &str) -> Result<Vec<String>> {
    if !valid_session_id(session_id) {
        bail!("That isn't a Claude Code session id.");
    }
    let p = crate::code::clean_prompt(prompt);
    let p = if p.is_empty() { DEFAULT_PROMPT.to_string() } else { p };
    Ok(vec![
        "--resume".into(),
        session_id.into(),
        "--print".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        p,
    ])
}

/// A limit message in one line of the run's stream-json output (a failed `result`, or an assistant
/// message that is the limit notice).
pub fn limit_in_stream_line(line: &str) -> Option<String> {
    let Ok(v) = serde_json::from_str::<Value>(line) else {
        return is_limit_text(line).then(|| line.trim().to_string());
    };
    let text = match v["type"].as_str().unwrap_or("") {
        "result" if v["is_error"].as_bool() == Some(true) || v["subtype"].as_str().map(|s| s.starts_with("error")).unwrap_or(false) => {
            v["result"].as_str().or(v["error"].as_str()).unwrap_or("").to_string()
        }
        "assistant" => entry_text(&v),
        _ => return None,
    };
    let t = text.trim();
    (!t.is_empty() && t.chars().count() <= 300 && is_limit_text(t)).then(|| t.to_string())
}

// ── phone payloads ─────────────────────────────────────────────────────────

fn payload(kind: &'static str, title: &str, body: &str, data: Value) -> crate::push::PushPayload {
    let flat = |s: &str, n: usize| crate::text::truncate_chars(&s.split_whitespace().collect::<Vec<_>>().join(" "), n);
    crate::push::PushPayload { kind, title: flat(title, 100), body: flat(body, 220), data: data.as_object().cloned() }
}

/// "Claude hit its limit in api" · "Will continue at 3:00 PM." (or how to turn it on).
pub fn limit_payload(p: &Pending, auto: bool, now: DateTime<Local>) -> crate::push::PushPayload {
    let project = if p.project.trim().is_empty() { "Claude Code" } else { p.project.trim() };
    let when = p.resets_at.as_deref().and_then(parse_time).map(|t| time_label(t, now));
    let body = match (auto, &when) {
        (true, Some(w)) => format!("Will continue at {w}."),
        (true, None) => format!("Will try again in {BACKOFF_MINS} min."),
        (false, Some(w)) => format!("Resets at {w}. Auto-continue is off: tap to turn it on in Flo."),
        (false, None) => "Auto-continue is off: tap to turn it on in Flo.".to_string(),
    };
    payload(
        "claude_limit",
        &format!("Claude hit its limit in {project}"),
        &body,
        json!({ "project": project, "sessionId": p.session_id, "resetsAt": p.resets_at, "autoContinue": auto }),
    )
}

pub fn resumed_payload(p: &Pending) -> crate::push::PushPayload {
    let project = if p.project.trim().is_empty() { "Claude Code" } else { p.project.trim() };
    payload("claude_resumed", &format!("Resumed {project}"), "Claude is continuing where it left off.", json!({ "project": project, "sessionId": p.session_id }))
}

// ── store ──────────────────────────────────────────────────────────────────

static STORE: Mutex<Option<HashMap<String, Pending>>> = Mutex::new(None);
/// running resumes: session id → stop signal
static RUNS: Mutex<Option<HashMap<String, tokio::sync::oneshot::Sender<()>>>> = Mutex::new(None);

fn store_path(st: &Shared) -> PathBuf {
    st.data_dir.join("autocontinue.json")
}

fn log_path(st: &Shared, session_id: &str) -> PathBuf {
    st.data_dir.join("autocontinue").join(format!("{session_id}.log"))
}

fn load(path: &Path) -> HashMap<String, Pending> {
    let mut m: HashMap<String, Pending> = std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    // a run can't survive a restart; old finished entries go
    let day_ago = (Local::now() - Duration::hours(24)).to_rfc3339();
    m.retain(|_, p| p.status == WAITING || p.updated_at > day_ago);
    for p in m.values_mut().filter(|p| p.status == RESUMING) {
        p.status = FAILED.into();
        p.detail = Some("Flo quit while the session was resuming.".into());
    }
    m
}

/// Run `f` on the store (loaded on first use) and save it when `f` says it changed something.
fn with_store<T>(st: &Shared, f: impl FnOnce(&mut HashMap<String, Pending>) -> (T, bool)) -> T {
    let mut g = STORE.lock();
    let m = g.get_or_insert_with(|| load(&store_path(st)));
    let (out, changed) = f(m);
    if changed {
        let tmp = store_path(st).with_extension("json.tmp");
        let saved = serde_json::to_string_pretty(&*m).map_err(anyhow::Error::from).and_then(|s| {
            std::fs::write(&tmp, s)?;
            std::fs::rename(&tmp, store_path(st))?;
            Ok(())
        });
        if let Err(e) = saved {
            log::warn!("autocontinue: couldn't save state: {e}");
        }
    }
    out
}

fn get(st: &Shared, session_id: &str) -> Option<Pending> {
    with_store(st, |m| (m.get(session_id).cloned(), false))
}

fn put(st: &Shared, p: Pending) {
    with_store(st, |m| {
        m.insert(p.session_id.clone(), p);
        ((), true)
    });
}

pub fn views(st: &Shared) -> Vec<View> {
    let global = st.settings().claude_auto_continue;
    let mut v: Vec<View> = with_store(st, |m| (m.values().cloned().collect::<Vec<_>>(), false))
        .into_iter()
        .map(|p| View { auto: p.enabled.unwrap_or(global), p })
        .collect();
    v.sort_by(|a, b| b.p.limited_at.cmp(&a.p.limited_at));
    v
}

fn emit(st: &Shared) {
    st.emit(EVENT, views(st));
}

fn log_line(st: &Shared, session_id: &str, line: &str) {
    use std::io::Write as _;
    let path = log_path(st, session_id);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{line}");
    }
    st.emit(LOG_EVENT, json!({ "sessionId": session_id, "line": line }));
}

/// A one-off notch card (the Claude card), not stored in the activity list.
fn notch_card(st: &Shared, p: &Pending, kind: &str, message: &str) {
    let ev = ClaudeEvent {
        id: crate::db::new_id(),
        kind: kind.into(),
        session_id: p.session_id.clone(),
        project: p.project.clone(),
        cwd: p.cwd.clone(),
        message: message.into(),
        at: Local::now().to_rfc3339(),
        seen: false,
        app_bundle: None,
        terminal: None,
        transcript_path: None,
    };
    st.emit(ev::CLAUDE, ev);
}

// ── recording a limit ──────────────────────────────────────────────────────

/// Remember that `session_id` hit a limit. `from_run` = seen in Flo's own resumed run.
fn record(st: &Shared, session_id: &str, project: &str, cwd: &str, found: &Found, from_run: bool) {
    if !valid_session_id(session_id) {
        return;
    }
    let now = Local::now();
    let limited_at = found.at.unwrap_or(now);
    if now - limited_at > Duration::hours(MISSED_WINDOW_HOURS) {
        return; // an old, abandoned session
    }
    let key = found.at.map(|t| t.to_rfc3339());
    let existing = get(st, session_id);
    if let Some(e) = &existing {
        if e.status == RESUMING && !from_run {
            return; // the run reports its own outcome
        }
        if e.status == WAITING {
            return; // already waiting on this (or a newer) limit
        }
        if key.is_some() && e.source_key == key {
            return; // the same message we already handled (cancelled / failed / resumed)
        }
    }
    let reset = parse_reset(&found.text, limited_at);
    let mut p = new_pending(session_id, project, cwd, &found.text, limited_at, &reset, key);
    if let Some(e) = existing {
        p.enabled = e.enabled;
        p.cycles = cycles_today(&e, now);
        p.cycle_day = now.date_naive().to_string();
    }
    let auto = p.enabled.unwrap_or(st.settings().claude_auto_continue);
    if p.cycles >= MAX_CYCLES_PER_DAY {
        p.status = FAILED.into();
        p.detail = Some(format!("Hit the limit {MAX_CYCLES_PER_DAY} times today, so Flo stopped. Continue it yourself."));
    }
    log::info!("autocontinue: {} hit a limit; resets {:?} (auto {})", p.project, p.resets_at, auto);
    let failed = p.status == FAILED;
    put(st, p.clone());
    emit(st);
    if failed {
        cap_reached(st, &p);
        return;
    }
    let when = p.resets_at.as_deref().and_then(parse_time).map(|t| time_label(t, now));
    let msg = match (auto, when) {
        (true, Some(w)) => format!("Will continue at {w}."),
        (true, None) => format!("Will try again in {BACKOFF_MINS} min."),
        (false, Some(w)) => format!("Resets at {w}. Turn on auto-continue to pick it up then."),
        (false, None) => "Turn on auto-continue to pick it up when it resets.".into(),
    };
    notch_card(st, &p, "limit", &msg);
    crate::push::notify(st, limit_payload(&p, auto, now)); // phone, only while Away
}

fn cap_reached(st: &Shared, p: &Pending) {
    let project = if p.project.is_empty() { "Claude Code" } else { &p.project };
    notch_card(st, p, "notification", "Hit its limit again 3 times today. Continue it yourself.");
    crate::push::notify(st, payload("claude_needs_you", &format!("Claude stopped in {project}"), "It hit its limit 3 times today, so Flo stopped auto-continuing.", json!({ "project": project, "sessionId": p.session_id })));
}

/// Last bytes of a transcript the hook named, only if it's a .jsonl under the home dir.
fn transcript_tail(path: &str, bytes: u64) -> Option<String> {
    use std::io::{Read as _, Seek, SeekFrom};
    let home = dirs::home_dir()?;
    let canon = PathBuf::from(path).canonicalize().ok()?;
    if !canon.starts_with(&home) || canon.extension().and_then(|e| e.to_str()) != Some("jsonl") {
        return None;
    }
    let mut f = std::fs::File::open(&canon).ok()?;
    let len = f.metadata().ok()?.len();
    f.seek(SeekFrom::Start(len.saturating_sub(bytes))).ok()?;
    let mut buf = Vec::new();
    f.take(bytes).read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).to_string())
}

/// Every Claude Code hook event passes through here (claude.rs listener).
pub fn observe(st: &Shared, ev: &ClaudeEvent, transcript: Option<&str>) {
    if ev.session_id.is_empty() || ev.session_id.contains(':') {
        return; // other agents (codex:…, cursor:…) don't have Claude's limits
    }
    match ev.kind.as_str() {
        "prompt" => {
            let changed = with_store(st, |m| {
                let c = m.get_mut(&ev.session_id).map(on_user_prompt).unwrap_or(false);
                (c, c)
            });
            if changed {
                log::info!("autocontinue: {} — you typed in it; auto-continue cancelled", ev.project);
                emit(st);
            }
        }
        "stop" | "notification" => {
            let found = transcript.and_then(limit_from_transcript).or_else(|| (ev.kind == "notification" && is_limit_text(&ev.message)).then(|| Found { text: ev.message.clone(), at: None }));
            if let Some(f) = found {
                record(st, &ev.session_id, &ev.project, &ev.cwd, &f, false);
            }
        }
        _ => {}
    }
}

/// Sessions that hit a limit without a hook telling us (some versions end an errored turn without
/// a Stop): look at the end of recently-changed transcripts.
fn scan(st: &Shared, seen: &mut HashMap<String, std::time::SystemTime>) {
    let Ok(list) = st.db.list_claude_sessions() else { return };
    for s in list.into_iter().filter(|s| s.source == "claude") {
        let Some(path) = s.transcript_path.as_deref() else { continue };
        let Some(modified) = std::fs::metadata(path).ok().and_then(|m| m.modified().ok()) else { continue };
        if seen.get(&s.session_id) == Some(&modified) {
            continue;
        }
        seen.insert(s.session_id.clone(), modified);
        if let Some(f) = transcript_tail(path, 64 * 1024).as_deref().and_then(limit_from_transcript) {
            record(st, &s.session_id, &s.project, &s.cwd, &f, false);
        }
    }
}

// ── resuming ───────────────────────────────────────────────────────────────

fn set_status(st: &Shared, session_id: &str, status: &str, detail: Option<String>) -> Option<Pending> {
    let p = with_store(st, |m| match m.get_mut(session_id) {
        Some(p) => {
            p.status = status.into();
            p.detail = detail;
            p.updated_at = Local::now().to_rfc3339();
            (Some(p.clone()), true)
        }
        None => (None, false),
    });
    emit(st);
    p
}

/// Start `claude --resume` for a session (due, or "Continue now").
fn start_resume(st: &Shared, session_id: &str) -> Result<()> {
    let p = get(st, session_id).ok_or_else(|| anyhow!("Flo isn't tracking that session."))?;
    if p.status == RESUMING {
        bail!("It's already resuming.");
    }
    let bin = crate::code::find_bin("claude").ok_or_else(|| anyhow!("Claude Code isn't installed (no `claude` on PATH)."))?;
    let dir = PathBuf::from(&p.cwd);
    if p.cwd.is_empty() || !dir.is_dir() {
        bail!("The session's folder is gone: {}", p.cwd);
    }
    let prompt = st.settings().claude_continue_prompt.clone();
    let args = resume_args(session_id, &prompt)?;
    let now = Local::now();
    let p = with_store(st, |m| match m.get_mut(session_id) {
        Some(e) => {
            e.cycles = cycles_today(e, now) + 1;
            e.cycle_day = now.date_naive().to_string();
            e.status = RESUMING.into();
            e.detail = None;
            e.updated_at = now.to_rfc3339();
            (Some(e.clone()), true)
        }
        None => (None, false),
    })
    .ok_or_else(|| anyhow!("Flo isn't tracking that session."))?;
    let mut cmd = tokio::process::Command::new(&bin);
    cmd.args(&args)
        .current_dir(&dir)
        .env("PATH", crate::code::child_path())
        // a Flo started from inside a Claude Code session must not look like a nested one
        .env_remove("CLAUDECODE")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            set_status(st, session_id, FAILED, Some(format!("Couldn't start Claude Code: {e}")));
            bail!("Couldn't start Claude Code: {e}");
        }
    };
    let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
    RUNS.lock().get_or_insert_with(Default::default).insert(session_id.to_string(), tx);
    log_line(st, session_id, &format!("── {} · resuming: claude --resume {session_id} --print \"{}\"", now.format("%b %-d %-I:%M %p"), args.last().map(String::as_str).unwrap_or("")));
    emit(st);
    notch_card(st, &p, "resumed", "Continuing where it left off.");
    crate::push::notify(st, resumed_payload(&p)); // phone, only while Away
    if st.settings().system_notifications {
        crate::reminders::notify(&format!("Resumed {}", p.project), "Claude is continuing where it left off.");
    }
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let st = st.clone();
    let sid = session_id.to_string();
    tauri::async_runtime::spawn(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let mut hit: Option<String> = None;
        let (mut out_done, mut err_done, mut stopped) = (stdout.is_none(), stderr.is_none(), false);
        let mut out = stdout.map(|s| BufReader::new(s).lines());
        let mut err = stderr.map(|s| BufReader::new(s).lines());
        while !(out_done && err_done) {
            tokio::select! {
                l = async { out.as_mut().unwrap().next_line().await }, if !out_done => match l {
                    Ok(Some(l)) => {
                        if let Some(t) = limit_in_stream_line(&l) { hit = Some(t); }
                        if let Some(s) = crate::code::claude_stream_line(&l) { log_line(&st, &sid, &s); }
                    }
                    _ => out_done = true,
                },
                l = async { err.as_mut().unwrap().next_line().await }, if !err_done => match l {
                    Ok(Some(l)) => if !l.trim().is_empty() {
                        if is_limit_text(&l) { hit = Some(l.trim().to_string()); }
                        log_line(&st, &sid, &l);
                    },
                    _ => err_done = true,
                },
                _ = &mut rx, if !stopped => {
                    stopped = true;
                    let _ = child.start_kill();
                }
            }
        }
        let code = child.wait().await.ok().and_then(|s| s.code());
        RUNS.lock().as_mut().map(|m| m.remove(&sid));
        if stopped {
            log_line(&st, &sid, "Stopped.");
            set_status(&st, &sid, CANCELLED, Some("Stopped from Flo.".into()));
        } else if let Some(text) = hit {
            log_line(&st, &sid, "Hit the limit again; waiting for the next reset.");
            let p = get(&st, &sid).unwrap_or_default();
            // let record() treat it as a fresh limit (cycles carry over)
            set_status(&st, &sid, RESUMED, None);
            record(&st, &sid, &p.project, &p.cwd, &Found { text, at: Some(Local::now()) }, true);
        } else if code == Some(0) {
            log_line(&st, &sid, "Finished.");
            set_status(&st, &sid, RESUMED, Some("Continued after the limit reset.".into()));
        } else {
            let msg = format!("Claude Code exited with code {}", code.map(|c| c.to_string()).unwrap_or_else(|| "?".into()));
            log_line(&st, &sid, &msg);
            set_status(&st, &sid, FAILED, Some(msg));
        }
    });
    Ok(())
}

/// One pass: act on every due entry.
fn tick(st: &Shared) {
    let now = Local::now();
    let global = st.settings().claude_auto_continue;
    let sessions = st.db.list_claude_sessions().unwrap_or_default();
    let waiting: Vec<Pending> = with_store(st, |m| (m.values().filter(|p| p.status == WAITING).cloned().collect(), false));
    for p in waiting {
        let latest = is_latest(&p.session_id, &p.cwd, &sessions);
        match decide(&p, global, now, latest) {
            Due::Wait => {}
            Due::Expire => {
                set_status(st, &p.session_id, FAILED, Some(format!("The reset passed more than {MISSED_WINDOW_HOURS} h ago, so Flo didn't resume it.")));
            }
            Due::Superseded => {
                set_status(st, &p.session_id, CANCELLED, Some("A newer session started in this folder.".into()));
            }
            Due::Cap => {
                if let Some(p) = set_status(st, &p.session_id, FAILED, Some(format!("Hit the limit {MAX_CYCLES_PER_DAY} times today, so Flo stopped. Continue it yourself."))) {
                    cap_reached(st, &p);
                }
            }
            Due::Resume => {
                if let Err(e) = start_resume(st, &p.session_id) {
                    log::warn!("autocontinue: {}: {e}", p.project);
                    set_status(st, &p.session_id, FAILED, Some(e.to_string()));
                }
            }
        }
    }
}

pub fn spawn(st: Shared) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(8)).await;
        emit(&st);
        let mut seen = HashMap::new();
        let mut last = Local::now();
        let mut n: u64 = 0;
        loop {
            // wall-clock based, so a reset that passed while the Mac slept is caught on wake
            let now = Local::now();
            if now - last > Duration::seconds(120) {
                log::info!("autocontinue: woke after {} min; checking missed resets", (now - last).num_minutes());
            }
            last = now;
            if n % 2 == 0 {
                scan(&st, &mut seen);
            }
            tick(&st);
            n += 1;
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        }
    });
}

// ── commands ───────────────────────────────────────────────────────────────

type R<T> = std::result::Result<T, String>;

fn checked(session_id: &str) -> R<()> {
    valid_session_id(session_id).then_some(()).ok_or_else(|| "Unknown session.".to_string())
}

#[tauri::command]
pub fn list_auto_continue(st: State<Shared>) -> Vec<View> {
    views(st.inner())
}

/// Per-session switch on the card (null = follow Settings).
#[tauri::command]
pub fn set_auto_continue(st: State<Shared>, session_id: String, enabled: Option<bool>) -> R<Vec<View>> {
    checked(&session_id)?;
    let st = st.inner();
    let found = with_store(st, |m| match m.get_mut(&session_id) {
        Some(p) => {
            p.enabled = enabled;
            p.updated_at = Local::now().to_rfc3339();
            (true, true)
        }
        None => (false, false),
    });
    if !found {
        return Err("Flo isn't tracking that session.".into());
    }
    emit(st);
    Ok(views(st))
}

/// "Continue now": resume right away, whatever the reset time says.
#[tauri::command]
pub fn auto_continue_now(st: State<Shared>, session_id: String) -> R<()> {
    checked(&session_id)?;
    start_resume(st.inner(), &session_id).map_err(|e| e.to_string())
}

/// "Cancel": stop waiting (or stop the running resume).
#[tauri::command]
pub fn cancel_auto_continue(st: State<Shared>, session_id: String) -> R<()> {
    checked(&session_id)?;
    if let Some(tx) = RUNS.lock().as_mut().and_then(|m| m.remove(&session_id)) {
        let _ = tx.send(());
        return Ok(());
    }
    set_status(st.inner(), &session_id, CANCELLED, Some("Cancelled.".into()));
    Ok(())
}

/// Remove a finished entry from the list.
#[tauri::command]
pub fn dismiss_auto_continue(st: State<Shared>, session_id: String) -> R<()> {
    checked(&session_id)?;
    let st = st.inner();
    with_store(st, |m| {
        let gone = m.get(&session_id).map(|p| p.status != RESUMING).unwrap_or(false);
        if gone {
            m.remove(&session_id);
        }
        ((), gone)
    });
    emit(st);
    Ok(())
}

/// The resumed run's log (last 400 lines).
#[tauri::command]
pub fn auto_continue_log(st: State<Shared>, session_id: String) -> R<Vec<String>> {
    checked(&session_id)?;
    let text = std::fs::read_to_string(log_path(st.inner(), &session_id)).unwrap_or_default();
    let lines: Vec<String> = text.lines().map(String::from).collect();
    Ok(lines[lines.len().saturating_sub(400)..].to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fake tz database: Asia/Kolkata +5:30, Europe/London 0 (winter) / +1 (summer: Apr–Oct),
    /// America/New_York −5, anything else unknown.
    fn off(tz: &str, epoch: i64) -> Option<i32> {
        match tz {
            "UTC" | "GMT" => Some(0),
            "Asia/Kolkata" => Some(19800),
            "Europe/London" => {
                let m = chrono::DateTime::from_timestamp(epoch, 0)?.month();
                Some(if (4..=10).contains(&m) { 3600 } else { 0 })
            }
            "America/New_York" => Some(-5 * 3600),
            _ => None,
        }
    }

    fn local(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> DateTime<Local> {
        Local.with_ymd_and_hms(y, mo, d, h, mi, 0).unwrap()
    }

    /// A UTC wall time as a local instant (for zone-aware expectations).
    fn utc(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> DateTime<Local> {
        chrono::Utc.with_ymd_and_hms(y, mo, d, h, mi, 0).unwrap().with_timezone(&Local)
    }

    fn reset(text: &str, base: DateTime<Local>) -> Option<DateTime<Local>> {
        parse_reset_with(text, base, &off).at
    }

    // Sunday 2026-11-08, 10:00 local
    fn base() -> DateTime<Local> {
        local(2026, 11, 8, 10, 0)
    }

    #[test]
    fn detects_limit_messages_of_every_shape() {
        for t in [
            "Claude usage limit reached. Your limit will reset at 3pm (Asia/Kolkata).",
            "5-hour limit reached ∙ resets 3pm",
            "Claude AI usage limit reached|1731000000",
            "You've hit your limit · resets 11:30pm",
            "You've hit your session limit · resets 9am (Europe/London)",
            "Weekly limit reached ∙ resets Mon 9am",
            "API Error: 429 {\"type\":\"error\",\"error\":{\"type\":\"rate_limit_error\",\"message\":\"Number of request tokens has exceeded your per-minute rate limit\"}}",
            "rate_limit_error",
            "CLAUDE USAGE LIMIT REACHED",
        ] {
            assert!(is_limit_text(t), "{t}");
        }
        for t in [
            "Done! I fixed the rate limiter config.",
            "Context limit reached · /compact or /clear to continue",
            "Prompt is too long",
            "Claude Opus limit reached, now using Sonnet 4",
            "Refactored the API.",
        ] {
            assert!(!is_limit_text(t), "{t}");
        }
    }

    #[test]
    fn parses_reset_today_and_rolls_over() {
        assert_eq!(reset("5-hour limit reached ∙ resets 3pm", base()), Some(local(2026, 11, 8, 15, 0)));
        assert_eq!(reset("You've hit your limit · resets 11:30pm", base()), Some(local(2026, 11, 8, 23, 30)));
        assert_eq!(reset("limit reached, resets at 3:30 PM", base()), Some(local(2026, 11, 8, 15, 30)));
        assert_eq!(reset("limit reached · resets 15:00", base()), Some(local(2026, 11, 8, 15, 0)));
        assert_eq!(reset("limit reached · resets 9 a.m.", base()), Some(local(2026, 11, 9, 9, 0)));
        // 3pm already passed at 4pm → tomorrow
        assert_eq!(reset("5-hour limit reached ∙ resets 3pm", local(2026, 11, 8, 16, 0)), Some(local(2026, 11, 9, 15, 0)));
        // 12am = midnight tonight
        assert_eq!(reset("You've hit your limit · resets 12am", base()), Some(local(2026, 11, 9, 0, 0)));
        assert_eq!(reset("limit reached · resets tomorrow 8am", local(2026, 11, 8, 6, 0)), Some(local(2026, 11, 9, 8, 0)));
    }

    #[test]
    fn parses_weekday_and_month_day() {
        // base is a Sunday → "Mon 9am" = tomorrow
        assert_eq!(reset("Weekly limit reached ∙ resets Mon 9am", base()), Some(local(2026, 11, 9, 9, 0)));
        // "Sun 9am" on a Sunday at 10:00 → next Sunday
        assert_eq!(reset("Weekly limit reached ∙ resets Sun 9am", base()), Some(local(2026, 11, 15, 9, 0)));
        assert_eq!(reset("Weekly limit reached ∙ resets Thursday 6:00 pm", base()), Some(local(2026, 11, 12, 18, 0)));
        assert_eq!(reset("Weekly limit reached · resets Nov 10, 9am", base()), Some(local(2026, 11, 10, 9, 0)));
        assert_eq!(reset("Weekly limit reached · resets Dec 24 at 5pm", base()), Some(local(2026, 12, 24, 17, 0)));
    }

    #[test]
    fn honours_the_named_time_zone() {
        // 3pm in Kolkata = 09:30 UTC
        let r = parse_reset_with("Claude usage limit reached. Your limit will reset at 3pm (Asia/Kolkata).", utc(2026, 11, 8, 4, 0), &off);
        assert_eq!(r.at, Some(utc(2026, 11, 8, 9, 30)));
        assert_eq!(r.note, None);
        // the real message from this machine's transcripts: 9am London (winter = UTC)
        let r = parse_reset_with("You've hit your session limit · resets 9am (Europe/London)", utc(2026, 11, 8, 6, 0), &off);
        assert_eq!(r.at, Some(utc(2026, 11, 8, 9, 0)));
        // summer time: 9am BST = 08:00 UTC
        let r = parse_reset_with("You've hit your session limit · resets 9am (Europe/London)", utc(2026, 7, 8, 6, 0), &off);
        assert_eq!(r.at, Some(utc(2026, 7, 8, 8, 0)));
        // passed in that zone → next day there
        let r = parse_reset_with("limit reached · resets 9am (America/New_York)", utc(2026, 11, 8, 20, 0), &off);
        assert_eq!(r.at, Some(utc(2026, 11, 9, 14, 0)));
        // unknown zone → this Mac's time, with a note
        let r = parse_reset_with("limit reached · resets 3pm (Mars/Olympus_Mons)", base(), &off);
        assert_eq!(r.at, Some(local(2026, 11, 8, 15, 0)));
        assert!(r.note.unwrap().contains("Mars/Olympus_Mons"));
        assert_eq!(parse_reset_with("limit reached · resets 3pm (UTC)", utc(2026, 11, 8, 4, 0), &off).at, Some(utc(2026, 11, 8, 15, 0)));
    }

    #[test]
    fn parses_epoch_suffix_and_relative() {
        assert_eq!(reset("Claude AI usage limit reached|1731000000", base()), Local.timestamp_opt(1_731_000_000, 0).single());
        assert_eq!(reset("Claude AI usage limit reached|1731000000000", base()), Local.timestamp_opt(1_731_000_000, 0).single());
        assert_eq!(reset("Usage limit reached · resets in 2h 30m", base()), Some(base() + Duration::minutes(150)));
        assert_eq!(reset("Usage limit reached. Resets in 45 minutes.", base()), Some(base() + Duration::minutes(45)));
    }

    #[test]
    fn no_reset_given_means_back_off() {
        for t in ["API Error: 429 rate_limit_error", "rate_limit_error", "Usage limit reached", "limit reached · resets soon"] {
            assert_eq!(reset(t, base()), None, "{t}");
        }
        let p = new_pending("s-1", "api", "/x/api", "API Error: 429", base(), &Reset { at: None, note: None }, None);
        assert_eq!(p.resets_at, None);
        assert_eq!(parse_time(&p.next_check_at), Some(base() + Duration::minutes(BACKOFF_MINS)));
        let r = Reset { at: Some(local(2026, 11, 8, 15, 0)), note: None };
        let p = new_pending("s-1", "api", "/x/api", "limit", base(), &r, None);
        assert_eq!(parse_time(&p.next_check_at), Some(local(2026, 11, 8, 15, 1)));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn system_time_zone_lookup_works() {
        assert_eq!(system_offset("UTC", 0), Some(0));
        assert_eq!(system_offset("Asia/Kolkata", 1_762_600_000), Some(19800));
        assert_eq!(system_offset("Europe/London", 1_783_000_000), Some(3600)); // July 2026
        assert_eq!(system_offset("Mars/Base", 0), None);
        assert_eq!(system_offset("../../etc/passwd", 0), None);
        assert_eq!(parse_z("-0430"), Some(-(4 * 3600 + 1800)));
    }

    fn tline(v: Value) -> String {
        v.to_string()
    }

    #[test]
    fn finds_the_limit_at_the_end_of_a_transcript() {
        // shape of the real entry Claude Code 2.1 writes (personal content removed)
        let limit = tline(json!({"type":"assistant","isApiErrorMessage":true,"error":"rate_limit","timestamp":"2026-11-08T04:30:00.000Z",
            "message":{"model":"<synthetic>","role":"assistant","content":[{"type":"text","text":"You've hit your session limit · resets 9am (Europe/London)"}]}}));
        let prompt = tline(json!({"type":"user","message":{"role":"user","content":"keep going"}}));
        let reply = tline(json!({"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Fixed the header."}]}}));
        let summary = tline(json!({"type":"system","subtype":"stop_hook_summary"}));
        let t = [prompt.clone(), reply.clone(), limit.clone(), summary.clone()].join("\n");
        let f = limit_from_transcript(&t).unwrap();
        assert_eq!(f.text, "You've hit your session limit · resets 9am (Europe/London)");
        assert_eq!(f.at, Some(utc(2026, 11, 8, 4, 30)));
        // the user typed after it → not waiting any more
        assert_eq!(limit_from_transcript(&[limit.clone(), prompt.clone()].join("\n")), None);
        // Claude carried on → no limit
        assert_eq!(limit_from_transcript(&[limit.clone(), reply.clone()].join("\n")), None);
        // a long normal reply that merely mentions limits isn't one
        let chatty = tline(json!({"type":"assistant","message":{"content":[{"type":"text","text": format!("I added the rate limit reached handler. {}", "x".repeat(400))}]}}));
        assert_eq!(limit_from_transcript(&chatty), None);
        assert_eq!(limit_from_transcript(""), None);
    }

    fn waiting(next: DateTime<Local>) -> Pending {
        Pending {
            session_id: "s-1".into(),
            project: "api".into(),
            cwd: "/x/api".into(),
            limited_at: (next - Duration::hours(2)).to_rfc3339(),
            resets_at: Some((next - Duration::seconds(GRACE_SECS)).to_rfc3339()),
            next_check_at: next.to_rfc3339(),
            status: WAITING.into(),
            ..Default::default()
        }
    }

    #[test]
    fn due_logic() {
        let at = local(2026, 11, 8, 15, 1);
        let p = waiting(at);
        assert_eq!(decide(&p, true, at - Duration::seconds(1), true), Due::Wait, "not yet");
        assert_eq!(decide(&p, true, at, true), Due::Resume);
        assert_eq!(decide(&p, false, at, true), Due::Wait, "global toggle off");
        let mut on = p.clone();
        on.enabled = Some(true);
        assert_eq!(decide(&on, false, at, true), Due::Resume, "per-session override on");
        let mut off = p.clone();
        off.enabled = Some(false);
        assert_eq!(decide(&off, true, at, true), Due::Wait, "per-session override off");
        assert_eq!(decide(&p, true, at, false), Due::Superseded);
        // missed while asleep: still resumes within 12 h, expires after
        assert_eq!(decide(&p, true, at + Duration::hours(11), true), Due::Resume);
        assert_eq!(decide(&p, true, at + Duration::hours(13), true), Due::Expire);
        // already resumed / cancelled → nothing
        for s in [RESUMED, RESUMING, CANCELLED, FAILED] {
            let mut q = p.clone();
            q.status = s.into();
            assert_eq!(decide(&q, true, at, true), Due::Wait, "{s}");
        }
    }

    #[test]
    fn cycles_are_capped_per_day() {
        let at = local(2026, 11, 8, 15, 1);
        let mut p = waiting(at);
        p.cycle_day = at.date_naive().to_string();
        p.cycles = MAX_CYCLES_PER_DAY - 1;
        assert_eq!(decide(&p, true, at, true), Due::Resume);
        p.cycles = MAX_CYCLES_PER_DAY;
        assert_eq!(decide(&p, true, at, true), Due::Cap);
        // a new day resets the count
        p.cycle_day = "2026-11-07".into();
        assert_eq!(cycles_today(&p, at), 0);
        assert_eq!(decide(&p, true, at, true), Due::Resume);
    }

    #[test]
    fn typing_after_the_limit_cancels() {
        let mut p = waiting(local(2026, 11, 8, 15, 1));
        assert!(on_user_prompt(&mut p));
        assert_eq!(p.status, CANCELLED);
        assert_eq!(decide(&p, true, local(2026, 11, 8, 16, 0), true), Due::Wait);
        // Flo's own resume prompt (status resuming) doesn't cancel it
        let mut r = waiting(local(2026, 11, 8, 15, 1));
        r.status = RESUMING.into();
        assert!(!on_user_prompt(&mut r));
        assert_eq!(r.status, RESUMING);
    }

    fn sess(id: &str, cwd: &str, at: &str) -> ClaudeSession {
        ClaudeSession { session_id: id.into(), project: "p".into(), cwd: cwd.into(), status: "done".into(), message: String::new(), updated_at: at.into(), app_bundle: None, terminal: None, transcript_path: None, source: "claude".into() }
    }

    #[test]
    fn only_the_latest_session_in_a_folder_resumes() {
        let list = vec![sess("a", "/x/api", "2026-11-08T10:00:00+05:30"), sess("b", "/x/web", "2026-11-08T11:00:00+05:30")];
        assert!(is_latest("a", "/x/api", &list));
        let newer = vec![sess("a", "/x/api", "2026-11-08T10:00:00+05:30"), sess("c", "/x/api", "2026-11-08T10:30:00+05:30")];
        assert!(!is_latest("a", "/x/api", &newer));
        // dismissed from the tray (not listed) and nothing else there → still latest
        assert!(is_latest("a", "/x/api", &[sess("b", "/x/web", "2026-11-08T11:00:00+05:30")]));
        assert!(!is_latest("a", "/x/api", &[sess("c", "/x/api", "2026-11-08T11:00:00+05:30")]));
    }

    #[test]
    fn resume_command_is_plain_and_safe() {
        let a = resume_args("0b7c4f3e-1111-4a2b-9c3d-123456789abc", "Continue where you left off.").unwrap();
        assert_eq!(
            a,
            vec!["--resume", "0b7c4f3e-1111-4a2b-9c3d-123456789abc", "--print", "--output-format", "stream-json", "--verbose", "Continue where you left off."]
        );
        let joined = a.join(" ").to_lowercase();
        for bad in ["dangerously", "skip-permissions", "bypass", "--permission-mode", "acceptedits", "--allowedtools", "--yolo"] {
            assert!(!joined.contains(bad), "{bad}");
        }
        // empty prompt → the default; a prompt can't smuggle in a flag
        assert_eq!(resume_args("abc-123", "  ").unwrap().last().unwrap(), DEFAULT_PROMPT);
        assert_eq!(resume_args("abc-123", "--dangerously-skip-permissions").unwrap().last().unwrap(), "Task: --dangerously-skip-permissions");
        // bad ids are refused
        for id in ["", "--help", "a b", "x;rm -rf ~", "../etc", &"a".repeat(65)] {
            assert!(resume_args(id, "go").is_err(), "{id}");
        }
    }

    #[test]
    fn limit_in_resumed_run_output() {
        let r = json!({"type":"result","subtype":"success","is_error":true,"result":"Claude AI usage limit reached|1731000000"}).to_string();
        assert_eq!(limit_in_stream_line(&r).as_deref(), Some("Claude AI usage limit reached|1731000000"));
        let ok = json!({"type":"result","subtype":"success","is_error":false,"result":"Done, tests pass."}).to_string();
        assert_eq!(limit_in_stream_line(&ok), None);
        let a = json!({"type":"assistant","message":{"content":[{"type":"text","text":"You've hit your limit · resets 11:30pm"}]}}).to_string();
        assert!(limit_in_stream_line(&a).is_some());
        assert!(limit_in_stream_line("API Error: 429 Too Many Requests").is_some());
        assert!(limit_in_stream_line("Compiling flo v0.1.0").is_none());
    }

    #[test]
    fn setting_defaults_off_and_survives_old_files() {
        let s: crate::model::Settings = serde_json::from_str("{}").unwrap();
        assert!(!s.claude_auto_continue);
        assert_eq!(s.claude_continue_prompt, DEFAULT_PROMPT);
        let v = serde_json::to_value(crate::model::Settings { claude_auto_continue: true, ..Default::default() }).unwrap();
        assert_eq!(v["claudeAutoContinue"], true);
        assert_eq!(v["claudeContinuePrompt"], DEFAULT_PROMPT);
    }

    #[test]
    fn labels_and_phone_payloads() {
        let now = local(2026, 11, 8, 10, 0);
        assert_eq!(time_label(local(2026, 11, 8, 15, 0), now), "3:00 PM");
        assert_eq!(time_label(local(2026, 11, 9, 9, 0), now), "tomorrow 9:00 AM");
        assert_eq!(time_label(local(2026, 11, 12, 18, 30), now), "Thu 6:30 PM");
        assert_eq!(time_label(local(2026, 12, 24, 17, 0), now), "Dec 24, 5:00 PM");
        let mut p = waiting(local(2026, 11, 8, 15, 1));
        let on = limit_payload(&p, true, now);
        assert_eq!((on.kind, on.title.as_str(), on.body.as_str()), ("claude_limit", "Claude hit its limit in api", "Will continue at 3:00 PM."));
        assert_eq!(on.data.as_ref().unwrap()["sessionId"], "s-1");
        let off = limit_payload(&p, false, now);
        assert!(off.body.contains("Auto-continue is off") && off.body.contains("3:00 PM"));
        p.resets_at = None;
        assert_eq!(limit_payload(&p, true, now).body, "Will try again in 15 min.");
        let r = resumed_payload(&p);
        assert_eq!((r.kind, r.title.as_str()), ("claude_resumed", "Resumed api"));
        // never the limit text / transcript in the payload
        assert!(serde_json::to_string(&on).unwrap().len() < 400);
    }
}
