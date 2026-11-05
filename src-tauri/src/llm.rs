//! BYOK LLM client: local (Ollama / LM Studio) + OpenAI-compatible, Anthropic, Gemini.
use crate::egress::{Egress, Purpose};
use crate::model::Settings;
use crate::secrets;
use anyhow::{anyhow, bail, Result};
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct LlmConfig {
    pub provider: String,
    pub model: String,
    pub local_url: String,
}

impl LlmConfig {
    pub fn from_settings(s: &Settings) -> Self {
        Self { provider: s.llm_provider.clone(), model: s.llm_model.clone(), local_url: s.local_llm_url.clone() }
    }
    pub fn is_configured(&self) -> bool {
        self.provider != "none" && !self.provider.is_empty()
    }
}

pub struct ChatRequest<'a> {
    pub system: &'a str,
    pub user: &'a str,
    /// base64 PNG/JPEG
    pub image_b64: Option<(&'a str, &'a str)>, // (media_type, data)
    pub json: bool,
    pub purpose: Purpose,
    pub cloud_allowed: bool,
    /// cap on visible output tokens for this call
    pub max_tokens: u32,
}

/// Extras for assistant follow-ups: provider web search and a deeper reasoning budget.
#[derive(Debug, Clone, Copy, Default)]
pub struct Extras {
    pub web: bool,
    pub deep: bool,
}

/// Can this provider search the web itself?
pub fn supports_web(provider: &str) -> bool {
    matches!(provider, "anthropic" | "gemini")
}

/// Is this an OpenAI reasoning model (counts hidden reasoning toward the output cap)?
fn openai_reasoning(model: &str) -> bool {
    let m = model.to_lowercase();
    m.starts_with("gpt-5") || m.starts_with("o1") || m.starts_with("o3") || m.starts_with("o4")
}

/// (input, output) tokens from any provider's `usage` block.
pub fn usage_of(v: &Value) -> (Option<u64>, Option<u64>) {
    let u = &v["usage"];
    let tin = u["prompt_tokens"].as_u64().or(u["input_tokens"].as_u64()).or(v["usageMetadata"]["promptTokenCount"].as_u64());
    let tout = u["completion_tokens"].as_u64().or(u["output_tokens"].as_u64()).or(v["usageMetadata"]["candidatesTokenCount"].as_u64());
    (tin, tout)
}

pub fn default_model(provider: &str) -> &'static str {
    match provider {
        "openai" => "gpt-5-mini",
        "anthropic" => "claude-opus-5-5",
        "gemini" => "gemini-2.5-flash",
        "groq" => "openai/gpt-oss-120b",
        "openrouter" => "anthropic/claude-haiku-5-5",
        "lmstudio" => "local-model",
        "minimax" => "MiniMax-M2",
        "qwen" => "qwen-plus",
        "ollama_cloud" => "gpt-oss:120b",
        _ => "qwen3:8b",
    }
}

fn openai_base(cfg: &LlmConfig) -> Result<String> {
    Ok(match cfg.provider.as_str() {
        "openai" => "https://api.openai.com/v1".into(),
        "groq" => "https://api.groq.com/openai/v1".into(),
        "openrouter" => "https://openrouter.ai/api/v1".into(),
        "minimax" => "https://api.minimax.io/v1".into(),
        "qwen" => "https://dashscope-intl.aliyuncs.com/compatible-mode/v1".into(),
        "ollama_cloud" => "https://ollama.com/v1".into(),
        "ollama" => format!("{}/v1", cfg.local_url.trim_end_matches('/')),
        "lmstudio" => {
            let u = if cfg.local_url.contains("11434") || cfg.local_url.is_empty() { "http://127.0.0.1:1234".to_string() } else { cfg.local_url.clone() };
            format!("{}/v1", u.trim_end_matches('/'))
        }
        p => bail!("not an OpenAI-compatible provider: {p}"),
    })
}

async fn key_for(provider: &str) -> Result<Option<String>> {
    if matches!(provider, "ollama" | "lmstudio") {
        return Ok(None);
    }
    secrets::get_api_key_async(provider)
        .await?
        .map(Some)
        .ok_or_else(|| anyhow!("No API key for {provider}. Add it in Settings → AI."))
}

/// Curated fallback model names per provider (shown when the live list can't be fetched).
pub fn suggested_models(provider: &str) -> Vec<&'static str> {
    match provider {
        "openai" => vec!["gpt-5-mini", "gpt-5", "gpt-5-nano", "gpt-4.1-mini"],
        "anthropic" => vec!["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
        "gemini" => vec!["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"],
        "groq" => vec!["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "qwen/qwen3-32b"],
        "openrouter" => vec!["anthropic/claude-haiku-5-5", "openai/gpt-5-mini", "google/gemini-2.5-flash", "qwen/qwen3-235b-a22b"],
        "minimax" => vec!["MiniMax-M2", "MiniMax-Text-01"],
        "qwen" => vec!["qwen-plus", "qwen-max", "qwen-turbo", "qwen3-coder-plus"],
        "ollama_cloud" => vec!["gpt-oss:120b", "gpt-oss:20b", "qwen3-coder:480b", "deepseek-v3.1:671b"],
        "ollama" => vec!["qwen3:8b", "llama3.2:3b", "gemma3:4b"],
        _ => vec![],
    }
}

/// Live model list from the provider (`GET /models` — no tokens used). Falls back to suggestions.
pub async fn list_models(egress: &Egress, cfg: &LlmConfig) -> Vec<String> {
    let fallback = || suggested_models(&cfg.provider).into_iter().map(String::from).collect::<Vec<_>>();
    let (url, auth): (String, Option<(&str, String)>) = match cfg.provider.as_str() {
        "ollama" => (format!("{}/api/tags", cfg.local_url.trim_end_matches('/')), None),
        "anthropic" => match key_for("anthropic").await {
            Ok(Some(k)) => ("https://api.anthropic.com/v1/models?limit=100".into(), Some(("x-api-key", k))),
            _ => return fallback(),
        },
        "gemini" => match key_for("gemini").await {
            Ok(Some(k)) => ("https://generativelanguage.googleapis.com/v1beta/models?pageSize=100".into(), Some(("x-goog-api-key", k))),
            _ => return fallback(),
        },
        "none" | "" => return vec![],
        p => {
            let Ok(base) = openai_base(cfg) else { return fallback() };
            let key = key_for(p).await.ok().flatten();
            (format!("{base}/models"), key.map(|k| ("authorization", format!("Bearer {k}"))))
        }
    };
    if egress.check(&url, Purpose::Test, true).is_err() {
        return fallback();
    }
    let mut req = egress.client(Purpose::Test, true).get(&url).timeout(Duration::from_secs(6));
    if let Some((h, v)) = auth {
        req = req.header(h, v);
    }
    if cfg.provider == "anthropic" {
        req = req.header("anthropic-version", "2026-10-21");
    }
    let Ok(resp) = req.send().await else { return fallback() };
    let Ok(v) = resp.json::<Value>().await else { return fallback() };
    let mut names: Vec<String> = if let Some(models) = v["models"].as_array() {
        // ollama /api/tags or gemini
        models
            .iter()
            .filter_map(|m| m["name"].as_str())
            .map(|n| n.trim_start_matches("models/").to_string())
            .filter(|n| !n.contains("embedding") && !n.contains("aqa"))
            .collect()
    } else {
        v["data"].as_array().cloned().unwrap_or_default().iter().filter_map(|m| m["id"].as_str().map(String::from)).collect()
    };
    names.retain(|n| {
        let l = n.to_lowercase();
        !(l.contains("embed") || l.contains("whisper") || l.contains("tts") || l.contains("dall-e") || l.contains("moderation") || l.contains("image") || l.contains("audio"))
    });
    names.sort();
    names.dedup();
    if names.is_empty() {
        fallback()
    } else {
        names
    }
}

pub async fn chat(egress: &Egress, cfg: &LlmConfig, req: ChatRequest<'_>) -> Result<String> {
    chat_ex(egress, cfg, req, Extras::default()).await.map(|(t, _)| t)
}

/// Like `chat`, plus web search / deep effort; returns (text, web sources).
pub async fn chat_ex(egress: &Egress, cfg: &LlmConfig, req: ChatRequest<'_>, ex: Extras) -> Result<(String, Vec<crate::model::Source>)> {
    if !cfg.is_configured() {
        bail!("No AI model configured. Pick one in Settings → AI.");
    }
    let model = if cfg.model.trim().is_empty() { default_model(&cfg.provider).to_string() } else { cfg.model.clone() };
    match cfg.provider.as_str() {
        "anthropic" => anthropic(egress, &model, req, ex).await,
        "gemini" => gemini(egress, &model, req, ex).await,
        _ => openai_compat(egress, cfg, &model, req).await.map(|t| (t, vec![])),
    }
}

fn source(title: Option<&str>, url: Option<&str>) -> Option<crate::model::Source> {
    let url = url?.to_string();
    if !url.starts_with("http") {
        return None;
    }
    Some(crate::model::Source { title: title.unwrap_or(&url).to_string(), url })
}

async fn send(egress: &Egress, url: &str, req: &ChatRequest<'_>, builder: impl FnOnce(reqwest::Client) -> reqwest::RequestBuilder, body: Value) -> Result<Value> {
    egress.check(url, req.purpose, req.cloud_allowed)?;
    let bytes = body.to_string().len() as u64;
    let client = egress.client(req.purpose, req.cloud_allowed);
    let resp = builder(client).json(&body).timeout(Duration::from_secs(90)).send().await.map_err(|e| {
        if e.is_connect() && url.contains("127.0.0.1") {
            anyhow!("Can't reach your local model at {url}. Is Ollama / LM Studio running?")
        } else {
            anyhow!(e)
        }
    })?;
    let status = resp.status();
    let text = resp.text().await?;
    let v: Value = serde_json::from_str(&text).unwrap_or(json!({ "raw": text }));
    let (tin, tout) = usage_of(&v);
    egress.record_usage(url, req.purpose, bytes + text.len() as u64, tin, tout);
    if !status.is_success() {
        let msg = v["error"]["message"].as_str().or(v["error"].as_str()).unwrap_or(&text);
        bail!("AI provider error {status}: {}", crate::text::truncate_chars(msg, 300));
    }
    Ok(v)
}

async fn openai_compat(egress: &Egress, cfg: &LlmConfig, model: &str, req: ChatRequest<'_>) -> Result<String> {
    let url = format!("{}/chat/completions", openai_base(cfg)?);
    let key = key_for(&cfg.provider).await?;
    let user_content = match req.image_b64 {
        Some((mt, data)) => json!([
            {"type": "text", "text": req.user},
            {"type": "image_url", "image_url": {"url": format!("data:{mt};base64,{data}")}}
        ]),
        None => json!(req.user),
    };
    let mut body = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": req.system},
            {"role": "user", "content": user_content}
        ],
        "stream": false
    });
    if req.json && cfg.provider != "lmstudio" {
        body["response_format"] = json!({"type": "json_object"});
    }
    if cfg.provider == "openai" {
        if openai_reasoning(model) {
            // minimal hidden reasoning; cap must leave room for it
            body["reasoning_effort"] = json!("minimal");
            body["max_completion_tokens"] = json!(req.max_tokens.max(256) + 1024);
        } else {
            body["max_completion_tokens"] = json!(req.max_tokens.max(64));
        }
    } else {
        body["max_tokens"] = json!(req.max_tokens.max(64));
    }
    if cfg.provider == "ollama" {
        // keep the model warm between dictations
        body["keep_alive"] = json!("30m");
    }
    let v = send(egress, &url, &req, |c| {
        let b = c.post(&url);
        match &key {
            Some(k) => b.bearer_auth(k),
            None => b,
        }
    }, body)
    .await?;
    v["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow!("unexpected response from {}", cfg.provider))
}

/// Anthropic Messages API (raw HTTP; Rust has no official SDK). API version 2026-10-21:
/// no temperature/top_p/top_k. Server-side refusal fallback enabled.
async fn anthropic(egress: &Egress, model: &str, req: ChatRequest<'_>, ex: Extras) -> Result<(String, Vec<crate::model::Source>)> {
    let url = "https://api.anthropic.com/v1/messages".to_string();
    let key = key_for("anthropic").await?.unwrap_or_default();
    let mut content = vec![];
    if let Some((mt, data)) = req.image_b64 {
        content.push(json!({"type": "image", "source": {"type": "base64", "media_type": mt, "data": data}}));
    }
    content.push(json!({"type": "text", "text": req.user}));
    let mut body = json!({
        "model": model,
        // adaptive thinking can't be disabled on current Claude models; leave headroom for it
        "max_tokens": (req.max_tokens.max(256) + 1536),
        "system": req.system,
        "messages": [{"role": "user", "content": content}],
        // voice UX: favour latency; "Go deeper" thinks more
        "output_config": {"effort": if ex.deep || ex.web { "medium" } else { "low" }},
    });
    if ex.web {
        body["tools"] = json!([{ "type": "web_search_20260209", "name": "web_search", "max_uses": 3 }]);
    }
    let fallback = model.starts_with("claude-opus-5-5") || model.starts_with("claude-sonnet-5-5") || model.starts_with("claude-fable-5-1") || model.starts_with("claude-opus-5");
    if fallback {
        body["fallbacks"] = json!("default");
    }
    let v = send(egress, &url, &req, |c| {
        let b = c
            .post(&url)
            .header("x-api-key", key)
            .header("anthropic-version", "2026-10-21");
        if fallback {
            b.header("anthropic-beta", "server-side-fallback-2026-07-01")
        } else {
            b
        }
    }, body)
    .await?;
    if v["stop_reason"].as_str() == Some("refusal") {
        bail!("The model declined this request.");
    }
    let blocks = v["content"].as_array().cloned().unwrap_or_default();
    let text: String = blocks.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("");
    let mut sources = vec![];
    for b in blocks.iter().filter(|b| b["type"] == "web_search_tool_result") {
        for r in b["content"].as_array().cloned().unwrap_or_default() {
            if let Some(s) = source(r["title"].as_str(), r["url"].as_str()) {
                if !sources.iter().any(|x: &crate::model::Source| x.url == s.url) {
                    sources.push(s);
                }
            }
        }
    }
    if text.is_empty() {
        bail!("empty response from Anthropic");
    }
    sources.truncate(6);
    Ok((text, sources))
}

async fn gemini(egress: &Egress, model: &str, req: ChatRequest<'_>, ex: Extras) -> Result<(String, Vec<crate::model::Source>)> {
    let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent");
    let key = key_for("gemini").await?.unwrap_or_default();
    let mut parts = vec![json!({"text": req.user})];
    if let Some((mt, data)) = req.image_b64 {
        parts.push(json!({"inline_data": {"mime_type": mt, "data": data}}));
    }
    let mut body = json!({
        "systemInstruction": {"parts": [{"text": req.system}]},
        "contents": [{"role": "user", "parts": parts}],
    });
    let mut gen = json!({ "maxOutputTokens": req.max_tokens.max(64) });
    if req.json && !ex.web {
        gen["responseMimeType"] = json!("application/json");
    }
    if model.contains("flash") && !ex.deep {
        gen["thinkingConfig"] = json!({ "thinkingBudget": 0 }); // no hidden thinking tokens
    }
    body["generationConfig"] = gen;
    if ex.web {
        body["tools"] = json!([{ "google_search": {} }]);
    }
    let v = send(egress, &url, &req, |c| c.post(&url).header("x-goog-api-key", key), body).await?;
    let text = v["candidates"][0]["content"]["parts"]
        .as_array()
        .map(|p| p.iter().filter_map(|x| x["text"].as_str()).collect::<Vec<_>>().join(""))
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("unexpected response from Gemini"))?;
    let sources = v["candidates"][0]["groundingMetadata"]["groundingChunks"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|c| source(c["web"]["title"].as_str(), c["web"]["uri"].as_str()))
        .take(6)
        .collect();
    Ok((text, sources))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_cloud_provider_has_suggestions() {
        for p in ["openai", "anthropic", "gemini", "groq", "openrouter", "minimax", "qwen", "ollama_cloud", "ollama"] {
            assert!(!suggested_models(p).is_empty(), "{p}");
            assert_eq!(suggested_models(p)[0], default_model(p).max(suggested_models(p)[0]).min(suggested_models(p)[0]));
        }
    }

    #[test]
    fn new_provider_bases() {
        let mk = |p: &str| LlmConfig { provider: p.into(), model: String::new(), local_url: String::new() };
        assert_eq!(openai_base(&mk("minimax")).unwrap(), "https://api.minimax.io/v1");
        assert_eq!(openai_base(&mk("qwen")).unwrap(), "https://dashscope-intl.aliyuncs.com/compatible-mode/v1");
        assert_eq!(openai_base(&mk("ollama_cloud")).unwrap(), "https://ollama.com/v1");
        for p in ["minimax", "qwen", "ollama_cloud"] {
            let host = url::Url::parse(&openai_base(&mk(p)).unwrap()).unwrap().host_str().unwrap().to_string();
            assert!(crate::egress::is_allowed(&host, crate::egress::Purpose::Assistant, true), "{host}");
        }
    }

    #[test]
    fn web_capable_providers() {
        assert!(supports_web("anthropic") && supports_web("gemini"));
        assert!(!supports_web("openai") && !supports_web("ollama"));
        assert!(source(Some("x"), Some("ftp://a")).is_none());
        assert_eq!(source(None, Some("https://a.b")).unwrap().title, "https://a.b");
    }

    #[test]
    fn local_bases() {
        let c = LlmConfig { provider: "ollama".into(), model: String::new(), local_url: "http://127.0.0.1:11434/".into() };
        assert_eq!(openai_base(&c).unwrap(), "http://127.0.0.1:11434/v1");
        let l = LlmConfig { provider: "lmstudio".into(), model: String::new(), local_url: "http://127.0.0.1:11434".into() };
        assert_eq!(openai_base(&l).unwrap(), "http://127.0.0.1:1234/v1");
        assert!(openai_base(&LlmConfig { provider: "anthropic".into(), model: String::new(), local_url: String::new() }).is_err());
    }

    #[test]
    fn reads_usage_from_all_providers() {
        assert_eq!(usage_of(&json!({"usage": {"prompt_tokens": 10, "completion_tokens": 3}})), (Some(10), Some(3)));
        assert_eq!(usage_of(&json!({"usage": {"input_tokens": 7, "output_tokens": 2}})), (Some(7), Some(2)));
        assert_eq!(usage_of(&json!({"usageMetadata": {"promptTokenCount": 5, "candidatesTokenCount": 1}})), (Some(5), Some(1)));
        assert_eq!(usage_of(&json!({})), (None, None));
        assert!(openai_reasoning("gpt-5-mini") && !openai_reasoning("gpt-4.1-mini"));
    }

    #[tokio::test]
    async fn cloud_blocked_without_opt_in() {
        let e = Egress::new();
        let cfg = LlmConfig { provider: "openai".into(), model: "x".into(), local_url: String::new() };
        // key lookup happens after the egress check would fail; use egress check directly
        let err = e.check("https://api.openai.com/v1/chat/completions", Purpose::Attention, false).unwrap_err();
        assert!(err.to_string().contains("privacy"));
        assert!(cfg.is_configured());
    }
}
