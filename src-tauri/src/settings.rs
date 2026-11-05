//! Settings persisted as JSON in the app data dir (no secrets here — keys live in the keychain).
use crate::model::Settings;
use anyhow::Result;
use std::path::{Path, PathBuf};

pub fn path(data_dir: &Path) -> PathBuf {
    data_dir.join("settings.json")
}

pub fn load(data_dir: &Path) -> Settings {
    std::fs::read_to_string(path(data_dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(data_dir: &Path, s: &Settings) -> Result<()> {
    std::fs::create_dir_all(data_dir)?;
    let tmp = data_dir.join("settings.json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(s)?)?;
    std::fs::rename(tmp, path(data_dir))?;
    Ok(())
}

pub fn is_cloud_llm(provider: &str) -> bool {
    matches!(provider, "openai" | "anthropic" | "gemini" | "groq" | "openrouter")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_defaults() {
        let dir = std::env::temp_dir().join(format!("flo-settings-{}", uuid::Uuid::new_v4()));
        assert_eq!(load(&dir), Settings::default());
        let mut s = Settings::default();
        s.user_name = "Parth".into();
        save(&dir, &s).unwrap();
        assert_eq!(load(&dir).user_name, "Parth");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn cloud_detection() {
        assert!(is_cloud_llm("anthropic"));
        assert!(!is_cloud_llm("ollama"));
    }
}
