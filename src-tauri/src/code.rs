//! Projects → Code: link a GitHub repo (clone) or a local folder to a project, and hand work to
//! the user's own coding agent CLI (Claude Code, Codex, Gemini CLI).
//!
//! Flo never sees provider credentials: agents run with whatever account the user signed into in
//! the provider's own CLI. Sign-in detection only checks that config files exist (plus clearly
//! non-secret metadata such as the account email) and never reads token values.
//!
//! Every external command is spawned with an argument vector (no shell), except the one string
//! typed into Terminal.app, which is built with `sh_quote` + `applescript_str` (unit-tested).
use crate::model::{ev, Project};
use crate::state::Shared;
use anyhow::{anyhow, bail, Context, Result};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

/// clone progress: `CloneProgress`
pub const EV_CLONE: &str = "flo://code-clone";
/// background run output / status: `RunEvent`
pub const EV_RUN: &str = "flo://code-run";

pub const GIT_MISSING: &str = "Git isn't installed on this Mac. Install Xcode Command Line Tools: xcode-select --install";

type R<T> = Result<T, String>;
fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

// ── data ───────────────────────────────────────────────────────────────────
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoRef {
    pub owner: String,
    pub repo: String,
    /// what `git clone` gets (https …​.git or the ssh form)
    pub clone_url: String,
    /// what Flo stores / shows (https://github.com/owner/repo, or the ssh form)
    pub display_url: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub hash: String,
    pub subject: String,
    pub author: String,
    pub at: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
    pub exists: bool,
    pub is_git: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_commit: Option<Commit>,
    /// files with uncommitted changes
    pub changed: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodeRun {
    pub id: String,
    pub project_id: String,
    pub prompt: String,
    pub agent: String,
    /// terminal | background
    pub mode: String,
    /// launched (terminal) | running | done | failed | stopped | interrupted
    pub status: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneProgress {
    pub project_id: String,
    pub phase: String,
    /// overall 0–100
    pub percent: u8,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEvent {
    pub run_id: String,
    pub project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

// ── GitHub URL ─────────────────────────────────────────────────────────────
fn valid_owner(s: &str) -> bool {
    !s.is_empty() && s.len() <= 39 && !s.starts_with('-') && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn valid_repo(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && s != "."
        && s != ".."
        && !s.starts_with('-')
        && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// `https://github.com/owner/repo(.git)` or `git@github.com:owner/repo.git` → owner / repo.
pub fn parse_github_url(input: &str) -> Result<RepoRef> {
    let s = input.trim();
    let bad = || anyhow!("Paste a GitHub repository URL, like https://github.com/owner/repo");
    let (rest, ssh) = if let Some(r) = s.strip_prefix("https://github.com/").or_else(|| s.strip_prefix("https://www.github.com/")) {
        (r, false)
    } else if let Some(r) = s.strip_prefix("git@github.com:") {
        (r, true)
    } else {
        return Err(bad());
    };
    let rest = rest.trim_end_matches('/');
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let mut parts = rest.split('/');
    let (owner, repo) = match (parts.next(), parts.next(), parts.next()) {
        (Some(o), Some(r), None) => (o, r),
        _ => return Err(bad()),
    };
    if !valid_owner(owner) || !valid_repo(repo) {
        return Err(bad());
    }
    let (clone_url, display_url) = if ssh {
        let u = format!("git@github.com:{owner}/{repo}.git");
        (u.clone(), u)
    } else {
        (format!("https://github.com/{owner}/{repo}.git"), format!("https://github.com/{owner}/{repo}"))
    };
    Ok(RepoRef { owner: owner.into(), repo: repo.into(), clone_url, display_url })
}

// ── quoting ────────────────────────────────────────────────────────────────
/// POSIX single-quote a word for sh / bash / zsh: everything inside '' is literal
/// (`$`, backticks, `"`, `\`, newlines); a `'` becomes `'\''`.
pub fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// An AppleScript string literal (with the surrounding quotes).
pub fn applescript_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Keep a prompt printable: drop control characters (newlines and tabs stay), cap the length, and
/// make sure it can't be read as a CLI flag.
pub fn clean_prompt(s: &str) -> String {
    let mut t: String = s.chars().filter(|c| !c.is_control() || *c == '\n' || *c == '\t').collect();
    t = t.trim().to_string();
    if t.chars().count() > 20_000 {
        t = t.chars().take(20_000).collect();
    }
    if t.starts_with('-') {
        t = format!("Task: {t}");
    }
    t
}

/// `cd '<dir>' && '<bin>' '<arg>' …` — the line Terminal runs.
pub fn terminal_command(dir: Option<&str>, bin: &str, args: &[String]) -> String {
    let mut cmd = String::new();
    if let Some(d) = dir {
        cmd.push_str("cd ");
        cmd.push_str(&sh_quote(d));
        cmd.push_str(" && ");
    }
    cmd.push_str(&sh_quote(bin));
    for a in args {
        cmd.push(' ');
        cmd.push_str(&sh_quote(a));
    }
    cmd
}

/// AppleScript lines that open a new Terminal window running `cmd`.
pub fn terminal_script(cmd: &str) -> Vec<String> {
    vec![
        "tell application \"Terminal\"".into(),
        "activate".into(),
        format!("do script {}", applescript_str(cmd)),
        "end tell".into(),
    ]
}

fn open_terminal(cmd: &str) -> Result<()> {
    if !cfg!(target_os = "macos") {
        bail!("Opening a terminal is only supported on macOS for now");
    }
    let mut c = std::process::Command::new("osascript");
    for line in terminal_script(cmd) {
        c.arg("-e").arg(line);
    }
    let out = c.output().context("couldn't run osascript")?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        if err.contains("-1743") || err.contains("Not authorized") {
            bail!("Flo needs permission to control Terminal: System Settings → Privacy & Security → Automation → Flo → Terminal");
        }
        bail!("Couldn't open Terminal: {}", err.trim());
    }
    Ok(())
}

// ── finding CLIs (Finder-launched apps get a bare PATH) ─────────────────────
fn search_dirs() -> Vec<PathBuf> {
    let home = dirs::home_dir().unwrap_or_default();
    let mut dirs: Vec<PathBuf> = crate::mcp::server_path().split(':').filter(|p| !p.is_empty()).map(PathBuf::from).collect();
    for d in [".claude/local", ".npm-global/bin", ".volta/bin", "Library/pnpm", ".local/share/pnpm", ".asdf/shims", ".local/share/mise/shims", ".yarn/bin"] {
        dirs.push(home.join(d));
    }
    dirs.push(PathBuf::from("/opt/homebrew/opt/node/bin"));
    // nvm: newest node first
    if let Ok(rd) = std::fs::read_dir(home.join(".nvm/versions/node")) {
        let mut v: Vec<PathBuf> = rd.filter_map(|e| e.ok()).map(|e| e.path().join("bin")).collect();
        v.sort();
        v.reverse();
        dirs.extend(v);
    }
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|d| seen.insert(d.clone()));
    dirs
}

/// PATH for child processes (agents need `node`, `git` etc.).
pub fn child_path() -> String {
    search_dirs().iter().map(|d| d.to_string_lossy().to_string()).collect::<Vec<_>>().join(":")
}

fn is_executable(p: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        p.metadata().map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        p.is_file()
    }
}

pub fn find_bin(name: &str) -> Option<PathBuf> {
    search_dirs().into_iter().map(|d| d.join(name)).find(|p| is_executable(p))
}

fn git() -> Result<PathBuf> {
    let g = find_bin("git").ok_or_else(|| anyhow!(GIT_MISSING))?;
    // /usr/bin/git is a stub until the Command Line Tools are installed
    if g == Path::new("/usr/bin/git") && cfg!(target_os = "macos") {
        let ok = std::process::Command::new("xcode-select").arg("-p").output().map(|o| o.status.success()).unwrap_or(false);
        if !ok {
            bail!(GIT_MISSING);
        }
    }
    Ok(g)
}

fn git_cmd(dir: &Path) -> Result<std::process::Command> {
    let mut c = std::process::Command::new(git()?);
    c.arg("-C").arg(dir).env("PATH", child_path()).env("GIT_OPTIONAL_LOCKS", "0").env("GIT_TERMINAL_PROMPT", "0").stdin(Stdio::null());
    Ok(c)
}

fn git_out(dir: &Path, args: &[&str]) -> Option<String> {
    let out = git_cmd(dir).ok()?.args(args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim_end().to_string())
}

// ── paths ──────────────────────────────────────────────────────────────────
fn abs_dir(p: &str) -> Result<PathBuf> {
    let p = PathBuf::from(p.trim());
    if !p.is_absolute() {
        bail!("Pick a folder (the path must be absolute)");
    }
    if p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        bail!("That folder path isn't valid");
    }
    if !p.is_dir() {
        bail!("That folder doesn't exist: {}", p.display());
    }
    Ok(p)
}

fn dir_is_empty(p: &Path) -> bool {
    std::fs::read_dir(p).map(|mut r| r.next().is_none()).unwrap_or(false)
}

// ── repo status ────────────────────────────────────────────────────────────
pub fn repo_info_at(path: &Path) -> RepoInfo {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.display().to_string());
    let mut info = RepoInfo { path: path.display().to_string(), name, exists: path.is_dir(), ..Default::default() };
    if !info.exists {
        return info;
    }
    info.is_git = git_out(path, &["rev-parse", "--is-inside-work-tree"]).as_deref() == Some("true");
    if !info.is_git {
        return info;
    }
    info.branch = git_out(path, &["symbolic-ref", "--short", "-q", "HEAD"])
        .filter(|s| !s.is_empty())
        .or_else(|| git_out(path, &["rev-parse", "--short", "HEAD"]).map(|h| format!("detached at {h}")));
    info.remote = git_out(path, &["remote", "get-url", "origin"]).filter(|s| !s.is_empty()).map(|u| strip_credentials(&u));
    info.last_commit = git_out(path, &["log", "-1", "--format=%h%x1f%s%x1f%an%x1f%cI"]).and_then(|s| parse_commit(&s));
    info.changed = git_out(path, &["status", "--porcelain"]).map(|s| s.lines().filter(|l| !l.trim().is_empty()).count() as u32).unwrap_or(0);
    info
}

pub fn parse_commit(s: &str) -> Option<Commit> {
    let mut it = s.trim().split('\u{1f}');
    let (hash, subject, author, at) = (it.next()?, it.next()?, it.next()?, it.next()?);
    if hash.is_empty() {
        return None;
    }
    Some(Commit { hash: hash.into(), subject: subject.into(), author: author.into(), at: at.into() })
}

/// `https://user:token@github.com/…` → `https://github.com/…` (never show a token from a remote URL).
pub fn strip_credentials(u: &str) -> String {
    if let Some(rest) = u.strip_prefix("https://").or_else(|| u.strip_prefix("http://")) {
        let scheme = if u.starts_with("https://") { "https://" } else { "http://" };
        let (auth_host, path) = rest.split_once('/').unwrap_or((rest, ""));
        if let Some((_, host)) = auth_host.rsplit_once('@') {
            return format!("{scheme}{host}/{path}").trim_end_matches('/').to_string();
        }
    }
    u.to_string()
}

// ── clone ──────────────────────────────────────────────────────────────────
/// `Receiving objects:  45% (450/1000), 1.2 MiB | 2 MiB/s` → ("Receiving objects", overall %).
pub fn parse_progress(line: &str) -> Option<(String, u8)> {
    let line = line.trim().trim_start_matches("remote:").trim();
    let (phase, rest) = line.split_once(':')?;
    let pct: u32 = rest.trim().split('%').next()?.trim().parse().ok()?;
    let pct = pct.min(100);
    let (lo, hi) = match phase.trim() {
        "Enumerating objects" => (0, 2),
        "Counting objects" => (2, 5),
        "Compressing objects" => (5, 10),
        "Receiving objects" => (10, 85),
        "Resolving deltas" => (85, 97),
        "Updating files" => (97, 100),
        _ => return None,
    };
    Some((phase.trim().to_string(), (lo + (hi - lo) * pct / 100) as u8))
}

/// A readable message from git's stderr.
pub fn clone_error_message(stderr: &str) -> String {
    let s = stderr.to_lowercase();
    if s.contains("xcrun: error") || s.contains("invalid active developer path") || s.contains("no developer tools") {
        return GIT_MISSING.into();
    }
    if s.contains("already exists and is not an empty directory") {
        return "That folder already has a non-empty folder with this repo's name. Pick another folder, or use “Use an existing folder”.".into();
    }
    if s.contains("could not read username")
        || s.contains("authentication failed")
        || s.contains("repository not found")
        || s.contains("permission denied (publickey)")
        || s.contains("host key verification failed")
        || s.contains("terminal prompts disabled")
    {
        return "GitHub didn't let git read this repo. If it's private, sign in to GitHub for git first (run `gh auth login`, or set up an SSH key), then try again. Also check the URL.".into();
    }
    if s.contains("could not resolve host") || s.contains("unable to access") && s.contains("resolve") {
        return "Couldn't reach GitHub. Check your internet connection.".into();
    }
    let last = stderr.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("git clone failed").trim();
    format!("Clone failed: {}", last.trim_start_matches("fatal: "))
}

/// Clone `url` into `<parent>/<repo>`, calling `progress` as git reports it.
pub async fn clone_into(url: &str, parent: &str, mut progress: impl FnMut(String, u8, String)) -> Result<PathBuf> {
    let r = parse_github_url(url)?;
    let parent = abs_dir(parent)?;
    let target = parent.join(&r.repo);
    if target.exists() {
        if !target.is_dir() {
            bail!("A file named “{}” is already in that folder. Pick another folder.", r.repo);
        }
        if !dir_is_empty(&target) {
            bail!("“{}” already exists in that folder and isn't empty. Pick another folder, or use “Use an existing folder” to link it.", r.repo);
        }
    }
    let git = git()?;
    let mut child = tokio::process::Command::new(git)
        .args(["clone", "--progress", "--"])
        .arg(&r.clone_url)
        .arg(&target)
        .env("PATH", child_path())
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|err| if err.kind() == std::io::ErrorKind::NotFound { anyhow!(GIT_MISSING) } else { anyhow!("couldn't start git: {err}") })?;
    let mut stderr = child.stderr.take().ok_or_else(|| anyhow!("no stderr"))?;
    let mut tail: Vec<String> = Vec::new();
    let mut buf = [0u8; 4096];
    let mut cur = Vec::new();
    progress("Starting".into(), 0, format!("Cloning {}/{}…", r.owner, r.repo));
    loop {
        let n = stderr.read(&mut buf).await.unwrap_or(0);
        if n == 0 {
            break;
        }
        for &b in &buf[..n] {
            if b == b'\r' || b == b'\n' {
                let line = String::from_utf8_lossy(&cur).trim().to_string();
                cur.clear();
                if line.is_empty() {
                    continue;
                }
                if let Some((phase, pct)) = parse_progress(&line) {
                    progress(phase, pct, line.clone());
                } else {
                    tail.push(line);
                    if tail.len() > 40 {
                        tail.remove(0);
                    }
                }
            } else {
                cur.push(b);
            }
        }
    }
    if !cur.is_empty() {
        tail.push(String::from_utf8_lossy(&cur).trim().to_string());
    }
    let status = child.wait().await.context("git clone didn't finish")?;
    if !status.success() {
        bail!(clone_error_message(&tail.join("\n")));
    }
    progress("Done".into(), 100, "Cloned".into());
    Ok(target)
}

// ── coding agents ──────────────────────────────────────────────────────────
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Agent {
    Claude,
    Codex,
    Gemini,
}

impl Agent {
    pub fn id(self) -> &'static str {
        match self {
            Agent::Claude => "claude",
            Agent::Codex => "codex",
            Agent::Gemini => "gemini",
        }
    }
    pub fn bin(self) -> &'static str {
        self.id()
    }
    pub fn name(self) -> &'static str {
        match self {
            Agent::Claude => "Claude Code",
            Agent::Codex => "Codex CLI",
            Agent::Gemini => "Gemini CLI",
        }
    }
    pub fn provider(self) -> &'static str {
        match self {
            Agent::Claude => "Claude",
            Agent::Codex => "ChatGPT",
            Agent::Gemini => "Gemini",
        }
    }
    pub fn install_command(self) -> &'static str {
        match self {
            Agent::Claude => "npm install -g @anthropic-ai/claude-code",
            Agent::Codex => "npm install -g @openai/codex",
            Agent::Gemini => "npm install -g @google/gemini-cli",
        }
    }
    pub fn sign_in_args(self) -> Vec<String> {
        match self {
            Agent::Codex => vec!["login".into()],
            _ => vec![],
        }
    }
    /// interactive session that starts on `prompt` (Terminal mode)
    pub fn interactive_args(self, prompt: &str) -> Vec<String> {
        match self {
            Agent::Gemini => vec!["-i".into(), prompt.into()],
            _ => vec![prompt.into()],
        }
    }
    /// headless run that may edit files in the working directory (background mode)
    pub fn background_args(self, prompt: &str) -> Vec<String> {
        let p = prompt.to_string();
        match self {
            Agent::Claude => vec!["-p".into(), p, "--permission-mode".into(), "acceptEdits".into(), "--output-format".into(), "stream-json".into(), "--verbose".into()],
            Agent::Codex => vec!["exec".into(), "--full-auto".into(), p],
            Agent::Gemini => vec!["--approval-mode".into(), "auto_edit".into(), "-p".into(), p],
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// None = can't tell
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signed_in: Option<bool>,
    /// non-secret account label (email) when the CLI's config shows one
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    pub install_command: String,
    pub sign_in_command: String,
}

fn plausible_email(s: &str) -> Option<String> {
    let s = s.trim();
    (s.contains('@') && s.len() < 200 && !s.contains(char::is_whitespace)).then(|| s.to_string())
}

fn small_json(p: &Path) -> Option<Value> {
    let meta = p.metadata().ok()?;
    if meta.len() > 32 * 1024 * 1024 {
        return None;
    }
    serde_json::from_slice(&std::fs::read(p).ok()?).ok()
}

/// (signed in?, account email) from the CLI's own config — existence checks plus non-secret
/// metadata only; token files are never opened.
pub fn sign_in_state(agent: Agent, home: &Path) -> (Option<bool>, Option<String>) {
    match agent {
        Agent::Claude => {
            let dir = std::env::var("CLAUDE_CONFIG_DIR").map(PathBuf::from).ok();
            let file = dir.map(|d| d.join(".claude.json")).filter(|p| p.exists()).unwrap_or_else(|| home.join(".claude.json"));
            match small_json(&file) {
                Some(v) => match v.get("oauthAccount") {
                    Some(acct) if acct.is_object() => (Some(true), acct.get("emailAddress").and_then(|x| x.as_str()).and_then(plausible_email)),
                    _ => (Some(false), None),
                },
                None => (Some(false), None),
            }
        }
        Agent::Codex => {
            let dir = std::env::var("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|_| home.join(".codex"));
            (Some(dir.join("auth.json").exists()), None)
        }
        Agent::Gemini => {
            let dir = home.join(".gemini");
            if !dir.join("oauth_creds.json").exists() {
                return (Some(false), None);
            }
            let acct = small_json(&dir.join("google_accounts.json")).and_then(|v| v.get("active").and_then(|x| x.as_str()).and_then(plausible_email));
            (Some(true), acct)
        }
    }
}

/// "2.0.14 (Claude Code)" → "2.0.14"
pub fn parse_version(out: &str) -> Option<String> {
    let line = out.lines().find(|l| !l.trim().is_empty())?.trim();
    line.split(|c: char| c.is_whitespace() || c == ',')
        .map(|w| w.trim_start_matches('v'))
        .find(|w| w.chars().next().is_some_and(|c| c.is_ascii_digit()) && w.contains('.'))
        .map(String::from)
        .or_else(|| Some(line.chars().take(32).collect()))
}

async fn version_of(bin: &Path) -> Option<String> {
    let fut = tokio::process::Command::new(bin).arg("--version").env("PATH", child_path()).stdin(Stdio::null()).kill_on_drop(true).output();
    let out = tokio::time::timeout(Duration::from_secs(8), fut).await.ok()?.ok()?;
    parse_version(&String::from_utf8_lossy(&out.stdout)).or_else(|| parse_version(&String::from_utf8_lossy(&out.stderr)))
}

pub async fn agent_status(agent: Agent) -> AgentStatus {
    let home = dirs::home_dir().unwrap_or_default();
    let path = find_bin(agent.bin());
    let version = match &path {
        Some(p) => version_of(p).await,
        None => None,
    };
    let (signed_in, account) = sign_in_state(agent, &home);
    let mut sign_in = agent.bin().to_string();
    for a in agent.sign_in_args() {
        sign_in.push(' ');
        sign_in.push_str(&a);
    }
    AgentStatus {
        id: agent.id().into(),
        name: agent.name().into(),
        provider: agent.provider().into(),
        installed: path.is_some(),
        path: path.map(|p| p.display().to_string()),
        version,
        signed_in,
        account,
        install_command: agent.install_command().into(),
        sign_in_command: sign_in,
    }
}

// ── prompts ────────────────────────────────────────────────────────────────
/// The task, optionally prefixed with the project's notes (name, description, client).
pub fn build_prompt(task: &str, project: Option<&Project>) -> String {
    let task = clean_prompt(task);
    let Some(p) = project else { return task };
    let mut ctx = format!("Project: {}", p.name);
    for (label, v) in [("Description", &p.description), ("Client", &p.client), ("Client details", &p.client_details)] {
        if let Some(v) = v.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
            ctx.push_str(&format!("\n{label}: {v}"));
        }
    }
    clean_prompt(&format!("Context from my project notes in Flo:\n{ctx}\n\nTask:\n{task}"))
}

/// One readable line from Claude Code's `--output-format stream-json` event (None = skip).
pub fn claude_stream_line(line: &str) -> Option<String> {
    let Ok(v) = serde_json::from_str::<Value>(line) else {
        let t = line.trim();
        return (!t.is_empty()).then(|| t.to_string());
    };
    match v.get("type").and_then(|t| t.as_str()).unwrap_or("") {
        "system" => (v.get("subtype").and_then(|s| s.as_str()) == Some("init")).then(|| "Claude Code started".to_string()),
        "assistant" => {
            let blocks = v.pointer("/message/content")?.as_array()?;
            let parts: Vec<String> = blocks
                .iter()
                .filter_map(|b| match b.get("type").and_then(|t| t.as_str()) {
                    Some("text") => b.get("text").and_then(|t| t.as_str()).map(|t| t.trim().to_string()).filter(|t| !t.is_empty()),
                    Some("tool_use") => {
                        let name = b.get("name").and_then(|t| t.as_str()).unwrap_or("tool");
                        let input = b.get("input");
                        let arg = ["file_path", "command", "pattern", "path", "url", "description"]
                            .iter()
                            .find_map(|k| input.and_then(|i| i.get(*k)).and_then(|x| x.as_str()))
                            .map(|s| s.lines().next().unwrap_or("").chars().take(140).collect::<String>())
                            .unwrap_or_default();
                        Some(format!("→ {name} {arg}").trim_end().to_string())
                    }
                    _ => None,
                })
                .collect();
            (!parts.is_empty()).then(|| parts.join("\n"))
        }
        "result" => {
            let failed = v.get("is_error").and_then(|x| x.as_bool()).unwrap_or(false);
            let text = v.get("result").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
            Some(if failed { format!("✗ {text}") } else if text.is_empty() { "✓ Done".into() } else { format!("✓ {text}") })
        }
        _ => None,
    }
}

// ── background runs ────────────────────────────────────────────────────────
struct RunHandle {
    log: Vec<String>,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
}

fn runs() -> &'static Mutex<HashMap<String, RunHandle>> {
    static RUNS: OnceLock<Mutex<HashMap<String, RunHandle>>> = OnceLock::new();
    RUNS.get_or_init(Default::default)
}

const LOG_CAP: usize = 2000;

fn push_log(st: &Shared, run_id: &str, project_id: &str, line: String) {
    if let Some(h) = runs().lock().get_mut(run_id) {
        h.log.push(line.clone());
        if h.log.len() > LOG_CAP {
            let drop = h.log.len() - LOG_CAP;
            h.log.drain(..drop);
        }
    }
    st.emit(EV_RUN, RunEvent { run_id: run_id.into(), project_id: project_id.into(), line: Some(line), status: None });
}

fn spawn_background(st: Shared, run: CodeRun, agent: Agent, bin: PathBuf, dir: PathBuf, prompt: String) -> Result<()> {
    let mut child = tokio::process::Command::new(&bin)
        .args(agent.background_args(&prompt))
        .current_dir(&dir)
        .env("PATH", child_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("couldn't start {}", agent.name()))?;
    let (tx, mut rx) = tokio::sync::oneshot::channel::<()>();
    runs().lock().insert(run.id.clone(), RunHandle { log: Vec::new(), stop: Some(tx) });
    let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;
    let stderr = child.stderr.take().ok_or_else(|| anyhow!("no stderr"))?;
    tauri::async_runtime::spawn(async move {
        let (rid, pid) = (run.id.clone(), run.project_id.clone());
        let mut out = BufReader::new(stdout).lines();
        let mut err = BufReader::new(stderr).lines();
        let (mut out_done, mut err_done) = (false, false);
        let mut stopped = false;
        push_log(&st, &rid, &pid, format!("$ {} ({})", agent.name(), dir.display()));
        while !(out_done && err_done) {
            tokio::select! {
                l = out.next_line(), if !out_done => match l {
                    Ok(Some(l)) => {
                        let shown = if agent == Agent::Claude { claude_stream_line(&l) } else { Some(l) };
                        if let Some(s) = shown { push_log(&st, &rid, &pid, s); }
                    }
                    _ => out_done = true,
                },
                l = err.next_line(), if !err_done => match l {
                    Ok(Some(l)) => if !l.trim().is_empty() { push_log(&st, &rid, &pid, l) },
                    _ => err_done = true,
                },
                _ = &mut rx, if !stopped => {
                    stopped = true;
                    let _ = child.start_kill();
                }
            }
        }
        let code = child.wait().await.ok().and_then(|s| s.code());
        let status = if stopped { "stopped" } else if code == Some(0) { "done" } else { "failed" };
        push_log(&st, &rid, &pid, match status {
            "stopped" => "Stopped.".into(),
            "done" => "Finished.".into(),
            _ => format!("Exited with code {}", code.map(|c| c.to_string()).unwrap_or_else(|| "?".into())),
        });
        let _ = st.db.finish_code_run(&rid, status, code);
        if let Some(h) = runs().lock().get_mut(&rid) {
            h.stop = None;
        }
        st.emit(EV_RUN, RunEvent { run_id: rid, project_id: pid, line: None, status: Some(status.into()) });
    });
    Ok(())
}

// ── commands ───────────────────────────────────────────────────────────────
fn project(st: &Shared, id: &str) -> Result<Project> {
    st.db.get_project(id)?.ok_or_else(|| anyhow!("That project no longer exists"))
}

fn project_dir(st: &Shared, id: &str) -> Result<(Project, PathBuf)> {
    let p = project(st, id)?;
    let path = p.local_path.clone().ok_or_else(|| anyhow!("Add code to this project first"))?;
    let dir = abs_dir(&path).map_err(|_| anyhow!("The project's folder is gone: {path}. Link it again."))?;
    Ok((p, dir))
}

/// Native folder picker (null when cancelled).
#[tauri::command]
pub async fn choose_folder(prompt: Option<String>) -> R<Option<String>> {
    if !cfg!(target_os = "macos") {
        return Err("Folder picking is only supported on macOS for now".into());
    }
    let prompt = prompt.unwrap_or_else(|| "Choose a folder".into());
    let script = format!("POSIX path of (choose folder with prompt {})", applescript_str(&clean_prompt(&prompt)));
    let out = tokio::process::Command::new("osascript").arg("-e").arg(script).stdin(Stdio::null()).output().await.map_err(e)?;
    if !out.status.success() {
        return Ok(None); // -128: user cancelled
    }
    let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let p = if p.len() > 1 { p.trim_end_matches('/').to_string() } else { p };
    Ok((!p.is_empty()).then_some(p))
}

#[tauri::command]
pub fn validate_repo_url(url: String) -> R<RepoRef> {
    parse_github_url(&url).map_err(e)
}

#[tauri::command]
pub async fn clone_repo(st: State<'_, Shared>, project_id: String, url: String, parent: String) -> R<RepoInfo> {
    let st = st.inner().clone();
    project(&st, &project_id).map_err(e)?;
    let r = parse_github_url(&url).map_err(e)?;
    let pid = project_id.clone();
    let st2 = st.clone();
    let target = clone_into(&url, &parent, move |phase, percent, message| {
        st2.emit(EV_CLONE, CloneProgress { project_id: pid.clone(), phase, percent, message });
    })
    .await
    .map_err(e)?;
    st.db.set_project_code(&project_id, Some(&r.display_url), Some(&target.display().to_string())).map_err(e)?;
    st.emit(ev::PROJECTS, ());
    Ok(tauri::async_runtime::spawn_blocking(move || repo_info_at(&target)).await.map_err(e)?)
}

/// Link an existing folder (git or not) to the project.
#[tauri::command]
pub async fn link_folder(st: State<'_, Shared>, project_id: String, path: String) -> R<RepoInfo> {
    let st = st.inner().clone();
    project(&st, &project_id).map_err(e)?;
    let dir = abs_dir(&path).map_err(e)?;
    let info = tauri::async_runtime::spawn_blocking(move || repo_info_at(&dir)).await.map_err(e)?;
    st.db.set_project_code(&project_id, info.remote.as_deref(), Some(&info.path)).map_err(e)?;
    st.emit(ev::PROJECTS, ());
    Ok(info)
}

#[tauri::command]
pub async fn repo_info(st: State<'_, Shared>, project_id: String) -> R<Option<RepoInfo>> {
    let p = project(st.inner(), &project_id).map_err(e)?;
    let Some(path) = p.local_path else { return Ok(None) };
    Ok(Some(tauri::async_runtime::spawn_blocking(move || repo_info_at(Path::new(&path))).await.map_err(e)?))
}

/// Forget the link (files stay where they are).
#[tauri::command]
pub fn unlink_code(st: State<Shared>, project_id: String) -> R<()> {
    st.db.set_project_code(&project_id, None, None).map_err(e)?;
    st.emit(ev::PROJECTS, ());
    Ok(())
}

/// finder | vscode | terminal
#[tauri::command]
pub fn open_code(st: State<Shared>, project_id: String, target: String) -> R<()> {
    let (_, dir) = project_dir(st.inner(), &project_id).map_err(e)?;
    let mut c = match target.as_str() {
        "finder" => {
            let mut c = std::process::Command::new("open");
            c.arg(&dir);
            c
        }
        "vscode" => match find_bin("code") {
            Some(code) => {
                let mut c = std::process::Command::new(code);
                c.arg(&dir).env("PATH", child_path());
                c
            }
            None => {
                let mut c = std::process::Command::new("open");
                c.args(["-a", "Visual Studio Code"]).arg(&dir);
                c
            }
        },
        "terminal" => {
            let mut c = std::process::Command::new("open");
            c.args(["-a", "Terminal"]).arg(&dir);
            c
        }
        _ => return Err("unknown target".into()),
    };
    let out = c.stdin(Stdio::null()).output().map_err(e)?;
    if !out.status.success() {
        return Err(if target == "vscode" { "VS Code isn't installed (or its `code` command isn't on PATH).".into() } else { String::from_utf8_lossy(&out.stderr).trim().to_string() });
    }
    Ok(())
}

#[tauri::command]
pub async fn coding_agents() -> Vec<AgentStatus> {
    let (a, b, c) = tokio::join!(agent_status(Agent::Claude), agent_status(Agent::Codex), agent_status(Agent::Gemini));
    vec![a, b, c]
}

/// Open Terminal on the agent's own sign-in flow (Flo never handles the credentials).
#[tauri::command]
pub fn agent_sign_in(agent: Agent) -> R<()> {
    let bin = find_bin(agent.bin()).ok_or_else(|| format!("{} isn't installed. Install it first: {}", agent.name(), agent.install_command()))?;
    let home = dirs::home_dir().map(|h| h.display().to_string());
    open_terminal(&terminal_command(home.as_deref(), &bin.display().to_string(), &agent.sign_in_args())).map_err(e)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditRequest {
    pub project_id: String,
    pub prompt: String,
    pub agent: Agent,
    /// terminal | background
    pub mode: String,
    #[serde(default)]
    pub include_notes: bool,
    /// background mode: the user ticked "let it edit files"
    #[serde(default)]
    pub accept_edits: bool,
}

#[tauri::command]
pub fn edit_with_ai(st: State<Shared>, req: EditRequest) -> R<CodeRun> {
    let st = st.inner().clone();
    let task = clean_prompt(&req.prompt);
    if task.is_empty() {
        return Err("Say what to build first".into());
    }
    let (p, dir) = project_dir(&st, &req.project_id).map_err(e)?;
    let bin = find_bin(req.agent.bin()).ok_or_else(|| format!("{} isn't installed. Install it first: {}", req.agent.name(), req.agent.install_command()))?;
    let full = build_prompt(&task, req.include_notes.then_some(&p));
    let background = match req.mode.as_str() {
        "terminal" => false,
        "background" => true,
        _ => return Err("unknown mode".into()),
    };
    if background && !req.accept_edits {
        return Err("Running in the background lets the agent edit files without asking. Tick the confirmation first.".into());
    }
    let run = CodeRun {
        id: crate::db::new_id(),
        project_id: p.id.clone(),
        prompt: task,
        agent: req.agent.id().into(),
        mode: req.mode.clone(),
        status: if background { "running".into() } else { "launched".into() },
        created_at: chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, false),
        finished_at: None,
        exit_code: None,
    };
    if background {
        st.db.insert_code_run(&run).map_err(e)?;
        if let Err(err) = spawn_background(st.clone(), run.clone(), req.agent, bin, dir, full) {
            let _ = st.db.finish_code_run(&run.id, "failed", None);
            return Err(err.to_string());
        }
    } else {
        let cmd = terminal_command(Some(&dir.display().to_string()), &bin.display().to_string(), &req.agent.interactive_args(&full));
        open_terminal(&cmd).map_err(e)?;
        st.db.insert_code_run(&run).map_err(e)?;
    }
    Ok(run)
}

#[tauri::command]
pub fn list_code_runs(st: State<Shared>, project_id: String) -> R<Vec<CodeRun>> {
    let mut list = st.db.list_code_runs(&project_id, 20).map_err(e)?;
    let live = runs().lock();
    for r in list.iter_mut() {
        // left "running" by a previous launch of Flo
        if r.status == "running" && !live.get(&r.id).is_some_and(|h| h.stop.is_some()) {
            r.status = "interrupted".into();
        }
    }
    Ok(list)
}

#[tauri::command]
pub fn code_run_log(run_id: String) -> Vec<String> {
    runs().lock().get(&run_id).map(|h| h.log.clone()).unwrap_or_default()
}

#[tauri::command]
pub fn stop_code_run(run_id: String) -> R<()> {
    match runs().lock().get_mut(&run_id).and_then(|h| h.stop.take()) {
        Some(tx) => {
            let _ = tx.send(());
            Ok(())
        }
        None => Err("That run isn't running".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_urls() {
        let r = parse_github_url("https://github.com/octocat/Hello-World").unwrap();
        assert_eq!((r.owner.as_str(), r.repo.as_str()), ("octocat", "Hello-World"));
        assert_eq!(r.clone_url, "https://github.com/octocat/Hello-World.git");
        assert_eq!(r.display_url, "https://github.com/octocat/Hello-World");
        assert_eq!(parse_github_url("  https://github.com/a/b.git/ ").unwrap().repo, "b");
        assert_eq!(parse_github_url("https://github.com/a/my.repo_x").unwrap().repo, "my.repo_x");
        let s = parse_github_url("git@github.com:owner/repo.git").unwrap();
        assert_eq!(s.clone_url, "git@github.com:owner/repo.git");
        assert_eq!(s.repo, "repo");
        for bad in [
            "",
            "github.com/a/b",
            "http://github.com/a/b",
            "https://gitlab.com/a/b",
            "https://github.com/a",
            "https://github.com/a/b/tree/main",
            "https://github.com/a/..",
            "https://github.com/-a/b",
            "https://github.com/a/b;rm -rf ~",
            "https://github.com/a/$(whoami)",
            "https://github.com.evil.com/a/b",
            "git@github.com:a/b c.git",
            "ext::sh -c touch% /tmp/pwned",
        ] {
            assert!(parse_github_url(bad).is_err(), "{bad} should be rejected");
        }
    }

    #[test]
    fn quoting_shapes() {
        assert_eq!(sh_quote("abc"), "'abc'");
        assert_eq!(sh_quote("it's"), r"'it'\''s'");
        assert_eq!(applescript_str("a\"b\\c\nd"), r#""a\"b\\c\nd""#);
        let cmd = terminal_command(Some("/Users/me/My Repo"), "/usr/local/bin/claude", &["fix it".into()]);
        assert_eq!(cmd, "cd '/Users/me/My Repo' && '/usr/local/bin/claude' 'fix it'");
        let lines = terminal_script(&cmd);
        assert_eq!(lines[0], "tell application \"Terminal\"");
        assert!(lines[2].starts_with("do script \"cd '/Users/me/My Repo'"));
    }

    const NASTY: &[&str] = &[
        "plain words",
        "it's a \"quoted\" thing",
        "costs $HOME and ${PATH} and $(whoami)",
        "`rm -rf /` in backticks",
        "line one\nline two\n\tindented",
        "back\\slash \\n not a newline",
        "semi; colon && and || pipe | glob * ? [x] ~ # ! %",
        "'''",
        "emoji ✨ and ünïcode",
    ];

    /// The shell layer: what `sh -c` sees as each argument is exactly the original text.
    #[test]
    fn sh_quote_roundtrips_through_a_real_shell() {
        for s in NASTY {
            let out = std::process::Command::new("/bin/sh").arg("-c").arg(format!("printf %s {}", sh_quote(s))).output().unwrap();
            assert_eq!(String::from_utf8_lossy(&out.stdout), *s, "sh round-trip of {s:?}");
        }
        // zsh is macOS's default login shell (Terminal's `do script` runs there)
        if Path::new("/bin/zsh").exists() {
            for s in NASTY {
                let out = std::process::Command::new("/bin/zsh").arg("-f").arg("-c").arg(format!("printf %s {}", sh_quote(s))).output().unwrap();
                assert_eq!(String::from_utf8_lossy(&out.stdout), *s, "zsh round-trip of {s:?}");
            }
        }
    }

    /// The AppleScript layer: the string `do script` receives is exactly the shell command, and that
    /// command then hands the prompt to the CLI unchanged (osascript only, no Terminal window).
    #[cfg(target_os = "macos")]
    #[test]
    fn applescript_and_shell_layers_roundtrip() {
        for s in NASTY {
            let cmd = terminal_command(Some("/tmp"), "printf", &["%s".into(), s.to_string()]);
            let out = std::process::Command::new("osascript").arg("-e").arg(format!("return {}", applescript_str(&cmd))).output().unwrap();
            assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
            let mut got = String::from_utf8_lossy(&out.stdout).to_string();
            got.pop(); // osascript adds a newline
            assert_eq!(got, cmd, "applescript round-trip of {s:?}");
            let run = std::process::Command::new("/bin/zsh").arg("-f").arg("-c").arg(&got).output().unwrap();
            assert_eq!(String::from_utf8_lossy(&run.stdout), *s, "end-to-end {s:?}");
        }
    }

    #[test]
    fn prompts_are_cleaned_and_never_flags() {
        assert_eq!(clean_prompt("  add dark mode \u{7}\u{0} "), "add dark mode");
        assert_eq!(clean_prompt("--dangerously-skip-permissions"), "Task: --dangerously-skip-permissions");
        assert_eq!(clean_prompt("a\nb"), "a\nb");
        assert_eq!(clean_prompt(&"x".repeat(30_000)).len(), 20_000);
    }

    #[test]
    fn project_notes_only_when_asked() {
        let p = Project {
            id: "p".into(),
            name: "Apollo".into(),
            description: Some("Dashboard redesign".into()),
            status: "active".into(),
            color: "#000".into(),
            open_todos: 0,
            done_todos: 0,
            last_note: None,
            updated_at: "".into(),
            client: Some("Northwind".into()),
            client_details: Some("Priya · priya@northwind.com".into()),
            keywords: None,
            repo_url: None,
            local_path: None,
        };
        assert_eq!(build_prompt("add login", None), "add login");
        let full = build_prompt("add login", Some(&p));
        assert!(full.contains("Project: Apollo") && full.contains("Client: Northwind") && full.contains("priya@northwind.com"));
        assert!(full.ends_with("Task:\nadd login"));
    }

    #[test]
    fn agent_command_lines() {
        assert_eq!(Agent::Claude.interactive_args("x"), vec!["x"]);
        assert_eq!(Agent::Gemini.interactive_args("x"), vec!["-i", "x"]);
        let bg = Agent::Claude.background_args("x");
        assert_eq!(&bg[..4], &["-p", "x", "--permission-mode", "acceptEdits"]);
        assert_eq!(Agent::Codex.background_args("x"), vec!["exec", "--full-auto", "x"]);
        assert_eq!(Agent::Codex.sign_in_args(), vec!["login"]);
        let a: Agent = serde_json::from_str("\"gemini\"").unwrap();
        assert_eq!(a, Agent::Gemini);
    }

    #[test]
    fn progress_and_errors() {
        assert_eq!(parse_progress("Receiving objects:  50% (5/10), 1.00 KiB | 1 MiB/s"), Some(("Receiving objects".into(), 47)));
        assert_eq!(parse_progress("remote: Counting objects: 100% (3/3), done."), Some(("Counting objects".into(), 5)));
        assert_eq!(parse_progress("Resolving deltas: 100% (2/2), done."), Some(("Resolving deltas".into(), 97)));
        assert_eq!(parse_progress("Cloning into 'x'..."), None);
        assert_eq!(clone_error_message("xcrun: error: invalid active developer path"), GIT_MISSING);
        assert!(clone_error_message("fatal: could not read Username for 'https://github.com': terminal prompts disabled").contains("gh auth login"));
        assert!(clone_error_message("ERROR: Repository not found.\nfatal: Could not read from remote repository.").contains("private"));
        assert!(clone_error_message("git@github.com: Permission denied (publickey).").contains("SSH key"));
        assert!(clone_error_message("fatal: destination path 'x' already exists and is not an empty directory.").contains("non-empty"));
        assert!(clone_error_message("fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: github.com").contains("internet"));
        assert_eq!(clone_error_message("fatal: something odd"), "Clone failed: something odd");
    }

    #[test]
    fn commit_versions_and_remotes() {
        let c = parse_commit("abc1234\u{1f}Fix: thing\u{1f}Ada\u{1f}2026-01-02T03:04:05+00:00").unwrap();
        assert_eq!((c.hash.as_str(), c.subject.as_str(), c.author.as_str()), ("abc1234", "Fix: thing", "Ada"));
        assert!(parse_commit("").is_none());
        assert_eq!(parse_version("2.0.14 (Claude Code)\n").as_deref(), Some("2.0.14"));
        assert_eq!(parse_version("codex-cli 0.46.0").as_deref(), Some("0.46.0"));
        assert_eq!(parse_version("v1.2.3").as_deref(), Some("1.2.3"));
        assert_eq!(strip_credentials("https://x-access-token:ghp_SECRET@github.com/a/b.git"), "https://github.com/a/b.git");
        assert_eq!(strip_credentials("git@github.com:a/b.git"), "git@github.com:a/b.git");
    }

    #[test]
    fn sign_in_detection_reads_only_metadata() {
        let home = std::env::temp_dir().join(format!("flo-code-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        std::fs::create_dir_all(home.join(".gemini")).unwrap();
        // nothing yet
        assert_eq!(sign_in_state(Agent::Codex, &home), (Some(false), None));
        assert_eq!(sign_in_state(Agent::Gemini, &home), (Some(false), None));
        std::fs::write(home.join(".claude.json"), r#"{"numStartups":3}"#).unwrap();
        if std::env::var("CLAUDE_CONFIG_DIR").is_err() {
            assert_eq!(sign_in_state(Agent::Claude, &home), (Some(false), None));
            std::fs::write(home.join(".claude.json"), r#"{"oauthAccount":{"emailAddress":"me@example.com","accountUuid":"u"}}"#).unwrap();
            assert_eq!(sign_in_state(Agent::Claude, &home), (Some(true), Some("me@example.com".into())));
        }
        // token files: existence only (contents are deliberately not JSON to prove they aren't parsed)
        std::fs::write(home.join(".codex/auth.json"), "not-json-SECRET").unwrap();
        if std::env::var("CODEX_HOME").is_err() {
            assert_eq!(sign_in_state(Agent::Codex, &home), (Some(true), None));
        }
        std::fs::write(home.join(".gemini/oauth_creds.json"), "not-json-SECRET").unwrap();
        std::fs::write(home.join(".gemini/google_accounts.json"), r#"{"active":"g@example.com","old":[]}"#).unwrap();
        assert_eq!(sign_in_state(Agent::Gemini, &home), (Some(true), Some("g@example.com".into())));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn claude_stream_lines() {
        assert_eq!(claude_stream_line(r#"{"type":"system","subtype":"init","cwd":"/x"}"#).as_deref(), Some("Claude Code started"));
        let a = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Adding a toggle."},{"type":"tool_use","name":"Edit","input":{"file_path":"src/App.tsx"}}]}}"#;
        assert_eq!(claude_stream_line(a).as_deref(), Some("Adding a toggle.\n→ Edit src/App.tsx"));
        assert_eq!(claude_stream_line(r#"{"type":"user","message":{}}"#), None);
        assert_eq!(claude_stream_line(r#"{"type":"result","is_error":false,"result":"All set"}"#).as_deref(), Some("✓ All set"));
        assert_eq!(claude_stream_line("plain text").as_deref(), Some("plain text"));
    }

    #[test]
    fn existing_folder_checks() {
        assert!(abs_dir("relative/path").is_err());
        assert!(abs_dir("/definitely/not/here/flo").is_err());
        assert!(abs_dir("/tmp/../etc").is_err());
        assert!(abs_dir(&std::env::temp_dir().display().to_string()).is_ok());
    }

    #[tokio::test]
    async fn clone_refuses_a_non_empty_target_before_running_git() {
        let parent = std::env::temp_dir().join(format!("flo-clone-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(parent.join("Hello-World")).unwrap();
        std::fs::write(parent.join("Hello-World/README"), "x").unwrap();
        let err = clone_into("https://github.com/octocat/Hello-World", &parent.display().to_string(), |_, _, _| {}).await.unwrap_err();
        assert!(err.to_string().contains("isn't empty"), "{err}");
        let err = clone_into("https://github.com/octocat/Hello-World", "not/absolute", |_, _, _| {}).await.unwrap_err();
        assert!(err.to_string().contains("absolute"));
        let _ = std::fs::remove_dir_all(&parent);
    }

    /// What this Mac has installed — run by hand: cargo test --release --lib code::tests::real_agents -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn real_agents() {
        for a in [Agent::Claude, Agent::Codex, Agent::Gemini] {
            println!("{:?}", agent_status(a).await);
        }
    }

    /// Real network clone — run by hand:
    /// FLO_CLONE_TEST_DIR=/path cargo test --release --lib code::tests::real_clone -- --ignored
    #[tokio::test]
    #[ignore]
    async fn real_clone() {
        let parent = std::env::var("FLO_CLONE_TEST_DIR").unwrap_or_else(|_| std::env::temp_dir().join("flo-clone-test").display().to_string());
        std::fs::create_dir_all(&parent).unwrap();
        let mut seen = Vec::new();
        let dir = clone_into("https://github.com/octocat/Hello-World", &parent, |phase, pct, _| seen.push((phase, pct))).await.unwrap();
        let info = repo_info_at(&dir);
        println!("{info:?}\nprogress: {seen:?}");
        assert!(info.is_git && info.last_commit.is_some() && info.branch.is_some());
        assert_eq!(seen.last().map(|x| x.1), Some(100));
    }
}
