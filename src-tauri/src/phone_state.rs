//! The paired phone's view of this computer: to-dos, Claude Code approvals and settings.
//!
//! While signed in, Flo publishes a small snapshot to the user's own account server
//! (`POST /api/app/state`) whenever it changes (debounced), plus a heartbeat every few minutes. The
//! server keeps it only while a phone is paired. The phone sends actions back (complete a to-do,
//! Allow / Deny a permission prompt, change a simple setting); `phone.rs` picks them up on its
//! existing poll and applies them here.
//!
//! Never in the snapshot: API keys, tokens, the account URL, the system prompt, local server URLs.
//! Settings come from an explicit allow-list (`CATALOG`); only the entries marked editable can be
//! changed from the phone, and every change is re-validated here (the server is not trusted).
use crate::model::{ClaudeSession, Settings, Todo};
use crate::state::Shared;
use anyhow::Result;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    Toggle,
    Select(&'static [(&'static str, &'static str)]),
    Number(f64, f64),
    Text,
    List,
}

struct Entry {
    /// camelCase path into the serialized Settings ("avatar.enabled" for nested)
    key: &'static str,
    label: &'static str,
    section: &'static str,
    kind: Kind,
    editable: bool,
    hint: Option<&'static str>,
}

const fn e(key: &'static str, label: &'static str, section: &'static str, kind: Kind, editable: bool) -> Entry {
    Entry { key, label, section, kind, editable, hint: None }
}
const fn ro(key: &'static str, label: &'static str, section: &'static str, kind: Kind, hint: &'static str) -> Entry {
    Entry { key, label, section, kind, editable: false, hint: Some(hint) }
}

const THEMES: &[(&str, &str)] = &[("light", "Light"), ("dark", "Dark"), ("system", "System")];
const NOTCH_STYLES: &[(&str, &str)] = &[("ribbon", "Ribbon"), ("wave", "Wave"), ("bars", "Bars"), ("pulse", "Pulse"), ("orb", "Orb"), ("aurora", "Aurora")];
const NOTCH_SIZES: &[(&str, &str)] = &[("small", "Small"), ("big", "Big"), ("bigger", "Bigger"), ("biggest", "Biggest")];
const SOUND_PACKS: &[(&str, &str)] = &[("chime", "Chime"), ("glass", "Glass"), ("soft", "Soft"), ("pop", "Pop")];
const ON_COMPUTER: &str = "Change this on your computer.";
const PRIVACY: &str = "A privacy setting. Change it on your computer.";

/// Everything the phone may see. Not listed = never leaves the computer.
const CATALOG: &[Entry] = &[
    // Appearance
    e("theme", "Theme", "Appearance", Kind::Select(THEMES), true),
    e("notchStyle", "Notch animation", "Appearance", Kind::Select(NOTCH_STYLES), true),
    e("notchSize", "Panel size", "Appearance", Kind::Select(NOTCH_SIZES), true),
    e("avatar.enabled", "Notchling in the notch", "Appearance", Kind::Toggle, true),
    ro("accent", "Accent colour", "Appearance", Kind::Text, ON_COMPUTER),
    // Sounds & alerts
    e("playSounds", "Play sounds", "Sounds and alerts", Kind::Toggle, true),
    e("soundPack", "Sound style", "Sounds and alerts", Kind::Select(SOUND_PACKS), true),
    e("soundVolume", "Volume", "Sounds and alerts", Kind::Number(0.0, 100.0), true),
    e("startSoundOn", "Sound when listening starts", "Sounds and alerts", Kind::Toggle, true),
    e("stopSoundOn", "Sound when done", "Sounds and alerts", Kind::Toggle, true),
    e("notifySound", "Chime for reminders and Claude", "Sounds and alerts", Kind::Toggle, true),
    e("systemNotifications", "System notifications", "Sounds and alerts", Kind::Toggle, true),
    // Dictation
    ro("hotkeyDictation", "Dictation key", "Dictation", Kind::Text, ON_COMPUTER),
    ro("hotkeyAssistant", "Assistant key", "Dictation", Kind::Text, ON_COMPUTER),
    e("cleanupEnabled", "Clean up what you say", "Dictation", Kind::Toggle, true),
    e("learnCorrections", "Learn from your corrections", "Dictation", Kind::Toggle, true),
    ro("sttProvider", "Speech engine", "Dictation", Kind::Text, ON_COMPUTER),
    ro("sttModel", "Speech model", "Dictation", Kind::Text, ON_COMPUTER),
    ro("language", "Language", "Dictation", Kind::Text, ON_COMPUTER),
    ro("autoLanguages", "Languages to listen for", "Dictation", Kind::List, ON_COMPUTER),
    e("sttKeepWarmMins", "Keep the speech model ready (minutes)", "Dictation", Kind::Number(0.0, 120.0), true),
    ro("typingWpm", "Your typing speed (words a minute)", "Dictation", Kind::Number(1.0, 300.0), ON_COMPUTER),
    // Assistant
    ro("llmProvider", "Assistant provider", "Assistant", Kind::Text, ON_COMPUTER),
    ro("llmModel", "Assistant model", "Assistant", Kind::Text, ON_COMPUTER),
    ro("assistantCloudAllowed", "Allow cloud models", "Assistant", Kind::Toggle, PRIVACY),
    ro("assistantScreenContext", "Use what's on screen", "Assistant", Kind::Toggle, PRIVACY),
    e("reuseAnswers", "Reuse recent answers", "Assistant", Kind::Toggle, true),
    // Claude Code
    e("claudeApprovals", "Allow or deny from Flo", "Claude Code", Kind::Toggle, true),
    e("claudeAutoContinue", "Continue after usage limits reset", "Claude Code", Kind::Toggle, true),
    ro("claudeContinuePrompt", "What a resumed session is told", "Claude Code", Kind::Text, ON_COMPUTER),
    // Meetings, to-dos and memory
    e("meetingDetection", "Notice meetings", "Meetings and to-dos", Kind::Toggle, true),
    e("slackSync", "To-dos from Slack", "Meetings and to-dos", Kind::Toggle, true),
    e("vaultAuto", "Grow your Flo Vault", "Meetings and to-dos", Kind::Toggle, true),
    // Presence
    e("autoAway", "Go Away automatically", "Away mode", Kind::Toggle, true),
    e("autoAwayMinutes", "Away after (minutes idle)", "Away mode", Kind::Number(1.0, 240.0), true),
    // Privacy (screen awareness): visible, never changeable from the phone
    ro("attentionEnabled", "Screen awareness", "Privacy", Kind::Toggle, PRIVACY),
    ro("attentionCloudAllowed", "Screen awareness may use the cloud", "Privacy", Kind::Toggle, PRIVACY),
    ro("attentionIntervalSec", "Look every (seconds)", "Privacy", Kind::Number(5.0, 3600.0), PRIVACY),
    ro("attentionDenylist", "Never look at", "Privacy", Kind::List, PRIVACY),
    ro("sync.enabled", "Sync your data (end-to-end encrypted)", "Privacy", Kind::Toggle, PRIVACY),
    // Account
    ro("userName", "Your name", "Account", Kind::Text, ON_COMPUTER),
];

fn pointer(key: &str) -> String {
    format!("/{}", key.replace('.', "/"))
}

/// The allow-listed settings as the phone shows them.
pub fn settings_entries(s: &Settings) -> Vec<Value> {
    let all = serde_json::to_value(s).unwrap_or(Value::Null);
    CATALOG
        .iter()
        .filter_map(|c| {
            let v = all.pointer(&pointer(c.key))?.clone();
            let (kind, extra) = match c.kind {
                Kind::Toggle => ("toggle", json!({})),
                Kind::Select(opts) => ("select", json!({ "options": opts.iter().map(|(v, l)| json!({ "value": v, "label": l })).collect::<Vec<_>>() })),
                Kind::Number(min, max) => ("number", json!({ "min": min, "max": max })),
                Kind::Text => ("text", json!({})),
                Kind::List => ("list", json!({})),
            };
            let mut o = json!({ "key": c.key, "label": c.label, "section": c.section, "kind": kind, "value": v, "editable": c.editable });
            if let Some(h) = c.hint {
                o["hint"] = json!(h);
            }
            if let (Some(o), Some(x)) = (o.as_object_mut(), extra.as_object()) {
                o.extend(x.clone());
            }
            Some(o)
        })
        .collect()
}

/// A phone asked to change `key` to `value`: the new Settings, or why not.
pub fn apply_setting(s: &Settings, key: &str, value: &Value) -> Result<Settings, String> {
    let entry = CATALOG.iter().find(|c| c.key == key).ok_or_else(|| "That setting can't be changed from your phone.".to_string())?;
    if !entry.editable {
        return Err("Change that one on your computer.".into());
    }
    let v = match entry.kind {
        Kind::Toggle => value.as_bool().map(Value::Bool),
        Kind::Select(opts) => value.as_str().filter(|x| opts.iter().any(|(o, _)| o == x)).map(|x| json!(x)),
        Kind::Number(min, max) => value.as_f64().filter(|n| n.is_finite() && *n >= min && *n <= max).map(|n| json!(n.round() as i64)),
        Kind::Text | Kind::List => None,
    }
    .ok_or_else(|| format!("That isn't a valid value for {}.", entry.label.to_lowercase()))?;
    let mut all = serde_json::to_value(s).map_err(|e| e.to_string())?;
    *all.pointer_mut(&pointer(key)).ok_or("Unknown setting.")? = v;
    serde_json::from_value(all).map_err(|e| e.to_string())
}

// ── snapshot ─────────────────────────────────────────────────────────────────

const OPEN_TODOS: usize = 100;
const DONE_TODOS: usize = 30;

pub fn platform_name() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macos",
        "windows" => "windows",
        "linux" => "linux",
        _ => "other",
    }
}

/// The whole snapshot, built without touching the network (unit-tested).
pub fn snapshot(todos: &[Todo], approvals: &[crate::claude::PendingPermission], sessions: &[ClaudeSession], s: &Settings, now: chrono::DateTime<chrono::Local>) -> Value {
    let week_ago = (now - chrono::Duration::days(7)).to_rfc3339();
    let open: Vec<Value> = todos
        .iter()
        .filter(|t| t.status == "open" || t.status == "snoozed")
        .take(OPEN_TODOS)
        .map(|t| {
            let mut o = json!({ "id": t.id, "title": t.title, "source": t.source, "createdAt": t.created_at });
            if let Some(d) = &t.due {
                o["due"] = json!(d);
            }
            if let Some(p) = &t.person {
                o["person"] = json!(p);
            }
            o
        })
        .collect();
    let mut done: Vec<&Todo> = todos.iter().filter(|t| t.status == "done" && t.completed_at.as_deref().map(|c| c >= week_ago.as_str()).unwrap_or(false)).collect();
    done.sort_by(|a, b| b.completed_at.cmp(&a.completed_at));
    let done: Vec<Value> = done.into_iter().take(DONE_TODOS).map(|t| json!({ "id": t.id, "title": t.title, "completedAt": t.completed_at })).collect();
    let now_s = now.to_rfc3339();
    let approvals: Vec<Value> = approvals.iter().filter(|a| a.expires_at.as_str() > now_s.as_str()).map(|a| json!(a)).collect();
    // sessions waiting on you that the phone can't answer (a question in the terminal)
    let waiting: Vec<Value> = sessions
        .iter()
        .filter(|c| c.status == "waiting_reply")
        .take(20)
        .map(|c| json!({ "id": c.session_id, "project": c.project, "message": c.message, "status": c.status, "at": c.updated_at }))
        .collect();
    json!({
        "v": 1,
        "computer": { "platform": platform_name(), "appVersion": env!("CARGO_PKG_VERSION") },
        "todos": { "open": open, "done": done },
        "approvals": approvals,
        "waiting": waiting,
        "settings": settings_entries(s),
    })
}

fn build(st: &Shared) -> Value {
    let todos = st.db.list_todos().unwrap_or_default();
    let sessions = st.db.list_claude_sessions().unwrap_or_default();
    snapshot(&todos, &crate::claude::pending_permissions(), &sessions, &st.settings(), chrono::Local::now())
}

// ── actions from the phone ───────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct PhoneAction {
    pub id: u64,
    pub kind: String,
    pub target: String,
    #[serde(default)]
    pub value: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Plan {
    Todo { id: String, status: &'static str },
    Permission { id: String, decision: &'static str },
    Setting { key: String, value: Value },
    Reject(&'static str),
}

pub fn plan(a: &PhoneAction) -> Plan {
    let target = a.target.trim().to_string();
    if target.is_empty() {
        return Plan::Reject("There was nothing to do.");
    }
    match a.kind.as_str() {
        "todo_done" => Plan::Todo { id: target, status: "done" },
        "todo_reopen" => Plan::Todo { id: target, status: "open" },
        "approve" => Plan::Permission { id: target, decision: "allow" },
        "reject" => Plan::Permission { id: target, decision: "deny" },
        "setting" => Plan::Setting { key: target, value: a.value.clone() },
        _ => Plan::Reject("Flo on your computer doesn't know that action yet. Update Flo."),
    }
}

/// Apply one phone action → (ok, message for the phone).
pub fn apply(st: &Shared, a: &PhoneAction) -> (bool, String) {
    match plan(a) {
        Plan::Reject(why) => (false, why.into()),
        Plan::Todo { id, status } => {
            let Some(t) = st.db.list_todos().unwrap_or_default().into_iter().find(|t| t.id == id) else {
                return (false, "That to-do is gone from your computer.".into());
            };
            if let Err(e) = st.db.update_todo(&id, Some(status), None, None) {
                return (false, format!("Couldn't update the to-do: {e}"));
            }
            st.emit(crate::model::ev::TODOS, ());
            st.emit(crate::model::ev::PROJECTS, ());
            (true, if status == "done" { format!("Done: {}", t.title) } else { format!("Back on your list: {}", t.title) })
        }
        Plan::Permission { id, decision } => {
            if crate::claude::answer_permission(&id, decision) {
                (true, if decision == "allow" { "Allowed.".into() } else { "Denied.".into() })
            } else {
                (false, "That question already closed on your computer.".into())
            }
        }
        Plan::Setting { key, value } => match apply_setting(&st.settings(), &key, &value) {
            Ok(next) => match crate::commands::store_settings(st, next) {
                Ok(()) => {
                    st.emit(SETTINGS_CHANGED, ());
                    (true, "Changed on your computer.".into())
                }
                Err(e) => (false, format!("Couldn't save the setting: {e}")),
            },
            Err(why) => (false, why),
        },
    }
}

/// Settings changed outside the settings window (the phone): windows reload them.
pub const SETTINGS_CHANGED: &str = "flo://settings-changed";

// ── publishing ───────────────────────────────────────────────────────────────

fn wake() -> &'static tokio::sync::Notify {
    static N: OnceLock<tokio::sync::Notify> = OnceLock::new();
    N.get_or_init(tokio::sync::Notify::new)
}

/// Something the phone shows changed (to-dos, approvals, settings): publish soon.
pub fn poke() {
    wake().notify_one();
}

const DEBOUNCE: Duration = Duration::from_millis(1200);
const CHECK_EVERY: Duration = Duration::from_secs(30);
/// republish an unchanged snapshot this often, so the phone can tell the computer is on
const HEARTBEAT: Duration = Duration::from_secs(5 * 60);

fn digest(v: &Value) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    v.to_string().hash(&mut h);
    h.finish()
}

/// Publish when the snapshot changes (debounced) or the heartbeat is due. Only while signed in.
pub fn spawn(st: Shared) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(6)).await;
        let mut last: Option<(u64, Instant)> = None;
        loop {
            let poked = tokio::select! {
                _ = wake().notified() => true,
                _ = tokio::time::sleep(CHECK_EVERY) => false,
            };
            if poked {
                tokio::time::sleep(DEBOUNCE).await; // a burst of changes → one publish
            }
            if !(crate::push::has_session(&st) && crate::account::enforced(&st)) {
                last = None;
                continue;
            }
            let snap = build(&st);
            let h = digest(&snap);
            if matches!(last, Some((d, at)) if d == h && at.elapsed() < HEARTBEAT) {
                continue;
            }
            match crate::push::call(&st, "POST", "/api/app/state", Some(snap)).await.and_then(crate::push::ok_or_err) {
                Ok(_) => last = Some((h, Instant::now())),
                Err(e) => {
                    log::debug!("phone state: {e}");
                    tokio::time::sleep(Duration::from_secs(60)).await;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::claude::PendingPermission;

    fn todo(id: &str, status: &str, completed: Option<&str>) -> Todo {
        Todo { id: id.into(), title: format!("To-do {id}"), source: "voice".into(), status: status.into(), created_at: "2026-11-01T09:00:00+00:00".into(), completed_at: completed.map(String::from), ..Default::default() }
    }

    fn now() -> chrono::DateTime<chrono::Local> {
        chrono::DateTime::parse_from_rfc3339("2026-11-09T12:00:00+00:00").unwrap().with_timezone(&chrono::Local)
    }

    #[test]
    fn snapshot_lists_open_and_recent_done_todos() {
        let todos = vec![
            todo("a", "open", None),
            todo("b", "snoozed", None),
            todo("c", "dismissed", None),
            todo("d", "done", Some("2026-11-08T09:00:00+00:00")),
            todo("e", "done", Some("2026-10-01T09:00:00+00:00")), // too old
            todo("f", "done", Some("2026-11-09T09:00:00+00:00")),
        ];
        let s = snapshot(&todos, &[], &[], &Settings::default(), now());
        let ids = |v: &Value| v.as_array().unwrap().iter().map(|t| t["id"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        assert_eq!(ids(&s["todos"]["open"]), ["a", "b"]);
        assert_eq!(ids(&s["todos"]["done"]), ["f", "d"], "newest first, only the last week");
        assert_eq!(s["v"], 1);
        assert_eq!(s["computer"]["platform"], platform_name());
    }

    #[test]
    fn snapshot_shows_live_approvals_and_waiting_sessions() {
        let p = |id: &str, exp: &str| PendingPermission { id: id.into(), project: "api".into(), summary: "Run: npm test".into(), tool: "Bash".into(), at: "2026-11-09T11:59:00+00:00".into(), expires_at: exp.into() };
        let sess = |id: &str, status: &str| ClaudeSession { session_id: id.into(), project: "web".into(), cwd: "/x".into(), status: status.into(), message: "Claude is waiting for your input".into(), updated_at: "2026-11-09T11:00:00+00:00".into(), app_bundle: None, terminal: None, transcript_path: None, source: "claude".into() };
        let s = snapshot(&[], &[p("live", "2026-11-09T12:01:00+00:00"), p("expired", "2026-11-09T11:59:30+00:00")], &[sess("s1", "waiting_reply"), sess("s2", "working")], &Settings::default(), now());
        assert_eq!(s["approvals"].as_array().unwrap().len(), 1);
        assert_eq!(s["approvals"][0]["id"], "live");
        assert_eq!(s["approvals"][0]["expiresAt"], "2026-11-09T12:01:00+00:00");
        assert_eq!(s["waiting"].as_array().unwrap().len(), 1);
        assert_eq!(s["waiting"][0]["id"], "s1");
    }

    #[test]
    fn settings_never_include_secrets_or_private_text() {
        let mut st = Settings::default();
        st.system_prompt = "my secret prompt".into();
        st.local_llm_url = "http://10.0.0.5:11434".into();
        let text = serde_json::to_string(&settings_entries(&st)).unwrap();
        for bad in ["my secret prompt", "10.0.0.5", "accountUrl", "accountUser", "systemPrompt", "localLlmUrl", "presence\""] {
            assert!(!text.contains(bad), "{bad} leaked");
        }
        // every catalog key resolves (a renamed setting would silently vanish otherwise)
        assert_eq!(settings_entries(&st).len(), CATALOG.len());
    }

    #[test]
    fn settings_entries_carry_kind_value_and_options() {
        let s = Settings::default();
        let all = settings_entries(&s);
        let get = |k: &str| all.iter().find(|e| e["key"] == k).unwrap().clone();
        assert_eq!(get("playSounds")["kind"], "toggle");
        assert_eq!(get("playSounds")["value"], true);
        assert_eq!(get("playSounds")["editable"], true);
        assert_eq!(get("theme")["options"][1]["value"], "dark");
        assert_eq!(get("avatar.enabled")["value"], true);
        assert_eq!(get("attentionEnabled")["editable"], false);
        assert!(get("attentionEnabled")["hint"].as_str().unwrap().contains("computer"));
        assert_eq!(get("soundVolume")["max"], 100.0);
    }

    #[test]
    fn apply_setting_only_changes_editable_valid_values() {
        let s = Settings::default();
        assert!(!apply_setting(&s, "playSounds", &json!(false)).unwrap().play_sounds);
        assert_eq!(apply_setting(&s, "theme", &json!("dark")).unwrap().theme, "dark");
        assert_eq!(apply_setting(&s, "soundVolume", &json!(35)).unwrap().sound_volume, 35);
        assert!(!apply_setting(&s, "avatar.enabled", &json!(false)).unwrap().avatar.enabled);
        assert!(apply_setting(&s, "theme", &json!("neon")).is_err());
        assert!(apply_setting(&s, "soundVolume", &json!(500)).is_err());
        assert!(apply_setting(&s, "playSounds", &json!("yes")).is_err());
        assert!(apply_setting(&s, "attentionEnabled", &json!(true)).is_err(), "privacy settings are read-only");
        assert!(apply_setting(&s, "systemPrompt", &json!("x")).is_err(), "not in the catalog");
        assert!(apply_setting(&s, "accountUrl", &json!("https://evil")).is_err());
    }

    #[test]
    fn plans_each_action() {
        let a = |kind: &str, target: &str, value: Value| PhoneAction { id: 1, kind: kind.into(), target: target.into(), value };
        assert_eq!(plan(&a("todo_done", "t1", Value::Null)), Plan::Todo { id: "t1".into(), status: "done" });
        assert_eq!(plan(&a("todo_reopen", "t1", Value::Null)), Plan::Todo { id: "t1".into(), status: "open" });
        assert_eq!(plan(&a("approve", "q1", Value::Null)), Plan::Permission { id: "q1".into(), decision: "allow" });
        assert_eq!(plan(&a("reject", "q1", Value::Null)), Plan::Permission { id: "q1".into(), decision: "deny" });
        assert_eq!(plan(&a("setting", "theme", json!("dark"))), Plan::Setting { key: "theme".into(), value: json!("dark") });
        assert!(matches!(plan(&a("delete_all", "x", Value::Null)), Plan::Reject(_)));
        assert!(matches!(plan(&a("approve", " ", Value::Null)), Plan::Reject(_)));
    }

    #[test]
    fn digest_changes_with_content() {
        assert_eq!(digest(&json!({"a": 1})), digest(&json!({"a": 1})));
        assert_ne!(digest(&json!({"a": 1})), digest(&json!({"a": 2})));
    }
}
