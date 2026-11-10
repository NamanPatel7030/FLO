// Usage over time, derived from requests the apps already make, plus the optional usage counts.
// Pure, no imports, so node --test runs it directly (tests/admin-logic.test.mjs).
//
// Pings: every signed-in desktop request (the phone-request poll runs every 10-20 s while Flo is open)
// and every paired-phone request bumps app.usage_days at most once per 10 minutes per user and surface.
// So `pings` counts 10-minute blocks in which the app was open: minutes ≈ pings × 10.
//
// Counts: only if the user turns on Settings → Privacy → "Share usage counts with Flo". Totals per day,
// never content (see src-tauri/src/usage_share.rs).

export const USAGE_BLOCK_MS = 10 * 60_000;
export const SURFACES = ["desktop", "phone"] as const;
export type Surface = (typeof SURFACES)[number];

const MAX_KEYS = 20_000;

/**
 * Per-instance throttle in front of the database (whose `where updated_at < now() - 10 min` is the real
 * guard across instances). True when this key hasn't been bumped in the last block; records `now`.
 */
export function shouldBump(seen: Map<string, number>, key: string, now: number): boolean {
  const last = seen.get(key);
  if (last !== undefined && now - last < USAGE_BLOCK_MS) return false;
  if (seen.size >= MAX_KEYS) {
    for (const [k, t] of seen) if (now - t >= USAGE_BLOCK_MS) seen.delete(k);
    if (seen.size >= MAX_KEYS) seen.clear();
  }
  seen.set(key, now);
  return true;
}

export const USAGE_KINDS = ["dictations", "words", "assistant_asks", "agent_runs", "meetings"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];
export type UsageCountRow = { day: string; kind: UsageKind; n: number };

const MAX_DAYS = 14;
const MAX_N = 10_000_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(day: string): number | null {
  if (!DAY_RE.test(day)) return null;
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== day) return null;
  return Math.round(t / 86_400_000);
}

/**
 * POST /api/app/usage body → rows. `{days: [{day: "YYYY-MM-DD", counts: {dictations: 4, ...}}]}`, at most
 * 14 days, each within the last 30 days (a day of slack ahead for time zones). Unknown keys are dropped;
 * any malformed number rejects the whole batch.
 */
export function parseUsageCounts(body: unknown, today: string): { rows: UsageCountRow[] } | { error: string } {
  const days = (body as { days?: unknown } | null)?.days;
  if (!Array.isArray(days) || days.length === 0) return { error: "days must be a non-empty list." };
  if (days.length > MAX_DAYS) return { error: `At most ${MAX_DAYS} days.` };
  const t = dayNumber(today)!;
  // one row per (day, kind): a repeated day replaces the earlier one
  const rows = new Map<string, UsageCountRow>();
  for (const d of days) {
    const day = typeof d?.day === "string" ? d.day : "";
    const n = dayNumber(day);
    if (n === null || n < t - 30 || n > t + 1) return { error: "Bad day." };
    const counts = d?.counts;
    if (!counts || typeof counts !== "object" || Array.isArray(counts)) return { error: "Bad counts." };
    for (const kind of USAGE_KINDS) {
      if (!(kind in counts)) continue;
      const v = (counts as Record<string, unknown>)[kind];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_N) return { error: `Bad ${kind}.` };
      rows.set(`${day}|${kind}`, { day, kind, n: v });
    }
  }
  return { rows: [...rows.values()] };
}
