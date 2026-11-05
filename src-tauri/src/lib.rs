//! Flo — your assistant: local-first voice dictation, assistant, meeting notes, attention → to-dos.
mod assistant;
mod attention;
mod audio;
mod claude;
mod commands;
mod corrections;
mod db;
mod egress;
mod hotkey;
mod intents;
mod llm;
mod meeting;
mod meeting_detect;
mod model;
mod platform;
mod prompts;
mod secrets;
mod session;
mod selftest;
mod settings;
mod state;
mod stt;
mod text;

use hotkey::HotkeyEvent;
use model::{IslandGeometry, Mode};
use parking_lot::Mutex;
use state::{AppState, Shared};
use std::sync::atomic::{AtomicBool, AtomicU32};
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

static GEOMETRY: Mutex<Option<IslandGeometry>> = Mutex::new(None);

/// Must be called on the main thread on macOS.
fn compute_geometry() -> IslandGeometry {
    let g = platform::island_geometry();
    *GEOMETRY.lock() = Some(g.clone());
    g
}

pub(crate) fn island_geometry(app: &AppHandle) -> anyhow::Result<IslandGeometry> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(compute_geometry());
    })?;
    Ok(rx.recv_timeout(std::time::Duration::from_secs(2))?)
}

pub(crate) fn place_island(app: &AppHandle, width: f64, height: f64) -> anyhow::Result<()> {
    let w = app.get_webview_window("island").ok_or_else(|| anyhow::anyhow!("island window missing"))?;
    w.set_size(LogicalSize::new(width, height))?;
    if cfg!(target_os = "macos") {
        let geo = GEOMETRY.lock().clone().unwrap_or(IslandGeometry {
            platform: "macos".into(),
            has_notch: false,
            notch_width: 200.0,
            notch_height: 32.0,
            screen_width: 1512.0,
        });
        let (x, y) = platform::island_position(&geo, width, height);
        w.set_position(LogicalPosition::new(x, y))?;
    } else if let Some(m) = w.primary_monitor()? {
        let scale = m.scale_factor();
        let wa = m.work_area();
        let x = (wa.position.x as f64 + wa.size.width as f64) / scale - width - 16.0;
        let y = (wa.position.y as f64 + wa.size.height as f64) / scale - height - 16.0;
        w.set_position(LogicalPosition::new(x, y))?;
    }
    Ok(())
}

/// The dashboard window is destroyed when closed (frees ~100 MB of WebKit memory) and
/// re-created from tauri.conf.json on demand.
pub(crate) fn show_dashboard(app: &AppHandle, route: Option<&str>) {
    if app.get_webview_window("main").is_none() {
        if let Some(cfg) = app.config().app.windows.iter().find(|w| w.label == "main") {
            if let Err(e) = WebviewWindowBuilder::from_config(app, cfg).and_then(|b| b.build()) {
                log::error!("open dashboard: {e}");
            }
        }
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        if let Some(r) = route {
            let safe: String = r.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '/' || *c == '-').collect();
            let _ = w.eval(&format!("location.hash = '#/{}'", safe.trim_start_matches('/')));
        }
    }
}

fn create_island(app: &AppHandle) -> tauri::Result<()> {
    let geo = compute_geometry(); // setup runs on the main thread
    let (w, h) = if geo.platform == "macos" { (geo.notch_width, geo.notch_height) } else { (64.0, 64.0) };
    let mut b = WebviewWindowBuilder::new(app, "island", WebviewUrl::App("index.html".into()))
        .initialization_script("if (!location.hash || location.hash === '#/') { location.hash = '#/island'; }")
        .title("Flo Island")
        .inner_size(w, h)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .visible_on_all_workspaces(true);
    #[cfg(target_os = "macos")]
    {
        b = b.accept_first_mouse(true);
    }
    let win = b.build()?;
    #[cfg(target_os = "macos")]
    if let Ok(ptr) = win.ns_window() {
        platform::configure_island(ptr);
    }
    let _ = &win;
    let _ = place_island(app, w, h);
    Ok(())
}

fn build_tray(app: &AppHandle, st: Shared) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Flo", true, None::<&str>)?;
    let meeting = MenuItem::with_id(app, "meeting", "Start / stop meeting notes", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause / resume Attention", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Flo", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &meeting, &pause, &sep, &quit])?;
    let mut tray = TrayIconBuilder::with_id("flo").menu(&menu).tooltip("Flo — your assistant").show_menu_on_left_click(true);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(move |app, event| match event.id.as_ref() {
        "open" => show_dashboard(app, None),
        "meeting" => {
            let st = st.clone();
            tauri::async_runtime::spawn(async move {
                let running = st.meeting.lock().is_some();
                let res = if running { meeting::stop(st.clone()).await.map(|_| ()) } else { meeting::start(st.clone(), None, None).map(|_| ()) };
                if let Err(e) = res {
                    st.toast("error", e.to_string());
                }
            });
        }
        "pause" => {
            use std::sync::atomic::Ordering;
            let p = !st.attention_paused.load(Ordering::SeqCst);
            st.attention_paused.store(p, Ordering::SeqCst);
            st.toast("info", if p { "Attention paused" } else { "Attention resumed" });
        }
        "quit" => app.exit(0),
        _ => {}
    })
    .build(app)?;
    Ok(())
}

/// The island is a non-activating panel, so its web view doesn't get mouse-exit events while
/// another app is active. Track the cursor here and tell the island when it enters/leaves.
fn spawn_hover_tracker(app: AppHandle, st: Shared) {
    tauri::async_runtime::spawn(async move {
        let mut inside = false;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(if inside { 80 } else { 150 })).await;
            let Some(w) = app.get_webview_window("island") else { continue };
            let (Ok(cur), Ok(pos), Ok(size)) = (app.cursor_position(), w.outer_position(), w.outer_size()) else { continue };
            let now = cur.x >= pos.x as f64
                && cur.x <= (pos.x + size.width as i32) as f64
                && cur.y >= pos.y as f64
                && cur.y <= (pos.y + size.height as i32) as f64;
            if now {
                let scale = w.scale_factor().unwrap_or(1.0);
                let (x, y) = ((cur.x - pos.x as f64) / scale, (cur.y - pos.y as f64) / scale);
                st.emit(model::ev::HOVER, serde_json::json!({ "inside": true, "x": x, "y": y }));
                let _ = app.run_on_main_thread(platform::set_pointer_cursor);
            } else if inside {
                st.emit(model::ev::HOVER, serde_json::json!({ "inside": false }));
            }
            inside = now;
        }
    });
}

fn start_hotkeys(st: Shared) {
    platform::start_hotkeys(Box::new(move |ev| {
        let st = st.clone();
        match ev {
            HotkeyEvent::Press(mode) => {
                st.ptt_down.store(true, std::sync::atomic::Ordering::SeqCst);
                tauri::async_runtime::spawn_blocking(move || {
                    if let Err(e) = session::start(&st, mode, true) {
                        st.state(model::Phase::Error, mode, Some(e.to_string()));
                    }
                });
            }
            HotkeyEvent::Switch(Mode::Assistant) => {
                tauri::async_runtime::spawn_blocking(move || session::switch_mode(&st, Mode::Assistant));
            }
            HotkeyEvent::Switch(_) => {}
            HotkeyEvent::Release => {
                st.ptt_down.store(false, std::sync::atomic::Ordering::SeqCst);
                tauri::async_runtime::spawn(session::stop(st));
            }
            HotkeyEvent::Lock(mode) => {
                // keys may now be released; the session keeps going
                tauri::async_runtime::spawn_blocking(move || session::lock(&st, mode));
            }
            HotkeyEvent::Cancel => {
                st.ptt_down.store(false, std::sync::atomic::Ordering::SeqCst);
                st.lock_pending.store(false, std::sync::atomic::Ordering::SeqCst);
                tauri::async_runtime::spawn_blocking(move || session::cancel(&st));
            }
        }
    }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // `open -n -a Flo.app --args --diag /path/out.json` → write permission probes and exit
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--diag") {
        let out = args.get(i + 1).cloned().unwrap_or_else(|| "/tmp/flo-diag.json".into());
        let _ = std::fs::write(&out, serde_json::to_string_pretty(&platform::diagnostics()).unwrap_or_default());
        return;
    }
    if let Some(i) = args.iter().position(|a| a == "--selftest") {
        let out = args.get(i + 1).cloned().unwrap_or_else(|| "/tmp/flo-selftest.json".into());
        selftest::run(&out);
        return;
    }
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).try_init();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::set_api_key,
            commands::has_api_key,
            commands::delete_api_key,
            commands::test_llm,
            commands::get_island_geometry,
            commands::island_resize,
            commands::open_dashboard,
            commands::start_session,
            commands::stop_session,
            commands::cancel_session,
            commands::ask_assistant,
            commands::list_assistant,
            commands::list_history,
            commands::get_analytics,
            commands::list_todos,
            commands::add_todo,
            commands::update_todo,
            commands::delete_todo,
            commands::list_projects,
            commands::create_project,
            commands::update_project,
            commands::delete_project,
            commands::list_notes,
            commands::get_note,
            commands::delete_note,
            commands::start_meeting,
            commands::stop_meeting,
            commands::list_dictionary,
            commands::add_dictionary,
            commands::remove_dictionary,
            commands::network_log,
            commands::list_models,
            commands::download_model,
            commands::delete_model,
            commands::attention_status,
            commands::set_attention_paused,
            commands::check_permissions,
            commands::open_permission_settings,
            commands::fix_fn_key,
            commands::list_claude_events,
            commands::mark_claude_seen,
            commands::claude_hook_status,
            commands::install_claude_hook,
            commands::uninstall_claude_hook,
            commands::restart_app,
            commands::repair_permissions,
            commands::open_claude_session,
            commands::list_claude_sessions,
            commands::open_claude_by_session,
            commands::dismiss_claude_session,
            commands::accept_correction,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let models_dir = data_dir.join("models");
            let settings = settings::load(&data_dir);
            let key = secrets::db_key().map_err(|e| anyhow::anyhow!("Keychain unavailable: {e}"))?;
            let db = db::Db::open(&data_dir.join("flo.db"), Some(&key))?;
            db.close_stale_live_notes()?;
            let st: Shared = Arc::new(AppState {
                app: handle.clone(),
                data_dir,
                models_dir,
                db,
                settings: parking_lot::RwLock::new(settings),
                egress: egress::Egress::new(),
                whisper: Arc::new(stt::LocalWhisper::default()),
                session: Mutex::new(None),
                meeting: Mutex::new(None),
                attention: Mutex::new(Default::default()),
                attention_paused: AtomicBool::new(false),
                ptt_down: AtomicBool::new(false),
                lock_pending: AtomicBool::new(false),
                attention_captures: AtomicU32::new(0),
                claude_listening: AtomicBool::new(false),
                claude_port: claude::PORT,
                last_front: Mutex::new(Default::default()),
            });
            app.manage(st.clone());
            create_island(&handle)?;
            build_tray(&handle, st.clone())?;
            {
                let s = st.settings();
                platform::set_hotkeys(hotkey::HotkeyConfig::from_strings(&s.hotkey_dictation, &s.hotkey_assistant));
            }
            start_hotkeys(st.clone());
            meeting_detect::spawn(st.clone());
            attention::spawn(st.clone());
            claude::refresh_if_installed(&st);
            claude::spawn_listener(st.clone());
            spawn_hover_tracker(handle.clone(), st.clone());
            stt::spawn_idle_unloader(st.whisper.clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            // never let the island be closed (e.g. Cmd+W); main window may close to free memory
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "island" {
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Flo")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_dashboard(app, None);
            }
            // keep running in the notch when the dashboard is closed
            if let tauri::RunEvent::ExitRequested { api, code, .. } = &event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
            let _ = (app, &event);
        });
}
