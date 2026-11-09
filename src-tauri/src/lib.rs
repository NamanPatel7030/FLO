//! Flo — your assistant: local-first voice dictation, assistant, meeting notes, attention → to-dos.
mod account;
mod agent;
mod agents;
mod assistant;
mod attention;
mod audio;
mod claude;
mod code;
mod commands;
#[cfg(test)]
mod contract_tests;
mod corrections;
mod db;
mod egress;
mod floagent;
mod hermes;
mod handsfree;
mod hotkey;
mod intents;
mod livetx;
mod llm;
mod meeting;
mod reminders;
mod cron;
mod scheduler;
mod skillgen;
mod mcp;
mod media;
mod meeting_detect;
mod model;
mod platform;
mod prompts;
mod push;
mod autocontinue;
mod secrets;
mod session;
mod selftest;
mod settings;
mod speakers;
mod sysaudio;
mod vault;
mod slack;
mod state;
mod stt;
mod sync;
mod text;
mod updater;
mod weather;

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
/// island frame in logical points (x, y, w, h), kept in sync by place_island
static ISLAND_RECT: Mutex<Option<(f64, f64, f64, f64)>> = Mutex::new(None);

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
    #[cfg(target_os = "macos")]
    {
        let geo = GEOMETRY.lock().clone().unwrap_or(IslandGeometry {
            platform: "macos".into(),
            has_notch: false,
            notch_width: 200.0,
            notch_height: 32.0,
            screen_width: 1512.0,
        });
        let (x, y) = platform::island_position(&geo, width, height);
        *ISLAND_RECT.lock() = Some((x, y, width, height));
        // size + position in one native call, so the centred notch never jumps sideways
        if let Ok(ptr) = w.ns_window() {
            let ptr = ptr as usize;
            let w2 = w.clone();
            let ran = w.run_on_main_thread(move || {
                if !platform::set_frame_atomic(ptr as *mut std::ffi::c_void, x, y, width, height) {
                    let _ = w2.set_size(LogicalSize::new(width, height));
                    let _ = w2.set_position(LogicalPosition::new(x, y));
                }
            });
            if ran.is_ok() {
                return Ok(());
            }
        }
        w.set_size(LogicalSize::new(width, height))?;
        w.set_position(LogicalPosition::new(x, y))?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    w.set_size(LogicalSize::new(width, height))?;
    if let Some(m) = w.primary_monitor()? {
        let scale = m.scale_factor();
        let wa = m.work_area();
        let x = (wa.position.x as f64 + wa.size.width as f64) / scale - width - 16.0;
        let y = (wa.position.y as f64 + wa.size.height as f64) / scale - height - 16.0;
        w.set_position(LogicalPosition::new(x, y))?;
        *ISLAND_RECT.lock() = Some((x, y, width, height));
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
    let maker = MenuItem::with_id(app, "maker", "Made by Naman ↗", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &meeting, &pause, &sep, &maker, &sep2, &quit])?;
    let mut tray = TrayIconBuilder::with_id("flo").menu(&menu).tooltip("Flo · your assistant").show_menu_on_left_click(true);
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
        "maker" => {
            let _ = tauri_plugin_opener::open_url("https://hellonaman.com", None::<&str>);
        }
        "quit" => app.exit(0),
        _ => {}
    })
    .build(app)?;
    Ok(())
}

/// How long to wait before the next cursor sample while the cursor is outside the island:
/// far away (>400 pt) 250 ms, approaching (>120 pt) 80 ms, close 33 ms. Nobody crosses 400 pt of
/// screen in under 250 ms and then expects the notch to have opened already, so entering still feels
/// instant, but an idle Flo wakes ~4×/s instead of 20×/s.
fn hover_poll_ms(x: f64, y: f64, ww: f64, wh: f64) -> u64 {
    let dx = if x < 0.0 { -x } else if x > ww { x - ww } else { 0.0 };
    let dy = if y < 0.0 { -y } else if y > wh { y - wh } else { 0.0 };
    let d = dx.max(dy);
    if d > 400.0 {
        250
    } else if d > 120.0 {
        80
    } else {
        33
    }
}

#[cfg(test)]
mod hover_tests {
    #[test]
    fn polls_slower_the_further_the_cursor_is() {
        use super::hover_poll_ms as p;
        assert_eq!(p(10.0, 10.0, 200.0, 40.0), 33); // over the window
        assert_eq!(p(-100.0, 20.0, 200.0, 40.0), 33); // just beside it
        assert_eq!(p(100.0, 300.0, 200.0, 40.0), 80); // a little below
        assert_eq!(p(100.0, 900.0, 200.0, 40.0), 250); // far down the screen
        assert_eq!(p(-800.0, 0.0, 200.0, 40.0), 250); // far left
    }
}

/// The island is a non-activating panel, so its web view doesn't get mouse-exit events while
/// another app is active. Track the cursor here and tell the island when it enters/leaves.
fn spawn_hover_tracker(app: AppHandle, st: Shared) {
    tauri::async_runtime::spawn(async move {
        let mut inside = false;
        let mut last: (f64, f64) = (f64::NAN, f64::NAN);
        let mut outside_streak = 0u8;
        let mut next_ms: u64 = 50;
        loop {
            // over the island: ~60 Hz so hover highlights/tooltips follow the cursor without visible
            // steps (12 Hz read as stutter). Outside, the rate follows the distance to the island
            // (see `hover_poll_ms`) so an idle Flo barely wakes up. One cheap CoreGraphics call per tick.
            tokio::time::sleep(std::time::Duration::from_millis(if inside { 16 } else { next_ms })).await;
            // fast path (macOS): CoreGraphics cursor + cached island rect, all in logical points
            let sample = match (platform::cursor_location(), *ISLAND_RECT.lock()) {
                (Some((cx_, cy_)), Some((rx, ry, rw, rh))) => Some((cx_ - rx, cy_ - ry, rw, rh)),
                _ => {
                    let Some(w) = app.get_webview_window("island") else { continue };
                    let (Ok(cur), Ok(pos), Ok(size)) = (app.cursor_position(), w.outer_position(), w.outer_size()) else { continue };
                    let scale = w.scale_factor().unwrap_or(1.0);
                    Some((
                        (cur.x - pos.x as f64) / scale,
                        (cur.y - pos.y as f64) / scale,
                        size.width as f64 / scale,
                        size.height as f64 / scale,
                    ))
                }
            };
            let Some((x, y, ww, wh)) = sample else { continue };
            next_ms = hover_poll_ms(x, y, ww, wh);
            // hysteresis: enter on the exact frame; leave only when ≥8px outside for 2 samples in a row,
            // so a window resize under a resting cursor can never toggle the menu open/closed
            // the hot zone is a little larger than the window (a small notch is an easy target);
            // "near" stays wider than the hot zone so entering at its edge can't flap
            const PAD_X: f64 = 22.0;
            const PAD_Y: f64 = 8.0;
            let strictly_in = x >= -PAD_X && x <= ww + PAD_X && y >= 0.0 && y <= wh + PAD_Y;
            let near = x >= -(PAD_X + 8.0) && x <= ww + PAD_X + 8.0 && y >= -8.0 && y <= wh + PAD_Y + 8.0;
            let now = if inside {
                if near {
                    outside_streak = 0;
                    true
                } else {
                    outside_streak += 1;
                    outside_streak < 5 // ~80 ms at 60 Hz
                }
            } else {
                strictly_in
            };
            if now {
                // cx: offset from the window's horizontal centre — stable while the island resizes
                let cx = x - ww / 2.0;
                // only send real movement (no re-render storm while the cursor rests)
                if !inside || (cx - last.0).abs() >= 1.0 || (y - last.1).abs() >= 1.0 {
                    last = (cx, y);
                    st.emit(model::ev::HOVER, serde_json::json!({ "inside": true, "x": x, "y": y, "cx": cx }));
                    // only hop to the main thread when the cursor actually moved (it can be reset
                    // by the app underneath on movement); doing it every tick competed with the
                    // web view's rendering on the main thread
                    let _ = app.run_on_main_thread(platform::set_pointer_cursor);
                }
            } else if inside {
                last = (f64::NAN, f64::NAN);
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
            HotkeyEvent::DoubleTap(_) => {
                // double-tap fn: toggle hands-free agent mode (the first tap's session cancels itself)
                st.ptt_down.store(false, std::sync::atomic::Ordering::SeqCst);
                tauri::async_runtime::spawn_blocking(move || {
                    if let Err(e) = handsfree::toggle(&st) {
                        st.state(model::Phase::Error, Mode::Assistant, Some(e.to_string()));
                    }
                });
            }
            HotkeyEvent::Cancel => {
                st.ptt_down.store(false, std::sync::atomic::Ordering::SeqCst);
                st.lock_pending.store(false, std::sync::atomic::Ordering::SeqCst);
                tauri::async_runtime::spawn_blocking(move || session::cancel(&st));
            }
        }
    }));
}

/// Log to ~/Library/Logs/Flo/flo.log (or the platform's data dir) so failures from an app launched
/// from Finder/Applications — where stderr goes nowhere — can be diagnosed. Rotated at 5 MB.
fn init_logging() {
    let mut b = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"));
    let dir = if cfg!(target_os = "macos") {
        dirs::home_dir().map(|h| h.join("Library/Logs/Flo"))
    } else {
        dirs::data_local_dir().map(|d| d.join("Flo").join("logs"))
    };
    if let Some(dir) = dir {
        let path = dir.join("flo.log");
        if std::fs::metadata(&path).map(|m| m.len() > 5 * 1024 * 1024).unwrap_or(false) {
            let _ = std::fs::rename(&path, dir.join("flo.old.log"));
        }
        if std::fs::create_dir_all(&dir).is_ok() {
            if let Ok(f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
                b.target(env_logger::Target::Pipe(Box::new(f)));
            }
        }
    }
    let _ = b.try_init();
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
    // `open -n -a Flo.app --args --tap-probe 10 /tmp/flo-tap.wav` → record call/system audio
    if let Some(i) = args.iter().position(|a| a == "--tap-probe") {
        let secs = args.get(i + 1).and_then(|s| s.parse().ok()).unwrap_or(10.0);
        let out = args.get(i + 2).cloned().unwrap_or_else(|| "/tmp/flo-tap.wav".into());
        sysaudio::probe(secs, &out);
        return;
    }
    if let Some(i) = args.iter().position(|a| a == "--bench-stt") {
        let out = args.get(i + 1).cloned().unwrap_or_else(|| "/tmp/flo-bench.json".into());
        selftest::bench_stt(&out);
        return;
    }
    if let Some(i) = args.iter().position(|a| a == "--selftest") {
        let out = args.get(i + 1).cloned().unwrap_or_else(|| "/tmp/flo-selftest.json".into());
        selftest::run(&out);
        return;
    }
    init_logging();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::sync_status,
            commands::sync_enable,
            commands::sync_join,
            commands::sync_disable,
            commands::sync_now,
            commands::sync_set_categories,
            commands::sync_recovery_key,
            commands::sync_delete_remote,
            commands::save_settings,
            commands::set_api_key,
            commands::has_api_key,
            commands::delete_api_key,
            commands::test_llm,
            commands::provider_models,
            commands::local_models,
            commands::get_island_geometry,
            commands::island_resize,
            commands::open_dashboard,
            commands::take_mcp_prefill,
            commands::start_session,
            commands::stop_session,
            commands::cancel_session,
            commands::ask_assistant,
            commands::assistant_followup,
            commands::list_assistant,
            commands::list_history,
            commands::get_analytics,
            commands::list_todos,
            commands::add_todo,
            commands::update_todo,
            commands::snooze_todo,
            commands::answer_claude_permission,
            commands::check_update,
            commands::install_update,
            commands::list_skills,
            commands::list_connections,
            commands::save_connection,
            commands::delete_connection,
            commands::test_connection,
            commands::save_skill,
            commands::delete_skill,
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
            commands::meeting_info,
            commands::rename_speaker,
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
            commands::account_status,
            commands::account_login,
            commands::account_google_start,
            commands::account_exchange,
            commands::account_logout,
            commands::repair_permissions,
            commands::open_claude_session,
            commands::list_claude_sessions,
            commands::open_claude_by_session,
            commands::focus_claude_session,
            commands::dismiss_claude_session,
            commands::accept_correction,
            commands::undo_correction,
            commands::list_integrations,
            commands::install_integration,
            commands::uninstall_integration,
            commands::slack_connect,
            commands::slack_oauth_start,
            commands::slack_status,
            commands::slack_disconnect,
            commands::slack_sync_now,
            commands::confirm_action,
            commands::stop_agent,
            commands::toggle_agent_mode,
            commands::agent_mode_status,
            commands::agent_confirm,
            commands::now_playing,
            commands::weather,
            commands::media_control,
            commands::get_volume,
            commands::set_volume,
            commands::vault_graph,
            commands::vault_note,
            commands::vault_save,
            commands::vault_delete,
            commands::vault_search,
            commands::vault_rebuild,
            commands::list_context_docs,
            commands::get_context_doc,
            commands::add_context_doc,
            commands::update_context_doc,
            commands::delete_context_doc,
            code::choose_folder,
            code::validate_repo_url,
            code::clone_repo,
            code::link_folder,
            code::repo_info,
            code::unlink_code,
            code::open_code,
            code::coding_agents,
            code::agent_sign_in,
            code::edit_with_ai,
            code::list_code_runs,
            code::code_run_log,
            code::stop_code_run,
            skillgen::generate_skill_graph,
            scheduler::run_skill_now,
            floagent::flo_agent_config,
            floagent::flo_agent_save_config,
            floagent::flo_agent_runs,
            floagent::flo_agent_plan,
            floagent::flo_agent_run,
            floagent::flo_agent_stop,
            floagent::flo_agent_clear_runs,
            hermes::hermes_status,
            hermes::hermes_export,
            hermes::hermes_start,
            hermes::hermes_stop,
            hermes::hermes_log,
            push::get_presence,
            push::set_presence,
            push::pair_phone_start,
            push::list_phones,
            push::remove_phone,
            push::send_test_push,
            autocontinue::list_auto_continue,
            autocontinue::set_auto_continue,
            autocontinue::auto_continue_now,
            autocontinue::cancel_auto_continue,
            autocontinue::dismiss_auto_continue,
            autocontinue::auto_continue_log,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let models_dir = data_dir.join("models");
            let settings = settings::load(&data_dir);
            let db_path = data_dir.join("flo.db");
            let key = secrets::db_key(&data_dir, db_path.exists()).map_err(|e| anyhow::anyhow!("Keychain unavailable: {e}"))?;
            let db = db::Db::open(&db_path, Some(&key))?;
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
                agent_abort: AtomicBool::new(false),
                signed_in: AtomicBool::new(true),
                attention_captures: AtomicU32::new(0),
                claude_listening: AtomicBool::new(false),
                claude_port: claude::PORT,
                last_front: Mutex::new(Default::default()),
            });
            app.manage(st.clone());
            account::allow_host(&st);
            st.signed_in.store(account::cached_signed_in(&st), std::sync::atomic::Ordering::SeqCst);
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                #[cfg(any(target_os = "linux", target_os = "windows"))]
                let _ = app.deep_link().register_all();
                let st_dl = st.clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        account::handle_deep_link(st_dl.clone(), url.to_string());
                        slack::handle_deep_link(st_dl.clone(), url.to_string());
                    }
                });
            }
            create_island(&handle)?;
            build_tray(&handle, st.clone())?;
            {
                let s = st.settings();
                platform::set_hotkeys(hotkey::HotkeyConfig::from_strings(&s.hotkey_dictation, &s.hotkey_assistant));
            }
            start_hotkeys(st.clone());
            meeting_detect::spawn(st.clone());
            slack::spawn(st.clone());
            match st.db.backfill_due_dates() {
                Ok(n) if n > 0 => log::info!("dated {n} to-do(s) from their words"),
                Err(e) => log::warn!("backfill due dates: {e}"),
                _ => {}
            }
            mcp::refresh_hosts(&st, None);
            reminders::spawn(st.clone());
            scheduler::spawn(st.clone());
            floagent::spawn(st.clone());
            push::spawn(st.clone());
            sync::spawn(st.clone());
            autocontinue::spawn(st.clone());
            attention::spawn(st.clone());
            // both read the hook token from the keychain, which can wait on a macOS permission
            // prompt; never block app start (and the notch) on that
            {
                let st2 = st.clone();
                std::thread::Builder::new()
                    .name("flo-claude-setup".into())
                    .spawn(move || {
                        claude::refresh_if_installed(&st2);
                        claude::spawn_listener(st2);
                    })
                    .ok();
            }
            updater::spawn_auto_check(handle.clone());
            media::init(handle.clone());
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
            // a Hermes gateway Flo started never outlives Flo
            if let tauri::RunEvent::Exit = event {
                hermes::shutdown();
            }
            let _ = (app, &event);
        });
}
