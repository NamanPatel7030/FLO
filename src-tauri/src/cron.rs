//! A small 5-field cron parser for scheduled skills: `minute hour day-of-month month day-of-week`.
//! Supports `*`, lists (`1,15`), ranges (`1-5`), steps (`*/15`, `9-17/2`, `5/10`), month and
//! weekday names (`JAN`, `mon-fri`), `7` as Sunday, and the usual macros (`@hourly`, `@daily`…).
//! Day-of-month and day-of-week follow classic (Vixie) cron: when both are restricted, a day
//! matches if EITHER does. Times are wall-clock in whatever time zone the caller passes (local).
use anyhow::{anyhow, bail, Result};
use chrono::{DateTime, Datelike, Duration, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Timelike};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cron {
    minutes: u64,
    hours: u32,
    dom: u32,
    months: u16,
    dow: u8,
    dom_any: bool,
    dow_any: bool,
}

const MONTHS: [&str; 12] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS: [&str; 7] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

fn value(tok: &str, names: &[&str], base: u32) -> Result<u32> {
    let t = tok.trim().to_ascii_lowercase();
    if let Ok(n) = t.parse::<u32>() {
        return Ok(n);
    }
    names
        .iter()
        .position(|n| t.starts_with(n) && t.len() >= 3)
        .map(|i| i as u32 + base)
        .ok_or_else(|| anyhow!("“{tok}” isn't a number"))
}

/// Parse one field into a bitmask of allowed values in `lo..=hi`.
fn field(src: &str, lo: u32, hi: u32, names: &[&str], what: &str) -> Result<u64> {
    let mut mask = 0u64;
    for item in src.split(',') {
        let item = item.trim();
        if item.is_empty() {
            bail!("{what}: empty list item");
        }
        let (range, step) = match item.split_once('/') {
            Some((r, s)) => {
                let s: u32 = s.trim().parse().map_err(|_| anyhow!("{what}: step “{s}” isn't a number"))?;
                if s == 0 {
                    bail!("{what}: step can't be 0");
                }
                (r, s)
            }
            None => (item, 1),
        };
        let base = if names.len() == 12 { 1 } else { 0 };
        let (a, b) = if range == "*" {
            (lo, hi)
        } else if let Some((x, y)) = range.split_once('-') {
            (value(x, names, base)?, value(y, names, base)?)
        } else {
            let v = value(range, names, base)?;
            // "5/10" means from 5 to the end, every 10
            (v, if step > 1 { hi } else { v })
        };
        // day-of-week: 7 is Sunday too
        let is_dow = what == "day of week";
        let fix = |v: u32| if is_dow && v == 7 { 0 } else { v };
        let max = if is_dow { 7 } else { hi };
        if a < lo || a > max || b < lo || b > max {
            bail!("{what} must be between {lo} and {hi}");
        }
        if a > b {
            bail!("{what}: range {a}-{b} runs backwards");
        }
        let mut v = a;
        while v <= b {
            mask |= 1 << fix(v);
            v += step;
        }
    }
    Ok(mask)
}

impl Cron {
    pub fn parse(expr: &str) -> Result<Cron> {
        let e = expr.trim();
        let e = match e.to_ascii_lowercase().as_str() {
            "@hourly" => "0 * * * *",
            "@daily" | "@midnight" => "0 0 * * *",
            "@weekly" => "0 0 * * 0",
            "@monthly" => "0 0 1 * *",
            "@yearly" | "@annually" => "0 0 1 1 *",
            _ => e,
        };
        let parts: Vec<&str> = e.split_whitespace().collect();
        if parts.len() != 5 {
            bail!("A schedule needs 5 parts: minute hour day month weekday (e.g. “0 9 * * 1-5”)");
        }
        Ok(Cron {
            minutes: field(parts[0], 0, 59, &[], "minute")?,
            hours: field(parts[1], 0, 23, &[], "hour")? as u32,
            dom: field(parts[2], 1, 31, &[], "day of month")? as u32,
            months: field(parts[3], 1, 12, &MONTHS, "month")? as u16,
            dow: field(parts[4], 0, 6, &DAYS, "day of week")? as u8,
            dom_any: parts[2].starts_with('*'),
            dow_any: parts[4].starts_with('*'),
        })
    }

    fn day_ok(&self, d: NaiveDate) -> bool {
        let dom = self.dom & (1 << d.day()) != 0;
        let dow = self.dow & (1 << d.weekday().num_days_from_sunday()) != 0;
        match (self.dom_any, self.dow_any) {
            (true, true) => true,
            (true, false) => dow,
            (false, true) => dom,
            (false, false) => dom || dow,
        }
    }

    /// Does this wall-clock minute match?
    pub fn matches(&self, t: &NaiveDateTime) -> bool {
        self.minutes & (1 << t.minute()) != 0 && self.hours & (1 << t.hour()) != 0 && self.months & (1 << t.month()) != 0 && self.day_ok(t.date())
    }

    /// The first matching minute strictly after `after`, in `after`'s time zone. Skips wall-clock
    /// times that don't exist (DST gaps); for repeated ones (DST overlap) takes the first.
    /// (The UI computes "next run" itself in src/lib/cron.ts; this keeps the two in step via tests.)
    #[allow(dead_code)]
    pub fn next_after<Tz: TimeZone>(&self, after: &DateTime<Tz>) -> Option<DateTime<Tz>> {
        let tz = after.timezone();
        let l = after.naive_local();
        let mut t = l.date().and_hms_opt(l.hour(), l.minute(), 0)? + Duration::minutes(1);
        // ~5 years of jumps is plenty for any satisfiable expression (Feb 29 included)
        for _ in 0..200_000 {
            if self.months & (1 << t.month()) == 0 {
                let (y, m) = if t.month() == 12 { (t.year() + 1, 1) } else { (t.year(), t.month() + 1) };
                t = NaiveDate::from_ymd_opt(y, m, 1)?.and_hms_opt(0, 0, 0)?;
                continue;
            }
            if !self.day_ok(t.date()) {
                t = t.date().succ_opt()?.and_hms_opt(0, 0, 0)?;
                continue;
            }
            if self.hours & (1 << t.hour()) == 0 {
                t = t.date().and_hms_opt(t.hour(), 0, 0)? + Duration::hours(1);
                continue;
            }
            if self.minutes & (1 << t.minute()) == 0 {
                t += Duration::minutes(1);
                continue;
            }
            match tz.from_local_datetime(&t) {
                LocalResult::Single(x) => return Some(x),
                LocalResult::Ambiguous(x, _) => return Some(x),
                LocalResult::None => t += Duration::minutes(1),
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }
    fn next(expr: &str, from: &str) -> String {
        Cron::parse(expr).unwrap().next_after(&at(from)).unwrap().format("%Y-%m-%d %a %H:%M").to_string()
    }

    #[test]
    fn every_minute_and_steps() {
        assert_eq!(next("* * * * *", "2026-11-08T10:15:30Z"), "2026-11-08 Sun 10:16");
        assert_eq!(next("*/15 * * * *", "2026-11-08T10:15:00Z"), "2026-11-08 Sun 10:30");
        assert_eq!(next("*/15 * * * *", "2026-11-08T10:59:00Z"), "2026-11-08 Sun 11:00");
        assert_eq!(next("5/20 * * * *", "2026-11-08T10:06:00Z"), "2026-11-08 Sun 10:25");
    }

    #[test]
    fn weekdays_at_nine() {
        // Sunday → Monday
        assert_eq!(next("0 9 * * 1-5", "2026-11-08T10:00:00Z"), "2026-11-09 Mon 09:00");
        // Friday after 9 → Monday
        assert_eq!(next("0 9 * * mon-fri", "2026-11-13T09:00:00Z"), "2026-11-16 Mon 09:00");
        assert_eq!(next("0 9 * * MON-FRI", "2026-11-10T08:59:00Z"), "2026-11-10 Tue 09:00");
    }

    #[test]
    fn lists_ranges_and_names() {
        assert_eq!(next("30 8,17 * * *", "2026-11-08T09:00:00Z"), "2026-11-08 Sun 17:30");
        assert_eq!(next("0 9-17/4 * * *", "2026-11-08T13:01:00Z"), "2026-11-08 Sun 17:00");
        assert_eq!(next("0 0 1 jan *", "2026-11-08T00:00:00Z"), "2027-01-01 Fri 00:00");
        assert_eq!(next("0 12 * * 7", "2026-11-09T00:00:00Z"), "2026-11-15 Sun 12:00");
        assert_eq!(next("@hourly", "2026-11-08T10:15:00Z"), "2026-11-08 Sun 11:00");
        assert_eq!(next("@weekly", "2026-11-08T10:15:00Z"), "2026-11-15 Sun 00:00");
    }

    #[test]
    fn dom_or_dow_when_both_restricted() {
        // the 13th OR any Friday
        assert_eq!(next("0 0 13 * 5", "2026-11-08T00:00:00Z"), "2026-11-13 Fri 00:00");
        assert_eq!(next("0 0 13 * 1", "2026-11-08T00:00:00Z"), "2026-11-09 Mon 00:00");
        // leap day
        assert_eq!(next("0 0 29 2 *", "2026-11-08T00:00:00Z"), "2028-02-29 Tue 00:00");
    }

    #[test]
    fn matches_minutes() {
        let c = Cron::parse("0 9 * * 1-5").unwrap();
        assert!(c.matches(&at("2026-11-09T09:00:00Z").naive_utc()));
        assert!(!c.matches(&at("2026-11-08T09:00:00Z").naive_utc()));
        assert!(!c.matches(&at("2026-11-09T09:01:00Z").naive_utc()));
    }

    #[test]
    fn rejects_bad_expressions() {
        for bad in ["", "* * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "*/0 * * * *", "5-1 * * * *", "a * * * *", "* * * * 8", "1,,2 * * * *"] {
            assert!(Cron::parse(bad).is_err(), "{bad} should be rejected");
        }
        assert!(Cron::parse("never 0 31 2 *").is_err());
    }

    #[test]
    fn impossible_dates_have_no_next_run() {
        assert!(Cron::parse("0 0 31 2 *").unwrap().next_after(&at("2026-11-08T00:00:00Z")).is_none());
    }

    #[test]
    fn dst_gap_is_skipped() {
        // a fixed offset has no gaps; just check next_after works with offsets
        let ist = chrono::FixedOffset::east_opt(5 * 3600 + 1800).unwrap();
        let from = ist.with_ymd_and_hms(2026, 11, 8, 8, 0, 0).unwrap();
        let n = Cron::parse("0 9 * * *").unwrap().next_after(&from).unwrap();
        assert_eq!(n.format("%H:%M %z").to_string(), "09:00 +0530");
    }
}
