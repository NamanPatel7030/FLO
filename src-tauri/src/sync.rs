//! "Sync your data": end-to-end encrypted backup and multi-Mac sync.
//!
//! * A random 256-bit sync key is made on the first Mac and kept in the Keychain. The user sees it
//!   once as a recovery key (Crockford base32 with a checksum) and types it on their other Macs.
//! * Every row is sealed with ChaCha20-Poly1305 (ring) under that key, with a fresh random nonce and
//!   `kind\nid` as associated data, so the server (Supabase, via the website's /api/sync routes)
//!   only ever holds ciphertext it can't read or move between items.
//! * Rows are synced generically per table (stable primary keys, so no duplicates). A local
//!   `sync_state` table remembers the hash and rev of what was last synced: a changed hash is a
//!   local edit to push; a row that vanished is pushed as a tombstone. The server keeps the newest
//!   rev per item; pulls page through everything changed since a cursor. A local edit that hasn't
//!   been pushed yet wins over an older remote one (it goes up next with a newer rev).
//! * Runs on a timer and on "Sync now". Offline is fine: nothing is marked synced until the server
//!   accepted it, so the next run simply retries.
use crate::{account, egress::Purpose, secrets, settings, state::Shared};
use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, CHACHA20_POLY1305, NONCE_LEN};
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const KEY_SECRET: &str = "sync-key";
const CHECK_PLAIN: &[u8] = b"flo-sync-key-check-v1";
const CHECK_AAD: &[u8] = b"flo-sync-key-check";
/// items per push request (the server takes up to 500)
const BATCH: usize = 200;
const FIRST_RUN_AFTER: Duration = Duration::from_secs(30);
const RUN_EVERY: Duration = Duration::from_secs(180);

pub const CATEGORIES: &[&str] = &["todos", "notes", "settings", "history"];

/// A synced table: `kind` is the name on the wire (stable across app versions).
pub struct Table {
    pub kind: &'static str,
    pub table: &'static str,
    pub pk: &'static str,
    pub category: &'static str,
}

/// In apply order: projects first, so to-dos and notes can point at them.
pub const TABLES: &[Table] = &[
    Table { kind: "projects", table: "projects", pk: "id", category: "settings" },
    Table { kind: "dictionary", table: "dictionary", pk: "id", category: "settings" },
    Table { kind: "skills", table: "skills", pk: "id", category: "settings" },
    Table { kind: "context_docs", table: "context_docs", pk: "id", category: "settings" },
    Table { kind: "todos", table: "todos", pk: "id", category: "todos" },
    Table { kind: "notes", table: "notes", pk: "id", category: "notes" },
    Table { kind: "meeting_meta", table: "meeting_meta", pk: "note_id", category: "notes" },
    Table { kind: "vault_notes", table: "vault_notes", pk: "id", category: "notes" },
    Table { kind: "dictations", table: "dictations", pk: "id", category: "history" },
    Table { kind: "assistant_log", table: "assistant_log", pk: "id", category: "history" },
];

fn table(kind: &str) -> Option<(usize, &'static Table)> {
    TABLES.iter().enumerate().find(|(_, t)| t.kind == kind)
}

// ── crypto ──────────────────────────────────────────────────────────────────

#[derive(Clone, PartialEq, Eq)]
pub struct SyncKey([u8; 32]);

impl std::fmt::Debug for SyncKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SyncKey(…)")
    }
}

impl SyncKey {
    pub fn generate() -> Self {
        let mut k = [0u8; 32];
        rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut k);
        Self(k)
    }
    fn hex(&self) -> String {
        self.0.iter().map(|b| format!("{b:02x}")).collect()
    }
    fn from_hex(s: &str) -> Option<Self> {
        let s = s.trim();
        if s.len() != 64 {
            return None;
        }
        let mut k = [0u8; 32];
        for (i, b) in k.iter_mut().enumerate() {
            *b = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok()?;
        }
        Some(Self(k))
    }
    fn aead(&self) -> LessSafeKey {
        LessSafeKey::new(UnboundKey::new(&CHACHA20_POLY1305, &self.0).expect("32-byte key"))
    }
}

/// Seal `plain`; returns (nonce, ciphertext+tag), both base64.
pub fn seal(key: &SyncKey, aad: &[u8], plain: &[u8]) -> (String, String) {
    let mut n = [0u8; NONCE_LEN];
    rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut n);
    let mut buf = plain.to_vec();
    key.aead()
        .seal_in_place_append_tag(Nonce::assume_unique_for_key(n), Aad::from(aad), &mut buf)
        .expect("seal");
    (B64.encode(n), B64.encode(buf))
}

pub fn open(key: &SyncKey, aad: &[u8], nonce: &str, ct: &str) -> Result<Vec<u8>> {
    let n: [u8; NONCE_LEN] = B64.decode(nonce)?.try_into().map_err(|_| anyhow!("bad nonce"))?;
    let mut buf = B64.decode(ct)?;
    let plain = key
        .aead()
        .open_in_place(Nonce::assume_unique_for_key(n), Aad::from(aad), &mut buf)
        .map_err(|_| anyhow!("can't decrypt (wrong sync key?)"))?;
    Ok(plain.to_vec())
}

fn item_aad(kind: &str, id: &str) -> Vec<u8> {
    format!("{kind}\n{id}").into_bytes()
}

/// A known value sealed under the key: lets a second Mac check its recovery key. Reveals nothing.
pub fn make_check(key: &SyncKey) -> String {
    let (n, c) = seal(key, CHECK_AAD, CHECK_PLAIN);
    json!({ "v": 1, "n": n, "c": c }).to_string()
}

pub fn verify_check(key: &SyncKey, check: &str) -> bool {
    let Ok(v) = serde_json::from_str::<Value>(check) else { return false };
    match (v["n"].as_str(), v["c"].as_str()) {
        (Some(n), Some(c)) => open(key, CHECK_AAD, n, c).is_ok_and(|p| p == CHECK_PLAIN),
        _ => false,
    }
}

// ── recovery key: Crockford base32 of key + 2-byte checksum, in groups of five ──

const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

pub fn recovery_key(key: &SyncKey) -> String {
    let mut bytes = key.0.to_vec();
    bytes.extend_from_slice(&Sha256::digest(key.0)[..2]);
    let (mut acc, mut bits, mut out) = (0u32, 0u32, String::new());
    for b in bytes {
        acc = (acc << 8) | b as u32;
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(ALPHABET[((acc >> bits) & 31) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(ALPHABET[((acc << (5 - bits)) & 31) as usize] as char);
    }
    out.as_bytes().chunks(5).map(|c| std::str::from_utf8(c).unwrap()).collect::<Vec<_>>().join("-")
}

/// Parse a typed recovery key. Forgiving about case, spaces, dashes and look-alike letters.
pub fn parse_recovery_key(s: &str) -> Result<SyncKey> {
    let mut acc = 0u64;
    let mut bits = 0u32;
    let mut bytes = Vec::with_capacity(34);
    for ch in s.chars().filter(|c| c.is_ascii_alphanumeric()) {
        let c = match ch.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            c => c,
        };
        let v = ALPHABET.iter().position(|&a| a as char == c).ok_or_else(|| anyhow!("That recovery key has a letter that can't be in it ({ch})."))?;
        acc = (acc << 5) | v as u64;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            bytes.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    if bytes.len() != 34 {
        bail!("That recovery key is the wrong length. It has 55 letters and numbers.");
    }
    let key: [u8; 32] = bytes[..32].try_into().unwrap();
    if Sha256::digest(key)[..2] != bytes[32..34] {
        bail!("That recovery key has a typo. Check it and try again.");
    }
    Ok(SyncKey(key))
}

fn load_key() -> Option<SyncKey> {
    secrets::get_secret(KEY_SECRET).and_then(|h| SyncKey::from_hex(&h))
}

fn store_key(k: &SyncKey) -> Result<()> {
    secrets::set_secret(KEY_SECRET, &k.hex())
}

// ── local bookkeeping ───────────────────────────────────────────────────────

pub fn ensure_tables(c: &Connection) -> Result<()> {
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS sync_state(kind TEXT NOT NULL, item_id TEXT NOT NULL, hash TEXT NOT NULL,
           rev INTEGER NOT NULL, PRIMARY KEY(kind, item_id));
         CREATE TABLE IF NOT EXISTS sync_meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);",
    )?;
    Ok(())
}

fn meta_get(c: &Connection, k: &str) -> Option<String> {
    c.query_row("SELECT v FROM sync_meta WHERE k = ?1", [k], |r| r.get(0)).optional().ok().flatten()
}

fn meta_set(c: &Connection, k: &str, v: &str) -> Result<()> {
    c.execute("INSERT INTO sync_meta(k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v", params![k, v])?;
    Ok(())
}

fn hash(s: &str) -> String {
    Sha256::digest(s.as_bytes()).iter().take(16).map(|b| format!("{b:02x}")).collect()
}

fn columns(c: &Connection, table: &str) -> Result<Vec<String>> {
    let mut st = c.prepare(&format!("PRAGMA table_info({table})"))?;
    let cols = st.query_map([], |r| r.get::<_, String>(1))?.collect::<Result<Vec<_>, _>>()?;
    Ok(cols)
}

fn to_json(v: ValueRef) -> Value {
    match v {
        ValueRef::Null | ValueRef::Blob(_) => Value::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
    }
}

fn to_sql(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => n.as_i64().map(SqlValue::Integer).unwrap_or_else(|| SqlValue::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

/// Rows of a table as (primary key, JSON object), optionally just one row.
fn rows(c: &Connection, t: &Table, only: Option<&str>) -> Result<Vec<(String, Map<String, Value>)>> {
    let cols = columns(c, t.table)?;
    let sql = match only {
        Some(_) => format!("SELECT * FROM {} WHERE {} = ?1", t.table, t.pk),
        None => format!("SELECT * FROM {}", t.table),
    };
    let mut st = c.prepare(&sql)?;
    let map_row = |r: &rusqlite::Row| -> rusqlite::Result<(String, Map<String, Value>)> {
        let mut m = Map::new();
        let mut id = String::new();
        for (i, name) in cols.iter().enumerate() {
            let v = to_json(r.get_ref(i)?);
            if name == t.pk {
                id = v.as_str().map(String::from).unwrap_or_else(|| v.to_string());
            }
            m.insert(name.clone(), v);
        }
        Ok((id, m))
    };
    let out = match only {
        Some(id) => st.query_map([id], map_row)?.collect::<Result<Vec<_>, _>>()?,
        None => st.query_map([], map_row)?.collect::<Result<Vec<_>, _>>()?,
    };
    Ok(out)
}

fn state_of(c: &Connection, kind: &str, id: &str) -> Result<Option<(String, i64)>> {
    Ok(c.query_row("SELECT hash, rev FROM sync_state WHERE kind = ?1 AND item_id = ?2", params![kind, id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?)
}

pub fn mark_synced(c: &Connection, kind: &str, id: &str, hash: Option<&str>, rev: i64) -> Result<()> {
    match hash {
        Some(h) => c.execute(
            "INSERT INTO sync_state(kind, item_id, hash, rev) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(kind, item_id) DO UPDATE SET hash = excluded.hash, rev = excluded.rev",
            params![kind, id, h, rev],
        )?,
        None => c.execute("DELETE FROM sync_state WHERE kind = ?1 AND item_id = ?2", params![kind, id])?,
    };
    Ok(())
}

/// A local change to push. `json` None = tombstone.
#[derive(Debug, Clone)]
pub struct Change {
    pub kind: &'static str,
    pub id: String,
    pub json: Option<String>,
    pub hash: Option<String>,
}

/// Everything that changed locally since the last sync, for the given categories.
pub fn collect_changes(c: &Connection, categories: &[String]) -> Result<Vec<Change>> {
    let mut out = vec![];
    for t in TABLES.iter().filter(|t| categories.iter().any(|x| x == t.category)) {
        let mut known: HashMap<String, String> = {
            let mut st = c.prepare("SELECT item_id, hash FROM sync_state WHERE kind = ?1")?;
            let m = st.query_map([t.kind], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<HashMap<_, _>, _>>()?;
            m
        };
        for (id, m) in rows(c, t, None)? {
            let s = serde_json::to_string(&m)?;
            let h = hash(&s);
            if known.remove(&id).as_deref() != Some(h.as_str()) {
                out.push(Change { kind: t.kind, id, json: Some(s), hash: Some(h) });
            }
        }
        // synced before, gone now: deleted on this Mac
        for (id, _) in known {
            out.push(Change { kind: t.kind, id, json: None, hash: None });
        }
    }
    Ok(out)
}

fn upsert(c: &Connection, t: &Table, mut m: Map<String, Value>) -> Result<()> {
    let cols: Vec<String> = columns(c, t.table)?.into_iter().filter(|k| m.contains_key(k)).collect();
    if !cols.iter().any(|k| k == t.pk) {
        bail!("synced {} row has no {}", t.kind, t.pk);
    }
    let marks: Vec<String> = (1..=cols.len()).map(|i| format!("?{i}")).collect();
    let updates: Vec<String> = cols.iter().filter(|k| *k != t.pk).map(|k| format!("{k} = excluded.{k}")).collect();
    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({}) ON CONFLICT({}) DO {}",
        t.table,
        cols.join(", "),
        marks.join(", "),
        t.pk,
        if updates.is_empty() { "NOTHING".to_string() } else { format!("UPDATE SET {}", updates.join(", ")) }
    );
    let run = |m: &Map<String, Value>| -> rusqlite::Result<usize> {
        let vals: Vec<SqlValue> = cols.iter().map(|k| to_sql(&m[k])).collect();
        c.execute(&sql, rusqlite::params_from_iter(vals))
    };
    match run(&m) {
        Ok(_) => Ok(()),
        // points at a project this Mac doesn't have (yet): keep the row, drop the link
        Err(e) if e.to_string().contains("FOREIGN KEY") && m.get("project_id").is_some_and(|v| !v.is_null()) => {
            m.insert("project_id".into(), Value::Null);
            run(&m).map(|_| ()).map_err(Into::into)
        }
        Err(e) => Err(e.into()),
    }
}

/// Apply one item from the server. `row` None = deleted remotely. Returns true when applied.
pub fn apply_remote(c: &Connection, kind: &str, id: &str, rev: i64, row: Option<Map<String, Value>>) -> Result<bool> {
    let Some((_, t)) = table(kind) else { return Ok(false) };
    let state = state_of(c, kind, id)?;
    if state.as_ref().is_some_and(|(_, r)| *r >= rev) {
        return Ok(false); // already have this (or newer): often our own push coming back
    }
    let current = rows(c, t, Some(id))?.into_iter().next().map(|(_, m)| m);
    let dirty = match (&current, &state) {
        (Some(m), Some((h, _))) => &hash(&serde_json::to_string(m)?) != h,
        (None, Some(_)) => true, // deleted here, tombstone not pushed yet
        (Some(m), None) => row.as_ref() != Some(m), // never synced; identical rows aren't a conflict
        (None, None) => false,
    };
    if dirty {
        return Ok(false); // the local edit is newer: it goes up next run with a newer rev
    }
    match row {
        None => {
            c.execute(&format!("DELETE FROM {} WHERE {} = ?1", t.table, t.pk), [id])?;
            mark_synced(c, kind, id, None, rev)?;
        }
        Some(m) => {
            upsert(c, t, m)?;
            // hash what's actually stored, so the next scan doesn't see a change
            let stored = rows(c, t, Some(id))?.into_iter().next().map(|(_, m)| m).context("row vanished")?;
            mark_synced(c, kind, id, Some(&hash(&serde_json::to_string(&stored)?)), rev)?;
        }
    }
    Ok(true)
}

/// Forget what was synced (after deleting server data or switching keys).
pub fn reset_local(c: &Connection) -> Result<()> {
    c.execute_batch("DELETE FROM sync_state; DELETE FROM sync_meta;")?;
    Ok(())
}

// ── server ──────────────────────────────────────────────────────────────────

async fn api(st: &Shared, method: &str, path: &str, body: Option<Value>) -> Result<Value> {
    let token = account::session_token().ok_or_else(|| anyhow!("Sign in to Flo to use Sync."))?;
    account::allow_host(st);
    let url = format!("{}{path}", account::base(st));
    st.egress.check(&url, Purpose::Sync, false)?;
    let client = st.egress.client(Purpose::Sync, false);
    let mut req = match method {
        "GET" => client.get(&url),
        "DELETE" => client.delete(&url),
        _ => client.post(&url),
    };
    let mut sent = 0u64;
    if let Some(b) = body {
        let s = b.to_string();
        sent = s.len() as u64;
        req = req.header("content-type", "application/json").body(s);
    }
    let resp = req.bearer_auth(token).timeout(Duration::from_secs(60)).send().await.map_err(|e| {
        if e.is_connect() || e.is_timeout() {
            anyhow!("Can't reach your Flo account server. Sync will try again.")
        } else {
            anyhow!("Sync request failed: {e}")
        }
    })?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    st.egress.record(&url, Purpose::Sync, sent + text.len() as u64);
    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if !status.is_success() {
        let msg = v["error"].as_str().map(String::from).unwrap_or_else(|| format!("Sync failed ({status})."));
        bail!(msg);
    }
    Ok(v)
}

// ── a sync run ──────────────────────────────────────────────────────────────

static RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub pulled: u32,
    pub pushed: u32,
    pub skipped: u32,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[derive(Deserialize)]
struct PullItem {
    kind: String,
    id: String,
    rev: i64,
    #[serde(default)]
    nonce: String,
    #[serde(default)]
    ct: String,
    deleted: bool,
}

pub async fn run(st: &Shared) -> Result<SyncReport> {
    if RUNNING.swap(true, Ordering::SeqCst) {
        bail!("Sync is already running.");
    }
    let r = run_inner(st).await;
    RUNNING.store(false, Ordering::SeqCst);
    st.db.with_conn(|c| -> Result<()> {
        ensure_tables(c)?;
        match &r {
            Ok(rep) => {
                meta_set(c, "last_sync", &crate::db::now())?;
                meta_set(c, "last_error", "")?;
                meta_set(c, "last_report", &serde_json::to_string(rep)?)?;
            }
            Err(e) => meta_set(c, "last_error", &e.to_string())?,
        }
        Ok(())
    })?;
    if let Err(e) = &r {
        log::warn!("sync failed: {e}");
    }
    r
}

async fn run_inner(st: &Shared) -> Result<SyncReport> {
    let cfg = st.settings().sync;
    if !cfg.enabled {
        bail!("Sync is off.");
    }
    let key = load_key().ok_or_else(|| anyhow!("This Mac doesn't have your sync key. Enter your recovery key."))?;
    st.db.with_conn(ensure_tables)?;
    let enabled_kind = |k: &str| table(k).is_some_and(|(_, t)| cfg.categories.iter().any(|c| c == t.category));
    let mut rep = SyncReport::default();

    // 1. pull everything changed since the cursor
    let mut cursor: i64 = st.db.with_conn(|c| meta_get(c, "cursor")).and_then(|s| s.parse().ok()).unwrap_or(0);
    loop {
        let page = api(st, "GET", &format!("/api/sync/pull?since={cursor}"), None).await?;
        let items: Vec<PullItem> = serde_json::from_value(page["items"].clone()).unwrap_or_default();
        let next = page["cursor"].as_i64().unwrap_or(cursor);
        let mut decoded = vec![];
        for it in items {
            if !enabled_kind(&it.kind) {
                continue;
            }
            let row = if it.deleted {
                None
            } else {
                match open(&key, &item_aad(&it.kind, &it.id), &it.nonce, &it.ct).and_then(|p| Ok(serde_json::from_slice::<Map<String, Value>>(&p)?)) {
                    Ok(m) => Some(m),
                    Err(_) => {
                        rep.skipped += 1;
                        continue;
                    }
                }
            };
            decoded.push((it.kind, it.id, it.rev, row));
        }
        decoded.sort_by_key(|(k, ..)| table(k).map(|(i, _)| i).unwrap_or(usize::MAX));
        st.db.with_conn(|c| -> Result<()> {
            for (kind, id, rev, row) in decoded {
                match apply_remote(c, &kind, &id, rev, row) {
                    Ok(true) => rep.pulled += 1,
                    Ok(false) => {}
                    Err(e) => {
                        log::warn!("sync: couldn't apply {kind}: {e}");
                        rep.skipped += 1;
                    }
                }
            }
            meta_set(c, "cursor", &next.to_string())
        })?;
        cursor = next;
        if !page["more"].as_bool().unwrap_or(false) {
            break;
        }
    }

    // 2. push local changes in batches; each batch is marked synced only once the server took it
    let changes = st.db.with_conn(|c| collect_changes(c, &cfg.categories))?;
    for batch in changes.chunks(BATCH) {
        let rev = now_ms();
        let items: Vec<Value> = batch
            .iter()
            .map(|ch| match &ch.json {
                Some(j) => {
                    let (n, c) = seal(&key, &item_aad(ch.kind, &ch.id), j.as_bytes());
                    json!({ "kind": ch.kind, "id": ch.id, "rev": rev, "nonce": n, "ct": c, "deleted": false })
                }
                None => json!({ "kind": ch.kind, "id": ch.id, "rev": rev, "nonce": "", "ct": "", "deleted": true }),
            })
            .collect();
        api(st, "POST", "/api/sync/push", Some(json!({ "items": items }))).await?;
        st.db.with_conn(|c| -> Result<()> {
            for ch in batch {
                mark_synced(c, ch.kind, &ch.id, ch.hash.as_deref(), rev)?;
            }
            Ok(())
        })?;
        rep.pushed += batch.len() as u32;
    }
    Ok(rep)
}

/// Run now in the background (after turning Sync on, or joining).
pub fn kick(st: &Shared) {
    let st = st.clone();
    tauri::async_runtime::spawn(async move {
        let _ = run(&st).await;
    });
}

/// Sync on a timer while it's on and the account is signed in.
pub fn spawn(st: Shared) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_RUN_AFTER).await;
        loop {
            if st.settings().sync.enabled && account::session_token().is_some() && load_key().is_some() {
                let _ = run(&st).await;
            }
            tokio::time::sleep(RUN_EVERY).await;
        }
    });
}

// ── commands ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub enabled: bool,
    pub categories: Vec<String>,
    pub has_key: bool,
    pub running: bool,
    pub last_sync: Option<String>,
    pub last_error: Option<String>,
    /// rows this Mac has in sync
    pub synced_items: u64,
}

pub fn status(st: &Shared) -> SyncStatus {
    let cfg = st.settings().sync;
    let (last_sync, last_error, synced_items) = st
        .db
        .with_conn(|c| -> Result<_> {
            ensure_tables(c)?;
            let n: i64 = c.query_row("SELECT count(*) FROM sync_state", [], |r| r.get(0))?;
            Ok((meta_get(c, "last_sync"), meta_get(c, "last_error").filter(|s| !s.is_empty()), n as u64))
        })
        .unwrap_or((None, None, 0));
    SyncStatus { enabled: cfg.enabled, categories: cfg.categories, has_key: load_key().is_some(), running: RUNNING.load(Ordering::SeqCst), last_sync, last_error, synced_items }
}

fn update(st: &Shared, f: impl FnOnce(&mut crate::model::SyncSettings)) -> Result<()> {
    let mut s = st.settings();
    f(&mut s.sync);
    settings::save(&st.data_dir, &s)?;
    *st.settings.write() = s;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnableResult {
    pub enabled: bool,
    /// shown once, the first time: the user must save it
    pub recovery_key: Option<String>,
    /// this account already syncs from another Mac: ask for its recovery key
    pub needs_recovery_key: bool,
}

pub async fn enable(st: &Shared) -> Result<EnableResult> {
    let server = api(st, "POST", "/api/sync/key", Some(json!({}))).await?;
    let local = load_key();
    let need = EnableResult { enabled: false, recovery_key: None, needs_recovery_key: true };
    let shown = match (server["check"].as_str(), local) {
        (Some(check), Some(k)) => {
            if !verify_check(&k, check) {
                return Ok(need);
            }
            None
        }
        (Some(_), None) => return Ok(need),
        (None, local) => {
            let k = local.unwrap_or_else(SyncKey::generate);
            store_key(&k)?;
            let mine = make_check(&k);
            let r = api(st, "POST", "/api/sync/key", Some(json!({ "check": mine }))).await?;
            // another Mac registered first, a moment ago
            if r["created"] != json!(true) && !r["check"].as_str().is_some_and(|c| verify_check(&k, c)) {
                return Ok(need);
            }
            Some(recovery_key(&k))
        }
    };
    update(st, |s| s.enabled = true)?;
    kick(st);
    Ok(EnableResult { enabled: true, recovery_key: shown, needs_recovery_key: false })
}

/// Set this Mac up with the recovery key from the first Mac.
pub async fn join(st: &Shared, recovery: &str) -> Result<()> {
    let key = parse_recovery_key(recovery)?;
    let server = api(st, "POST", "/api/sync/key", Some(json!({}))).await?;
    let check = server["check"].as_str().ok_or_else(|| anyhow!("Nothing is synced for this account yet. Turn on Sync on your first Mac."))?;
    if !verify_check(&key, check) {
        bail!("That recovery key doesn't match this account.");
    }
    store_key(&key)?;
    st.db.with_conn(|c| -> Result<()> {
        ensure_tables(c)?;
        reset_local(c)
    })?;
    update(st, |s| s.enabled = true)?;
    kick(st);
    Ok(())
}

pub fn disable(st: &Shared) -> Result<()> {
    update(st, |s| s.enabled = false)
}

pub fn set_categories(st: &Shared, categories: Vec<String>) -> Result<()> {
    let mut cats: Vec<String> = CATEGORIES.iter().filter(|c| categories.iter().any(|x| x == *c)).map(|c| c.to_string()).collect();
    cats.dedup();
    let before = st.settings().sync.categories;
    // a newly chosen category needs everything from the start
    if cats.iter().any(|c| !before.contains(c)) {
        st.db.with_conn(|c| -> Result<()> {
            ensure_tables(c)?;
            meta_set(c, "cursor", "0")
        })?;
    }
    update(st, |s| s.categories = cats)
}

pub fn show_recovery_key() -> Result<String> {
    load_key().map(|k| recovery_key(&k)).ok_or_else(|| anyhow!("This Mac has no sync key yet."))
}

/// Delete everything synced for this account on the server, and this Mac's key.
pub async fn delete_remote(st: &Shared) -> Result<()> {
    api(st, "DELETE", "/api/sync", None).await?;
    let _ = secrets::delete_secret(KEY_SECRET);
    st.db.with_conn(|c| -> Result<()> {
        ensure_tables(c)?;
        reset_local(c)
    })?;
    update(st, |s| s.enabled = false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn db() -> Db {
        let d = Db::open_in_memory().unwrap();
        d.with_conn(|c| ensure_tables(c)).unwrap();
        d
    }
    fn all() -> Vec<String> {
        CATEGORIES.iter().map(|s| s.to_string()).collect()
    }
    fn todo(c: &Connection, id: &str, title: &str, project: Option<&str>) {
        c.execute(
            "INSERT INTO todos(id, title, source, status, project_id, created_at) VALUES (?1, ?2, 'manual', 'open', ?3, '2026-11-09T10:00:00.000+00:00')",
            params![id, title, project],
        )
        .unwrap();
    }
    fn mark_all(c: &Connection, ch: &[Change], rev: i64) {
        for x in ch {
            mark_synced(c, x.kind, &x.id, x.hash.as_deref(), rev).unwrap();
        }
    }

    #[test]
    fn seal_open_roundtrip_and_tamper() {
        let k = SyncKey::generate();
        let (n, c) = seal(&k, b"todos\nt1", b"hello");
        assert_eq!(open(&k, b"todos\nt1", &n, &c).unwrap(), b"hello");
        // wrong key
        assert!(open(&SyncKey::generate(), b"todos\nt1", &n, &c).is_err());
        // moved to another item
        assert!(open(&k, b"todos\nt2", &n, &c).is_err());
        // two seals of the same text differ (random nonce)
        let (n2, c2) = seal(&k, b"todos\nt1", b"hello");
        assert!(n != n2 && c != c2);
    }

    #[test]
    fn key_check_verifies_only_the_right_key() {
        let k = SyncKey::generate();
        let check = make_check(&k);
        assert!(verify_check(&k, &check));
        assert!(!verify_check(&SyncKey::generate(), &check));
        assert!(!verify_check(&k, "not json"));
    }

    #[test]
    fn recovery_key_roundtrip_typos_and_lookalikes() {
        let k = SyncKey::generate();
        let r = recovery_key(&k);
        assert_eq!(r.split('-').count(), 11);
        assert_eq!(parse_recovery_key(&r).unwrap(), k);
        // lower case, spaces instead of dashes
        assert_eq!(parse_recovery_key(&r.to_lowercase().replace('-', " ")).unwrap(), k);
        // O for 0 and l for 1 are accepted
        let looks = r.replace('0', "O").replace('1', "l");
        assert_eq!(parse_recovery_key(&looks).unwrap(), k);
        // one wrong character is caught by the checksum
        let mut chars: Vec<char> = r.chars().collect();
        chars[3] = if chars[3] == 'A' { 'B' } else { 'A' };
        assert!(parse_recovery_key(&chars.iter().collect::<String>()).is_err());
        assert!(parse_recovery_key("ABC").is_err());
        assert_eq!(SyncKey::from_hex(&k.hex()).unwrap(), k);
    }

    #[test]
    fn collect_finds_new_changed_and_deleted_rows() {
        let d = db();
        d.with_conn(|c| {
            todo(c, "t1", "Send the deck", None);
            todo(c, "t2", "Book flights", None);
            let first = collect_changes(c, &all()).unwrap();
            assert_eq!(first.iter().filter(|x| x.kind == "todos").count(), 2);
            mark_all(c, &first, 1);
            assert!(collect_changes(c, &all()).unwrap().is_empty(), "nothing changed");
            c.execute("UPDATE todos SET title = 'Send the deck today' WHERE id = 't1'", []).unwrap();
            c.execute("DELETE FROM todos WHERE id = 't2'", []).unwrap();
            let ch = collect_changes(c, &all()).unwrap();
            assert_eq!(ch.len(), 2);
            assert!(ch.iter().any(|x| x.id == "t1" && x.json.as_deref().unwrap().contains("today")));
            assert!(ch.iter().any(|x| x.id == "t2" && x.json.is_none()), "tombstone for the deleted row");
            // a category that's off isn't collected
            assert!(collect_changes(c, &["history".into()]).unwrap().is_empty());
        });
    }

    #[test]
    fn remote_rows_apply_once_and_tombstones_delete() {
        let mac_a = db();
        let mac_b = db();
        // Mac A makes a project and a to-do in it, and "pushes"
        let pushed = mac_a.with_conn(|c| {
            c.execute("INSERT INTO projects(id, name, status, color, updated_at) VALUES ('p1', 'Acme', 'active', '#fff', '2026-11-09')", []).unwrap();
            todo(c, "t1", "Send Acme the copy", Some("p1"));
            let ch = collect_changes(c, &all()).unwrap();
            mark_all(c, &ch, 5);
            ch
        });
        // Mac B pulls (projects first, like run() sorts them)
        mac_b.with_conn(|c| {
            let mut items: Vec<_> = pushed.iter().map(|x| (x.kind, x.id.clone(), serde_json::from_str::<Map<String, Value>>(x.json.as_ref().unwrap()).unwrap())).collect();
            items.sort_by_key(|(k, ..)| table(k).unwrap().0);
            for (k, id, m) in items {
                assert!(apply_remote(c, k, &id, 5, Some(m)).unwrap());
            }
            let pid: Option<String> = c.query_row("SELECT project_id FROM todos WHERE id = 't1'", [], |r| r.get(0)).unwrap();
            assert_eq!(pid.as_deref(), Some("p1"));
            // nothing to push back: what was applied is recorded as synced
            assert!(collect_changes(c, &all()).unwrap().is_empty());
            // the same item again (our own push echoing back) is ignored
            let m = rows(c, table("todos").unwrap().1, Some("t1")).unwrap().remove(0).1;
            assert!(!apply_remote(c, "todos", "t1", 5, Some(m)).unwrap());
            // a newer tombstone deletes it
            assert!(apply_remote(c, "todos", "t1", 9, None).unwrap());
            let n: i64 = c.query_row("SELECT count(*) FROM todos", [], |r| r.get(0)).unwrap();
            assert_eq!(n, 0);
            assert!(collect_changes(c, &all()).unwrap().iter().all(|x| x.kind != "todos"));
        });
    }

    #[test]
    fn unpushed_local_edit_wins_over_older_remote() {
        let d = db();
        d.with_conn(|c| {
            todo(c, "t1", "v1", None);
            let ch = collect_changes(c, &all()).unwrap();
            mark_all(c, &ch, 5);
            c.execute("UPDATE todos SET title = 'local edit' WHERE id = 't1'", []).unwrap();
            let mut remote = rows(c, table("todos").unwrap().1, Some("t1")).unwrap().remove(0).1;
            remote.insert("title".into(), json!("remote edit"));
            assert!(!apply_remote(c, "todos", "t1", 7, Some(remote)).unwrap(), "local edit is kept");
            let t: String = c.query_row("SELECT title FROM todos WHERE id = 't1'", [], |r| r.get(0)).unwrap();
            assert_eq!(t, "local edit");
            assert_eq!(collect_changes(c, &all()).unwrap().len(), 1, "and it goes up next");
        });
    }

    #[test]
    fn missing_project_keeps_the_todo_without_the_link() {
        let d = db();
        d.with_conn(|c| {
            let mut m = Map::new();
            for (k, v) in [("id", json!("t9")), ("title", json!("Orphan")), ("source", json!("manual")), ("status", json!("open")), ("project_id", json!("nope")), ("created_at", json!("2026-11-09")), ("unknown_future_column", json!(1))] {
                m.insert(k.into(), v);
            }
            assert!(apply_remote(c, "todos", "t9", 3, Some(m)).unwrap());
            let pid: Option<String> = c.query_row("SELECT project_id FROM todos WHERE id = 't9'", [], |r| r.get(0)).unwrap();
            assert_eq!(pid, None);
        });
    }

    #[test]
    fn every_synced_table_exists_with_its_key() {
        let d = db();
        d.with_conn(|c| {
            for t in TABLES {
                let cols = columns(c, t.table).unwrap();
                assert!(cols.iter().any(|k| k == t.pk), "{} has {}", t.table, t.pk);
                assert!(CATEGORIES.contains(&t.category));
            }
        });
    }
}
