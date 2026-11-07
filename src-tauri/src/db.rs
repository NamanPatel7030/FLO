//! Local storage: SQLCipher-encrypted SQLite. Key lives in the OS keychain.
use crate::model::*;
use anyhow::Result;
use chrono::{DateTime, Duration, Local, NaiveDate, Timelike};
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::HashMap;
use std::path::Path;

pub struct Db {
    conn: Mutex<Connection>,
}

const PROJECT_COLORS: &[&str] = &["#8b5cf6", "#06b6d4", "#f59e0b", "#10b981", "#ec4899", "#3b82f6", "#ef4444"];

/// Millisecond precision: every JS engine (incl. WebKit) parses this reliably.
fn now() -> String {
    Local::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, false)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

impl Db {
    /// Open (or create) the encrypted database. `key_hex` = 64 hex chars.
    pub fn open(path: &Path, key_hex: Option<&str>) -> Result<Self> {
        let conn = Connection::open(path)?;
        if let Some(k) = key_hex {
            conn.execute_batch(&format!("PRAGMA key = \"x'{k}'\";"))?;
        }
        Self::init(conn)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;
            CREATE TABLE IF NOT EXISTS dictations(
              id TEXT PRIMARY KEY, created_at TEXT NOT NULL, app TEXT NOT NULL, mode TEXT NOT NULL,
              raw_text TEXT NOT NULL, final_text TEXT NOT NULL, words INTEGER NOT NULL,
              duration_ms INTEGER NOT NULL, latency_ms INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS projects(
              id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, status TEXT NOT NULL,
              color TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS todos(
              id TEXT PRIMARY KEY, title TEXT NOT NULL, reason TEXT, person TEXT, app TEXT,
              source TEXT NOT NULL, status TEXT NOT NULL, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
              due TEXT, confidence REAL, created_at TEXT NOT NULL, completed_at TEXT);
            CREATE TABLE IF NOT EXISTS notes(
              id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL,
              project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
              transcript TEXT NOT NULL, summary TEXT NOT NULL, action_items TEXT NOT NULL,
              duration_sec REAL NOT NULL, created_at TEXT NOT NULL, live INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS dictionary(id TEXT PRIMARY KEY, word TEXT NOT NULL, replacement TEXT);
            CREATE TABLE IF NOT EXISTS claude_events(
              id TEXT PRIMARY KEY, kind TEXT NOT NULL, session_id TEXT NOT NULL, project TEXT NOT NULL,
              cwd TEXT NOT NULL, message TEXT NOT NULL, at TEXT NOT NULL, seen INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS claude_sessions(
              session_id TEXT PRIMARY KEY, project TEXT NOT NULL, cwd TEXT NOT NULL, status TEXT NOT NULL,
              message TEXT NOT NULL, updated_at TEXT NOT NULL, app_bundle TEXT, terminal TEXT,
              dismissed INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS vault_notes(
              id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS vault_links(
              source TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'wiki',
              PRIMARY KEY(source, target, kind));
            CREATE TABLE IF NOT EXISTS context_docs(
              id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
              pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS attention_snapshots(
              window_key TEXT PRIMARY KEY, app TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS assistant_log(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, json TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS idx_dict_created ON dictations(created_at);
            CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
            "#,
        )?;
        // additive migrations (ignore "duplicate column")
        for sql in [
            "ALTER TABLE claude_events ADD COLUMN app_bundle TEXT",
            "ALTER TABLE claude_events ADD COLUMN terminal TEXT",
            "ALTER TABLE claude_sessions ADD COLUMN transcript TEXT",
            "ALTER TABLE todos ADD COLUMN remind_at TEXT",
            "ALTER TABLE todos ADD COLUMN reminded INTEGER NOT NULL DEFAULT 0",
        ] {
            let _ = conn.execute(sql, []);
        }
        Ok(Self { conn: Mutex::new(conn) })
    }

    // ── dictations ──────────────────────────────────────────────────────────
    pub fn insert_dictation(&self, d: &Dictation) -> Result<()> {
        self.conn.lock().execute(
            "INSERT INTO dictations VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![d.id, d.created_at, d.app, d.mode.as_str(), d.raw_text, d.final_text, d.words, d.duration_ms, d.latency_ms],
        )?;
        Ok(())
    }

    pub fn list_dictations(&self, limit: u32) -> Result<Vec<Dictation>> {
        let c = self.conn.lock();
        let mut st = c.prepare("SELECT * FROM dictations ORDER BY created_at DESC LIMIT ?1")?;
        let rows = st.query_map([limit], row_dictation)?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn dictations_since(&self, since: &str) -> Result<Vec<Dictation>> {
        let c = self.conn.lock();
        let mut st = c.prepare("SELECT * FROM dictations WHERE created_at >= ?1")?;
        let rows = st.query_map([since], row_dictation)?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    // ── projects ────────────────────────────────────────────────────────────
    pub fn create_project(&self, name: &str, description: Option<&str>) -> Result<Project> {
        let id = new_id();
        let count: i64 = self.conn.lock().query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))?;
        let color = PROJECT_COLORS[(count as usize) % PROJECT_COLORS.len()];
        self.conn.lock().execute(
            "INSERT INTO projects VALUES (?1,?2,?3,'active',?4,?5)",
            params![id, name.trim(), description, color, now()],
        )?;
        Ok(self.get_project(&id)?.expect("just inserted"))
    }

    pub fn get_project(&self, id: &str) -> Result<Option<Project>> {
        Ok(self.list_projects()?.into_iter().find(|p| p.id == id))
    }

    pub fn list_projects(&self) -> Result<Vec<Project>> {
        let c = self.conn.lock();
        let mut st = c.prepare(
            "SELECT p.id,p.name,p.description,p.status,p.color,p.updated_at,
               (SELECT COUNT(*) FROM todos t WHERE t.project_id=p.id AND t.status IN ('open','snoozed')),
               (SELECT COUNT(*) FROM todos t WHERE t.project_id=p.id AND t.status='done'),
               (SELECT n.title FROM notes n WHERE n.project_id=p.id ORDER BY n.created_at DESC LIMIT 1)
             FROM projects p ORDER BY p.updated_at DESC",
        )?;
        let rows = st
            .query_map([], |r| {
                Ok(Project {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    description: r.get(2)?,
                    status: r.get(3)?,
                    color: r.get(4)?,
                    updated_at: r.get(5)?,
                    open_todos: r.get(6)?,
                    done_todos: r.get(7)?,
                    last_note: r.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn update_project(&self, id: &str, name: Option<&str>, description: Option<&str>, status: Option<&str>) -> Result<()> {
        let c = self.conn.lock();
        if let Some(n) = name {
            c.execute("UPDATE projects SET name=?2 WHERE id=?1", params![id, n])?;
        }
        if let Some(d) = description {
            c.execute("UPDATE projects SET description=?2 WHERE id=?1", params![id, d])?;
        }
        if let Some(s) = status {
            c.execute("UPDATE projects SET status=?2 WHERE id=?1", params![id, s])?;
        }
        c.execute("UPDATE projects SET updated_at=?2 WHERE id=?1", params![id, now()])?;
        Ok(())
    }

    pub fn touch_project(&self, id: &str) -> Result<()> {
        self.conn.lock().execute("UPDATE projects SET updated_at=?2 WHERE id=?1", params![id, now()])?;
        Ok(())
    }

    pub fn delete_project(&self, id: &str) -> Result<()> {
        self.conn.lock().execute("DELETE FROM projects WHERE id=?1", [id])?;
        Ok(())
    }

    /// Find a project by fuzzy name.
    pub fn find_project(&self, name: &str) -> Result<Option<Project>> {
        let projects = self.list_projects()?;
        let cands: Vec<(String, String)> = projects.iter().map(|p| (p.id.clone(), p.name.clone())).collect();
        Ok(crate::text::best_match(name, &cands).and_then(|(id, _)| projects.iter().find(|p| &p.id == id).cloned()))
    }

    // ── todos ───────────────────────────────────────────────────────────────
    pub fn insert_todo(&self, t: &Todo) -> Result<()> {
        self.conn.lock().execute(
            "INSERT INTO todos (id,title,reason,person,app,source,status,project_id,due,confidence,created_at,completed_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![t.id, t.title, t.reason, t.person, t.app, t.source, t.status, t.project_id, t.due, t.confidence, t.created_at, t.completed_at],
        )?;
        if let Some(r) = &t.remind_at {
            self.conn.lock().execute("UPDATE todos SET remind_at=?2, reminded=0 WHERE id=?1", params![t.id, r])?;
        }
        if let Some(p) = &t.project_id {
            self.touch_project(p)?;
        }
        Ok(())
    }

    /// 5 minutes before a due time (RFC3339 with a clock time). None for date-only / no due.
    pub fn remind_at_for(due: Option<&str>) -> Option<String> {
        let d = due?;
        if d.len() <= 10 {
            return None;
        }
        let t = chrono::DateTime::parse_from_rfc3339(d).ok()?;
        Some((t - Duration::minutes(5)).to_rfc3339())
    }

    /// Open to-dos whose reminder time has arrived and haven't been notified yet.
    pub fn due_reminders(&self) -> Result<Vec<Todo>> {
        let now = Local::now().to_rfc3339();
        let c = self.conn.lock();
        let mut st = c.prepare("SELECT * FROM todos WHERE status='open' AND reminded=0 AND remind_at IS NOT NULL AND remind_at<=?1")?;
        let rows = st.query_map([now], row_todo)?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn mark_reminded(&self, id: &str) -> Result<()> {
        self.conn.lock().execute("UPDATE todos SET reminded=1 WHERE id=?1", [id])?;
        Ok(())
    }

    /// Set/replace a reminder time directly (snooze / "remind me in N min").
    pub fn set_remind(&self, id: &str, remind_at: Option<&str>) -> Result<()> {
        self.conn.lock().execute("UPDATE todos SET remind_at=?2, reminded=0 WHERE id=?1", params![id, remind_at])?;
        Ok(())
    }

    pub fn add_todo(&self, title: &str, source: &str, project_id: Option<String>, due: Option<String>) -> Result<Todo> {
        let remind_at = Self::remind_at_for(due.as_deref());
        let t = Todo {
            id: new_id(),
            title: title.trim().to_string(),
            source: source.into(),
            status: "open".into(),
            project_id,
            due,
            remind_at,
            created_at: now(),
            ..Default::default()
        };
        self.insert_todo(&t)?;
        Ok(t)
    }

    pub fn list_todos(&self) -> Result<Vec<Todo>> {
        let c = self.conn.lock();
        let mut st = c.prepare("SELECT * FROM todos ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'snoozed' THEN 1 ELSE 2 END, created_at DESC")?;
        let rows = st.query_map([], row_todo)?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn open_todo_titles(&self) -> Result<Vec<String>> {
        Ok(self
            .list_todos()?
            .into_iter()
            .filter(|t| t.status != "done" || t.completed_at.as_deref().map(|c| c > &(Local::now() - Duration::days(7)).to_rfc3339()[..]).unwrap_or(false))
            .map(|t| t.title)
            .collect())
    }

    pub fn update_todo(&self, id: &str, status: Option<&str>, title: Option<&str>, project_id: Option<Option<String>>) -> Result<()> {
        let c = self.conn.lock();
        if let Some(s) = status {
            let completed = if s == "done" { Some(now()) } else { None };
            c.execute("UPDATE todos SET status=?2, completed_at=?3 WHERE id=?1", params![id, s, completed])?;
        }
        if let Some(t) = title {
            c.execute("UPDATE todos SET title=?2 WHERE id=?1", params![id, t])?;
        }
        if let Some(p) = project_id {
            c.execute("UPDATE todos SET project_id=?2 WHERE id=?1", params![id, p])?;
        }
        Ok(())
    }

    pub fn delete_todo(&self, id: &str) -> Result<()> {
        self.conn.lock().execute("DELETE FROM todos WHERE id=?1", [id])?;
        Ok(())
    }

    // ── notes ───────────────────────────────────────────────────────────────
    pub fn upsert_note(&self, n: &Note) -> Result<()> {
        self.conn.lock().execute(
            "INSERT INTO notes VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
             ON CONFLICT(id) DO UPDATE SET title=?2, kind=?3, project_id=?4, transcript=?5, summary=?6,
               action_items=?7, duration_sec=?8, live=?10",
            params![
                n.id, n.title, n.kind, n.project_id,
                serde_json::to_string(&n.transcript)?, n.summary,
                serde_json::to_string(&n.action_items)?, n.duration_sec, n.created_at, n.live as i32
            ],
        )?;
        if let Some(p) = &n.project_id {
            self.touch_project(p)?;
        }
        Ok(())
    }

    pub fn list_notes(&self) -> Result<Vec<Note>> {
        let c = self.conn.lock();
        let mut st = c.prepare("SELECT * FROM notes ORDER BY created_at DESC")?;
        let rows = st.query_map([], row_note)?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_note(&self, id: &str) -> Result<Option<Note>> {
        let c = self.conn.lock();
        Ok(c.query_row("SELECT * FROM notes WHERE id=?1", [id], row_note).optional()?)
    }

    pub fn delete_note(&self, id: &str) -> Result<()> {
        self.conn.lock().execute("DELETE FROM notes WHERE id=?1", [id])?;
        Ok(())
    }

    /// Mark notes left "live" by a crash as finished.
    pub fn close_stale_live_notes(&self) -> Result<()> {
        self.conn.lock().execute("UPDATE notes SET live=0 WHERE live=1", [])?;
        Ok(())
    }

    // ── dictionary ──────────────────────────────────────────────────────────
    pub fn list_dictionary(&self) -> Result<Vec<DictionaryEntry>> {
        let c = self.conn.lock();
        let mut st = c.prepare("SELECT id, word, replacement FROM dictionary ORDER BY word")?;
        let rows = st
            .query_map([], |r| Ok(DictionaryEntry { id: r.get(0)?, word: r.get(1)?, replacement: r.get(2)? }))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn add_dictionary(&self, word: &str, replacement: Option<&str>) -> Result<DictionaryEntry> {
        let e = DictionaryEntry {
            id: new_id(),
            word: word.trim().into(),
            replacement: replacement.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
        };
        self.conn.lock().execute("INSERT INTO dictionary VALUES (?1,?2,?3)", params![e.id, e.word, e.replacement])?;
        Ok(e)
    }

    pub fn remove_dictionary(&self, id: &str) -> Result<()> {
        self.conn.lock().execute("DELETE FROM dictionary WHERE id=?1", [id])?;
        Ok(())
    }

    // ── claude events ───────────────────────────────────────────────────────
    pub fn insert_claude_event(&self, e: &ClaudeEvent) -> Result<()> {
        self.conn.lock().execute(
            "INSERT INTO claude_events (id,kind,session_id,project,cwd,message,at,seen,app_bundle,terminal) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![e.id, e.kind, e.session_id, e.project, e.cwd, e.message, e.at, e.seen as i32, e.app_bundle, e.terminal],
        )?;
        Ok(())
    }

    pub fn list_claude_events(&self, limit: u32) -> Result<Vec<ClaudeEvent>> {
        let c = self.conn.lock();
        let mut st = c.prepare("SELECT id,kind,session_id,project,cwd,message,at,seen,app_bundle,terminal FROM claude_events ORDER BY at DESC LIMIT ?1")?;
        let rows = st
            .query_map([limit], |r| {
                Ok(ClaudeEvent {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    session_id: r.get(2)?,
                    project: r.get(3)?,
                    cwd: r.get(4)?,
                    message: r.get(5)?,
                    at: r.get(6)?,
                    seen: r.get::<_, i32>(7)? != 0,
                    app_bundle: r.get(8)?,
                    terminal: r.get(9)?,
                    transcript_path: None,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn mark_claude_seen(&self, id: Option<&str>) -> Result<()> {
        let c = self.conn.lock();
        match id {
            Some(i) => c.execute("UPDATE claude_events SET seen=1 WHERE id=?1", [i])?,
            None => c.execute("UPDATE claude_events SET seen=1", [])?,
        };
        Ok(())
    }

    // ── claude sessions (notch tray) ────────────────────────────────────────
    /// Upsert a session's latest state; any new event un-dismisses it. `end` removes it.
    pub fn apply_claude_event(&self, e: &ClaudeEvent, status: Option<&str>) -> Result<()> {
        let c = self.conn.lock();
        match status {
            None => {
                c.execute("DELETE FROM claude_sessions WHERE session_id=?1", [&e.session_id])?;
            }
            Some(st) => {
                c.execute(
                    "INSERT INTO claude_sessions (session_id,project,cwd,status,message,updated_at,app_bundle,terminal,dismissed,transcript)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,?9)
                     ON CONFLICT(session_id) DO UPDATE SET project=?2, cwd=?3, status=?4,
                       message=CASE WHEN ?5='' THEN message ELSE ?5 END, updated_at=?6,
                       app_bundle=COALESCE(?7, app_bundle), terminal=COALESCE(?8, terminal), dismissed=0,
                       transcript=COALESCE(?9, transcript)",
                    params![e.session_id, e.project, e.cwd, st, e.message, e.at, e.app_bundle, e.terminal, e.transcript_path],
                )?;
            }
        }
        Ok(())
    }

    /// Visible sessions, most recent first; stale ones (>12 h) are dropped.
    pub fn list_claude_sessions(&self) -> Result<Vec<ClaudeSession>> {
        let cutoff = (Local::now() - Duration::hours(12)).to_rfc3339();
        let c = self.conn.lock();
        c.execute("DELETE FROM claude_sessions WHERE updated_at < ?1", [&cutoff])?;
        let mut st = c.prepare(
            "SELECT session_id,project,cwd,status,message,updated_at,app_bundle,terminal,transcript FROM claude_sessions
             WHERE dismissed=0 ORDER BY updated_at DESC LIMIT 20",
        )?;
        let rows = st
            .query_map([], |r| {
                Ok(ClaudeSession {
                    session_id: r.get(0)?,
                    project: r.get(1)?,
                    cwd: r.get(2)?,
                    status: r.get(3)?,
                    message: r.get(4)?,
                    updated_at: r.get(5)?,
                    app_bundle: r.get(6)?,
                    terminal: r.get(7)?,
                    transcript_path: r.get(8)?,
                    source: {
                        let id: String = r.get(0)?;
                        match id.split_once(':') {
                            Some((p, _)) if !p.is_empty() && !p.contains('/') => p.to_string(),
                            _ => "claude".to_string(),
                        }
                    },
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Mark a "working" session finished (no Stop event arrived but its transcript went quiet).
    pub fn settle_claude_session(&self, id: &str, message: &str) -> Result<()> {
        self.conn.lock().execute(
            "UPDATE claude_sessions SET status='done', message=CASE WHEN ?2='' THEN message ELSE ?2 END, updated_at=?3
             WHERE session_id=?1 AND status='working'",
            params![id, message, now()],
        )?;
        Ok(())
    }

    /// A "done" session whose transcript moved again: Claude carried on after its Stop.
    pub fn revive_claude_session(&self, id: &str) -> Result<()> {
        self.conn.lock().execute(
            "UPDATE claude_sessions SET status='working', updated_at=?2 WHERE session_id=?1 AND status='done'",
            params![id, now()],
        )?;
        Ok(())
    }

    pub fn get_claude_session(&self, id: &str) -> Result<Option<ClaudeSession>> {
        Ok(self.list_claude_sessions()?.into_iter().find(|s| s.session_id == id))
    }

    pub fn dismiss_claude_session(&self, id: &str) -> Result<()> {
        self.conn.lock().execute("UPDATE claude_sessions SET dismissed=1 WHERE session_id=?1", [id])?;
        Ok(())
    }

    // ── Flo Vault ─────────────────────────────────────────────────────────────
    pub fn vault_upsert(&self, id: &str, title: &str, kind: &str, content: &str) -> Result<()> {
        let n = now();
        self.conn.lock().execute(
            "INSERT INTO vault_notes (id,title,kind,content,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?5)
             ON CONFLICT(id) DO UPDATE SET title=?2,
               kind=CASE WHEN vault_notes.kind='topic' THEN ?3 ELSE vault_notes.kind END,
               content=CASE WHEN ?4='' THEN vault_notes.content ELSE ?4 END, updated_at=?5",
            params![id, title, kind, content, n],
        )?;
        Ok(())
    }

    pub fn vault_link(&self, source: &str, target: &str, kind: &str) -> Result<()> {
        self.conn.lock().execute(
            "INSERT OR IGNORE INTO vault_links (source,target,kind) VALUES (?1,?2,?3)",
            params![source, target, kind],
        )?;
        Ok(())
    }

    pub fn vault_clear_links(&self, source: &str, kind: &str) -> Result<()> {
        self.conn.lock().execute("DELETE FROM vault_links WHERE source=?1 AND kind=?2", params![source, kind])?;
        Ok(())
    }

    pub fn vault_get(&self, id: &str) -> Result<Option<VaultNote>> {
        let c = self.conn.lock();
        let row = c
            .query_row(
                "SELECT id,title,kind,content,created_at,updated_at FROM vault_notes WHERE id=?1",
                [id],
                |r| {
                    Ok(VaultNote {
                        id: r.get(0)?,
                        title: r.get(1)?,
                        kind: r.get(2)?,
                        content: r.get(3)?,
                        created_at: r.get(4)?,
                        updated_at: r.get(5)?,
                        outlinks: vec![],
                        backlinks: vec![],
                    })
                },
            )
            .optional()?;
        let Some(mut n) = row else { return Ok(None) };
        drop(c);
        n.outlinks = self.vault_neighbors(id, true)?;
        n.backlinks = self.vault_neighbors(id, false)?;
        Ok(Some(n))
    }

    fn vault_neighbors(&self, id: &str, outgoing: bool) -> Result<Vec<VaultNode>> {
        let c = self.conn.lock();
        let sql = if outgoing {
            "SELECT n.id,n.title,n.kind,n.content,n.updated_at FROM vault_links l JOIN vault_notes n ON n.id=l.target WHERE l.source=?1"
        } else {
            "SELECT n.id,n.title,n.kind,n.content,n.updated_at FROM vault_links l JOIN vault_notes n ON n.id=l.source WHERE l.target=?1"
        };
        let mut st = c.prepare(sql)?;
        let rows = st
            .query_map([id], |r| {
                let content: String = r.get(3)?;
                let kind: String = r.get(2)?;
                Ok(VaultNode {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    summary: crate::text::truncate_chars(content.trim().lines().next().unwrap_or(""), 100),
                    color: Some(crate::vault::kind_color(&kind).to_string()),
                    kind,
                    updated_at: r.get(4)?,
                    degree: 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn vault_graph(&self) -> Result<VaultGraph> {
        let c = self.conn.lock();
        let mut deg: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
        let mut links = vec![];
        {
            let mut st = c.prepare("SELECT source,target,kind FROM vault_links")?;
            for row in st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))? {
                let (s, t, k) = row?;
                *deg.entry(s.clone()).or_default() += 1;
                *deg.entry(t.clone()).or_default() += 1;
                links.push(VaultLink { source: s, target: t, kind: k });
            }
        }
        let mut st = c.prepare("SELECT id,title,kind,content,updated_at FROM vault_notes")?;
        let nodes = st
            .query_map([], |r| {
                let id: String = r.get(0)?;
                let kind: String = r.get(2)?;
                let content: String = r.get(3)?;
                Ok(VaultNode {
                    degree: *deg.get(&id).unwrap_or(&0),
                    summary: crate::text::truncate_chars(content.trim().lines().next().unwrap_or(""), 100),
                    color: Some(crate::vault::kind_color(&kind).to_string()),
                    id,
                    title: r.get(1)?,
                    kind,
                    updated_at: r.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(VaultGraph { nodes, links })
    }

    pub fn vault_search(&self, q: &str) -> Result<Vec<VaultNode>> {
        let c = self.conn.lock();
        let like = format!("%{}%", q.replace('%', ""));
        let mut st = c.prepare(
            "SELECT id,title,kind,content,updated_at FROM vault_notes WHERE title LIKE ?1 OR content LIKE ?1 ORDER BY updated_at DESC LIMIT 50",
        )?;
        let rows = st
            .query_map([like], |r| {
                let kind: String = r.get(2)?;
                let content: String = r.get(3)?;
                Ok(VaultNode {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    summary: crate::text::truncate_chars(content.trim().lines().next().unwrap_or(""), 100),
                    color: Some(crate::vault::kind_color(&kind).to_string()),
                    kind,
                    updated_at: r.get(4)?,
                    degree: 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn vault_delete(&self, id: &str) -> Result<()> {
        let c = self.conn.lock();
        c.execute("DELETE FROM vault_links WHERE source=?1 OR target=?1", [id])?;
        c.execute("DELETE FROM vault_notes WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn vault_count(&self) -> Result<u32> {
        Ok(self.conn.lock().query_row("SELECT COUNT(*) FROM vault_notes", [], |r| r.get(0))?)
    }

    // ── context library ─────────────────────────────────────────────────────
    pub fn add_context_doc(&self, title: &str, content: &str) -> Result<ContextDoc> {
        let id = new_id();
        let title = if title.trim().is_empty() { crate::text::truncate_chars(content.lines().next().unwrap_or("Context"), 60) } else { title.trim().to_string() };
        self.conn.lock().execute(
            "INSERT INTO context_docs (id,title,content,enabled,pinned,created_at) VALUES (?1,?2,?3,1,0,?4)",
            params![id, title, content, now()],
        )?;
        Ok(self.list_context_docs()?.into_iter().find(|d| d.id == id).expect("inserted"))
    }

    pub fn list_context_docs(&self) -> Result<Vec<ContextDoc>> {
        let c = self.conn.lock();
        let mut st = c.prepare("SELECT id,title,content,enabled,pinned,created_at FROM context_docs ORDER BY pinned DESC, created_at DESC")?;
        let rows = st
            .query_map([], |r| {
                let content: String = r.get(2)?;
                let chars = content.chars().count() as u64;
                Ok(ContextDoc {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    chars,
                    tokens: chars.div_ceil(4),
                    enabled: r.get::<_, i32>(3)? != 0,
                    pinned: r.get::<_, i32>(4)? != 0,
                    created_at: r.get(5)?,
                    preview: crate::text::truncate_chars(&content.split_whitespace().collect::<Vec<_>>().join(" "), 160),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn get_context_content(&self, id: &str) -> Result<Option<String>> {
        let c = self.conn.lock();
        Ok(c.query_row("SELECT content FROM context_docs WHERE id=?1", [id], |r| r.get(0)).optional()?)
    }

    /// (title, content, pinned) of every enabled doc.
    pub fn enabled_context(&self) -> Result<Vec<(String, String, bool)>> {
        let c = self.conn.lock();
        let mut st = c.prepare("SELECT title,content,pinned FROM context_docs WHERE enabled=1 ORDER BY pinned DESC, created_at DESC")?;
        let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, i32>(2)? != 0)))?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn update_context_doc(&self, id: &str, title: Option<&str>, enabled: Option<bool>, pinned: Option<bool>, content: Option<&str>) -> Result<()> {
        let c = self.conn.lock();
        if let Some(t) = title {
            c.execute("UPDATE context_docs SET title=?2 WHERE id=?1", params![id, t])?;
        }
        if let Some(e) = enabled {
            c.execute("UPDATE context_docs SET enabled=?2 WHERE id=?1", params![id, e as i32])?;
        }
        if let Some(p) = pinned {
            c.execute("UPDATE context_docs SET pinned=?2 WHERE id=?1", params![id, p as i32])?;
        }
        if let Some(t) = content {
            c.execute("UPDATE context_docs SET content=?2 WHERE id=?1", params![id, t])?;
        }
        Ok(())
    }

    pub fn delete_context_doc(&self, id: &str) -> Result<()> {
        self.conn.lock().execute("DELETE FROM context_docs WHERE id=?1", [id])?;
        Ok(())
    }

    // ── attention ───────────────────────────────────────────────────────────
    pub fn last_snapshot(&self, key: &str) -> Result<Option<String>> {
        let c = self.conn.lock();
        Ok(c.query_row("SELECT text FROM attention_snapshots WHERE window_key=?1", [key], |r| r.get(0)).optional()?)
    }

    pub fn save_snapshot(&self, key: &str, app: &str, text: &str) -> Result<()> {
        self.conn.lock().execute(
            "INSERT INTO attention_snapshots VALUES (?1,?2,?3,?4)
             ON CONFLICT(window_key) DO UPDATE SET text=?3, at=?4",
            params![key, app, text, now()],
        )?;
        Ok(())
    }

    // ── assistant log ───────────────────────────────────────────────────────
    pub fn insert_assistant(&self, r: &AssistantResponse) -> Result<()> {
        self.conn.lock().execute(
            "INSERT OR REPLACE INTO assistant_log VALUES (?1,?2,?3)",
            params![r.id, r.created_at, serde_json::to_string(r)?],
        )?;
        Ok(())
    }

    pub fn list_assistant(&self, limit: u32) -> Result<Vec<AssistantResponse>> {
        let c = self.conn.lock();
        let mut st = c.prepare("SELECT json FROM assistant_log ORDER BY created_at DESC LIMIT ?1")?;
        let rows = st
            .query_map([limit], |r| r.get::<_, String>(0))?
            .filter_map(|j| j.ok().and_then(|j| serde_json::from_str(&j).ok()))
            .collect::<Vec<AssistantResponse>>();
        Ok(rows.into_iter().rev().collect())
    }

    // ── analytics ───────────────────────────────────────────────────────────
    pub fn analytics(&self, days: u32, typing_wpm: u32) -> Result<Analytics> {
        let since = (Local::now() - Duration::days(400)).to_rfc3339();
        let dictations = self.dictations_since(&since)?;
        let todos = self.list_todos()?;
        let notes = self.list_notes()?;
        Ok(compute_analytics(&dictations, &todos, &notes, days, typing_wpm, Local::now().date_naive()))
    }
}

fn parse_day(ts: &str) -> Option<(NaiveDate, u32)> {
    DateTime::parse_from_rfc3339(ts).ok().map(|d| {
        let l = d.with_timezone(&Local);
        (l.date_naive(), l.hour())
    })
}

/// Pure analytics over rows. `days` = size of the daily series ending `today`.
pub fn compute_analytics(dictations: &[Dictation], todos: &[Todo], notes: &[Note], days: u32, typing_wpm: u32, today: NaiveDate) -> Analytics {
    let days = days.max(1);
    let start = today - Duration::days(days as i64 - 1);
    let mut daily: Vec<DailyStat> = (0..days)
        .map(|i| DailyStat { day: (start + Duration::days(i as i64)).format("%Y-%m-%d").to_string(), ..Default::default() })
        .collect();
    let idx = |d: NaiveDate| -> Option<usize> {
        if d < start || d > today {
            None
        } else {
            Some((d - start).num_days() as usize)
        }
    };

    let mut a = Analytics { hourly: vec![0; 24], ..Default::default() };
    let mut apps: HashMap<String, u64> = HashMap::new();
    let mut speak_ms: u64 = 0;
    let mut active_days = std::collections::HashSet::new();

    for d in dictations {
        let Some((day, hour)) = parse_day(&d.created_at) else { continue };
        active_days.insert(day);
        let Some(i) = idx(day) else { continue };
        let w = d.words as u64;
        if d.mode == Mode::Assistant {
            daily[i].assistant += 1;
        } else {
            daily[i].dictations += 1;
            daily[i].words += w;
            a.total_words += w;
            a.total_dictations += 1;
            a.hourly[hour as usize] += w;
            speak_ms += d.duration_ms;
            *apps.entry(d.app.clone()).or_default() += w;
        }
    }
    for t in todos {
        if t.status == "done" {
            if let Some((day, _)) = t.completed_at.as_deref().and_then(parse_day) {
                if let Some(i) = idx(day) {
                    daily[i].todos_done += 1;
                    a.todos_done += 1;
                }
            }
        } else if t.status == "open" || t.status == "snoozed" {
            a.todos_open += 1;
        }
    }
    for n in notes.iter().filter(|n| n.kind == "meeting") {
        if let Some((day, _)) = parse_day(&n.created_at) {
            active_days.insert(day);
            if let Some(i) = idx(day) {
                let m = n.duration_sec / 60.0;
                daily[i].meeting_min += m;
                a.meeting_minutes += m;
            }
        }
    }

    a.avg_wpm = if speak_ms > 0 { (a.total_words as f64) / (speak_ms as f64 / 60_000.0) } else { 0.0 };
    let typing_min = a.total_words as f64 / typing_wpm.max(1) as f64;
    let speaking_min = speak_ms as f64 / 60_000.0;
    a.minutes_saved = (typing_min - speaking_min).max(0.0);

    // streak: consecutive active days ending today (or yesterday)
    let mut streak = 0;
    let mut d = if active_days.contains(&today) { today } else { today - Duration::days(1) };
    while active_days.contains(&d) {
        streak += 1;
        d -= Duration::days(1);
    }
    a.streak_days = streak;

    let mut top: Vec<AppWords> = apps.into_iter().map(|(app, words)| AppWords { app, words }).collect();
    top.sort_by(|x, y| y.words.cmp(&x.words).then(x.app.cmp(&y.app)));
    top.truncate(6);
    a.top_apps = top;
    a.daily = daily;
    a.avg_wpm = (a.avg_wpm * 10.0).round() / 10.0;
    a.minutes_saved = (a.minutes_saved * 10.0).round() / 10.0;
    a.meeting_minutes = (a.meeting_minutes * 10.0).round() / 10.0;
    a
}

fn row_dictation(r: &Row) -> rusqlite::Result<Dictation> {
    let mode: String = r.get(3)?;
    Ok(Dictation {
        id: r.get(0)?,
        created_at: r.get(1)?,
        app: r.get(2)?,
        mode: match mode.as_str() {
            "assistant" => Mode::Assistant,
            "meeting" => Mode::Meeting,
            _ => Mode::Dictation,
        },
        raw_text: r.get(4)?,
        final_text: r.get(5)?,
        words: r.get(6)?,
        duration_ms: r.get(7)?,
        latency_ms: r.get(8)?,
    })
}

fn row_todo(r: &Row) -> rusqlite::Result<Todo> {
    Ok(Todo {
        id: r.get(0)?,
        title: r.get(1)?,
        reason: r.get(2)?,
        person: r.get(3)?,
        app: r.get(4)?,
        source: r.get(5)?,
        status: r.get(6)?,
        project_id: r.get(7)?,
        due: r.get(8)?,
        confidence: r.get(9)?,
        created_at: r.get(10)?,
        completed_at: r.get(11)?,
        remind_at: r.get::<_, Option<String>>(12).unwrap_or(None),
    })
}

fn row_note(r: &Row) -> rusqlite::Result<Note> {
    let transcript: String = r.get(4)?;
    let items: String = r.get(6)?;
    Ok(Note {
        id: r.get(0)?,
        title: r.get(1)?,
        kind: r.get(2)?,
        project_id: r.get(3)?,
        transcript: serde_json::from_str(&transcript).unwrap_or_default(),
        summary: r.get(5)?,
        action_items: serde_json::from_str(&items).unwrap_or_default(),
        duration_sec: r.get(7)?,
        created_at: r.get(8)?,
        live: r.get::<_, i32>(9)? != 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dict(ts: &str, app: &str, words: u32, ms: u64, mode: Mode) -> Dictation {
        Dictation {
            id: new_id(),
            created_at: ts.into(),
            app: app.into(),
            mode,
            raw_text: String::new(),
            final_text: String::new(),
            words,
            duration_ms: ms,
            latency_ms: 300,
        }
    }

    fn local_ts(date: NaiveDate, hour: u32) -> String {
        date.and_hms_opt(hour, 0, 0).unwrap().and_local_timezone(Local).unwrap().to_rfc3339()
    }

    #[test]
    fn reminders_fire_five_minutes_early() {
        let due = "2026-11-06T15:00:00+05:30";
        let r = Db::remind_at_for(Some(due)).unwrap();
        let rt = chrono::DateTime::parse_from_rfc3339(&r).unwrap();
        let dt = chrono::DateTime::parse_from_rfc3339(due).unwrap();
        assert_eq!((dt - rt).num_minutes(), 5);
        assert!(Db::remind_at_for(Some("2026-11-06")).is_none());
        assert!(Db::remind_at_for(None).is_none());
    }

    #[test]
    fn project_todo_crud_and_counts() {
        let db = Db::open_in_memory().unwrap();
        let p = db.create_project("Apollo", Some("Launch")).unwrap();
        let t = db.add_todo("Send deck", "voice", Some(p.id.clone()), None).unwrap();
        db.add_todo("Book venue", "voice", Some(p.id.clone()), None).unwrap();
        db.update_todo(&t.id, Some("done"), None, None).unwrap();
        let p2 = db.get_project(&p.id).unwrap().unwrap();
        assert_eq!((p2.open_todos, p2.done_todos), (1, 1));
        assert_eq!(db.find_project("apollo").unwrap().unwrap().id, p.id);
        db.delete_project(&p.id).unwrap();
        assert!(db.list_todos().unwrap().iter().all(|t| t.project_id.is_none()));
    }

    #[test]
    fn notes_roundtrip() {
        let db = Db::open_in_memory().unwrap();
        let n = Note {
            id: new_id(),
            title: "Sync".into(),
            kind: "meeting".into(),
            project_id: None,
            transcript: vec![MeetingSegment { t: 1.0, text: "hi".into(), speaker: None }],
            summary: "- a".into(),
            action_items: vec!["x".into()],
            duration_sec: 120.0,
            created_at: now(),
            live: true,
        };
        db.upsert_note(&n).unwrap();
        let mut n2 = n.clone();
        n2.live = false;
        n2.summary = "- b".into();
        db.upsert_note(&n2).unwrap();
        let got = db.get_note(&n.id).unwrap().unwrap();
        assert_eq!(got.summary, "- b");
        assert!(!got.live);
        assert_eq!(got.transcript.len(), 1);
    }

    #[test]
    fn claude_events_seen() {
        let db = Db::open_in_memory().unwrap();
        let e = ClaudeEvent {
            id: new_id(),
            kind: "stop".into(),
            session_id: "s".into(),
            project: "Flo".into(),
            cwd: "/x/Flo".into(),
            message: "Done".into(),
            at: now(),
            seen: false,
            app_bundle: Some("com.microsoft.VSCode".into()),
            terminal: Some("vscode".into()),
            transcript_path: None,
        };
        db.insert_claude_event(&e).unwrap();
        assert_eq!(db.list_claude_events(1).unwrap()[0].app_bundle.as_deref(), Some("com.microsoft.VSCode"));
        db.mark_claude_seen(None).unwrap();
        assert!(db.list_claude_events(10).unwrap()[0].seen);
    }

    #[test]
    fn claude_sessions_lifecycle() {
        let db = Db::open_in_memory().unwrap();
        let mut e = ClaudeEvent {
            id: new_id(),
            kind: "prompt".into(),
            session_id: "s1".into(),
            project: "Flo".into(),
            cwd: "/x/Flo".into(),
            message: String::new(),
            at: now(),
            seen: false,
            app_bundle: Some("/Applications/Visual Studio Code.app".into()),
            terminal: None,
            transcript_path: None,
        };
        db.apply_claude_event(&e, Some("working")).unwrap();
        e.message = "Built it".into();
        e.app_bundle = None;
        db.apply_claude_event(&e, Some("done")).unwrap();
        let s = db.list_claude_sessions().unwrap();
        assert_eq!(s.len(), 1);
        assert_eq!((s[0].status.as_str(), s[0].message.as_str()), ("done", "Built it"));
        assert_eq!(s[0].app_bundle.as_deref(), Some("/Applications/Visual Studio Code.app")); // kept
        db.dismiss_claude_session("s1").unwrap();
        assert!(db.list_claude_sessions().unwrap().is_empty());
        db.apply_claude_event(&e, Some("waiting_reply")).unwrap(); // new event → back in tray
        assert_eq!(db.list_claude_sessions().unwrap().len(), 1);
        db.apply_claude_event(&e, None).unwrap(); // SessionEnd
        assert!(db.list_claude_sessions().unwrap().is_empty());
        // settle: a working session with a quiet transcript becomes done
        db.apply_claude_event(&e, Some("working")).unwrap();
        db.settle_claude_session("s1", "All tests pass").unwrap();
        let s = db.list_claude_sessions().unwrap();
        assert_eq!((s[0].status.as_str(), s[0].message.as_str()), ("done", "All tests pass"));
    }

    #[test]
    fn vault_graph_and_links() {
        let db = Db::open_in_memory().unwrap();
        db.vault_upsert("apollo", "Apollo", "project", "Launch [[Rahul]] owns invoice").unwrap();
        db.vault_upsert("rahul", "Rahul", "person", "").unwrap();
        db.vault_link("apollo", "rahul", "wiki").unwrap();
        let g = db.vault_graph().unwrap();
        assert_eq!(g.nodes.len(), 2);
        assert_eq!(g.links.len(), 1);
        assert_eq!(g.nodes.iter().find(|n| n.id == "apollo").unwrap().degree, 1);
        let note = db.vault_get("rahul").unwrap().unwrap();
        assert_eq!(note.backlinks.len(), 1);
        assert_eq!(note.backlinks[0].id, "apollo");
        assert_eq!(db.vault_search("invoice").unwrap().len(), 1);
        db.vault_delete("apollo").unwrap();
        assert_eq!(db.vault_graph().unwrap().links.len(), 0);
    }

    #[test]
    fn context_library_crud() {
        let db = Db::open_in_memory().unwrap();
        let d = db.add_context_doc("", "# About me\nI'm Naman, I reply briefly and warmly.").unwrap();
        assert_eq!(d.title, "# About me");
        assert!(d.enabled && !d.pinned && d.tokens > 0);
        db.update_context_doc(&d.id, Some("About me"), None, Some(true), None).unwrap();
        db.add_context_doc("Off", "ignored").map(|o| db.update_context_doc(&o.id, None, Some(false), None, None)).unwrap().unwrap();
        let en = db.enabled_context().unwrap();
        assert_eq!(en.len(), 1);
        assert_eq!((en[0].0.as_str(), en[0].2), ("About me", true));
        db.delete_context_doc(&d.id).unwrap();
        assert!(db.enabled_context().unwrap().is_empty());
    }

    #[test]
    fn timestamps_are_millisecond_rfc3339() {
        let t = now();
        // e.g. 2026-11-05T14:50:12.345+05:30 — 3 fractional digits
        let frac = t.split('.').nth(1).unwrap();
        assert!(frac.len() >= 3 && frac[..3].chars().all(|c| c.is_ascii_digit()) && !frac[3..4].chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn assistant_log_oldest_first() {
        let db = Db::open_in_memory().unwrap();
        for (i, q) in ["first", "second"].iter().enumerate() {
            db.insert_assistant(&AssistantResponse {
                id: new_id(),
                query: q.to_string(),
                reply: "ok".into(),
                actions: vec![],
                results: vec![],
                created_at: format!("2026-11-05T10:0{i}:00+05:30"),
                mode: "quick".into(),
                sources: vec![],
            })
            .unwrap();
        }
        let l = db.list_assistant(10).unwrap();
        assert_eq!(l.iter().map(|r| r.query.as_str()).collect::<Vec<_>>(), vec!["first", "second"]);
    }

    #[test]
    fn analytics_math() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 5).unwrap();
        let y = today - Duration::days(1);
        let ds = vec![
            dict(&local_ts(today, 9), "Slack", 60, 30_000, Mode::Dictation),
            dict(&local_ts(today, 9), "Mail", 40, 30_000, Mode::Dictation),
            dict(&local_ts(y, 14), "Slack", 100, 60_000, Mode::Dictation),
            dict(&local_ts(y, 14), "Flo", 5, 3_000, Mode::Assistant),
        ];
        let a = compute_analytics(&ds, &[], &[], 7, 40, today);
        assert_eq!(a.total_words, 200);
        assert_eq!(a.total_dictations, 3);
        assert_eq!(a.avg_wpm, 100.0); // 200 words / 2 min
        assert_eq!(a.minutes_saved, 3.0); // 5 min typing - 2 min speaking
        assert_eq!(a.streak_days, 2);
        assert_eq!(a.daily.len(), 7);
        assert_eq!(a.daily[6].words, 100);
        assert_eq!(a.daily[5].assistant, 1);
        assert_eq!(a.top_apps[0], AppWords { app: "Slack".into(), words: 160 });
        assert_eq!(a.hourly[9], 100);
    }
}
