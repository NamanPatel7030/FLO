//! Small in-memory caches: a TTL + least-recently-used map, plus the app's few shared caches
//! (assistant answers, MCP tool lists, the account check) and an on-disk artwork cache.
//! Everything here only ever *saves* network requests; nothing is fetched to fill a cache.
use std::collections::HashMap;
use std::hash::Hash;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use sha2::{Digest, Sha256};

/// A map whose entries expire `ttl` after they were written and which keeps at most `cap`
/// entries, dropping the least recently used one first.
pub struct TtlCache<K, V> {
    ttl: Duration,
    cap: usize,
    /// key → (written, last used, value)
    map: HashMap<K, (Instant, Instant, V)>,
}

impl<K: Eq + Hash + Clone, V: Clone> TtlCache<K, V> {
    pub fn new(ttl: Duration, cap: usize) -> Self {
        Self { ttl, cap: cap.max(1), map: HashMap::new() }
    }

    pub fn get(&mut self, k: &K) -> Option<V> {
        self.get_at(k, Instant::now())
    }

    pub fn get_at(&mut self, k: &K, now: Instant) -> Option<V> {
        let fresh = match self.map.get(k) {
            Some((written, _, _)) => now.saturating_duration_since(*written) < self.ttl,
            None => return None,
        };
        if !fresh {
            self.map.remove(k);
            return None;
        }
        let e = self.map.get_mut(k)?;
        e.1 = now;
        Some(e.2.clone())
    }

    pub fn insert(&mut self, k: K, v: V) {
        self.insert_at(k, v, Instant::now())
    }

    pub fn insert_at(&mut self, k: K, v: V, now: Instant) {
        let ttl = self.ttl;
        self.map.retain(|_, (w, _, _)| now.saturating_duration_since(*w) < ttl);
        if !self.map.contains_key(&k) && self.map.len() >= self.cap {
            if let Some(oldest) = self.map.iter().min_by_key(|(_, (_, used, _))| *used).map(|(k, _)| k.clone()) {
                self.map.remove(&oldest);
            }
        }
        self.map.insert(k, (now, now, v));
    }

    pub fn remove(&mut self, k: &K) {
        self.map.remove(k);
    }

    pub fn clear(&mut self) {
        self.map.clear();
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }
}

pub fn hash_parts(parts: &[&str]) -> String {
    let mut h = Sha256::new();
    for p in parts {
        h.update((p.len() as u64).to_le_bytes());
        h.update(p.as_bytes());
    }
    h.finalize().iter().take(16).map(|b| format!("{b:02x}")).collect()
}

// ── assistant answers ───────────────────────────────────────────────────────

/// Raw model output for identical requests (same model, prompt, context and screen) for 10 minutes.
pub static ANSWERS: LazyLock<Mutex<TtlCache<String, (String, Vec<crate::model::Source>)>>> =
    LazyLock::new(|| Mutex::new(TtlCache::new(Duration::from_secs(10 * 60), 64)));

/// Words that make an answer depend on the moment it is asked; those requests are never reused.
pub fn time_sensitive(query: &str) -> bool {
    const WORDS: &[&str] = &[
        "now", "today", "tonight", "tomorrow", "yesterday", "latest", "current", "currently", "time", "date", "weather", "news",
        "remind", "reminder", "schedule", "this week", "next week", "aaj", "abhi", "kal",
    ];
    let q = format!(" {} ", query.to_lowercase().replace(|c: char| !c.is_alphanumeric() && c != ' ', " "));
    WORDS.iter().any(|w| q.contains(&format!(" {w} ")))
}

// ── MCP tool lists ──────────────────────────────────────────────────────────

/// Each server's tools for 10 minutes, keyed by its id and configuration (an edit changes the key).
pub static MCP_TOOLS: LazyLock<Mutex<TtlCache<String, Vec<crate::model::McpTool>>>> =
    LazyLock::new(|| Mutex::new(TtlCache::new(Duration::from_secs(10 * 60), 32)));

pub fn mcp_key(c: &crate::model::Connection) -> String {
    let env = c.env.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("\n");
    hash_parts(&[&c.id, &c.transport, &c.command, &c.args.join("\u{1}"), &c.url, &env])
}

// ── account check ───────────────────────────────────────────────────────────

/// The last good `/api/app/me` answer, reused for 5 minutes (keyed by the token's hash).
pub static ACCOUNT: LazyLock<Mutex<TtlCache<String, Option<crate::model::AccountUser>>>> =
    LazyLock::new(|| Mutex::new(TtlCache::new(Duration::from_secs(5 * 60), 2)));

/// Forget everything personal (sign-out, "Clear cached answers").
pub fn clear_personal() {
    ANSWERS.lock().clear();
    ACCOUNT.lock().clear();
}

// ── artwork on disk ─────────────────────────────────────────────────────────

const ART_MAX_FILES: usize = 300;

pub fn artwork_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("cache").join("artwork")
}

fn artwork_file(data_dir: &Path, url: &str) -> PathBuf {
    artwork_dir(data_dir).join(format!("{}.txt", hash_parts(&[url])))
}

/// A thumbnail fetched before (stored as its data URL).
pub fn artwork_get(data_dir: &Path, url: &str) -> Option<String> {
    let p = artwork_file(data_dir, url);
    let s = std::fs::read_to_string(&p).ok()?;
    // touch, so pruning keeps recently shown art
    let _ = std::fs::OpenOptions::new().append(true).open(&p);
    s.starts_with("data:image/").then_some(s)
}

pub fn artwork_put(data_dir: &Path, url: &str, data_url: &str) {
    let dir = artwork_dir(data_dir);
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let _ = std::fs::write(artwork_file(data_dir, url), data_url);
    prune(&dir, ART_MAX_FILES);
}

/// Keep the newest `max` files in `dir`.
pub fn prune(dir: &Path, max: usize) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = rd
        .flatten()
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    if files.len() <= max {
        return;
    }
    files.sort_by_key(|(t, _)| std::cmp::Reverse(*t));
    for (_, p) in files.into_iter().skip(max) {
        let _ = std::fs::remove_file(p);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entries_expire_after_the_ttl() {
        let t0 = Instant::now();
        let mut c = TtlCache::new(Duration::from_secs(10), 4);
        c.insert_at("a", 1, t0);
        assert_eq!(c.get_at(&"a", t0 + Duration::from_secs(9)), Some(1));
        assert_eq!(c.get_at(&"a", t0 + Duration::from_secs(10)), None);
        assert_eq!(c.len(), 0);
    }

    #[test]
    fn evicts_the_least_recently_used() {
        let t0 = Instant::now();
        let s = Duration::from_secs(1);
        let mut c = TtlCache::new(Duration::from_secs(60), 2);
        c.insert_at("a", 1, t0);
        c.insert_at("b", 2, t0 + s);
        c.get_at(&"a", t0 + 2 * s); // a is now the most recently used
        c.insert_at("c", 3, t0 + 3 * s);
        assert_eq!(c.get_at(&"b", t0 + 4 * s), None);
        assert_eq!(c.get_at(&"a", t0 + 4 * s), Some(1));
        assert_eq!(c.get_at(&"c", t0 + 4 * s), Some(3));
    }

    #[test]
    fn overwriting_a_key_does_not_evict_another() {
        let t0 = Instant::now();
        let mut c = TtlCache::new(Duration::from_secs(60), 2);
        c.insert_at("a", 1, t0);
        c.insert_at("b", 2, t0);
        c.insert_at("a", 9, t0);
        assert_eq!(c.len(), 2);
        assert_eq!(c.get_at(&"a", t0), Some(9));
    }

    #[test]
    fn spots_time_sensitive_questions() {
        assert!(time_sensitive("what's on my plate today?"));
        assert!(time_sensitive("What time is it"));
        assert!(time_sensitive("aaj ka plan"));
        assert!(!time_sensitive("draft a thank you note to the Acme team"));
        assert!(!time_sensitive("summarise this thread"));
    }

    #[test]
    fn hash_parts_separates_fields() {
        assert_ne!(hash_parts(&["ab", "c"]), hash_parts(&["a", "bc"]));
        assert_eq!(hash_parts(&["x"]), hash_parts(&["x"]));
    }

    #[test]
    fn artwork_round_trip_and_prune() {
        let dir = std::env::temp_dir().join(format!("flo-art-{}", std::process::id()));
        artwork_put(&dir, "https://i.ytimg.com/a.jpg", "data:image/jpeg;base64,AAA");
        assert_eq!(artwork_get(&dir, "https://i.ytimg.com/a.jpg").as_deref(), Some("data:image/jpeg;base64,AAA"));
        assert!(artwork_get(&dir, "https://i.ytimg.com/other.jpg").is_none());
        for i in 0..5 {
            std::fs::write(artwork_dir(&dir).join(format!("{i}.txt")), "data:image/png;base64,x").unwrap();
        }
        prune(&artwork_dir(&dir), 3);
        assert_eq!(std::fs::read_dir(artwork_dir(&dir)).unwrap().count(), 3);
        let _ = std::fs::remove_dir_all(dir);
    }
}
