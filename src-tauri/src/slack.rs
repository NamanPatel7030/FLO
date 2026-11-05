//! Slack (BYOK user token, direct to slack.com — no middle server).
//!  - to-dos: unanswered DMs + @mentions every 3 min → "Reply to Rahul on Slack" (no AI tokens)
//!  - send by voice: assistant proposes, the user confirms in the notch, then chat.postMessage
//! Scopes for the user token: channels:history groups:history im:history mpim:history
//!   im:read users:read search:read chat:write
use crate::egress::Purpose;
use crate::model::*;
use crate::state::Shared;
use crate::{db, secrets, text};
use anyhow::{anyhow, bail, Result};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

const API: &str = "https://slack.com/api";

#[derive(Default)]
struct Cache {
    me: Option<String>,
    team_url: Option<String>,
    names: HashMap<String, String>,
    seen: HashSet<String>,
}
static CACHE: Mutex<Option<Cache>> = Mutex::new(None);

/// Proposed sends awaiting the user's confirmation: id → (channel/user id, display name, text)
static PENDING: Mutex<Option<HashMap<String, (String, String, String)>>> = Mutex::new(None);

async fn call(st: &Shared, method: &str, params: &[(&str, String)], post: bool) -> Result<Value> {
    let token = secrets::get_api_key_async("slack").await?.ok_or_else(|| anyhow!("Slack isn't connected. Add your token in Settings → Integrations."))?;
    let url = format!("{API}/{method}");
    st.egress.check(&url, Purpose::Slack, true)?;
    let client = st.egress.client(Purpose::Slack, true);
    let req = if post {
        client.post(&url).bearer_auth(&token).json(&params.iter().map(|(k, v)| (k.to_string(), json!(v))).collect::<serde_json::Map<_, _>>())
    } else {
        client.get(&url).bearer_auth(&token).query(params)
    };
    let resp = req.timeout(std::time::Duration::from_secs(20)).send().await?;
    let v: Value = resp.json().await?;
    st.egress.record(&url, Purpose::Slack, v.to_string().len() as u64);
    if v["ok"].as_bool() != Some(true) {
        bail!("Slack: {}", v["error"].as_str().unwrap_or("request failed"));
    }
    Ok(v)
}

/// Check the token; returns "Name · workspace".
pub async fn test(st: &Shared) -> Result<String> {
    let v = call(st, "auth.test", &[], false).await?;
    let mut g = CACHE.lock();
    let c = g.get_or_insert_with(Default::default);
    c.me = v["user_id"].as_str().map(String::from);
    c.team_url = v["url"].as_str().map(String::from);
    Ok(format!("{} · {}", v["user"].as_str().unwrap_or("you"), v["team"].as_str().unwrap_or("Slack")))
}

async fn me(st: &Shared) -> Result<String> {
    if let Some(m) = CACHE.lock().as_ref().and_then(|c| c.me.clone()) {
        return Ok(m);
    }
    test(st).await?;
    CACHE.lock().as_ref().and_then(|c| c.me.clone()).ok_or_else(|| anyhow!("Slack auth failed"))
}

async fn name_of(st: &Shared, user: &str) -> String {
    if let Some(n) = CACHE.lock().as_ref().and_then(|c| c.names.get(user).cloned()) {
        return n;
    }
    let n = match call(st, "users.info", &[("user", user.to_string())], false).await {
        Ok(v) => v["user"]["profile"]["display_name"]
            .as_str()
            .filter(|s| !s.is_empty())
            .or(v["user"]["real_name"].as_str())
            .unwrap_or(user)
            .to_string(),
        Err(_) => user.to_string(),
    };
    CACHE.lock().get_or_insert_with(Default::default).names.insert(user.to_string(), n.clone());
    n
}

/// Is a message something the user still owes a reply to?
pub fn needs_reply(msg: &Value, me: &str) -> bool {
    let user = msg["user"].as_str().unwrap_or("");
    !user.is_empty() && user != me && msg["bot_id"].is_null() && msg["subtype"].is_null()
}

/// One sync pass: unanswered DMs + recent mentions → to-dos. Returns how many were added.
pub async fn sync(st: &Shared) -> Result<usize> {
    let me = me(st).await?;
    let mut existing = st.db.open_todo_titles()?;
    let mut added = 0;
    let add = |title: String, reason: String, person: String, key: String, existing: &mut Vec<String>| -> Result<bool> {
        {
            let mut g = CACHE.lock();
            let c = g.get_or_insert_with(Default::default);
            if !c.seen.insert(key) {
                return Ok(false);
            }
        }
        if text::is_duplicate_todo(&title, existing) {
            return Ok(false);
        }
        st.db.insert_todo(&Todo {
            id: db::new_id(),
            title: title.clone(),
            reason: Some(text::truncate_chars(&reason, 200)),
            person: Some(person),
            app: Some("Slack".into()),
            source: "attention".into(),
            status: "open".into(),
            created_at: chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, false),
            ..Default::default()
        })?;
        existing.push(title);
        Ok(true)
    };

    // DMs whose latest message is from someone else
    let ims = call(st, "users.conversations", &[("types", "im".into()), ("exclude_archived", "true".into()), ("limit", "40".into())], false).await?;
    for ch in ims["channels"].as_array().cloned().unwrap_or_default().into_iter().take(25) {
        let Some(id) = ch["id"].as_str() else { continue };
        let Ok(h) = call(st, "conversations.history", &[("channel", id.to_string()), ("limit", "1".into())], false).await else { continue };
        let Some(m) = h["messages"].as_array().and_then(|a| a.first()).cloned() else { continue };
        if !needs_reply(&m, &me) {
            continue;
        }
        let who = name_of(st, m["user"].as_str().unwrap_or("")).await;
        let key = format!("{id}:{}", m["ts"].as_str().unwrap_or(""));
        if add(format!("Reply to {who} on Slack"), m["text"].as_str().unwrap_or("").to_string(), who, key, &mut existing)? {
            added += 1;
        }
    }

    // recent @mentions (needs search:read)
    if let Ok(s) = call(st, "search.messages", &[("query", format!("<@{me}>")), ("count", "10".into()), ("sort", "timestamp".into())], false).await {
        for m in s["messages"]["matches"].as_array().cloned().unwrap_or_default() {
            if !needs_reply(&m, &me) {
                continue;
            }
            let who = m["username"].as_str().map(String::from).unwrap_or_else(|| "someone".into());
            let chan = m["channel"]["name"].as_str().unwrap_or("Slack");
            let key = format!("{}:{}", m["channel"]["id"].as_str().unwrap_or(""), m["ts"].as_str().unwrap_or(""));
            if add(format!("Reply to {who} in #{chan}"), m["text"].as_str().unwrap_or("").to_string(), who, key, &mut existing)? {
                added += 1;
            }
        }
    }
    if added > 0 {
        st.emit(ev::TODOS, ());
        st.toast("info", format!("{added} Slack message(s) waiting on you"));
    }
    Ok(added)
}

pub fn spawn(st: Shared) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(180)).await;
            if !st.settings().slack_sync || secrets::get_api_key("slack").is_none() {
                continue;
            }
            if let Err(e) = sync(&st).await {
                log::warn!("slack sync: {e}");
            }
        }
    });
}

/// Find a DM target or channel by spoken name ("Rahul", "#design").
async fn resolve(st: &Shared, to: &str) -> Result<(String, String)> {
    let to = to.trim().trim_start_matches('@');
    if let Some(ch) = to.strip_prefix('#') {
        let v = call(st, "users.conversations", &[("types", "public_channel,private_channel".into()), ("limit", "200".into())], false).await?;
        let cands: Vec<(String, String)> = v["channels"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|c| Some((c["id"].as_str()?.to_string(), c["name"].as_str()?.to_string())))
            .collect();
        let (id, name) = text::best_match(ch, &cands).ok_or_else(|| anyhow!("No channel like #{ch}"))?.clone();
        return Ok((id, format!("#{name}")));
    }
    let v = call(st, "users.list", &[("limit", "400".into())], false).await?;
    let cands: Vec<(String, String)> = v["members"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter(|m| !m["deleted"].as_bool().unwrap_or(false) && !m["is_bot"].as_bool().unwrap_or(false))
        .filter_map(|m| {
            let name = m["profile"]["display_name"].as_str().filter(|s| !s.is_empty()).or(m["real_name"].as_str())?;
            Some((m["id"].as_str()?.to_string(), name.to_string()))
        })
        .collect();
    let (uid, name) = text::best_match(to, &cands).ok_or_else(|| anyhow!("No Slack teammate like “{to}”"))?.clone();
    Ok((uid, name))
}

/// Stage a message; the notch asks the user to confirm before anything is sent.
pub async fn propose_send(st: &Shared, to: &str, msg: &str) -> Result<String> {
    let (target, name) = resolve(st, to).await?;
    let id = db::new_id();
    PENDING.lock().get_or_insert_with(Default::default).insert(id.clone(), (target, name.clone(), msg.to_string()));
    st.emit(
        "flo://confirm",
        json!({ "id": id, "kind": "slack", "title": format!("Send to {name} on Slack?"), "body": msg }),
    );
    Ok(format!("Waiting for you to confirm the Slack message to {name}"))
}

/// User clicked Send (approve=true) or Cancel.
pub async fn confirm(st: &Shared, id: &str, approve: bool) -> Result<String> {
    let Some((target, name, msg)) = PENDING.lock().as_mut().and_then(|m| m.remove(id)) else {
        bail!("That message expired")
    };
    if !approve {
        return Ok("Cancelled".into());
    }
    let channel = if target.starts_with('U') || target.starts_with('W') {
        let v = call(st, "conversations.open", &[("users", target.clone())], true).await?;
        v["channel"]["id"].as_str().ok_or_else(|| anyhow!("couldn't open DM"))?.to_string()
    } else {
        target
    };
    call(st, "chat.postMessage", &[("channel", channel), ("text", msg)], true).await?;
    Ok(format!("Sent to {name}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reply_needed_only_for_humans_other_than_me() {
        assert!(needs_reply(&json!({"user":"U2","text":"can you review?"}), "U1"));
        assert!(!needs_reply(&json!({"user":"U1","text":"done"}), "U1"));
        assert!(!needs_reply(&json!({"user":"U2","bot_id":"B1"}), "U1"));
        assert!(!needs_reply(&json!({"user":"U2","subtype":"channel_join"}), "U1"));
    }
}
