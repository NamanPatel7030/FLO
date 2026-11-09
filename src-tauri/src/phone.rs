//! Requests from the paired Android phone ("Ask Flo" and "Dictate").
//!
//! The phone transcribes speech on the device and queues the text on the user's own Flo account
//! server. While signed in, the Mac picks pending requests up (`GET /api/app/requests`), handles
//! them here and posts the answer back (`POST /api/app/requests/{id}`), which also lands in the
//! phone's inbox. Asks run through the normal assistant, but nothing may act on the Mac's screen
//! (see `assistant::run_for_phone`). All traffic is the account host only, through the egress guard.
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
}

/// What to do with one request, decided without touching the network (unit-tested).
#[derive(Debug, Clone, PartialEq)]
pub enum Plan {
    Ask(String),
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
        "ask" => Plan::Ask(text),
        "todo" => Plan::Todo(first_line(&text, 200)),
        "note" => Plan::Note(text),
        _ => Plan::Reject("Flo on your Mac doesn't know that kind of request yet."),
    }
}

fn first_line(s: &str, max: usize) -> String {
    let line = s.lines().next().unwrap_or(s).trim();
    let line = line.trim_end_matches(['.', '!']);
    line.chars().take(max).collect()
}

/// The answer text the phone shows: the assistant's reply plus what it actually did.
pub fn answer_text(reply: &str, results: &[String]) -> String {
    let mut out = reply.trim().to_string();
    for r in results {
        let r = r.trim();
        if !r.is_empty() && !out.contains(r) {
            if !out.is_empty() {
                out.push_str("\n\n");
            }
            out.push_str(r);
        }
    }
    if out.is_empty() {
        "Done.".into()
    } else {
        out.chars().take(4000).collect()
    }
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
        Plan::Ask(q) => match crate::assistant::run_for_phone(st, &q).await {
            Ok(resp) => (true, answer_text(&resp.reply, &resp.results)),
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

async fn take(st: &Shared) -> Result<Vec<PhoneRequest>> {
    let v = crate::push::ok_or_err(crate::push::call(st, "GET", "/api/app/requests", None).await?)?;
    Ok(serde_json::from_value(v["requests"].clone()).unwrap_or_default())
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
        loop {
            if crate::push::has_session(&st) && crate::account::enforced(&st) {
                match take(&st).await {
                    Ok(list) => {
                        wait = Duration::from_secs(10);
                        for r in list {
                            log::info!("phone request {} ({})", r.id, r.mode);
                            let (ok, answer) = handle(&st, &r).await;
                            if let Err(e) = finish(&st, r.id, ok, &answer).await {
                                log::warn!("phone request {}: couldn't send the answer: {e}", r.id);
                            }
                        }
                    }
                    Err(e) => {
                        log::debug!("phone requests: {e}");
                        wait = Duration::from_secs(60);
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
        PhoneRequest { id: 1, mode: mode.into(), text: text.into() }
    }

    #[test]
    fn plans_each_mode() {
        assert_eq!(plan(&req("ask", " what's on today? ")), Plan::Ask("what's on today?".into()));
        assert_eq!(plan(&req("todo", "Call the bank.\nabout the card")), Plan::Todo("Call the bank".into()));
        assert_eq!(plan(&req("note", "idea: notch widgets")), Plan::Note("idea: notch widgets".into()));
        assert!(matches!(plan(&req("ask", "   ")), Plan::Reject(_)));
        assert!(matches!(plan(&req("delete", "everything")), Plan::Reject(_)));
    }

    #[test]
    fn caps_long_text() {
        let long = "a".repeat(5000);
        match plan(&req("ask", &long)) {
            Plan::Ask(t) => assert_eq!(t.chars().count(), 2000),
            p => panic!("{p:?}"),
        }
    }

    #[test]
    fn answer_joins_reply_and_results() {
        assert_eq!(answer_text("Sure.", &["Added to-do: Call Priya".into()]), "Sure.\n\nAdded to-do: Call Priya");
        assert_eq!(answer_text("Added to-do: X", &["Added to-do: X".into()]), "Added to-do: X");
        assert_eq!(answer_text("", &[]), "Done.");
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
