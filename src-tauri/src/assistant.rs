//! Voice assistant: builds context (projects, to-dos, notes, selection, screen), asks the LLM
//! for a JSON plan, then executes the actions locally.
use crate::egress::Purpose;
use crate::llm::{self, ChatRequest, LlmConfig};
use crate::model::*;
use crate::platform::{self, FrontApp};
use crate::state::Shared;
use crate::{db, meeting, prompts, settings as cfg, text};
use anyhow::{anyhow, Result};

pub fn build_context(st: &Shared, selection: Option<&str>, front: &FrontApp, screen: Option<&str>) -> String {
    let s = st.settings();
    let now = chrono::Local::now();
    let mut c = format!("Today: {} ({})\n", now.format("%Y-%m-%d %H:%M"), now.format("%A"));
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
        c.push_str(&format!("- {} [{}]{}\n", p.name, p.status, p.description.as_deref().map(|d| format!(" — {d}")).unwrap_or_default()));
        for t in todos.iter().filter(|t| t.project_id.as_deref() == Some(&p.id) && t.status == "open").take(15) {
            c.push_str(&format!("    • {}{}\n", t.title, t.due.as_deref().map(|d| format!(" (due {d})")).unwrap_or_default()));
        }
    }
    let loose: Vec<_> = todos.iter().filter(|t| t.project_id.is_none() && t.status == "open").take(20).collect();
    if !loose.is_empty() {
        c.push_str("\nOther open to-dos:\n");
        for t in loose {
            c.push_str(&format!("- {}{}\n", t.title, t.due.as_deref().map(|d| format!(" (due {d})")).unwrap_or_default()));
        }
    }
    let notes = st.db.list_notes().unwrap_or_default();
    if !notes.is_empty() {
        c.push_str("\nRecent notes:\n");
        for n in notes.iter().take(5) {
            let first = n.summary.lines().next().unwrap_or("");
            c.push_str(&format!("- {} ({}): {}\n", n.title, &n.created_at[..10.min(n.created_at.len())], text::truncate_chars(first, 160)));
        }
    }
    if st.meeting.lock().is_some() {
        c.push_str("\nA meeting recording is currently running.\n");
    }
    if let Some(sel) = selection {
        c.push_str(&format!("\nSelected text in {}:\n\"\"\"\n{}\n\"\"\"\n", front.name, text::truncate_chars(sel, 6000)));
    }
    if let Some(scr) = screen {
        c.push_str(&format!("\nVisible text on screen (OCR, may be noisy):\n\"\"\"\n{}\n\"\"\"\n", text::truncate_chars(scr, 5000)));
    }
    c
}

pub async fn run(st: &Shared, query: &str, selection: Option<String>, front: &FrontApp, screen: Option<String>) -> Result<AssistantResponse> {
    // 1) instant local commands ("open Slack", "google …", "play … on youtube") — no AI needed
    if selection.is_none() {
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
            });
        }
    }
    let s = st.settings();
    let cfgl = LlmConfig::from_settings(&s);
    if !cfgl.is_configured() {
        return Err(anyhow!("Pick an AI model in Settings → AI to ask questions (“open …” and “google …” work without one)."));
    }
    let context = build_context(st, selection.as_deref(), front, screen.as_deref());
    let system = prompts::assistant_system(&context);
    let raw = llm::chat(
        &st.egress,
        &cfgl,
        ChatRequest {
            system: &system,
            user: query,
            image_b64: None,
            json: true,
            purpose: Purpose::Assistant,
            cloud_allowed: s.assistant_cloud_allowed,
        },
    )
    .await
    .map_err(|e| {
        if cfg::is_cloud_llm(&s.llm_provider) && !s.assistant_cloud_allowed {
            anyhow!("Assistant is set to on-device only. Allow cloud AI in Settings → Privacy, or choose a local model.")
        } else {
            e
        }
    })?;
    let parsed = prompts::parse_assistant(&raw);
    let mut results = vec![];
    for a in &parsed.actions {
        match execute(st, a, front, selection.is_some()).await {
            Ok(r) => results.push(r),
            Err(e) => results.push(format!("⚠️ {e}")),
        }
    }
    Ok(AssistantResponse {
        id: db::new_id(),
        query: query.into(),
        reply: if parsed.reply.is_empty() && !results.is_empty() { "Done.".into() } else { parsed.reply },
        actions: parsed.actions,
        results,
        created_at: chrono::Local::now().to_rfc3339(),
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
            Ok(format!("Stopped “{}” — summary ready", n.title))
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
