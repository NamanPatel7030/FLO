//! Settings persisted as JSON in the app data dir (no secrets here — keys live in the keychain).
use crate::model::Settings;
use anyhow::Result;
use std::path::{Path, PathBuf};

pub fn path(data_dir: &Path) -> PathBuf {
    data_dir.join("settings.json")
}

pub fn load(data_dir: &Path) -> Settings {
    let mut s: Settings = std::fs::read_to_string(path(data_dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    if migrate(&mut s) {
        let _ = save(data_dir, &s);
    }
    s
}

/// v2: choosing a cloud model + adding your own key is consent for the Assistant to use it.
pub fn migrate(s: &mut Settings) -> bool {
    if s.settings_version >= crate::model::SETTINGS_VERSION {
        return false;
    }
    if s.settings_version < 2 {
        s.assistant_cloud_allowed = true;
    }
    if s.settings_version < 3 {
        // requested layout: fn → assistant, control → dictation
        s.hotkey_dictation = "ctrl".into();
        s.hotkey_assistant = "fn".into();
        s.meeting_detection = true;
        s.learn_corrections = true;
    }
    if s.settings_version < 4 {
        // anyone upgrading already set Flo up — don't show the first-run wizard
        s.onboarded = true;
    }
    if s.settings_version < 5 {
        // existing installs keep the dark look + default blue accent / ribbon notch
        if s.theme.is_empty() {
            s.theme = "dark".into();
        }
        if s.accent.is_empty() {
            s.accent = "#3dbbff".into();
        }
        if s.notch_style.is_empty() {
            s.notch_style = "ribbon".into();
        }
    }
    s.settings_version = crate::model::SETTINGS_VERSION;
    true
}

pub fn save(data_dir: &Path, s: &Settings) -> Result<()> {
    std::fs::create_dir_all(data_dir)?;
    let tmp = data_dir.join("settings.json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(s)?)?;
    std::fs::rename(tmp, path(data_dir))?;
    Ok(())
}

pub fn is_cloud_llm(provider: &str) -> bool {
    matches!(provider, "openai" | "anthropic" | "gemini" | "groq" | "openrouter" | "minimax" | "qwen" | "ollama_cloud")
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
    fn migrates_v1_to_allow_byok_assistant() {
        let mut s: Settings = serde_json::from_str(r#"{"assistantCloudAllowed":false,"llmProvider":"anthropic"}"#).unwrap();
        assert_eq!(s.settings_version, 0);
        assert!(migrate(&mut s));
        assert!(s.assistant_cloud_allowed);
        assert!(!migrate(&mut s));
        // user can still turn it off afterwards
        s.assistant_cloud_allowed = false;
        assert!(!migrate(&mut s));
        assert!(!s.assistant_cloud_allowed);
        assert_eq!((s.hotkey_dictation.as_str(), s.hotkey_assistant.as_str()), ("ctrl", "fn"));
        assert!(s.onboarded); // upgraded installs skip the wizard
        assert!(!Settings::default().onboarded); // fresh installs see it
    }

    #[test]
    fn cloud_detection() {
        assert!(is_cloud_llm("anthropic"));
        assert!(is_cloud_llm("minimax") && is_cloud_llm("qwen") && is_cloud_llm("ollama_cloud"));
        assert!(!is_cloud_llm("ollama"));
    }
}
