import "server-only";
import { createHmac, randomBytes, randomInt } from "node:crypto";
import type postgres from "postgres";
import { findUserById, isUuid, sql, toIso, type User } from "./db";
import { bearer, verifyAppToken } from "./tokens";

/**
 * Presence (active / away), paired phones, pairing codes and the notification inbox.
 * Contract: docs/mobile-api.md. Device tokens and pair codes are stored as keyed hashes only.
 */
export type Presence = { status: "active" | "away"; since: string };
export type Device = { id: string; name: string; platform: string; lastSeen: string };
export type InboxItem = { id: number; kind: string; title: string; body: string; data: unknown; createdAt: string };

export const PUSH_KINDS = [
  "claude_done",
  "claude_needs_you",
  "claude_limit",
  "claude_resumed",
  "todo_due",
  "todos_digest",
  "reminder",
  "skill_ran",
  "meeting_summary",
] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

const DEVICE_PREFIX = "flod_";
const PAIR_TTL_MS = 5 * 60_000;
const INBOX_KEEP = 100;

/** Keyed hash (HMAC-SHA256 with AUTH_SECRET) so a leaked DB can't be replayed or brute-forced offline. */
export function hashSecret(kind: "device" | "pair", value: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return createHmac("sha256", secret).update(`${kind}:${value}`).digest("hex");
}

/** Public base URL of this server (no trailing slash). */
export function serverUrl(req: Request): string {
  const env = process.env.SITE_URL || process.env.AUTH_URL;
  if (env) return env.replace(/\/+$/, "");
  return new URL(req.url).origin;
}

// ── auth ─────────────────────────────────────────────────────────────────────

export type Caller = { user: User; deviceId: string | null };

/** Desktop app token (JWT) → user. */
export async function desktopCaller(req: Request): Promise<Caller | null> {
  const t = bearer(req);
  if (!t || t.startsWith(DEVICE_PREFIX)) return null;
  const claims = await verifyAppToken(t);
  const user = claims ? await findUserById(claims.sub) : null;
  return user ? { user, deviceId: null } : null;
}

/** Phone device token → user (+ bumps last_seen). */
export async function mobileCaller(req: Request): Promise<Caller | null> {
  const t = bearer(req);
  if (!t || !t.startsWith(DEVICE_PREFIX) || t.length > 200) return null;
  const rows = await sql()<{ id: string; user_id: string }[]>`
    update app.mobile_devices set last_seen = now()
     where token_hash = ${hashSecret("device", t)}
    returning id, user_id`;
  const r = rows[0];
  if (!r) return null;
  const user = await findUserById(String(r.user_id));
  return user ? { user, deviceId: String(r.id) } : null;
}

export async function anyCaller(req: Request): Promise<Caller | null> {
  return (await desktopCaller(req)) ?? (await mobileCaller(req));
}

export const unauthorized = () => Response.json({ error: "Not signed in." }, { status: 401 });

// ── presence ─────────────────────────────────────────────────────────────────

const toPresence = (r: { status: string; since: unknown }): Presence => ({ status: r.status === "away" ? "away" : "active", since: toIso(r.since) });

export async function getPresence(userId: string): Promise<Presence> {
  const rows = await sql()<{ status: string; since: Date }[]>`select status, since from app.presence where user_id = ${userId}`;
  return rows[0] ? toPresence(rows[0]) : setPresence(userId, "active");
}

export async function setPresence(userId: string, status: "active" | "away"): Promise<Presence> {
  // keep `since` when the status doesn't actually change
  const rows = await sql()<{ status: string; since: Date }[]>`
    insert into app.presence as p (user_id, status, since) values (${userId}, ${status}, now())
    on conflict (user_id) do update
       set since = case when p.status = excluded.status then p.since else excluded.since end,
           status = excluded.status
    returning status, since`;
  return toPresence(rows[0]);
}

// ── pairing ──────────────────────────────────────────────────────────────────

/** New 6-digit single-use code (5 min). Returns the digits ("483920"). */
export async function startPairing(userId: string): Promise<{ digits: string; expiresAt: string }> {
  const db = sql();
  await db`delete from app.pair_codes where expires_at < now() or used or user_id = ${userId}`;
  for (let i = 0; i < 8; i++) {
    const digits = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const rows = await db<{ expires_at: Date }[]>`
      insert into app.pair_codes (code_hash, user_id, expires_at)
      values (${hashSecret("pair", digits)}, ${userId}, now() + make_interval(secs => ${PAIR_TTL_MS / 1000}))
      on conflict (code_hash) do nothing
      returning expires_at`;
    if (rows[0]) return { digits, expiresAt: toIso(rows[0].expires_at) };
    // an active code collided: draw again
  }
  throw new Error("Couldn't create a pairing code. Try again.");
}

export const formatCode = (digits: string) => `${digits.slice(0, 3)} ${digits.slice(3)}`;

/** Accepts "483 920", "483920" or a full `flo-pair://host/483920` payload. */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 300) return null;
  const bare = input.split(/[?#]/)[0]; // `flo-pair://host/483920?scheme=https`
  const tail = bare.includes("/") ? bare.slice(bare.lastIndexOf("/") + 1) : bare;
  const digits = tail.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** Redeem a code once → new device + its token (returned once, stored hashed). */
export async function claimPairing(
  digits: string,
  deviceName: string,
  platform: string,
  pushToken: string | null,
): Promise<{ deviceToken: string; user: User } | null> {
  const db = sql();
  const rows = await db<{ user_id: string }[]>`
    update app.pair_codes set used = true
     where code_hash = ${hashSecret("pair", digits)} and not used and expires_at > now()
    returning user_id`;
  const r = rows[0];
  if (!r) return null;
  const user = await findUserById(String(r.user_id));
  if (!user) return null;
  const deviceToken = DEVICE_PREFIX + randomBytes(32).toString("base64url");
  await db.begin(async (tx) => {
    // an FCM token belongs to one device: move it if another (re-installed) device had it
    if (pushToken) await tx`update app.mobile_devices set push_token = null where push_token = ${pushToken}`;
    await tx`
      insert into app.mobile_devices (user_id, name, platform, token_hash, push_token)
      values (${user.id}, ${deviceName}, ${platform}, ${hashSecret("device", deviceToken)}, ${pushToken})`;
  });
  return { deviceToken, user };
}

// ── devices ──────────────────────────────────────────────────────────────────

export async function listDevices(userId: string): Promise<Device[]> {
  const rows = await sql()<{ id: string; name: string; platform: string; last_seen: Date }[]>`
    select id, name, platform, last_seen from app.mobile_devices where user_id = ${userId} order by created_at desc`;
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), platform: String(r.platform), lastSeen: toIso(r.last_seen) }));
}

export async function removeDevice(userId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await sql()`delete from app.mobile_devices where id = ${id} and user_id = ${userId} returning id`;
  return rows.length > 0;
}

export async function setPushToken(deviceId: string, pushToken: string | null): Promise<void> {
  await sql().begin(async (tx) => {
    if (pushToken) await tx`update app.mobile_devices set push_token = null where push_token = ${pushToken} and id <> ${deviceId}`;
    await tx`update app.mobile_devices set push_token = ${pushToken} where id = ${deviceId}`;
  });
}

export async function pushTargets(userId: string): Promise<{ id: string; pushToken: string }[]> {
  const rows = await sql()<{ id: string; push_token: string }[]>`
    select id, push_token from app.mobile_devices where user_id = ${userId} and push_token is not null`;
  return rows.map((r) => ({ id: String(r.id), pushToken: String(r.push_token) }));
}

/** FCM said this token is gone: forget it (the device stays paired and can re-register). */
export async function dropPushToken(pushToken: string): Promise<void> {
  await sql()`update app.mobile_devices set push_token = null where push_token = ${pushToken}`;
}

export async function deviceCount(userId: string): Promise<number> {
  const rows = await sql()<{ n: number }[]>`select count(*)::int as n from app.mobile_devices where user_id = ${userId}`;
  return Number(rows[0]?.n ?? 0);
}

// ── inbox ────────────────────────────────────────────────────────────────────

export async function storeNotification(userId: string, kind: string, title: string, body: string, data: unknown): Promise<InboxItem> {
  const db = sql();
  const json = data === undefined || data === null ? null : db.json(data as postgres.JSONValue);
  const rows = await db<{ id: string; created_at: Date }[]>`
    insert into app.notifications (user_id, kind, title, body, data)
    values (${userId}, ${kind}, ${title}, ${body}, ${json})
    returning id, created_at`;
  // keep the newest INBOX_KEEP per account
  await db`
    delete from app.notifications
     where user_id = ${userId}
       and id < (select min(id) from (select id from app.notifications where user_id = ${userId} order by id desc limit ${INBOX_KEEP}) newest)`;
  return { id: Number(rows[0].id), kind, title, body, data: data ?? null, createdAt: toIso(rows[0].created_at) };
}

export async function inbox(userId: string, after: number): Promise<InboxItem[]> {
  const rows = await sql()<{ id: string; kind: string; title: string; body: string; data: unknown; created_at: Date }[]>`
    select id, kind, title, body, data, created_at from app.notifications
     where user_id = ${userId} and id > ${Math.max(0, Math.floor(after) || 0)}
     order by id asc limit ${INBOX_KEEP}`;
  return rows.map((r) => ({
    id: Number(r.id),
    kind: String(r.kind),
    title: String(r.title),
    body: String(r.body),
    data: r.data ?? null,
    createdAt: toIso(r.created_at),
  }));
}

// ── validation ───────────────────────────────────────────────────────────────

export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  // strip control characters, collapse whitespace
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

/** `data` must be a small flat object of string/number/boolean values (FCM data is string → string). */
export function cleanData(v: unknown): Record<string, string> | null | "invalid" {
  if (v === undefined || v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) return "invalid";
  const out: Record<string, string> = {};
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > 12) return "invalid";
  for (const [k, val] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(k) || ["from", "notification", "message_type"].includes(k) || k.startsWith("google")) return "invalid";
    if (typeof val !== "string" && typeof val !== "number" && typeof val !== "boolean") return "invalid";
    out[k] = String(val).slice(0, 300);
  }
  return out;
}

// ── phone → Mac requests (Ask Flo / Dictate) ─────────────────────────────────

export type RequestMode = "ask" | "todo" | "note";
export const REQUEST_MODES: readonly RequestMode[] = ["ask", "todo", "note"];
export type MobileRequest = { id: number; mode: RequestMode; text: string; status: string; answer: string | null; createdAt: string };

const toRequest = (r: { id: string | number; mode: RequestMode; text: string; status: string; answer: string | null; created_at: Date }): MobileRequest => ({
  id: Number(r.id),
  mode: r.mode,
  text: r.text,
  status: r.status,
  answer: r.answer,
  createdAt: new Date(r.created_at).toISOString(),
});

/** Phone: queue a request for the Mac. Old requests (7 days) are cleaned up on the way. */
export async function queueRequest(userId: string, deviceId: string | null, mode: RequestMode, text: string): Promise<MobileRequest> {
  const db = sql();
  await db`delete from app.mobile_requests where user_id = ${userId} and created_at < now() - interval '7 days'`;
  const [r] = await db`
    insert into app.mobile_requests (user_id, device_id, mode, text) values (${userId}, ${deviceId}, ${mode}, ${text})
    returning id, mode, text, status, answer, created_at`;
  return toRequest(r as never);
}

/** Phone: one of its own requests. */
export async function getRequest(userId: string, id: number): Promise<MobileRequest | null> {
  const rows = await sql()`select id, mode, text, status, answer, created_at from app.mobile_requests where user_id = ${userId} and id = ${id}`;
  return rows[0] ? toRequest(rows[0] as never) : null;
}

/** Mac: take up to `limit` pending requests (each is handed out once; stale 'taken' ones retry after 2 minutes). */
export async function takeRequests(userId: string, limit = 5): Promise<MobileRequest[]> {
  const rows = await sql()`
    update app.mobile_requests set status = 'taken', taken_at = now()
     where id in (
       select id from app.mobile_requests
        where user_id = ${userId}
          and (status = 'pending' or (status = 'taken' and taken_at < now() - interval '2 minutes'))
          and created_at > now() - interval '1 hour'
        order by id limit ${limit}
        for update skip locked)
    returning id, mode, text, status, answer, created_at`;
  return rows.map((r) => toRequest(r as never)).sort((a, b) => a.id - b.id);
}

/** Mac: finish a request with its answer. Returns false if it isn't this user's. */
export async function finishRequest(userId: string, id: number, ok: boolean, answer: string): Promise<MobileRequest | null> {
  const rows = await sql()`
    update app.mobile_requests set status = ${ok ? "done" : "failed"}, answer = ${answer}, done_at = now()
     where user_id = ${userId} and id = ${id}
    returning id, mode, text, status, answer, created_at`;
  return rows[0] ? toRequest(rows[0] as never) : null;
}
