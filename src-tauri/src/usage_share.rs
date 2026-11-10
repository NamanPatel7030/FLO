//! "Share usage counts with Flo" (Settings → Privacy). Off by default.
//!
//! When the user turns it on, once an hour Flo sends daily totals for the last week, computed from the
//! local database: how many dictations, words dictated, assistant questions, agent runs and meetings
//! recorded. Numbers only, never what was said, typed, asked or answered. It goes to the account server
//! (`POST /api/app/usage`) through the egress guard as an account request, so it shows up in the network
//! log. Turning it off stops sending and asks the server to delete the counts it holds
//! (`DELETE /api/app/usage`). Days are the computer's local calendar days.
use crate::state::Shared;
use anyhow::Result;
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::future::Future;
use std::time::Duration;

pub const SEND_EVERY: Duration = Duration::from_secs(60 * 60);
const FIRST_AFTER: Duration = Duration::from_secs(3 * 60);
/// days of totals per send (the server keeps the latest total for each day)
pub const DAYS: i64 = 7;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DayCounts {
    pub day: String,
    pub dictations: i64,
    pub words: i64,
    pub assistant_asks: i64,
    pub agent_runs: i64,
    pub meetings: i64,
}

impl DayCounts {
    fn is_empty(&self) -> bool {
        self.dictations == 0 && self.words == 0 && self.assistant_asks == 0 && self.agent_runs == 0 && self.meetings == 0
    }
}

/// Per-day totals since `since_day` (YYYY-MM-DD, inclusive), oldest first. Only COUNT / SUM: no text
/// column is ever read. `created_at` is local RFC 3339, so its first 10 characters are the local day.
pub fn daily_counts(c: &Connection, since_day: &str) -> rusqlite::Result<Vec<DayCounts>> {
    let mut days: BTreeMap<String, DayCounts> = BTreeMap::new();
    let mut tally = |sql: &str, set: fn(&mut DayCounts, i64, i64)| -> rusqlite::Result<()> {
        let mut st = c.prepare(sql)?;
        let rows = st.query_map(params![since_day], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, Option<i64>>(2)?.unwrap_or(0))))?;
        for row in rows {
            let (day, n, extra) = row?;
            let e = days.entry(day.clone()).or_insert_with(|| DayCounts { day, ..Default::default() });
            set(e, n, extra);
        }
        Ok(())
    };
    tally(
        "SELECT substr(created_at,1,10) d, COUNT(*), SUM(words) FROM dictations WHERE substr(created_at,1,10) >= ?1 GROUP BY d",
        |e, n, words| {
            e.dictations = n;
            e.words = words;
        },
    )?;
    tally("SELECT substr(created_at,1,10) d, COUNT(*), 0 FROM assistant_log WHERE substr(created_at,1,10) >= ?1 GROUP BY d", |e, n, _| e.assistant_asks = n)?;
    tally("SELECT substr(created_at,1,10) d, COUNT(*), 0 FROM code_runs WHERE substr(created_at,1,10) >= ?1 GROUP BY d", |e, n, _| e.agent_runs = n)?;
    tally(
        "SELECT substr(created_at,1,10) d, COUNT(*), 0 FROM notes WHERE kind = 'meeting' AND substr(created_at,1,10) >= ?1 GROUP BY d",
        |e, n, _| e.meetings = n,
    )?;
    Ok(days.into_values().filter(|d| !d.is_empty()).collect())
}

/// The request body: `{days: [{day, counts: {dictations, words, assistant_asks, agent_runs, meetings}}]}`.
pub fn payload(days: &[DayCounts]) -> Value {
    json!({
        "days": days.iter().map(|d| json!({
            "day": d.day,
            "counts": {
                "dictations": d.dictations,
                "words": d.words,
                "assistant_asks": d.assistant_asks,
                "agent_runs": d.agent_runs,
                "meetings": d.meetings,
            },
        })).collect::<Vec<_>>(),
    })
}

/// The single rule: only with the toggle on and a signed-in account.
pub fn should_send(enabled: bool, signed_in: bool) -> bool {
    enabled && signed_in
}

/// One round. Nothing is computed or sent unless `should_send`; nothing is sent when there's nothing to
/// count. Returns whether a request was made.
pub async fn run_once<C, S, F>(enabled: bool, signed_in: bool, counts: C, send: S) -> Result<bool>
where
    C: FnOnce() -> Result<Vec<DayCounts>>,
    S: FnOnce(Value) -> F,
    F: Future<Output = Result<()>>,
{
    if !should_send(enabled, signed_in) {
        return Ok(false);
    }
    let days = counts()?;
    if days.is_empty() {
        return Ok(false);
    }
    send(payload(&days)).await?;
    Ok(true)
}

fn since_day() -> String {
    (chrono::Local::now().date_naive() - chrono::Duration::days(DAYS - 1)).format("%Y-%m-%d").to_string()
}

fn signed_in(st: &Shared) -> bool {
    crate::push::has_session(st) && crate::account::enforced(st)
}

async fn tick(st: &Shared) -> Result<bool> {
    run_once(
        st.settings().share_usage,
        signed_in(st),
        || Ok(st.db.with_conn(|c| daily_counts(c, &since_day()))?),
        |body| async move {
            // re-check right before it leaves the computer (the toggle could have flipped meanwhile)
            if !st.settings().share_usage {
                anyhow::bail!("sharing turned off; not sent");
            }
            crate::push::ok_or_err(crate::push::call(st, "POST", "/api/app/usage", Some(body)).await?)?;
            Ok(())
        },
    )
    .await
}

pub fn spawn(st: Shared) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_AFTER).await;
        loop {
            match tick(&st).await {
                Ok(true) => log::info!("usage counts shared"),
                Ok(false) => {}
                Err(e) => log::warn!("usage counts: {e}"),
            }
            tokio::time::sleep(SEND_EVERY).await;
        }
    });
}

/// Settings were saved: turning sharing off asks the server to forget the counts it holds; turning it
/// on sends the first counts right away. Fire-and-forget.
pub fn on_settings_changed(st: &Shared, was: bool, now: bool) {
    if was == now || !signed_in(st) {
        return;
    }
    let st = st.clone();
    tauri::async_runtime::spawn(async move {
        let r = if now {
            tick(&st).await.map(|_| ())
        } else {
            crate::push::call(&st, "DELETE", "/api/app/usage", None).await.and_then(crate::push::ok_or_err).map(|_| ())
        };
        if let Err(e) = r {
            log::warn!("usage counts ({}): {e}", if now { "on" } else { "off" });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use std::cell::RefCell;

    fn seeded() -> Db {
        let db = Db::open_in_memory().unwrap();
        db.with_conn(|c| {
            for (id, at, words) in [("d1", "2026-11-09T09:00:00+05:30", 12), ("d2", "2026-11-09T23:59:00+05:30", 8), ("d3", "2026-11-10T08:00:00+05:30", 5), ("old", "2026-10-01T08:00:00+05:30", 99)] {
                c.execute(
                    "INSERT INTO dictations VALUES (?1,?2,'Notes','dictate','secret words','secret words',?3,1000,100)",
                    params![id, at, words],
                )
                .unwrap();
            }
            c.execute("INSERT INTO assistant_log(id, created_at, json) VALUES ('a1','2026-11-10T10:00:00+05:30','{\"q\":\"private\"}')", []).unwrap();
            c.execute("INSERT INTO assistant_log(id, created_at, json) VALUES ('a2','2026-11-10T11:00:00+05:30','{}')", []).unwrap();
            c.execute("INSERT INTO projects VALUES ('p','P',NULL,'active','#fff','2026-11-01T00:00:00Z',NULL,NULL,NULL,NULL,NULL)", []).unwrap();
            c.execute(
                "INSERT INTO code_runs (id,project_id,prompt,agent,mode,status,created_at) VALUES ('r1','p','fix it','claude','write','done','2026-11-09T12:00:00+05:30')",
                [],
            )
            .unwrap();
            for (id, kind) in [("n1", "meeting"), ("n2", "note")] {
                c.execute(
                    "INSERT INTO notes VALUES (?1,'t',?2,NULL,'transcript','summary','[]',60.0,'2026-11-10T15:00:00+05:30',0)",
                    params![id, kind],
                )
                .unwrap();
            }
        });
        db
    }

    #[test]
    fn counts_per_local_day_without_content() {
        let db = seeded();
        let days = db.with_conn(|c| daily_counts(c, "2026-11-04")).unwrap();
        assert_eq!(
            days,
            vec![
                DayCounts { day: "2026-11-09".into(), dictations: 2, words: 20, assistant_asks: 0, agent_runs: 1, meetings: 0 },
                DayCounts { day: "2026-11-10".into(), dictations: 1, words: 5, assistant_asks: 2, agent_runs: 0, meetings: 1 },
            ]
        );
        // the body is numbers only
        let body = payload(&days).to_string();
        assert!(!body.contains("secret") && !body.contains("private") && !body.contains("transcript") && !body.contains("fix it"));
        assert_eq!(payload(&days)["days"][1]["counts"]["assistant_asks"], 2);
    }

    #[test]
    fn empty_database_has_nothing_to_count() {
        let db = Db::open_in_memory().unwrap();
        assert!(db.with_conn(|c| daily_counts(c, "2026-11-04")).unwrap().is_empty());
    }

    #[tokio::test]
    async fn nothing_is_sent_or_computed_when_off_or_signed_out() {
        for (enabled, signed_in) in [(false, true), (false, false), (true, false)] {
            let sent = RefCell::new(0);
            let computed = RefCell::new(0);
            let r = run_once(
                enabled,
                signed_in,
                || {
                    *computed.borrow_mut() += 1;
                    Ok(vec![DayCounts { day: "2026-11-10".into(), dictations: 1, ..Default::default() }])
                },
                |_| {
                    *sent.borrow_mut() += 1;
                    async { Ok(()) }
                },
            )
            .await
            .unwrap();
            assert!(!r);
            assert_eq!((*sent.borrow(), *computed.borrow()), (0, 0), "enabled={enabled} signed_in={signed_in}");
        }
    }

    #[tokio::test]
    async fn sends_once_when_on_and_only_if_there_is_something() {
        let sent = RefCell::new(Vec::new());
        let r = run_once(true, true, || Ok(vec![DayCounts { day: "2026-11-10".into(), dictations: 3, words: 40, ..Default::default() }]), |body| {
            sent.borrow_mut().push(body);
            async { Ok(()) }
        })
        .await
        .unwrap();
        assert!(r);
        assert_eq!(sent.borrow().len(), 1);
        assert_eq!(sent.borrow()[0]["days"][0]["counts"]["words"], 40);

        let none = RefCell::new(0);
        let r = run_once(true, true, || Ok(vec![]), |_| {
            *none.borrow_mut() += 1;
            async { Ok(()) }
        })
        .await
        .unwrap();
        assert!(!r);
        assert_eq!(*none.borrow(), 0);
    }

    #[test]
    fn off_by_default() {
        assert!(!crate::model::Settings::default().share_usage);
        let s: crate::model::Settings = serde_json::from_str("{}").unwrap();
        assert!(!s.share_usage);
    }
}
