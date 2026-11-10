//! The little floating helper shown while the person turns on Accessibility in System Settings: a
//! card at the bottom of the screen that shows exactly which switch to flip. A watcher polls the
//! grant every second; the moment it lands the card closes and Flo comes back to the front, so
//! setup moves on by itself (no "I did it" button, no relaunch).
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "perm-guide";
const W: f64 = 380.0;
const H: f64 = 132.0;
/// Give up (and close the card) after this long without a grant.
const WATCH_FOR: Duration = Duration::from_secs(300);

static WATCHING: AtomicBool = AtomicBool::new(false);

/// Show the helper and watch for the grant. `granted` is polled every second.
pub fn show(app: &AppHandle, granted: fn() -> bool) {
    if granted() {
        return;
    }
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || open_window(&app2));
    if WATCHING.swap(true, Ordering::SeqCst) {
        return; // a watcher is already running
    }
    let app = app.clone();
    std::thread::Builder::new()
        .name("flo-perm-guide".into())
        .spawn(move || {
            let start = Instant::now();
            let mut ok = false;
            while start.elapsed() < WATCH_FOR {
                std::thread::sleep(Duration::from_secs(1));
                if granted() {
                    ok = true;
                    break;
                }
                if app.get_webview_window(LABEL).is_none() {
                    break; // closed by the person
                }
            }
            WATCHING.store(false, Ordering::SeqCst);
            close(&app);
            if ok {
                log::info!("accessibility granted, back to Flo");
                crate::show_dashboard(&app, None);
            }
        })
        .ok();
}

pub fn close(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
}

fn open_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.show();
        return;
    }
    let built = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .initialization_script("if (!location.hash || location.hash === '#/') { location.hash = '#/perm-guide'; }")
        .title("Turn on Flo")
        .inner_size(W, H)
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .visible_on_all_workspaces(true)
        .build();
    let win = match built {
        Ok(w) => w,
        Err(e) => {
            log::warn!("permission guide: {e}");
            return;
        }
    };
    // bottom centre of the screen with the cursor, clear of the Dock; System Settings opens above it
    if let Ok(Some(m)) = win.current_monitor().or_else(|_| win.primary_monitor()) {
        let scale = m.scale_factor();
        let size = m.size().to_logical::<f64>(scale);
        let pos = m.position().to_logical::<f64>(scale);
        let x = pos.x + (size.width - W) / 2.0;
        let y = pos.y + size.height - H - 96.0;
        let _ = win.set_position(tauri::LogicalPosition::new(x, y));
    }
}
