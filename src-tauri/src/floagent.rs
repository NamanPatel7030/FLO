//! Flo Agent: one command box for everything Flo can do. A typed (or spoken) request is routed
//! to the right worker and every run gets a step timeline:
//!
//! * a skill the user built ("use my Upwork proposal skill")  → the skill runner (assistant.rs)
//! * an on-screen task ("open LinkedIn and …")                 → the screen agent (agent.rs)
//! * a task for a connected app ("in Notion, find …")          → the MCP tool loop (mcp.rs)
//! * anything else                                             → the assistant, or Hermes when
//!   the user picked Hermes as the engine (hermes.rs)
//!
//! The screen agent reports progress as `flo://agent` events. A listener turns those into
//! timeline steps, so voice runs (hands-free, the notch) show up here as well. No timers: the
//! listener only does work when an event arrives.
//!
//! Safety is unchanged from the workers: the screen agent always asks before anything that sends,
//! posts, pays or deletes, and the Customize tab can only add confirmations, never remove them.
use crate::model::ev;
use crate::platform::FrontApp;
use crate::state::Shared;
use crate::text;
use anyhow::{anyhow, Result};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::State;

/// run snapshots: `AgentRun` (the whole run, every time it changes)
pub const EV_RUN: &str = "flo://flo-agent";
const MAX_RUNS: usize = 30;
const MAX_STEPS: usize = 80;

type R<T> = std::result::Result<T, String>;
fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

// ── config (Customize + Engine) ─────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentConfig {
    /// "flo" (built in, default) | "hermes"
    pub engine: String,
    /// who the agent is ("A calm, precise operator…")
    pub persona: String,
    /// standing instructions ("Reply in English. Keep posts under 100 words.")
    pub instructions: String,
    /// remember recent runs and use them as context
    pub memory: bool,
    pub allow_screen: bool,
    pub allow_tools: bool,
    pub allow_skills: bool,
    /// also ask before every click and keystroke (send / post / pay / delete always ask)
    pub confirm_every_step: bool,
    /// Hermes: hand Flo's AI key to the local Hermes process (in memory, never written to disk)
    pub hermes_use_flo_key: bool,
    /// Hermes: also connect the Slack gateway when Hermes starts (tokens live in the keychain)
    pub slack_enabled: bool,
    /// Slack Member IDs allowed to talk to the bot ("U01ABC2DEF3, U04…"); empty = nobody
    pub slack_allowed_users: String,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            engine: "flo".into(),
            persona: String::new(),
            instructions: String::new(),
            memory: true,
            allow_screen: true,
            allow_tools: true,
            allow_skills: true,
            confirm_every_step: false,
            hermes_use_flo_key: true,
            slack_enabled: false,
            slack_allowed_users: String::new(),
        }
    }
}

fn config_path(dir: &Path) -> PathBuf {
    dir.join("flo-agent.json")
}

pub fn load_config(dir: &Path) -> AgentConfig {
    std::fs::read_to_string(config_path(dir)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn save_config(dir: &Path, c: &AgentConfig) -> Result<()> {
    let mut c = c.clone();
    if !matches!(c.engine.as_str(), "flo" | "hermes") {
        c.engine = "flo".into();
    }
    c.persona = text::truncate_chars(c.persona.trim(), 600);
    c.instructions = text::truncate_chars(c.instructions.trim(), 2000);
    c.slack_allowed_users = crate::hermes::clean_member_ids(&c.slack_allowed_users).join(",");
    std::fs::create_dir_all(dir)?;
    std::fs::write(config_path(dir), serde_json::to_string_pretty(&c)?)?;
    Ok(())
}

// ── runs ────────────────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunStep {
    pub at: String,
    /// route | step | tool | confirm | output | done | error | stopped
    pub kind: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentRun {
    pub id: String,
    pub goal: String,
    /// skill | screen | tools | answer | hermes
    pub route: String,
    /// flo | hermes
    pub engine: String,
    /// typed | voice
    pub source: String,
    /// running | waiting (for a yes / no) | done | failed | stopped
    pub status: String,
    pub skill: Option<String>,
    pub steps: Vec<RunStep>,
    pub result: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

impl Default for AgentRun {
    fn default() -> Self {
        Self {
            id: String::new(),
            goal: String::new(),
            route: "answer".into(),
            engine: "flo".into(),
            source: "typed".into(),
            status: "running".into(),
            skill: None,
            steps: vec![],
            result: None,
            started_at: String::new(),
            finished_at: None,
        }
    }
}

impl AgentRun {
    pub fn push(&mut self, kind: &str, text: &str) {
        let text = text::truncate_chars(text.trim(), 600);
        if text.is_empty() {
            return;
        }
        self.steps.push(RunStep { at: chrono::Local::now().to_rfc3339(), kind: kind.into(), text });
        if self.steps.len() > MAX_STEPS {
            let drop = self.steps.len() - MAX_STEPS;
            self.steps.drain(..drop);
        }
    }
    pub fn finished(&self) -> bool {
        matches!(self.status.as_str(), "done" | "failed" | "stopped")
    }
    /// Close the run (once). Later calls are ignored, so the listener and the caller can both try.
    pub fn finish(&mut self, status: &str, result: &str) -> bool {
        if self.finished() {
            return false;
        }
        self.status = status.into();
        let kind = match status {
            "done" => "done",
            "stopped" => "stopped",
            _ => "error",
        };
        self.push(kind, result);
        self.result = Some(text::truncate_chars(result.trim(), 2000));
        self.finished_at = Some(chrono::Local::now().to_rfc3339());
        true
    }
}

struct Runs {
    list: Vec<AgentRun>,
    /// the run screen-agent events belong to
    active: Option<String>,
    loaded: bool,
}
static RUNS: Mutex<Runs> = Mutex::new(Runs { list: Vec::new(), active: None, loaded: false });

fn runs_path(dir: &Path) -> PathBuf {
    dir.join("flo-agent-runs.json")
}

fn ensure_loaded(dir: &Path) {
    let mut r = RUNS.lock();
    if r.loaded {
        return;
    }
    r.loaded = true;
    let mut saved: Vec<AgentRun> = std::fs::read_to_string(runs_path(dir)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    // a run that was going when Flo quit didn't finish
    for run in saved.iter_mut().filter(|x| !x.finished()) {
        run.finish("stopped", "Flo was closed before this finished.");
    }
    r.list = saved;
}

fn persist(dir: &Path) {
    let list: Vec<AgentRun> = RUNS.lock().list.iter().filter(|x| x.finished()).take(MAX_RUNS).cloned().collect();
    if let Ok(s) = serde_json::to_string(&list) {
        let _ = std::fs::create_dir_all(dir);
        let _ = std::fs::write(runs_path(dir), s);
    }
}

/// Change a run, then emit its new snapshot (and save it when it just finished).
fn update(st: &Shared, id: &str, f: impl FnOnce(&mut AgentRun)) -> Option<AgentRun> {
    let snap = {
        let mut r = RUNS.lock();
        let run = r.list.iter_mut().find(|x| x.id == id)?;
        f(run);
        let snap = run.clone();
        if snap.finished() && r.active.as_deref() == Some(id) {
            r.active = None;
        }
        snap
    };
    st.emit(EV_RUN, snap.clone());
    if snap.finished() {
        persist(&st.data_dir);
    }
    Some(snap)
}

fn insert(st: &Shared, run: AgentRun, active: bool) -> AgentRun {
    {
        let mut r = RUNS.lock();
        r.list.insert(0, run.clone());
        r.list.truncate(MAX_RUNS);
        if active {
            r.active = Some(run.id.clone());
        }
    }
    st.emit(EV_RUN, run.clone());
    run
}

fn active_id() -> Option<String> {
    RUNS.lock().active.clone()
}

/// Recent finished runs as context lines (memory on).
fn memory_lines() -> String {
    let r = RUNS.lock();
    let lines: Vec<String> = r
        .list
        .iter()
        .filter(|x| x.status == "done")
        .take(5)
        .map(|x| format!("- \"{}\" → {}", text::truncate_chars(&x.goal, 120), text::truncate_chars(x.result.as_deref().unwrap_or(""), 160)))
        .collect();
    if lines.is_empty() {
        String::new()
    } else {
        format!("\n\nRecent things the user asked Flo Agent to do (use when relevant):\n{}", lines.join("\n"))
    }
}

// ── routing (pure; unit tested) ─────────────────────────────────────────────
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutePlan {
    /// skill | screen | tools | answer | hermes
    pub route: String,
    /// skill name (skill route) or app names (tools route)
    pub target: Option<String>,
    /// why, in a few words ("Uses your Upwork proposal skill")
    pub reason: String,
}

const SCREEN_VERBS: &[&str] = &["open", "go to", "goto", "visit", "click", "tap", "type", "scroll", "navigate", "launch", "play", "search", "log in", "sign in", "fill", "press", "watch", "find", "like", "follow", "connect with", "message", "post", "reply", "comment", "send", "apply"];
const SCREEN_PLACES: &[&str] = &[
    "linkedin", "youtube", "gmail", "twitter", "x.com", "instagram", "facebook", "reddit", "github", "chrome", "safari", "firefox", "arc", "whatsapp", "telegram", "upwork", "notion", "figma", "spotify", "amazon", "google", "maps", "calendar", "finder", "browser", "website", "page", "tab", "app", "screen", "slack",
];

fn norm(s: &str) -> String {
    let t = s.to_lowercase().replace(|c: char| !c.is_alphanumeric() && c != '.', " ");
    format!(" {} ", t.split_whitespace().collect::<Vec<_>>().join(" "))
}

fn has_phrase(hay: &str, phrase: &str) -> bool {
    hay.contains(&format!(" {} ", phrase.trim()))
}

/// "open LinkedIn and like the first post" / "go to youtube, play lofi" / a link → on screen.
/// A bare "open Slack" is left to the assistant, which opens it instantly without AI.
pub fn is_screen_task(goal: &str) -> bool {
    let q = norm(goal);
    let verb = SCREEN_VERBS.iter().any(|v| has_phrase(&q, v));
    let place = SCREEN_PLACES.iter().any(|p| has_phrase(&q, p)) || goal.contains("://") || q.contains(".com ");
    let compound = has_phrase(&q, "and") || has_phrase(&q, "then") || goal.contains(',');
    let simple_open = (q.starts_with(" open ") || q.starts_with(" launch ")) && !compound;
    verb && place && !simple_open
}

/// Which enabled MCP servers the goal names ("in Notion …", "using github").
pub fn named_servers(goal: &str, servers: &[String]) -> Vec<String> {
    let q = norm(goal);
    servers
        .iter()
        .filter(|n| {
            let p = norm(n);
            p.trim().chars().count() >= 3 && q.contains(&p)
        })
        .cloned()
        .collect()
}

/// Pick the worker for a request. `skills` are (name, triggers) of enabled skills.
pub fn plan(goal: &str, skills: &[(String, String)], servers: &[String], cfg: &AgentConfig) -> RoutePlan {
    // "connect to Mobbin MCP" is about setting up an app, not using one: Flo opens Apps for it
    if crate::intents::parse_connect_mcp(goal.trim().trim_end_matches(['.', '!', '?']).to_lowercase().trim()).is_some() {
        return RoutePlan { route: "answer".into(), reason: "Sets up an app connection".into(), target: None };
    }
    if cfg.allow_skills {
        if let Some(i) = text::match_skill(goal, skills) {
            let name = skills[i].0.clone();
            return RoutePlan { route: "skill".into(), reason: format!("Uses your {name} skill"), target: Some(name) };
        }
    }
    let named = if cfg.allow_tools { named_servers(goal, servers) } else { vec![] };
    if !named.is_empty() {
        let names = named.join(", ");
        if cfg.engine == "hermes" {
            return RoutePlan { route: "hermes".into(), reason: format!("Hermes with {names}"), target: Some(names) };
        }
        return RoutePlan { route: "tools".into(), reason: format!("Uses {names}"), target: Some(names) };
    }
    if cfg.allow_screen && is_screen_task(goal) {
        return RoutePlan { route: "screen".into(), reason: "Works on your screen".into(), target: None };
    }
    if cfg.engine == "hermes" {
        return RoutePlan { route: "hermes".into(), reason: "Answered by Hermes".into(), target: None };
    }
    RoutePlan { route: "answer".into(), reason: "Flo answers or acts directly".into(), target: None }
}

/// The goal handed to the screen agent, with the user's persona / instructions / extra caution.
pub fn screen_goal(goal: &str, cfg: &AgentConfig) -> String {
    let mut g = goal.trim().to_string();
    if !cfg.persona.trim().is_empty() {
        g.push_str(&format!("\n\nAct as: {}", text::truncate_chars(cfg.persona.trim(), 400)));
    }
    if !cfg.instructions.trim().is_empty() {
        g.push_str(&format!("\n\nThe user's standing instructions: {}", text::truncate_chars(cfg.instructions.trim(), 1200)));
    }
    if cfg.confirm_every_step {
        g.push_str("\n\nThe user wants to approve every step: return a \"confirm\" action before each click, keystroke or page change.");
    }
    g
}

// ── running ─────────────────────────────────────────────────────────────────
fn enabled_servers(st: &Shared) -> Vec<crate::model::Connection> {
    st.db.list_connections().unwrap_or_default().into_iter().filter(|c| c.kind == "mcp" && c.enabled).collect()
}

fn enabled_skills(st: &Shared) -> Vec<crate::model::Skill> {
    st.db.list_skills().unwrap_or_default().into_iter().filter(|k| k.enabled).collect()
}

pub fn plan_for(st: &Shared, goal: &str) -> RoutePlan {
    let cfg = load_config(&st.data_dir);
    let skills: Vec<(String, String)> = enabled_skills(st).iter().map(|k| (k.name.clone(), k.triggers.clone())).collect();
    let servers: Vec<String> = enabled_servers(st).iter().map(|c| c.name.clone()).collect();
    plan(goal, &skills, &servers, &cfg)
}

/// Start a run and return right away; progress arrives as `EV_RUN` snapshots.
pub fn start(st: &Shared, goal: &str, source: &str) -> Result<AgentRun> {
    ensure_loaded(&st.data_dir);
    let goal = goal.trim();
    if goal.is_empty() {
        return Err(anyhow!("Say what Flo Agent should do."));
    }
    if let Some(id) = active_id() {
        if RUNS.lock().list.iter().any(|x| x.id == id && !x.finished()) {
            return Err(anyhow!("Flo Agent is already working on something. Stop it first."));
        }
    }
    let cfg = load_config(&st.data_dir);
    let p = plan_for(st, goal);
    let mut run = AgentRun {
        id: crate::db::new_id(),
        goal: text::truncate_chars(goal, 2000),
        route: p.route.clone(),
        engine: cfg.engine.clone(),
        source: source.into(),
        skill: if p.route == "skill" { p.target.clone() } else { None },
        started_at: chrono::Local::now().to_rfc3339(),
        ..Default::default()
    };
    run.push("route", &p.reason);
    let run = insert(st, run, true);
    let st2 = st.clone();
    let id = run.id.clone();
    let g = goal.to_string();
    tauri::async_runtime::spawn(async move {
        let out = execute(&st2, &id, &g, &p, &cfg).await;
        match out {
            Ok(Some(reply)) => {
                update(&st2, &id, |r| {
                    r.finish("done", &reply);
                });
            }
            // handed to the screen agent: its done / stopped / error event closes the run
            Ok(None) => {}
            Err(err) => {
                let msg = err.to_string();
                update(&st2, &id, |r| {
                    r.finish(if msg == "Stopped." { "stopped" } else { "failed" }, &msg);
                });
            }
        }
    });
    Ok(run)
}

async fn execute(st: &Shared, id: &str, goal: &str, p: &RoutePlan, cfg: &AgentConfig) -> Result<Option<String>> {
    let front = FrontApp::default();
    match p.route.as_str() {
        "screen" => {
            let r = crate::agent::run(st, &screen_goal(goal, cfg)).await?;
            Ok(Some(r))
        }
        "skill" => {
            let k = enabled_skills(st).into_iter().find(|k| Some(&k.name) == p.target.as_ref()).ok_or_else(|| anyhow!("That skill is gone."))?;
            let has_tools = enabled_servers(st).iter().any(|c| k.connections.contains(&c.id));
            if k.mode == "do" && !has_tools {
                let _ = st.db.bump_skill_use(&k.id);
                update(st, id, |r| r.push("step", &format!("Handing your {} steps to the screen agent", k.name)));
                let g = format!("{goal}\n\nDo it the way my \"{}\" skill says:\n{}", k.name, k.instructions);
                return Ok(Some(crate::agent::run(st, &screen_goal(&g, cfg)).await?));
            }
            if has_tools {
                update(st, id, |r| r.push("step", "Connecting to the skill's apps"));
            }
            answer(st, id, goal, &front).await
        }
        "tools" => {
            let names = p.target.clone().unwrap_or_default();
            let servers: Vec<_> = enabled_servers(st).into_iter().filter(|c| names.split(", ").any(|n| n == c.name)).collect();
            update(st, id, |r| r.push("step", &format!("Connecting to {names}")));
            let s = st.settings();
            let llm = crate::llm::LlmConfig::from_settings(&s);
            if !llm.is_configured() {
                return Err(anyhow!("Pick an AI model in Settings → AI so Flo Agent can use your apps."));
            }
            let context = crate::assistant::build_context(st, goal, None, &front, None);
            let mut system = format!(
                "You are Flo Agent, the user's assistant on their Mac. Use the connected apps' tools to do what they ask, then reply with a short plain summary of what you did or found. Never send, post, pay or delete anything unless the user explicitly asked for exactly that.\n\n{context}"
            );
            system.push_str(&persona_note(cfg));
            let (reply, used) = crate::mcp::run_with_tools(st, &llm, &system, goal, None, &servers, s.assistant_cloud_allowed).await?;
            for t in &used {
                update(st, id, |r| r.push("tool", &format!("Used {t}")));
            }
            Ok(Some(text::strip_ai_dashes(&reply)))
        }
        "hermes" => {
            let st2 = st.clone();
            let id2 = id.to_string();
            let mut prompt = goal.to_string();
            prompt.push_str(&persona_note(cfg));
            let reply = crate::hermes::ask(st, &prompt, move |line| {
                update(&st2, &id2, |r| r.push("output", &line));
            })
            .await?;
            Ok(Some(reply))
        }
        _ => answer(st, id, goal, &front).await,
    }
}

fn persona_note(cfg: &AgentConfig) -> String {
    let mut s = String::new();
    if !cfg.persona.trim().is_empty() {
        s.push_str(&format!("\n\nYour persona: {}", cfg.persona.trim()));
    }
    if !cfg.instructions.trim().is_empty() {
        s.push_str(&format!("\n\nThe user's standing instructions (follow them): {}", cfg.instructions.trim()));
    }
    if cfg.memory {
        s.push_str(&memory_lines());
    }
    s
}

/// The assistant path (instant commands, skills, answers). A reply that hands work to the screen
/// agent keeps the run open until that finishes.
async fn answer(st: &Shared, id: &str, goal: &str, front: &FrontApp) -> Result<Option<String>> {
    let resp = crate::assistant::run_mode(st, goal, None, front, None, "quick").await?;
    let _ = st.db.insert_assistant(&resp);
    for r in &resp.results {
        update(st, id, |run| run.push("step", r));
    }
    let handed_off = resp.actions.iter().any(|a| matches!(a, crate::model::AssistantAction::Automate { .. }));
    if handed_off {
        update(st, id, |run| {
            run.route = "screen".into();
        });
        return Ok(None);
    }
    Ok(Some(resp.reply))
}

/// Stop the running run (screen agent and Hermes).
pub fn stop(st: &Shared, id: &str) {
    st.agent_abort.store(true, std::sync::atomic::Ordering::SeqCst);
    crate::hermes::cancel_ask();
    update(st, id, |r| {
        r.finish("stopped", "Stopped.");
    });
}

// ── screen agent events → timeline ─────────────────────────────────────────
/// What one `flo://agent` event does to the timeline (pure; unit tested).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentEventEffect {
    /// a screen run started with no Flo Agent run open (voice / notch): open one
    Open { goal: String },
    Step { kind: String, text: String },
    Finish { status: String, text: String },
    Ignore,
}

pub fn agent_event_effect(kind: &str, text: &str, has_active: bool) -> AgentEventEffect {
    match kind {
        "start" if !has_active => AgentEventEffect::Open { goal: text.lines().next().unwrap_or(text).to_string() },
        "start" => AgentEventEffect::Step { kind: "step".into(), text: "Looking at your screen".into() },
        "step" => AgentEventEffect::Step { kind: "step".into(), text: text.into() },
        "confirm" => AgentEventEffect::Step { kind: "confirm".into(), text: text.into() },
        "done" => AgentEventEffect::Finish { status: "done".into(), text: text.into() },
        "aborted" => AgentEventEffect::Finish { status: "stopped".into(), text: text.into() },
        "error" => AgentEventEffect::Finish { status: "failed".into(), text: text.into() },
        _ => AgentEventEffect::Ignore,
    }
}

fn on_agent_event(st: &Shared, kind: &str, text: &str) {
    let active = active_id().filter(|id| RUNS.lock().list.iter().any(|x| &x.id == id && !x.finished()));
    match (agent_event_effect(kind, text, active.is_some()), active) {
        (AgentEventEffect::Open { goal }, _) => {
            let mut run = AgentRun {
                id: crate::db::new_id(),
                goal: text::truncate_chars(&goal, 2000),
                route: "screen".into(),
                source: "voice".into(),
                started_at: chrono::Local::now().to_rfc3339(),
                ..Default::default()
            };
            run.push("route", "Works on your screen");
            insert(st, run, true);
        }
        (AgentEventEffect::Step { kind, text }, Some(id)) => {
            update(st, &id, |r| {
                r.push(&kind, &text);
                r.status = if kind == "confirm" { "waiting".into() } else { "running".into() };
            });
        }
        (AgentEventEffect::Finish { status, text }, Some(id)) => {
            update(st, &id, |r| {
                r.finish(&status, &text);
            });
        }
        _ => {}
    }
}

/// Listen to the screen agent for the life of the app (event driven, nothing polls).
pub fn spawn(st: Shared) {
    use tauri::Listener;
    ensure_loaded(&st.data_dir);
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<(String, String)>();
    st.app.listen_any(ev::AGENT, move |event| {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(event.payload()) {
            let _ = tx.send((v["kind"].as_str().unwrap_or_default().to_string(), v["text"].as_str().unwrap_or_default().to_string()));
        }
    });
    tauri::async_runtime::spawn(async move {
        while let Some((kind, text)) = rx.recv().await {
            on_agent_event(&st, &kind, &text);
        }
    });
}

// ── commands ───────────────────────────────────────────────────────────────
#[tauri::command]
pub fn flo_agent_config(st: State<Shared>) -> AgentConfig {
    load_config(&st.data_dir)
}

#[tauri::command]
pub fn flo_agent_save_config(st: State<Shared>, config: AgentConfig) -> R<AgentConfig> {
    save_config(&st.data_dir, &config).map_err(e)?;
    Ok(load_config(&st.data_dir))
}

#[tauri::command]
pub fn flo_agent_runs(st: State<Shared>) -> Vec<AgentRun> {
    ensure_loaded(&st.data_dir);
    RUNS.lock().list.clone()
}

#[tauri::command]
pub fn flo_agent_plan(st: State<Shared>, goal: String) -> RoutePlan {
    plan_for(st.inner(), &goal)
}

#[tauri::command]
pub fn flo_agent_run(st: State<Shared>, goal: String, source: Option<String>) -> R<AgentRun> {
    start(st.inner(), &goal, source.as_deref().unwrap_or("typed")).map_err(e)
}

#[tauri::command]
pub fn flo_agent_stop(st: State<Shared>, id: String) {
    stop(st.inner(), &id);
}

#[tauri::command]
pub fn flo_agent_clear_runs(st: State<Shared>) {
    ensure_loaded(&st.data_dir);
    RUNS.lock().list.retain(|x| !x.finished());
    persist(&st.data_dir);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> AgentConfig {
        AgentConfig::default()
    }
    fn skills() -> Vec<(String, String)> {
        vec![("Upwork proposal".into(), "proposal for this job, apply to this job".into()), ("Slack reply".into(), "reply on slack".into())]
    }

    #[test]
    fn on_screen_tasks_go_to_the_screen_agent() {
        for g in ["open LinkedIn and like the first post", "Go to youtube, search lofi and play the first video", "open https://news.ycombinator.com then open the top story", "search google for flights to Goa and open the first result"] {
            assert_eq!(plan(g, &[], &[], &cfg()).route, "screen", "{g}");
        }
    }

    #[test]
    fn a_bare_open_or_a_question_stays_with_the_assistant() {
        assert_eq!(plan("open Slack", &[], &[], &cfg()).route, "answer");
        assert_eq!(plan("what's blocked across my projects?", &[], &[], &cfg()).route, "answer");
        assert_eq!(plan("add a to-do: send the deck by Friday", &[], &[], &cfg()).route, "answer");
    }

    #[test]
    fn skills_win_over_everything() {
        let p = plan("write a proposal for this job on upwork", &skills(), &[], &cfg());
        assert_eq!((p.route.as_str(), p.target.as_deref()), ("skill", Some("Upwork proposal")));
        // … unless skills are switched off in Customize
        let off = AgentConfig { allow_skills: false, ..cfg() };
        assert_ne!(plan("write a proposal for this job on upwork", &skills(), &[], &off).route, "skill");
    }

    #[test]
    fn naming_a_connected_app_uses_its_tools() {
        let servers = vec!["Notion".to_string(), "GitHub".to_string(), "x".to_string()];
        let p = plan("in Notion, find my meeting notes from Monday", &[], &servers, &cfg());
        assert_eq!((p.route.as_str(), p.target.as_deref()), ("tools", Some("Notion")));
        // a one-letter server name never matches by accident
        assert_eq!(named_servers("fix x", &servers), Vec::<String>::new());
        let off = AgentConfig { allow_tools: false, ..cfg() };
        assert_ne!(plan("in Notion, find my notes", &[], &servers, &off).route, "tools");
    }

    #[test]
    fn hermes_engine_takes_tool_and_answer_tasks_but_not_the_screen() {
        let h = AgentConfig { engine: "hermes".into(), ..cfg() };
        assert_eq!(plan("summarize my week", &[], &[], &h).route, "hermes");
        assert_eq!(plan("in Notion, find my notes", &[], &["Notion".into()], &h).route, "hermes");
        assert_eq!(plan("open LinkedIn and like the first post", &[], &[], &h).route, "screen");
        assert_eq!(plan("write a proposal for this job", &skills(), &[], &h).route, "skill");
    }

    #[test]
    fn screen_switched_off_never_drives_the_mouse() {
        let off = AgentConfig { allow_screen: false, ..cfg() };
        assert_eq!(plan("open LinkedIn and like the first post", &[], &[], &off).route, "answer");
    }

    #[test]
    fn screen_goal_carries_persona_and_extra_caution() {
        let c = AgentConfig { persona: "A careful recruiter".into(), instructions: "Write in English.".into(), confirm_every_step: true, ..cfg() };
        let g = screen_goal("open LinkedIn and connect with Rahul", &c);
        assert!(g.starts_with("open LinkedIn and connect with Rahul"));
        assert!(g.contains("A careful recruiter") && g.contains("Write in English.") && g.contains("confirm"));
        assert_eq!(screen_goal("open LinkedIn and post", &cfg()), "open LinkedIn and post");
    }

    #[test]
    fn agent_events_map_to_timeline_steps() {
        assert_eq!(agent_event_effect("start", "open youtube and play lofi", false), AgentEventEffect::Open { goal: "open youtube and play lofi".into() });
        assert!(matches!(agent_event_effect("start", "x", true), AgentEventEffect::Step { .. }));
        assert_eq!(agent_event_effect("confirm", "Send it?", true), AgentEventEffect::Step { kind: "confirm".into(), text: "Send it?".into() });
        assert_eq!(agent_event_effect("aborted", "Cancelled", true), AgentEventEffect::Finish { status: "stopped".into(), text: "Cancelled".into() });
        assert_eq!(agent_event_effect("error", "no model", true), AgentEventEffect::Finish { status: "failed".into(), text: "no model".into() });
        assert_eq!(agent_event_effect("listening", "", true), AgentEventEffect::Ignore);
    }

    #[test]
    fn a_run_finishes_once_and_caps_its_steps() {
        let mut r = AgentRun { id: "a".into(), ..Default::default() };
        for i in 0..(MAX_STEPS + 20) {
            r.push("step", &format!("step {i}"));
        }
        assert_eq!(r.steps.len(), MAX_STEPS);
        assert!(r.finish("done", "Played it."));
        assert!(!r.finish("failed", "late error"));
        assert_eq!((r.status.as_str(), r.result.as_deref()), ("done", Some("Played it.")));
        r.push("step", "   ");
        assert_eq!(r.steps.last().unwrap().kind, "done");
    }

    #[test]
    fn config_round_trips_and_rejects_unknown_engines() {
        let dir = std::env::temp_dir().join(format!("flo-agent-cfg-{}", std::process::id()));
        let c = AgentConfig { engine: "skynet".into(), persona: "  calm  ".into(), memory: false, ..cfg() };
        save_config(&dir, &c).unwrap();
        let back = load_config(&dir);
        assert_eq!((back.engine.as_str(), back.persona.as_str(), back.memory), ("flo", "calm", false));
        let _ = std::fs::remove_dir_all(dir);
    }
}
