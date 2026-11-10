//! Requests from the paired Android phone ("Ask Flo" and "Dictate").
//!
//! The phone transcribes speech on the device and queues the text on the user's own Flo account
//! server. While signed in, the Mac picks pending requests up (`GET /api/app/requests`), handles
//! them here and posts the answer back (`POST /api/app/requests/{id}`), which also lands in the
//! phone's inbox. Asks get a direct answer (`direct_answer`): the text itself, ready to be typed into
//! the phone's field, never a narration of what was done, and nothing ever acts on the computer's
//! screen. With the voice bubble, an Ask carries the visible phone screen (`context`) so "how should I
//! reply to her?" is answered from the conversation on the phone. All traffic is the account host
//! only, through the egress guard.
//! The same poll hands out phone actions (complete a to-do, Allow / Deny, change a setting), which
//! `phone_state.rs` applies.
use crate::phone_state::PhoneAction;
use crate::state::Shared;
use anyhow::Result;
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct PhoneRequest {
    pub id: u64,
    pub mode: String,
    pub text: String,
    /// What was on the phone's screen when the user held Ask in the bubble (visible text, never
    /// password fields; the phone composes it as "App: ...\nWindow: ...\n\n<screen text>"). Older
    /// servers and in-app asks send none.
    #[serde(default)]
    pub context: Option<String>,
}

/// What to do with one request, decided without touching the network (unit-tested).
#[derive(Debug, Clone, PartialEq)]
pub enum Plan {
    /// (request, phone screen)
    Ask(String, Option<String>),
    Todo(String),
    Note(String),
    Reject(&'static str),
}

pub fn plan(r: &PhoneRequest) -> Plan {
    let text = r.text.trim();
    if text.is_empty() {
        return Plan::Reject("There was nothing to do.");
    }
    let text: String = text.chars().take(2000).collect();
    match r.mode.as_str() {
        "ask" => {
            let screen = r.context.as_deref().map(str::trim).filter(|c| !c.is_empty()).map(|c| c.chars().take(6000).collect());
            Plan::Ask(text, screen)
        }
        "todo" => Plan::Todo(first_line(&text, 200)),
        "note" => Plan::Note(text),
        _ => Plan::Reject("Flo on your computer doesn't know that kind of request yet."),
    }
}

fn first_line(s: &str, max: usize) -> String {
    let line = s.lines().next().unwrap_or(s).trim();
    let line = line.trim_end_matches(['.', '!']);
    line.chars().take(max).collect()
}

/// The finished phone answer from the model's text: cleaned so only the deliverable is inserted.
pub fn finish_answer(raw: &str) -> Option<String> {
    let t = crate::text::strip_ai_dashes(&crate::prompts::clean_phone_answer(raw));
    let t = t.trim();
    (!t.is_empty()).then(|| t.chars().take(4000).collect())
}

/// Answer a phone Ask with one plain-text call (no JSON plan, no actions, no screenshot of the
/// computer): the phone gets exactly the text to insert. Root cause of "Message drafted, a happy Diwali
/// message": asks used to go through the computer assistant, whose JSON plan puts the draft in an
/// insert_text action and a narration in `reply`, and the phone got both joined together.
async fn direct_answer(st: &Shared, question: &str, screen: Option<&str>) -> Result<String> {
    use crate::llm::{ChatRequest, LlmConfig};
    let s = st.settings();
    let cfgl = LlmConfig::from_settings(&s);
    if !cfgl.is_configured() {
        anyhow::bail!("Pick an AI model in Flo's Settings → AI on your computer to ask questions.");
    }
    let front = crate::platform::FrontApp { name: "your phone".into(), pid: 0 };
    let mut system = crate::prompts::phone_answer_system(&crate::assistant::build_context(st, question, None, &front, None));
    if !s.system_prompt.trim().is_empty() {
        system.push_str(&format!("\n\nThe user's own instructions (follow them):\n{}", crate::text::truncate_chars(s.system_prompt.trim(), 2000)));
    }
    let user = crate::prompts::phone_answer_user(question, screen);
    let limit = crate::assistant::llm_timeout("quick");
    let req = ChatRequest {
        system: &system,
        user: &user,
        image_b64: None,
        json: false,
        purpose: crate::egress::Purpose::Assistant,
        cloud_allowed: s.assistant_cloud_allowed,
        max_tokens: 1000,
    };
    let raw = tokio::time::timeout(limit, crate::llm::chat(&st.egress, &cfgl, req))
        .await
        .map_err(|_| crate::assistant::too_slow(limit))?
        .map_err(|e| {
            if crate::settings::is_cloud_llm(&s.llm_provider) && !s.assistant_cloud_allowed {
                anyhow::anyhow!("Assistant is set to on-device only. Allow cloud AI in Settings → Privacy, or choose a local model.")
            } else {
                e
            }
        })?;
    finish_answer(&raw).ok_or_else(|| anyhow::anyhow!("The AI sent an empty answer. Try again."))
}

async fn handle(st: &Shared, r: &PhoneRequest) -> (bool, String) {
    match plan(r) {
        Plan::Reject(why) => (false, why.into()),
        Plan::Todo(title) => match st.db.add_todo(&title, "phone", None, None) {
            Ok(t) => {
                st.emit(crate::model::ev::TODOS, ());
                (true, format!("Added to your to-dos: {}", t.title))
            }
            Err(e) => (false, format!("Couldn't add the to-do: {e}")),
        },
        Plan::Note(text) => match save_note(st, &text) {
            Ok(()) => (true, "Saved to your notes.".into()),
            Err(e) => (false, format!("Couldn't save the note: {e}")),
        },
        Plan::Ask(q, screen) => match direct_answer(st, &q, screen.as_deref()).await {
            Ok(answer) => (true, answer),
            Err(e) => (false, format!("Flo couldn't answer: {e}")),
        },
    }
}

/// A dictated note from the phone, shown in Notes like a project note without a project.
fn save_note(st: &Shared, text: &str) -> Result<()> {
    let title: String = first_line(text, 60);
    let n = crate::model::Note {
        id: crate::db::new_id(),
        title: if title.is_empty() { "Note from your phone".into() } else { title },
        kind: "project".into(),
        project_id: None,
        transcript: vec![],
        summary: text.to_string(),
        action_items: vec![],
        duration_sec: 0.0,
        created_at: chrono::Local::now().to_rfc3339(),
        live: false,
    };
    st.db.upsert_note(&n)?;
    st.emit(crate::model::ev::NOTES, ());
    Ok(())
}

/// Pending requests and phone actions (to-dos, approvals, settings: phone_state.rs), in one poll.
async fn take(st: &Shared) -> Result<(Vec<PhoneRequest>, Vec<PhoneAction>)> {
    let v = crate::push::ok_or_err(crate::push::call(st, "GET", "/api/app/requests?actions=1", None).await?)?;
    Ok(parse_take(&v))
}

pub fn parse_take(v: &serde_json::Value) -> (Vec<PhoneRequest>, Vec<PhoneAction>) {
    let requests = serde_json::from_value(v["requests"].clone()).unwrap_or_default();
    // one malformed action must not drop the others
    let actions = v["actions"].as_array().map(|a| a.iter().filter_map(|x| serde_json::from_value(x.clone()).ok()).collect()).unwrap_or_default();
    (requests, actions)
}

async fn finish_action(st: &Shared, id: u64, ok: bool, message: &str) -> Result<()> {
    crate::push::ok_or_err(crate::push::call(st, "POST", &format!("/api/app/actions/{id}"), Some(json!({ "ok": ok, "message": message }))).await?)?;
    Ok(())
}

/// Poll faster while a Claude Code question waits (it times out after two minutes).
pub fn poll_every(questions_waiting: bool) -> Duration {
    Duration::from_secs(if questions_waiting { 3 } else { 10 })
}

async fn finish(st: &Shared, id: u64, ok: bool, answer: &str) -> Result<()> {
    crate::push::ok_or_err(crate::push::call(st, "POST", &format!("/api/app/requests/{id}"), Some(json!({ "ok": ok, "answer": answer }))).await?)?;
    Ok(())
}

/// Poll every 10 s while signed in (back off to a minute after errors). Cheap: one small GET.
pub fn spawn(st: Shared) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(8)).await;
        let mut wait = Duration::from_secs(10);
        let mut last_err: Option<String> = None;
        loop {
            if crate::push::has_session(&st) && crate::account::enforced(&st) {
                match take(&st).await {
                    Ok((list, actions)) => {
                        if last_err.take().is_some() {
                            log::info!("phone requests: reconnected");
                        }
                        for a in actions {
                            log::info!("phone action {} ({})", a.id, a.kind);
                            let (ok, message) = crate::phone_state::apply(&st, &a);
                            if let Err(e) = finish_action(&st, a.id, ok, &message).await {
                                log::warn!("phone action {}: couldn't report back: {e}", a.id);
                            }
                            crate::phone_state::poke();
                        }
                        wait = poll_every(!crate::claude::pending_permissions().is_empty());
                        for r in list {
                            log::info!("phone request {} ({})", r.id, r.mode);
                            let (ok, answer) = handle(&st, &r).await;
                            if let Err(e) = finish(&st, r.id, ok, &answer).await {
                                log::warn!("phone request {}: couldn't send the answer: {e}", r.id);
                            }
                        }
                    }
                    Err(e) => {
                        // once per distinct error, so a broken phone link shows up in the log
                        let msg = e.to_string();
                        if last_err.as_deref() != Some(msg.as_str()) {
                            log::warn!("phone requests: {msg}");
                            last_err = Some(msg);
                        }
                        wait = Duration::from_secs(20);
                    }
                }
            }
            tokio::time::sleep(wait).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(mode: &str, text: &str) -> PhoneRequest {
        PhoneRequest { id: 1, mode: mode.into(), text: text.into(), context: None }
    }

    #[test]
    fn plans_each_mode() {
        assert_eq!(plan(&req("ask", " what's on today? ")), Plan::Ask("what's on today?".into(), None));
        assert_eq!(plan(&req("todo", "Call the bank.\nabout the card")), Plan::Todo("Call the bank".into()));
        assert_eq!(plan(&req("note", "idea: notch widgets")), Plan::Note("idea: notch widgets".into()));
        assert!(matches!(plan(&req("ask", "   ")), Plan::Reject(_)));
        assert!(matches!(plan(&req("delete", "everything")), Plan::Reject(_)));
    }

    #[test]
    fn caps_long_text() {
        let long = "a".repeat(5000);
        match plan(&req("ask", &long)) {
            Plan::Ask(t, _) => assert_eq!(t.chars().count(), 2000),
            p => panic!("{p:?}"),
        }
    }

    #[test]
    fn ask_carries_the_phone_screen_only_for_asks() {
        let mut r = req("ask", "how should I reply?");
        r.context = Some("  App: WhatsApp\nPriya: coming tonight?  ".into());
        assert_eq!(plan(&r), Plan::Ask("how should I reply?".into(), Some("App: WhatsApp\nPriya: coming tonight?".into())));
        r.context = Some("   ".into());
        assert_eq!(plan(&r), Plan::Ask("how should I reply?".into(), None));
        // capped, like the server
        r.context = Some("x".repeat(9000));
        match plan(&r) {
            Plan::Ask(_, Some(c)) => assert_eq!(c.chars().count(), 6000),
            p => panic!("{p:?}"),
        }
    }

    #[test]
    fn requests_parse_with_and_without_screen_context() {
        let v = json!({"requests": [
            {"id": 3, "mode": "ask", "text": "x", "status": "taken"},
            {"id": 4, "mode": "ask", "text": "y", "status": "taken", "context": "App: Gmail\nHi"},
            {"id": 5, "mode": "ask", "text": "z", "status": "taken", "context": null}
        ]});
        let (r, _) = parse_take(&v);
        assert_eq!(r.iter().map(|x| x.context.clone()).collect::<Vec<_>>(), [None, Some("App: Gmail\nHi".into()), None]);
    }

    #[test]
    fn phone_answers_are_the_deliverable() {
        // the model's text is cleaned and stripped of AI dashes; never "Message drafted" + the text
        assert_eq!(finish_answer("Here's a draft:\n\nHappy Diwali \u{2014} lots of love!"), Some("Happy Diwali, lots of love!".into()));
        assert_eq!(finish_answer("  "), None);
    }

    #[test]
    fn one_poll_returns_requests_and_actions() {
        let v = json!({
            "requests": [{"id": 3, "mode": "todo", "text": "x", "status": "taken"}],
            "actions": [{"id": 7, "kind": "approve", "target": "q1", "value": null}, {"id": "bad"}, {"id": 8, "kind": "setting", "target": "theme", "value": "dark"}]
        });
        let (r, a) = parse_take(&v);
        assert_eq!(r.len(), 1);
        assert_eq!(a.iter().map(|x| x.id).collect::<Vec<_>>(), [7, 8]);
        assert_eq!(a[1].value, json!("dark"));
        // an older server without actions
        let (_, none) = parse_take(&json!({"requests": []}));
        assert!(none.is_empty());
    }

    #[test]
    fn polls_faster_while_a_question_waits() {
        assert!(poll_every(true) < poll_every(false));
        assert_eq!(poll_every(false), Duration::from_secs(10));
    }

    #[test]
    fn phone_requests_never_act_on_the_screen() {
        use crate::model::AssistantAction;
        assert!(crate::assistant::screen_action(&AssistantAction::InsertText { text: "hi".into() }));
        assert!(crate::assistant::screen_action(&AssistantAction::OpenApp { name: "Slack".into() }));
        assert!(crate::assistant::screen_action(&AssistantAction::Automate { goal: "x".into() }));
        assert!(!crate::assistant::screen_action(&AssistantAction::StopMeeting));
    }
}
