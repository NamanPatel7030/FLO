import "server-only";
import { dbConfigured, isUuid, sql } from "./db";
import { shouldBump, type Surface, type UsageCountRow } from "./usage-logic";

/**
 * Usage over time (supabase/migrations/0009_usage_days.sql). Bumped from requests the apps already make;
 * these helpers never fail the request they ride on.
 */
const seen = new Map<string, number>();
let lastPrune = 0;
const RETAIN_DAYS = 400;

/** One active 10-minute block for this account and surface (at most one write per block). */
export async function bumpUsage(userId: string, surface: Surface): Promise<void> {
  if (!isUuid(userId) || !dbConfigured() || !shouldBump(seen, `${userId}:${surface}`, Date.now())) return;
  try {
    const db = sql();
    await db`
      insert into app.usage_days as u (user_id, day, surface, pings, updated_at)
      values (${userId}, (now() at time zone 'utc')::date, ${surface}, 1, now())
      on conflict (user_id, day, surface) do update
         set pings = u.pings + 1, updated_at = now()
       where u.updated_at < now() - interval '10 minutes'`;
    // retention, at most once a day per server instance
    if (Date.now() - lastPrune > 86_400_000) {
      lastPrune = Date.now();
      await db`delete from app.usage_days where day < (now() at time zone 'utc')::date - ${RETAIN_DAYS}::int`;
      await db`delete from app.usage_counts where day < (now() at time zone 'utc')::date - ${RETAIN_DAYS}::int`;
    }
  } catch {
    /* counting must never break the request */
  }
}

/** A phone request (ask / to-do / note) was queued: count it for today. Counts only. */
export async function countPhoneRequest(userId: string): Promise<void> {
  if (!isUuid(userId) || !dbConfigured()) return;
  try {
    await sql()`
      insert into app.usage_days as u (user_id, day, surface, pings, requests, updated_at)
      values (${userId}, (now() at time zone 'utc')::date, 'phone', 0, 1, now() - interval '1 hour')
      on conflict (user_id, day, surface) do update set requests = u.requests + 1`;
  } catch {
    /* never breaks the ask */
  }
}

/** Opt-in daily totals from the desktop app: each (day, kind) is replaced by the latest total. */
export async function saveUsageCounts(userId: string, rows: UsageCountRow[]): Promise<number> {
  if (!rows.length) return 0;
  const data = JSON.stringify(rows);
  const res = await sql()`
    insert into app.usage_counts (user_id, day, kind, n, updated_at)
    select ${userId}::uuid, x.day, x.kind, x.n, now()
      from jsonb_to_recordset(${data}::text::jsonb) as x(day date, kind text, n int)
    on conflict (user_id, day, kind) do update set n = excluded.n, updated_at = now()`;
  return res.count;
}

/** The user turned sharing off: forget every count we have for them. */
export async function deleteUsageCounts(userId: string): Promise<number> {
  const res = await sql()`delete from app.usage_counts where user_id = ${userId}`;
  return res.count;
}
