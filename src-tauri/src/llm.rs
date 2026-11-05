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
        _ => "qwen3:8b",
    }
}

fn openai_base(cfg: &LlmConfig) -> Result<String> {
    Ok(match cfg.provider.as_str() {
        "openai" => "https://api.openai.com/v1".into(),
        "groq" => "https://api.groq.com/openai/v1".into(),
        "openrouter" => "https://openrouter.ai/api/v1".into(),
        "ollama" => format!("{}/v1", cfg.local_url.trim_end_matches('/')),
        "lmstudio" => {
            let u = if cfg.local_url.contains("11434") || cfg.local_url.is_empty() { "http://127.0.0.1:1234".to_string() } else { cfg.local_url.clone() };
            format!("{}/v1", u.trim_end_matches('/'))
        }
        p => bail!("not an OpenAI-compatible provider: {p}"),
    })
}

fn key_for(provider: &str) -> Result<Option<String>> {
    if matches!(provider, "ollama" | "lmstudio") {
        return Ok(None);
    }
    secrets::get_api_key(provider)
        .map(Some)
        .ok_or_else(|| anyhow!("No API key for {provider}. Add it in Settings → AI."))
}

pub async fn chat(egress: &Egress, cfg: &LlmConfig, req: ChatRequest<'_>) -> Result<String> {
    if !cfg.is_configured() {
        bail!("No AI model configured. Pick one in Settings → AI.");
    }
    let model = if cfg.model.trim().is_empty() { default_model(&cfg.provider).to_string() } else { cfg.model.clone() };
    match cfg.provider.as_str() {
        "anthropic" => anthropic(egress, &model, req).await,
        "gemini" => gemini(egress, &model, req).await,
        _ => openai_compat(egress, cfg, &model, req).await,
    }
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
    let key = key_for(&cfg.provider)?;
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
async fn anthropic(egress: &Egress, model: &str, req: ChatRequest<'_>) -> Result<String> {
    let url = "https://api.anthropic.com/v1/messages".to_string();
    let key = key_for("anthropic")?.unwrap_or_default();
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
        // voice UX: favour latency
        "output_config": {"effort": "low"},
    });
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
    let text: String = v["content"]
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter(|b| b["type"] == "text")
                .filter_map(|b| b["text"].as_str())
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    if text.is_empty() {
        bail!("empty response from Anthropic");
    }
    Ok(text)
}

async fn gemini(egress: &Egress, model: &str, req: ChatRequest<'_>) -> Result<String> {
    let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent");
    let key = key_for("gemini")?.unwrap_or_default();
    let mut parts = vec![json!({"text": req.user})];
    if let Some((mt, data)) = req.image_b64 {
        parts.push(json!({"inline_data": {"mime_type": mt, "data": data}}));
    }
    let mut body = json!({
        "systemInstruction": {"parts": [{"text": req.system}]},
        "contents": [{"role": "user", "parts": parts}],
    });
    let mut gen = json!({ "maxOutputTokens": req.max_tokens.max(64) });
    if req.json {
        gen["responseMimeType"] = json!("application/json");
    }
    if model.contains("flash") {
        gen["thinkingConfig"] = json!({ "thinkingBudget": 0 }); // no hidden thinking tokens
    }
    body["generationConfig"] = gen;
    let v = send(egress, &url, &req, |c| c.post(&url).header("x-goog-api-key", key), body).await?;
    v["candidates"][0]["content"]["parts"]
        .as_array()
        .map(|p| p.iter().filter_map(|x| x["text"].as_str()).collect::<Vec<_>>().join(""))
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("unexpected response from Gemini"))
}

#[cfg(test)]
mod tests {
    use super::*;

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
