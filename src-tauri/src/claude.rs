//! Claude Code integration.
//!
//! Claude Code hooks (Stop / Notification / SubagentStop) run a tiny `curl` that POSTs the hook
//! JSON to Flo's listener on 127.0.0.1 (token-protected). Flo pops the island ("Claude finished
//! in <project>"), stores the event locally, and re-reminds once if you haven't looked after 10 min.
use crate::model::*;
use crate::state::Shared;
use crate::{db, secrets, text};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

pub const PORT: u16 = 47621;
const MARKER: &str = "flo-flow-hook";
const HOOK_EVENTS: &[&str] = &["Stop", "Notification"];

// ── pure helpers ────────────────────────────────────────────────────────────

/// The hook also reports which app launched Claude Code ($__CFBundleIdentifier, set by macOS
/// for GUI-launched apps' child processes) and $TERM_PROGRAM, so "Open" can jump back to it.
pub fn hook_command(port: u16, token: &str) -> String {
    format!(
        "curl -s -m 2 -X POST -H \"Content-Type: application/json\" --data-binary @- \"http://127.0.0.1:{port}/claude/hook?token={token}&src={MARKER}&bundle=${{__CFBundleIdentifier:-}}&term=${{TERM_PROGRAM:-}}\" >/dev/null 2>&1 || exit 0"
    )
}

fn safe_ident(s: &str) -> Option<String> {
    let s = s.trim();
    (!s.is_empty() && s.len() < 128 && s.chars().all(|c| c.is_ascii_alphanumeric() || ".-_".contains(c))).then(|| s.to_string())
}

/// Which app to bring forward for a session: (bundle id, open the cwd folder in it?).
pub fn open_target(bundle: Option<&str>, terminal: Option<&str>) -> Option<(String, bool)> {
    const EDITORS: &[&str] = &[
        "com.microsoft.VSCode",
        "com.microsoft.VSCodeInsiders",
        "com.todesktop.230313mzl4w4u92", // Cursor
        "com.exafunction.windsurf",
        "dev.zed.Zed",
        "com.vscodium",
    ];
    let from_term = |t: &str| -> Option<&'static str> {
        Some(match t {
            "vscode" => "com.microsoft.VSCode",
            "iTerm.app" => "com.googlecode.iterm2",
            "Apple_Terminal" => "com.apple.Terminal",
            "WarpTerminal" => "dev.warp.Warp-Stable",
            "ghostty" => "com.mitchellh.ghostty",
            "WezTerm" => "com.github.wez.wezterm",
            "tmux" | "screen" => return None,
            _ => return None,
        })
    };
    let b = bundle.and_then(safe_ident).or_else(|| terminal.and_then(from_term).map(String::from))?;
    let is_editor = EDITORS.iter().any(|e| e.eq_ignore_ascii_case(&b)) || b.to_lowercase().contains("jetbrains");
    Some((b, is_editor))
}

fn is_ours(entry: &Value) -> bool {
    entry["hooks"]
        .as_array()
        .map(|hs| hs.iter().any(|h| h["command"].as_str().map(|c| c.contains(MARKER)).unwrap_or(false)))
        .unwrap_or(false)
}

/// Remove Flo's hook entries; leaves other hooks untouched.
pub fn remove_hooks(mut settings: Value) -> Value {
    if let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        for ev in HOOK_EVENTS {
            if let Some(arr) = hooks.get_mut(*ev).and_then(|a| a.as_array_mut()) {
                arr.retain(|e| !is_ours(e));
            }
        }
        hooks.retain(|_, v| v.as_array().map(|a| !a.is_empty()).unwrap_or(true));
    }
    if settings.get("hooks").and_then(|h| h.as_object()).map(|o| o.is_empty()).unwrap_or(false) {
        settings.as_object_mut().map(|o| o.remove("hooks"));
    }
    settings
}

/// Add (or refresh) Flo's hook entries.
pub fn add_hooks(settings: Value, command: &str) -> Value {
    let mut s = remove_hooks(settings);
    if !s.is_object() {
        s = json!({});
    }
    let obj = s.as_object_mut().unwrap();
    let hooks = obj.entry("hooks").or_insert_with(|| json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    for ev in HOOK_EVENTS {
        let arr = hooks.as_object_mut().unwrap().entry(*ev).or_insert_with(|| json!([]));
        if !arr.is_array() {
            *arr = json!([]);
        }
        arr.as_array_mut().unwrap().push(json!({ "hooks": [{ "type": "command", "command": command, "timeout": 5 }] }));
    }
    s
}

pub fn has_hooks(settings: &Value) -> bool {
    HOOK_EVENTS.iter().any(|ev| settings["hooks"][*ev].as_array().map(|a| a.iter().any(is_ours)).unwrap_or(false))
}

/// Last assistant text in a Claude Code transcript (JSONL).
pub fn last_assistant_text(jsonl: &str) -> Option<String> {
    for line in jsonl.lines().rev() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if v["type"] != "assistant" {
            continue;
        }
        let content = &v["message"]["content"];
        let t = match content {
            Value::String(s) => s.clone(),
            Value::Array(blocks) => blocks.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("\n"),
            _ => String::new(),
        };
        if !t.trim().is_empty() {
            return Some(t);
        }
    }
    None
}

/// Prefer a `result:` line (Claude Code background jobs end with one), else first meaningful line.
pub fn headline(msg: &str) -> String {
    if let Some(l) = msg.lines().find(|l| l.trim_start().to_lowercase().starts_with("result:")) {
        return text::truncate_chars(l.trim_start()[7..].trim(), 220);
    }
    let first = msg.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    text::truncate_chars(first.trim_start_matches('#').trim(), 220)
}

pub fn parse_hook(body: &Value, transcript: Option<&str>) -> ClaudeEvent {
    parse_hook_from(body, transcript, None, None)
}

pub fn parse_hook_from(body: &Value, transcript: Option<&str>, bundle: Option<String>, terminal: Option<String>) -> ClaudeEvent {
    let name = body["hook_event_name"].as_str().unwrap_or("Stop");
    let kind = match name {
        "Notification" => "notification",
        "SubagentStop" => "subagent_stop",
        _ => "stop",
    };
    let cwd = body["cwd"].as_str().unwrap_or("").to_string();
    let project = Path::new(&cwd).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Claude".into());
    let message = match kind {
        "notification" => body["message"].as_str().unwrap_or("Claude needs your input").to_string(),
        _ => transcript.and_then(last_assistant_text).map(|m| headline(&m)).unwrap_or_else(|| "Finished its turn".into()),
    };
    ClaudeEvent {
        id: db::new_id(),
        kind: kind.into(),
        session_id: body["session_id"].as_str().unwrap_or("").into(),
        project,
        cwd,
        message,
        at: chrono::Local::now().to_rfc3339(),
        seen: false,
        app_bundle: bundle.as_deref().and_then(safe_ident),
        terminal: terminal.as_deref().and_then(safe_ident),
    }
}

// ── config files ────────────────────────────────────────────────────────────

/// Claude Code config dirs that exist on this machine.
pub fn config_dirs() -> Vec<PathBuf> {
    let mut v = vec![];
    if let Ok(d) = std::env::var("CLAUDE_CONFIG_DIR") {
        v.push(PathBuf::from(d));
    }
    if let Some(h) = dirs::home_dir() {
        v.push(h.join(".claude"));
        v.push(h.join(".claude-rpr"));
    }
    let mut seen = HashSet::new();
    v.into_iter().filter(|p| p.is_dir() && seen.insert(p.clone())).collect()
}

fn read_json(p: &Path) -> Value {
    std::fs::read_to_string(p).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_else(|| json!({}))
}

fn write_json(p: &Path, v: &Value) -> Result<()> {
    if p.exists() {
        std::fs::copy(p, p.with_extension("json.flo-backup"))?;
    }
    let tmp = p.with_extension("json.flo-tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(v)? + "\n")?;
    std::fs::rename(tmp, p)?;
    Ok(())
}

pub fn status(st: &Shared) -> ClaudeHookStatus {
    let dirs = config_dirs();
    let files: Vec<PathBuf> = dirs.iter().map(|d| d.join("settings.json")).collect();
    let installed = files.iter().any(|f| has_hooks(&read_json(f)));
    ClaudeHookStatus {
        installed,
        config_path: files.iter().map(|f| f.display().to_string()).collect::<Vec<_>>().join(", "),
        port: st.claude_port,
        listening: st.claude_listening.load(Ordering::SeqCst),
    }
}

pub fn install(st: &Shared) -> Result<ClaudeHookStatus> {
    let dirs = config_dirs();
    if dirs.is_empty() {
        return Err(anyhow!("Claude Code config folder not found (~/.claude). Run Claude Code once first."));
    }
    let cmd = hook_command(st.claude_port, &secrets::hook_token()?);
    for d in dirs {
        let f = d.join("settings.json");
        write_json(&f, &add_hooks(read_json(&f), &cmd))?;
    }
    Ok(status(st))
}

pub fn uninstall(st: &Shared) -> Result<ClaudeHookStatus> {
    for d in config_dirs() {
        let f = d.join("settings.json");
        if f.exists() {
            let v = read_json(&f);
            if has_hooks(&v) {
                write_json(&f, &remove_hooks(v))?;
            }
        }
    }
    Ok(status(st))
}

// ── listener ────────────────────────────────────────────────────────────────

fn safe_transcript(path: &str) -> Option<String> {
    let p = PathBuf::from(path);
    let home = dirs::home_dir()?;
    let canon = p.canonicalize().ok()?;
    if !canon.starts_with(&home) || canon.extension().and_then(|e| e.to_str()) != Some("jsonl") {
        return None;
    }
    // only the tail matters
    let data = std::fs::read(&canon).ok()?;
    let start = data.len().saturating_sub(512 * 1024);
    Some(String::from_utf8_lossy(&data[start..]).to_string())
}

/// Re-write an installed hook so it uses the current command format.
pub fn refresh_if_installed(st: &Shared) {
    let cmd = match secrets::hook_token() {
        Ok(t) => hook_command(st.claude_port, &t),
        Err(_) => return,
    };
    for d in config_dirs() {
        let f = d.join("settings.json");
        let v = read_json(&f);
        if has_hooks(&v) {
            let fresh = add_hooks(v.clone(), &cmd);
            if fresh != v {
                let _ = write_json(&f, &fresh);
            }
        }
    }
}

pub fn spawn_listener(st: Shared) {
    let token = match secrets::hook_token() {
        Ok(t) => t,
        Err(e) => {
            log::error!("hook token: {e}");
            return;
        }
    };
    let st_http = st.clone();
    std::thread::Builder::new()
        .name("flo-claude".into())
        .spawn(move || {
            let st = st_http;
            let server = match tiny_http::Server::http(("127.0.0.1", st.claude_port)) {
                Ok(s) => s,
                Err(e) => {
                    log::error!("Claude listener failed on port {}: {e}", st.claude_port);
                    return;
                }
            };
            st.claude_listening.store(true, Ordering::SeqCst);
            for mut req in server.incoming_requests() {
                let url = req.url().to_string();
                let ok_path = url.starts_with("/claude/hook");
                let parsed = url::Url::parse(&format!("http://x{url}")).ok();
                let q = |name: &str| parsed.as_ref().and_then(|u| u.query_pairs().find(|(k, _)| k == name).map(|(_, v)| v.to_string()));
                let ok_token = q("token").as_deref() == Some(token.as_str());
                let (bundle, term) = (q("bundle"), q("term"));
                if req.method() != &tiny_http::Method::Post || !ok_path || !ok_token {
                    let _ = req.respond(tiny_http::Response::from_string("forbidden").with_status_code(403));
                    continue;
                }
                let mut body = String::new();
                let _ = req.as_reader().take(1024 * 1024).read_to_string(&mut body);
                let _ = req.respond(tiny_http::Response::from_string("ok"));
                let v: Value = serde_json::from_str(&body).unwrap_or(json!({}));
                let transcript = v["transcript_path"].as_str().and_then(safe_transcript);
                let ev = parse_hook_from(&v, transcript.as_deref(), bundle, term);
                if ev.kind == "subagent_stop" {
                    continue; // too noisy for reminders
                }
                if let Err(e) = st.db.insert_claude_event(&ev) {
                    log::error!("store claude event: {e}");
                }
                st.emit(ev::CLAUDE, ev);
            }
        })
        .ok();

    // re-remind once about unseen "finished" events after 10 minutes
    let st2 = st.clone();
    tauri::async_runtime::spawn(async move {
        let mut reminded: HashSet<String> = HashSet::new();
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            let Ok(events) = st2.db.list_claude_events(20) else { continue };
            let cutoff = (chrono::Local::now() - chrono::Duration::minutes(10)).to_rfc3339();
            let day_ago = (chrono::Local::now() - chrono::Duration::hours(12)).to_rfc3339();
            for e in events.into_iter().filter(|e| !e.seen && e.at < cutoff && e.at > day_ago) {
                if reminded.insert(e.id.clone()) {
                    st2.emit(ev::CLAUDE, e);
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_and_remove_hooks_preserves_others() {
        let existing = json!({
            "model": "opus",
            "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "say done"}]}]}
        });
        let cmd = hook_command(47621, "tok");
        let added = add_hooks(existing.clone(), &cmd);
        assert!(has_hooks(&added));
        assert_eq!(added["hooks"]["Stop"].as_array().unwrap().len(), 2);
        assert_eq!(added["hooks"]["Notification"].as_array().unwrap().len(), 1);
        // idempotent
        let again = add_hooks(added.clone(), &cmd);
        assert_eq!(again["hooks"]["Stop"].as_array().unwrap().len(), 2);
        let removed = remove_hooks(again);
        assert!(!has_hooks(&removed));
        assert_eq!(removed["model"], "opus");
        assert_eq!(removed["hooks"]["Stop"][0]["hooks"][0]["command"], "say done");
        assert!(removed["hooks"].get("Notification").is_none());
    }

    #[test]
    fn remove_drops_empty_hooks_object() {
        let s = add_hooks(json!({}), "x flo-flow-hook");
        let r = remove_hooks(s);
        assert_eq!(r, json!({}));
    }

    #[test]
    fn reads_last_assistant_text() {
        let jsonl = [
            r#"{"type":"user","message":{"content":"hi"}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"First"}]}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"x"}]}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Built the island.\nresult: Island UI shipped"}]}}"#,
            "garbage",
        ]
        .join("\n");
        let t = last_assistant_text(&jsonl).unwrap();
        assert_eq!(headline(&t), "Island UI shipped");
    }

    #[test]
    fn parses_hook_payloads() {
        let stop = json!({"hook_event_name":"Stop","session_id":"s1","cwd":"/Users/p/Flo"});
        let e = parse_hook(&stop, None);
        assert_eq!((e.kind.as_str(), e.project.as_str()), ("stop", "Flo"));
        let n = json!({"hook_event_name":"Notification","message":"Claude needs permission","cwd":"/x/api"});
        let e = parse_hook(&n, None);
        assert_eq!(e.kind, "notification");
        assert_eq!(e.message, "Claude needs permission");
    }

    #[test]
    fn open_targets() {
        assert_eq!(open_target(Some("com.microsoft.VSCode"), Some("vscode")), Some(("com.microsoft.VSCode".into(), true)));
        assert_eq!(open_target(None, Some("iTerm.app")), Some(("com.googlecode.iterm2".into(), false)));
        assert_eq!(open_target(Some(""), Some("Apple_Terminal")), Some(("com.apple.Terminal".into(), false)));
        assert_eq!(open_target(Some("bad; rm -rf"), None), None);
        assert_eq!(open_target(None, None), None);
        assert!(hook_command(1, "t").contains("bundle=${__CFBundleIdentifier:-}"));
    }

    #[test]
    fn headline_strips_markdown() {
        assert_eq!(headline("\n## Done!\nmore"), "Done!");
    }
}
