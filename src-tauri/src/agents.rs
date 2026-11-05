//! Other AI agents in the notch tray (beyond Claude Code):
//!  - OpenAI Codex CLI: `notify` in ~/.codex/config.toml (Codex appends a JSON arg on turn end)
//!  - Cursor: ~/.cursor/hooks.json (`beforeSubmitPrompt` → working, `stop` → done)
//!  - anything else: POST http://127.0.0.1:47621/agent/event?token=…&source=<name>&event=working|done|waiting
//!    body (optional): {"session_id","cwd","title","message"}
use crate::model::ClaudeEvent;
use crate::state::Shared;
use crate::text;
use anyhow::{anyhow, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const MARKER: &str = "flo-agent-hook";

fn now() -> String {
    chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, false)
}

fn project_of(cwd: &str) -> String {
    Path::new(cwd).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "agent".into())
}

/// Map an incoming agent event to a tray event + status (Some(None) = remove).
pub fn parse_agent(source: &str, event: Option<&str>, body: &Value) -> Option<(ClaudeEvent, Option<&'static str>)> {
    let source = source.to_lowercase();
    let src: String = source.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(24).collect();
    if src.is_empty() {
        return None;
    }
    let (session, cwd, message, status): (String, String, String, Option<&'static str>) = match src.as_str() {
        "codex" => {
            let kind = body["type"].as_str().unwrap_or("agent-turn-complete");
            let cwd = body["cwd"].as_str().unwrap_or("").to_string();
            let session = body["thread-id"].as_str().or(body["thread_id"].as_str()).map(String::from).unwrap_or_else(|| cwd.clone());
            let msg = body["last-assistant-message"].as_str().unwrap_or("Codex finished").to_string();
            let status = if kind == "agent-turn-complete" { Some("done") } else { Some("waiting_reply") };
            (session, cwd, msg, status)
        }
        "cursor" => {
            let cwd = body["workspace_roots"][0].as_str().unwrap_or("").to_string();
            let session = body["conversation_id"].as_str().map(String::from).unwrap_or_else(|| cwd.clone());
            let status = match event.unwrap_or("stop") {
                "prompt" | "working" => Some("working"),
                _ => Some("done"),
            };
            let msg = match body["status"].as_str() {
                Some("error") => "Cursor agent stopped with an error".to_string(),
                Some("aborted") => "Cursor agent was stopped".to_string(),
                _ if status == Some("working") => body["prompt"].as_str().map(|p| text::truncate_chars(p, 140)).unwrap_or_default(),
                _ => "Cursor agent finished".to_string(),
            };
            (session, cwd, msg, status)
        }
        _ => {
            let cwd = body["cwd"].as_str().unwrap_or("").to_string();
            let session = body["session_id"].as_str().map(String::from).unwrap_or_else(|| format!("{src}:{cwd}"));
            let status = match event.unwrap_or("done") {
                "working" | "start" => Some("working"),
                "waiting" | "input" => Some("waiting_reply"),
                "approval" => Some("needs_approval"),
                "end" => None,
                _ => Some("done"),
            };
            (session, cwd, body["message"].as_str().unwrap_or("").to_string(), status)
        }
    };
    let title = body["title"].as_str().map(String::from).unwrap_or_else(|| project_of(&cwd));
    let kind = match status {
        Some("working") => "prompt",
        Some("done") => "stop",
        None => "end",
        _ => "notification",
    };
    let ev = ClaudeEvent {
        id: crate::db::new_id(),
        kind: kind.into(),
        session_id: format!("{src}:{session}"),
        project: title,
        cwd,
        message: text::truncate_chars(&text::strip_ai_dashes(message.trim()), 280),
        at: now(),
        seen: false,
        app_bundle: None,
        terminal: None,
        transcript_path: None,
    };
    Some((ev, status))
}

// ── installers ─────────────────────────────────────────────────────────────

fn curl(port: u16, token: &str, source: &str, event: &str, data: &str) -> String {
    format!(
        "curl -s -m 2 -X POST -H 'Content-Type: application/json' --data-binary {data} 'http://127.0.0.1:{port}/agent/event?token={token}&source={source}&event={event}&src={MARKER}&pid='$PPID >/dev/null 2>&1 || true"
    )
}

pub fn codex_config() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".codex").join("config.toml"))
}

pub fn cursor_hooks() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".cursor").join("hooks.json"))
}

/// Codex: top-level `notify = [...]` (Codex appends the event JSON as the last argument → "$1").
pub fn codex_add(toml: &str, port: u16, token: &str) -> Result<String> {
    let cleaned = codex_remove(toml);
    if cleaned.lines().any(|l| l.trim_start().starts_with("notify") && l.contains('=')) {
        return Err(anyhow!("Codex already has a `notify` command in config.toml. Remove it first, or add Flo's webhook to it."));
    }
    let cmd = curl(port, token, "codex", "done", "\"$1\"");
    let line = format!("notify = [\"sh\", \"-c\", {}, \"flo\"]  # {MARKER}\n", serde_json::to_string(&cmd)?);
    // top-level keys must come before any [table]
    Ok(format!("{line}{cleaned}"))
}

pub fn codex_remove(toml: &str) -> String {
    toml.lines().filter(|l| !l.contains(MARKER)).map(|l| format!("{l}\n")).collect()
}

pub fn cursor_add(hooks: Value, port: u16, token: &str) -> Value {
    let mut v = cursor_remove(hooks);
    if !v.is_object() {
        v = json!({});
    }
    v["version"] = json!(1);
    if !v["hooks"].is_object() {
        v["hooks"] = json!({});
    }
    for (ev, name) in [("stop", "stop"), ("beforeSubmitPrompt", "prompt")] {
        let list = v["hooks"][ev].as_array().cloned().unwrap_or_default();
        let mut list = list;
        list.push(json!({ "command": curl(port, token, "cursor", name, "@-") }));
        v["hooks"][ev] = json!(list);
    }
    v
}

pub fn cursor_remove(mut hooks: Value) -> Value {
    if let Some(h) = hooks.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        for (_, list) in h.iter_mut() {
            if let Some(arr) = list.as_array_mut() {
                arr.retain(|e| !e["command"].as_str().map(|c| c.contains(MARKER)).unwrap_or(false));
            }
        }
        h.retain(|_, l| l.as_array().map(|a| !a.is_empty()).unwrap_or(true));
    }
    hooks
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Integration {
    pub id: String,
    pub name: String,
    /// the tool's config folder exists on this machine
    pub available: bool,
    pub installed: bool,
    pub config_path: String,
    pub note: String,
}

fn read(p: &Path) -> String {
    std::fs::read_to_string(p).unwrap_or_default()
}

fn write_backup(p: &Path, s: &str) -> Result<()> {
    if p.exists() {
        std::fs::copy(p, p.with_extension("flo-backup"))?;
    }
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    std::fs::write(p, s)?;
    Ok(())
}

pub fn list(st: &Shared) -> Vec<Integration> {
    let claude = crate::claude::status(st);
    let mut out = vec![Integration {
        id: "claude".into(),
        name: "Claude Code".into(),
        available: !crate::claude::config_dirs().is_empty(),
        installed: claude.installed,
        config_path: claude.config_path,
        note: "Sessions, status and Open-in-window".into(),
    }];
    if let Some(p) = codex_config() {
        out.push(Integration {
            id: "codex".into(),
            name: "Codex CLI".into(),
            available: p.parent().map(|d| d.exists()).unwrap_or(false),
            installed: read(&p).contains(MARKER),
            config_path: p.display().to_string(),
            note: "Notifies when a Codex turn finishes".into(),
        });
    }
    if let Some(p) = cursor_hooks() {
        out.push(Integration {
            id: "cursor".into(),
            name: "Cursor".into(),
            available: p.parent().map(|d| d.exists()).unwrap_or(false),
            installed: read(&p).contains(MARKER),
            config_path: p.display().to_string(),
            note: "Agent working / finished".into(),
        });
    }
    out.push(Integration {
        id: "webhook".into(),
        name: "Any tool (webhook)".into(),
        available: true,
        installed: true,
        config_path: format!("http://127.0.0.1:{}/agent/event?token=…&source=NAME&event=working|done|waiting", st.claude_port),
        note: "POST JSON {title, message, cwd, session_id}".into(),
    });
    out
}

pub fn install(st: &Shared, id: &str) -> Result<()> {
    let token = crate::secrets::hook_token()?;
    match id {
        "claude" => crate::claude::install(st).map(|_| ()),
        "codex" => {
            let p = codex_config().ok_or_else(|| anyhow!("no home dir"))?;
            write_backup(&p, &codex_add(&read(&p), st.claude_port, &token)?)
        }
        "cursor" => {
            let p = cursor_hooks().ok_or_else(|| anyhow!("no home dir"))?;
            let v: Value = serde_json::from_str(&read(&p)).unwrap_or(json!({}));
            write_backup(&p, &(serde_json::to_string_pretty(&cursor_add(v, st.claude_port, &token))? + "\n"))
        }
        _ => Err(anyhow!("unknown integration {id}")),
    }
}

pub fn uninstall(st: &Shared, id: &str) -> Result<()> {
    match id {
        "claude" => crate::claude::uninstall(st).map(|_| ()),
        "codex" => {
            let p = codex_config().ok_or_else(|| anyhow!("no home dir"))?;
            if p.exists() {
                write_backup(&p, &codex_remove(&read(&p)))?;
            }
            Ok(())
        }
        "cursor" => {
            let p = cursor_hooks().ok_or_else(|| anyhow!("no home dir"))?;
            if p.exists() {
                let v: Value = serde_json::from_str(&read(&p)).unwrap_or(json!({}));
                write_backup(&p, &(serde_json::to_string_pretty(&cursor_remove(v))? + "\n"))?;
            }
            Ok(())
        }
        _ => Err(anyhow!("unknown integration {id}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_codex_turn_complete() {
        let b = json!({"type":"agent-turn-complete","thread-id":"t1","cwd":"/u/p/api","last-assistant-message":"Fixed the flaky test"});
        let (ev, st) = parse_agent("codex", None, &b).unwrap();
        assert_eq!(st, Some("done"));
        assert_eq!((ev.session_id.as_str(), ev.project.as_str(), ev.message.as_str()), ("codex:t1", "api", "Fixed the flaky test"));
    }

    #[test]
    fn parses_cursor_and_generic() {
        let (ev, st) = parse_agent("cursor", Some("prompt"), &json!({"conversation_id":"c9","workspace_roots":["/u/p/web"],"prompt":"add auth"})).unwrap();
        assert_eq!((st, ev.project.as_str()), (Some("working"), "web"));
        let (ev, st) = parse_agent("my-bot", Some("waiting"), &json!({"title":"Deploy bot","message":"Approve prod deploy?"})).unwrap();
        assert_eq!((st, ev.project.as_str()), (Some("waiting_reply"), "Deploy bot"));
        assert!(ev.session_id.starts_with("my-bot:"));
        assert_eq!(parse_agent("x", Some("end"), &json!({})).unwrap().1, None);
        assert!(parse_agent("!!", None, &json!({})).is_none());
    }

    #[test]
    fn codex_notify_added_once_and_removed() {
        let toml = "model = \"gpt-5\"\n[profiles.x]\nmodel = \"o3\"\n";
        let a = codex_add(toml, 47621, "tok").unwrap();
        assert!(a.starts_with("notify = [\"sh\", \"-c\""));
        assert!(a.contains("source=codex") && a.contains("[profiles.x]"));
        let again = codex_add(&a, 47621, "tok").unwrap(); // idempotent
        assert_eq!(again.matches("notify").count(), 1);
        assert_eq!(codex_remove(&a), toml);
        assert!(codex_add("notify = [\"x\"]\n", 1, "t").is_err()); // never clobber the user's own notify
    }

    #[test]
    fn cursor_hooks_preserve_user_hooks() {
        let mine = json!({"version":1,"hooks":{"stop":[{"command":"say done"}]}});
        let a = cursor_add(mine.clone(), 47621, "tok");
        assert_eq!(a["hooks"]["stop"].as_array().unwrap().len(), 2);
        assert_eq!(a["hooks"]["beforeSubmitPrompt"].as_array().unwrap().len(), 1);
        let r = cursor_remove(a);
        assert_eq!(r["hooks"]["stop"], mine["hooks"]["stop"]);
        assert!(r["hooks"].get("beforeSubmitPrompt").is_none());
    }
}
