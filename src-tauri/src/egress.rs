//! Egress guard: the ONLY way Flo talks to the network.
//!
//! * localhost (Ollama / LM Studio) — always allowed
//! * known BYOK providers — only when the calling feature is allowed to use cloud
//! * model hub (Hugging Face) — only for model downloads
//! * anything else — denied
//!
//! Every attempt (allowed or not) is recorded in an in-memory log shown in Settings → Privacy.
use crate::model::NetworkLogEntry;
use anyhow::{bail, Result};
use parking_lot::Mutex;
use std::collections::VecDeque;
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostClass {
    Local,
    Provider,
    ModelHub,
    Weather,
    /// track artwork images (YouTube / Spotify thumbnail CDNs)
    Artwork,
    /// Google Calendar / Gmail APIs and token revocation (Connect with Google)
    Google,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Purpose {
    Stt,
    Cleanup,
    Assistant,
    Meeting,
    Attention,
    ModelDownload,
    Test,
    Slack,
    Weather,
    /// a user-added MCP server (only the hosts the user configured)
    Mcp,
    Account,
    /// the thumbnail of what's playing (Now Playing card)
    Artwork,
    /// end-to-end encrypted sync (ciphertext only, to the account host)
    Sync,
    /// Google Calendar + Gmail, straight to googleapis.com with the user's own token
    Google,
}

impl Purpose {
    pub fn as_str(&self) -> &'static str {
        match self {
            Purpose::Stt => "speech-to-text",
            Purpose::Cleanup => "dictation cleanup",
            Purpose::Assistant => "assistant",
            Purpose::Meeting => "meeting notes",
            Purpose::Attention => "attention",
            Purpose::ModelDownload => "model download",
            Purpose::Test => "connection test",
            Purpose::Slack => "slack",
            Purpose::Weather => "weather",
            Purpose::Mcp => "mcp server",
            Purpose::Account => "account sign-in",
            Purpose::Artwork => "now playing artwork",
            Purpose::Sync => "encrypted sync",
            Purpose::Google => "google calendar and gmail",
        }
    }
}

const PROVIDER_HOSTS: &[&str] = &[
    "api.openai.com",
    "api.anthropic.com",
    "generativelanguage.googleapis.com",
    "api.groq.com",
    "openrouter.ai",
    "slack.com",
    "api.minimax.io",
    "api.minimaxi.com",
    "dashscope-intl.aliyuncs.com",
    "dashscope.aliyuncs.com",
    "ollama.com",
    "api.sarvam.ai",
];

/// Calendar (www.googleapis.com/calendar/v3), Gmail, and token revocation. Reachable only for
/// Purpose::Google, with the user's own OAuth token.
const GOOGLE_HOSTS: &[&str] = &["www.googleapis.com", "gmail.googleapis.com", "oauth2.googleapis.com"];

pub fn classify_host(host: &str) -> HostClass {
    let h = host.trim_end_matches('.').to_ascii_lowercase();
    if h == "localhost" || h == "127.0.0.1" || h == "::1" || h == "[::1]" {
        return HostClass::Local;
    }
    if PROVIDER_HOSTS.contains(&h.as_str()) {
        return HostClass::Provider;
    }
    if h == "huggingface.co" || h.ends_with(".huggingface.co") || h == "hf.co" || h.ends_with(".hf.co") {
        return HostClass::ModelHub;
    }
    // weather: key-less, privacy-friendly endpoints (approximate IP location + open-meteo forecast)
    if h == "api.open-meteo.com" || h == "ipapi.co" {
        return HostClass::Weather;
    }
    // now-playing thumbnails: YouTube and Spotify image CDNs only
    if h == "i.ytimg.com" || h == "i.scdn.co" {
        return HostClass::Artwork;
    }
    // Connect with Google: exact API hosts only (generativelanguage.googleapis.com stays a provider)
    if GOOGLE_HOSTS.contains(&h.as_str()) {
        return HostClass::Google;
    }
    HostClass::Unknown
}

pub fn is_allowed(host: &str, purpose: Purpose, cloud_allowed: bool) -> bool {
    match classify_host(host) {
        HostClass::Local => true,
        HostClass::Provider => cloud_allowed && purpose != Purpose::ModelDownload,
        HostClass::ModelHub => purpose == Purpose::ModelDownload,
        HostClass::Weather => purpose == Purpose::Weather,
        HostClass::Artwork => purpose == Purpose::Artwork,
        HostClass::Google => purpose == Purpose::Google,
        HostClass::Unknown => false,
    }
}

fn host_of(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|s| s.to_string()))
        .unwrap_or_default()
}

const LOG_CAP: usize = 500;

#[derive(Clone)]
pub struct Egress {
    log: Arc<Mutex<VecDeque<NetworkLogEntry>>>,
    /// the one account server host (Purpose::Account only)
    account_host: Arc<Mutex<Option<String>>>,
    /// hosts of MCP servers the user added (Purpose::Mcp only)
    mcp_hosts: Arc<Mutex<std::collections::HashSet<String>>>,
}

impl Default for Egress {
    fn default() -> Self {
        Self::new()
    }
}

impl Egress {
    pub fn new() -> Self {
        Self { log: Arc::new(Mutex::new(VecDeque::new())), account_host: Arc::new(Mutex::new(None)), mcp_hosts: Arc::new(Mutex::new(Default::default())) }
    }

    fn push(&self, host: &str, purpose: Purpose, allowed: bool, bytes: u64) {
        self.push_full(host, purpose, allowed, bytes, None, None);
    }

    fn push_full(&self, host: &str, purpose: Purpose, allowed: bool, bytes: u64, tokens_in: Option<u64>, tokens_out: Option<u64>) {
        let mut log = self.log.lock();
        if log.len() >= LOG_CAP {
            log.pop_front();
        }
        log.push_back(NetworkLogEntry {
            at: chrono::Local::now().to_rfc3339(),
            host: host.to_string(),
            purpose: purpose.as_str().to_string(),
            allowed,
            bytes,
            tokens_in,
            tokens_out,
        });
    }

    /// Record a completed AI call with its token usage.
    pub fn record_usage(&self, url: &str, purpose: Purpose, bytes: u64, tokens_in: Option<u64>, tokens_out: Option<u64>) {
        self.push_full(&host_of(url), purpose, true, bytes, tokens_in, tokens_out);
    }

    pub fn allow_account_host(&self, host: &str) {
        *self.account_host.lock() = Some(host.to_ascii_lowercase());
    }

    fn is_account_host(&self, host: &str, purpose: Purpose) -> bool {
        ((purpose == Purpose::Account || purpose == Purpose::Sync) && self.account_host.lock().as_deref() == Some(host.to_ascii_lowercase().as_str()))
            || (purpose == Purpose::Mcp && self.mcp_hosts.lock().contains(&host.to_ascii_lowercase()))
    }

    /// Replace the set of user-configured MCP hosts (reachable for Purpose::Mcp only).
    pub fn set_mcp_hosts(&self, hosts: impl IntoIterator<Item = String>) {
        *self.mcp_hosts.lock() = hosts.into_iter().map(|h| h.to_ascii_lowercase()).collect();
    }

    /// Validate a URL before a request. Logs denials.
    pub fn check(&self, url: &str, purpose: Purpose, cloud_allowed: bool) -> Result<()> {
        let host = host_of(url);
        if self.is_account_host(&host, purpose) {
            return Ok(());
        }
        if host.is_empty() {
            self.push(url, purpose, false, 0);
            bail!("Blocked: invalid URL");
        }
        if !is_allowed(&host, purpose, cloud_allowed) {
            self.push(&host, purpose, false, 0);
            match classify_host(&host) {
                HostClass::Provider => bail!(
                    "Blocked by privacy settings: {} may not use cloud providers. Enable it in Settings → Privacy, or use a local model.",
                    purpose.as_str()
                ),
                _ => bail!("Blocked: {host} is not an allowed host"),
            }
        }
        Ok(())
    }

    /// Record a completed request (bytes sent+received).
    pub fn record(&self, url: &str, purpose: Purpose, bytes: u64) {
        self.push(&host_of(url), purpose, true, bytes);
    }

    pub fn entries(&self) -> Vec<NetworkLogEntry> {
        self.log.lock().iter().rev().cloned().collect()
    }

    /// HTTP client whose redirects are re-checked against the policy.
    pub fn client(&self, purpose: Purpose, cloud_allowed: bool) -> reqwest::Client {
        let me = self.clone();
        let policy = reqwest::redirect::Policy::custom(move |attempt| {
            let host = attempt.url().host_str().unwrap_or_default().to_string();
            if attempt.previous().len() > 8 {
                attempt.error("too many redirects")
            } else if is_allowed(&host, purpose, cloud_allowed) || me.is_account_host(&host, purpose) {
                attempt.follow()
            } else {
                me.push(&host, purpose, false, 0);
                attempt.stop()
            }
        });
        reqwest::Client::builder()
            .redirect(policy)
            .user_agent("Flo/0.1")
            .connect_timeout(std::time::Duration::from_secs(10))
            .build()
            .expect("http client")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_hosts_only_for_mcp() {
        let e = Egress::new();
        e.set_mcp_hosts(["mcp.example.com".to_string()]);
        assert!(e.check("https://mcp.example.com/mcp", Purpose::Mcp, false).is_ok());
        assert!(e.check("https://mcp.example.com/mcp", Purpose::Assistant, true).is_err());
        assert!(e.check("https://other.example.com/mcp", Purpose::Mcp, false).is_err());
    }

    #[test]
    fn localhost_always_allowed() {
        assert!(is_allowed("127.0.0.1", Purpose::Attention, false));
        assert!(is_allowed("localhost", Purpose::Assistant, false));
    }

    #[test]
    fn providers_need_cloud_opt_in() {
        assert!(!is_allowed("api.openai.com", Purpose::Assistant, false));
        assert!(is_allowed("api.openai.com", Purpose::Assistant, true));
        assert!(!is_allowed("api.anthropic.com", Purpose::ModelDownload, true));
    }

    #[test]
    fn model_hub_only_for_downloads() {
        assert!(is_allowed("huggingface.co", Purpose::ModelDownload, false));
        assert!(is_allowed("cdn-lfs-us-1.hf.co", Purpose::ModelDownload, false));
        assert!(!is_allowed("huggingface.co", Purpose::Assistant, true));
    }

    #[test]
    fn unknown_hosts_denied_and_logged() {
        let e = Egress::new();
        assert!(e.check("https://api.segment.io/v1/track", Purpose::Test, true).is_err());
        assert!(e.check("https://evil.example.com", Purpose::Assistant, true).is_err());
        let log = e.entries();
        assert_eq!(log.len(), 2);
        assert!(log.iter().all(|l| !l.allowed));
    }

    #[test]
    fn account_host_only_for_account_purpose() {
        let e = Egress::new();
        assert!(e.check("https://flo.example.com/api/app/me", Purpose::Account, true).is_err());
        e.allow_account_host("flo.example.com");
        assert!(e.check("https://flo.example.com/api/app/me", Purpose::Account, true).is_ok());
        assert!(e.check("https://flo.example.com/x", Purpose::Assistant, true).is_err());
        assert!(e.check("https://evil.example.com/x", Purpose::Account, true).is_err());
    }

    #[test]
    fn google_apis_only_for_google() {
        for h in ["www.googleapis.com", "gmail.googleapis.com", "oauth2.googleapis.com"] {
            assert_eq!(classify_host(h), HostClass::Google, "{h}");
            assert!(is_allowed(h, Purpose::Google, false), "{h}");
            assert!(!is_allowed(h, Purpose::Assistant, true), "{h}");
            assert!(!is_allowed(h, Purpose::Slack, true), "{h}");
        }
        // Gemini stays a cloud provider, not a Google-integration host
        assert_eq!(classify_host("generativelanguage.googleapis.com"), HostClass::Provider);
        assert!(!is_allowed("generativelanguage.googleapis.com", Purpose::Google, false));
        assert_eq!(classify_host("evil.googleapis.com"), HostClass::Unknown);
        assert_eq!(classify_host("www.googleapis.com.evil.io"), HostClass::Unknown);
    }

    #[test]
    fn lookalike_hosts_denied() {
        assert_eq!(classify_host("api.openai.com.evil.io"), HostClass::Unknown);
        assert_eq!(classify_host("nothuggingface.co"), HostClass::Unknown);
    }
}
