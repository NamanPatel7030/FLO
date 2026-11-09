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
    let changed = migrate(&mut s) | fix_account_url(&mut s);
    if changed {
        let _ = save(data_dir, &s);
    }
    s
}

/// The live account server (sign-in and in-app updates). A build can point elsewhere with
/// FLO_ACCOUNT_URL at compile time.
pub const LIVE_ACCOUNT_URL: &str = match option_env!("FLO_ACCOUNT_URL") {
    Some(u) => u,
    None => "https://flo.hellonaman.com",
};

/// Release builds made before the site went live saved `http://localhost:3000` as the account
/// server, which breaks sign-in and updates (the updater only accepts https). Point those at the
/// live server. Dev builds keep whatever they have, and a custom https server is left alone.
pub fn fix_account_url(s: &mut Settings) -> bool {
    if cfg!(debug_assertions) {
        return false;
    }
    let local = url::Url::parse(&s.account_url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h == "localhost" || h == "127.0.0.1" || h == "::1" || h == "[::1]"))
        .unwrap_or(true);
    if local && s.account_url != LIVE_ACCOUNT_URL {
        s.account_url = LIVE_ACCOUNT_URL.into();
        return true;
    }
    false
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
    if s.settings_version < 6 {
        s.vault_auto = true;
    }
    if s.settings_version < 7 {
        // the Light / Dark / System switch is back and light is the new look. Before v7 the app was
        // dark-only (nobody chose "dark"), so everyone starts on light once and can switch back.
        s.theme = "light".into();
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
    fn v7_moves_everyone_to_light_once() {
        let mut s: Settings = serde_json::from_str(r#"{"settingsVersion":6,"theme":"dark"}"#).unwrap();
        assert!(migrate(&mut s));
        assert_eq!(s.theme, "light");
        // a later explicit choice sticks
        s.theme = "dark".into();
        assert!(!migrate(&mut s));
        assert_eq!(s.theme, "dark");
        assert_eq!(Settings::default().theme, "light");
    }

    #[test]
    fn cloud_detection() {
        assert!(is_cloud_llm("anthropic"));
        assert!(is_cloud_llm("minimax") && is_cloud_llm("qwen") && is_cloud_llm("ollama_cloud"));
        assert!(!is_cloud_llm("ollama"));
    }

    #[test]
    fn localhost_account_url_moves_to_the_live_server_in_release() {
        let mut s = Settings { account_url: "http://localhost:3000".into(), ..Default::default() };
        let changed = fix_account_url(&mut s);
        if cfg!(debug_assertions) {
            assert!(!changed);
        } else {
            assert!(changed);
            assert_eq!(s.account_url, LIVE_ACCOUNT_URL);
        }
        let mut custom = Settings { account_url: "https://flo.example.com".into(), ..Default::default() };
        assert!(!fix_account_url(&mut custom));
        assert_eq!(custom.account_url, "https://flo.example.com");
    }
}
