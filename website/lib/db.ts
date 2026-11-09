import "server-only";
import postgres from "postgres";
import { randomBytes } from "node:crypto";

/**
 * Server data layer: Supabase Postgres over a direct connection (`DATABASE_URL`).
 *
 * Accounts themselves live in Supabase Auth (`auth.users`) with a mirror row in `public.profiles`.
 * Everything else is in the private `app` schema, which the Data API doesn't expose and anon /
 * authenticated can't touch (supabase/migrations/0001_init.sql). This connection runs as the
 * table owner, so it bypasses RLS: never import this module from client code (server-only).
 *
 * DATABASE_URL is the Supabase pooler string in transaction mode (port 6543), so prepared
 * statements are off (`prepare: false`).
 */
export type User = { id: string; email: string; name: string; image?: string | null };

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not set to a Postgres connection string (see docs/supabase-setup.md).");
    this.name = "DatabaseNotConfiguredError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Supabase user ids are uuids; anything else (e.g. a pre-Supabase app token) matches no row. */
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

export function databaseUrl(): string | null {
  const u = (process.env.DATABASE_URL ?? "").trim();
  return /^postgres(ql)?:\/\//i.test(u) ? u : null;
}
export const dbConfigured = () => databaseUrl() !== null;

type Sql = postgres.Sql<Record<string, never>>;
// one pool per server instance; survives dev hot reloads
const g = globalThis as unknown as { __floSql?: Sql };

export function sql(): Sql {
  if (g.__floSql) return g.__floSql;
  const url = databaseUrl();
  if (!url) throw new DatabaseNotConfiguredError();
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url) || /host=\/|%2F/.test(url);
  g.__floSql = postgres(url, {
    prepare: false, // Supavisor transaction mode
    max: Number(process.env.DATABASE_POOL_MAX) || 5,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: local ? false : "require",
    onnotice: () => {},
    connection: { application_name: "flo-website" },
  });
  return g.__floSql;
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d));

// ── profiles ─────────────────────────────────────────────────────────────────

type ProfileRow = { id: string; email: string; name: string; avatar_url: string | null };
const toUser = (r: ProfileRow): User => ({ id: String(r.id), email: String(r.email ?? ""), name: String(r.name ?? ""), image: r.avatar_url ?? null });

/** The Flo account (profile) for a Supabase user id, or null (unknown / deleted / not a uuid). */
export async function findUserById(id: string): Promise<User | null> {
  if (!isUuid(id)) return null;
  const rows = await sql()<ProfileRow[]>`select id, email, name, avatar_url from public.profiles where id = ${id}`;
  return rows[0] ? toUser(rows[0]) : null;
}

// ── desktop sign-in handoff ──────────────────────────────────────────────────

export const HANDOFF_TTL_MS = 5 * 60_000;
const ms = (n: number) => n / 1000; // → seconds for make_interval

/** One-time code (5 min) the website hands to the desktop app. */
export async function createHandoff(userId: string, state: string): Promise<string> {
  const db = sql();
  const code = randomBytes(18).toString("base64url");
  await db`delete from app.handoffs where expires_at < now() - interval '1 hour'`;
  await db`
    insert into app.handoffs (code, state, user_id, expires_at)
    values (${code}, ${state}, ${userId}, now() + make_interval(secs => ${ms(HANDOFF_TTL_MS)}))`;
  return code;
}

/** Redeem a handoff code once. `state` (when given) must match the one it was issued for. */
export async function redeemHandoff(code: string, state?: string): Promise<User | null> {
  const rows = await sql()<{ user_id: string; state: string }[]>`
    update app.handoffs set used = true
     where code = ${code} and not used and expires_at > now()
    returning user_id, state`;
  const r = rows[0];
  if (!r) return null;
  if (state && state !== r.state) return null;
  return findUserById(String(r.user_id));
}

// ── one-click Connect Slack (see lib/slack.ts) ──────────────────────────────

/** Only a live Flo account can own a Slack flow; anything else is stored unbound (null). */
const ownerOrNull = (userId: string | null) => (isUuid(userId) ? userId : null);

/** One-time OAuth state for Connect Slack, bound to the desktop's challenge (and Flo account when signed in). */
export async function createSlackState(state: string, challenge: string, userId: string | null, ttlMs: number): Promise<void> {
  const db = sql();
  await db`delete from app.slack_states where expires_at < now()`;
  await db`
    insert into app.slack_states (state, challenge, user_id, expires_at)
    values (${state}, ${challenge},
            (select id from public.profiles where id = ${ownerOrNull(userId)}::uuid),
            now() + make_interval(secs => ${ms(ttlMs)}))`;
}

/** Is this state live (issued, unused, unexpired)? Doesn't consume it. */
export async function slackStateLive(state: string): Promise<boolean> {
  const rows = await sql()`select 1 from app.slack_states where state = ${state} and not used and expires_at > now()`;
  return rows.length > 0;
}

/** Consume a state once (the OAuth callback). */
export async function consumeSlackState(state: string): Promise<{ challenge: string; userId: string | null } | null> {
  // single statement: claim + delete; a second caller sees no row
  const rows = await sql()<{ challenge: string; user_id: string | null }[]>`
    delete from app.slack_states
     where state = ${state} and not used and expires_at > now()
    returning challenge, user_id`;
  const r = rows[0];
  return r ? { challenge: String(r.challenge), userId: r.user_id ? String(r.user_id) : null } : null;
}

/** Park a sealed Slack token under a one-time handoff code (the desktop claims it). */
export async function createSlackHandoff(h: {
  code: string;
  sealed: string;
  challenge: string;
  userId: string | null;
  team: string;
  slackUser: string;
  ttlMs: number;
}): Promise<void> {
  const db = sql();
  await db`delete from app.slack_handoffs where expires_at < now()`;
  await db`
    insert into app.slack_handoffs (code, sealed, challenge, user_id, team, slack_user, expires_at)
    values (${h.code}, ${h.sealed}, ${h.challenge},
            (select id from public.profiles where id = ${ownerOrNull(h.userId)}::uuid),
            ${h.team}, ${h.slackUser}, now() + make_interval(secs => ${ms(h.ttlMs)}))`;
}

/**
 * Claim a handoff exactly once: the code, the challenge (sha256 of the desktop's verifier) and — when the
 * flow was started signed in — the Flo account must all match. The row is deleted on success.
 */
export async function claimSlackHandoff(
  code: string,
  challenge: string,
  userId: string | null,
): Promise<{ sealed: string; team: string; slackUser: string } | null> {
  const uid = ownerOrNull(userId);
  const rows = await sql()<{ sealed: string; team: string; slack_user: string }[]>`
    delete from app.slack_handoffs
     where code = ${code} and challenge = ${challenge} and not used and expires_at > now()
       and (user_id is null or user_id = ${uid}::uuid)
    returning sealed, team, slack_user`;
  const r = rows[0];
  return r ? { sealed: String(r.sealed), team: String(r.team ?? ""), slackUser: String(r.slack_user ?? "") } : null;
}

export { iso as toIso };

// ── usage counter (public totals only) ──────────────────────────────────────

/** Stamp that this account's desktop app is in use (sign-in or launch). Never fails the request. */
export async function touchAppUsage(userId: string): Promise<void> {
  if (!isUuid(userId) || !dbConfigured()) return;
  try {
    await sql()`
      insert into app.app_usage (user_id) values (${userId})
      on conflict (user_id) do update set last_seen = now()`;
  } catch {
    /* counting must never break sign-in */
  }
}

export type UsageStats = { signedUp: number; usingFlo: number; activeWeek: number; joinedToday: number; since: string };

/** Totals for the public counter. `signedUp` counts confirmed accounts only (Google, or email confirmed). */
export async function usageStats(): Promise<UsageStats> {
  const [r] = await sql()<{ signed_up: number; joined_today: number; using_flo: number; active_week: number; since: Date | null }[]>`
    select
      (select count(*)::int from auth.users where email_confirmed_at is not null and deleted_at is null) as signed_up,
      (select count(*)::int from auth.users where email_confirmed_at is not null and deleted_at is null and created_at >= date_trunc('day', now())) as joined_today,
      (select count(*)::int from app.app_usage) as using_flo,
      (select count(*)::int from app.app_usage where last_seen > now() - interval '7 days') as active_week,
      (select min(created_at) from auth.users) as since`;
  return { signedUp: r.signed_up, usingFlo: r.using_flo, activeWeek: r.active_week, joinedToday: r.joined_today, since: (r.since ?? new Date()).toISOString() };
}
