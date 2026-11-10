//! BYOK API keys + database key, stored in macOS Keychain / Windows Credential Manager / the
//! Linux Secret Service (GNOME Keyring, KWallet) via the `keyring` crate.
use anyhow::{bail, Result};

const SERVICE: &str = "com.flo.flow";
pub const PROVIDERS: &[&str] = &["openai", "anthropic", "gemini", "groq", "openrouter", "slack", "minimax", "qwen", "ollama_cloud", "hermes_slack_bot", "hermes_slack_app", "sarvam", "google"];

fn entry(name: &str) -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(SERVICE, name)?)
}

// ---------------------------------------------------------------------------------------------
// One Keychain item for everything (macOS).
//
// Flo is signed without an Apple Team ID, so macOS ties each Keychain item to the exact build
// that may read it. Every update is a new build, and before this change each secret (database
// key, account token, sync key, hook token, every API key) was its own item, so one update meant
// one password prompt per item. Now all of them live in a single "vault" item, read once per run
// and kept in memory: at most one prompt after an update, and none in between.
// Windows and Linux keep one entry per secret (no such prompts there, and Windows caps an entry
// at 2.5 KB).
// ---------------------------------------------------------------------------------------------

#[cfg(target_os = "macos")]
const VAULT: &str = "vault";

/// Names that used to be separate Keychain items, copied into the vault on first run.
#[cfg(target_os = "macos")]
fn legacy_names() -> Vec<String> {
    let mut v: Vec<String> = ["db-key", "claude-hook-token", "account-token", "sync-key"].iter().map(|s| s.to_string()).collect();
    v.extend(PROVIDERS.iter().map(|p| format!("api-key:{p}")));
    v
}

/// Builds the vault from the old per-secret items (empty values are skipped).
pub(crate) fn collect_legacy(names: &[String], mut read: impl FnMut(&str) -> Option<String>) -> std::collections::HashMap<String, String> {
    names.iter().filter_map(|n| read(n).filter(|v| !v.is_empty()).map(|v| (n.clone(), v))).collect()
}

#[cfg(target_os = "macos")]
static VAULT_MAP: parking_lot::Mutex<Option<std::collections::HashMap<String, String>>> = parking_lot::Mutex::new(None);

#[cfg(target_os = "macos")]
fn with_vault<T>(f: impl FnOnce(&mut std::collections::HashMap<String, String>) -> Result<T>) -> Result<T> {
    let mut g = VAULT_MAP.lock();
    if g.is_none() {
        let e = entry(VAULT)?;
        let map = match e.get_password() {
            // a vault we can't read must never look empty (that would mint a new database key)
            Ok(json) => serde_json::from_str(&json).map_err(|e| anyhow::anyhow!("Keychain vault is unreadable: {e}"))?,
            Err(keyring::Error::NoEntry) => {
                // First run with the vault: copy the old items in (their last prompts, once).
                // The old items are left in place, so nothing can be lost if this is interrupted.
                let m = collect_legacy(&legacy_names(), |n| entry(n).ok()?.get_password().ok());
                e.set_password(&serde_json::to_string(&m)?)?;
                m
            }
            Err(err) => return Err(err.into()),
        };
        *g = Some(map);
    }
    f(g.as_mut().expect("vault loaded"))
}

#[cfg(target_os = "macos")]
fn save_vault(m: &std::collections::HashMap<String, String>) -> Result<()> {
    entry(VAULT)?.set_password(&serde_json::to_string(m)?)?;
    Ok(())
}

/// Read a secret. Err = no keychain (or the user denied it); Ok(None) = not set.
fn raw_get(name: &str) -> Result<Option<String>> {
    #[cfg(target_os = "macos")]
    {
        with_vault(|m| Ok(m.get(name).cloned()))
    }
    #[cfg(not(target_os = "macos"))]
    {
        match entry(name)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
}

fn raw_set(name: &str, value: &str) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        with_vault(|m| {
            let prev = m.insert(name.to_string(), value.to_string());
            save_vault(m).inspect_err(|_| {
                match prev {
                    Some(p) => m.insert(name.to_string(), p),
                    None => m.remove(name),
                };
            })
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        entry(name)?.set_password(value)?;
        Ok(())
    }
}

fn raw_delete(name: &str) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        with_vault(|m| match m.remove(name) {
            Some(_) => save_vault(m),
            None => Ok(()),
        })?;
        // also drop the pre-vault item, so a removed key can't come back from it
        let _ = entry(name).and_then(|e| Ok(e.delete_credential()));
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        match entry(name)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.into()),
        }
    }
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
    raw_set(&format!("api-key:{provider}"), key)?;
    CACHE.lock().get_or_insert_with(Default::default).insert(provider.to_string(), key.to_string());
    Ok(())
}

pub fn get_api_key(provider: &str) -> Option<String> {
    if let Some(k) = CACHE.lock().as_ref().and_then(|m| m.get(provider).cloned()) {
        return Some(k);
    }
    let k = raw_get(&format!("api-key:{provider}")).ok()??;
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
        Err(_) if cfg!(target_os = "macos") => anyhow::bail!(
            "macOS is asking whether Flo may use your saved {provider} key. Click “Always Allow” in the Keychain prompt (it may be behind other windows)."
        ),
        Err(_) => anyhow::bail!("Your system keyring didn't answer for the saved {provider} key. If it asked to be unlocked, unlock it and try again."),
    }
}

pub fn delete_api_key(provider: &str) -> Result<()> {
    if let Some(m) = CACHE.lock().as_mut() {
        m.remove(provider);
    }
    raw_delete(&format!("api-key:{provider}"))
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
    raw_set(name, value)
}

pub fn get_secret(name: &str) -> Option<String> {
    raw_get(name).ok().flatten().filter(|s| !s.is_empty())
}

pub fn delete_secret(name: &str) -> Result<()> {
    raw_delete(name)
}

/// The database key as a pre-vault Keychain item (macOS only; elsewhere the entry is the store).
fn legacy_db_key() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        entry("db-key").ok()?.get_password().ok().filter(|k| k.len() == 64)
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
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
    match raw_get("db-key").and_then(|v| match v {
        Some(k) if k.len() == 64 => Ok(k),
        // never mint a new key while an older Keychain item still holds one
        _ if legacy_db_key().is_some() => {
            let k = legacy_db_key().expect("checked");
            raw_set("db-key", &k)?;
            Ok(k)
        }
        _ => {
            let k = random_hex32();
            raw_set("db-key", &k)?;
            Ok(k)
        }
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
    let t = match raw_get("claude-hook-token").and_then(|v| match v {
        Some(k) if !k.is_empty() => Ok(k),
        _ => {
            let k = uuid::Uuid::new_v4().simple().to_string();
            raw_set("claude-hook-token", &k)?;
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

#[cfg(test)]
mod vault_tests {
    use super::collect_legacy;

    #[test]
    fn copies_only_present_non_empty_items() {
        let names: Vec<String> = ["db-key", "account-token", "sync-key", "api-key:openai"].iter().map(|s| s.to_string()).collect();
        let m = collect_legacy(&names, |n| match n {
            "db-key" => Some("a".repeat(64)),
            "account-token" => Some(String::new()),
            "api-key:openai" => Some("sk-test".into()),
            _ => None,
        });
        assert_eq!(m.len(), 2);
        assert_eq!(m["db-key"], "a".repeat(64));
        assert_eq!(m["api-key:openai"], "sk-test");
        assert!(!m.contains_key("account-token"));
    }
}
