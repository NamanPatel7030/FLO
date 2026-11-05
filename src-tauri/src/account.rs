//! Flo account (sign-in only — all user data stays on this Mac). See docs/03-accounts-contract.md.
//! The app talks to exactly one host: Settings.account_url (allow-listed for Purpose::Account).
use crate::egress::Purpose;
use crate::model::{ev, AccountUser};
use crate::state::Shared;
use crate::{secrets, settings};
use anyhow::{anyhow, bail, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;

const TOKEN: &str = "account-token";
static PENDING_STATE: parking_lot::Mutex<Option<String>> = parking_lot::Mutex::new(None);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    pub signed_in: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<AccountUser>,
    pub account_url: String,
    /// token cached but the account server couldn't be reached
    pub offline: bool,
}

pub fn base(st: &Shared) -> String {
    st.settings().account_url.trim_end_matches('/').to_string()
}

fn host_of(url: &str) -> Option<String> {
    url::Url::parse(url).ok()?.host_str().map(String::from)
}

/// Allow-list the configured account host (call on start and when the setting changes).
pub fn allow_host(st: &Shared) {
    if let Some(h) = host_of(&base(st)) {
        st.egress.allow_account_host(&h);
    }
}

async fn call(st: &Shared, method: &str, path: &str, body: Option<Value>, bearer: Option<&str>) -> Result<(u16, Value)> {
    let url = format!("{}{path}", base(st));
    st.egress.check(&url, Purpose::Account, true)?;
    let client = st.egress.client(Purpose::Account, true);
    let mut req = if method == "GET" { client.get(&url) } else { client.post(&url) };
    if let Some(b) = body {
        req = req.json(&b);
    }
    if let Some(t) = bearer {
        req = req.bearer_auth(t);
    }
    let resp = req.timeout(std::time::Duration::from_secs(8)).send().await.map_err(|e| {
        if e.is_connect() || e.is_timeout() {
            anyhow!("Can't reach your Flo account server. Check your internet connection.")
        } else {
            anyhow!(e)
        }
    })?;
    let code = resp.status().as_u16();
    let v: Value = resp.json().await.unwrap_or(json!({}));
    st.egress.record(&url, Purpose::Account, v.to_string().len() as u64);
    Ok((code, v))
}

fn parse_user(v: &Value) -> Option<AccountUser> {
    serde_json::from_value(v.clone()).ok()
}

fn remember(st: &Shared, token: &str, user: &AccountUser) -> Result<()> {
    secrets::set_secret(TOKEN, token)?;
    let mut s = st.settings();
    s.account_user = Some(user.clone());
    if s.user_name.trim().is_empty() {
        s.user_name = user.name.split_whitespace().next().unwrap_or("").to_string();
    }
    settings::save(&st.data_dir, &s)?;
    *st.settings.write() = s;
    st.signed_in.store(true, Ordering::SeqCst);
    st.emit(ev::ACCOUNT, json!({ "signedIn": true, "user": user }));
    Ok(())
}

/// Fast, no-network guess used at startup (token in keychain + cached user).
pub fn cached_signed_in(st: &Shared) -> bool {
    st.settings().account_user.is_some() && secrets::get_secret(TOKEN).is_some()
}

pub async fn status(st: &Shared) -> AccountStatus {
    let account_url = base(st);
    let cached = st.settings().account_user.clone();
    let Some(token) = secrets::get_secret(TOKEN) else {
        st.signed_in.store(false, Ordering::SeqCst);
        return AccountStatus { signed_in: false, user: None, account_url, offline: false };
    };
    match call(st, "GET", "/api/app/me", None, Some(&token)).await {
        Ok((200, v)) => {
            let user = parse_user(&v["user"]).or(cached);
            st.signed_in.store(user.is_some(), Ordering::SeqCst);
            AccountStatus { signed_in: user.is_some(), user, account_url, offline: false }
        }
        Ok((401, _)) => {
            let _ = logout(st);
            AccountStatus { signed_in: false, user: None, account_url, offline: false }
        }
        _ => {
            // server unreachable: keep working offline with the cached account
            let ok = cached.is_some();
            st.signed_in.store(ok, Ordering::SeqCst);
            AccountStatus { signed_in: ok, user: cached, account_url, offline: true }
        }
    }
}

pub async fn login(st: &Shared, email: &str, password: &str) -> Result<AccountUser> {
    let (code, v) = call(st, "POST", "/api/app/login", Some(json!({ "email": email.trim(), "password": password })), None).await?;
    if code != 200 {
        bail!("{}", v["error"].as_str().unwrap_or("Wrong email or password."));
    }
    let token = v["token"].as_str().ok_or_else(|| anyhow!("bad response from account server"))?;
    let user = parse_user(&v["user"]).ok_or_else(|| anyhow!("bad response from account server"))?;
    remember(st, token, &user)?;
    Ok(user)
}

/// Start "Continue with Google": open the website, which hands back a one-time code.
pub fn google_start(st: &Shared) -> Result<String> {
    let state = uuid::Uuid::new_v4().simple().to_string();
    *PENDING_STATE.lock() = Some(state.clone());
    tauri_plugin_opener::open_url(format!("{}/app/connect?state={state}", base(st)), None::<&str>)?;
    Ok(state)
}

pub async fn exchange(st: &Shared, code: &str, state: Option<&str>) -> Result<AccountUser> {
    if let (Some(got), Some(want)) = (state, PENDING_STATE.lock().clone()) {
        if got != want {
            bail!("This sign-in link is from another attempt. Start again from Flo.");
        }
    }
    let state = state.map(String::from).or_else(|| PENDING_STATE.lock().clone()).unwrap_or_default();
    let (c, v) = call(st, "POST", "/api/app/exchange", Some(json!({ "code": code.trim(), "state": state })), None).await?;
    if c != 200 {
        bail!("{}", v["error"].as_str().unwrap_or("That code expired. Try again."));
    }
    let token = v["token"].as_str().ok_or_else(|| anyhow!("bad response"))?;
    let user = parse_user(&v["user"]).ok_or_else(|| anyhow!("bad response"))?;
    *PENDING_STATE.lock() = None;
    remember(st, token, &user)?;
    Ok(user)
}

pub fn logout(st: &Shared) -> Result<()> {
    let _ = secrets::delete_secret(TOKEN);
    let mut s = st.settings();
    s.account_user = None;
    settings::save(&st.data_dir, &s)?;
    *st.settings.write() = s;
    st.signed_in.store(false, Ordering::SeqCst);
    st.emit(ev::ACCOUNT, json!({ "signedIn": false }));
    Ok(())
}

/// `flo://auth?code=…&state=…` → (code, state)
pub fn parse_deep_link(url: &str) -> Option<(String, Option<String>)> {
    let u = url::Url::parse(url).ok()?;
    if u.scheme() != "flo" || !(u.host_str() == Some("auth") || u.path().trim_matches('/') == "auth") {
        return None;
    }
    let code = u.query_pairs().find(|(k, _)| k == "code")?.1.to_string();
    let state = u.query_pairs().find(|(k, _)| k == "state").map(|(_, v)| v.to_string());
    (!code.is_empty()).then_some((code, state))
}

pub fn handle_deep_link(st: Shared, url: String) {
    let Some((code, state)) = parse_deep_link(&url) else { return };
    tauri::async_runtime::spawn(async move {
        match exchange(&st, &code, state.as_deref()).await {
            Ok(_) => crate::show_dashboard(&st.app, None),
            Err(e) => st.toast("error", format!("Sign-in: {e}")),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_flo_auth_links() {
        assert_eq!(parse_deep_link("flo://auth?code=abc&state=s1"), Some(("abc".into(), Some("s1".into()))));
        assert_eq!(parse_deep_link("flo://auth/?code=abc"), Some(("abc".into(), None)));
        assert!(parse_deep_link("flo://other?code=abc").is_none());
        assert!(parse_deep_link("https://auth?code=abc").is_none());
        assert!(parse_deep_link("flo://auth?code=").is_none());
    }
}
