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
    *st.settings.write() = settings;
    Ok(())
}

#[tauri::command]
pub fn set_api_key(provider: String, key: String) -> R<()> {
    secrets::set_api_key(&provider, &key).map_err(e)
}

#[tauri::command]
pub fn has_api_key(provider: String) -> bool {
    secrets::get_api_key(&provider).is_some()
}

#[tauri::command]
pub fn delete_api_key(provider: String) -> R<()> {
    secrets::delete_api_key(&provider).map_err(e)
}

#[tauri::command]
pub async fn test_llm(st: State<'_, Shared>) -> R<String> {
    let s = st.settings();
    let cfg = llm::LlmConfig::from_settings(&s);
    let t0 = std::time::Instant::now();
    let out = llm::chat(
        &st.egress,
        &cfg,
        llm::ChatRequest { system: "Reply with exactly: ok", user: "ping", image_b64: None, json: false, purpose: Purpose::Test, cloud_allowed: true },
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
    tauri::async_runtime::spawn_blocking(move || session::start(&st, m)).await.map_err(e)?.map_err(e)
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
pub async fn ask_assistant(st: State<'_, Shared>, text: String) -> R<AssistantResponse> {
    let st = st.inner().clone();
    st.state(Phase::Thinking, Mode::Assistant, None);
    let front = st.last_front.lock().clone();
    let r = assistant::run(&st, &text, None, &front, None).await;
    match &r {
        Ok(resp) => {
            let _ = st.db.insert_assistant(resp);
            st.emit(ev::ASSISTANT, resp.clone());
            st.state(Phase::Done, Mode::Assistant, None);
        }
        Err(err) => st.state(Phase::Error, Mode::Assistant, Some(err.to_string())),
    }
    r.map_err(e)
}

// ── data ────────────────────────────────────────────────────────────────────
#[tauri::command]
pub fn list_assistant(st: State<Shared>, limit: Option<u32>) -> R<Vec<AssistantResponse>> {
    st.db.list_assistant(limit.unwrap_or(100)).map_err(e)
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
