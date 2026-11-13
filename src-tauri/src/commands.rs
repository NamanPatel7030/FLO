//! Tauri commands — names/args mirror the contract at the bottom of src/lib/types.ts.
use crate::model::*;
use crate::state::Shared;
use crate::{assistant, attention, claude, egress::Purpose, llm, meeting, platform, secrets, session, settings, stt};
use serde::Deserialize;
use tauri::State;

type R<T> = Result<T, String>;

// Threading: Tauri runs a plain `#[tauri::command] fn` on the MAIN thread, the one that draws every
// window (GTK on Linux, Win32, AppKit). Anything that touches the disk, the database, the keyring,
// D-Bus or another process is `#[tauri::command(async)]`, which runs the same fn on the async
// runtime's thread pool, so a slow call can never freeze the windows ("Flo is not responding" on
// GNOME). Only window commands and trivial in-memory getters stay plain.

fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

// ── settings & keys ─────────────────────────────────────────────────────────
#[tauri::command]
pub fn get_settings(st: State<Shared>) -> Settings {
    st.settings()
}

#[tauri::command(async)]
pub fn save_settings(st: State<Shared>, settings: Settings) -> R<()> {
    store_settings(&st, settings).map_err(e)
}

/// Save + apply settings (the settings window, or an editable setting changed from the paired phone).
pub(crate) fn store_settings(st: &Shared, settings: Settings) -> anyhow::Result<()> {
    // presence changes only through set_presence (push.rs); a stale settings copy must not undo it
    let mut settings = settings;
    settings.presence = st.settings().presence;
    // sync changes only through the sync_* commands (sync.rs)
    settings.sync = st.settings().sync;
    settings::save(&st.data_dir, &settings)?;
    if let Some(h) = url::Url::parse(&settings.account_url).ok().and_then(|u| u.host_str().map(String::from)) {
        st.egress.allow_account_host(&h);
    }
    platform::set_hotkeys(crate::hotkey::HotkeyConfig::from_strings(&settings.hotkey_dictation, &settings.hotkey_assistant));
    crate::stt::set_keep_warm_mins(settings.stt_keep_warm_mins);
    {
        let old = st.settings();
        if old.stt_model != settings.stt_model || (old.stt_provider == "local" && settings.stt_provider != "local") {
            st.whisper.unload(); // don't keep the previous model's RAM until the idle timer
        }
    }
    if !settings.reuse_answers {
        crate::cache::ANSWERS.lock().clear();
    }
    // setup just finished: now get the more accurate speech model (the starter stays until it's in)
    let setup_done = !st.settings().onboarded && settings.onboarded;
    let approvals_changed = st.settings().claude_approvals != settings.claude_approvals;
    let (share_was, share_now) = (st.settings().share_usage, settings.share_usage);
    *st.settings.write() = settings;
    crate::usage_share::on_settings_changed(st, share_was, share_now);
    if setup_done {
        tauri::async_runtime::spawn(auto_upgrade_model(st.clone()));
    }
    // turning "Allow / Deny from the notch" on or off adds / removes the PermissionRequest hook
    if approvals_changed {
        crate::claude::refresh_if_installed(st);
    }
    crate::phone_state::poke();
    Ok(())
}

/// Settings → Privacy → "Clear cached answers": forget reused answers and the account check.
#[tauri::command(async)]
pub fn clear_caches() -> R<()> {
    crate::cache::clear_personal();
    crate::cache::MCP_TOOLS.lock().clear();
    Ok(())
}

#[tauri::command(async)]
pub fn set_api_key(provider: String, key: String) -> R<()> {
    secrets::set_api_key(&provider, &key).map_err(e)
}

#[tauri::command]
pub async fn has_api_key(provider: String) -> bool {
    // async + timeout: never freeze the UI on a pending Keychain prompt
    matches!(secrets::get_api_key_async(&provider).await, Ok(Some(_)))
}

#[tauri::command(async)]
pub fn delete_api_key(provider: String) -> R<()> {
    secrets::delete_api_key(&provider).map_err(e)
}

/// Models pulled into the local Ollama (or LM Studio) server. Errors with a helpful hint when the
/// server isn't running (the UI then shows "install Ollama · ollama pull qwen3:8b").
#[tauri::command]
pub async fn local_models(st: State<'_, Shared>) -> R<Vec<String>> {
    let s = st.settings();
    let lmstudio = s.llm_provider == "lmstudio";
    let url = if lmstudio { "http://127.0.0.1:1234/v1/models".to_string() } else { format!("{}/api/tags", s.local_llm_url.trim_end_matches('/')) };
    st.egress.check(&url, Purpose::Test, false).map_err(e)?;
    let resp = st
        .egress
        .client(Purpose::Test, false)
        .get(&url)
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
        .map_err(|_| "Ollama isn't running. Install it from ollama.com, then run: ollama pull qwen3:8b".to_string())?;
    let v: serde_json::Value = resp.json().await.map_err(e)?;
    let list = if lmstudio { &v["data"] } else { &v["models"] };
    let key = if lmstudio { "id" } else { "name" };
    Ok(list.as_array().cloned().unwrap_or_default().iter().filter_map(|m| m[key].as_str().map(String::from)).collect())
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

/// Windows / Linux: the island never takes keyboard focus, except while the quick-note widget is
/// being typed into (it asks with `focus: true`, and gives it back on blur). No-op on macOS, where
/// the non-activating panel becomes key by itself.
#[tauri::command]
pub fn island_focus(app: tauri::AppHandle, focus: bool) -> R<()> {
    #[cfg(not(target_os = "macos"))]
    if let Some(w) = tauri::Manager::get_webview_window(&app, "island") {
        w.set_focusable(focus).map_err(e)?;
        if focus {
            w.set_focus().map_err(e)?;
        }
    }
    let _ = (&app, focus);
    Ok(())
}

#[tauri::command]
pub fn take_mcp_prefill() -> R<Option<serde_json::Value>> {
    Ok(crate::assistant::MCP_PREFILL.lock().take())
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

#[tauri::command(async)]
pub fn cancel_session(st: State<Shared>) {
    session::cancel(st.inner());
}

/// First-run setup's try-out is showing: keep dictations made in Flo's own window inside Flo.
#[tauri::command]
pub fn set_setup_capture(on: bool) {
    session::set_setup_capture(on);
}

#[tauri::command]
/// `thread_id`: continue that Assistant thread (its recent turns are context for the answer);
/// `new_thread`: start a new thread; neither: the time-gap rule (db.rs) picks the thread.
pub async fn ask_assistant(st: State<'_, Shared>, text: String, mode: Option<String>, thread_id: Option<String>, new_thread: Option<bool>) -> R<AssistantResponse> {
    let st = st.inner().clone();
    st.state(Phase::Thinking, Mode::Assistant, None);
    let front = st.last_front.lock().clone();
    let mode = mode.unwrap_or_else(|| "quick".into());
    let thread_id = if new_thread.unwrap_or(false) { None } else { thread_id };
    let turns: Vec<(String, String)> = match &thread_id {
        Some(t) => st.db.list_assistant_page(Some(t), None, assistant::THREAD_CONTEXT_TURNS).unwrap_or_default().into_iter().map(|r| (r.query, r.reply)).collect(),
        None => vec![],
    };
    let mut r = assistant::with_thread(turns, assistant::run_mode(&st, &text, None, &front, None, &mode)).await;
    match &mut r {
        Ok(resp) => {
            resp.thread_id = if new_thread.unwrap_or(false) { Some(resp.id.clone()) } else { thread_id };
            assistant::log_exchange(&st, resp, "typed");
            st.emit(ev::ASSISTANT, resp.clone());
            st.finish(Phase::Done, Mode::Assistant, None);
        }
        Err(err) => st.finish(Phase::Error, Mode::Assistant, Some(err.to_string())),
    }
    r.map_err(e)
}

// ── data ────────────────────────────────────────────────────────────────────
#[tauri::command(async)]
pub fn list_assistant(st: State<Shared>, limit: Option<u32>) -> R<Vec<AssistantResponse>> {
    st.db.list_assistant(limit.unwrap_or(100)).map_err(e)
}

/// One page of Assistant history, oldest first: the newest `limit` exchanges (of one thread, or
/// all) older than the exchange `before`.
#[tauri::command(async)]
pub fn list_assistant_page(st: State<Shared>, thread_id: Option<String>, before: Option<String>, limit: Option<u32>) -> R<Vec<AssistantResponse>> {
    st.db.list_assistant_page(thread_id.as_deref(), before.as_deref(), limit.unwrap_or(30).min(200)).map_err(e)
}

/// Assistant threads, most recently active first (optionally only those matching `query`).
#[tauri::command(async)]
pub fn list_assistant_threads(st: State<Shared>, limit: Option<u32>, query: Option<String>) -> R<Vec<AssistantThread>> {
    st.db.list_assistant_threads(limit.unwrap_or(50).min(500), query.as_deref()).map_err(e)
}

/// "Go deeper" (screenshot + detailed answer) or "Search the web" on a previous answer.
#[tauri::command]
pub async fn assistant_followup(st: State<'_, Shared>, id: String, mode: String) -> R<AssistantResponse> {
    let st = st.inner().clone();
    if !matches!(mode.as_str(), "deep" | "web") {
        return Err("mode must be deep or web".into());
    }
    st.state(Phase::Thinking, Mode::Assistant, None);
    let mut r = assistant::followup(&st, &id, &mode).await;
    match &mut r {
        Ok(resp) => {
            // stays in the thread of the answer it goes deeper on
            resp.thread_id = st.db.assistant_thread_of(&id).ok().flatten();
            assistant::log_exchange(&st, resp, "typed");
            st.emit(ev::ASSISTANT, resp.clone());
            st.finish(Phase::Done, Mode::Assistant, None);
        }
        Err(err) => st.finish(Phase::Error, Mode::Assistant, Some(err.to_string())),
    }
    r.map_err(e)
}

#[tauri::command(async)]
pub fn list_history(st: State<Shared>, limit: Option<u32>) -> R<Vec<Dictation>> {
    st.db.list_dictations(limit.unwrap_or(200)).map_err(e)
}

#[tauri::command(async)]
pub fn get_analytics(st: State<Shared>, days: Option<u32>) -> R<Analytics> {
    st.db.analytics(days.unwrap_or(30), st.settings().typing_wpm).map_err(e)
}

#[tauri::command(async)]
pub fn list_todos(st: State<Shared>) -> R<Vec<Todo>> {
    st.db.list_todos().map_err(e)
}

#[tauri::command(async)]
pub fn add_todo(st: State<Shared>, title: String, project_id: Option<String>, due: Option<String>) -> R<Todo> {
    // "+ To-do" on a meeting action item that the meeting already added → the same to-do, not a copy
    if let Some(t) = st.db.list_todos().map_err(e)?.into_iter().find(|t| t.status == "open" && crate::text::is_duplicate_todo(&title, &[t.title.clone()])) {
        return Ok(t);
    }
    let t = st.db.add_todo(&title, "manual", project_id, due).map_err(e)?;
    st.emit(ev::TODOS, ());
    st.emit(ev::PROJECTS, ());
    Ok(t)
}

#[tauri::command(async)]
pub fn list_connections(st: State<Shared>) -> R<Vec<crate::model::Connection>> {
    st.db.list_connections().map_err(e)
}

#[tauri::command(async)]
pub fn save_connection(st: State<Shared>, connection: crate::model::Connection) -> R<crate::model::Connection> {
    crate::cache::MCP_TOOLS.lock().clear(); // an edited server lists its tools again
    if connection.name.trim().is_empty() {
        return Err("Give the connection a name".into());
    }
    let c = st.db.save_connection(&connection).map_err(e)?;
    crate::mcp::refresh_hosts(&st, None);
    Ok(c)
}

#[tauri::command(async)]
pub fn delete_connection(st: State<Shared>, id: String) -> R<()> {
    crate::cache::MCP_TOOLS.lock().clear();
    st.db.delete_connection(&id).map_err(e)?;
    crate::mcp::refresh_hosts(&st, None);
    Ok(())
}

/// Connect to an MCP server (saved or not yet saved) and list its tools.
#[tauri::command]
pub async fn test_connection(st: State<'_, Shared>, connection: crate::model::Connection) -> R<Vec<crate::model::McpTool>> {
    crate::mcp::probe(&st, &connection).await.map_err(|err| format!("{err:#}"))
}

#[tauri::command(async)]
pub fn list_skills(st: State<Shared>) -> R<Vec<crate::model::Skill>> {
    st.db.list_skills().map_err(e)
}

#[tauri::command(async)]
pub fn save_skill(st: State<Shared>, skill: crate::model::Skill) -> R<crate::model::Skill> {
    if skill.name.trim().is_empty() {
        return Err("Give the skill a name".into());
    }
    st.db.save_skill(&skill).map_err(e)
}

#[tauri::command(async)]
pub fn delete_skill(st: State<Shared>, id: String) -> R<()> {
    st.db.delete_skill(&id).map_err(e)
}

/// Remind me again in `minutes` (the notch reminder's Snooze).
#[tauri::command(async)]
pub fn snooze_todo(st: State<Shared>, id: String, minutes: u32) -> R<()> {
    let at = (chrono::Local::now() + chrono::Duration::minutes(minutes.clamp(1, 24 * 60) as i64)).to_rfc3339();
    st.db.set_remind(&id, Some(&at)).map_err(e)?;
    st.emit(ev::TODOS, ());
    Ok(())
}

#[tauri::command(async)]
pub fn update_todo(st: State<Shared>, id: String, status: Option<String>, title: Option<String>, project_id: Option<Option<String>>) -> R<()> {
    st.db.update_todo(&id, status.as_deref(), title.as_deref(), project_id).map_err(e)?;
    st.emit(ev::TODOS, ());
    st.emit(ev::PROJECTS, ());
    Ok(())
}

#[tauri::command(async)]
pub fn delete_todo(st: State<Shared>, id: String) -> R<()> {
    st.db.delete_todo(&id).map_err(e)?;
    st.emit(ev::TODOS, ());
    st.emit(ev::PROJECTS, ());
    Ok(())
}

#[tauri::command(async)]
pub fn list_projects(st: State<Shared>) -> R<Vec<Project>> {
    st.db.list_projects().map_err(e)
}

#[tauri::command(async)]
pub fn create_project(st: State<Shared>, name: String, description: Option<String>, client: Option<String>, client_details: Option<String>, keywords: Option<String>) -> R<Project> {
    let p = st.db.create_project(&name, description.as_deref()).map_err(e)?;
    if client.is_some() || client_details.is_some() || keywords.is_some() {
        st.db.update_project_client(&p.id, client.as_deref(), client_details.as_deref(), keywords.as_deref()).map_err(e)?;
    }
    st.emit(ev::PROJECTS, ());
    Ok(st.db.get_project(&p.id).map_err(e)?.unwrap_or(p))
}

#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn update_project(
    st: State<Shared>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    status: Option<String>,
    client: Option<String>,
    client_details: Option<String>,
    keywords: Option<String>,
) -> R<()> {
    st.db.update_project(&id, name.as_deref(), description.as_deref(), status.as_deref()).map_err(e)?;
    if client.is_some() || client_details.is_some() || keywords.is_some() {
        st.db.update_project_client(&id, client.as_deref(), client_details.as_deref(), keywords.as_deref()).map_err(e)?;
    }
    st.emit(ev::PROJECTS, ());
    Ok(())
}

#[tauri::command(async)]
pub fn delete_project(st: State<Shared>, id: String) -> R<()> {
    st.db.delete_project(&id).map_err(e)?;
    st.emit(ev::PROJECTS, ());
    st.emit(ev::TODOS, ());
    Ok(())
}

#[tauri::command(async)]
pub fn list_notes(st: State<Shared>) -> R<Vec<Note>> {
    st.db.list_notes().map_err(e)
}

#[tauri::command(async)]
pub fn get_note(st: State<Shared>, id: String) -> R<Option<Note>> {
    st.db.get_note(&id).map_err(e)
}

#[tauri::command(async)]
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

/// Capture mode + speakers of a meeting note (None for notes recorded before speaker support).
#[tauri::command(async)]
pub fn meeting_info(st: State<Shared>, note_id: String) -> R<Option<meeting::MeetingInfo>> {
    Ok(meeting::info(st.inner(), &note_id))
}

/// "Speaker 2" → "Rahul" across the note; Flo remembers the voice for future meetings.
#[tauri::command(async)]
pub fn rename_speaker(st: State<Shared>, note_id: String, from: String, to: String) -> R<Note> {
    meeting::rename_speaker(st.inner(), &note_id, &from, &to).map_err(e)
}

#[tauri::command(async)]
pub fn list_dictionary(st: State<Shared>) -> R<Vec<DictionaryEntry>> {
    st.db.list_dictionary().map_err(e)
}

#[tauri::command(async)]
pub fn add_dictionary(st: State<Shared>, word: String, replacement: Option<String>) -> R<DictionaryEntry> {
    st.db.add_dictionary(&word, replacement.as_deref()).map_err(e)
}

#[tauri::command(async)]
pub fn remove_dictionary(st: State<Shared>, id: String) -> R<()> {
    st.db.remove_dictionary(&id).map_err(e)
}

#[tauri::command]
pub fn network_log(st: State<Shared>) -> Vec<NetworkLogEntry> {
    st.egress.entries()
}

// ── models ──────────────────────────────────────────────────────────────────
#[tauri::command(async)]
pub fn list_models(st: State<Shared>) -> Vec<LocalModel> {
    stt::list_models(&st.models_dir)
}

/// Models being downloaded right now. Setup starts the recommended one in the background; a second
/// request for the same model (the Download button) joins it instead of writing the same file twice.
static DOWNLOADING: parking_lot::Mutex<Vec<String>> = parking_lot::Mutex::new(Vec::new());

#[tauri::command]
pub async fn download_model(st: State<'_, Shared>, id: String) -> R<()> {
    download_once(st.inner(), &id).await.map(|_| ()).map_err(e)
}

/// Download a speech model unless that download is already running (setup, the Download button
/// and the background upgrade share one). Ok(false): someone else's download is in progress.
pub(crate) async fn download_once(st: &Shared, id: &str) -> anyhow::Result<bool> {
    {
        let mut d = DOWNLOADING.lock();
        if d.iter().any(|x| x == id) {
            return Ok(false);
        }
        d.push(id.to_string());
    }
    let st2 = st.clone();
    let res = stt::download_model(&st.egress, &st.models_dir, id, move |p| st2.emit(ev::MODEL_PROGRESS, p)).await;
    DOWNLOADING.lock().retain(|x| x != id);
    if let Err(err) = &res {
        st.emit(ev::MODEL_PROGRESS, ModelProgressEvent { id: id.to_string(), received: 0, total: 0, done: true, error: Some(err.to_string()) });
    }
    res.map(|_| true)
}

/// Move a setup-installed starter to the more accurate model (`stt::upgrade_target`): download it
/// in the background, then switch to it once it's on disk, unless the user picked a model
/// meanwhile. A failed download is tried again on the next launch.
pub(crate) async fn auto_upgrade_model(st: Shared) {
    let runs_large = stt::this_machine_runs_large();
    let Some(target) = stt::upgrade_target(&st.settings(), runs_large) else { return };
    let installed = stt::model_path(&st.models_dir, target).is_some_and(|p| p.exists());
    if !installed {
        log::info!("speech model: downloading {target} in the background (more accurate than the starter)");
        match download_once(&st, target).await {
            Ok(true) => {}
            Ok(false) => {
                // already downloading (setup's "Download" button): wait for that one
                while DOWNLOADING.lock().iter().any(|x| x == target) {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
                if !stt::model_path(&st.models_dir, target).is_some_and(|p| p.exists()) {
                    return;
                }
            }
            Err(err) => {
                log::warn!("speech model upgrade: download failed ({err}); will try again next launch");
                return;
            }
        }
    }
    // the user may have chosen a model (or a cloud engine) while it downloaded
    let mut s = st.settings();
    if stt::upgrade_target(&s, runs_large) != Some(target) {
        return;
    }
    let was_loaded = st.whisper.is_loaded();
    let from = std::mem::replace(&mut s.stt_model, target.to_string());
    if let Err(err) = store_settings(&st, s) {
        log::warn!("speech model upgrade: couldn't save settings: {err}");
        return;
    }
    log::info!("speech model: switched {from} → {target}");
    st.emit(crate::phone_state::SETTINGS_CHANGED, ());
    st.toast("info", "Flo now uses its more accurate speech model.".to_string());
    if was_loaded {
        // the next dictation shouldn't pay for the cold load
        if let Some(path) = stt::model_path(&st.models_dir, target) {
            let w = st.whisper.clone();
            tauri::async_runtime::spawn_blocking(move || w.warm(&path));
        }
    }
}

#[tauri::command(async)]
pub fn delete_model(st: State<Shared>, id: String) -> R<()> {
    let s = st.settings();
    if s.stt_provider == "local" && s.stt_model == id {
        return Err("This model is in use. Pick another one first.".into());
    }
    if let Some(p) = stt::model_path(&st.models_dir, &id) {
        std::fs::remove_file(p).map_err(e)?;
    }
    Ok(())
}

/// Load a downloaded speech model into memory now. Setup waits on this before unlocking the
/// first dictation; Settings calls it after "Use this model" so the switch is instant.
#[tauri::command]
pub async fn load_speech_model(st: State<'_, Shared>, id: String) -> R<()> {
    let path = stt::model_path(&st.models_dir, &id).ok_or_else(|| format!("Unknown speech model {id}"))?;
    let w = st.whisper.clone();
    tauri::async_runtime::spawn_blocking(move || w.load(&path)).await.map_err(e)?.map_err(e)
}

/// The model setup should get ready: the chosen one if it's on disk, else the small starter.
#[tauri::command(async)]
pub fn setup_speech_model(st: State<Shared>) -> String {
    stt::setup_model(&st.settings().stt_model, &st.models_dir).to_string()
}

/// Settings → Voice → "Free up space": every downloaded model except the one in use. MB freed.
#[tauri::command(async)]
pub fn remove_unused_models(st: State<Shared>) -> u64 {
    stt::remove_unused(&st.models_dir, &st.settings().stt_model)
}

// ── attention / permissions ─────────────────────────────────────────────────
#[tauri::command(async)]
pub fn attention_status(st: State<Shared>) -> AttentionStatus {
    attention::status(st.inner())
}

#[tauri::command]
pub fn set_attention_paused(st: State<Shared>, paused: bool) {
    st.attention_paused.store(paused, std::sync::atomic::Ordering::SeqCst);
}

#[tauri::command(async)]
pub fn check_permissions() -> Permissions {
    platform::permissions()
}

/// "Allow" on a permission. Accessibility also shows the floating "flip this switch" helper and
/// watches for the grant, bringing Flo back the moment it lands.
#[tauri::command]
pub fn open_permission_settings(app: tauri::AppHandle, kind: String) {
    platform::open_permission_settings(&kind);
    #[cfg(target_os = "macos")]
    if kind == "accessibility" {
        crate::perm_guide::show(&app, platform::accessibility_trusted);
    }
    let _ = &app;
}

/// The helper's close button.
#[tauri::command]
pub fn close_permission_guide(app: tauri::AppHandle) {
    crate::perm_guide::close(&app);
}

/// One-click fix when an update left a stale Accessibility switch: clears only Flo's Accessibility
/// record and asks again (macOS dialog + System Settings + the helper). No relaunch.
#[tauri::command]
pub fn reset_accessibility(app: tauri::AppHandle) -> R<()> {
    #[cfg(target_os = "macos")]
    {
        let id = app.config().identifier.clone();
        platform::reset_accessibility(&id).map_err(e)?;
        crate::perm_guide::show(&app, platform::accessibility_trusted);
    }
    let _ = &app;
    Ok(())
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
    crate::hermes::shutdown();
    app.restart();
}

// ── account (sign-in only) ─────────────────────────────────────────────────
#[tauri::command]
pub async fn account_status(st: State<'_, Shared>) -> R<crate::account::AccountStatus> {
    crate::account::allow_host(st.inner());
    Ok(crate::account::status(st.inner()).await)
}

#[tauri::command]
pub async fn account_login(st: State<'_, Shared>, email: String, password: String) -> R<AccountUser> {
    crate::account::allow_host(st.inner());
    crate::account::login(st.inner(), &email, &password).await.map_err(e)
}

#[tauri::command(async)]
pub fn account_google_start(st: State<Shared>) -> R<serde_json::Value> {
    crate::account::allow_host(st.inner());
    let state = crate::account::google_start(st.inner()).map_err(e)?;
    Ok(serde_json::json!({ "state": state }))
}

#[tauri::command]
pub async fn account_exchange(st: State<'_, Shared>, code: String, state: Option<String>) -> R<AccountUser> {
    crate::account::allow_host(st.inner());
    crate::account::exchange(st.inner(), &code, state.as_deref()).await.map_err(e)
}

#[tauri::command(async)]
pub fn account_logout(st: State<Shared>) -> R<()> {
    crate::account::logout(st.inner()).map_err(e)
}

// ── sync your data (end-to-end encrypted, see sync.rs) ─────────────────────
#[tauri::command(async)]
pub fn sync_status(st: State<Shared>) -> crate::sync::SyncStatus {
    crate::sync::status(st.inner())
}

#[tauri::command]
pub async fn sync_enable(st: State<'_, Shared>) -> R<crate::sync::EnableResult> {
    crate::sync::enable(st.inner()).await.map_err(e)
}

#[tauri::command]
pub async fn sync_join(st: State<'_, Shared>, recovery_key: String) -> R<()> {
    crate::sync::join(st.inner(), &recovery_key).await.map_err(e)
}

#[tauri::command(async)]
pub fn sync_disable(st: State<Shared>) -> R<()> {
    crate::sync::disable(st.inner()).map_err(e)
}

#[tauri::command]
pub async fn sync_now(st: State<'_, Shared>) -> R<crate::sync::SyncReport> {
    crate::sync::run(st.inner()).await.map_err(e)
}

#[tauri::command(async)]
pub fn sync_set_categories(st: State<Shared>, categories: Vec<String>) -> R<()> {
    crate::sync::set_categories(st.inner(), categories).map_err(e)
}

#[tauri::command(async)]
pub fn sync_recovery_key() -> R<String> {
    crate::sync::show_recovery_key().map_err(e)
}

#[tauri::command]
pub async fn sync_delete_remote(st: State<'_, Shared>) -> R<()> {
    crate::sync::delete_remote(st.inner()).await.map_err(e)
}

#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    // restart() skips RunEvent::Exit: stop Hermes here or its gateway outlives Flo
    crate::hermes::shutdown();
    app.restart();
}

#[tauri::command(async)]
pub fn fix_fn_key() -> R<String> {
    platform::fix_fn_key().map_err(e)
}

// ── Claude Code ─────────────────────────────────────────────────────────────
#[tauri::command(async)]
pub fn list_claude_events(st: State<Shared>, limit: Option<u32>) -> R<Vec<ClaudeEvent>> {
    st.db.list_claude_events(limit.unwrap_or(50)).map_err(e)
}

#[tauri::command(async)]
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

#[tauri::command(async)]
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

/// Permission card "Open": focus the asking session's window (by session, else by its folder)
/// without dismissing anything — the question is still waiting.
#[tauri::command]
pub async fn focus_claude_session(st: State<'_, Shared>, session_id: Option<String>, cwd: Option<String>) -> R<String> {
    let known = match session_id.as_deref().filter(|s| !s.is_empty()) {
        Some(id) => st.db.get_claude_session(id).map_err(e)?,
        None => None,
    };
    let (b, t, cwd) = match known {
        Some(s) => (s.app_bundle, s.terminal, s.cwd),
        None => (None, None, cwd.unwrap_or_default()),
    };
    tauri::async_runtime::spawn_blocking(move || claude::focus(b.as_deref(), t.as_deref(), &cwd))
        .await
        .map_err(e)?
        .map_err(e)
}

#[tauri::command(async)]
pub fn dismiss_claude_session(st: State<Shared>, session_id: String) -> R<()> {
    st.db.dismiss_claude_session(&session_id).map_err(e)?;
    claude::emit_sessions(st.inner());
    Ok(())
}

// ── context library ─────────────────────────────────────────────────────────
const MAX_CONTEXT_CHARS: usize = 400_000;

// ── Flo Vault ────────────────────────────────────────────────────────────────
// ── now playing / media / volume (notch widget + voice control) ──────────────
/// Abort the computer-control agent.
#[tauri::command]
pub fn stop_agent(st: State<Shared>) {
    st.agent_abort.store(true, std::sync::atomic::Ordering::SeqCst);
}

/// Hands-free agent mode on/off (also: double-tap fn). Returns the new state.
#[tauri::command]
pub async fn toggle_agent_mode(st: State<'_, Shared>) -> R<bool> {
    let st = st.inner().clone();
    tauri::async_runtime::spawn_blocking(move || crate::handsfree::toggle(&st)).await.map_err(e)?.map_err(e)
}

#[tauri::command]
pub fn agent_mode_status() -> bool {
    crate::handsfree::is_active()
}

/// Answer the screen agent's confirm question (island Yes / No). False if nothing was pending.
#[tauri::command]
pub fn agent_confirm(yes: bool) -> bool {
    crate::agent::answer_confirm(yes)
}

#[tauri::command(async)]
pub fn now_playing() -> Option<NowPlaying> {
    crate::media::now_playing()
}

#[tauri::command]
pub async fn weather(st: State<'_, Shared>) -> R<crate::model::Weather> {
    crate::weather::current(&st).await.map_err(e)
}

#[tauri::command(async)]
pub fn media_control(action: String) -> R<()> {
    crate::media::control(&action).map_err(e)
}

#[tauri::command(async)]
pub fn get_volume() -> Option<u8> {
    crate::media::get_volume()
}

#[tauri::command(async)]
pub fn set_volume(level: u8) -> R<u8> {
    crate::media::set_volume(level).map_err(e)
}

#[tauri::command(async)]
pub fn vault_graph(st: State<Shared>) -> R<VaultGraph> {
    st.db.vault_graph().map_err(e)
}

#[tauri::command(async)]
pub fn vault_note(st: State<Shared>, id: String) -> R<Option<VaultNote>> {
    st.db.vault_get(&id).map_err(e)
}

#[tauri::command(async)]
pub fn vault_save(st: State<Shared>, title: String, kind: Option<String>, content: String) -> R<String> {
    let id = crate::vault::upsert(st.inner(), &title, kind.as_deref().unwrap_or("note"), &content).map_err(e)?;
    st.emit(ev::VAULT, ());
    Ok(id)
}

#[tauri::command(async)]
pub fn vault_delete(st: State<Shared>, id: String) -> R<()> {
    st.db.vault_delete(&id).map_err(e)?;
    st.emit(ev::VAULT, ());
    Ok(())
}

#[tauri::command(async)]
pub fn vault_search(st: State<Shared>, query: String) -> R<Vec<VaultNode>> {
    st.db.vault_search(&query).map_err(e)
}

#[tauri::command]
pub async fn vault_rebuild(st: State<'_, Shared>) -> R<usize> {
    let st = st.inner().clone();
    let n = tauri::async_runtime::spawn_blocking(move || {
        let r = crate::vault::rebuild(&st);
        st.emit(ev::VAULT, ());
        r
    })
    .await
    .map_err(e)?
    .map_err(e)?;
    Ok(n)
}

#[tauri::command(async)]
pub fn list_context_docs(st: State<Shared>) -> R<Vec<ContextDoc>> {
    st.db.list_context_docs().map_err(e)
}

#[tauri::command(async)]
pub fn get_context_doc(st: State<Shared>, id: String) -> R<serde_json::Value> {
    let doc = st.db.list_context_docs().map_err(e)?.into_iter().find(|d| d.id == id).ok_or("not found")?;
    let content = st.db.get_context_content(&id).map_err(e)?.unwrap_or_default();
    Ok(serde_json::json!({ "doc": doc, "content": content }))
}

#[tauri::command(async)]
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

#[tauri::command(async)]
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

#[tauri::command(async)]
pub fn delete_context_doc(st: State<Shared>, id: String) -> R<()> {
    st.db.delete_context_doc(&id).map_err(e)
}

/// "Save to dictionary" from a correction card.
#[tauri::command(async)]
pub fn accept_correction(st: State<Shared>, heard: String, corrected: String) -> R<DictionaryEntry> {
    let existing = st.db.list_dictionary().map_err(e)?;
    if let Some(d) = existing.iter().find(|d| d.word.eq_ignore_ascii_case(&heard)) {
        let _ = st.db.remove_dictionary(&d.id);
    }
    st.db.add_dictionary(&heard, Some(&corrected)).map_err(e)
}

/// Undo a correction Flo learned automatically.
#[tauri::command(async)]
pub fn undo_correction(st: State<Shared>, heard: String, corrected: String) -> R<()> {
    crate::corrections::undo(&st, &heard, &corrected).map_err(e)
}

// ── integrations (Claude Code, Codex, Cursor, webhook) + Slack ───────────────
#[tauri::command(async)]
pub fn list_integrations(st: State<Shared>) -> Vec<crate::agents::Integration> {
    crate::agents::list(st.inner())
}

#[tauri::command(async)]
pub fn install_integration(st: State<Shared>, id: String) -> R<Vec<crate::agents::Integration>> {
    crate::agents::install(st.inner(), &id).map_err(e)?;
    Ok(crate::agents::list(st.inner()))
}

#[tauri::command(async)]
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
    crate::slack::reset_cache();
    let who = crate::slack::test(st.inner()).await.map_err(|err| {
        let _ = secrets::delete_api_key("slack");
        err.to_string()
    })?;
    st.emit(crate::slack::EV_SLACK, serde_json::json!({ "connected": true, "who": who }));
    Ok(who)
}

/// One-click Connect Slack: opens our website's Connect URL in the browser; finishes via flo://slack.
#[tauri::command]
pub async fn slack_oauth_start(st: State<'_, Shared>) -> R<String> {
    crate::slack::oauth_start(st.inner()).await.map_err(e)
}

#[tauri::command]
pub async fn slack_status(st: State<'_, Shared>) -> R<Option<String>> {
    if secrets::get_api_key_async("slack").await.map_err(e)?.is_none() {
        return Ok(None);
    }
    crate::slack::test(st.inner()).await.map(Some).map_err(e)
}

#[tauri::command]
pub async fn slack_disconnect(st: State<'_, Shared>, revoke: Option<bool>) -> R<()> {
    crate::slack::disconnect(st.inner(), revoke.unwrap_or(false)).await.map_err(e)
}

#[tauri::command]
pub async fn slack_sync_now(st: State<'_, Shared>) -> R<usize> {
    crate::slack::sync(st.inner()).await.map_err(e)
}

// ── Connect with Google (google.rs, gmail.rs) ────────────────────────────────

/// One-click Connect with Google (Calendar and / or Gmail): opens our website's Connect URL in the
/// browser; finishes via flo://google. Checking another box later asks only for the new permission.
#[tauri::command]
pub async fn google_oauth_start(st: State<'_, Shared>, calendar: bool, gmail: bool) -> R<String> {
    crate::google::oauth_start(st.inner(), calendar, gmail).await.map_err(e)
}

#[tauri::command]
pub async fn google_status() -> R<Option<crate::google::GoogleStatus>> {
    crate::google::status().await.map_err(e)
}

/// Revoke at Google, then forget the tokens and every cached calendar / Gmail bit.
#[tauri::command]
pub async fn google_disconnect(st: State<'_, Shared>) -> R<()> {
    crate::google::disconnect(st.inner()).await.map_err(e)
}

#[tauri::command]
pub async fn google_calendars(st: State<'_, Shared>) -> R<Vec<crate::google::GoogleCalendar>> {
    crate::google::list_calendars(st.inner()).await.map_err(e)
}

/// Today + the next 48 h from the local cache (no network).
#[tauri::command(async)]
pub fn google_events(st: State<Shared>) -> Vec<crate::google::CalendarEvent> {
    if crate::google::load_tokens().is_none() {
        return vec![];
    }
    crate::google::cached_events(st.inner())
}

#[tauri::command]
pub async fn google_refresh_events(st: State<'_, Shared>) -> R<Vec<crate::google::CalendarEvent>> {
    crate::google::refresh_events(st.inner()).await.map_err(e)
}

/// The notch meeting card: "dismiss" | "snooze" | "join" | "notes".
#[tauri::command]
pub async fn google_meeting_action(st: State<'_, Shared>, id: String, action: String) -> R<String> {
    crate::google::meeting_action(st.inner(), &id, &action).await.map_err(e)
}

#[tauri::command]
pub async fn gmail_sync_now(st: State<'_, Shared>) -> R<usize> {
    crate::gmail::sync(st.inner()).await.map_err(e)
}

/// Ask our update server whether a newer Flo exists.
#[tauri::command]
pub async fn check_update(app: tauri::AppHandle) -> R<crate::updater::UpdateInfo> {
    crate::updater::check(&app).await
}

/// Download, verify and install the update found by `check_update` (progress on `flo://update`).
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> R<crate::updater::UpdateInfo> {
    crate::updater::install(&app).await
}

/// Answer a Claude Code permission question from the notch: "allow" | "deny" | "terminal".
#[tauri::command(async)]
pub fn answer_claude_permission(id: String, decision: String) -> R<()> {
    if crate::claude::answer_permission(&id, &decision) {
        Ok(())
    } else {
        Err("That question was already answered.".into())
    }
}

/// Confirm / cancel a staged action (e.g. a Slack message the assistant drafted).
#[tauri::command]
pub async fn confirm_action(st: State<'_, Shared>, id: String, approve: bool) -> R<String> {
    let r = if crate::gmail::has_pending(&id) {
        crate::gmail::confirm(st.inner(), &id, approve).await.map_err(e)?
    } else {
        crate::slack::confirm(st.inner(), &id, approve).await.map_err(e)?
    };
    st.toast("success", r.clone());
    Ok(r)
}

#[tauri::command(async)]
pub fn claude_hook_status(st: State<Shared>) -> ClaudeHookStatus {
    claude::status(st.inner())
}

#[tauri::command(async)]
pub fn install_claude_hook(st: State<Shared>) -> R<ClaudeHookStatus> {
    claude::install(st.inner()).map_err(e)
}

#[tauri::command(async)]
pub fn uninstall_claude_hook(st: State<Shared>) -> R<ClaudeHookStatus> {
    claude::uninstall(st.inner()).map_err(e)
}
