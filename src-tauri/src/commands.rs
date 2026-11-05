//! Tauri commands — names/args mirror the contract at the bottom of src/lib/types.ts.
use crate::model::*;
use crate::state::Shared;
use crate::{assistant, attention, claude, egress::Purpose, llm, meeting, platform, secrets, session, settings, stt};
use serde::Deserialize;
use tauri::State;

type R<T> = Result<T, String>;

fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

// ── settings & keys ─────────────────────────────────────────────────────────
#[tauri::command]
pub fn get_settings(st: State<Shared>) -> Settings {
    st.settings()
}

#[tauri::command]
pub fn save_settings(st: State<Shared>, settings: Settings) -> R<()> {
    settings::save(&st.data_dir, &settings).map_err(e)?;
    platform::set_hotkeys(crate::hotkey::HotkeyConfig::from_strings(&settings.hotkey_dictation, &settings.hotkey_assistant));
    *st.settings.write() = settings;
    Ok(())
}

#[tauri::command]
pub fn set_api_key(provider: String, key: String) -> R<()> {
    secrets::set_api_key(&provider, &key).map_err(e)
}

#[tauri::command]
pub async fn has_api_key(provider: String) -> bool {
    // async + timeout: never freeze the UI on a pending Keychain prompt
    matches!(secrets::get_api_key_async(&provider).await, Ok(Some(_)))
}

#[tauri::command]
pub fn delete_api_key(provider: String) -> R<()> {
    secrets::delete_api_key(&provider).map_err(e)
}

/// Model names for a provider (live list when reachable, curated fallback otherwise).
#[tauri::command]
pub async fn provider_models(st: State<'_, Shared>, provider: String) -> R<Vec<String>> {
    let s = st.settings();
    let cfg = llm::LlmConfig { provider, model: String::new(), local_url: s.local_llm_url.clone() };
    Ok(llm::list_models(&st.egress, &cfg).await)
}

#[tauri::command]
pub async fn test_llm(st: State<'_, Shared>) -> R<String> {
    let s = st.settings();
    let cfg = llm::LlmConfig::from_settings(&s);
    let t0 = std::time::Instant::now();
    let out = llm::chat(
        &st.egress,
        &cfg,
        llm::ChatRequest { system: "Reply with exactly: ok", user: "ping", image_b64: None, json: false, purpose: Purpose::Test, cloud_allowed: true, max_tokens: 16 },
    )
    .await
    .map_err(e)?;
    Ok(format!("{} replied “{}” in {} ms", s.llm_provider, crate::text::truncate_chars(out.trim(), 40), t0.elapsed().as_millis()))
}

// ── island / windows ────────────────────────────────────────────────────────
#[tauri::command]
pub async fn get_island_geometry(app: tauri::AppHandle) -> R<IslandGeometry> {
    crate::island_geometry(&app).map_err(e)
}

#[tauri::command]
pub fn island_resize(app: tauri::AppHandle, width: f64, height: f64) -> R<()> {
    crate::place_island(&app, width, height).map_err(e)
}

#[tauri::command]
pub fn open_dashboard(app: tauri::AppHandle, route: Option<String>) -> R<()> {
    crate::show_dashboard(&app, route.as_deref());
    Ok(())
}

// ── sessions ────────────────────────────────────────────────────────────────
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModeArg {
    Dictation,
    Assistant,
    Meeting,
}

#[tauri::command]
pub async fn start_session(st: State<'_, Shared>, mode: ModeArg) -> R<()> {
    let st = st.inner().clone();
    let m = match mode {
        ModeArg::Assistant => Mode::Assistant,
        _ => Mode::Dictation,
    };
    tauri::async_runtime::spawn_blocking(move || session::start(&st, m, false)).await.map_err(e)?.map_err(e)
}

#[tauri::command]
pub async fn stop_session(st: State<'_, Shared>) -> R<()> {
    session::stop(st.inner().clone()).await;
    Ok(())
}

#[tauri::command]
pub fn cancel_session(st: State<Shared>) {
    session::cancel(st.inner());
}

#[tauri::command]
pub async fn ask_assistant(st: State<'_, Shared>, text: String, mode: Option<String>) -> R<AssistantResponse> {
    let st = st.inner().clone();
    st.state(Phase::Thinking, Mode::Assistant, None);
    let front = st.last_front.lock().clone();
    let mode = mode.unwrap_or_else(|| "quick".into());
    let r = assistant::run_mode(&st, &text, None, &front, None, &mode).await;
    match &r {
        Ok(resp) => {
            let _ = st.db.insert_assistant(resp);
            st.emit(ev::ASSISTANT, resp.clone());
            st.finish(Phase::Done, Mode::Assistant, None);
        }
        Err(err) => st.finish(Phase::Error, Mode::Assistant, Some(err.to_string())),
    }
    r.map_err(e)
}

// ── data ────────────────────────────────────────────────────────────────────
#[tauri::command]
pub fn list_assistant(st: State<Shared>, limit: Option<u32>) -> R<Vec<AssistantResponse>> {
    st.db.list_assistant(limit.unwrap_or(100)).map_err(e)
}

/// "Go deeper" (screenshot + detailed answer) or "Search the web" on a previous answer.
#[tauri::command]
pub async fn assistant_followup(st: State<'_, Shared>, id: String, mode: String) -> R<AssistantResponse> {
    let st = st.inner().clone();
    if !matches!(mode.as_str(), "deep" | "web") {
        return Err("mode must be deep or web".into());
    }
    st.state(Phase::Thinking, Mode::Assistant, None);
    let r = assistant::followup(&st, &id, &mode).await;
    match &r {
        Ok(resp) => {
            let _ = st.db.insert_assistant(resp);
            st.emit(ev::ASSISTANT, resp.clone());
            st.finish(Phase::Done, Mode::Assistant, None);
        }
        Err(err) => st.finish(Phase::Error, Mode::Assistant, Some(err.to_string())),
    }
    r.map_err(e)
}

#[tauri::command]
pub fn list_history(st: State<Shared>, limit: Option<u32>) -> R<Vec<Dictation>> {
    st.db.list_dictations(limit.unwrap_or(200)).map_err(e)
}

#[tauri::command]
pub fn get_analytics(st: State<Shared>, days: Option<u32>) -> R<Analytics> {
    st.db.analytics(days.unwrap_or(30), st.settings().typing_wpm).map_err(e)
}

#[tauri::command]
pub fn list_todos(st: State<Shared>) -> R<Vec<Todo>> {
    st.db.list_todos().map_err(e)
}

#[tauri::command]
pub fn add_todo(st: State<Shared>, title: String, project_id: Option<String>, due: Option<String>) -> R<Todo> {
    let t = st.db.add_todo(&title, "manual", project_id, due).map_err(e)?;
    st.emit(ev::TODOS, ());
    st.emit(ev::PROJECTS, ());
    Ok(t)
}

#[tauri::command]
pub fn update_todo(st: State<Shared>, id: String, status: Option<String>, title: Option<String>, project_id: Option<Option<String>>) -> R<()> {
    st.db.update_todo(&id, status.as_deref(), title.as_deref(), project_id).map_err(e)?;
    st.emit(ev::TODOS, ());
    st.emit(ev::PROJECTS, ());
    Ok(())
}

#[tauri::command]
pub fn delete_todo(st: State<Shared>, id: String) -> R<()> {
    st.db.delete_todo(&id).map_err(e)?;
    st.emit(ev::TODOS, ());
    st.emit(ev::PROJECTS, ());
    Ok(())
}

#[tauri::command]
pub fn list_projects(st: State<Shared>) -> R<Vec<Project>> {
    st.db.list_projects().map_err(e)
}

#[tauri::command]
pub fn create_project(st: State<Shared>, name: String, description: Option<String>) -> R<Project> {
    let p = st.db.create_project(&name, description.as_deref()).map_err(e)?;
    st.emit(ev::PROJECTS, ());
    Ok(p)
}

#[tauri::command]
pub fn update_project(st: State<Shared>, id: String, name: Option<String>, description: Option<String>, status: Option<String>) -> R<()> {
    st.db.update_project(&id, name.as_deref(), description.as_deref(), status.as_deref()).map_err(e)?;
    st.emit(ev::PROJECTS, ());
    Ok(())
}

#[tauri::command]
pub fn delete_project(st: State<Shared>, id: String) -> R<()> {
    st.db.delete_project(&id).map_err(e)?;
    st.emit(ev::PROJECTS, ());
    st.emit(ev::TODOS, ());
    Ok(())
}

#[tauri::command]
pub fn list_notes(st: State<Shared>) -> R<Vec<Note>> {
    st.db.list_notes().map_err(e)
}

#[tauri::command]
pub fn get_note(st: State<Shared>, id: String) -> R<Option<Note>> {
    st.db.get_note(&id).map_err(e)
}

#[tauri::command]
pub fn delete_note(st: State<Shared>, id: String) -> R<()> {
    st.db.delete_note(&id).map_err(e)?;
    st.emit(ev::NOTES, ());
    Ok(())
}

#[tauri::command]
pub async fn start_meeting(st: State<'_, Shared>, title: Option<String>, project_id: Option<String>) -> R<Note> {
    let st = st.inner().clone();
    tauri::async_runtime::spawn_blocking(move || meeting::start(st, title, project_id)).await.map_err(e)?.map_err(e)
}

#[tauri::command]
pub async fn stop_meeting(st: State<'_, Shared>) -> R<Note> {
    meeting::stop(st.inner().clone()).await.map_err(e)
}

#[tauri::command]
pub fn list_dictionary(st: State<Shared>) -> R<Vec<DictionaryEntry>> {
    st.db.list_dictionary().map_err(e)
}

#[tauri::command]
pub fn add_dictionary(st: State<Shared>, word: String, replacement: Option<String>) -> R<DictionaryEntry> {
    st.db.add_dictionary(&word, replacement.as_deref()).map_err(e)
}

#[tauri::command]
pub fn remove_dictionary(st: State<Shared>, id: String) -> R<()> {
    st.db.remove_dictionary(&id).map_err(e)
}

#[tauri::command]
pub fn network_log(st: State<Shared>) -> Vec<NetworkLogEntry> {
    st.egress.entries()
}

// ── models ──────────────────────────────────────────────────────────────────
#[tauri::command]
pub fn list_models(st: State<Shared>) -> Vec<LocalModel> {
    stt::list_models(&st.models_dir)
}

#[tauri::command]
pub async fn download_model(st: State<'_, Shared>, id: String) -> R<()> {
    let st = st.inner().clone();
    let st2 = st.clone();
    let res = stt::download_model(&st.egress, &st.models_dir, &id, move |p| st2.emit(ev::MODEL_PROGRESS, p)).await;
    if let Err(err) = &res {
        st.emit(ev::MODEL_PROGRESS, ModelProgressEvent { id: id.clone(), received: 0, total: 0, done: true, error: Some(err.to_string()) });
    }
    res.map_err(e)
}

#[tauri::command]
pub fn delete_model(st: State<Shared>, id: String) -> R<()> {
    if let Some(p) = stt::model_path(&st.models_dir, &id) {
        std::fs::remove_file(p).map_err(e)?;
    }
    Ok(())
}

// ── attention / permissions ─────────────────────────────────────────────────
#[tauri::command]
pub fn attention_status(st: State<Shared>) -> AttentionStatus {
    attention::status(st.inner())
}

#[tauri::command]
pub fn set_attention_paused(st: State<Shared>, paused: bool) {
    st.attention_paused.store(paused, std::sync::atomic::Ordering::SeqCst);
}

#[tauri::command]
pub fn check_permissions() -> Permissions {
    platform::permissions()
}

#[tauri::command]
pub fn open_permission_settings(kind: String) {
    platform::open_permission_settings(&kind);
}

/// User clicked "Repair permissions": clear macOS privacy records for Flo only
/// (stale entries from older builds show as enabled but don't apply), then relaunch so
/// every permission can be granted fresh to the current build.
#[tauri::command]
pub fn repair_permissions(app: tauri::AppHandle) -> R<()> {
    #[cfg(target_os = "macos")]
    {
        let id = app.config().identifier.clone();
        let st = std::process::Command::new("tccutil").args(["reset", "All", &id]).status().map_err(e)?;
        if !st.success() {
            return Err("tccutil failed".into());
        }
    }
    app.restart();
}

#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

#[tauri::command]
pub fn fix_fn_key() -> R<String> {
    platform::fix_fn_key().map_err(e)
}

// ── Claude Code ─────────────────────────────────────────────────────────────
#[tauri::command]
pub fn list_claude_events(st: State<Shared>, limit: Option<u32>) -> R<Vec<ClaudeEvent>> {
    st.db.list_claude_events(limit.unwrap_or(50)).map_err(e)
}

#[tauri::command]
pub fn mark_claude_seen(st: State<Shared>, id: Option<String>) -> R<()> {
    st.db.mark_claude_seen(id.as_deref()).map_err(e)
}

/// Bring the app where the Claude session runs to the front (editor → its project folder).
#[tauri::command]
pub async fn open_claude_session(app: tauri::AppHandle, st: State<'_, Shared>, id: String) -> R<String> {
    let ev = st.db.list_claude_events(200).map_err(e)?.into_iter().find(|x| x.id == id).ok_or("session not found")?;
    let _ = st.db.mark_claude_seen(Some(&id));
    st.emit(ev::CLAUDE, serde_json::Value::Null);
    let _ = st.db.dismiss_claude_session(&ev.session_id);
    claude::emit_sessions(st.inner());
    // focus the EXISTING window running this session; never open a new one
    let r = tauri::async_runtime::spawn_blocking(move || claude::focus(ev.app_bundle.as_deref(), ev.terminal.as_deref(), &ev.cwd))
        .await
        .map_err(e)?
        .map_err(e)?;
    if r.is_empty() {
        crate::show_dashboard(&app, Some("home"));
    }
    Ok(r)
}

#[tauri::command]
pub fn list_claude_sessions(st: State<Shared>) -> R<Vec<ClaudeSession>> {
    claude::settle_idle_sessions(st.inner());
    st.db.list_claude_sessions().map_err(e)
}

/// Tray click: focus the session's window; drop it from the tray unless Claude is still working.
#[tauri::command]
pub async fn open_claude_by_session(st: State<'_, Shared>, session_id: String) -> R<String> {
    let s = st.db.get_claude_session(&session_id).map_err(e)?.ok_or("session not found")?;
    if s.status != "working" {
        let _ = st.db.dismiss_claude_session(&session_id);
    }
    claude::emit_sessions(st.inner());
    let (b, t, cwd) = (s.app_bundle.clone(), s.terminal.clone(), s.cwd.clone());
    tauri::async_runtime::spawn_blocking(move || claude::focus(b.as_deref(), t.as_deref(), &cwd))
        .await
        .map_err(e)?
        .map_err(e)
}

#[tauri::command]
pub fn dismiss_claude_session(st: State<Shared>, session_id: String) -> R<()> {
    st.db.dismiss_claude_session(&session_id).map_err(e)?;
    claude::emit_sessions(st.inner());
    Ok(())
}

// ── context library ─────────────────────────────────────────────────────────
const MAX_CONTEXT_CHARS: usize = 400_000;

#[tauri::command]
pub fn list_context_docs(st: State<Shared>) -> R<Vec<ContextDoc>> {
    st.db.list_context_docs().map_err(e)
}

#[tauri::command]
pub fn get_context_doc(st: State<Shared>, id: String) -> R<serde_json::Value> {
    let doc = st.db.list_context_docs().map_err(e)?.into_iter().find(|d| d.id == id).ok_or("not found")?;
    let content = st.db.get_context_content(&id).map_err(e)?.unwrap_or_default();
    Ok(serde_json::json!({ "doc": doc, "content": content }))
}

#[tauri::command]
pub fn add_context_doc(st: State<Shared>, title: String, content: String) -> R<ContextDoc> {
    let content = content.replace("\r\n", "\n");
    if content.trim().is_empty() {
        return Err("That file is empty".into());
    }
    if content.len() > MAX_CONTEXT_CHARS {
        return Err(format!("Too large ({} KB). Keep context files under 400 KB.", content.len() / 1024));
    }
    st.db.add_context_doc(&title, &content).map_err(e)
}

#[tauri::command]
pub fn update_context_doc(
    st: State<Shared>,
    id: String,
    title: Option<String>,
    enabled: Option<bool>,
    pinned: Option<bool>,
    content: Option<String>,
) -> R<()> {
    st.db.update_context_doc(&id, title.as_deref(), enabled, pinned, content.as_deref()).map_err(e)
}

#[tauri::command]
pub fn delete_context_doc(st: State<Shared>, id: String) -> R<()> {
    st.db.delete_context_doc(&id).map_err(e)
}

/// "Save to dictionary" from a correction card.
#[tauri::command]
pub fn accept_correction(st: State<Shared>, heard: String, corrected: String) -> R<DictionaryEntry> {
    let existing = st.db.list_dictionary().map_err(e)?;
    if let Some(d) = existing.iter().find(|d| d.word.eq_ignore_ascii_case(&heard)) {
        let _ = st.db.remove_dictionary(&d.id);
    }
    st.db.add_dictionary(&heard, Some(&corrected)).map_err(e)
}

// ── integrations (Claude Code, Codex, Cursor, webhook) + Slack ───────────────
#[tauri::command]
pub fn list_integrations(st: State<Shared>) -> Vec<crate::agents::Integration> {
    crate::agents::list(st.inner())
}

#[tauri::command]
pub fn install_integration(st: State<Shared>, id: String) -> R<Vec<crate::agents::Integration>> {
    crate::agents::install(st.inner(), &id).map_err(e)?;
    Ok(crate::agents::list(st.inner()))
}

#[tauri::command]
pub fn uninstall_integration(st: State<Shared>, id: String) -> R<Vec<crate::agents::Integration>> {
    crate::agents::uninstall(st.inner(), &id).map_err(e)?;
    Ok(crate::agents::list(st.inner()))
}

/// Save + verify a Slack user token. Returns "Name · workspace".
#[tauri::command]
pub async fn slack_connect(st: State<'_, Shared>, token: String) -> R<String> {
    let token = token.trim().to_string();
    if !token.starts_with("xoxp-") {
        return Err("Use a Slack *user* token (starts with xoxp-).".into());
    }
    secrets::set_api_key("slack", &token).map_err(e)?;
    crate::slack::test(st.inner()).await.map_err(|err| {
        let _ = secrets::delete_api_key("slack");
        err.to_string()
    })
}

#[tauri::command]
pub async fn slack_status(st: State<'_, Shared>) -> R<Option<String>> {
    if secrets::get_api_key_async("slack").await.map_err(e)?.is_none() {
        return Ok(None);
    }
    crate::slack::test(st.inner()).await.map(Some).map_err(e)
}

#[tauri::command]
pub fn slack_disconnect() -> R<()> {
    secrets::delete_api_key("slack").map_err(e)
}

#[tauri::command]
pub async fn slack_sync_now(st: State<'_, Shared>) -> R<usize> {
    crate::slack::sync(st.inner()).await.map_err(e)
}

/// Confirm / cancel a staged action (e.g. a Slack message the assistant drafted).
#[tauri::command]
pub async fn confirm_action(st: State<'_, Shared>, id: String, approve: bool) -> R<String> {
    let r = crate::slack::confirm(st.inner(), &id, approve).await.map_err(e)?;
    st.toast("success", r.clone());
    Ok(r)
}

#[tauri::command]
pub fn claude_hook_status(st: State<Shared>) -> ClaudeHookStatus {
    claude::status(st.inner())
}

#[tauri::command]
pub fn install_claude_hook(st: State<Shared>) -> R<ClaudeHookStatus> {
    claude::install(st.inner()).map_err(e)
}

#[tauri::command]
pub fn uninstall_claude_hook(st: State<Shared>) -> R<ClaudeHookStatus> {
    claude::uninstall(st.inner()).map_err(e)
}
