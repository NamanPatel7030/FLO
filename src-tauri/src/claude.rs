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
const HOOK_EVENTS: &[&str] = &["Stop", "Notification", "UserPromptSubmit", "SessionEnd"];

/// Tray status for an event: Some(Some(status)) = upsert, Some(None) = remove, None = ignore.
pub fn session_status(ev: &ClaudeEvent) -> Option<Option<&'static str>> {
    match ev.kind.as_str() {
        "prompt" => Some(Some("working")),
        "stop" => Some(Some("done")),
        "end" => Some(None),
        "notification" => {
            let m = ev.message.to_lowercase();
            Some(Some(if m.contains("permission") || m.contains("approve") || m.contains("allow") { "needs_approval" } else { "waiting_reply" }))
        }
        _ => None,
    }
}

// ── pure helpers ────────────────────────────────────────────────────────────

/// The hook also reports which app launched Claude Code ($__CFBundleIdentifier, set by macOS
/// for GUI-launched apps' child processes) and $TERM_PROGRAM, so "Open" can jump back to it.
pub fn hook_command(port: u16, token: &str) -> String {
    format!(
        "curl -s -m 2 -X POST -H \"Content-Type: application/json\" --data-binary @- \"http://127.0.0.1:{port}/claude/hook?token={token}&src={MARKER}&bundle=${{__CFBundleIdentifier:-}}&term=${{TERM_PROGRAM:-}}&pid=$PPID\" >/dev/null 2>&1 || exit 0"
    )
}

fn safe_ident(s: &str) -> Option<String> {
    let s = s.trim();
    if s.starts_with('/') {
        // absolute .app path resolved from the process tree
        return (s.ends_with(".app") && s.len() < 512 && !s.contains("..")).then(|| s.to_string());
    }
    (!s.is_empty() && s.len() < 128 && s.chars().all(|c| c.is_ascii_alphanumeric() || ".-_".contains(c))).then(|| s.to_string())
}

/// Folder names to look for in window titles: the session dir and its parents, nearest first.
/// e.g. /Users/p/Flo/.claude/worktrees/flo-mvp → [flo-mvp, worktrees, .claude, Flo, p]
pub fn window_name_candidates(cwd: &str) -> Vec<String> {
    let mut out = vec![];
    let mut p = Path::new(cwd);
    while let Some(name) = p.file_name() {
        let n = name.to_string_lossy().to_string();
        if !n.is_empty() && !out.contains(&n) {
            out.push(n);
        }
        if out.len() >= 6 {
            break;
        }
        match p.parent() {
            Some(pp) => p = pp,
            None => break,
        }
    }
    out
}

fn lua_str(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '\\' => o.push_str("\\\\"),
            '"' => o.push_str("\\\""),
            '\n' | '\r' => o.push(' '),
            c if (c as u32) < 0x20 => {}
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

/// Hammerspoon Lua: pick the app's existing window whose title best matches the session folder
/// (VS Code titles look like "file — Workspace"), un-minimize + focus it. Never opens a window.
pub fn hammerspoon_focus_script(app: &str, names: &[String]) -> String {
    let list = names.iter().map(|n| lua_str(n)).collect::<Vec<_>>().join(",");
    format!(
        r#"local target = {app}
local names = {{{list}}}
local bid = target
if target:sub(1,1) == "/" then
  local info = hs.application.infoForBundlePath(target)
  bid = info and info.CFBundleIdentifier or target
end
local a = hs.application.get(bid)
if not a then
  if target:sub(1,1) == "/" then hs.application.launchOrFocus(target) else hs.application.launchOrFocusByBundleID(bid) end
  return "launched"
end
local best, bestScore = nil, 0
for _, w in ipairs(a:allWindows()) do
  local t = w:title() or ""
  local score = 0
  for seg in (t .. " — "):gmatch("(.-) — ") do
    for i, n in ipairs(names) do
      if seg == n then score = math.max(score, 100 - i * 10) end
    end
  end
  if score == 0 then
    for i, n in ipairs(names) do
      if #n > 2 and t:find(n, 1, true) then score = math.max(score, 40 - i * 5) end
    end
  end
  if score > 0 and t:lower():find("claude", 1, true) then score = score + 5 end
  if score > bestScore then best, bestScore = w, score end
end
if best then
  best:unminimize()
  best:focus()
  return "focused:" .. (best:title() or "")
end
a:activate()
return "activated""#,
        app = lua_str(app)
    )
}

/// Is this app (bundle id or .app path) a code editor that should open the project folder?
pub fn is_editor(app: &str) -> bool {
    let a = app.to_lowercase();
    ["visual studio code", "vscode", "cursor", "230313mzl4w4u92", "windsurf", "zed", "jetbrains", "intellij", "pycharm", "webstorm", "vscodium", "code - insiders"]
        .iter()
        .any(|k| a.contains(k))
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
    let editor = EDITORS.iter().any(|e| e.eq_ignore_ascii_case(&b)) || is_editor(&b);
    Some((b, editor))
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
        for ev in HOOK_EVENTS.iter().chain(std::iter::once(&PERMISSION_EVENT)) {
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
#[cfg(test)]
pub fn add_hooks(settings: Value, command: &str) -> Value {
    add_hooks_with(settings, command, None)
}

/// Same, plus (when given) the blocking PermissionRequest hook that lets the notch Allow / Deny.
#[cfg(test)]
pub fn add_hooks_with(settings: Value, command: &str, permission: Option<&str>) -> Value {
    add_hooks_full(settings, command, permission, None)
}

/// Same, plus (when given) the background Stop hook that lets the phone reply to a finished session
/// (`asyncRewake`: Claude Code doesn't wait for it; when it exits 2 its stderr wakes Claude, even
/// while the session sits idle at the prompt). See `reply_wait_command`.
pub fn add_hooks_full(settings: Value, command: &str, permission: Option<&str>, rewake: Option<&str>) -> Value {
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
    if let Some(perm) = permission {
        let arr = hooks.as_object_mut().unwrap().entry(PERMISSION_EVENT).or_insert_with(|| json!([]));
        if !arr.is_array() {
            *arr = json!([]);
        }
        // synchronous: Claude Code waits for the answer (Flo replies within PERMISSION_WAIT_SECS)
        arr.as_array_mut().unwrap().push(json!({ "matcher": "*", "hooks": [{ "type": "command", "command": perm, "timeout": 600 }] }));
    }
    if let Some(rw) = rewake {
        let arr = hooks.as_object_mut().unwrap().entry("Stop").or_insert_with(|| json!([]));
        if !arr.is_array() {
            *arr = json!([]);
        }
        arr.as_array_mut().unwrap().push(json!({ "hooks": [{ "type": "command", "command": rw, "asyncRewake": true, "timeout": REWAKE_HOOK_TIMEOUT_SECS }] }));
    }
    s
}

/// Is Flo's background reply hook installed here?
pub fn has_rewake(settings: &Value) -> bool {
    settings["hooks"]["Stop"]
        .as_array()
        .map(|a| a.iter().filter(|e| is_ours(e)).any(|e| e["hooks"].as_array().map(|hs| hs.iter().any(|h| h["asyncRewake"] == true)).unwrap_or(false)))
        .unwrap_or(false)
}

/// How long a finished session keeps listening for a reply from the phone (sessions leave Flo's
/// list after 12 hours anyway).
pub const REWAKE_WAIT_SECS: u64 = 12 * 3600;
/// Claude Code's own limit for the hook: a little longer, so Flo's empty answer ends it first.
pub const REWAKE_HOOK_TIMEOUT_SECS: u64 = REWAKE_WAIT_SECS + 120;

/// The background Stop hook. It asks Flo "anything from the phone for this session?" and waits.
/// Flo answers with the reply text (→ printed to stderr, exit 2: Claude Code wakes Claude with it)
/// or with nothing (you typed in the terminal, the session ended, time ran out, Flo quit → exit 0,
/// nothing happens). The reply is only ever printed, never run.
pub fn reply_wait_command(port: u16, token: &str) -> String {
    format!(
        "out=$(curl -s -m {REWAKE_WAIT_SECS} -X POST -H \"Content-Type: application/json\" --data-binary @- \"http://127.0.0.1:{port}/claude/reply-wait?token={token}&src={MARKER}&pid=$PPID\" 2>/dev/null) || exit 0; [ -n \"$out\" ] || exit 0; printf '%s\\n' \"$out\" >&2; exit 2"
    )
}

/// Claude Code asks this hook before showing a permission prompt.
pub const PERMISSION_EVENT: &str = "PermissionRequest";
/// How long the notch waits for Allow / Deny before handing the question back to the terminal.
pub const PERMISSION_WAIT_SECS: u64 = 120;

/// The blocking hook: curl prints Flo's decision JSON to stdout (Claude Code reads it). If Flo isn't
/// running, or you answer in the terminal, it prints nothing and exits 0, so the normal prompt shows.
pub fn permission_command(port: u16, token: &str) -> String {
    format!(
        "curl -s -m 590 -X POST -H \"Content-Type: application/json\" --data-binary @- \"http://127.0.0.1:{port}/claude/permission?token={token}&src={MARKER}&bundle=${{__CFBundleIdentifier:-}}&term=${{TERM_PROGRAM:-}}&pid=$PPID\" 2>/dev/null || true"
    )
}

/// Stdout for a decision (Claude Code hooks reference: PermissionRequest → decision.behavior).
pub fn permission_reply(decision: &str) -> String {
    match decision {
        "allow" => json!({ "hookSpecificOutput": { "hookEventName": PERMISSION_EVENT, "decision": { "behavior": "allow" } } }).to_string(),
        "deny" => json!({ "hookSpecificOutput": { "hookEventName": PERMISSION_EVENT, "decision": { "behavior": "deny", "message": "The user denied this from Flo." } } }).to_string(),
        // anything else: no decision → Claude Code shows its normal prompt
        _ => String::new(),
    }
}

/// What Claude wants to do, in a few words ("Run: npm publish").
pub fn permission_summary(tool: &str, input: &Value) -> String {
    let s = |k: &str| input[k].as_str().unwrap_or("").trim().to_string();
    let file = |k: &str| {
        let p = s(k);
        std::path::Path::new(&p).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or(p)
    };
    let text = match tool {
        "Bash" => format!("Run: {}", s("command")),
        "Edit" | "MultiEdit" => format!("Edit {}", file("file_path")),
        "Write" => format!("Write {}", file("file_path")),
        "NotebookEdit" => format!("Edit notebook {}", file("notebook_path")),
        "Read" => format!("Read {}", file("file_path")),
        "WebFetch" => format!("Open {}", s("url")),
        "WebSearch" => format!("Search the web: {}", s("query")),
        ASK_TOOL => format!("Asks: {}", input["questions"][0]["question"].as_str().unwrap_or("a question").trim()),
        t if t.starts_with("mcp__") => {
            let mut parts = t.splitn(3, "__").skip(1);
            let server = parts.next().unwrap_or("");
            let name = parts.next().unwrap_or(t);
            format!("Use {name} ({server})")
        }
        t => format!("Use {t}"),
    };
    crate::text::truncate_chars(&text, 200)
}

/// A permission question still waiting for Allow / Deny (shown on the paired phone too).
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PendingPermission {
    pub id: String,
    pub project: String,
    pub summary: String,
    pub tool: String,
    pub at: String,
    /// when Flo hands the question back to the terminal (PERMISSION_WAIT_SECS)
    pub expires_at: String,
    /// the Claude Code session asking
    pub session_id: String,
    /// AskUserQuestion: what Claude asks, with the options to pick from
    #[serde(skip_serializing_if = "Option::is_none")]
    pub questions: Option<Vec<Question>>,
}

/// Claude Code's multiple-choice tool. It reaches Flo through the PermissionRequest hook; the
/// answer goes back as `updatedInput.answers` (hooks reference: "AskUserQuestion and ExitPlanMode
/// need this field"; answers map question text → option label, multi-select labels joined by ", ").
pub const ASK_TOOL: &str = "AskUserQuestion";
/// A multiple-choice question waits longer for the phone than an Allow / Deny (still inside the
/// hook's 590 s curl limit). Allow on the notch hands it to the terminal at once.
pub const QUESTION_WAIT_SECS: u64 = 300;

pub fn wait_secs(tool: &str) -> u64 {
    if tool == ASK_TOOL {
        QUESTION_WAIT_SECS
    } else {
        PERMISSION_WAIT_SECS
    }
}

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub question: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub header: String,
    pub multi_select: bool,
    pub options: Vec<String>,
}

/// The questions in an AskUserQuestion input (empty for any other tool's input).
pub fn parse_questions(input: &Value) -> Vec<Question> {
    input["questions"]
        .as_array()
        .map(|qs| {
            qs.iter()
                .filter_map(|q| {
                    let question = q["question"].as_str()?.trim().to_string();
                    let options: Vec<String> = q["options"].as_array()?.iter().filter_map(|o| o["label"].as_str().or_else(|| o.as_str())).map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
                    (!question.is_empty() && !options.is_empty()).then(|| Question {
                        question,
                        header: q["header"].as_str().unwrap_or("").trim().to_string(),
                        multi_select: q["multiSelect"].as_bool().unwrap_or(false),
                        options,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The phone's picks (labels per question, in order) → the `answers` object, or why not.
pub fn choice_answers(questions: &[Question], picks: &[Vec<String>]) -> Result<serde_json::Map<String, Value>, String> {
    if questions.is_empty() {
        return Err("That question already closed on your computer.".into());
    }
    if picks.len() != questions.len() {
        return Err(format!("Answer all {} questions.", questions.len()));
    }
    let mut out = serde_json::Map::new();
    for (q, labels) in questions.iter().zip(picks) {
        if labels.is_empty() || (!q.multi_select && labels.len() > 1) {
            return Err(format!("Pick {} for \"{}\".", if q.multi_select { "at least one" } else { "one" }, text::truncate_chars(&q.question, 60)));
        }
        if let Some(bad) = labels.iter().find(|l| !q.options.iter().any(|o| o == *l)) {
            return Err(format!("\"{}\" isn't one of the options any more.", text::truncate_chars(bad, 60)));
        }
        out.insert(q.question.clone(), json!(labels.join(", ")));
    }
    Ok(out)
}

/// Stdout answering an AskUserQuestion: allow, echoing the questions back with the answers added.
pub fn question_reply(input: &Value, answers: &serde_json::Map<String, Value>) -> String {
    let mut updated = if input.is_object() { input.clone() } else { json!({}) };
    updated["answers"] = Value::Object(answers.clone());
    json!({ "hookSpecificOutput": { "hookEventName": PERMISSION_EVENT, "decision": { "behavior": "allow", "updatedInput": updated } } }).to_string()
}

/// Stdout for "no, and here's what I want instead" (a typed reply from the phone): Claude reads the
/// message as the reason and carries on with it.
pub fn deny_reply(user_text: &str) -> String {
    let message = format!("The user replied from their phone through Flo instead of choosing: {user_text}");
    json!({ "hookSpecificOutput": { "hookEventName": PERMISSION_EVENT, "decision": { "behavior": "deny", "message": message } } }).to_string()
}

struct Waiting {
    /// gets the hook's stdout ("" = no decision: Claude Code shows its own prompt)
    tx: std::sync::mpsc::Sender<String>,
    info: PendingPermission,
    /// the tool input (echoed back when answering a question)
    input: Value,
}

/// Questions waiting for Allow / Deny: id → where to send the decision (+ what was asked).
static PENDING_PERMISSIONS: parking_lot::Mutex<Option<std::collections::HashMap<String, Waiting>>> = parking_lot::Mutex::new(None);

/// The notch (or the paired phone) answered a permission question ("allow" | "deny" | "terminal").
/// Allow alone can't answer a multiple-choice question, so it hands that one to the terminal.
pub fn answer_permission(id: &str, decision: &str) -> bool {
    finish_pending(id, |w| if w.info.tool == ASK_TOOL && decision == "allow" { String::new() } else { permission_reply(decision) })
}

/// The phone picked options for an AskUserQuestion.
pub fn answer_question(id: &str, answers: &serde_json::Map<String, Value>) -> bool {
    finish_pending(id, |w| question_reply(&w.input, answers))
}

/// The phone typed a reply while Claude waits on a question or a permission: deny, with the reply.
pub fn deny_with_message(id: &str, user_text: &str) -> bool {
    finish_pending(id, |_| deny_reply(user_text))
}

fn finish_pending(id: &str, reply: impl FnOnce(&Waiting) -> String) -> bool {
    let w = PENDING_PERMISSIONS.lock().as_mut().and_then(|m| m.remove(id));
    let ok = w.map(|w| w.tx.send(reply(&w)).is_ok()).unwrap_or(false);
    crate::phone_state::poke();
    ok
}

/// The question (or permission prompt) a session is waiting on right now, if Flo holds one.
pub fn pending_for_session(session_id: &str) -> Option<PendingPermission> {
    if session_id.is_empty() {
        return None;
    }
    pending_permissions().into_iter().rev().find(|p| p.session_id == session_id)
}

/// Questions still waiting, oldest first.
pub fn pending_permissions() -> Vec<PendingPermission> {
    let mut v: Vec<PendingPermission> = PENDING_PERMISSIONS.lock().as_ref().map(|m| m.values().map(|w| w.info.clone()).collect()).unwrap_or_default();
    v.sort_by(|a, b| a.at.cmp(&b.at).then(a.id.cmp(&b.id)));
    v
}

#[cfg(test)]
fn add_pending(info: PendingPermission, tx: std::sync::mpsc::Sender<String>) {
    add_pending_with(info, Value::Null, tx)
}

fn add_pending_with(info: PendingPermission, input: Value, tx: std::sync::mpsc::Sender<String>) {
    PENDING_PERMISSIONS.lock().get_or_insert_with(Default::default).insert(info.id.clone(), Waiting { tx, info, input });
    crate::phone_state::poke();
}

/// Hold the hook's HTTP request open on its own thread until the notch answers (or time runs out),
/// so other Claude events keep flowing while a question waits.
fn ask_permission(st: &Shared, req: tiny_http::Request, body: &Value) {
    let id = crate::db::new_id();
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let cwd = body["cwd"].as_str().unwrap_or("");
    let project = std::path::Path::new(cwd).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_else(|| "Claude Code".into());
    let tool = body["tool_name"].as_str().unwrap_or("a tool");
    let summary = permission_summary(tool, &body["tool_input"]);
    log::info!("claude permission asked: {project}: {summary}");
    // who's asking: the card names the session (project / tool / terminal) and can focus its window
    let session_id = body["session_id"].as_str().unwrap_or("");
    let known = if session_id.is_empty() { None } else { st.db.get_claude_session(session_id).ok().flatten() };
    let app = known.as_ref().and_then(|s| s.terminal.clone().or_else(|| s.app_bundle.clone()));
    let now = chrono::Local::now();
    let wait = wait_secs(tool);
    let questions = (tool == ASK_TOOL).then(|| parse_questions(&body["tool_input"])).filter(|q| !q.is_empty());
    add_pending_with(
        PendingPermission {
            id: id.clone(),
            project: project.clone(),
            summary: summary.clone(),
            tool: tool.to_string(),
            at: now.to_rfc3339(),
            expires_at: (now + chrono::Duration::seconds(wait as i64)).to_rfc3339(),
            session_id: session_id.to_string(),
            questions,
        },
        body["tool_input"].clone(),
        tx,
    );
    st.emit(
        "flo://confirm",
        json!({
            "id": id, "kind": "claude", "title": format!("Claude needs you · {project}"), "body": summary,
            "sessionId": session_id, "cwd": cwd, "project": project, "tool": tool, "app": app,
            "at": chrono::Local::now().to_rfc3339(),
        }),
    );
    crate::push::notify(st, crate::push::permission_payload(&project, &summary)); // phone, only while Away
    let st2 = st.clone();
    std::thread::spawn(move || {
        // the hook's stdout; "" (timed out, or handed back) = Claude Code shows its own prompt
        let reply = rx.recv_timeout(std::time::Duration::from_secs(wait)).unwrap_or_default();
        PENDING_PERMISSIONS.lock().as_mut().map(|m| m.remove(&id));
        crate::phone_state::poke();
        let how = serde_json::from_str::<Value>(&reply).ok().and_then(|v| v["hookSpecificOutput"]["decision"]["behavior"].as_str().map(String::from)).unwrap_or_else(|| "terminal".into());
        log::info!("claude permission answered: {how}");
        // close the card wherever it is (answered elsewhere, or timed out)
        st2.emit("flo://confirm-done", json!({ "id": id }));
        let _ = req.respond(tiny_http::Response::from_string(reply));
    });
}

/// Flo's background reply hook is installed (set when the hooks are written or refreshed).
static REWAKE_INSTALLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn rewake_installed() -> bool {
    REWAKE_INSTALLED.load(Ordering::SeqCst)
}

/// The background reply hook command, when this Claude Code can run it (`asyncRewake`).
fn rewake_command(st: &Shared, token: &str) -> Option<String> {
    crate::claude_reply::rewake_supported().then(|| reply_wait_command(st.claude_port, token))
}

pub fn has_hooks(settings: &Value) -> bool {
    HOOK_EVENTS.iter().any(|ev| settings["hooks"][*ev].as_array().map(|a| a.iter().any(is_ours)).unwrap_or(false))
}

/// The last 64 KB of a transcript the hook named (only a .jsonl under the home dir).
pub fn recent_transcript(path: &str) -> Option<String> {
    let p = checked_transcript(path)?;
    let len = std::fs::metadata(&p).ok()?.len();
    let text = read_from(&p, len.saturating_sub(64 * 1024))?;
    // drop the (probably cut) first line
    Some(if len > 64 * 1024 { text.split_once('\n').map(|(_, r)| r.to_string()).unwrap_or_default() } else { text })
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
        "UserPromptSubmit" => "prompt",
        "SessionEnd" => "end",
        _ => "stop",
    };
    let cwd = body["cwd"].as_str().unwrap_or("").to_string();
    let project = Path::new(&cwd).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Claude".into());
    let message = match kind {
        "notification" => body["message"].as_str().unwrap_or("Claude needs your input").to_string(),
        "prompt" => body["prompt"].as_str().map(|p| text::truncate_chars(p.trim(), 140)).unwrap_or_default(),
        "end" => String::new(),
        _ => transcript.and_then(last_assistant_text).map(|m| headline(&m)).unwrap_or_else(|| "Finished its turn".into()),
    };
    ClaudeEvent {
        id: db::new_id(),
        kind: kind.into(),
        session_id: body["session_id"].as_str().unwrap_or("").into(),
        project,
        cwd,
        message,
        at: chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, false),
        seen: false,
        app_bundle: bundle.as_deref().and_then(safe_ident),
        terminal: terminal.as_deref().and_then(safe_ident),
        transcript_path: body["transcript_path"].as_str().filter(|p| p.ends_with(".jsonl")).map(String::from),
    }
}

/// Seconds a "working" session's transcript may stay untouched before we call it finished.
/// Long: a foreground command (a build, a test run) writes nothing to the transcript while it runs,
/// and 150 s used to call those sessions "done" mid-build.
pub const WORKING_IDLE_SECS: u64 = 600;
/// …and while background tasks it launched are still unreported (e.g. a dev server left running).
pub const WORKING_IDLE_PENDING_SECS: u64 = 1800;
/// A Stop is only announced as "Claude finished" if Claude stays quiet this long afterwards.
pub const STOP_CONFIRM_SECS: u64 = 15;
/// A "done" session whose transcript is written this long after it finished is working again.
const REVIVE_AFTER_SECS: i64 = 20;

/// Sessions marked "working" whose transcript has gone quiet are actually done (a Stop event can be
/// missed — e.g. Flo restarting, or background sessions reporting under another id).
pub fn settle_idle_sessions(st: &Shared) {
    let Ok(list) = st.db.list_claude_sessions() else { return };
    for s in list.into_iter().filter(|s| s.status == "working") {
        let Some(path) = s.transcript_path.as_deref() else { continue };
        let Ok(meta) = std::fs::metadata(path) else { continue };
        let idle = meta.modified().ok().and_then(|m| m.elapsed().ok()).map(|d| d.as_secs()).unwrap_or(0);
        if idle < WORKING_IDLE_SECS {
            continue;
        }
        let tail = safe_transcript(path);
        let pending = tail.as_deref().map(pending_background).unwrap_or(0);
        if pending == 0 || idle >= WORKING_IDLE_PENDING_SECS {
            let last = tail.and_then(|t| last_assistant_text(&t)).map(|m| headline(&m)).unwrap_or_default();
            let _ = st.db.settle_claude_session(&s.session_id, &last);
        }
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
    let token = secrets::hook_token()?;
    let cmd = hook_command(st.claude_port, &token);
    let perm = st.settings().claude_approvals.then(|| permission_command(st.claude_port, &token));
    let rewake = rewake_command(st, &token);
    for d in dirs {
        let f = d.join("settings.json");
        write_json(&f, &add_hooks_full(read_json(&f), &cmd, perm.as_deref(), rewake.as_deref()))?;
    }
    REWAKE_INSTALLED.store(rewake.is_some(), Ordering::SeqCst);
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
    REWAKE_INSTALLED.store(false, Ordering::SeqCst);
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
    // only the tail matters (transcripts grow to tens of MB; don't read all of it)
    read_from(&canon, std::fs::metadata(&canon).ok()?.len().saturating_sub(512 * 1024))
}

/// Path of a transcript the hook named, only if it's a .jsonl under the home dir.
fn checked_transcript(path: &str) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let canon = PathBuf::from(path).canonicalize().ok()?;
    (canon.starts_with(&home) && canon.extension().and_then(|e| e.to_str()) == Some("jsonl")).then_some(canon)
}

/// Text of a file from byte `offset` (at most 512 KB).
fn read_from(path: &Path, offset: u64) -> Option<String> {
    use std::io::{Read as _, Seek, SeekFrom};
    let mut f = std::fs::File::open(path).ok()?;
    f.seek(SeekFrom::Start(offset)).ok()?;
    let mut buf = Vec::new();
    f.take(512 * 1024).read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).to_string())
}

/// Did Claude do anything in these transcript lines (a reply, a tool call or its result, a task
/// notification)? Bookkeeping lines Claude Code appends after a Stop don't count.
pub fn has_activity(jsonl: &str) -> bool {
    jsonl.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).any(|v| v["type"] == "assistant" || v["type"] == "user")
}

/// Is this transcript line a prompt the user typed (not a tool result, task notification or
/// injected reminder)? A new prompt starts a new turn.
fn is_user_prompt(v: &Value) -> bool {
    if v["type"] != "user" || v["isMeta"].as_bool() == Some(true) {
        return false;
    }
    let looks_injected = |t: &str| {
        let t = t.trim_start();
        t.starts_with("<task-notification>") || t.starts_with("<system-reminder>") || t.starts_with("<local-command")
    };
    match &v["message"]["content"] {
        Value::String(s) => !looks_injected(s),
        Value::Array(blocks) => {
            !blocks.iter().any(|b| b["type"] == "tool_result")
                && blocks.iter().filter(|b| b["type"] == "text").any(|b| !looks_injected(b["text"].as_str().unwrap_or("")))
        }
        _ => false,
    }
}

/// IDs that follow `marker` in `text` (alphanumeric runs).
fn ids_after<'a>(text: &'a str, marker: &str) -> Vec<&'a str> {
    text.match_indices(marker)
        .filter_map(|(i, _)| {
            let rest = &text[i + marker.len()..];
            let end = rest.find(|c: char| !c.is_ascii_alphanumeric()).unwrap_or(rest.len());
            (end > 0).then(|| &rest[..end])
        })
        .collect()
}

/// Background work (run_in_background commands, background subagents) launched in the current
/// turn that hasn't reported a final status yet. Claude Code fires Stop when Claude ends its turn
/// to wait for these, then resumes when they finish, so the session isn't really done. Only the
/// current turn counts, so a dev server started long ago doesn't keep a session "working" forever.
pub fn pending_background(jsonl: &str) -> usize {
    const FINAL: &[&str] = &["completed", "failed", "stopped", "killed", "cancelled", "canceled", "error", "timeout"];
    let mut launched: Vec<String> = vec![];
    let mut finished: HashSet<String> = HashSet::new();
    for line in jsonl.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if v["type"] != "user" {
            continue;
        }
        if is_user_prompt(&v) {
            launched.clear();
        }
        let text = v["message"]["content"].to_string();
        for marker in ["Command running in background with ID: ", "agentId: "] {
            launched.extend(ids_after(&text, marker).into_iter().map(String::from));
        }
        for note in text.split("<task-notification>").skip(1) {
            let id = note.split("<task-id>").nth(1).and_then(|r| r.split("</task-id>").next());
            let status = note.split("<status>").nth(1).and_then(|r| r.split("</status>").next());
            if let (Some(id), Some(status)) = (id, status) {
                if FINAL.contains(&status.trim()) {
                    finished.insert(id.trim().to_string());
                }
            }
        }
    }
    launched.iter().filter(|id| !finished.contains(*id)).collect::<HashSet<_>>().len()
}

/// "done" sessions whose transcript moved well after they finished → working again.
pub fn revive_resumed_sessions(st: &Shared) {
    let Ok(list) = st.db.list_claude_sessions() else { return };
    for s in list.into_iter().filter(|s| s.status == "done") {
        let Some(path) = s.transcript_path.as_deref().and_then(checked_transcript) else { continue };
        let Some(modified) = std::fs::metadata(&path).ok().and_then(|m| m.modified().ok()) else { continue };
        let Ok(done_at) = chrono::DateTime::parse_from_rfc3339(&s.updated_at) else { continue };
        let modified: chrono::DateTime<chrono::Local> = modified.into();
        if modified.signed_duration_since(done_at).num_seconds() >= REVIVE_AFTER_SECS {
            let _ = st.db.revive_claude_session(&s.session_id);
        }
    }
}

pub fn emit_sessions(st: &Shared) {
    settle_idle_sessions(st);
    if let Ok(list) = st.db.list_claude_sessions() {
        st.emit(ev::CLAUDE_SESSIONS, list);
    }
    // the phone's session list follows promptly (e.g. working → done)
    crate::phone_state::poke();
}

/// Focus the window running a session (shared by events and tray items).
pub fn focus(app_bundle: Option<&str>, terminal: Option<&str>, cwd: &str) -> anyhow::Result<String> {
    let target = open_target(app_bundle, terminal).or_else(|| crate::platform::running_dev_app().map(|a| (a, false)));
    let Some((app, _)) = target else { return Ok(String::new()) };
    crate::platform::focus_session_window(&app, &window_name_candidates(cwd))
}

/// Re-write an installed hook so it uses the current command format.
pub fn refresh_if_installed(st: &Shared) {
    let token = match secrets::hook_token() {
        Ok(t) => t,
        Err(e) => {
            log::warn!("claude hooks: no token, not refreshing ({e})");
            return;
        }
    };
    let cmd = hook_command(st.claude_port, &token);
    let approvals = st.settings().claude_approvals;
    let perm = approvals.then(|| permission_command(st.claude_port, &token));
    let rewake = rewake_command(st, &token);
    for d in config_dirs() {
        let f = d.join("settings.json");
        let v = read_json(&f);
        if has_hooks(&v) {
            let fresh = add_hooks_full(v.clone(), &cmd, perm.as_deref(), rewake.as_deref());
            if has_rewake(&fresh) {
                REWAKE_INSTALLED.store(true, Ordering::SeqCst);
            }
            if fresh != v {
                match write_json(&f, &fresh) {
                    Ok(()) => log::info!("claude hooks refreshed in {} (approvals {})", f.display(), if approvals { "on" } else { "off" }),
                    Err(e) => log::warn!("claude hooks: couldn't write {}: {e}", f.display()),
                }
            }
        } else {
            log::info!("claude hooks: not installed in {}", f.display());
        }
    }
}

/// Claude ended a turn. That is not always "finished": it also ends a turn to wait for background
/// work, and resumes when that reports back. So: background work pending → still working, no card;
/// otherwise wait a few seconds and only announce "Claude finished" if it stayed quiet.
fn on_stop(st: &Shared, ev: ClaudeEvent, transcript: Option<&str>, transcript_path: Option<&str>) {
    let pending = transcript.map(pending_background).unwrap_or(0);
    if pending > 0 {
        let mut waiting = ev;
        waiting.message = format!("Waiting on {pending} background task{}", if pending == 1 { "" } else { "s" });
        if let Err(e) = st.db.apply_claude_event(&waiting, Some("working")) {
            log::error!("claude session: {e}");
        }
        log::info!("claude {}: stop with {pending} background task(s) pending; still working", waiting.project);
        emit_sessions(st);
        return;
    }
    let path = transcript_path.and_then(checked_transcript);
    let offset = path.as_deref().and_then(|p| std::fs::metadata(p).ok()).map(|m| m.len());
    let st = st.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(STOP_CONFIRM_SECS)).await;
        // a newer event for this session (a new prompt, a permission request) supersedes this Stop
        if let Ok(Some(s)) = st.db.get_claude_session(&ev.session_id) {
            if s.updated_at > ev.at {
                return;
            }
        }
        // Claude carried on after stopping (replied, called a tool, got a task notification)
        if let (Some(p), Some(off)) = (path.as_deref(), offset) {
            if read_from(p, off).map(|t| has_activity(&t)).unwrap_or(false) {
                log::info!("claude {}: stop superseded by more activity; not announcing", ev.project);
                return;
            }
        }
        if let Err(e) = st.db.apply_claude_event(&ev, Some("done")) {
            log::error!("claude session: {e}");
        }
        emit_sessions(&st);
        if let Err(e) = st.db.insert_claude_event(&ev) {
            log::error!("store claude event: {e}");
        }
        crate::push::notify_claude(&st, &ev); // phone, only while Away
        st.emit(ev::CLAUDE, ev);
    });
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
                let is_agent = url.starts_with("/agent/event");
                let is_permission = url.starts_with("/claude/permission");
                let is_reply_wait = url.starts_with("/claude/reply-wait");
                let ok_path = url.starts_with("/claude/hook") || is_agent || is_permission || is_reply_wait;
                let parsed = url::Url::parse(&format!("http://x{url}")).ok();
                let q = |name: &str| parsed.as_ref().and_then(|u| u.query_pairs().find(|(k, _)| k == name).map(|(_, v)| v.to_string()));
                let ok_token = q("token").as_deref() == Some(token.as_str());
                let pid = q("pid").and_then(|p| p.parse::<i32>().ok());
                if req.method() == &tiny_http::Method::Post && ok_token && is_reply_wait {
                    // the background Stop hook: no process-tree walk needed, just wait
                    let mut body = String::new();
                    let _ = req.as_reader().take(1024 * 1024).read_to_string(&mut body);
                    let v: Value = serde_json::from_str(&body).unwrap_or(json!({}));
                    crate::claude_reply::serve_wait(req, &v, pid);
                    continue;
                }
                let (mut bundle, term) = (q("bundle"), q("term"));
                // most reliable: walk the Claude process tree up to the hosting .app
                if let Some(app) = q("pid").and_then(|p| p.parse::<i32>().ok()).and_then(crate::platform::host_app_of) {
                    bundle = Some(app);
                }
                if req.method() != &tiny_http::Method::Post || !ok_path || !ok_token {
                    let _ = req.respond(tiny_http::Response::from_string("forbidden").with_status_code(403));
                    continue;
                }
                let mut body = String::new();
                let _ = req.as_reader().take(1024 * 1024).read_to_string(&mut body);
                let v: Value = serde_json::from_str(&body).unwrap_or(json!({}));
                if let (Some(p), Some(sid)) = (pid, v["session_id"].as_str()) {
                    crate::claude_reply::note_pid(sid, p);
                }
                if is_permission {
                    if st.settings().claude_approvals {
                        ask_permission(&st, req, &v); // answered on its own thread
                    } else {
                        let _ = req.respond(tiny_http::Response::from_string(""));
                    }
                    continue;
                }
                let _ = req.respond(tiny_http::Response::from_string("ok"));
                let (ev, status) = if is_agent {
                    // Codex / Cursor / any tool
                    let Some((mut ev, status)) = crate::agents::parse_agent(&q("source").unwrap_or_default(), q("event").as_deref(), &v) else { continue };
                    ev.app_bundle = bundle;
                    (ev, status)
                } else {
                    let transcript = v["transcript_path"].as_str().and_then(safe_transcript);
                    let ev = parse_hook_from(&v, transcript.as_deref(), bundle, term);
                    crate::autocontinue::observe(&st, &ev, transcript.as_deref()); // usage-limit stops / typing cancels
                    // you typed in the terminal, or the session ended: its reply hook stops waiting
                    if matches!(ev.kind.as_str(), "prompt" | "end") {
                        crate::claude_reply::release(&ev.session_id);
                    }
                    let Some(status) = session_status(&ev) else { continue };
                    if ev.kind == "stop" {
                        on_stop(&st, ev, transcript.as_deref(), v["transcript_path"].as_str());
                        continue;
                    }
                    (ev, status)
                };
                if let Err(e) = st.db.apply_claude_event(&ev, status) {
                    log::error!("claude session: {e}");
                }
                emit_sessions(&st);
                // one-shot reminder card only for "done" / "needs you"
                if matches!(ev.kind.as_str(), "stop" | "notification") {
                    if let Err(e) = st.db.insert_claude_event(&ev) {
                        log::error!("store claude event: {e}");
                    }
                    crate::push::notify_claude(&st, &ev); // phone, only while Away
                    st.emit(ev::CLAUDE, ev);
                }
            }
        })
        .ok();

    // re-remind once about unseen "finished" events after 10 minutes
    let st2 = st.clone();
    tauri::async_runtime::spawn(async move {
        let mut reminded: HashSet<String> = HashSet::new();
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            // working → done when the transcript went quiet (missed Stop events)
            let before = st2.db.list_claude_sessions().unwrap_or_default();
            revive_resumed_sessions(&st2);
            settle_idle_sessions(&st2);
            if st2.db.list_claude_sessions().unwrap_or_default() != before {
                emit_sessions(&st2);
            }
            let Ok(events) = st2.db.list_claude_events(20) else { continue };
            let cutoff = (chrono::Local::now() - chrono::Duration::minutes(10)).to_rfc3339();
            let day_ago = (chrono::Local::now() - chrono::Duration::hours(12)).to_rfc3339();
            let done: HashSet<String> =
                st2.db.list_claude_sessions().unwrap_or_default().into_iter().filter(|s| s.status == "done").map(|s| s.session_id).collect();
            // only re-remind about a finish that still stands (Claude may have carried on since)
            for e in events.into_iter().filter(|e| !e.seen && e.at < cutoff && e.at > day_ago && (e.kind != "stop" || done.contains(&e.session_id))) {
                if reminded.insert(e.id.clone()) {
                    st2.emit(ev::CLAUDE, e);
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {

    #[test]
    fn permission_hook_installs_blocking_and_uninstalls_cleanly() {
        let perm = permission_command(47621, "tok");
        let s = add_hooks_with(json!({}), &hook_command(47621, "tok"), Some(&perm));
        let entry = &s["hooks"]["PermissionRequest"][0];
        assert_eq!(entry["matcher"], "*");
        assert_eq!(entry["hooks"][0]["timeout"], 600);
        let cmd = entry["hooks"][0]["command"].as_str().unwrap();
        assert!(cmd.contains("/claude/permission?") && cmd.ends_with("|| true"));
        // re-adding doesn't duplicate; turning it off removes it; uninstall removes everything
        let again = add_hooks_with(s.clone(), &hook_command(47621, "tok"), Some(&perm));
        assert_eq!(again["hooks"]["PermissionRequest"].as_array().unwrap().len(), 1);
        let off = add_hooks_with(s.clone(), &hook_command(47621, "tok"), None);
        assert!(off["hooks"].get("PermissionRequest").is_none());
        assert!(remove_hooks(s)["hooks"].is_null());
    }

    #[test]
    fn permission_replies_follow_the_hook_format() {
        let allow: Value = serde_json::from_str(&permission_reply("allow")).unwrap();
        assert_eq!(allow["hookSpecificOutput"]["hookEventName"], "PermissionRequest");
        assert_eq!(allow["hookSpecificOutput"]["decision"]["behavior"], "allow");
        let deny: Value = serde_json::from_str(&permission_reply("deny")).unwrap();
        assert_eq!(deny["hookSpecificOutput"]["decision"]["behavior"], "deny");
        assert!(deny["hookSpecificOutput"]["decision"]["message"].as_str().unwrap().contains("Flo"));
        // terminal / timeout → no output → Claude Code shows its own prompt
        assert_eq!(permission_reply("terminal"), "");
    }

    #[test]
    fn permission_summaries_say_what_claude_wants() {
        assert_eq!(permission_summary("Bash", &json!({"command": "npm publish"})), "Run: npm publish");
        assert_eq!(permission_summary("Edit", &json!({"file_path": "/Users/p/Flo/src/main.rs"})), "Edit main.rs");
        assert_eq!(permission_summary("WebFetch", &json!({"url": "https://docs.rs"})), "Open https://docs.rs");
        assert_eq!(permission_summary("mcp__github__create_issue", &json!({})), "Use create_issue (github)");
        assert_eq!(permission_summary("Task", &json!({})), "Use Task");
    }

    #[test]
    fn an_answer_reaches_the_waiting_request() {
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        add_pending(PendingPermission { id: "q1".into(), project: "api".into(), summary: "Run: npm test".into(), tool: "Bash".into(), at: "2026-11-09T10:00:00+00:00".into(), expires_at: "2026-11-09T10:02:00+00:00".into(), session_id: String::new(), questions: None }, tx);
        assert!(pending_permissions().iter().any(|p| p.id == "q1" && p.summary == "Run: npm test"));
        assert!(answer_permission("q1", "allow"));
        assert_eq!(rx.recv().unwrap(), permission_reply("allow"), "the hook gets the decision JSON");
        assert!(!pending_permissions().iter().any(|p| p.id == "q1"), "answered questions leave the list");
        assert!(!answer_permission("q1", "deny")); // already answered
    }


    fn line(v: Value) -> String {
        v.to_string()
    }
    fn prompt(t: &str) -> String {
        line(json!({"type":"user","message":{"role":"user","content": t}}))
    }
    fn tool_result(t: &str) -> String {
        line(json!({"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"x","content": t}]}}))
    }
    fn notification(id: &str, status: &str) -> String {
        line(json!({"type":"user","message":{"role":"user","content": format!("<task-notification>\n<task-id>{id}</task-id>\n<status>{status}</status>\n</task-notification>")}}))
    }
    fn assistant(t: &str) -> String {
        line(json!({"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text": t}]}}))
    }

    #[test]
    fn stop_while_background_work_runs_is_not_finished() {
        let t = [
            prompt("build and install it"),
            tool_result("Command running in background with ID: b6ptjo4yr. Output is being written to: /tmp/x"),
            tool_result("Async agent launched successfully.\nagentId: aa5af4e4b8af30d94 (internal ID)"),
            assistant("Started the build; I'll report back when it finishes."),
        ]
        .join("\n");
        assert_eq!(pending_background(&t), 2);
        // one finishes → still one pending; both finish → really done
        let one = format!("{t}\n{}", notification("b6ptjo4yr", "completed"));
        assert_eq!(pending_background(&one), 1);
        let both = format!("{one}\n{}", notification("aa5af4e4b8af30d94", "failed"));
        assert_eq!(pending_background(&both), 0);
    }

    #[test]
    fn only_the_current_turn_counts() {
        // a dev server started in an earlier turn and never stopped must not block "done" forever
        let t = [
            prompt("run the website"),
            tool_result("Command running in background with ID: bilfjf0ai. Output is being written to: /tmp/y"),
            assistant("It's running on :3000."),
            prompt("now fix the header"),
            assistant("Fixed."),
        ]
        .join("\n");
        assert_eq!(pending_background(&t), 0);
    }

    #[test]
    fn notifications_and_reminders_are_not_new_prompts() {
        // the task notification that wakes Claude up is not a user prompt, so it doesn't reset the turn
        let t = [
            prompt("run tests in the background"),
            tool_result("Command running in background with ID: aaa111. Output is being written to: /tmp/z"),
            tool_result("Command running in background with ID: bbb222. Output is being written to: /tmp/w"),
            notification("aaa111", "completed"),
            line(json!({"type":"user","isMeta":true,"message":{"role":"user","content":"<system-reminder>x</system-reminder>"}})),
        ]
        .join("\n");
        assert_eq!(pending_background(&t), 1);
        // a progress note (non-final status) doesn't finish a task
        let running = format!("{t}\n{}", notification("bbb222", "running"));
        assert_eq!(pending_background(&running), 1);
    }

    #[test]
    fn activity_after_stop_is_detected() {
        assert!(has_activity(&assistant("continuing")));
        assert!(has_activity(&notification("x", "completed")));
        // bookkeeping Claude Code appends after a Stop is not activity
        assert!(!has_activity(&line(json!({"type":"system","subtype":"stop_hook_summary"}))));
        assert!(!has_activity(""));
    }

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
    fn window_names_nearest_first() {
        assert_eq!(
            window_name_candidates("/Users/p/Flo/.claude/worktrees/flo-mvp"),
            vec!["flo-mvp", "worktrees", ".claude", "Flo", "p", "Users"]
        );
        assert!(window_name_candidates("").is_empty());
    }

    #[test]
    fn focus_script_escapes_and_targets() {
        let s = hammerspoon_focus_script("/Applications/Visual Studio Code.app", &["a\"b".into(), "Flo".into()]);
        assert!(s.contains(r#"local target = "/Applications/Visual Studio Code.app""#));
        assert!(s.contains(r#"{"a\"b","Flo"}"#));
        assert!(s.contains("best:focus()"));
        assert!(!s.contains("open -a"));
    }

    #[test]
    fn session_statuses() {
        let mk = |kind: &str, msg: &str| parse_hook(&json!({"hook_event_name": kind, "message": msg, "cwd": "/a/b"}), None);
        assert_eq!(session_status(&mk("UserPromptSubmit", "")), Some(Some("working")));
        assert_eq!(session_status(&mk("Stop", "")), Some(Some("done")));
        assert_eq!(session_status(&mk("SessionEnd", "")), Some(None));
        assert_eq!(session_status(&mk("Notification", "Claude needs your permission to use Bash")), Some(Some("needs_approval")));
        assert_eq!(session_status(&mk("Notification", "Claude is waiting for your input")), Some(Some("waiting_reply")));
        assert_eq!(session_status(&mk("SubagentStop", "")), None);
    }

    #[test]
    fn open_targets() {
        assert_eq!(open_target(Some("com.microsoft.VSCode"), Some("vscode")), Some(("com.microsoft.VSCode".into(), true)));
        assert_eq!(open_target(None, Some("iTerm.app")), Some(("com.googlecode.iterm2".into(), false)));
        assert_eq!(open_target(Some(""), Some("Apple_Terminal")), Some(("com.apple.Terminal".into(), false)));
        assert_eq!(open_target(Some("bad; rm -rf"), None), None);
        assert_eq!(open_target(None, None), None);
        assert!(hook_command(1, "t").contains("bundle=${__CFBundleIdentifier:-}"));
        assert!(hook_command(1, "t").contains("&pid=$PPID"));
        assert_eq!(
            open_target(Some("/Applications/Visual Studio Code.app"), None),
            Some(("/Applications/Visual Studio Code.app".into(), true))
        );
        assert_eq!(
            open_target(Some("/System/Applications/Utilities/Terminal.app"), None),
            Some(("/System/Applications/Utilities/Terminal.app".into(), false))
        );
        assert_eq!(open_target(Some("/tmp/../evil.app"), None), None);
    }


    // ── answering from the phone: AskUserQuestion, replies, the rewake hook ──

    fn ask_input() -> Value {
        json!({"questions": [
            {"question": "Which database?", "header": "DB", "multiSelect": false, "options": [{"label": "Postgres", "description": "server"}, {"label": "SQLite", "description": "file"}]},
            {"question": "Which extras?", "header": "Extras", "multiSelect": true, "options": [{"label": "Auth"}, {"label": "Billing"}, {"label": "Search"}]}
        ]})
    }

    #[test]
    fn reads_multiple_choice_questions() {
        let q = parse_questions(&ask_input());
        assert_eq!(q.len(), 2);
        assert_eq!(q[0].question, "Which database?");
        assert_eq!(q[0].options, vec!["Postgres", "SQLite"]);
        assert!(!q[0].multi_select && q[1].multi_select);
        assert!(parse_questions(&json!({"command": "ls"})).is_empty());
    }

    #[test]
    fn choices_must_match_the_options() {
        let q = parse_questions(&ask_input());
        let a = |v: Vec<Vec<&str>>| v.into_iter().map(|x| x.into_iter().map(String::from).collect::<Vec<_>>()).collect::<Vec<_>>();
        let ok = choice_answers(&q, &a(vec![vec!["Postgres"], vec!["Auth", "Search"]])).unwrap();
        assert_eq!(ok["Which database?"], "Postgres");
        assert_eq!(ok["Which extras?"], "Auth, Search");
        assert!(choice_answers(&q, &a(vec![vec!["Postgres"]])).is_err(), "every question needs an answer");
        assert!(choice_answers(&q, &a(vec![vec!["Postgres", "SQLite"], vec!["Auth"]])).is_err(), "single choice takes one");
        assert!(choice_answers(&q, &a(vec![vec!["MySQL"], vec!["Auth"]])).is_err(), "not an option");
    }

    #[test]
    fn answers_go_back_through_updated_input() {
        let answers = choice_answers(&parse_questions(&ask_input()), &[vec!["SQLite".into()], vec!["Billing".into()]]).unwrap();
        let v: Value = serde_json::from_str(&question_reply(&ask_input(), &answers)).unwrap();
        let d = &v["hookSpecificOutput"]["decision"];
        assert_eq!(v["hookSpecificOutput"]["hookEventName"], "PermissionRequest");
        assert_eq!(d["behavior"], "allow");
        assert_eq!(d["updatedInput"]["questions"], ask_input()["questions"], "the original questions are echoed back");
        assert_eq!(d["updatedInput"]["answers"]["Which database?"], "SQLite");
        // a typed reply instead: deny with the user's words as the message
        let v: Value = serde_json::from_str(&deny_reply("use postgres, and say why")).unwrap();
        assert_eq!(v["hookSpecificOutput"]["decision"]["behavior"], "deny");
        assert!(v["hookSpecificOutput"]["decision"]["message"].as_str().unwrap().ends_with("use postgres, and say why"));
    }

    #[test]
    fn allow_from_the_notch_on_a_question_hands_it_to_the_terminal() {
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        let info = PendingPermission { id: "aq1".into(), project: "api".into(), summary: "Asks: Which database?".into(), tool: ASK_TOOL.into(), at: "2026-11-09T10:00:00+00:00".into(), expires_at: "2026-11-09T10:05:00+00:00".into(), session_id: "s-aq".into(), questions: Some(parse_questions(&ask_input())) };
        add_pending_with(info, ask_input(), tx);
        assert_eq!(pending_for_session("s-aq").map(|p| p.id), Some("aq1".into()));
        assert!(answer_permission("aq1", "allow"));
        assert_eq!(rx.recv().unwrap(), "", "Allow alone can't answer a question: Claude Code shows it instead");
        assert!(pending_for_session("s-aq").is_none());
    }

    #[test]
    fn a_question_answer_reaches_the_waiting_request() {
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        let info = PendingPermission { id: "aq2".into(), project: "api".into(), summary: "Asks".into(), tool: ASK_TOOL.into(), at: "2026-11-09T10:00:00+00:00".into(), expires_at: "2026-11-09T10:05:00+00:00".into(), session_id: "s-aq2".into(), questions: Some(parse_questions(&ask_input())) };
        add_pending_with(info, ask_input(), tx);
        let answers = choice_answers(&parse_questions(&ask_input()), &[vec!["Postgres".into()], vec!["Auth".into()]]).unwrap();
        assert!(answer_question("aq2", &answers));
        let v: Value = serde_json::from_str(&rx.recv().unwrap()).unwrap();
        assert_eq!(v["hookSpecificOutput"]["decision"]["updatedInput"]["answers"]["Which extras?"], "Auth");
        assert!(!answer_question("aq2", &answers), "only once");
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        let info = PendingPermission { id: "aq3".into(), project: "api".into(), summary: "Run: rm -rf build".into(), tool: "Bash".into(), at: "2026-11-09T10:00:00+00:00".into(), expires_at: "2026-11-09T10:02:00+00:00".into(), session_id: "s-aq3".into(), questions: None };
        add_pending_with(info, json!({"command": "rm -rf build"}), tx);
        assert!(deny_with_message("aq3", "don't delete it, move it to /tmp"));
        assert!(rx.recv().unwrap().contains("move it to /tmp"));
    }

    #[test]
    fn questions_wait_longer_than_permissions() {
        assert!(wait_secs(ASK_TOOL) > wait_secs("Bash"));
        assert_eq!(wait_secs("Bash"), PERMISSION_WAIT_SECS);
        assert!(wait_secs(ASK_TOOL) < 590, "inside the hook's curl timeout");
        assert_eq!(permission_summary(ASK_TOOL, &ask_input()), "Asks: Which database?");
    }

    #[test]
    fn rewake_hook_waits_in_the_background_and_wakes_claude_with_exit_2() {
        let cmd = reply_wait_command(47621, "tok");
        assert!(cmd.contains("/claude/reply-wait?token=tok&src=flo-flow-hook"));
        assert!(cmd.contains("&pid=$PPID"));
        assert!(cmd.contains("printf '%s\\n' \"$out\" >&2; exit 2"), "{cmd}");
        assert!(!cmd.contains("eval"), "the reply is printed, never run");
        let s = add_hooks_full(json!({}), &hook_command(47621, "tok"), None, Some(&cmd));
        let stop = s["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 2, "the notify hook and the rewake hook");
        let rw = stop.iter().find(|e| e["hooks"][0]["asyncRewake"] == true).expect("asyncRewake entry");
        assert_eq!(rw["hooks"][0]["timeout"], json!(REWAKE_HOOK_TIMEOUT_SECS));
        assert!(has_rewake(&s));
        // refresh without rewake drops it; uninstall removes everything
        let off = add_hooks_full(s.clone(), &hook_command(47621, "tok"), None, None);
        assert_eq!(off["hooks"]["Stop"].as_array().unwrap().len(), 1);
        assert!(!has_rewake(&off));
        assert!(remove_hooks(s)["hooks"].is_null());
    }

    #[test]
    fn headline_strips_markdown() {
        assert_eq!(headline("\n## Done!\nmore"), "Done!");
    }
}
