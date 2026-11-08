//! In-app updates from our own server (no Apple Developer ID needed).
//!
//! Flo asks `{account_url}/api/updates/{target}/{arch}/{current_version}`: the server answers
//! 204 when there is nothing newer, or a small JSON manifest (version, notes, download URL and an
//! ed25519 signature). Flo only installs a download whose signature matches the public key built
//! into the app (tauri.conf.json → plugins.updater.pubkey), so nobody but the holder of the private
//! key can push code to users.
//!
//! The flow the UI drives: `check_update` → "Update" button → `install_update` (progress events on
//! `flo://update`) → "Restart" button → `restart_app` → the new version starts.
use crate::egress::Purpose;
use crate::state::Shared;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

pub const UPDATE_EVENT: &str = "flo://update";
/// How often a running Flo looks for a new version.
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
/// Give the app a moment to settle before the first check.
const FIRST_CHECK_AFTER: Duration = Duration::from_secs(20);

/// The update found by the last check, waiting for the user to press "Update".
static PENDING: Mutex<Option<Update>> = Mutex::new(None);
/// An update has been installed on disk; a restart switches to it.
static READY: AtomicBool = AtomicBool::new(false);
/// A download is in progress (ignore a second click).
static BUSY: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub current: String,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub date: Option<String>,
    /// downloaded and installed, waiting for a restart
    pub ready: bool,
}

/// Progress pushed to every window while an update downloads and installs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "phase")]
pub enum UpdateEvent {
    Available { version: String, notes: Option<String> },
    Downloading { downloaded: u64, total: Option<u64> },
    Ready { version: String },
    Error { message: String },
}

/// The URL template the updater fills in ({{target}} = darwin/windows/linux, {{arch}} = aarch64/x86_64).
pub fn endpoint(account_url: &str) -> String {
    format!("{}/api/updates/{{{{target}}}}/{{{{arch}}}}/{{{{current_version}}}}", account_url.trim_end_matches('/'))
}

fn current(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

fn info_from(app: &AppHandle, u: Option<&Update>) -> UpdateInfo {
    UpdateInfo {
        available: u.is_some(),
        current: current(app),
        version: u.map(|u| u.version.clone()),
        notes: u.and_then(|u| u.body.clone()).filter(|s| !s.trim().is_empty()),
        date: u.and_then(|u| u.date).map(|d| d.to_string()),
        ready: READY.load(Ordering::SeqCst),
    }
}

/// Ask the server whether a newer version exists. Remembers it for `install`.
pub async fn check(app: &AppHandle) -> Result<UpdateInfo, String> {
    if READY.load(Ordering::SeqCst) {
        let pending = PENDING.lock().unwrap().clone();
        return Ok(info_from(app, pending.as_ref()));
    }
    let st = app.state::<Shared>();
    let base = st.settings().account_url;
    let url = endpoint(&base);
    // the update server is the same host the app already uses for the account (allow-listed)
    st.egress.check(&base, Purpose::Account, true).map_err(|e| e.to_string())?;
    let parsed = url::Url::parse(&url).map_err(|e| format!("Bad update server address: {e}"))?;
    let updater = app
        .updater_builder()
        .endpoints(vec![parsed])
        .map_err(|e| e.to_string())?
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let found = updater.check().await.map_err(|e| format!("Couldn't check for updates: {e}"))?;
    log::info!("update check: current {} → {:?}", current(app), found.as_ref().map(|u| &u.version));
    let info = info_from(app, found.as_ref());
    *PENDING.lock().unwrap() = found;
    Ok(info)
}

/// Download, verify and install the pending update. The running app keeps working; a restart
/// switches to the new version.
pub async fn install(app: &AppHandle) -> Result<UpdateInfo, String> {
    if READY.load(Ordering::SeqCst) {
        return Ok(info_from(app, PENDING.lock().unwrap().clone().as_ref()));
    }
    if BUSY.swap(true, Ordering::SeqCst) {
        return Err("An update is already downloading".into());
    }
    let result = install_inner(app).await;
    BUSY.store(false, Ordering::SeqCst);
    if let Err(e) = &result {
        let _ = app.emit(UPDATE_EVENT, UpdateEvent::Error { message: e.clone() });
    }
    result
}

async fn install_inner(app: &AppHandle) -> Result<UpdateInfo, String> {
    let mut pending = PENDING.lock().unwrap().clone();
    if pending.is_none() {
        check(app).await?;
        pending = PENDING.lock().unwrap().clone();
    }
    let update = pending.ok_or("Flo is already up to date")?;
    let version = update.version.clone();
    let mut downloaded: u64 = 0;
    let mut last_emit = std::time::Instant::now() - Duration::from_secs(1);
    let progress_app = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                // ~10 progress events a second is plenty for a progress bar
                if last_emit.elapsed() >= Duration::from_millis(100) || Some(downloaded) == total {
                    last_emit = std::time::Instant::now();
                    let _ = progress_app.emit(UPDATE_EVENT, UpdateEvent::Downloading { downloaded, total });
                }
            },
            || {},
        )
        .await
        .map_err(|e| format!("Update failed: {e}"))?;
    READY.store(true, Ordering::SeqCst);
    log::info!("update {version} installed; waiting for restart");
    let _ = app.emit(UPDATE_EVENT, UpdateEvent::Ready { version });
    Ok(info_from(app, Some(&update)))
}

/// Check in the background after launch and then every few hours; tell the UI when one appears.
pub fn spawn_auto_check(app: AppHandle) {
    if cfg!(debug_assertions) || std::env::var_os("FLO_NO_UPDATE_CHECK").is_some() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_AFTER).await;
        let mut announced: Option<String> = None;
        loop {
            match check(&app).await {
                Ok(info) if info.available && !info.ready => {
                    let v = info.version.clone().unwrap_or_default();
                    if announced.as_deref() != Some(v.as_str()) {
                        announced = Some(v.clone());
                        let _ = app.emit(UPDATE_EVENT, UpdateEvent::Available { version: v, notes: info.notes });
                    }
                }
                Ok(_) => {}
                Err(e) => log::warn!("update check failed: {e}"),
            }
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_keeps_the_updater_placeholders() {
        assert_eq!(endpoint("https://flo.app/"), "https://flo.app/api/updates/{{target}}/{{arch}}/{{current_version}}");
        assert_eq!(endpoint("http://localhost:3000"), "http://localhost:3000/api/updates/{{target}}/{{arch}}/{{current_version}}");
    }

    #[test]
    fn events_serialize_with_a_phase_tag() {
        let j = serde_json::to_value(UpdateEvent::Downloading { downloaded: 5, total: Some(10) }).unwrap();
        assert_eq!(j["phase"], "downloading");
        assert_eq!(j["total"], 10);
        let j = serde_json::to_value(UpdateEvent::Ready { version: "0.2.0".into() }).unwrap();
        assert_eq!(j["phase"], "ready");
        assert_eq!(j["version"], "0.2.0");
    }
}
