//! Scheduled skills: every 30 s, run each enabled skill whose cron schedule has a slot that's due.
//! Each slot runs once (tracked in `last_run`); slots missed by more than a few minutes (the Mac
//! was asleep, Flo was closed) are skipped instead of all firing at once on wake.
//! A scheduled run is headless: MCP skills use the tool loop, "do" skills hand off to screen
//! control, and the rest ask the AI with the skill's instructions. With nobody at the keyboard
//! there's no field to type into, so the result is saved as a note, logged in History, shown on
//! the notch and sent as a notification.
use crate::cron::Cron;
use crate::egress::Purpose;
use crate::llm::{self, ChatRequest, LlmConfig};
use crate::model::{ev, AssistantAction, AssistantResponse, Note, Skill};
use crate::platform::FrontApp;
use crate::state::Shared;
use crate::{assistant, db, prompts, text};
use anyhow::{anyhow, Result};
use chrono::{DateTime, Duration, Local, TimeZone, Timelike};
use std::collections::HashSet;

/// How late a slot may still run (covers the 30 s tick and short stalls, not a night's sleep).
pub const GRACE_MINUTES: i64 = 5;

static RUNNING: parking_lot::Mutex<Option<HashSet<String>>> = parking_lot::Mutex::new(None);

/// The most recent slot of `cron` in the last few minutes that hasn't run yet, if any.
pub fn due_slot<Tz: TimeZone>(cron: &Cron, last_run: Option<&str>, now: &DateTime<Tz>) -> Option<DateTime<Tz>> {
    let last = last_run.and_then(|l| DateTime::parse_from_rfc3339(l).ok()).map(|l| l.timestamp());
    let floor = now.clone() - Duration::seconds(now.second() as i64) - Duration::nanoseconds(now.nanosecond() as i64);
    (0..=GRACE_MINUTES)
        .map(|m| floor.clone() - Duration::minutes(m))
        .find(|t| cron.matches(&t.naive_local()) && last.map_or(true, |l| l < t.timestamp()))
}

pub fn spawn(st: Shared) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            let skills = match st.db.list_skills() {
                Ok(s) => s,
                Err(e) => {
                    log::warn!("scheduler: {e}");
                    continue;
                }
            };
            let now = Local::now();
            for k in skills.into_iter().filter(|k| k.enabled) {
                let Some(expr) = k.schedule.as_deref() else { continue };
                let Ok(cron) = Cron::parse(expr) else { continue };
                let Some(slot) = due_slot(&cron, k.last_run.as_deref(), &now) else { continue };
                // mark the slot first so a slow run never fires twice
                let _ = st.db.set_skill_last_run(&k.id, &slot.to_rfc3339());
                log::info!("scheduler: running {} for {}", k.name, slot.format("%H:%M"));
                let st2 = st.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = run_and_deliver(&st2, &k).await;
                });
            }
        }
    });
}

/// Run a skill now, unattended, and deliver the result (note + History + notch + notification).
pub async fn run_and_deliver(st: &Shared, k: &Skill) -> Result<AssistantResponse> {
    {
        let mut r = RUNNING.lock();
        let set = r.get_or_insert_with(HashSet::new);
        if !set.insert(k.id.clone()) {
            return Err(anyhow!("{} is already running.", k.name));
        }
    }
    let out = run_headless(st, k).await;
    RUNNING.lock().get_or_insert_with(HashSet::new).remove(&k.id);
    let notify_on = st.settings().system_notifications;
    match out {
        Ok(mut resp) => {
            let _ = st.db.bump_skill_use(&k.id);
            crate::assistant::log_exchange(st, &mut resp, "skill");
            if !resp.reply.trim().is_empty() && k.mode != "do" {
                let n = Note {
                    id: db::new_id(),
                    title: format!("{} · {}", k.name, Local::now().format("%a %-d %b, %H:%M")),
                    kind: "voice".into(),
                    project_id: None,
                    transcript: vec![],
                    summary: resp.reply.clone(),
                    action_items: vec![],
                    duration_sec: 0.0,
                    created_at: Local::now().to_rfc3339(),
                    live: false,
                };
                if st.db.upsert_note(&n).is_ok() {
                    st.emit(ev::NOTES, ());
                }
            }
            st.emit(ev::ASSISTANT, resp.clone());
            st.toast("success", format!("{} ran", k.name));
            crate::push::notify(st, crate::push::skill_payload(&k.name, &resp.reply, true)); // phone, only while Away
            if notify_on {
                crate::reminders::notify(&format!("{} ran", k.name), &text::truncate_chars(resp.reply.trim(), 180));
            }
            Ok(resp)
        }
        Err(e) => {
            log::warn!("scheduled skill {}: {e:#}", k.name);
            st.toast("error", format!("{} couldn't run: {e}", k.name));
            crate::push::notify(st, crate::push::skill_payload(&k.name, &e.to_string(), false)); // phone, only while Away
            if notify_on {
                crate::reminders::notify(&format!("{} couldn't run", k.name), &e.to_string());
            }
            Err(e)
        }
    }
}

async fn run_headless(st: &Shared, k: &Skill) -> Result<AssistantResponse> {
    let s = st.settings();
    let cfgl = LlmConfig::from_settings(&s);
    let query = format!("Run my “{}” skill", k.name);
    let servers: Vec<crate::model::Connection> =
        st.db.list_connections().unwrap_or_default().into_iter().filter(|c| c.kind == "mcp" && c.enabled && k.connections.contains(&c.id)).collect();
    let front = FrontApp::default();
    let mut actions = vec![];
    let mut results = vec![];
    let reply = if k.mode == "do" && servers.is_empty() {
        // operate the screen: hand the steps to the computer-control agent (it asks before sending)
        let action = AssistantAction::Automate { goal: format!("Run my \"{}\" skill:\n{}", k.name, k.instructions) };
        results.push(assistant::execute(st, &action, &front, false).await?);
        actions.push(action);
        format!("Running your {} skill on screen.", k.name)
    } else {
        if !cfgl.is_configured() {
            return Err(anyhow!("Pick an AI model in Settings → AI to run scheduled skills."));
        }
        let context = assistant::build_context(st, &k.instructions, None, &front, None);
        let system = prompts::scheduled_skill_system(&context, &k.name, &k.instructions, &k.mode, !servers.is_empty(), &assistant::skill_docs(st, k));
        let out = if servers.is_empty() {
            llm::chat(&st.egress, &cfgl, ChatRequest { system: &system, user: &query, image_b64: None, json: false, purpose: Purpose::Assistant, cloud_allowed: s.assistant_cloud_allowed, max_tokens: 1500 }).await
        } else {
            crate::mcp::run_with_tools(st, &cfgl, &system, &query, None, &servers, s.assistant_cloud_allowed).await.map(|(t, used)| {
                if !used.is_empty() {
                    results.push(format!("Used {} tool call{}: {}", used.len(), if used.len() == 1 { "" } else { "s" }, used.join(", ")));
                }
                t
            })
        }
        .map_err(|e| {
            if crate::settings::is_cloud_llm(&s.llm_provider) && !s.assistant_cloud_allowed {
                anyhow!("The assistant is set to on-device only. Allow cloud AI in Settings → Privacy, or choose a local model.")
            } else {
                e
            }
        })?;
        text::strip_ai_dashes(&text::strip_llm_wrapping(&out))
    };
    Ok(AssistantResponse {
        id: db::new_id(),
        query,
        reply: if reply.trim().is_empty() { "Done.".into() } else { reply },
        actions,
        results,
        created_at: Local::now().to_rfc3339(),
        mode: "quick".into(),
        sources: vec![],
        thread_id: None,
        source: None,
    })
}

/// "Run now" on a skill card: run it unattended right away, like its schedule would.
#[tauri::command]
pub async fn run_skill_now(st: tauri::State<'_, Shared>, id: String) -> Result<AssistantResponse, String> {
    let st = st.inner().clone();
    let k = st.db.list_skills().map_err(|e| e.to_string())?.into_iter().find(|k| k.id == id).ok_or("That skill no longer exists.")?;
    let _ = st.db.set_skill_last_run(&k.id, &Local::now().to_rfc3339());
    run_and_deliver(&st, &k).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn a_slot_runs_once() {
        let c = Cron::parse("0 9 * * 1-5").unwrap();
        let now = at("2026-11-09T09:00:40Z");
        let slot = due_slot(&c, None, &now).unwrap();
        assert_eq!(slot, at("2026-11-09T09:00:00Z"));
        // after it ran, the same slot isn't due again on the next tick
        let ran = slot.to_rfc3339();
        assert!(due_slot(&c, Some(&ran), &at("2026-11-09T09:01:10Z")).is_none());
        // the next day's slot is
        assert_eq!(due_slot(&c, Some(&ran), &at("2026-11-10T09:00:05Z")), Some(at("2026-11-10T09:00:00Z")));
    }

    #[test]
    fn a_little_late_still_runs_but_long_missed_slots_are_skipped() {
        let c = Cron::parse("0 9 * * *").unwrap();
        // woke at 9:04: still within grace
        assert!(due_slot(&c, Some("2026-11-08T09:00:00Z"), &at("2026-11-09T09:04:59Z")).is_some());
        // woke at 11:30 after sleeping through 9:00: skip, don't storm
        assert!(due_slot(&c, Some("2026-11-08T09:00:00Z"), &at("2026-11-09T11:30:00Z")).is_none());
    }

    #[test]
    fn frequent_schedules_pick_the_latest_slot_only() {
        let c = Cron::parse("* * * * *").unwrap();
        // last ran 3 minutes ago: only the current minute runs (not a backlog of 3)
        let s = due_slot(&c, Some("2026-11-09T10:00:00Z"), &at("2026-11-09T10:03:20Z")).unwrap();
        assert_eq!(s, at("2026-11-09T10:03:00Z"));
        assert!(due_slot(&c, Some(&s.to_rfc3339()), &at("2026-11-09T10:03:50Z")).is_none());
    }

    #[test]
    fn run_now_counts_as_the_current_slot() {
        let c = Cron::parse("0 9 * * *").unwrap();
        // "Run now" at 9:02 sets last_run to then: the 9:00 slot doesn't run again
        assert!(due_slot(&c, Some("2026-11-09T09:02:00Z"), &at("2026-11-09T09:02:30Z")).is_none());
    }
}
