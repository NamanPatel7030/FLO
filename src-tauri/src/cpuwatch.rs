//! Linux: once a minute, note which of Flo's own threads used a lot of CPU and write it to the log
//! (`~/.local/share/Flo/logs/flo.log`), so a report of "Flo uses 60 % CPU" comes with the thread
//! that did it (main = GTK / web view drawing, tokio-rt-worker = background tasks, flo-* = named
//! loops). Costs one read of /proc/self/task per minute.
use std::collections::HashMap;

/// A thread over this share of one core across the last minute gets logged.
pub const HOT_PCT: f64 = 20.0;

/// `/proc/<pid>/task/<tid>/stat` → (name, user + system ticks). The name sits in parentheses
/// and may itself contain spaces or ')'.
pub fn parse_stat(stat: &str) -> Option<(String, u64)> {
    let open = stat.find('(')?;
    let close = stat.rfind(')')?;
    let name = stat.get(open + 1..close)?.to_string();
    let rest: Vec<&str> = stat.get(close + 1..)?.split_whitespace().collect();
    // after the name: state(0) ppid(1) … utime(11) stime(12)
    let utime: u64 = rest.get(11)?.parse().ok()?;
    let stime: u64 = rest.get(12)?.parse().ok()?;
    Some((name, utime + stime))
}

/// Threads above `HOT_PCT` between two samples (tid → (name, ticks)), busiest first, as
/// (name, percent of one core).
pub fn hot_threads(before: &HashMap<u32, (String, u64)>, after: &HashMap<u32, (String, u64)>, secs: f64, ticks_per_sec: f64) -> Vec<(String, f64)> {
    let mut hot: Vec<(String, f64)> = after
        .iter()
        .filter_map(|(tid, (name, t))| {
            let t0 = before.get(tid).map(|b| b.1).unwrap_or(*t);
            let pct = (t.saturating_sub(t0)) as f64 / ticks_per_sec / secs * 100.0;
            (pct >= HOT_PCT).then(|| (format!("{name} ({tid})"), pct))
        })
        .collect();
    hot.sort_by(|a, b| b.1.total_cmp(&a.1));
    hot
}

#[cfg(target_os = "linux")]
fn sample() -> HashMap<u32, (String, u64)> {
    let mut out = HashMap::new();
    let Ok(dir) = std::fs::read_dir("/proc/self/task") else { return out };
    for e in dir.flatten() {
        let Some(tid) = e.file_name().to_str().and_then(|s| s.parse::<u32>().ok()) else { continue };
        if let Some(v) = std::fs::read_to_string(e.path().join("stat")).ok().as_deref().and_then(parse_stat) {
            out.insert(tid, v);
        }
    }
    out
}

#[cfg(target_os = "linux")]
pub fn spawn() {
    const EVERY: u64 = 60;
    std::thread::Builder::new()
        .name("flo-cpuwatch".into())
        .spawn(|| {
            // USER_HZ is 100 on every Linux Flo ships for
            let hz = 100.0;
            let mut before = sample();
            loop {
                std::thread::sleep(std::time::Duration::from_secs(EVERY));
                let after = sample();
                let hot = hot_threads(&before, &after, EVERY as f64, hz);
                if !hot.is_empty() {
                    let list: Vec<String> = hot.iter().map(|(n, p)| format!("{n} {p:.0}%")).collect();
                    log::warn!("cpu: busy threads over the last minute: {}", list.join(", "));
                }
                before = after;
            }
        })
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_thread_stat_lines() {
        let s = "1234 (tokio-rt-worker) S 1 1234 1234 0 -1 4194560 100 0 0 0 250 50 0 0 20 0 30 0";
        assert_eq!(parse_stat(s), Some(("tokio-rt-worker".into(), 300)));
        // names with spaces / parentheses
        let s = "77 (Web (Content) x) R 1 77 77 0 -1 0 0 0 0 0 7 3 0 0";
        assert_eq!(parse_stat(s), Some(("Web (Content) x".into(), 10)));
        assert_eq!(parse_stat("nonsense"), None);
    }

    #[test]
    fn flags_only_threads_that_were_busy() {
        let before: HashMap<u32, (String, u64)> = [(1, ("flo-flow".into(), 1000)), (2, ("tokio-rt-worker".into(), 50)), (3, ("flo-evdev-event3".into(), 10))].into();
        // one minute at 100 ticks/s: 6000 ticks = 100 % of a core
        let after: HashMap<u32, (String, u64)> = [(1, ("flo-flow".into(), 1000 + 3900)), (2, ("tokio-rt-worker".into(), 50 + 600)), (3, ("flo-evdev-event3".into(), 12)), (4, ("new".into(), 5))].into();
        let hot = hot_threads(&before, &after, 60.0, 100.0);
        assert_eq!(hot.len(), 1);
        assert_eq!(hot[0].0, "flo-flow (1)");
        assert!((hot[0].1 - 65.0).abs() < 0.01);
    }
}
