//! Replies from the paired phone to Claude Code sessions.
//!
//! The phone sends `reply` (text) and `choose` (option labels) actions for a session; this module
//! decides how the text can actually reach that session and delivers it. In order of preference:
//!
//! 1. Claude is waiting on a question or a permission prompt that Flo's PermissionRequest hook holds
//!    → answer through the hook. A choice goes back as `updatedInput.answers` (AskUserQuestion); a
//!    typed reply goes back as a deny whose message carries the user's words (claude.rs).
//! 2. The session finished its turn and is idle at the prompt → Flo's background Stop hook
//!    (`asyncRewake`, claude.rs `reply_wait_command`) is still waiting on Flo; Flo answers it with the
//!    text, the hook prints it to stderr and exits 2, and Claude Code wakes Claude with it straight
//!    away (hooks reference, "Run hooks in the background": "an asyncRewake hook that exits with
//!    code 2 wakes Claude immediately even when the session is idle").
//! 3. The session is still working → the text waits here and goes out through (2) the moment the
//!    turn ends.
//! 4. The session's process is gone (terminal closed without SessionEnd reaching Flo) → resume it
//!    headlessly: `claude --resume <id> --print <text>` in its folder. Never while its terminal is
//!    alive: that would fork the conversation behind the open terminal's back.
//!
//! Typing into the terminal window is deliberately not used: it needs the right window and tab
//! focused, steals focus from whatever you're doing, and can't be verified.
//!
//! The text only ever reaches Claude as a message: never a shell, never a command-line flag.
use crate::claude::PendingPermission;
use crate::model::ClaudeSession;
use crate::state::Shared;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::mpsc::{Receiver, Sender};
use std::sync::OnceLock;

/// The background reply hook needs `asyncRewake`. It was in Claude Code well before this version
/// (bug reports against it date from early 2026, v2.1.246 among them); older builds would run the
/// hook in the foreground and hold every Stop, so Flo only installs it from here on.
pub const MIN_REWAKE_VERSION: (u32, u32, u32) = (2, 1, 200);
/// A finished session reads as "done" for this long, then "idle".
pub const DONE_FOR_MINS: i64 = 30;
pub const EXCERPT_CHARS: usize = 400;
pub const MAX_SESSIONS: usize = 12;
pub const REPLY_CHARS: usize = 4000;

// ── versions ────────────────────────────────────────────────────────────────

/// "2.1.322 (Claude Code)" → (2, 1, 322).
pub fn parse_version(s: &str) -> Option<(u32, u32, u32)> {
    let v = s.split_whitespace().find(|w| w.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false))?;
    let mut it = v.split('.').map(|p| p.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse::<u32>().ok());
    Some((it.next()??, it.next()??, it.next().flatten().unwrap_or(0)))
}

pub fn supports_rewake(version_output: &str) -> bool {
    parse_version(version_output).map(|v| v >= MIN_REWAKE_VERSION).unwrap_or(false)
}

/// Does the installed Claude Code support the background reply hook? Asked once per run.
pub fn rewake_supported() -> bool {
    static V: OnceLock<bool> = OnceLock::new();
    *V.get_or_init(|| {
        let Some(bin) = crate::code::find_bin("claude") else { return false };
        let out = std::process::Command::new(bin).arg("--version").env("PATH", crate::code::child_path()).env_remove("CLAUDECODE").output();
        let text = out.map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
        let ok = supports_rewake(&text);
        log::info!("claude code {}: phone replies to finished sessions {}", text.trim(), if ok { "on" } else { "off (needs 2.1.200+)" });
        ok
    })
}

// ── text ────────────────────────────────────────────────────────────────────

fn looks_secret(word: &str) -> bool {
    let t = word.trim_matches(|c: char| !c.is_ascii_alphanumeric() && !"-_".contains(c));
    const PREFIXES: &[&str] = &["ghp_", "gho_", "ghu_", "ghs_", "github_pat_", "glpat-", "xoxa-", "xoxr-", "xoxs-", "sk_live_", "rk_live_", "sk_test_", "AIza", "AKIA", "ASIA", "npm_", "hf_"];
    if PREFIXES.iter().any(|p| t.starts_with(p) && t.len() >= p.len() + 12) {
        return true;
    }
    // a JWT
    if t.starts_with("eyJ") && t.matches('.').count() >= 2 && t.len() > 30 {
        return true;
    }
    // a long random-looking token: mixed case and digits (git hashes are lowercase hex: kept)
    t.len() >= 32 && t.chars().all(|c| c.is_ascii_alphanumeric() || "-_+/=".contains(c)) && t.chars().any(|c| c.is_ascii_uppercase()) && t.chars().any(|c| c.is_ascii_lowercase()) && t.chars().any(|c| c.is_ascii_digit())
}

/// Hide anything that looks like a credential (on top of hermes::redact's API-key prefixes), and
/// the value of `password=…` / `token: …` style pairs.
pub fn scrub(text: &str) -> String {
    let base = crate::hermes::redact(text);
    let words: Vec<&str> = base.split(' ').collect();
    let mut out: Vec<String> = Vec::with_capacity(words.len());
    let sensitive_key = |k: &str| {
        let k = k.to_lowercase();
        ["password", "passwd", "secret", "token", "api_key", "apikey", "api-key", "private_key", "access_key"].iter().any(|s| k.ends_with(s))
    };
    let mut hide_next = false;
    for w in words {
        if hide_next && !w.is_empty() {
            out.push("[hidden]".into());
            hide_next = false;
            continue;
        }
        if let Some((k, v)) = w.split_once('=').or_else(|| w.split_once(':').filter(|(_, v)| !v.is_empty())) {
            if sensitive_key(k.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '-')) && !v.is_empty() {
                out.push(format!("{k}=[hidden]"));
                continue;
            }
        }
        if (w.ends_with(':') || w.ends_with('=')) && sensitive_key(w.trim_end_matches([':', '='])) {
            out.push(w.to_string());
            hide_next = true;
            continue;
        }
        out.push(if looks_secret(w) { "[hidden]".into() } else { w.to_string() });
    }
    out.join(" ")
}

/// One line, secrets hidden, at most 400 characters.
pub fn excerpt(text: &str) -> String {
    let one = text.split_whitespace().collect::<Vec<_>>().join(" ");
    crate::text::truncate_chars(&scrub(&one), EXCERPT_CHARS)
}

/// What Claude reads when a reply wakes it (after Claude Code's "Stop hook feedback" prefix).
pub fn wake_message(text: &str) -> String {
    format!("The user sent this from their phone through Flo. Treat it as their next message to you and carry on:\n\n{text}")
}

/// A reply as the phone sent it: control characters dropped (newlines kept), trimmed, capped.
pub fn clean_reply(text: &str) -> String {
    let t: String = text.chars().filter(|c| !c.is_control() || *c == '\n' || *c == '\t').collect();
    let t = t.trim();
    t.chars().take(REPLY_CHARS).collect()
}

/// "/Users/p/Flo/.claude/worktrees/flo-mvp" → ("Flo", "flo-mvp"); "/x/api-server" → ("api-server", "api-server").
pub fn project_and_folder(cwd: &str, fallback: &str) -> (String, String) {
    let folder = std::path::Path::new(cwd).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_else(|| fallback.to_string());
    let project = cwd
        .split_once("/.claude/worktrees/")
        .and_then(|(root, _)| std::path::Path::new(root).file_name().map(|f| f.to_string_lossy().to_string()))
        .unwrap_or_else(|| folder.clone());
    (project, folder)
}

// ── state the phone sees ────────────────────────────────────────────────────

pub fn view_state(status: &str, updated_at: &str, pending: Option<&PendingPermission>, now: chrono::DateTime<chrono::Local>) -> &'static str {
    if let Some(p) = pending {
        return if p.tool == crate::claude::ASK_TOOL { "waiting_reply" } else { "needs_approval" };
    }
    match status {
        "working" => "working",
        "waiting_reply" => "waiting_reply",
        "needs_approval" => "needs_approval",
        "done" => {
            let recent = chrono::DateTime::parse_from_rfc3339(updated_at).map(|t| now.signed_duration_since(t).num_minutes() < DONE_FOR_MINS).unwrap_or(false);
            if recent {
                "done"
            } else {
                "idle"
            }
        }
        _ => "idle",
    }
}

/// Is the session's Claude Code process still there?
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Proc {
    Alive,
    Gone,
    Unknown,
}

/// Everything that decides how a reply reaches a session.
#[derive(Debug, Clone)]
pub struct ReplyCtx<'a> {
    pub source: &'a str,
    /// Flo's tracked status: working | done | waiting_reply | needs_approval
    pub status: &'a str,
    pub pending: Option<&'a PendingPermission>,
    /// Flo's background Stop hook is waiting for this session right now
    pub listening: bool,
    /// the background reply hook is installed (and Claude Code is new enough)
    pub rewake: bool,
    pub process: Proc,
    /// `claude` is on PATH and the session's folder exists
    pub can_resume: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Plan {
    /// answer the question / permission prompt held by Flo's hook
    Answer { id: String },
    /// the idle session is listening: wake it now
    Wake,
    /// it's working: hold the text until the turn ends
    Queue,
    /// its process is gone: resume it headlessly
    Resume,
    Refuse(&'static str),
}

pub const NOT_CLAUDE: &str = "Flo can only reply to Claude Code sessions.";
pub const ASKING_IN_TERMINAL: &str = "Claude is asking something in the terminal on your computer. Answer it there once; after that your phone can reply.";
pub const NEEDS_HOOK: &str = "Replying from your phone needs Claude Code 2.1.200 or newer and Flo's Claude Code hooks turned on. Update Claude Code, then turn the hooks off and on in Flo.";
pub const NOT_LISTENING: &str = "This session finished before Flo last started, so it isn't listening for your phone. Send it anything in its terminal once and your phone can reply after that.";
pub const CANT_RESUME: &str = "This session's terminal is closed and Flo can't find Claude Code or the session's folder to start it again.";

pub fn plan_reply(c: &ReplyCtx) -> Plan {
    if c.source != "claude" {
        return Plan::Refuse(NOT_CLAUDE);
    }
    if let Some(p) = c.pending {
        return Plan::Answer { id: p.id.clone() };
    }
    if c.listening {
        return Plan::Wake;
    }
    if c.process == Proc::Gone {
        return if c.can_resume { Plan::Resume } else { Plan::Refuse(CANT_RESUME) };
    }
    if !c.rewake {
        return Plan::Refuse(NEEDS_HOOK);
    }
    match c.status {
        "working" => Plan::Queue,
        "waiting_reply" | "needs_approval" => Plan::Refuse(ASKING_IN_TERMINAL),
        _ => Plan::Refuse(NOT_LISTENING),
    }
}

/// ("instant" | "queued" | "answer" | "resume" | "none", why not)
pub fn reply_mode(p: &Plan) -> (&'static str, Option<&'static str>) {
    match p {
        Plan::Answer { .. } => ("answer", None),
        Plan::Wake => ("instant", None),
        Plan::Queue => ("queued", None),
        Plan::Resume => ("resume", None),
        Plan::Refuse(why) => ("none", Some(why)),
    }
}

/// One session as the phone shows it.
pub fn session_view(s: &ClaudeSession, message: &str, plan: &Plan, pending: Option<&PendingPermission>, now: chrono::DateTime<chrono::Local>) -> Value {
    let (project, folder) = project_and_folder(&s.cwd, &s.project);
    let (reply, hint) = reply_mode(plan);
    let mut o = json!({
        "id": s.session_id,
        "project": project,
        "folder": folder,
        "state": view_state(&s.status, &s.updated_at, pending, now),
        "message": excerpt(message),
        "updatedAt": s.updated_at,
        "reply": reply,
    });
    if let Some(h) = hint {
        o["replyHint"] = json!(h);
    }
    if let Some(p) = pending {
        match &p.questions {
            Some(q) if !q.is_empty() => {
                let qs: Vec<Value> = q
                    .iter()
                    .take(4)
                    .map(|q| {
                        let mut v = json!({ "question": crate::text::truncate_chars(&scrub(&q.question), 300), "multiSelect": q.multi_select, "options": q.options.iter().take(8).map(|o| crate::text::truncate_chars(o, 80)).collect::<Vec<_>>() });
                        if !q.header.is_empty() {
                            v["header"] = json!(crate::text::truncate_chars(&q.header, 40));
                        }
                        v
                    })
                    .collect();
                o["question"] = json!({ "id": p.id, "questions": qs });
            }
            _ => o["approvalId"] = json!(p.id),
        }
    }
    o
}

// ── listening sessions (the background Stop hook) ────────────────────────────

struct Listener {
    tx: Sender<String>,
    /// the Claude Code process, to tell a live listener from one whose session died
    pid: Option<i32>,
    generation: u64,
}

static LISTENERS: Mutex<Option<HashMap<String, Listener>>> = Mutex::new(None);
/// replies for sessions that are still working: sent when their turn ends
static QUEUED: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
static PIDS: Mutex<Option<HashMap<String, i32>>> = Mutex::new(None);
static GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// A session's background hook checked in: it waits on the returned receiver ("" = nothing, end
/// quietly; text = wake Claude with it). Replaces (and ends) an older one for the same session. A
/// reply queued while the session worked is handed over at once.
pub fn listen(session_id: &str, pid: Option<i32>) -> (Receiver<String>, u64) {
    let (tx, rx) = std::sync::mpsc::channel();
    let generation = GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    if let Some(text) = QUEUED.lock().as_mut().and_then(|m| m.remove(session_id)) {
        let _ = tx.send(wake_message(&text));
        return (rx, generation);
    }
    if let Some(old) = LISTENERS.lock().get_or_insert_with(Default::default).insert(session_id.to_string(), Listener { tx, pid, generation }) {
        let _ = old.tx.send(String::new());
    }
    (rx, generation)
}

/// The hook's wait ended (answered or timed out): forget it, unless a newer one replaced it.
pub fn forget(session_id: &str, generation: u64) {
    let mut g = LISTENERS.lock();
    if let Some(m) = g.as_mut() {
        if m.get(session_id).map(|l| l.generation == generation).unwrap_or(false) {
            m.remove(session_id);
        }
    }
}

/// You typed in the terminal, or the session ended: its hook stops waiting, queued text is dropped.
pub fn release(session_id: &str) {
    if let Some(l) = LISTENERS.lock().as_mut().and_then(|m| m.remove(session_id)) {
        let _ = l.tx.send(String::new());
    }
    QUEUED.lock().as_mut().map(|m| m.remove(session_id));
}

pub fn is_listening(session_id: &str) -> bool {
    let pid = match LISTENERS.lock().as_ref().and_then(|m| m.get(session_id)) {
        Some(l) => l.pid,
        None => return false,
    };
    // a hook whose Claude Code exited (e.g. a `claude -p` run) can't deliver anything
    pid.map(|p| process_state(p) != Proc::Gone).unwrap_or(true)
}

fn wake(session_id: &str, text: &str) -> bool {
    match LISTENERS.lock().as_mut().and_then(|m| m.remove(session_id)) {
        Some(l) => l.tx.send(wake_message(text)).is_ok(),
        None => false,
    }
}

fn queue(session_id: &str, text: &str) {
    let mut g = QUEUED.lock();
    let m = g.get_or_insert_with(Default::default);
    let joined = match m.get(session_id) {
        Some(prev) => format!("{prev}\n\n{text}"),
        None => text.to_string(),
    };
    m.insert(session_id.to_string(), joined.chars().take(REPLY_CHARS * 2).collect());
}

#[cfg(test)]
pub fn is_queued(session_id: &str) -> bool {
    QUEUED.lock().as_ref().map(|m| m.contains_key(session_id)).unwrap_or(false)
}

/// Every hook call reports its Claude Code process id ($PPID).
pub fn note_pid(session_id: &str, pid: i32) {
    if !session_id.is_empty() && pid > 1 {
        PIDS.lock().get_or_insert_with(Default::default).insert(session_id.to_string(), pid);
    }
}

pub fn process_of(session_id: &str) -> Proc {
    match PIDS.lock().as_ref().and_then(|m| m.get(session_id).copied()) {
        Some(pid) => process_state(pid),
        None => Proc::Unknown,
    }
}

/// Alive if the pid is still a Claude Code (or node) process; a reused pid counts as gone.
pub fn process_state(pid: i32) -> Proc {
    if !cfg!(unix) {
        return Proc::Unknown;
    }
    match std::process::Command::new("/bin/ps").args(["-p", &pid.to_string(), "-o", "comm="]).output() {
        Ok(o) => {
            let comm = String::from_utf8_lossy(&o.stdout).to_lowercase();
            if comm.trim().is_empty() {
                Proc::Gone
            } else if comm.contains("claude") || comm.contains("node") {
                Proc::Alive
            } else {
                Proc::Gone
            }
        }
        Err(_) => Proc::Unknown,
    }
}

/// The Stop hook's `/claude/reply-wait` call: hold it open on its own thread until the phone sends
/// something, a newer hook replaces it, you type in the terminal, or time runs out.
pub fn serve_wait(req: tiny_http::Request, body: &Value, pid: Option<i32>) {
    let session_id = body["session_id"].as_str().unwrap_or("").to_string();
    if !crate::autocontinue::valid_session_id(&session_id) {
        let _ = req.respond(tiny_http::Response::from_string(""));
        return;
    }
    if let Some(p) = pid {
        note_pid(&session_id, p);
    }
    let (rx, generation) = listen(&session_id, pid);
    crate::phone_state::poke();
    std::thread::spawn(move || {
        let text = rx.recv_timeout(std::time::Duration::from_secs(crate::claude::REWAKE_WAIT_SECS)).unwrap_or_default();
        forget(&session_id, generation);
        if !text.is_empty() {
            log::info!("claude reply: woke session {session_id} with a reply from the phone");
        }
        let _ = req.respond(tiny_http::Response::from_string(text));
        crate::phone_state::poke();
    });
}

// ── applying phone actions ──────────────────────────────────────────────────

fn rewake_on() -> bool {
    crate::claude::rewake_installed()
}

fn ctx_for<'a>(s: &'a ClaudeSession, pending: Option<&'a PendingPermission>) -> ReplyCtx<'a> {
    let listening = is_listening(&s.session_id);
    // only ask the OS when it matters (no hook to answer, nobody listening)
    let process = if pending.is_none() && !listening { process_of(&s.session_id) } else { Proc::Unknown };
    ReplyCtx {
        source: if s.source.is_empty() { "claude" } else { s.source.as_str() },
        status: &s.status,
        pending,
        listening,
        rewake: rewake_on(),
        process,
        // only matters (and only looked up) when the session's process is gone
        can_resume: process == Proc::Gone && !s.cwd.is_empty() && std::path::Path::new(&s.cwd).is_dir() && crate::code::find_bin("claude").is_some(),
    }
}

fn find_session(st: &Shared, id: &str) -> Option<ClaudeSession> {
    st.db.list_claude_sessions().unwrap_or_default().into_iter().find(|s| s.session_id == id)
}

fn name_of(s: &ClaudeSession) -> String {
    crate::text::truncate_chars(&project_and_folder(&s.cwd, &s.project).1, 60)
}

/// `reply` from the phone → (ok, message for the phone).
pub fn deliver_reply(st: &Shared, session_id: &str, text: &str) -> (bool, String) {
    let text = clean_reply(text);
    if text.is_empty() {
        return (false, "There was nothing to send.".into());
    }
    let Some(s) = find_session(st, session_id) else {
        return (false, "That session is gone from your computer.".into());
    };
    let name = name_of(&s);
    let pending = crate::claude::pending_for_session(session_id);
    match plan_reply(&ctx_for(&s, pending.as_ref())) {
        Plan::Answer { id } => {
            if crate::claude::deny_with_message(&id, &text) {
                (true, format!("Sent to {name}."))
            } else {
                (false, "That question already closed on your computer. Try again.".into())
            }
        }
        Plan::Wake => {
            if wake(session_id, &text) {
                (true, format!("Sent to {name}. Claude is on it."))
            } else {
                (false, format!("{name} stopped listening just now. Try again."))
            }
        }
        Plan::Queue => {
            queue(session_id, &text);
            crate::phone_state::poke();
            (true, format!("Queued for {name}. Claude gets it when it finishes what it's doing."))
        }
        Plan::Resume => match resume(st, &s, &text) {
            Ok(()) => (true, format!("Sent to {name}. Its terminal was closed, so Flo started it again in the background.")),
            Err(e) => (false, crate::text::truncate_chars(&format!("Couldn't start {name} again: {e}"), 280)),
        },
        Plan::Refuse(why) => (false, why.to_string()),
    }
}

/// `choose` from the phone: {id?, answers: [[label, ...], ...]} → (ok, message).
pub fn deliver_choice(st: &Shared, session_id: &str, value: &Value) -> (bool, String) {
    let Some(p) = crate::claude::pending_for_session(session_id).filter(|p| p.questions.as_ref().map(|q| !q.is_empty()).unwrap_or(false)) else {
        return (false, "That question already closed on your computer.".into());
    };
    if let Some(want) = value["id"].as_str() {
        if want != p.id {
            return (false, "Claude asked something new. Look again and pick.".into());
        }
    }
    let picks: Vec<Vec<String>> = value["answers"]
        .as_array()
        .map(|a| a.iter().map(|x| x.as_array().map(|l| l.iter().filter_map(|s| s.as_str().map(|s| s.trim().to_string())).collect()).unwrap_or_default()).collect())
        .unwrap_or_default();
    let answers = match crate::claude::choice_answers(p.questions.as_deref().unwrap_or(&[]), &picks) {
        Ok(a) => a,
        Err(why) => return (false, why),
    };
    let name = find_session(st, session_id).map(|s| name_of(&s)).unwrap_or_else(|| p.project.clone());
    if crate::claude::answer_question(&p.id, &answers) {
        let chosen = picks.iter().map(|l| l.join(", ")).collect::<Vec<_>>().join("; ");
        (true, crate::text::truncate_chars(&format!("Answered {name}: {chosen}"), 280))
    } else {
        (false, "That question already closed on your computer.".into())
    }
}

/// Resume a session whose process is gone, headlessly, with the reply as the prompt. No
/// permission-bypass flags: anything needing permission goes through the normal rules (and Flo's
/// PermissionRequest hook, so the phone can answer).
fn resume(st: &Shared, s: &ClaudeSession, text: &str) -> anyhow::Result<()> {
    if !crate::autocontinue::valid_session_id(&s.session_id) {
        anyhow::bail!("that isn't a Claude Code session id");
    }
    let bin = crate::code::find_bin("claude").ok_or_else(|| anyhow::anyhow!("Claude Code isn't installed (no `claude` on PATH)"))?;
    let prompt = crate::code::clean_prompt(text); // never starts with '-', so it can't read as a flag
    let mut child = std::process::Command::new(bin)
        .args(["--resume", &s.session_id, "--print", &prompt])
        .current_dir(&s.cwd)
        .env("PATH", crate::code::child_path())
        .env_remove("CLAUDECODE")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()?;
    let sid = s.session_id.clone();
    let st = st.clone();
    std::thread::spawn(move || {
        let mut err = String::new();
        if let Some(mut e) = child.stderr.take() {
            use std::io::Read;
            let _ = (&mut e).take(8 * 1024).read_to_string(&mut err);
        }
        let status = child.wait();
        log::info!("claude reply: headless resume of {sid} ended ({:?}) {}", status.map(|s| s.code()), crate::text::truncate_chars(err.trim(), 200));
        crate::claude::emit_sessions(&st);
    });
    Ok(())
}

// ── the snapshot's session list ─────────────────────────────────────────────

/// Last assistant message per transcript, cached by file size (transcripts only grow).
static EXCERPTS: Mutex<Option<HashMap<String, (u64, String)>>> = Mutex::new(None);

fn last_message(s: &ClaudeSession) -> String {
    let fallback = || s.message.clone();
    let Some(path) = s.transcript_path.as_deref() else { return fallback() };
    let Ok(meta) = std::fs::metadata(path) else { return fallback() };
    if let Some((len, text)) = EXCERPTS.lock().as_ref().and_then(|m| m.get(path).cloned()) {
        if len == meta.len() {
            return text;
        }
    }
    let text = crate::claude::recent_transcript(path).and_then(|t| crate::claude::last_assistant_text(&t)).unwrap_or_else(fallback);
    let text = crate::text::truncate_chars(&text, EXCERPT_CHARS * 3);
    let mut g = EXCERPTS.lock();
    let m = g.get_or_insert_with(Default::default);
    if m.len() > 64 {
        m.clear();
    }
    m.insert(path.to_string(), (meta.len(), text.clone()));
    text
}

/// Every Claude Code session Flo tracks, newest first, as the phone shows them.
pub fn session_views(sessions: &[ClaudeSession], now: chrono::DateTime<chrono::Local>) -> Vec<Value> {
    sessions
        .iter()
        .filter(|s| s.source.is_empty() || s.source == "claude")
        .take(MAX_SESSIONS)
        .map(|s| {
            let pending = crate::claude::pending_for_session(&s.session_id);
            let plan = plan_reply(&ctx_for(s, pending.as_ref()));
            session_view(s, &last_message(s), &plan, pending.as_ref(), now)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::claude::{Question, ASK_TOOL};

    fn now() -> chrono::DateTime<chrono::Local> {
        chrono::DateTime::parse_from_rfc3339("2026-11-10T12:00:00+00:00").unwrap().with_timezone(&chrono::Local)
    }

    fn pending(tool: &str, session: &str) -> PendingPermission {
        PendingPermission {
            id: format!("p-{session}"),
            project: "api".into(),
            summary: "x".into(),
            tool: tool.into(),
            at: "2026-11-10T11:59:00+00:00".into(),
            expires_at: "2026-11-10T12:04:00+00:00".into(),
            session_id: session.into(),
            questions: (tool == ASK_TOOL).then(|| vec![Question { question: "Which database?".into(), header: "DB".into(), multi_select: false, options: vec!["Postgres".into(), "SQLite".into()] }]),
        }
    }

    fn sess(status: &str, updated: &str) -> ClaudeSession {
        ClaudeSession { session_id: "0b9f6a52-3c1e-4d7a-9e55-1f2a3b4c5d6e".into(), project: "api-server".into(), cwd: "/Users/p/code/api-server".into(), status: status.into(), message: "Finished".into(), updated_at: updated.into(), app_bundle: None, terminal: None, transcript_path: None, source: "claude".into() }
    }

    fn ctx<'a>(status: &'a str, pending: Option<&'a PendingPermission>) -> ReplyCtx<'a> {
        ReplyCtx { source: "claude", status, pending, listening: false, rewake: true, process: Proc::Alive, can_resume: true }
    }

    #[test]
    fn versions() {
        assert_eq!(parse_version("2.1.322 (Claude Code)"), Some((2, 1, 322)));
        assert_eq!(parse_version("claude 2.0.5"), Some((2, 0, 5)));
        assert!(supports_rewake("2.1.322 (Claude Code)"));
        assert!(supports_rewake("2.1.200 (Claude Code)"));
        assert!(!supports_rewake("2.1.199 (Claude Code)"));
        assert!(!supports_rewake("1.0.88 (Claude Code)"));
        assert!(!supports_rewake(""));
    }

    #[test]
    fn plans_follow_the_most_reliable_path() {
        let q = pending(ASK_TOOL, "s");
        // a question held by the hook beats everything
        assert_eq!(plan_reply(&ReplyCtx { listening: true, ..ctx("waiting_reply", Some(&q)) }), Plan::Answer { id: "p-s".into() });
        // idle and listening → wake now
        assert_eq!(plan_reply(&ReplyCtx { listening: true, ..ctx("done", None) }), Plan::Wake);
        // working → queue for the end of the turn
        assert_eq!(plan_reply(&ctx("working", None)), Plan::Queue);
        // terminal gone → resume headlessly; never while it's alive
        assert_eq!(plan_reply(&ReplyCtx { process: Proc::Gone, ..ctx("done", None) }), Plan::Resume);
        assert_eq!(plan_reply(&ReplyCtx { process: Proc::Gone, can_resume: false, ..ctx("done", None) }), Plan::Refuse(CANT_RESUME));
        assert_eq!(plan_reply(&ctx("done", None)), Plan::Refuse(NOT_LISTENING));
        assert_eq!(plan_reply(&ReplyCtx { process: Proc::Unknown, ..ctx("done", None) }), Plan::Refuse(NOT_LISTENING), "unknown is not gone");
        // asking in the terminal (question timed out back to it)
        assert_eq!(plan_reply(&ctx("waiting_reply", None)), Plan::Refuse(ASKING_IN_TERMINAL));
        // no rewake hook: only questions and closed sessions are reachable
        assert_eq!(plan_reply(&ReplyCtx { rewake: false, ..ctx("working", None) }), Plan::Refuse(NEEDS_HOOK));
        assert_eq!(plan_reply(&ReplyCtx { rewake: false, ..ctx("working", Some(&q)) }), Plan::Answer { id: "p-s".into() });
        // other agents (Codex, Cursor) can't be replied to
        assert_eq!(plan_reply(&ReplyCtx { source: "codex", ..ctx("done", None) }), Plan::Refuse(NOT_CLAUDE));
    }

    #[test]
    fn states_for_the_phone() {
        let q = pending(ASK_TOOL, "s");
        let b = pending("Bash", "s");
        assert_eq!(view_state("working", "", Some(&q), now()), "waiting_reply");
        assert_eq!(view_state("working", "", Some(&b), now()), "needs_approval");
        assert_eq!(view_state("working", "", None, now()), "working");
        assert_eq!(view_state("done", "2026-11-10T11:45:00+00:00", None, now()), "done");
        assert_eq!(view_state("done", "2026-11-10T11:00:00+00:00", None, now()), "idle", "older than 30 minutes");
        assert_eq!(view_state("needs_approval", "", None, now()), "needs_approval");
        assert_eq!(view_state("weird", "", None, now()), "idle");
    }

    #[test]
    fn session_view_carries_question_options_or_the_approval() {
        let q = pending(ASK_TOOL, "s");
        let v = session_view(&sess("working", "2026-11-10T11:59:00+00:00"), "Which database should I use?", &Plan::Answer { id: q.id.clone() }, Some(&q), now());
        assert_eq!(v["state"], "waiting_reply");
        assert_eq!(v["reply"], "answer");
        assert_eq!(v["question"]["id"], "p-s");
        assert_eq!(v["question"]["questions"][0]["options"], json!(["Postgres", "SQLite"]));
        assert_eq!(v["project"], "api-server");
        assert!(v.get("approvalId").is_none());
        let b = pending("Bash", "s");
        let v = session_view(&sess("working", "2026-11-10T11:59:00+00:00"), "", &Plan::Answer { id: b.id.clone() }, Some(&b), now());
        assert_eq!(v["state"], "needs_approval");
        assert_eq!(v["approvalId"], "p-s");
        let v = session_view(&sess("done", "2026-11-10T09:00:00+00:00"), "x", &Plan::Refuse(NOT_LISTENING), None, now());
        assert_eq!(v["state"], "idle");
        assert_eq!(v["reply"], "none");
        assert_eq!(v["replyHint"], NOT_LISTENING);
    }

    #[test]
    fn excerpts_are_short_single_line_and_scrubbed() {
        let long = format!("Done.\n\nSet OPENAI_API_KEY=sk-abcdefghijklmnop1234 and token: abcDEF1234567890abcdef1234567890XYZ. {}", "word ".repeat(200));
        let e = excerpt(&long);
        assert!(e.chars().count() <= EXCERPT_CHARS);
        assert!(!e.contains('\n'));
        assert!(!e.contains("sk-abcdefghijklmnop1234"), "{e}");
        assert!(!e.contains("abcDEF1234567890abcdef1234567890XYZ"), "{e}");
        assert!(e.starts_with("Done. Set OPENAI_API_KEY=[hidden]"), "{e}");
        // common token shapes
        for secret in ["ghp_0123456789abcdefABCDEF0123456789abcd", "AKIAIOSFODNN7EXAMPLE1", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abc123def456", "xoxb-123456789012-abcdefghijkl"] {
            assert!(!scrub(&format!("use {secret} now")).contains(secret), "{secret}");
        }
        // ordinary text and git hashes survive
        assert_eq!(scrub("Fixed the bug in 3f2598a0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6 and pushed"), "Fixed the bug in 3f2598a0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6 and pushed");
        assert_eq!(scrub("password: hunter2 is weak"), "password: [hidden] is weak");
    }

    #[test]
    fn project_names() {
        assert_eq!(project_and_folder("/Users/p/Flo/.claude/worktrees/flo-mvp", "x"), ("Flo".into(), "flo-mvp".into()));
        assert_eq!(project_and_folder("/Users/p/code/api-server", "x"), ("api-server".into(), "api-server".into()));
        assert_eq!(project_and_folder("", "Claude"), ("Claude".into(), "Claude".into()));
    }

    #[test]
    fn replies_are_cleaned_and_capped() {
        assert_eq!(clean_reply("  use postgres\n\tplease\u{7}  "), "use postgres\n\tplease");
        assert_eq!(clean_reply(&"x".repeat(5000)).chars().count(), REPLY_CHARS);
        assert!(wake_message("hi").ends_with("\n\nhi"));
    }

    #[test]
    fn a_listening_session_gets_the_reply_once() {
        let sid = "listen-test-1";
        let (rx, _) = listen(sid, None);
        assert!(is_listening(sid));
        assert!(wake(sid, "add tests"));
        assert_eq!(rx.recv().unwrap(), wake_message("add tests"));
        assert!(!is_listening(sid), "one reply per wait");
        assert!(!wake(sid, "again"));
    }

    #[test]
    fn a_newer_hook_replaces_the_old_one_and_typing_releases_it() {
        let sid = "listen-test-2";
        let (old, g1) = listen(sid, None);
        let (new, g2) = listen(sid, None);
        assert_eq!(old.recv().unwrap(), "", "the old wait ends quietly");
        forget(sid, g1); // the old thread finishing must not drop the new listener
        assert!(is_listening(sid));
        release(sid);
        assert_eq!(new.recv().unwrap(), "");
        assert!(!is_listening(sid));
        forget(sid, g2);
    }

    #[test]
    fn queued_replies_go_out_when_the_turn_ends() {
        let sid = "listen-test-3";
        queue(sid, "then run the tests");
        queue(sid, "and commit");
        assert!(is_queued(sid));
        let (rx, _) = listen(sid, None);
        assert_eq!(rx.recv().unwrap(), wake_message("then run the tests\n\nand commit"));
        assert!(!is_queued(sid));
        assert!(!is_listening(sid), "handed over at once, nothing left waiting");
        // typing in the terminal drops anything queued
        queue(sid, "stale");
        release(sid);
        assert!(!is_queued(sid));
    }

    #[test]
    fn dead_processes_are_gone() {
        // pid 1 is launchd/init, never Claude Code
        assert_eq!(process_state(1), if cfg!(unix) { Proc::Gone } else { Proc::Unknown });
        assert_eq!(process_state(999_999), if cfg!(unix) { Proc::Gone } else { Proc::Unknown });
    }
}
