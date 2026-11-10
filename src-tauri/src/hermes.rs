//! Hermes Agent (Nous Research, MIT) as an optional engine for Flo Agent.
//!
//! Install: when the user clicks "Install Hermes" (and only then), Flo runs the official installer
//! (`curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --non-interactive`)
//! as a child process, streams its output into the UI, and can cancel it. It installs exactly what
//! the user would get in Terminal (CLI in ~/.local/bin, code in ~/.hermes/hermes-agent). Flo then
//! detects the user's `hermes` CLI the same way as before.
//!
//! Play / Pause: the gateway's desired state is saved (`AgentConfig::hermes_playing`). Playing,
//! Flo keeps `hermes gateway` running (started again at launch, restarted with backoff if it
//! crashes). Paused, the gateway process group is killed, so nothing answers in Slack.
//!
//! When the user starts it, Flo runs `hermes gateway` with a Flo-managed home
//! (`<Flo data>/hermes`, passed as HERMES_HOME) that Flo writes on every start:
//!   config.yaml       model, the user's enabled MCP servers, memory, approvals (manual)
//!   skills/flo-*/     one SKILL.md per enabled Flo skill
//!   SOUL.md           the persona + standing instructions from Customize
//! The gateway serves Hermes' OpenAI-compatible API on 127.0.0.1 only (API_SERVER_*), which Flo
//! Agent calls with a random per-start key, and, when the user turned it on, the Slack gateway
//! (Socket Mode) with bot / app tokens the user pasted into Flo (kept in the OS keychain and
//! handed to the process as environment variables, never written to disk).
//! Without a running gateway, a single request runs one-shot: `hermes chat -q <prompt> -Q`.
//!
//! Docs: https://hermes-agent.nousresearch.com/docs (api-server, mcp, skills, messaging/slack).
use crate::egress::Purpose;
use crate::floagent::{load_config, AgentConfig};
use crate::model::{Connection, Settings, Skill};
use crate::state::Shared;
use anyhow::{anyhow, bail, Context, Result};
use parking_lot::Mutex;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::State;
use tokio::io::{AsyncBufReadExt, BufReader};

/// the official installer (Linux / macOS / WSL2). Flo runs it on an explicit "Install Hermes" click.
pub const INSTALL_COMMAND: &str = "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash";
pub const INSTALL_SCRIPT_URL: &str = "https://hermes-agent.nousresearch.com/install.sh";
/// install.sh: "--non-interactive  skip stages that need input" (the `hermes setup` wizard and
/// `hermes gateway install`; Flo configures and runs the gateway itself)
pub const INSTALL_FLAGS: &[&str] = &["--non-interactive"];
pub const INSTALL_TIMEOUT: Duration = Duration::from_secs(600);
/// install progress: `InstallState`
pub const EV_INSTALL: &str = "flo://hermes-install";
/// one installer output line: string
pub const EV_INSTALL_LOG: &str = "flo://hermes-install-log";
pub const DOCS_URL: &str = "https://hermes-agent.nousresearch.com/docs";
/// the release Flo was tested against (the newest one at least two weeks old when it was built)
pub const TESTED_VERSION: &str = "0.22.5";
/// Hermes' default API server port
pub const DEFAULT_PORT: u16 = 8642;
/// status changes: `HermesStatus`
pub const EV_STATUS: &str = "flo://hermes";
/// one gateway log line: string
pub const EV_LOG: &str = "flo://hermes-log";
const LOG_CAP: usize = 400;
/// keychain names (secrets::PROVIDERS) for the Slack gateway tokens
pub const SLACK_BOT_KEY: &str = "hermes_slack_bot";
pub const SLACK_APP_KEY: &str = "hermes_slack_app";

type R<T> = std::result::Result<T, String>;
fn e<E: std::fmt::Display>(err: E) -> String {
    format!("{err:#}")
}

// ── detection ──────────────────────────────────────────────────────────────
pub fn find_hermes() -> Option<PathBuf> {
    crate::code::find_bin("hermes").or_else(|| {
        let p = dirs::home_dir()?.join(".hermes/hermes-agent/venv/bin/hermes");
        p.is_file().then_some(p)
    })
}

/// "hermes v0.22.5 (v2026.10.22)" / "Hermes Agent 0.22.5" / "0.22.5" → "0.22.5"
pub fn parse_version(out: &str) -> Option<String> {
    let v = crate::code::parse_version(out)?;
    let v: String = v.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
    (v.contains('.') && v.chars().next().is_some_and(|c| c.is_ascii_digit())).then_some(v.trim_end_matches('.').to_string())
}

/// Is `found` at least `min` ("0.22.5" ≥ "0.22.0")?
pub fn version_at_least(found: &str, min: &str) -> bool {
    let p = |s: &str| s.split('.').map(|x| x.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    let (a, b) = (p(found), p(min));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    true
}

/// Run `hermes --version`. `Err` = the file exists but doesn't run (a half-finished install: the
/// `~/.local/bin/hermes` launcher points at a program that isn't there).
async fn version_of(bin: &Path) -> Result<Option<String>, String> {
    let fut = tokio::process::Command::new(bin).arg("--version").env("PATH", crate::code::child_path()).stdin(Stdio::null()).kill_on_drop(true).output();
    let out = match tokio::time::timeout(Duration::from_secs(10), fut).await {
        Err(_) => return Err("didn't answer within 10 s".into()),
        Ok(Err(e)) => return Err(e.to_string()),
        Ok(Ok(o)) => o,
    };
    let (so, se) = (String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    if !out.status.success() {
        let why = se.lines().chain(so.lines()).map(str::trim).find(|l| !l.is_empty()).unwrap_or("it exited with an error");
        return Err(crate::text::truncate_chars(why, 220));
    }
    Ok(parse_version(&so).or_else(|| parse_version(&se)))
}

// ── config export (pure parts unit tested) ─────────────────────────────────
/// A YAML scalar. JSON strings are valid YAML, so quoting through serde_json is always safe.
fn q(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

/// "Notion Workspace" → "notion-workspace" (used for MCP server keys and skill folders).
pub fn slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.trim().to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out = out.trim_end_matches('-').chars().take(48).collect::<String>();
    if out.is_empty() {
        "item".into()
    } else {
        out
    }
}

/// Hermes' provider id + model for Flo's AI setting (None = let Hermes use its own setup).
pub fn model_block(s: &Settings) -> Option<(String, String, Option<String>)> {
    let model = s.llm_model.trim().to_string();
    match s.llm_provider.as_str() {
        "anthropic" => Some(("anthropic".into(), model, None)),
        "openrouter" => Some(("openrouter".into(), model, None)),
        "openai" => Some(("openai-api".into(), model, None)),
        "ollama" => Some(("custom".into(), model, Some(local_base(&s.local_llm_url, "http://localhost:11434")))),
        "lmstudio" => Some(("custom".into(), model, Some(local_base(&s.local_llm_url, "http://localhost:1234")))),
        _ => None,
    }
}

fn local_base(url: &str, fallback: &str) -> String {
    let u = if url.trim().is_empty() { fallback } else { url.trim() };
    let u = u.trim_end_matches('/');
    if u.ends_with("/v1") {
        u.to_string()
    } else {
        format!("{u}/v1")
    }
}

/// The env var Hermes reads the user's key from, for Flo's provider.
pub fn key_env(provider: &str) -> Option<&'static str> {
    match provider {
        "anthropic" => Some("ANTHROPIC_API_KEY"),
        "openai" => Some("OPENAI_API_KEY"),
        "openrouter" => Some("OPENROUTER_API_KEY"),
        _ => None,
    }
}

/// config.yaml for the Flo-managed Hermes home.
pub fn config_yaml(s: &Settings, cfg: &AgentConfig, servers: &[Connection]) -> String {
    let mut y = String::from("# Written by Flo (Flo Agent → Engine). Flo rewrites this file every time it starts Hermes.\n");
    if let Some((provider, model, base)) = model_block(s) {
        y.push_str("model:\n");
        y.push_str(&format!("  provider: {}\n", q(&provider)));
        if !model.is_empty() {
            y.push_str(&format!("  default: {}\n", q(&model)));
        }
        if let Some(b) = base {
            y.push_str(&format!("  base_url: {}\n  context_length: 65536\n", q(&b)));
        }
    }
    let servers: Vec<&Connection> = servers.iter().filter(|c| c.kind == "mcp" && c.enabled).collect();
    if servers.is_empty() {
        y.push_str("mcp_servers: {}\n");
    } else {
        y.push_str("mcp_servers:\n");
        let mut used = std::collections::HashSet::new();
        for c in servers {
            let mut key = slug(&c.name);
            let mut n = 2;
            while !used.insert(key.clone()) {
                key = format!("{}-{n}", slug(&c.name));
                n += 1;
            }
            y.push_str(&format!("  {}:\n", q(&key)));
            let map = |m: &std::collections::BTreeMap<String, String>| format!("{{{}}}", m.iter().map(|(k, v)| format!("{}: {}", q(k), q(v))).collect::<Vec<_>>().join(", "));
            if c.transport == "http" {
                y.push_str(&format!("    url: {}\n", q(c.url.trim())));
                if !c.env.is_empty() {
                    y.push_str(&format!("    headers: {}\n", map(&c.env)));
                }
            } else {
                y.push_str(&format!("    command: {}\n", q(c.command.trim())));
                y.push_str(&format!("    args: [{}]\n", c.args.iter().map(|a| q(a)).collect::<Vec<_>>().join(", ")));
                if !c.env.is_empty() {
                    y.push_str(&format!("    env: {}\n", map(&c.env)));
                }
            }
        }
    }
    y.push_str(&format!("memory:\n  memory_enabled: {m}\n  user_profile_enabled: {m}\n", m = cfg.memory));
    // Hermes asks before risky commands; Flo never turns that off
    y.push_str("approvals:\n  mode: \"manual\"\n  timeout: 300\n");
    if !cfg.memory {
        y.push_str("agent:\n  disabled_toolsets: [\"memory\"]\n");
    }
    y
}

/// SKILL.md for one Flo skill.
pub fn skill_md(k: &Skill) -> String {
    let first_line = k.instructions.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
    let description = if k.triggers.trim().is_empty() {
        crate::text::truncate_chars(first_line, 200)
    } else {
        crate::text::truncate_chars(&format!("Use when the user asks: {}", k.triggers.trim()), 200)
    };
    let mut tags = vec!["flo".to_string()];
    tags.extend(k.platforms.iter().cloned());
    let mut md = format!(
        "---\nname: {}\ndescription: {}\nversion: 1.0.0\nmetadata:\n  hermes:\n    tags: [{}]\n    category: {}\n---\n\n# {}\n\n",
        q(&format!("flo-{}", slug(&k.name))),
        q(&description),
        tags.iter().map(|t| q(t)).collect::<Vec<_>>().join(", "),
        q("flo"),
        k.name.trim()
    );
    if !k.triggers.trim().is_empty() {
        md.push_str(&format!("Invoked by: {}\n\n", k.triggers.trim()));
    }
    if k.mode == "do" {
        md.push_str("This skill was built to operate the user's screen in Flo. Here, carry out the same steps with your own tools, and ask before anything that sends, posts, pays or deletes.\n\n");
    }
    md.push_str("## Instructions\n\n");
    md.push_str(k.instructions.trim());
    md.push('\n');
    md
}

pub fn soul_md(cfg: &AgentConfig) -> Option<String> {
    if cfg.persona.trim().is_empty() && cfg.instructions.trim().is_empty() {
        return None;
    }
    let mut s = String::from("<!-- Written by Flo from Flo Agent → Customize. -->\n\n");
    if !cfg.persona.trim().is_empty() {
        s.push_str(&format!("{}\n\n", cfg.persona.trim()));
    }
    if !cfg.instructions.trim().is_empty() {
        s.push_str(&format!("## Standing instructions\n\n{}\n\n", cfg.instructions.trim()));
    }
    s.push_str("Always ask before sending, posting, paying or deleting anything.\n");
    Some(s)
}

/// "U01ABC2DEF3, u04xyz, junk!" → ["U01ABC2DEF3", "U04XYZ"]
pub fn clean_member_ids(s: &str) -> Vec<String> {
    s.split(|c: char| c == ',' || c.is_whitespace())
        .map(|x| x.trim().to_uppercase())
        .filter(|x| x.len() >= 3 && x.len() <= 24 && x.starts_with(['U', 'W']) && x.chars().all(|c| c.is_ascii_alphanumeric()))
        .collect()
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub dir: String,
    pub mcp_servers: usize,
    pub skills: usize,
    pub model: Option<String>,
    pub at: String,
}

pub fn home_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("hermes")
}

fn write_private(path: &Path, s: &str) -> Result<()> {
    std::fs::write(path, s)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

/// Write config.yaml, skills/flo-*/SKILL.md and SOUL.md into `home`.
pub fn export_to(home: &Path, s: &Settings, cfg: &AgentConfig, servers: &[Connection], skills: &[Skill]) -> Result<ExportSummary> {
    std::fs::create_dir_all(home)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(home, std::fs::Permissions::from_mode(0o700));
    }
    // MCP env / headers can hold the user's tokens: owner-only file
    write_private(&home.join("config.yaml"), &config_yaml(s, cfg, servers))?;
    let sk = home.join("skills");
    std::fs::create_dir_all(&sk)?;
    // Flo owns the flo-* folders; anything else (skills Hermes learned) is left alone
    if let Ok(rd) = std::fs::read_dir(&sk) {
        for d in rd.flatten() {
            if d.file_name().to_string_lossy().starts_with("flo-") {
                let _ = std::fs::remove_dir_all(d.path());
            }
        }
    }
    let skills: Vec<&Skill> = skills.iter().filter(|k| k.enabled && !k.instructions.trim().is_empty()).collect();
    let mut used = std::collections::HashSet::new();
    for k in &skills {
        let mut name = format!("flo-{}", slug(&k.name));
        let mut n = 2;
        while !used.insert(name.clone()) {
            name = format!("flo-{}-{n}", slug(&k.name));
            n += 1;
        }
        let d = sk.join(&name);
        std::fs::create_dir_all(&d)?;
        std::fs::write(d.join("SKILL.md"), skill_md(k))?;
    }
    match soul_md(cfg) {
        Some(soul) => std::fs::write(home.join("SOUL.md"), soul)?,
        None => {
            let _ = std::fs::remove_file(home.join("SOUL.md"));
        }
    }
    Ok(ExportSummary {
        dir: home.display().to_string(),
        mcp_servers: servers.iter().filter(|c| c.kind == "mcp" && c.enabled).count(),
        skills: skills.len(),
        model: model_block(s).map(|(p, m, _)| if m.is_empty() { p } else { format!("{p} · {m}") }),
        at: chrono::Local::now().to_rfc3339(),
    })
}

fn export(st: &Shared) -> Result<ExportSummary> {
    let cfg = load_config(&st.data_dir);
    let servers = st.db.list_connections().unwrap_or_default();
    let skills = st.db.list_skills().unwrap_or_default();
    let sum = export_to(&home_dir(&st.data_dir), &st.settings(), &cfg, &servers, &skills)?;
    *LAST_EXPORT.lock() = Some(sum.clone());
    Ok(sum)
}

// ── the local API (loopback only) ──────────────────────────────────────────
/// Hermes' API on this Mac. Always loopback: Flo never sends Hermes traffic anywhere else.
pub fn api_url(port: u16, path: &str) -> String {
    let port = if port < 1024 { DEFAULT_PORT } else { port };
    format!("http://127.0.0.1:{port}/{}", path.trim_start_matches('/'))
}

/// The text of one streamed chat-completions chunk ("data: {...}"); None for keep-alives / [DONE].
pub fn sse_delta(line: &str) -> Option<String> {
    let data = line.trim().strip_prefix("data:")?.trim();
    if data == "[DONE]" {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(data).ok()?;
    let c = &v["choices"][0];
    c["delta"]["content"].as_str().or_else(|| c["message"]["content"].as_str()).filter(|s| !s.is_empty()).map(String::from)
}

// ── the gateway process ────────────────────────────────────────────────────
struct Proc {
    child: tokio::process::Child,
    key: String,
    port: u16,
    slack: bool,
    started_at: String,
}
static PROC: Mutex<Option<Proc>> = Mutex::new(None);
static LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());
static LAST_EXPORT: Mutex<Option<ExportSummary>> = Mutex::new(None);
static CANCEL: AtomicBool = AtomicBool::new(false);

fn push_log(st: &Shared, line: String) {
    let line = crate::text::truncate_chars(&redact(&line), 400);
    {
        let mut l = LOG.lock();
        l.push(line.clone());
        if l.len() > LOG_CAP {
            let n = l.len() - LOG_CAP;
            l.drain(..n);
        }
    }
    st.emit(EV_LOG, line);
}

/// Never show a token in the log, whatever Hermes prints.
pub fn redact(line: &str) -> String {
    line.split(' ')
        .map(|w| {
            let t = w.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_');
            let secret = ["xoxb-", "xapp-", "xoxp-", "sk-", "sk-ant-", "Bearer"].iter().any(|p| t.starts_with(p) && t.len() > 12);
            if secret {
                "[hidden]".to_string()
            } else {
                w.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn running() -> bool {
    let mut p = PROC.lock();
    match p.as_mut() {
        Some(pr) => match pr.child.try_wait() {
            Ok(None) => true,
            _ => {
                *p = None;
                false
            }
        },
        None => false,
    }
}

fn random_key() -> String {
    use rand::RngCore;
    let mut b = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut b);
    format!("flo-{}", b.iter().map(|x| format!("{x:02x}")).collect::<String>())
}

/// Environment for any Hermes process Flo starts: the managed home, plus the user's own AI key
/// (when allowed in Engine) straight from the keychain into the child, never onto disk.
async fn base_env(st: &Shared, cfg: &AgentConfig) -> Vec<(String, String)> {
    let s = st.settings();
    let mut env = vec![("HERMES_HOME".to_string(), home_dir(&st.data_dir).display().to_string()), ("PATH".to_string(), crate::code::child_path())];
    if cfg.hermes_use_flo_key {
        if let Some(var) = key_env(&s.llm_provider) {
            if let Ok(Some(k)) = crate::secrets::get_api_key_async(&s.llm_provider).await {
                env.push((var.to_string(), k));
            }
        }
    }
    env
}

pub async fn start(st: &Shared) -> Result<HermesStatus> {
    if running() {
        return Ok(status(st).await);
    }
    let bin = find_hermes().ok_or_else(|| anyhow!("Hermes isn't installed. Click Install Hermes in Flo Agent, Slack."))?;
    let cfg = load_config(&st.data_dir);
    export(st)?;
    let key = random_key();
    let port = DEFAULT_PORT;
    let mut env = base_env(st, &cfg).await;
    env.extend([
        ("API_SERVER_ENABLED".to_string(), "true".to_string()),
        ("API_SERVER_KEY".to_string(), key.clone()),
        ("API_SERVER_HOST".to_string(), "127.0.0.1".to_string()),
        ("API_SERVER_PORT".to_string(), port.to_string()),
    ]);
    // Slack joins whenever it's set up: both tokens and at least one Member ID. Pause turns it off.
    let mut slack = false;
    {
        let bot = crate::secrets::get_api_key_async(SLACK_BOT_KEY).await.ok().flatten();
        let app = crate::secrets::get_api_key_async(SLACK_APP_KEY).await.ok().flatten();
        let users = clean_member_ids(&cfg.slack_allowed_users);
        match (bot, app) {
            (Some(b), Some(a)) if !users.is_empty() => {
                env.push(("SLACK_BOT_TOKEN".into(), b));
                env.push(("SLACK_APP_TOKEN".into(), a));
                env.push(("SLACK_ALLOWED_USERS".into(), users.join(",")));
                slack = true;
            }
            (Some(_), Some(_)) => push_log(st, "Slack: add at least one allowed Slack Member ID; starting without Slack.".into()),
            (None, None) => {}
            _ => push_log(st, "Slack: paste both tokens in Flo Agent, Slack; starting without Slack.".into()),
        }
    }
    let mut cmd = tokio::process::Command::new(&bin);
    cmd.arg("gateway").envs(env).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    // its own process group, so Pause also stops the MCP servers and helpers Hermes started
    #[cfg(unix)]
    cmd.process_group(0);
    let mut child = cmd.spawn().with_context(|| format!("couldn't start {}", bin.display()))?;
    LOG.lock().clear();
    push_log(st, format!("$ hermes gateway  (home: {})", home_dir(&st.data_dir).display()));
    let out = child.stdout.take();
    let err = child.stderr.take();
    *PROC.lock() = Some(Proc { child, key, port, slack, started_at: chrono::Local::now().to_rfc3339() });
    for pipe in [out.map(|o| Box::new(o) as Box<dyn tokio::io::AsyncRead + Unpin + Send>), err.map(|o| Box::new(o) as Box<dyn tokio::io::AsyncRead + Unpin + Send>)].into_iter().flatten() {
        let st2 = st.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(pipe).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                if !l.trim().is_empty() {
                    push_log(&st2, l);
                }
            }
            // a pipe closed: if the process is gone, tell the UI
            if !running() {
                let s = status(&st2).await;
                st2.emit(EV_STATUS, s);
            }
        });
    }
    let s = status(st).await;
    st.emit(EV_STATUS, s.clone());
    Ok(s)
}

pub fn shutdown() {
    if let Some(mut p) = PROC.lock().take() {
        if let Some(pid) = p.child.id() {
            kill_group(pid, "-TERM");
        }
        let _ = p.child.start_kill();
    }
}

pub async fn stop(st: &Shared) -> HermesStatus {
    shutdown();
    push_log(st, "Stopped.".into());
    let s = status(st).await;
    st.emit(EV_STATUS, s.clone());
    s
}

pub fn cancel_ask() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// Send one request to Hermes; `on_line` gets the output line by line. Uses the running gateway's
/// API when there is one, otherwise a one-shot `hermes chat -q`.
pub async fn ask(st: &Shared, prompt: &str, mut on_line: impl FnMut(String) + Send) -> Result<String> {
    CANCEL.store(false, Ordering::SeqCst);
    let api = {
        let p = PROC.lock();
        p.as_ref().map(|p| (p.port, p.key.clone()))
    };
    if let (true, Some((port, key))) = (running(), api) {
        return ask_api(st, port, &key, prompt, &mut on_line).await;
    }
    let bin = find_hermes().ok_or_else(|| anyhow!("Hermes isn't installed. Open Flo Agent → Engine to set it up, or switch the engine back to Flo."))?;
    let cfg = load_config(&st.data_dir);
    export(st)?;
    on_line("Starting Hermes for this request".into());
    let mut child = tokio::process::Command::new(&bin)
        .args(["chat", "-q", prompt, "-Q"])
        .envs(base_env(st, &cfg).await)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("couldn't start {}", bin.display()))?;
    let mut lines = BufReader::new(child.stdout.take().ok_or_else(|| anyhow!("no output"))?).lines();
    let mut out = vec![];
    loop {
        tokio::select! {
            l = lines.next_line() => match l {
                Ok(Some(l)) => {
                    if !l.trim().is_empty() {
                        on_line(redact(&l));
                    }
                    out.push(l);
                }
                _ => break,
            },
            _ = tokio::time::sleep(Duration::from_millis(250)) => {
                if CANCEL.load(Ordering::SeqCst) {
                    let _ = child.start_kill();
                    bail!("Stopped.");
                }
            }
        }
    }
    let status = tokio::time::timeout(Duration::from_secs(10), child.wait()).await.ok().and_then(|r| r.ok());
    let text = out.join("\n").trim().to_string();
    if status.map(|s| s.success()).unwrap_or(false) || !text.is_empty() {
        Ok(if text.is_empty() { "Done.".into() } else { text })
    } else {
        bail!("Hermes stopped without an answer. Run `hermes doctor` in Terminal to check its setup.")
    }
}

async fn ask_api(st: &Shared, port: u16, key: &str, prompt: &str, on_line: &mut (impl FnMut(String) + Send)) -> Result<String> {
    use futures_util::StreamExt;
    let url = api_url(port, "v1/chat/completions");
    st.egress.check(&url, Purpose::Assistant, false)?;
    let body = serde_json::json!({ "model": "hermes-agent", "stream": true, "messages": [{ "role": "user", "content": prompt }] });
    let resp = st
        .egress
        .client(Purpose::Assistant, false)
        .post(&url)
        .bearer_auth(key)
        .json(&body)
        .timeout(Duration::from_secs(600))
        .send()
        .await
        .context("Hermes isn't answering on this Mac. Restart it in Flo Agent → Engine.")?;
    if !resp.status().is_success() {
        let code = resp.status();
        let t = resp.text().await.unwrap_or_default();
        bail!("Hermes returned {code}: {}", crate::text::truncate_chars(&t, 200));
    }
    let mut stream = resp.bytes_stream();
    let (mut buf, mut full, mut pending) = (String::new(), String::new(), String::new());
    while let Some(chunk) = stream.next().await {
        if CANCEL.load(Ordering::SeqCst) {
            bail!("Stopped.");
        }
        buf.push_str(&String::from_utf8_lossy(&chunk?));
        while let Some(i) = buf.find('\n') {
            let line: String = buf.drain(..=i).collect();
            if let Some(d) = sse_delta(&line) {
                full.push_str(&d);
                pending.push_str(&d);
                while let Some(j) = pending.find('\n') {
                    let l: String = pending.drain(..=j).collect();
                    if !l.trim().is_empty() {
                        on_line(l.trim_end().to_string());
                    }
                }
            }
        }
    }
    if !pending.trim().is_empty() {
        on_line(pending.trim().to_string());
    }
    st.egress.record(&url, Purpose::Assistant, full.len() as u64);
    Ok(if full.trim().is_empty() { "Done.".into() } else { full.trim().to_string() })
}

// ── one-click install ──────────────────────────────────────────────────────
/// The installer is Apple Silicon only (install.sh fails with `unsupported_platform` elsewhere).
/// A Rosetta (x86_64) build of Flo still runs on Apple Silicon, so ask the kernel too.
pub fn is_apple_silicon() -> bool {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        return true;
    }
    if !cfg!(target_os = "macos") {
        return false;
    }
    std::process::Command::new("/usr/sbin/sysctl")
        .args(["-n", "hw.optional.arm64"])
        .output()
        .map(|o| arm64_from_sysctl(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or(false)
}

/// `sysctl -n hw.optional.arm64` prints "1" on Apple Silicon (and nothing / "0" on Intel).
pub fn arm64_from_sysctl(out: &str) -> bool {
    out.trim() == "1"
}

pub const INTEL_MESSAGE: &str = "Hermes runs on Apple Silicon computers only (M1 or newer). This computer has an Intel chip, so Hermes can't be installed here. Flo's built-in engine still works.";

/// The shell line Flo runs: the official installer, piped from curl, without prompts.
/// `pipefail` so a failed download (no network) fails the run instead of piping nothing into bash.
pub fn installer_script(url: &str) -> String {
    format!("set -o pipefail; curl -fsSL --retry 2 --connect-timeout 20 {url} | bash -s -- {}", INSTALL_FLAGS.join(" "))
}

/// "\x1b[0;32m✓\x1b[0m done" → "✓ done" (the installer only colours a terminal, but be safe).
pub fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c == '\x1b' {
            if it.peek() == Some(&'[') {
                it.next();
                for d in it.by_ref() {
                    if d.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        if c == '\r' || (c.is_control() && c != '\t') {
            continue;
        }
        out.push(c);
    }
    out
}

#[derive(Debug, Clone, Default)]
pub struct InstallRun {
    pub ok: bool,
    pub code: Option<i32>,
    pub cancelled: bool,
    pub timed_out: bool,
    /// the last output lines (cleaned), newest last
    pub tail: Vec<String>,
}

/// Kill a whole process group (curl + bash + the installer's own children, or Hermes and the MCP
/// servers it started). The group id is the leader's pid (we spawn with `process_group(0)`).
#[cfg(unix)]
fn kill_group(pid: u32, signal: &str) {
    let _ = std::process::Command::new("/bin/kill").args([signal, "--", &format!("-{pid}")]).stdout(Stdio::null()).stderr(Stdio::null()).status();
}
#[cfg(not(unix))]
fn kill_group(_pid: u32, _signal: &str) {}

/// Run an installer program, streaming every output line (stdout and stderr) to `on_line`.
/// Stops it on `cancel` or after `timeout`. Generic so tests can drive it with a fake script.
pub async fn run_installer(program: &Path, args: &[String], env: &[(String, String)], timeout: Duration, cancel: &AtomicBool, mut on_line: impl FnMut(String) + Send) -> Result<InstallRun> {
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args)
        // the installer must install to the user's default place, not Flo's managed home
        .env_remove("HERMES_HOME")
        .env_remove("HERMES_INSTALL_DIR")
        .envs(env.iter().cloned())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    let mut child = cmd.spawn().with_context(|| format!("couldn't start {}", program.display()))?;
    let pid = child.id().unwrap_or(0);
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    for pipe in [child.stdout.take().map(|o| Box::new(o) as Box<dyn tokio::io::AsyncRead + Unpin + Send>), child.stderr.take().map(|o| Box::new(o) as Box<dyn tokio::io::AsyncRead + Unpin + Send>)].into_iter().flatten() {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(pipe).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                let _ = tx.send(l);
            }
        });
    }
    drop(tx);
    let deadline = tokio::time::Instant::now() + timeout;
    let mut run = InstallRun::default();
    let mut push = |run: &mut InstallRun, l: String| {
        let l = crate::text::truncate_chars(&redact(&strip_ansi(&l)), 400);
        if l.trim().is_empty() {
            return;
        }
        run.tail.push(l.clone());
        if run.tail.len() > 40 {
            run.tail.remove(0);
        }
        on_line(l);
    };
    let status = loop {
        tokio::select! {
            l = rx.recv() => match l {
                Some(l) => push(&mut run, l),
                None => break child.wait().await.ok(),
            },
            _ = tokio::time::sleep(Duration::from_millis(200)) => {
                let stop = if cancel.load(Ordering::SeqCst) { Some(false) } else if tokio::time::Instant::now() >= deadline { Some(true) } else { None };
                if let Some(timed_out) = stop {
                    run.cancelled = !timed_out;
                    run.timed_out = timed_out;
                    kill_group(pid, "-TERM");
                    if tokio::time::timeout(Duration::from_secs(3), child.wait()).await.is_err() {
                        kill_group(pid, "-KILL");
                        let _ = child.start_kill();
                        let _ = child.wait().await;
                    }
                    // whatever was printed on the way out
                    while let Ok(Some(l)) = tokio::time::timeout(Duration::from_millis(300), rx.recv()).await {
                        push(&mut run, l);
                    }
                    return Ok(run);
                }
            }
        }
    };
    run.code = status.and_then(|s| s.code());
    run.ok = status.map(|s| s.success()).unwrap_or(false);
    Ok(run)
}

/// One precise sentence for a failed install, from the installer's own last lines.
pub fn install_error(run: &InstallRun) -> String {
    let all = run.tail.join("\n");
    let low = all.to_lowercase();
    let last = run.tail.iter().rev().find(|l| !l.trim().is_empty()).map(|l| l.trim().to_string()).unwrap_or_default();
    // install.sh's fail() prints "✗ <reason>": the most precise thing there is
    let reason = run.tail.iter().rev().find_map(|l| l.trim().strip_prefix('✗').map(|r| r.trim().to_string())).filter(|r| !r.is_empty());
    if run.cancelled {
        return "Install cancelled. Nothing else was changed; click Install Hermes to try again.".into();
    }
    if run.timed_out {
        return format!("The installer didn't finish within {} minutes, so Flo stopped it. Last step: {}", INSTALL_TIMEOUT.as_secs() / 60, if last.is_empty() { "no output" } else { &last });
    }
    if ["could not resolve host", "curl: (6)", "curl: (7)", "curl: (28)", "failed to connect", "network is unreachable", "connection timed out"].iter().any(|p| low.contains(p)) {
        return "Flo couldn't reach hermes-agent.nousresearch.com. Check your internet connection, then click Install Hermes again.".into();
    }
    if low.contains("unsupported_platform") || low.contains("does not support this host") {
        return INTEL_MESSAGE.into();
    }
    if let Some(r) = reason {
        return format!("The Hermes installer stopped: {r}");
    }
    if low.contains("python") && (low.contains("not found") || low.contains("no such file") || low.contains("missing")) {
        return format!("The installer couldn't set up Python: {last}");
    }
    match run.code {
        Some(c) if !last.is_empty() => format!("The Hermes installer stopped (exit {c}): {last}"),
        Some(c) => format!("The Hermes installer stopped (exit {c}) without saying why."),
        None => format!("The Hermes installer was stopped. {last}").trim().to_string(),
    }
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstallState {
    /// idle | running | done | failed | cancelled
    pub phase: String,
    pub lines: Vec<String>,
    pub error: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub version: Option<String>,
}

static INSTALL: Mutex<Option<InstallState>> = Mutex::new(None);
static INSTALL_CANCEL: AtomicBool = AtomicBool::new(false);

pub fn install_state() -> InstallState {
    INSTALL.lock().clone().unwrap_or_else(|| InstallState { phase: "idle".into(), ..Default::default() })
}

fn installing() -> bool {
    INSTALL.lock().as_ref().is_some_and(|s| s.phase == "running")
}

fn set_install(st: &Shared, f: impl FnOnce(&mut InstallState)) {
    let snap = {
        let mut g = INSTALL.lock();
        let s = g.get_or_insert_with(|| InstallState { phase: "idle".into(), ..Default::default() });
        f(s);
        s.clone()
    };
    st.emit(EV_INSTALL, snap);
}

/// Start the official installer in the background (explicit click only). Progress arrives as
/// `EV_INSTALL` / `EV_INSTALL_LOG`; when it succeeds Flo detects Hermes and presses Play.
pub fn install(st: &Shared) -> Result<InstallState> {
    if installing() {
        return Ok(install_state());
    }
    if !is_apple_silicon() {
        set_install(st, |s| {
            *s = InstallState { phase: "failed".into(), error: Some(INTEL_MESSAGE.into()), finished_at: Some(chrono::Local::now().to_rfc3339()), ..Default::default() };
        });
        return Ok(install_state());
    }
    INSTALL_CANCEL.store(false, Ordering::SeqCst);
    set_install(st, |s| {
        *s = InstallState { phase: "running".into(), started_at: Some(chrono::Local::now().to_rfc3339()), ..Default::default() };
    });
    st.emit(EV_STATUS, serde_json::json!({ "installing": true }));
    let st2 = st.clone();
    tauri::async_runtime::spawn(async move {
        let script = installer_script(INSTALL_SCRIPT_URL);
        let env = vec![("PATH".to_string(), crate::code::child_path()), ("NO_COLOR".to_string(), "1".to_string())];
        let st3 = st2.clone();
        let res = run_installer(Path::new("/bin/bash"), &["-c".to_string(), script], &env, INSTALL_TIMEOUT, &INSTALL_CANCEL, move |l| {
            {
                let mut g = INSTALL.lock();
                if let Some(s) = g.as_mut() {
                    s.lines.push(l.clone());
                    if s.lines.len() > 300 {
                        s.lines.remove(0);
                    }
                }
            }
            st3.emit(EV_INSTALL_LOG, l);
        })
        .await;
        finish_install(&st2, res).await;
    });
    Ok(install_state())
}

async fn finish_install(st: &Shared, res: Result<InstallRun>) {
    let now = chrono::Local::now().to_rfc3339();
    let run = match res {
        Ok(r) => r,
        Err(err) => {
            set_install(st, |s| {
                s.phase = "failed".into();
                s.error = Some(format!("Flo couldn't start the installer: {err:#}"));
                s.finished_at = Some(now);
            });
            return;
        }
    };
    if !run.ok {
        let phase = if run.cancelled { "cancelled" } else { "failed" };
        let why = install_error(&run);
        set_install(st, |s| {
                s.phase = phase.into();
                s.error = Some(why);
                s.finished_at = Some(now);
            });
        let s = status(st).await;
        st.emit(EV_STATUS, s);
        return;
    }
    // re-detect and make sure it really runs
    let checked = match find_hermes() {
        None => Err("The installer finished, but Flo can't find the hermes command in ~/.local/bin. Open a new Terminal and run `hermes --version`, then click Check again.".to_string()),
        Some(p) => version_of(&p).await.map_err(|why| format!("Hermes was installed but doesn't run yet ({why}). Click Install Hermes again to repair it.")),
    };
    match checked {
        Err(why) => set_install(st, |s| {
                s.phase = "failed".into();
                s.error = Some(why);
                s.finished_at = Some(now);
            }),
        Ok(v) => {
            set_install(st, |s| {
                s.phase = "done".into();
                s.error = None;
                s.version = v.clone();
                s.finished_at = Some(now);
            });
            // the user asked for Hermes to just work: press Play
            if let Err(err) = play(st).await {
                log::warn!("hermes: play after install: {err:#}");
            }
        }
    }
    let s = status(st).await;
    st.emit(EV_STATUS, s);
}

pub fn cancel_install() {
    INSTALL_CANCEL.store(true, Ordering::SeqCst);
}

// ── Play / Pause (the gateway supervisor) ──────────────────────────────────
/// Wait before restart attempt `n` after a crash; None = give up and show the error.
pub fn backoff(attempt: u32) -> Option<Duration> {
    match attempt {
        0 => Some(Duration::from_secs(2)),
        1 => Some(Duration::from_secs(5)),
        2 => Some(Duration::from_secs(15)),
        _ => None,
    }
}

/// The one word the UI shows for the gateway.
pub fn gateway_phase(installing: bool, installed: bool, playing: bool, running: bool, healthy: bool, error: bool) -> &'static str {
    if installing {
        "installing"
    } else if !installed {
        "not_installed"
    } else if !playing {
        "paused"
    } else if running && healthy {
        "live"
    } else if error && !running {
        "error"
    } else {
        "starting"
    }
}

/// Slack problems Hermes prints (auth.test / Socket Mode errors), as one fixable sentence.
pub fn slack_problem(lines: &[String]) -> Option<String> {
    for l in lines.iter().rev() {
        let low = l.to_lowercase();
        if !low.contains("slack") && !low.contains("socket") && !low.contains("_auth") && !low.contains("scope") {
            continue;
        }
        if low.contains("invalid_auth") || low.contains("not_authed") || low.contains("token_revoked") || low.contains("account_inactive") {
            return Some("Slack rejected a token. Copy fresh bot and app tokens from your Slack app and paste them again.".into());
        }
        if low.contains("missing_scope") {
            return Some("The Slack app is missing a permission. Recreate it from Flo's manifest (Create Slack app), or add the scope and reinstall the app.".into());
        }
        if low.contains("not_allowed_token_type") || low.contains("connections:write") {
            return Some("The app token needs the connections:write scope (Basic Information, App-Level Tokens).".into());
        }
    }
    None
}

#[derive(Default)]
struct Sup {
    error: Option<String>,
    restarts: u32,
}
static SUP: Mutex<Sup> = Mutex::new(Sup { error: None, restarts: 0 });
/// bumped on every Play / Pause: a watcher from an older generation stops by itself
static GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn set_playing(st: &Shared, on: bool) {
    let mut cfg = load_config(&st.data_dir);
    if cfg.hermes_playing != on {
        cfg.hermes_playing = on;
        if let Err(err) = crate::floagent::save_config(&st.data_dir, &cfg) {
            log::warn!("hermes: save play state: {err:#}");
        }
    }
}

/// Play: remember it, start the gateway, and keep it running.
pub async fn play(st: &Shared) -> Result<HermesStatus> {
    set_playing(st, true);
    let g = GEN.fetch_add(1, Ordering::SeqCst) + 1;
    *SUP.lock() = Sup::default();
    let res = start(st).await;
    if let Err(err) = &res {
        SUP.lock().error = Some(format!("{err:#}"));
        let s = status(st).await;
        st.emit(EV_STATUS, s);
    }
    // keep it running from here on (a failed first start is shown to the user instead)
    if res.is_ok() {
        let st2 = st.clone();
        tauri::async_runtime::spawn(async move { watch(st2, g).await });
    }
    res
}

/// Pause: remember it and stop the gateway (and everything it started). Nothing answers in Slack.
pub async fn pause(st: &Shared) -> HermesStatus {
    set_playing(st, false);
    GEN.fetch_add(1, Ordering::SeqCst);
    *SUP.lock() = Sup::default();
    stop(st).await
}

/// Restart the gateway with backoff while the user wants it playing.
async fn watch(st: Shared, g: u64) {
    let mut attempt = 0u32;
    let mut up_since = tokio::time::Instant::now();
    loop {
        tokio::time::sleep(Duration::from_millis(1500)).await;
        if GEN.load(Ordering::SeqCst) != g {
            return;
        }
        if running() {
            // a minute of uptime earns a fresh set of retries
            if attempt > 0 && up_since.elapsed() > Duration::from_secs(60) {
                attempt = 0;
            }
            continue;
        }
        let why = LOG.lock().iter().rev().find(|l| !l.trim().is_empty() && !l.starts_with("Hermes stopped")).cloned().unwrap_or_else(|| "it exited".into());
        match backoff(attempt) {
            None => {
                SUP.lock().error = Some(format!("Hermes keeps stopping, so Flo stopped restarting it. Last message: {why}"));
                let s = status(&st).await;
                st.emit(EV_STATUS, s);
                return;
            }
            Some(wait) => {
                push_log(&st, format!("Hermes stopped ({why}). Restarting in {} s.", wait.as_secs()));
                let s = status(&st).await;
                st.emit(EV_STATUS, s);
                tokio::time::sleep(wait).await;
                if GEN.load(Ordering::SeqCst) != g {
                    return;
                }
                attempt += 1;
                SUP.lock().restarts += 1;
                up_since = tokio::time::Instant::now();
                if let Err(err) = start(&st).await {
                    SUP.lock().error = Some(format!("{err:#}"));
                } else {
                    SUP.lock().error = None;
                }
            }
        }
    }
}

/// At launch: if the user left Hermes playing, start it again, quietly, after a short delay.
pub fn spawn_autostart(st: Shared) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(4)).await;
        if load_config(&st.data_dir).hermes_playing && find_hermes().is_some() && !running() {
            if let Err(err) = play(&st).await {
                log::warn!("hermes: autostart: {err:#}");
            }
        }
    });
}

// ── Slack bot setup ────────────────────────────────────────────────────────
/// Bot scopes from Hermes' Slack guide (Step 2), plus reactions:write so the bot can react.
pub const SLACK_BOT_SCOPES: &[&str] = &[
    "app_mentions:read",
    "chat:write",
    "channels:history",
    "channels:read",
    "groups:history",
    "im:history",
    "im:read",
    "im:write",
    "mpim:history",
    "mpim:read",
    "users:read",
    "files:read",
    "files:write",
    "reactions:write",
];
/// Bot events from Hermes' Slack guide (Step 4).
pub const SLACK_BOT_EVENTS: &[&str] = &["app_mention", "message.channels", "message.groups", "message.im", "message.mpim"];

/// A Slack app manifest for the Hermes bot: Socket Mode, the scopes and events Hermes needs,
/// and the Messages tab (without it, DMs to the bot are blocked).
pub fn slack_manifest_yaml(name: &str) -> String {
    let name = {
        let n = name.trim();
        let n = if n.is_empty() { "Flo" } else { n };
        crate::text::truncate_chars(n, 35)
    };
    let list = |xs: &[&str], indent: &str| xs.iter().map(|x| format!("{indent}- {x}\n")).collect::<String>();
    format!(
        "display_information:\n  name: {n}\n  description: {d}\nfeatures:\n  app_home:\n    home_tab_enabled: false\n    messages_tab_enabled: true\n    messages_tab_read_only_enabled: false\n  bot_user:\n    display_name: {n}\n    always_online: true\noauth_config:\n  scopes:\n    bot:\n{scopes}settings:\n  event_subscriptions:\n    bot_events:\n{events}  interactivity:\n    is_enabled: true\n  org_deploy_enabled: false\n  socket_mode_enabled: true\n  token_rotation_enabled: false\n",
        n = q(&name),
        d = q("Your Flo agent, powered by Hermes, running on your computer."),
        scopes = list(SLACK_BOT_SCOPES, "      "),
        events = list(SLACK_BOT_EVENTS, "      "),
    )
}

/// "Create Slack app" opens this: Slack's new-app dialog with the manifest filled in.
pub fn slack_create_app_url(name: &str) -> String {
    let enc: String = url::form_urlencoded::byte_serialize(slack_manifest_yaml(name).as_bytes()).collect();
    format!("https://api.slack.com/apps?new_app=1&manifest_yaml={enc}")
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SlackBotCheck {
    pub ok: bool,
    pub bot: Option<String>,
    pub team: Option<String>,
    pub bot_user_id: Option<String>,
    pub error: Option<String>,
    /// the Member ID Flo put into the allow-list (from Flo's own Slack connection)
    pub autofilled: Option<String>,
}

/// Slack's auth.test answer for the bot token → who the bot is, or a fixable sentence.
pub fn parse_auth_test(v: &serde_json::Value) -> SlackBotCheck {
    if v["ok"].as_bool() == Some(true) {
        return SlackBotCheck {
            ok: true,
            bot: v["user"].as_str().map(String::from),
            team: v["team"].as_str().map(String::from),
            bot_user_id: v["user_id"].as_str().map(String::from),
            ..Default::default()
        };
    }
    let code = v["error"].as_str().unwrap_or("unknown_error");
    let why = match code {
        "invalid_auth" | "not_authed" => "Slack says this bot token isn't valid. Copy the Bot User OAuth Token (xoxb-) again from OAuth & Permissions.".to_string(),
        "token_revoked" | "token_expired" => "This bot token was revoked. Reinstall the Slack app to your workspace and paste the new token.".to_string(),
        "account_inactive" => "The Slack app was removed from the workspace. Reinstall it and paste the new token.".to_string(),
        other => format!("Slack couldn't check the bot token ({other})."),
    };
    SlackBotCheck { ok: false, error: Some(why), ..Default::default() }
}

async fn slack_check(st: &Shared) -> SlackBotCheck {
    let Some(token) = crate::secrets::get_api_key_async(SLACK_BOT_KEY).await.ok().flatten() else {
        return SlackBotCheck { error: Some("Paste the bot token (xoxb-) first.".into()), ..Default::default() };
    };
    let url = "https://slack.com/api/auth.test";
    if let Err(err) = st.egress.check(url, Purpose::Slack, true) {
        return SlackBotCheck { error: Some(format!("{err:#}")), ..Default::default() };
    }
    let resp = st.egress.client(Purpose::Slack, true).post(url).bearer_auth(&token).timeout(Duration::from_secs(15)).send().await;
    let mut check = match resp {
        Err(_) => SlackBotCheck { error: Some("Flo couldn't reach Slack. Check your internet connection.".into()), ..Default::default() },
        Ok(r) => match r.json::<serde_json::Value>().await {
            Ok(v) => {
                st.egress.record(url, Purpose::Slack, v.to_string().len() as u64);
                parse_auth_test(&v)
            }
            Err(_) => SlackBotCheck { error: Some("Slack sent an answer Flo couldn't read.".into()), ..Default::default() },
        },
    };
    // an empty allow-list means Hermes ignores everyone: fill in the user's own Member ID
    let mut cfg = load_config(&st.data_dir);
    if check.ok && clean_member_ids(&cfg.slack_allowed_users).is_empty() {
        if let Ok(id) = crate::slack::my_user_id(st).await {
            if !clean_member_ids(&id).is_empty() {
                cfg.slack_allowed_users = id.clone();
                if crate::floagent::save_config(&st.data_dir, &cfg).is_ok() {
                    check.autofilled = Some(id);
                }
            }
        }
    }
    check
}

// ── status ─────────────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HermesStatus {
    pub installed: bool,
    /// a `hermes` file was found but it doesn't run (the install didn't finish)
    pub broken: Option<String>,
    pub path: Option<String>,
    pub version: Option<String>,
    /// older than the version Flo was tested with
    pub outdated: bool,
    pub tested_version: String,
    pub running: bool,
    /// the API answered /health
    pub healthy: bool,
    pub port: u16,
    pub started_at: Option<String>,
    pub home: String,
    pub export: Option<ExportSummary>,
    pub slack_running: bool,
    pub slack_bot_token: bool,
    pub slack_app_token: bool,
    pub install_command: String,
    pub docs_url: String,
    /// the user wants Hermes running (Play) or not (Pause); saved across launches
    pub playing: bool,
    /// installing | not_installed | paused | starting | live | error
    pub phase: String,
    /// why it isn't running (start failed, or it kept crashing)
    pub error: Option<String>,
    pub restarts: u32,
    pub apple_silicon: bool,
    pub installing: bool,
    /// a Slack error from Hermes' output (bad token, missing scope)
    pub slack_error: Option<String>,
    /// Slack's new-app dialog with Flo's manifest filled in
    pub slack_app_url: String,
}

async fn healthy(st: &Shared, port: u16) -> bool {
    let url = api_url(port, "health");
    let fut = st.egress.client(Purpose::Assistant, false).get(&url).timeout(Duration::from_secs(2)).send();
    matches!(fut.await, Ok(r) if r.status().is_success())
}

pub async fn status(st: &Shared) -> HermesStatus {
    let path = find_hermes();
    let (version, broken) = match &path {
        Some(p) => match version_of(p).await {
            Ok(v) => (v, None),
            Err(why) => (None, Some(why)),
        },
        None => (None, None),
    };
    let is_running = running();
    let (port, started_at, slack) = PROC.lock().as_ref().map(|p| (p.port, Some(p.started_at.clone()), p.slack)).unwrap_or((DEFAULT_PORT, None, false));
    let has = |k: &str| crate::secrets::get_api_key(k).is_some();
    let installed = path.is_some() && broken.is_none();
    let playing = load_config(&st.data_dir).hermes_playing;
    let is_healthy = is_running && healthy(st, port).await;
    let (error, restarts) = {
        let s = SUP.lock();
        (s.error.clone(), s.restarts)
    };
    let inst = installing();
    let slack_error = if is_running && slack { slack_problem(&LOG.lock()) } else { None };
    HermesStatus {
        playing,
        phase: gateway_phase(inst, installed, playing, is_running, is_healthy, error.is_some()).into(),
        error: if is_running { None } else { error },
        restarts,
        apple_silicon: is_apple_silicon(),
        installing: inst,
        slack_error,
        slack_app_url: slack_create_app_url("Flo"),
        installed,
        broken,
        path: path.map(|p| p.display().to_string()),
        outdated: version.as_deref().map(|v| !version_at_least(v, TESTED_VERSION)).unwrap_or(false),
        version,
        tested_version: TESTED_VERSION.into(),
        running: is_running,
        healthy: is_healthy,
        port,
        started_at,
        home: home_dir(&st.data_dir).display().to_string(),
        export: LAST_EXPORT.lock().clone(),
        slack_running: is_running && slack,
        slack_bot_token: has(SLACK_BOT_KEY),
        slack_app_token: has(SLACK_APP_KEY),
        install_command: INSTALL_COMMAND.into(),
        docs_url: DOCS_URL.into(),
    }
}

// ── commands ───────────────────────────────────────────────────────────────
#[tauri::command]
pub async fn hermes_status(st: State<'_, Shared>) -> R<HermesStatus> {
    Ok(status(st.inner()).await)
}

#[tauri::command]
pub fn hermes_export(st: State<Shared>) -> R<ExportSummary> {
    export(st.inner()).map_err(e)
}

/// Play: start the gateway and keep it running (also after a crash and at the next launch).
#[tauri::command]
pub async fn hermes_start(st: State<'_, Shared>) -> R<HermesStatus> {
    play(st.inner()).await.map_err(e)
}

/// Pause: stop the gateway; Hermes stops answering everywhere until Play.
#[tauri::command]
pub async fn hermes_stop(st: State<'_, Shared>) -> R<HermesStatus> {
    Ok(pause(st.inner()).await)
}

/// Run the official installer (explicit click only). Progress: EV_INSTALL / EV_INSTALL_LOG.
#[tauri::command]
pub fn hermes_install(st: State<Shared>) -> R<InstallState> {
    install(st.inner()).map_err(e)
}

#[tauri::command]
pub fn hermes_install_cancel() {
    cancel_install();
}

#[tauri::command]
pub fn hermes_install_state() -> InstallState {
    install_state()
}

/// Check the bot token with Slack (auth.test) and fill an empty allow-list with the user's own ID.
#[tauri::command]
pub async fn hermes_slack_check(st: State<'_, Shared>) -> R<SlackBotCheck> {
    Ok(slack_check(st.inner()).await)
}

#[tauri::command]
pub fn hermes_log() -> Vec<String> {
    LOG.lock().clone()
}

#[cfg(test)]
mod tests {
    // shell-script launchers: Unix only (Windows runs Hermes through its own launcher)
    #[cfg(unix)]
    #[test]
    fn a_launcher_pointing_at_a_missing_program_is_reported_as_broken() {
        // exactly what a half-finished install leaves: ~/.local/bin/hermes exec-ing a missing venv
        let dir = std::env::temp_dir().join(format!("flo-hermes-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("hermes");
        std::fs::write(&bin, "#!/usr/bin/env bash\nexec \"/nonexistent/flo-test/venv/bin/hermes\" \"$@\"\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let r = rt.block_on(super::version_of(&bin));
        assert!(r.is_err(), "a launcher that can't run must not count as installed");
        let ok = dir.join("hermes-ok");
        std::fs::write(&ok, "#!/bin/sh\necho 'Hermes Agent 0.22.5'\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&ok, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        assert_eq!(rt.block_on(super::version_of(&ok)).unwrap().as_deref(), Some("0.22.5"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    use super::*;
    use std::collections::BTreeMap;

    fn settings(provider: &str, model: &str) -> Settings {
        Settings { llm_provider: provider.into(), llm_model: model.into(), ..Default::default() }
    }

    #[test]
    fn version_parsing_tolerates_every_shape() {
        assert_eq!(parse_version("hermes v0.22.5 (v2026.10.22)\ncommit bf0203a7").as_deref(), Some("0.22.5"));
        assert_eq!(parse_version("Hermes Agent 0.23.0+canary.20261108").as_deref(), Some("0.23.0"));
        assert_eq!(parse_version("0.22.5").as_deref(), Some("0.22.5"));
        assert_eq!(parse_version("command not found"), None);
        assert!(version_at_least("0.22.5", "0.22.5") && version_at_least("0.23.0", TESTED_VERSION) && version_at_least("1.0", "0.22.5"));
        assert!(!version_at_least("0.21.9", TESTED_VERSION) && !version_at_least("0.22.4", "0.22.5"));
    }

    #[test]
    fn install_command_is_the_official_https_installer() {
        assert!(INSTALL_COMMAND.starts_with("curl -fsSL https://hermes-agent.nousresearch.com/"));
        assert!(DOCS_URL.starts_with("https://hermes-agent.nousresearch.com/"));
    }

    #[test]
    fn the_api_is_loopback_only() {
        assert_eq!(api_url(8642, "/v1/chat/completions"), "http://127.0.0.1:8642/v1/chat/completions");
        assert_eq!(api_url(80, "health"), "http://127.0.0.1:8642/health"); // privileged ports are never used
        for p in [1024u16, 8642, 65535] {
            let u = url::Url::parse(&api_url(p, "health")).unwrap();
            assert_eq!(u.host_str(), Some("127.0.0.1"));
        }
    }

    #[test]
    fn streamed_chunks_become_text() {
        assert_eq!(sse_delta(r#"data: {"choices":[{"delta":{"content":"Hello"}}]}"#).as_deref(), Some("Hello"));
        assert_eq!(sse_delta("data: [DONE]"), None);
        assert_eq!(sse_delta(": keep-alive"), None);
        assert_eq!(sse_delta(r#"data: {"choices":[{"delta":{}}]}"#), None);
    }

    #[test]
    fn config_yaml_exports_mcp_servers_safely() {
        let mut env = BTreeMap::new();
        env.insert("NOTION_TOKEN".to_string(), "ntn_\"quoted\"\nline".to_string());
        let mut headers = BTreeMap::new();
        headers.insert("Authorization".to_string(), "Bearer abc".to_string());
        let servers = vec![
            Connection { name: "Notion".into(), kind: "mcp".into(), transport: "stdio".into(), command: "npx".into(), args: vec!["-y".into(), "@notionhq/notion-mcp-server".into()], env, enabled: true, ..Default::default() },
            Connection { name: "Notion".into(), kind: "mcp".into(), transport: "http".into(), url: "https://mcp.example.com/mcp".into(), env: headers, enabled: true, ..Default::default() },
            Connection { name: "Off".into(), kind: "mcp".into(), transport: "stdio".into(), command: "x".into(), enabled: false, ..Default::default() },
            Connection { name: "Upwork".into(), kind: "platform".into(), enabled: true, ..Default::default() },
        ];
        let y = config_yaml(&settings("anthropic", "claude-haiku-5-5"), &AgentConfig::default(), &servers);
        assert!(y.contains("model:\n  provider: \"anthropic\"\n  default: \"claude-haiku-5-5\"\n"));
        assert!(y.contains("mcp_servers:\n  \"notion\":\n    command: \"npx\"\n    args: [\"-y\", \"@notionhq/notion-mcp-server\"]\n"));
        // quotes and newlines can't break out of the scalar
        assert!(y.contains(r#"env: {"NOTION_TOKEN": "ntn_\"quoted\"\nline"}"#));
        assert!(y.contains("  \"notion-2\":\n    url: \"https://mcp.example.com/mcp\"\n    headers: {\"Authorization\": \"Bearer abc\"}\n"));
        assert!(!y.contains("Off") && !y.contains("Upwork"));
        assert!(y.contains("approvals:\n  mode: \"manual\""));
        assert!(y.contains("memory_enabled: true") && !y.contains("disabled_toolsets"));
        let off = config_yaml(&settings("none", ""), &AgentConfig { memory: false, ..Default::default() }, &[]);
        assert!(!off.contains("model:") && off.contains("mcp_servers: {}") && off.contains("disabled_toolsets: [\"memory\"]"));
    }

    #[test]
    fn local_models_use_a_custom_openai_endpoint() {
        let y = config_yaml(&settings("ollama", "qwen3:8b"), &AgentConfig::default(), &[]);
        assert!(y.contains("provider: \"custom\"") && y.contains("base_url: \"http://127.0.0.1:11434/v1\""));
        let mut s = settings("lmstudio", "m");
        s.local_llm_url = "http://127.0.0.1:1234/v1/".into();
        assert_eq!(model_block(&s).unwrap().2.as_deref(), Some("http://127.0.0.1:1234/v1"));
        assert_eq!(key_env("anthropic"), Some("ANTHROPIC_API_KEY"));
        assert_eq!(key_env("ollama"), None);
    }

    #[test]
    fn skills_export_as_skill_md_with_frontmatter() {
        let k = Skill { name: "Upwork proposal!".into(), triggers: "proposal for this job".into(), instructions: "Read the job post.\nWrite 300 words.".into(), platforms: vec!["upwork".into()], mode: "write".into(), enabled: true, ..Default::default() };
        let md = skill_md(&k);
        assert!(md.starts_with("---\nname: \"flo-upwork-proposal\"\ndescription: \"Use when the user asks: proposal for this job\"\nversion: 1.0.0\n"));
        assert!(md.contains("tags: [\"flo\", \"upwork\"]") && md.contains("## Instructions\n\nRead the job post.\nWrite 300 words.\n"));
        let doit = skill_md(&Skill { mode: "do".into(), ..k });
        assert!(doit.contains("ask before anything that sends"));
    }

    #[test]
    fn export_writes_the_managed_home_and_keeps_hermes_own_skills() {
        let home = std::env::temp_dir().join(format!("flo-hermes-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(home.join("skills/learned-by-hermes")).unwrap();
        std::fs::create_dir_all(home.join("skills/flo-stale")).unwrap();
        let skills = vec![
            Skill { name: "Daily brief".into(), instructions: "Summarize my day.".into(), enabled: true, ..Default::default() },
            Skill { name: "Daily brief".into(), instructions: "Second one.".into(), enabled: true, ..Default::default() },
            Skill { name: "Off".into(), instructions: "x".into(), enabled: false, ..Default::default() },
        ];
        let cfg = AgentConfig { persona: "Calm operator".into(), ..Default::default() };
        let sum = export_to(&home, &settings("anthropic", "m"), &cfg, &[], &skills).unwrap();
        assert_eq!((sum.skills, sum.mcp_servers, sum.model.as_deref()), (2, 0, Some("anthropic · m")));
        assert!(home.join("skills/flo-daily-brief/SKILL.md").is_file() && home.join("skills/flo-daily-brief-2/SKILL.md").is_file());
        assert!(!home.join("skills/flo-stale").exists() && home.join("skills/learned-by-hermes").exists());
        assert!(std::fs::read_to_string(home.join("SOUL.md")).unwrap().contains("Calm operator"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(home.join("config.yaml")).unwrap().permissions().mode() & 0o777, 0o600);
        }
        // persona cleared → SOUL.md removed
        export_to(&home, &settings("none", ""), &AgentConfig::default(), &[], &[]).unwrap();
        assert!(!home.join("SOUL.md").exists());
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn slugs_and_member_ids_are_clean() {
        assert_eq!(slug("  My Files! (work) "), "my-files-work");
        assert_eq!(slug("!!!"), "item");
        assert_eq!(clean_member_ids("U01ABC2DEF3, u04xyz w0123 junk! C0CHANNEL"), vec!["U01ABC2DEF3", "U04XYZ", "W0123"]);
    }

    #[test]
    fn tokens_never_reach_the_log() {
        let l = redact("connected with xoxb-123456789012-abcdef and Bearer and sk-ant-abcdefghijklmnop ok");
        assert!(!l.contains("xoxb-1") && !l.contains("sk-ant-a") && l.contains("ok") && l.contains("[hidden]"));
    }

    // ── one-click install, Play / Pause, Slack setup ──
    #[cfg(unix)]
    fn fake(dir: &Path, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        std::fs::create_dir_all(dir).unwrap();
        let p = dir.join(name);
        std::fs::write(&p, format!("#!/bin/bash\n{body}\n")).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        p
    }

    fn rt() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap()
    }

    #[test]
    fn the_installer_runs_the_official_script_without_prompts() {
        let s = installer_script(INSTALL_SCRIPT_URL);
        assert!(s.starts_with("set -o pipefail; curl -fsSL "));
        assert!(s.contains("https://hermes-agent.nousresearch.com/install.sh | bash -s -- --non-interactive"));
        assert!(INSTALL_COMMAND.contains(INSTALL_SCRIPT_URL));
        assert_eq!(INSTALL_TIMEOUT, Duration::from_secs(600));
        assert!(arm64_from_sysctl("1\n") && !arm64_from_sysctl("0") && !arm64_from_sysctl(""));
        assert_eq!(strip_ansi("\x1b[0;32m✓\x1b[0m venv ready\r"), "✓ venv ready");
    }

    #[cfg(unix)]
    #[test]
    fn a_fake_installer_streams_its_output_and_succeeds() {
        let dir = std::env::temp_dir().join(format!("flo-hermes-inst-ok-{}", std::process::id()));
        // it must not see Flo's managed HERMES_HOME (it would install into Flo's folder)
        std::env::set_var("HERMES_HOME", "/flo/managed");
        let bin = fake(&dir, "install.sh", "echo \"→ Installing Hermes\"\necho \"home=${HERMES_HOME:-default}\"\necho 'warn on stderr' >&2\nprintf '\\033[0;32m✓\\033[0m done\\n'\nexit 0");
        let cancel = AtomicBool::new(false);
        let mut seen = vec![];
        let run = rt().block_on(run_installer(&bin, &[], &[], Duration::from_secs(20), &cancel, |l| seen.push(l))).unwrap();
        std::env::remove_var("HERMES_HOME");
        assert!(run.ok && !run.cancelled && !run.timed_out && run.code == Some(0));
        assert!(seen.contains(&"→ Installing Hermes".to_string()) && seen.contains(&"home=default".to_string()));
        assert!(seen.contains(&"warn on stderr".to_string()) && seen.contains(&"✓ done".to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_install_says_exactly_why() {
        let dir = std::env::temp_dir().join(format!("flo-hermes-inst-fail-{}", std::process::id()));
        let bin = fake(&dir, "install.sh", "echo '→ Checking prerequisites'\necho \"✗ git needs Apple's Command Line Tools. Install Apple's Command Line Tools (run: xcode-select --install), then re-run this installer.\" >&2\nexit 1");
        let cancel = AtomicBool::new(false);
        let run = rt().block_on(run_installer(&bin, &[], &[], Duration::from_secs(20), &cancel, |_| {})).unwrap();
        assert!(!run.ok && run.code == Some(1));
        let why = install_error(&run);
        assert!(why.starts_with("The Hermes installer stopped: git needs Apple's Command Line Tools"), "{why}");

        let net = InstallRun { code: Some(6), tail: vec!["curl: (6) Could not resolve host: hermes-agent.nousresearch.com".into()], ..Default::default() };
        assert!(install_error(&net).contains("couldn't reach hermes-agent.nousresearch.com"));
        let intel = InstallRun { code: Some(1), tail: vec!["✗ no pinned uv build for this platform (Darwin x86_64); Hermes does not support this host".into()], ..Default::default() };
        assert_eq!(install_error(&intel), INTEL_MESSAGE);
        let plain = InstallRun { code: Some(2), tail: vec!["something odd".into()], ..Default::default() };
        assert_eq!(install_error(&plain), "The Hermes installer stopped (exit 2): something odd");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn cancel_and_timeout_stop_the_whole_installer() {
        let dir = std::env::temp_dir().join(format!("flo-hermes-inst-slow-{}", std::process::id()));
        let marker = dir.join("child-still-alive");
        // a child process in the same group must die too (curl | bash)
        let bin = fake(&dir, "install.sh", &format!("echo started\n(sleep 3; touch {}) &\nsleep 30", marker.display()));
        let cancel = AtomicBool::new(false);
        let r = rt();
        let t0 = std::time::Instant::now();
        let run = r.block_on(async {
            let c = &cancel;
            let fut = run_installer(&bin, &[], &[], Duration::from_secs(60), c, |_| {});
            let stopper = async {
                tokio::time::sleep(Duration::from_millis(600)).await;
                c.store(true, Ordering::SeqCst);
            };
            let (run, _) = tokio::join!(fut, stopper);
            run
        });
        let run = run.unwrap();
        assert!(run.cancelled && !run.ok && t0.elapsed() < Duration::from_secs(10));
        assert!(install_error(&run).starts_with("Install cancelled"));
        let cancel2 = AtomicBool::new(false);
        let run = r.block_on(run_installer(&bin, &[], &[], Duration::from_millis(800), &cancel2, |_| {})).unwrap();
        // (on a busy machine bash may not have printed "started" yet: only the timeout is certain)
        assert!(run.timed_out && !run.ok && run.tail.iter().all(|l| l == "started"));
        assert!(install_error(&run).contains("didn't finish within 10 minutes"));
        std::thread::sleep(Duration::from_secs(4));
        assert!(!marker.exists(), "the installer's children must be stopped too");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_gateway_restarts_a_few_times_then_shows_the_error() {
        assert_eq!(backoff(0), Some(Duration::from_secs(2)));
        assert!(backoff(1).unwrap() < backoff(2).unwrap());
        assert_eq!(backoff(3), None);
        assert_eq!(gateway_phase(true, false, false, false, false, false), "installing");
        assert_eq!(gateway_phase(false, false, true, false, false, false), "not_installed");
        assert_eq!(gateway_phase(false, true, false, true, true, false), "paused");
        assert_eq!(gateway_phase(false, true, true, false, false, false), "starting");
        assert_eq!(gateway_phase(false, true, true, true, false, false), "starting");
        assert_eq!(gateway_phase(false, true, true, true, true, false), "live");
        assert_eq!(gateway_phase(false, true, true, false, false, true), "error");
    }

    #[test]
    fn slack_errors_in_hermes_output_become_one_fix() {
        let l = |xs: &[&str]| xs.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert!(slack_problem(&l(&["Slack: auth.test failed: invalid_auth"])).unwrap().contains("rejected a token"));
        assert!(slack_problem(&l(&["slack_bolt error: missing_scope (needed: channels:history)"])).unwrap().contains("missing a permission"));
        assert_eq!(slack_problem(&l(&["API server listening", "Slack: connected (Socket Mode)"])), None);
    }

    #[test]
    fn the_slack_manifest_has_socket_mode_and_hermes_scopes() {
        let y = slack_manifest_yaml("Flo");
        assert!(y.contains("socket_mode_enabled: true") && y.contains("messages_tab_enabled: true"));
        for scope in ["app_mentions:read", "chat:write", "channels:history", "groups:history", "im:history", "mpim:history", "im:read", "im:write", "users:read", "reactions:write"] {
            assert!(y.contains(&format!("      - {scope}\n")), "{scope}");
        }
        for ev in ["app_mention", "message.channels", "message.groups", "message.im", "message.mpim"] {
            assert!(y.contains(&format!("      - {ev}\n")), "{ev}");
        }
        assert!(y.contains("  name: \"Flo\"\n") && y.contains("display_name: \"Flo\""));
        assert!(slack_manifest_yaml("a\"b: c").contains("name: \"a\\\"b: c\""));
        let url = slack_create_app_url("Flo");
        assert!(url.starts_with("https://api.slack.com/apps?new_app=1&manifest_yaml="));
        let parsed = url::Url::parse(&url).unwrap();
        let back = parsed.query_pairs().find(|(k, _)| k == "manifest_yaml").unwrap().1.to_string();
        assert_eq!(back, y);
    }

    #[test]
    fn auth_test_answers_become_a_name_or_a_fix() {
        let ok = parse_auth_test(&serde_json::json!({"ok": true, "user": "flo", "team": "Northwind", "user_id": "U0BOT"}));
        assert_eq!((ok.ok, ok.bot.as_deref(), ok.team.as_deref(), ok.bot_user_id.as_deref()), (true, Some("flo"), Some("Northwind"), Some("U0BOT")));
        let bad = parse_auth_test(&serde_json::json!({"ok": false, "error": "invalid_auth"}));
        assert!(!bad.ok && bad.error.unwrap().contains("isn't valid"));
        assert!(parse_auth_test(&serde_json::json!({"ok": false, "error": "ratelimited"})).error.unwrap().contains("ratelimited"));
    }
}
