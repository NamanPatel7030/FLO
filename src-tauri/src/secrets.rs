//! BYOK API keys + database key, stored in macOS Keychain / Windows Credential Manager.
use anyhow::{bail, Result};

const SERVICE: &str = "com.flo.flow";
pub const PROVIDERS: &[&str] = &["openai", "anthropic", "gemini", "groq", "openrouter"];

fn entry(name: &str) -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(SERVICE, name)?)
}

pub fn set_api_key(provider: &str, key: &str) -> Result<()> {
    if !PROVIDERS.contains(&provider) {
        bail!("unknown provider {provider}");
    }
    let key = key.trim();
    if key.is_empty() {
        bail!("empty key");
    }
    entry(&format!("api-key:{provider}"))?.set_password(key)?;
    Ok(())
}

pub fn get_api_key(provider: &str) -> Option<String> {
    entry(&format!("api-key:{provider}")).ok()?.get_password().ok()
}

pub fn delete_api_key(provider: &str) -> Result<()> {
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
