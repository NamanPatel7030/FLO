//! BYOK API keys + database key, stored in macOS Keychain / Windows Credential Manager.
use anyhow::{bail, Result};

const SERVICE: &str = "com.flo.flow";
pub const PROVIDERS: &[&str] = &["openai", "anthropic", "gemini", "groq", "openrouter", "slack", "minimax", "qwen", "ollama_cloud"];

fn entry(name: &str) -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(SERVICE, name)?)
}

/// Keys read once per run (each Keychain read can trigger a macOS prompt).
static CACHE: parking_lot::Mutex<Option<std::collections::HashMap<String, String>>> = parking_lot::Mutex::new(None);

pub fn set_api_key(provider: &str, key: &str) -> Result<()> {
    if !PROVIDERS.contains(&provider) {
        bail!("unknown provider {provider}");
    }
    let key = key.trim();
    if key.is_empty() {
        bail!("empty key");
    }
    entry(&format!("api-key:{provider}"))?.set_password(key)?;
    CACHE.lock().get_or_insert_with(Default::default).insert(provider.to_string(), key.to_string());
    Ok(())
}

pub fn get_api_key(provider: &str) -> Option<String> {
    if let Some(k) = CACHE.lock().as_ref().and_then(|m| m.get(provider).cloned()) {
        return Some(k);
    }
    let k = entry(&format!("api-key:{provider}")).ok()?.get_password().ok()?;
    CACHE.lock().get_or_insert_with(Default::default).insert(provider.to_string(), k.clone());
    Some(k)
}

/// Like get_api_key but never hangs the caller on a pending Keychain prompt.
pub async fn get_api_key_async(provider: &str) -> anyhow::Result<Option<String>> {
    if let Some(k) = CACHE.lock().as_ref().and_then(|m| m.get(provider).cloned()) {
        return Ok(Some(k));
    }
    let p = provider.to_string();
    match tokio::time::timeout(std::time::Duration::from_secs(25), tokio::task::spawn_blocking(move || get_api_key(&p))).await {
        Ok(Ok(k)) => Ok(k),
        Ok(Err(e)) => Err(e.into()),
        Err(_) => anyhow::bail!(
            "macOS is asking whether Flo may use your saved {provider} key. Click “Always Allow” in the Keychain prompt (it may be behind other windows)."
        ),
    }
}

pub fn delete_api_key(provider: &str) -> Result<()> {
    if let Some(m) = CACHE.lock().as_mut() {
        m.remove(provider);
    }
    match entry(&format!("api-key:{provider}"))?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

fn random_hex32() -> String {
    use rand::RngCore;
    let mut b = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn write_private(path: &std::path::Path, s: &str) -> Result<()> {
    std::fs::write(path, s)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

/// Generic named secret in the keychain (e.g. the account token).
pub fn set_secret(name: &str, value: &str) -> Result<()> {
    entry(name)?.set_password(value)?;
    Ok(())
}

pub fn get_secret(name: &str) -> Option<String> {
    entry(name).ok()?.get_password().ok().filter(|s| !s.is_empty())
}

pub fn delete_secret(name: &str) -> Result<()> {
    match entry(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// 32-byte hex key for SQLCipher; created on first run.
///
/// Keychain first. A private key file (`.dbkey`, 0600) is used only when it already exists, or —
/// for a fresh install on a machine with no keychain service at all (CI, headless Linux) — created.
/// It never replaces an existing key, so a temporary keychain hiccup can't orphan the database.
pub fn db_key(data_dir: &std::path::Path, db_exists: bool) -> Result<String> {
    let file = data_dir.join(".dbkey");
    if let Ok(k) = std::fs::read_to_string(&file) {
        if k.trim().len() == 64 {
            return Ok(k.trim().to_string());
        }
    }
    match entry("db-key").and_then(|e| match e.get_password() {
        Ok(k) if k.len() == 64 => Ok(k),
        Ok(_) | Err(keyring::Error::NoEntry) => {
            let k = random_hex32();
            e.set_password(&k)?;
            Ok(k)
        }
        Err(err) => Err(err.into()),
    }) {
        Ok(k) => Ok(k),
        Err(err) if !db_exists => {
            log::warn!("no keychain ({err}); using a private key file for the new database");
            let k = random_hex32();
            write_private(&file, &k)?;
            Ok(k)
        }
        Err(err) => Err(err),
    }
}

static HOOK_TOKEN: parking_lot::Mutex<Option<String>> = parking_lot::Mutex::new(None);

/// Random token used to authenticate Claude Code hook calls to the local listener.
/// Falls back to an in-memory token if there's no keychain (hooks then refresh on start).
pub fn hook_token() -> Result<String> {
    if let Some(t) = HOOK_TOKEN.lock().clone() {
        return Ok(t);
    }
    let t = match entry("claude-hook-token").and_then(|e| match e.get_password() {
        Ok(k) if !k.is_empty() => Ok(k),
        _ => {
            let k = uuid::Uuid::new_v4().simple().to_string();
            e.set_password(&k)?;
            Ok(k)
        }
    }) {
        Ok(t) => t,
        Err(err) => {
            log::warn!("no keychain for hook token ({err}); using a session token");
            uuid::Uuid::new_v4().simple().to_string()
        }
    };
    *HOOK_TOKEN.lock() = Some(t.clone());
    Ok(t)
}
