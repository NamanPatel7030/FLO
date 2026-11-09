//! Hermes Agent (Nous Research, MIT) as an optional engine for Flo Agent.
//!
//! Flo never installs Hermes: it detects the user's own `hermes` CLI (the official installer puts
//! it in ~/.local/bin) and shows the official install command to copy when it's missing.
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

/// the official installer (Linux / macOS / WSL2). Shown to copy; Flo never runs it.
pub const INSTALL_COMMAND: &str = "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash";
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
    let bin = find_hermes().ok_or_else(|| anyhow!("Hermes isn't installed. Copy the install command from Flo Agent → Engine and run it in Terminal."))?;
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
    let mut slack = false;
    if cfg.slack_enabled {
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
            _ => push_log(st, "Slack: paste both tokens in Flo Agent → Slack; starting without Slack.".into()),
        }
    }
    let mut child = tokio::process::Command::new(&bin)
        .arg("gateway")
        .envs(env)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("couldn't start {}", bin.display()))?;
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
    HermesStatus {
        installed: path.is_some() && broken.is_none(),
        broken,
        path: path.map(|p| p.display().to_string()),
        outdated: version.as_deref().map(|v| !version_at_least(v, TESTED_VERSION)).unwrap_or(false),
        version,
        tested_version: TESTED_VERSION.into(),
        running: is_running,
        healthy: is_running && healthy(st, port).await,
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

#[tauri::command]
pub async fn hermes_start(st: State<'_, Shared>) -> R<HermesStatus> {
    start(st.inner()).await.map_err(e)
}

#[tauri::command]
pub async fn hermes_stop(st: State<'_, Shared>) -> R<HermesStatus> {
    Ok(stop(st.inner()).await)
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
}
