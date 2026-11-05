//! BYOK API keys + database key, stored in macOS Keychain / Windows Credential Manager.
use anyhow::{bail, Result};

const SERVICE: &str = "com.flo.flow";
pub const PROVIDERS: &[&str] = &["openai", "anthropic", "gemini", "groq", "openrouter"];

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
            "macOS is asking whether Flo may use your saved {provider} key — click “Always Allow” in the Keychain prompt (it may be behind other windows)."
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

/// 32-byte hex key for SQLCipher; created on first run.
pub fn db_key() -> Result<String> {
    let e = entry("db-key")?;
    match e.get_password() {
        Ok(k) if k.len() == 64 => Ok(k),
        _ => {
            use rand::RngCore;
            let mut b = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut b);
            let k: String = b.iter().map(|x| format!("{x:02x}")).collect();
            e.set_password(&k)?;
            Ok(k)
        }
    }
}

/// Random token used to authenticate Claude Code hook calls to the local listener.
pub fn hook_token() -> Result<String> {
    let e = entry("claude-hook-token")?;
    match e.get_password() {
        Ok(k) if !k.is_empty() => Ok(k),
        _ => {
            let k = uuid::Uuid::new_v4().simple().to_string();
            e.set_password(&k)?;
            Ok(k)
        }
    }
}
