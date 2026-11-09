//! Voice assistant: builds context (projects, to-dos, notes, selection, screen), asks the LLM
//! for a JSON plan, then executes the actions locally.
use crate::egress::Purpose;
use crate::llm::{self, ChatRequest, LlmConfig};
use crate::model::*;
use crate::platform::{self, FrontApp};
use crate::state::Shared;
use crate::{db, meeting, prompts, settings as cfg, text};
use anyhow::{anyhow, Result};

pub fn build_context(st: &Shared, query: &str, selection: Option<&str>, front: &FrontApp, screen: Option<&str>) -> String {
    let s = st.settings();
    let now = chrono::Local::now();
    let mut c = format!("Today: {} ({})\n", now.format("%Y-%m-%d %H:%M"), now.format("%A"));
    // user's knowledge base: pinned docs + only the chunks relevant to this request
    if let Ok(docs) = st.db.enabled_context() {
        let picked = text::select_context(&format!("{query} {}", selection.unwrap_or("")), &docs, 2500);
        if !picked.is_empty() {
            c.push_str(&format!("\nUser's context notes (use when relevant):\n{picked}\n\n"));
        }
    }
    if !s.user_name.is_empty() {
        c.push_str(&format!("User: {}\n", s.user_name));
    }
    if !front.name.is_empty() {
        c.push_str(&format!("Focused app: {}\n", front.name));
    }
    let projects = st.db.list_projects().unwrap_or_default();
    let todos = st.db.list_todos().unwrap_or_default();
    c.push_str("\nProjects:\n");
    if projects.is_empty() {
        c.push_str("(none yet)\n");
    }
    for p in &projects {
        c.push_str(&format!("- {} [{}]{}\n", p.name, p.status, p.description.as_deref().map(|d| format!(": {d}")).unwrap_or_default()));
        for t in todos.iter().filter(|t| t.project_id.as_deref() == Some(&p.id) && t.status == "open").take(8) {
            c.push_str(&format!("    • {}{}\n", t.title, t.due.as_deref().map(|d| format!(" (due {d})")).unwrap_or_default()));
        }
    }
    let loose: Vec<_> = todos.iter().filter(|t| t.project_id.is_none() && t.status == "open").take(10).collect();
    if !loose.is_empty() {
        c.push_str("\nOther open to-dos:\n");
        for t in loose {
            c.push_str(&format!("- {}{}\n", t.title, t.due.as_deref().map(|d| format!(" (due {d})")).unwrap_or_default()));
        }
    }
    let notes = st.db.list_notes().unwrap_or_default();
    if !notes.is_empty() {
        c.push_str("\nRecent notes:\n");
        for n in notes.iter().take(3) {
            let first = n.summary.lines().next().unwrap_or("");
            c.push_str(&format!("- {} ({}): {}\n", n.title, &n.created_at[..10.min(n.created_at.len())], text::truncate_chars(first, 100)));
        }
    }
    if st.meeting.lock().is_some() {
        c.push_str("\nA meeting recording is currently running.\n");
    }
    if let Some(sel) = selection {
        c.push_str(&format!("\nSelected text in {}:\n\"\"\"\n{}\n\"\"\"\n", front.name, text::truncate_chars(sel, 4000)));
    }
    if let Some(scr) = screen {
        c.push_str(&format!("\nVisible text on screen (OCR, may be noisy):\n\"\"\"\n{}\n\"\"\"\n", text::truncate_chars(scr, 2000)));
    }
    c
}

/// Context of recent answers so "Go deeper" / "Search the web" reuse the same question + screen.
#[derive(Clone)]
struct Ctx {
    query: String,
    selection: Option<String>,
    front: FrontApp,
    screen: Option<String>,
}
static RECENT: parking_lot::Mutex<Vec<(String, Ctx)>> = parking_lot::Mutex::new(Vec::new());

/// A pending "Add MCP server" form for the dashboard (set by a voice request, taken once).
pub static MCP_PREFILL: parking_lot::Mutex<Option<serde_json::Value>> = parking_lot::Mutex::new(None);

fn remember(id: &str, c: Ctx) {
    let mut r = RECENT.lock();
    r.push((id.to_string(), c));
    if r.len() > 20 {
        r.remove(0);
    }
}

/// Re-ask a previous question in "deep" (screenshot + detailed) or "web" (search) mode.
pub async fn followup(st: &Shared, id: &str, mode: &str) -> Result<AssistantResponse> {
    let c = RECENT.lock().iter().rev().find(|(i, _)| i == id).map(|(_, c)| c.clone()).ok_or_else(|| anyhow!("That answer expired. Ask again."))?;
    run_mode(st, &c.query, c.selection, &c.front, c.screen, mode).await
}

pub async fn run(st: &Shared, query: &str, selection: Option<String>, front: &FrontApp, screen: Option<String>) -> Result<AssistantResponse> {
    run_mode(st, query, selection, front, screen, "quick").await
}

pub async fn run_mode(st: &Shared, query: &str, selection: Option<String>, front: &FrontApp, screen: Option<String>, mode: &str) -> Result<AssistantResponse> {
    let ctx = Ctx { query: query.to_string(), selection: selection.clone(), front: front.clone(), screen: screen.clone() };
    // 1) instant local commands ("open Slack", "google …", "play … on youtube") — no AI needed
    if selection.is_none() && mode == "quick" {
        if let Some(intent) = crate::intents::parse(query) {
            let result = execute(st, &intent.action, front, false).await;
            let (reply, results) = match result {
                Ok(r) => (intent.reply, vec![r]),
                Err(e) => (format!("Couldn't do that: {e}"), vec![]),
            };
            return Ok(AssistantResponse {
                id: db::new_id(),
                query: query.into(),
                reply,
                actions: vec![intent.action],
                results,
                created_at: chrono::Local::now().to_rfc3339(),
                mode: "quick".into(),
                sources: vec![],
            });
        }
    }
    // 2) the user's own skills ("use my Upwork proposal skill"): instructions they wrote once
    let skill = st.db.list_skills().ok().and_then(|all| {
        let all: Vec<_> = all.into_iter().filter(|k| k.enabled).collect();
        let keys: Vec<(String, String)> = all.iter().map(|k| (k.name.clone(), k.triggers.clone())).collect();
        text::match_skill(query, &keys).map(|i| all[i].clone())
    });
    if let Some(k) = &skill {
        let _ = st.db.bump_skill_use(&k.id);
        log::info!("skill: {} ({})", k.name, k.mode);
        // skills wired to MCP servers on the canvas run with those servers' tools
        let servers: Vec<crate::model::Connection> = st
            .db
            .list_connections()
            .unwrap_or_default()
            .into_iter()
            .filter(|c| c.kind == "mcp" && c.enabled && k.connections.contains(&c.id))
            .collect();
        if !servers.is_empty() {
            return run_skill_with_tools(st, query, k, &servers, front, screen.as_deref(), mode).await;
        }
        if k.mode == "do" {
            // operate the screen: hand the request + the skill's steps to the computer-control agent
            let goal = format!("{query}\n\nDo it the way my \"{}\" skill says:\n{}", k.name, k.instructions);
            let action = AssistantAction::Automate { goal };
            let result = execute(st, &action, front, false).await;
            let (reply, results) = match result {
                Ok(r) => (format!("Running your {} skill.", k.name), vec![r]),
                Err(e) => (format!("Couldn't run {}: {e}", k.name), vec![]),
            };
            return Ok(AssistantResponse {
                id: db::new_id(),
                query: query.into(),
                reply,
                actions: vec![action],
                results,
                created_at: chrono::Local::now().to_rfc3339(),
                mode: mode.into(),
                sources: vec![],
            });
        }
    }
    let s = st.settings();
    let cfgl = LlmConfig::from_settings(&s);
    if !cfgl.is_configured() {
        return Err(anyhow!("Pick an AI model in Settings → AI to ask questions (“open …” and “google …” work without one)."));
    }
    // screen OCR is the largest prompt cost — only include it when the request is about the screen
    // (always in deep mode, where a screenshot is attached as well)
    // a "write" skill is a writing task: it reads the screen and types the result
    let drafting = skill.is_some() || text::is_writing_request(query);
    let screen = screen.filter(|_| mode == "deep" || drafting || text::wants_screen_context(query));
    let s_web = mode == "web";
    if s_web && !llm::supports_web(&s.llm_provider) {
        // provider can't search: hand the question to Perplexity instead of guessing
        let url = format!("https://www.perplexity.ai/search?q={}", url::form_urlencoded::byte_serialize(query.as_bytes()).collect::<String>());
        let _ = tauri_plugin_opener::open_url(&url, None::<&str>);
        return Ok(AssistantResponse {
            id: db::new_id(),
            query: query.into(),
            reply: "Your AI model can't search the web, so I opened Perplexity with your question. Claude and Gemini can search right here.".into(),
            actions: vec![],
            results: vec![],
            created_at: chrono::Local::now().to_rfc3339(),
            mode: "web".into(),
            sources: vec![],
        });
    }
    // a screenshot for deep answers, and for drafts so the model reads the conversation it replies to
    let wants_image = mode == "deep" || (drafting && llm::supports_vision(&s.llm_provider));
    let image = if wants_image && s.assistant_screen_context && crate::platform::permissions().screen {
        tokio::task::spawn_blocking(|| crate::attention::capture_focused_jpeg(1280)).await.ok().flatten().map(|(_, b)| b)
    } else {
        None
    };
    let context = build_context(st, query, selection.as_deref(), front, screen.as_deref());
    let mut system = prompts::assistant_system(&context);
    system.push_str(prompts::assistant_mode_note(mode));
    if drafting {
        system.push_str(prompts::DRAFTING_NOTE);
    }
    if let Some(k) = &skill {
        system.push_str(&prompts::skill_note(&k.name, &k.instructions, &k.platforms));
        system.push_str(&skill_docs(st, k));
    }
    if !s.system_prompt.trim().is_empty() {
        system.push_str(&format!("\n\nThe user's own instructions (follow them):\n{}", text::truncate_chars(s.system_prompt.trim(), 2000)));
    }
    let (raw, sources) = llm::chat_ex(
        &st.egress,
        &cfgl,
        ChatRequest {
            system: &system,
            user: query,
            image_b64: image.as_deref().map(|b| ("image/jpeg", b)),
            json: !s_web,
            purpose: Purpose::Assistant,
            cloud_allowed: s.assistant_cloud_allowed,
            max_tokens: match mode {
                "deep" | "web" => 2500,
                _ if selection.is_some() || drafting => 1500,
                _ => 600,
            },
        },
        llm::Extras { web: s_web, deep: mode == "deep" },
    )
    .await
    .map_err(|e| {
        if cfg::is_cloud_llm(&s.llm_provider) && !s.assistant_cloud_allowed {
            anyhow!("Assistant is set to on-device only. Allow cloud AI in Settings → Privacy, or choose a local model.")
        } else {
            e
        }
    })?;
    let mut parsed = prompts::parse_assistant(&raw);
    parsed.reply = text::strip_ai_dashes(&parsed.reply);
    let mut results = vec![];
    for a in &parsed.actions {
        match execute(st, a, front, selection.is_some()).await {
            Ok(r) => results.push(r),
            Err(e) => results.push(format!("⚠️ {e}")),
        }
    }
    let id = db::new_id();
    remember(&id, ctx);
    Ok(AssistantResponse {
        id,
        query: query.into(),
        reply: if parsed.reply.is_empty() && !results.is_empty() { "Done.".into() } else { parsed.reply },
        actions: parsed.actions,
        results,
        created_at: chrono::Local::now().to_rfc3339(),
        mode: mode.into(),
        sources,
    })
}

/// The Knowledge documents a skill attaches ("doc:<id>" on the canvas), as prompt text.
pub(crate) fn skill_docs(st: &Shared, k: &crate::model::Skill) -> String {
    let docs = st.db.list_context_docs().unwrap_or_default();
    let mut out = String::new();
    for id in k.connections.iter().filter_map(|c| c.strip_prefix("doc:")) {
        let title = docs.iter().find(|d| d.id == id).map(|d| d.title.clone()).unwrap_or_else(|| "Document".into());
        if let Ok(Some(content)) = st.db.get_context_content(id) {
            out.push_str(&format!("\n\nReference document \"{title}\" (attached to this skill):\n\"\"\"\n{}\n\"\"\"", text::truncate_chars(&content, 6000)));
        }
    }
    out
}

/// Run an invoked skill with the tools of its MCP servers, then type the result (write) or report it (do).
async fn run_skill_with_tools(
    st: &Shared,
    query: &str,
    k: &crate::model::Skill,
    servers: &[crate::model::Connection],
    front: &FrontApp,
    screen: Option<&str>,
    mode: &str,
) -> Result<AssistantResponse> {
    let s = st.settings();
    let cfgl = LlmConfig::from_settings(&s);
    if !cfgl.is_configured() {
        return Err(anyhow!("Pick an AI model in Settings → AI to run skills."));
    }
    let context = build_context(st, query, None, front, screen);
    let system = prompts::skill_tools_system(&context, &k.name, &k.instructions, &k.mode, &skill_docs(st, k));
    let image = if k.mode != "do" && s.assistant_screen_context && llm::supports_vision(&s.llm_provider) && crate::platform::permissions().screen {
        tokio::task::spawn_blocking(|| crate::attention::capture_focused_jpeg(1280)).await.ok().flatten().map(|(_, b)| b)
    } else {
        None
    };
    let (text_out, used) = crate::mcp::run_with_tools(st, &cfgl, &system, query, image.as_deref().map(|b| ("image/jpeg", b)), servers, s.assistant_cloud_allowed).await?;
    let text_out = text::strip_ai_dashes(&text_out);
    let mut actions = vec![];
    let mut results = vec![];
    if !used.is_empty() {
        results.push(format!("Used {} tool call{}: {}", used.len(), if used.len() == 1 { "" } else { "s" }, used.join(", ")));
    }
    let reply = if k.mode == "do" || text_out.is_empty() {
        text_out.clone()
    } else {
        let action = AssistantAction::InsertText { text: text_out.clone() };
        match execute(st, &action, front, false).await {
            Ok(r) => results.push(r),
            Err(e) => results.push(format!("⚠️ {e}")),
        }
        actions.push(action);
        format!("Done with your {} skill.", k.name)
    };
    Ok(AssistantResponse {
        id: db::new_id(),
        query: query.into(),
        reply: if reply.is_empty() { "Done.".into() } else { reply },
        actions,
        results,
        created_at: chrono::Local::now().to_rfc3339(),
        mode: mode.into(),
        sources: vec![],
    })
}

fn project_id_for(st: &Shared, name: Option<&str>, create: bool) -> Result<Option<String>> {
    let Some(n) = name.map(str::trim).filter(|n| !n.is_empty()) else { return Ok(None) };
    if let Some(p) = st.db.find_project(n)? {
        return Ok(Some(p.id));
    }
    if create {
        let p = st.db.create_project(n, None)?;
        st.emit(ev::PROJECTS, ());
        return Ok(Some(p.id));
    }
    Err(anyhow!("No project called “{n}”"))
}

pub async fn execute(st: &Shared, a: &AssistantAction, front: &FrontApp, had_selection: bool) -> Result<String> {
    match a {
        AssistantAction::AddTodo { title, project, due } => {
            let pid = project_id_for(st, project.as_deref(), true)?;
            let t = st.db.add_todo(title, "assistant", pid, due.clone())?;
            st.emit(ev::TODOS, ());
            st.emit(ev::PROJECTS, ());
            Ok(format!("Added to-do: {}", t.title))
        }
        AssistantAction::CompleteTodo { matcher } => {
            let open: Vec<(String, String)> = st
                .db
                .list_todos()?
                .into_iter()
                .filter(|t| t.status == "open" || t.status == "snoozed")
                .map(|t| (t.id, t.title))
                .collect();
            let (id, title) = text::best_match(matcher, &open).ok_or_else(|| anyhow!("Couldn't find a to-do like “{matcher}”"))?.clone();
            st.db.update_todo(&id, Some("done"), None, None)?;
            st.emit(ev::TODOS, ());
            st.emit(ev::PROJECTS, ());
            Ok(format!("Completed: {title}"))
        }
        AssistantAction::CreateProject { name, description } => {
            if st.db.find_project(name)?.map(|p| p.name.eq_ignore_ascii_case(name)).unwrap_or(false) {
                return Ok(format!("Project {name} already exists"));
            }
            st.db.create_project(name, description.as_deref())?;
            if st.settings().vault_auto {
                let _ = crate::vault::upsert(st, name, "project", description.as_deref().unwrap_or(""));
                st.emit(ev::VAULT, ());
            }
            st.emit(ev::PROJECTS, ());
            Ok(format!("Created project {name}"))
        }
        AssistantAction::SetProjectStatus { project, status } => {
            let valid = ["active", "paused", "blocked", "done"];
            if !valid.contains(&status.as_str()) {
                return Err(anyhow!("Unknown status {status}"));
            }
            let id = project_id_for(st, Some(project), false)?.unwrap();
            st.db.update_project(&id, None, None, Some(status))?;
            st.emit(ev::PROJECTS, ());
            Ok(format!("{project} → {status}"))
        }
        AssistantAction::AddProjectNote { project, text: body } => {
            let pid = project_id_for(st, Some(project), true)?;
            let n = Note {
                id: db::new_id(),
                title: format!("Note · {project}"),
                kind: "project".into(),
                project_id: pid,
                transcript: vec![],
                summary: body.clone(),
                action_items: vec![],
                duration_sec: 0.0,
                created_at: chrono::Local::now().to_rfc3339(),
                live: false,
            };
            st.db.upsert_note(&n)?;
            st.emit(ev::NOTES, ());
            st.emit(ev::PROJECTS, ());
            Ok(format!("Saved a note to {project}"))
        }
        AssistantAction::StartMeeting { title, project } => {
            let pid = project_id_for(st, project.as_deref(), true)?;
            let n = meeting::start(st.clone(), title.clone(), pid)?;
            Ok(format!("Recording “{}”", n.title))
        }
        AssistantAction::StopMeeting => {
            let n = meeting::stop(st.clone()).await?;
            Ok(format!("Stopped “{}”, summary ready", n.title))
        }
        AssistantAction::OpenUrl { url } => {
            let u = url::Url::parse(url)?;
            if !matches!(u.scheme(), "http" | "https") {
                return Err(anyhow!("Only web links can be opened"));
            }
            tauri_plugin_opener::open_url(u.as_str(), None::<&str>)?;
            Ok(format!("Opened {}", u.host_str().unwrap_or("link")))
        }
        AssistantAction::OpenApp { name } => {
            platform::open_app(name)?;
            Ok(format!("Opened {name}"))
        }
        AssistantAction::SlackSend { to, text: body } => crate::slack::propose_send(st, to, body).await,
        AssistantAction::Automate { goal } => {
            let st2 = st.clone();
            let g = goal.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = crate::agent::run(&st2, &g).await {
                    st2.emit(crate::model::ev::AGENT, serde_json::json!({ "kind": "error", "text": e.to_string() }));
                    st2.toast("error", format!("Screen control: {e}"));
                }
            });
            Ok(format!("On it — {goal}"))
        }
        AssistantAction::ConnectMcp { name, url } => {
            let want = name.to_lowercase();
            let existing = st.db.list_connections().unwrap_or_default().into_iter().find(|c| {
                c.kind == "mcp" && {
                    let have = c.name.to_lowercase();
                    have == want || have.contains(&want) || want.contains(&have) || crate::intents::known_mcp(&c.name).map(|k| k.0.eq_ignore_ascii_case(name)).unwrap_or(false)
                }
            });
            if let Some(c) = existing {
                if c.enabled {
                    return Ok(format!("{} is already connected. Ask me to use it, like \"use {} to …\"", c.name, c.name));
                }
                *MCP_PREFILL.lock() = Some(serde_json::json!({ "id": c.id }));
                crate::show_dashboard(&st.app, Some("agent/apps"));
                st.emit("flo://mcp-prefill", ());
                return Ok(format!("{} is added but turned off. Opening it so you can turn it on.", c.name));
            }
            *MCP_PREFILL.lock() = Some(serde_json::json!({ "name": name, "url": url.clone().unwrap_or_default() }));
            crate::show_dashboard(&st.app, Some("agent/apps"));
            st.emit("flo://mcp-prefill", ());
            Ok(match url {
                Some(_) => format!("Opened Apps with {name} filled in. Check it and press Save."),
                None => format!("Opened Apps with {name} filled in. Paste its MCP URL or command, then Save."),
            })
        }
        AssistantAction::Media { action } => {
            match action.as_str() {
                "volume_up" => { crate::media::step_volume(8)?; Ok("Volume up".into()) }
                "volume_down" => { crate::media::step_volume(-8)?; Ok("Volume down".into()) }
                "mute" => { crate::media::set_muted(true)?; Ok("Muted".into()) }
                "unmute" => { crate::media::set_muted(false)?; Ok("Unmuted".into()) }
                other => { crate::media::control(other)?; Ok(format!("{other}")) }
            }
        }
        AssistantAction::InsertText { text: body } => {
            platform::activate_app(front.pid);
            let b = body.clone();
            tokio::task::spawn_blocking(move || {
                std::thread::sleep(std::time::Duration::from_millis(120));
                platform::paste_text(&b)
            })
            .await??;
            Ok(if had_selection { "Replaced your selection".into() } else { format!("Typed into {}", front.name) })
        }
    }
}
