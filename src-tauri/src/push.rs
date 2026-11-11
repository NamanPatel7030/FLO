//! Active / Away presence + the phone-notification relay (contract: docs/mobile-api.md).
//!
//! * Active (default) = the user is at the Mac: nothing ever leaves the Mac for the phone.
//! * Away = AFK: short summaries (never transcripts or code) go to `POST /api/push` on the user's
//!   own Flo account server, which forwards them to paired Android phones.
//!
//! All traffic goes through the egress guard (account host, Purpose::Account) and shows in the
//! network log. Every send is fire-and-forget: a failure is logged and never blocks the app.
use crate::egress::Purpose;
use crate::model::{ClaudeEvent, Settings, Todo};
use crate::state::Shared;
use crate::text::truncate_chars;
use anyhow::{anyhow, bail, Result};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::time::{Duration, Instant};
use tauri::State;

/// Emitted to every window when presence changes: `{ status: "active" | "away" }`.
pub const PRESENCE_EVENT: &str = "flo://presence";

pub const ACTIVE: &str = "active";
pub const AWAY: &str = "away";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    ClaudeDone,
    ClaudeNeedsYou,
    TodoDue,
    TodosDigest,
    Reminder,
    SkillRan,
    MeetingSummary,
}

impl Kind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Kind::ClaudeDone => "claude_done",
            Kind::ClaudeNeedsYou => "claude_needs_you",
            Kind::TodoDue => "todo_due",
            Kind::TodosDigest => "todos_digest",
            Kind::Reminder => "reminder",
            Kind::SkillRan => "skill_ran",
            Kind::MeetingSummary => "meeting_summary",
        }
    }
}

/// Body of `POST /api/push`.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PushPayload {
    pub kind: &'static str,
    pub title: String,
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Map<String, Value>>,
}

const TITLE_MAX: usize = 100;
const BODY_MAX: usize = 220;

/// One line, no control characters, capped.
fn one_line(s: &str, max: usize) -> String {
    let flat: String = s.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    truncate_chars(&flat.split_whitespace().collect::<Vec<_>>().join(" "), max)
}

/// First meaningful line of a longer text (drops markdown heading/list markers and code fences).
fn first_line(s: &str) -> String {
    s.lines()
        .map(|l| l.trim().trim_start_matches(['#', '-', '*', '>', ' ']).trim())
        .find(|l| !l.is_empty() && !l.starts_with("```"))
        .unwrap_or("")
        .to_string()
}

pub fn build(kind: Kind, title: &str, body: &str, data: Option<Map<String, Value>>) -> PushPayload {
    PushPayload { kind: kind.as_str(), title: one_line(title, TITLE_MAX), body: one_line(body, BODY_MAX), data }
}

fn data(pairs: &[(&str, Value)]) -> Option<Map<String, Value>> {
    Some(pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect())
}

/// "Claude finished" / "Claude needs you" from a hook event (other kinds → None).
pub fn claude_payload(ev: &ClaudeEvent) -> Option<PushPayload> {
    let project = if ev.project.trim().is_empty() { "Claude Code" } else { ev.project.trim() };
    let msg = first_line(&ev.message);
    match ev.kind.as_str() {
        "stop" => Some(build(
            Kind::ClaudeDone,
            &format!("Claude finished in {project}"),
            if msg.is_empty() { "Ready for your next prompt." } else { &msg },
            data(&[("project", json!(project)), ("sessionId", json!(ev.session_id))]),
        )),
        "notification" => Some(build(
            Kind::ClaudeNeedsYou,
            &format!("Claude needs you in {project}"),
            if msg.is_empty() { "Claude is waiting for your input." } else { &msg },
            data(&[("project", json!(project)), ("sessionId", json!(ev.session_id))]),
        )),
        _ => None,
    }
}

/// A Claude Code permission question (Allow / Deny) — the tool summary, never the full command output.
pub fn permission_payload(project: &str, summary: &str) -> PushPayload {
    build(Kind::ClaudeNeedsYou, &format!("Claude needs you in {project}"), summary, data(&[("project", json!(project))]))
}

/// A to-do reminder firing ("Ship the deck · due 3:00 PM").
pub fn todo_due_payload(t: &Todo, when: &str) -> PushPayload {
    let body = if when.is_empty() { "Due soon".to_string() } else { format!("Due {when}") };
    build(Kind::TodoDue, &t.title, &body, data(&[("todoId", json!(t.id))]))
}

pub fn skill_payload(name: &str, reply: &str, ok: bool) -> PushPayload {
    if ok {
        let line = first_line(reply);
        build(Kind::SkillRan, &format!("{name} ran"), if line.is_empty() { "Done." } else { &line }, None)
    } else {
        build(Kind::SkillRan, &format!("{name} couldn't run"), reply, None)
    }
}

pub fn meeting_payload(title: &str, note_id: &str, action_items: usize) -> PushPayload {
    let body = match action_items {
        0 => "Summary is ready in Flo.".to_string(),
        1 => "Summary is ready · 1 new to-do".to_string(),
        n => format!("Summary is ready · {n} new to-dos"),
    };
    build(Kind::MeetingSummary, &format!("Notes ready: {title}"), &body, data(&[("noteId", json!(note_id))]))
}

/// Today's open to-dos (due today / overdue first, then the newest undated ones), top 5 titles.
/// None when there's nothing open.
pub fn digest_payload(todos: &[Todo], today: chrono::NaiveDate) -> Option<PushPayload> {
    let due_day = |t: &Todo| t.due.as_deref().and_then(|d| chrono::DateTime::parse_from_rfc3339(d).ok()).map(|d| d.with_timezone(&chrono::Local).date_naive());
    let mut open: Vec<&Todo> = todos.iter().filter(|t| t.status == "open").filter(|t| due_day(t).map(|d| d <= today).unwrap_or(true)).collect();
    if open.is_empty() {
        return None;
    }
    // dated (today / overdue) first by due time, then undated newest first
    open.sort_by(|a, b| match (&a.due, &b.due) {
        (Some(x), Some(y)) => x.cmp(y),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => b.created_at.cmp(&a.created_at),
    });
    let n = open.len();
    let titles: Vec<String> = open.iter().take(5).map(|t| one_line(&t.title, 48)).collect();
    let more = if n > 5 { format!(" · +{} more", n - 5) } else { String::new() };
    let title = if n == 1 { "1 to-do for today".to_string() } else { format!("{n} to-dos for today") };
    Some(build(Kind::TodosDigest, &title, &format!("{}{more}", titles.join(" · ")), data(&[("count", json!(n))])))
}

// ── gate ─────────────────────────────────────────────────────────────────────

pub fn is_away(s: &Settings) -> bool {
    s.presence == AWAY
}

/// Signed in to a Flo account (cached user; no Keychain read, so it never blocks the caller).
/// The token itself is read only inside the background send.
pub(crate) fn has_session(st: &Shared) -> bool {
    st.settings().account_user.is_some()
}

/// The single rule: only while Away, and only with an account session to send it with.
pub fn should_send(s: &Settings, has_session: bool) -> bool {
    is_away(s) && has_session
}

/// Same notification twice within a short window (e.g. a permission question + Claude's own
/// "needs your permission" notification) is sent once.
static RECENT: Mutex<Vec<(String, Instant)>> = Mutex::new(Vec::new());
const DEDUPE: Duration = Duration::from_secs(45);

fn first_time(p: &PushPayload) -> bool {
    let key = format!("{}|{}", p.kind, p.title);
    let mut r = RECENT.lock();
    r.retain(|(_, at)| at.elapsed() < DEDUPE);
    if r.iter().any(|(k, _)| *k == key) {
        return false;
    }
    r.push((key, Instant::now()));
    true
}

/// Relay a notification to the phone if (and only if) the user is Away and signed in.
/// Fire-and-forget: returns immediately, never errors.
pub fn notify(st: &Shared, p: PushPayload) {
    if !should_send(&st.settings(), has_session(st)) || !first_time(&p) {
        return;
    }
    let st = st.clone();
    tauri::async_runtime::spawn(async move {
        match send(&st, &p).await {
            Ok(v) => log::info!("phone relay {}: pushed {} {}", p.kind, v["pushed"], v["reason"].as_str().unwrap_or("")),
            Err(e) => log::warn!("phone relay {}: {e}", p.kind),
        }
    });
}

pub fn notify_claude(st: &Shared, ev: &ClaudeEvent) {
    if let Some(p) = claude_payload(ev) {
        notify(st, p);
    }
}

// ── account server calls ─────────────────────────────────────────────────────

pub(crate) async fn call(st: &Shared, method: &str, path: &str, body: Option<Value>) -> Result<(u16, Value)> {
    let token = crate::account::session_token().ok_or_else(|| anyhow!("Sign in to your Flo account to use your phone."))?;
    crate::account::allow_host(st);
    let url = format!("{}{path}", crate::account::base(st));
    st.egress.check(&url, Purpose::Account, true)?;
    let client = st.egress.client(Purpose::Account, true);
    let mut req = match method {
        "GET" => client.get(&url),
        "DELETE" => client.delete(&url),
        _ => client.post(&url),
    };
    if let Some(b) = &body {
        req = req.json(b);
    }
    let sent = body.as_ref().map(|b| b.to_string().len()).unwrap_or(0) as u64;
    let resp = req.bearer_auth(token).timeout(Duration::from_secs(8)).send().await.map_err(|e| {
        if e.is_connect() || e.is_timeout() {
            anyhow!("Can't reach your Flo account server.")
        } else {
            anyhow!(e)
        }
    })?;
    let code = resp.status().as_u16();
    let v: Value = resp.json().await.unwrap_or(json!({}));
    st.egress.record(&url, Purpose::Account, sent + v.to_string().len() as u64);
    Ok((code, v))
}

pub(crate) fn ok_or_err((code, v): (u16, Value)) -> Result<Value> {
    if (200..300).contains(&code) {
        return Ok(v);
    }
    match code {
        401 => bail!("Your Flo session expired. Sign in again."),
        429 => bail!("{}", v["error"].as_str().unwrap_or("Too many requests. Try again in a minute.")),
        _ => bail!("{}", v["error"].as_str().unwrap_or("The Flo account server returned an error.")),
    }
}

async fn send(st: &Shared, p: &PushPayload) -> Result<Value> {
    // re-check right before it leaves the Mac (presence could have flipped while queued)
    if !is_away(&st.settings()) {
        bail!("active again; not sent");
    }
    ok_or_err(call(st, "POST", "/api/push", Some(serde_json::to_value(p)?)).await?)
}

async fn sync_presence(st: &Shared, status: &str) -> Result<()> {
    ok_or_err(call(st, "POST", "/api/presence", Some(json!({ "status": status }))).await?).map(|_| ())
}

// ── presence state ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceInfo {
    /// "active" | "away"
    pub status: String,
    /// an account session exists, so Away can reach the phone
    pub signed_in: bool,
    /// went away by itself (screen lock / idle) and comes back by itself
    pub auto: bool,
}

/// set by auto-away so we only auto-return from an automatic Away, never a manual one
static AUTO_AWAY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// when the user last changed presence here (don't let a server poll undo a fresh change)
static LAST_LOCAL_CHANGE: Mutex<Option<Instant>> = Mutex::new(None);

pub fn info(st: &Shared) -> PresenceInfo {
    let s = st.settings();
    PresenceInfo {
        status: if is_away(&s) { AWAY.into() } else { ACTIVE.into() },
        signed_in: has_session(st),
        auto: is_away(&s) && AUTO_AWAY.load(std::sync::atomic::Ordering::SeqCst),
    }
}

/// Change presence locally (persisted), tell every window, sync the server, and on Away send the
/// to-do digest. `sync` = false when the change came from the server.
fn apply(st: &Shared, status: &str, auto: bool, sync: bool) -> Result<PresenceInfo> {
    let status = if status == AWAY { AWAY } else { ACTIVE };
    AUTO_AWAY.store(status == AWAY && auto, std::sync::atomic::Ordering::SeqCst);
    let changed = st.settings().presence != status;
    if changed {
        let mut s = st.settings();
        s.presence = status.to_string();
        crate::settings::save(&st.data_dir, &s)?;
        *st.settings.write() = s;
    }
    let info = info(st);
    st.emit(PRESENCE_EVENT, &info);
    if sync {
        *LAST_LOCAL_CHANGE.lock() = Some(Instant::now());
    }
    if info.signed_in && (changed || sync) {
        let st2 = st.clone();
        let send_digest = changed && status == AWAY;
        tauri::async_runtime::spawn(async move {
            if sync {
                if let Err(e) = sync_presence(&st2, status).await {
                    log::warn!("presence sync: {e}");
                }
            }
            if send_digest {
                let today = chrono::Local::now().date_naive();
                if let Some(p) = st2.db.list_todos().ok().and_then(|t| digest_payload(&t, today)) {
                    notify(&st2, p);
                }
            }
        });
    }
    Ok(info)
}

/// Startup: push the local status to the server, then keep the two in step and run auto-away.
pub fn spawn(st: Shared) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(5)).await;
        if has_session(&st) {
            let status = st.settings().presence.clone();
            if let Err(e) = sync_presence(&st, if status == AWAY { AWAY } else { ACTIVE }).await {
                log::warn!("presence sync: {e}");
            }
        }
        let mut last_poll = Instant::now();
        loop {
            tokio::time::sleep(Duration::from_secs(15)).await;
            auto_away_tick(&st);
            // the phone can flip presence too: adopt the server's status every few minutes
            if last_poll.elapsed() >= Duration::from_secs(300) && has_session(&st) {
                last_poll = Instant::now();
                let fresh = LAST_LOCAL_CHANGE.lock().map(|t| t.elapsed() < Duration::from_secs(60)).unwrap_or(false);
                if !fresh {
                    if let Ok((200, v)) = call(&st, "GET", "/api/presence", None).await {
                        if let Some(remote) = v["status"].as_str().filter(|s| *s == ACTIVE || *s == AWAY) {
                            if remote != st.settings().presence {
                                let _ = apply(&st, remote, false, false);
                            }
                        }
                    }
                }
            }
        }
    });
}

/// "Go away automatically when the screen locks / after N minutes idle" (macOS, off by default).
fn auto_away_tick(st: &Shared) {
    let s = st.settings();
    if !s.auto_away {
        return;
    }
    let idle = idle::seconds();
    let locked = idle::screen_locked();
    let limit = u64::from(s.auto_away_minutes.clamp(1, 240)) * 60;
    let away_now = locked || idle.map(|i| i >= limit as f64).unwrap_or(false);
    if !is_away(&s) && away_now {
        log::info!("presence: auto-away ({})", if locked { "screen locked" } else { "idle" });
        let _ = apply(st, AWAY, true, true);
    } else if is_away(&s) && AUTO_AWAY.load(std::sync::atomic::Ordering::SeqCst) && !locked && idle.map(|i| i < 30.0).unwrap_or(false) {
        log::info!("presence: back at the Mac");
        let _ = apply(st, ACTIVE, false, true);
    }
}

#[cfg(target_os = "macos")]
mod idle {
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::string::CFString;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
        fn CGSessionCopyCurrentDictionary() -> CFDictionaryRef;
    }

    /// Seconds since the last keyboard / mouse input in this login session.
    pub fn seconds() -> Option<f64> {
        // kCGEventSourceStateCombinedSessionState = 0, kCGAnyInputEventType = ~0
        let s = unsafe { CGEventSourceSecondsSinceLastEventType(0, u32::MAX) };
        (s.is_finite() && s >= 0.0).then_some(s)
    }

    pub fn screen_locked() -> bool {
        let r = unsafe { CGSessionCopyCurrentDictionary() };
        if r.is_null() {
            return false;
        }
        let dict: CFDictionary<CFString, CFType> = unsafe { CFDictionary::wrap_under_create_rule(r) };
        dict.find(CFString::from_static_string("CGSSessionScreenIsLocked"))
            .and_then(|v| v.downcast::<CFBoolean>())
            .map(bool::from)
            .unwrap_or(false)
    }
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
mod idle {
    /// Windows: GetLastInputInfo. Linux: MIT-SCREEN-SAVER on X11 (None on Wayland).
    pub fn seconds() -> Option<f64> {
        crate::platform::idle_seconds()
    }
    pub fn screen_locked() -> bool {
        false
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod idle {
    pub fn seconds() -> Option<f64> {
        None
    }
    pub fn screen_locked() -> bool {
        false
    }
}

// ── commands ─────────────────────────────────────────────────────────────────

type R<T> = std::result::Result<T, String>;

#[tauri::command(async)]
pub fn get_presence(st: State<Shared>) -> PresenceInfo {
    info(st.inner())
}

#[tauri::command(async)]
pub fn set_presence(st: State<Shared>, status: String) -> R<PresenceInfo> {
    if status != ACTIVE && status != AWAY {
        return Err("status must be \"active\" or \"away\"".into());
    }
    apply(st.inner(), &status, false, true).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairCode {
    pub code: String,
    pub payload: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneDevice {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub last_seen: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushResult {
    pub stored: bool,
    pub pushed: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[tauri::command]
pub async fn pair_phone_start(st: State<'_, Shared>) -> R<PairCode> {
    let v = ok_or_err(call(st.inner(), "POST", "/api/mobile/pair/start", Some(json!({}))).await.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    serde_json::from_value(v).map_err(|_| "Unexpected reply from the Flo account server.".to_string())
}

#[tauri::command]
pub async fn list_phones(st: State<'_, Shared>) -> R<Vec<PhoneDevice>> {
    let v = ok_or_err(call(st.inner(), "GET", "/api/mobile/devices", None).await.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    serde_json::from_value(v).map_err(|_| "Unexpected reply from the Flo account server.".to_string())
}

#[tauri::command]
pub async fn remove_phone(st: State<'_, Shared>, id: String) -> R<()> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Unknown device.".into());
    }
    ok_or_err(call(st.inner(), "DELETE", &format!("/api/mobile/devices/{id}"), None).await.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(())
}

/// A test notification (only while Away — exactly like the real ones).
#[tauri::command]
pub async fn send_test_push(st: State<'_, Shared>) -> R<PushResult> {
    if !is_away(&st.settings()) {
        return Err("You're Active, so nothing goes to your phone. Switch to Away to test.".into());
    }
    let p = build(Kind::Reminder, "Test from Flo", "Notifications reach this phone while you're away from your Mac.", None);
    let v = send(st.inner(), &p).await.map_err(|e| e.to_string())?;
    serde_json::from_value(v).map_err(|_| "Unexpected reply from the Flo account server.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn todo(title: &str, status: &str, due: Option<&str>, created: &str) -> Todo {
        Todo {
            id: title.into(),
            title: title.into(),
            reason: None,
            person: None,
            app: None,
            source: "voice".into(),
            status: status.into(),
            project_id: None,
            due: due.map(String::from),
            confidence: None,
            created_at: created.into(),
            completed_at: None,
            remind_at: None,
            note_id: None,
        }
    }

    fn claude(kind: &str, project: &str, message: &str) -> ClaudeEvent {
        ClaudeEvent {
            id: "e".into(),
            kind: kind.into(),
            session_id: "s1".into(),
            project: project.into(),
            cwd: "/x".into(),
            message: message.into(),
            at: "2026-11-08T10:00:00Z".into(),
            seen: false,
            app_bundle: None,
            terminal: None,
            transcript_path: None,
        }
    }

    #[test]
    fn never_sends_while_active() {
        let mut s = Settings::default();
        assert_eq!(s.presence, ACTIVE, "default is active");
        assert!(!should_send(&s, true));
        assert!(!should_send(&s, false));
        s.presence = AWAY.into();
        assert!(should_send(&s, true));
        assert!(!should_send(&s, false), "no session → nothing to send with");
        s.presence = "something-else".into();
        assert!(!should_send(&s, true), "unknown status counts as active");
    }

    #[test]
    fn claude_payloads_are_short_one_line_summaries() {
        let long = format!("# Done\n\nI refactored the API.\n```rust\nfn secret() {{}}\n```\n{}", "x".repeat(500));
        let p = claude_payload(&claude("stop", "api", &long)).unwrap();
        assert_eq!(p.kind, "claude_done");
        assert_eq!(p.title, "Claude finished in api");
        assert_eq!(p.body, "Done");
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["data"]["project"], "api");
        assert_eq!(v["kind"], "claude_done");

        let n = claude_payload(&claude("notification", "", "Claude needs your permission to use Bash")).unwrap();
        assert_eq!(n.kind, "claude_needs_you");
        assert_eq!(n.title, "Claude needs you in Claude Code");
        assert_eq!(n.body, "Claude needs your permission to use Bash");
        assert!(claude_payload(&claude("subagent_stop", "api", "")).is_none());
        let empty = claude_payload(&claude("stop", "web", "")).unwrap();
        assert_eq!(empty.body, "Ready for your next prompt.");
    }

    #[test]
    fn build_caps_and_flattens() {
        let p = build(Kind::Reminder, &"t".repeat(300), "line one\nline\ttwo\u{7}", None);
        assert_eq!(p.title.chars().count(), TITLE_MAX);
        assert!(p.title.ends_with('…'));
        assert_eq!(p.body, "line one line two");
        assert!(serde_json::to_value(&p).unwrap().get("data").is_none());
    }

    #[test]
    fn digest_lists_todays_open_todos_top_five() {
        let today = chrono::NaiveDate::from_ymd_opt(2026, 11, 8).unwrap();
        let tz = chrono::Local::now().format("%:z").to_string();
        let at = |d: &str| format!("{d}{tz}");
        let todos = vec![
            todo("Done thing", "done", None, "2026-11-08T09:00:00"),
            todo("Tomorrow", "open", Some(&at("2026-11-09T10:00:00")), "2026-11-08T09:00:00"),
            todo("Call mom", "open", Some(&at("2026-11-08T15:00:00")), "2026-11-01T09:00:00"),
            todo("Overdue report", "open", Some(&at("2026-11-07T09:00:00")), "2026-11-01T09:00:00"),
            todo("Old undated", "open", None, "2026-11-01T09:00:00"),
            todo("New undated", "open", None, "2026-11-07T09:00:00"),
            todo("U3", "open", None, "2026-10-01T09:00:00"),
            todo("U4", "open", None, "2026-09-01T09:00:00"),
            todo("Snoozed", "snoozed", None, "2026-11-07T09:00:00"),
        ];
        let p = digest_payload(&todos, today).unwrap();
        assert_eq!(p.kind, "todos_digest");
        assert_eq!(p.title, "6 to-dos for today");
        assert_eq!(p.body, "Overdue report · Call mom · New undated · Old undated · U3 · +1 more");
        assert_eq!(p.data.unwrap()["count"], json!(6));
        assert!(digest_payload(&[todo("x", "done", None, "2026-11-08T09:00:00")], today).is_none());
        let one = digest_payload(&[todo("Only", "open", None, "2026-11-08T09:00:00")], today).unwrap();
        assert_eq!(one.title, "1 to-do for today");
    }

    #[test]
    fn other_payloads() {
        let t = todo("Ship the deck", "open", None, "2026-11-08T09:00:00");
        let p = todo_due_payload(&t, "3:00 PM");
        assert_eq!((p.kind, p.title.as_str(), p.body.as_str()), ("todo_due", "Ship the deck", "Due 3:00 PM"));
        let m = meeting_payload("Design sync", "n1", 2);
        assert_eq!((m.kind, m.body.as_str()), ("meeting_summary", "Summary is ready · 2 new to-dos"));
        let k = skill_payload("Morning brief", "## Today\n- 3 meetings", true);
        assert_eq!((k.kind, k.title.as_str(), k.body.as_str()), ("skill_ran", "Morning brief ran", "Today"));
        let pr = permission_payload("api", "Run: npm test");
        assert_eq!(pr.kind, "claude_needs_you");
    }

    #[test]
    fn duplicate_within_window_is_sent_once() {
        let p = build(Kind::ClaudeNeedsYou, "Claude needs you in dedupe-test", "a", None);
        assert!(first_time(&p));
        assert!(!first_time(&p));
        let other = build(Kind::ClaudeNeedsYou, "Claude needs you in other-dedupe", "a", None);
        assert!(first_time(&other));
    }
}
