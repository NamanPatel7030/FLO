//! Test mode for the real-app desktop E2E suite (tests/desktop-e2e).
//!
//! Two locks keep this out of users' hands:
//! * it is only compiled with `--features e2e`, which only the desktop-e2e CI job and the local
//!   Docker runner pass. Release builds (desktop.yml, release-mac.sh) never enable it, so there
//!   `active()` is a constant `false` and every hook below is dead code the compiler removes;
//! * even in an e2e build nothing changes unless the process is started with `FLO_E2E=1`.
//!
//! What it does when active (all pointed at things the test harness runs on 127.0.0.1):
//! * `FLO_E2E_ACCOUNT_URL` — the account server (a local mock). Sign-in is enforced against it
//!   exactly as against the live https server, through the same code path (token exchange, /me).
//! * `FLO_E2E_MODEL_URL` — base URL speech models download from instead of huggingface.co.
//! * `FLO_E2E_WAV` — a 16-bit WAV file played into the dictation path in real time instead of the
//!   microphone (CI machines have none).
//! * the `e2e_*` commands: read-only window/tray facts, and the tray menu's actions (a test can't
//!   click a system tray icon portably).
use serde::Serialize;

#[cfg(feature = "e2e")]
pub fn active() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| {
        let on = std::env::var("FLO_E2E").as_deref() == Ok("1");
        if on {
            log::warn!("E2E TEST MODE: account server, model downloads and microphone are stubbed");
        }
        on
    })
}

#[cfg(not(feature = "e2e"))]
#[inline(always)]
pub const fn active() -> bool {
    false
}

/// Windows: `dwExtraInfo` of the key events the E2E harness injects (support/input.ps1), so a test
/// build accepts them as the Flo key while Flo's own injected paste keys are still ignored.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub const E2E_KEY_TAG: usize = 0x0F10_E2E0;

fn var(k: &str) -> Option<String> {
    if !active() {
        return None;
    }
    std::env::var(k).ok().filter(|v| !v.trim().is_empty())
}

/// Only loopback URLs are accepted, so even a test build can't be pointed at another server.
fn loopback(url: String) -> Option<String> {
    let u = url::Url::parse(&url).ok()?;
    matches!(u.host_str(), Some("127.0.0.1" | "localhost" | "[::1]")).then_some(url)
}

/// The mock account server to use instead of Settings.account_url.
pub fn account_url() -> Option<String> {
    var("FLO_E2E_ACCOUNT_URL").and_then(loopback)
}

/// Where to download speech model `file` from instead of huggingface.co.
pub fn model_url(file: &str) -> Option<String> {
    var("FLO_E2E_MODEL_URL").and_then(loopback).map(|b| format!("{}/{file}", b.trim_end_matches('/')))
}

/// A WAV file to play into the dictation path instead of the microphone.
pub fn wav_input() -> Option<std::path::PathBuf> {
    var("FLO_E2E_WAV").map(std::path::PathBuf::from).filter(|p| p.is_file())
}

/// Windows: what msedgedriver asks WebView2 for (a DevTools port, its own profile folder) through
/// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS / WEBVIEW2_USER_DATA_FOLDER. On the CI runner WebView2
/// didn't apply them next to the options wry passes itself, so DevToolsActivePort never appeared
/// and no session started. In a test build, pass them as the windows' own options instead (with
/// wry's default arguments kept). (args, data folder); None outside the test mode.
pub fn webview2_overrides() -> Option<(Option<String>, Option<std::path::PathBuf>)> {
    if !active() || !cfg!(target_os = "windows") {
        return None;
    }
    let args = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS")
        .ok()
        .filter(|a| !a.trim().is_empty())
        .map(|a| format!("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection {a}"));
    let dir = std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").map(std::path::PathBuf::from);
    if args.is_some() || dir.is_some() {
        log::warn!("E2E: WebView2 args {args:?}, data folder {dir:?}");
        Some((args, dir))
    } else {
        None
    }
}

/// Decode a WAV file to mono f32 samples at its own rate.
pub fn read_wav(path: &std::path::Path) -> anyhow::Result<(Vec<f32>, u32)> {
    let mut r = hound::WavReader::open(path)?;
    let spec = r.spec();
    let ch = spec.channels.max(1) as usize;
    let raw: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => r.samples::<f32>().collect::<Result<_, _>>()?,
        hound::SampleFormat::Int => {
            let max = (1i64 << (spec.bits_per_sample.max(1) - 1)) as f32;
            r.samples::<i32>().map(|s| s.map(|v| v as f32 / max)).collect::<Result<_, _>>()?
        }
    };
    Ok((raw.chunks(ch).map(|f| f.iter().sum::<f32>() / ch as f32).collect(), spec.sample_rate))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    label: String,
    visible: bool,
    /// inner size in logical px
    width: f64,
    height: f64,
    x: f64,
    y: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pid: u32,
    windows: Vec<WindowInfo>,
    tray: bool,
    signed_in: bool,
    data_dir: String,
}

fn guard() -> Result<(), String> {
    if active() {
        Ok(())
    } else {
        Err("not available".into())
    }
}

/// Facts about this process the tests assert on (one pid, which windows, is the tray up).
#[tauri::command]
pub fn e2e_info(app: tauri::AppHandle, st: tauri::State<'_, crate::state::Shared>) -> Result<Info, String> {
    guard()?;
    use tauri::Manager;
    let windows = app
        .webview_windows()
        .into_values()
        .map(|w| {
            let s = w.scale_factor().unwrap_or(1.0);
            let size = w.inner_size().map(|p| p.to_logical::<f64>(s)).unwrap_or(tauri::LogicalSize::new(0.0, 0.0));
            let pos = w.outer_position().map(|p| p.to_logical::<f64>(s)).unwrap_or(tauri::LogicalPosition::new(0.0, 0.0));
            WindowInfo { label: w.label().to_string(), visible: w.is_visible().unwrap_or(false), width: size.width, height: size.height, x: pos.x, y: pos.y }
        })
        .collect();
    Ok(Info {
        pid: std::process::id(),
        windows,
        tray: app.tray_by_id("flo").is_some(),
        signed_in: st.signed_in.load(std::sync::atomic::Ordering::SeqCst),
        data_dir: st.data_dir.display().to_string(),
    })
}

/// Run a tray menu item exactly as clicking it would (open / dictate / quit …).
#[tauri::command]
pub fn e2e_tray(app: tauri::AppHandle, st: tauri::State<'_, crate::state::Shared>, id: String) -> Result<(), String> {
    guard()?;
    let st = st.inner().clone();
    let a = app.clone();
    // menu events arrive on the main thread; keep that
    app.run_on_main_thread(move || crate::on_tray_menu(&a, &st, &id)).map_err(|e| e.to_string())
}

/// Close a window the way its title-bar ✕ does (a close request the app may handle).
#[tauri::command]
pub fn e2e_close_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    guard()?;
    use tauri::Manager;
    app.get_webview_window(&label).ok_or("no such window")?.close().map_err(|e| e.to_string())
}

/// Store a note as a finished meeting would (screenshot tours seed a transcript with speakers,
/// a summary and action items without needing a call or an AI model).
#[tauri::command]
pub fn e2e_seed_note(st: tauri::State<'_, crate::state::Shared>, note: crate::model::Note) -> Result<(), String> {
    guard()?;
    st.db.upsert_note(&note).map_err(|e| e.to_string())?;
    st.emit(crate::model::ev::NOTES, ());
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn inert_without_the_feature_or_the_env_var() {
        // `cargo test` builds without the e2e feature: every hook must be off
        if !cfg!(feature = "e2e") {
            assert!(!super::active());
            assert!(super::account_url().is_none());
            assert!(super::model_url("x.bin").is_none());
            assert!(super::wav_input().is_none());
        }
    }

    #[test]
    fn only_loopback_servers() {
        assert!(super::loopback("http://127.0.0.1:4010".into()).is_some());
        assert!(super::loopback("http://localhost:4010/x".into()).is_some());
        assert!(super::loopback("https://flo.hellonaman.com".into()).is_none());
        assert!(super::loopback("http://127.0.0.1.evil.com".into()).is_none());
    }
}
