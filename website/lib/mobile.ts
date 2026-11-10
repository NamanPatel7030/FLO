import "server-only";
import { createHmac, randomBytes, randomInt } from "node:crypto";
import type postgres from "postgres";
import { findUserById, isUuid, sql, toIso, type User } from "./db";
import type { ActionIn, ActionKind, ComputerState } from "./desktop-state";
import { bearer, verifyAppToken } from "./tokens";
import { bumpUsage, countPhoneRequest } from "./usage";

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
  if (!user) return null;
  // the desktop polls while open and signed in: that traffic is what "active" means (lib/usage.ts)
  await bumpUsage(user.id, "desktop");
  return { user, deviceId: null };
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
  if (!user) return null;
  await bumpUsage(user.id, "phone");
  return { user, deviceId: String(r.id) };
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
    // re-pairing the same phone replaces its old entry (and signs the old pairing out),
    // so the desktop doesn't list one phone several times
    await tx`delete from app.mobile_devices where user_id = ${user.id} and name = ${deviceName} and platform = ${platform}`;
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
  // the last phone is gone: nobody reads the computer's snapshot any more
  if (rows.length > 0 && (await deviceCount(userId)) === 0) await clearDesktopState(userId);
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
export type AnsweredBy = "computer" | "cloud";
export type MobileRequest = {
  id: number;
  mode: RequestMode;
  text: string;
  status: string;
  answer: string | null;
  createdAt: string;
  /** Who answered: the user's computer, or the server's cloud AI while the computer was off. */
  answeredBy: AnsweredBy | null;
};
/** For the desktop: plus the phone's screen text (bubble Ask only). */
export type TakenRequest = MobileRequest & { context: string | null };
/** For the server's own decisions (the cloud fallback). */
export type StoredRequest = TakenRequest & { cloudTriedAt: string | null };

type RequestRow = {
  id: string | number;
  mode: RequestMode;
  text: string;
  status: string;
  answer: string | null;
  created_at: Date;
  answered_by?: string | null;
  context?: string | null;
  cloud_tried_at?: Date | null;
};

const toRequest = (r: RequestRow): MobileRequest => ({
  id: Number(r.id),
  mode: r.mode,
  text: r.text,
  status: r.status,
  answer: r.answer,
  createdAt: new Date(r.created_at).toISOString(),
  answeredBy: r.answered_by === "cloud" || r.answered_by === "computer" ? r.answered_by : null,
});
const toTaken = (r: RequestRow): TakenRequest => ({ ...toRequest(r), context: r.context ?? null });
const toStored = (r: RequestRow): StoredRequest => ({ ...toTaken(r), cloudTriedAt: r.cloud_tried_at ? toIso(r.cloud_tried_at) : null });

/**
 * Phone: queue a request for the Mac. `context` is the phone's visible screen text, sent only when the
 * user holds Ask in the bubble (never with Dictate, never password fields). Old requests (7 days) are
 * cleaned up on the way.
 */
export async function queueRequest(userId: string, deviceId: string | null, mode: RequestMode, text: string, context: string | null = null): Promise<MobileRequest> {
  const db = sql();
  await db`delete from app.mobile_requests where user_id = ${userId} and created_at < now() - interval '7 days'`;
  const [r] = await db<RequestRow[]>`
    insert into app.mobile_requests (user_id, device_id, mode, text, context) values (${userId}, ${deviceId}, ${mode}, ${text}, ${mode === "ask" ? context : null})
    returning id, mode, text, status, answer, created_at, answered_by`;
  await countPhoneRequest(userId);
  return toRequest(r);
}

/** Phone (and the cloud fallback): one of the user's requests. */
export async function getRequest(userId: string, id: number): Promise<StoredRequest | null> {
  const rows = await sql()<RequestRow[]>`
    select id, mode, text, status, answer, created_at, answered_by, context, cloud_tried_at
      from app.mobile_requests where user_id = ${userId} and id = ${id}`;
  return rows[0] ? toStored(rows[0]) : null;
}

/**
 * Mac: take up to `limit` pending requests (each is handed out once; stale 'taken' ones retry after 2
 * minutes). Asks expire after an hour; to-dos and notes wait for the computer (kept 7 days).
 */
export async function takeRequests(userId: string, limit = 5): Promise<TakenRequest[]> {
  const rows = await sql()<RequestRow[]>`
    update app.mobile_requests set status = 'taken', taken_at = now()
     where id in (
       select id from app.mobile_requests
        where user_id = ${userId}
          and (status = 'pending' or (status = 'taken' and taken_at < now() - interval '2 minutes' and answered_by is null))
          and (created_at > now() - interval '1 hour' or mode in ('todo', 'note'))
        order by id limit ${limit}
        for update skip locked)
    returning id, mode, text, status, answer, created_at, answered_by, context`;
  return rows.map(toTaken).sort((a, b) => a.id - b.id);
}

/** Mac: finish a request with its answer. Returns null if it isn't this user's. */
export async function finishRequest(userId: string, id: number, ok: boolean, answer: string): Promise<MobileRequest | null> {
  const rows = await sql()<RequestRow[]>`
    update app.mobile_requests set status = ${ok ? "done" : "failed"}, answer = ${answer}, done_at = now(), answered_by = 'computer'
     where user_id = ${userId} and id = ${id}
    returning id, mode, text, status, answer, created_at, answered_by`;
  return rows[0] ? toRequest(rows[0]) : null;
}

/** Cloud fallback: claim a pending ask once (atomic: of several concurrent polls only one wins). */
export async function claimForCloud(userId: string, id: number): Promise<StoredRequest | null> {
  const rows = await sql()<RequestRow[]>`
    update app.mobile_requests set status = 'taken', taken_at = now(), cloud_tried_at = now()
     where user_id = ${userId} and id = ${id} and status = 'pending' and mode = 'ask' and cloud_tried_at is null
    returning id, mode, text, status, answer, created_at, answered_by, context, cloud_tried_at`;
  return rows[0] ? toStored(rows[0]) : null;
}

/** Cloud fallback: the answer is in. */
export async function finishInCloud(userId: string, id: number, answer: string): Promise<MobileRequest | null> {
  const rows = await sql()<RequestRow[]>`
    update app.mobile_requests set status = 'done', answer = ${answer}, done_at = now(), answered_by = 'cloud'
     where user_id = ${userId} and id = ${id} and status = 'taken' and answered_by is null
    returning id, mode, text, status, answer, created_at, answered_by`;
  return rows[0] ? toRequest(rows[0]) : null;
}

/** Cloud fallback failed (no credits, timeout): hand it back to the computer for when it's online. */
export async function releaseFromCloud(userId: string, id: number): Promise<MobileRequest | null> {
  const rows = await sql()<RequestRow[]>`
    update app.mobile_requests set status = 'pending', taken_at = null
     where user_id = ${userId} and id = ${id} and status = 'taken' and answered_by is null
    returning id, mode, text, status, answer, created_at, answered_by`;
  return rows[0] ? toRequest(rows[0]) : null;
}

// ── the computer's state for the phone (to-dos, approvals, settings) ─────────

export type StoredState = { state: ComputerState; updatedAt: string };
export type PhoneAction = { id: number; kind: ActionKind; target: string; value: unknown; status: string; message: string | null; createdAt: string };

type ActionRow = { id: string | number; kind: ActionKind; target: string; value: unknown; status: string; message: string | null; created_at: Date };
const toAction = (r: ActionRow): PhoneAction => ({
  id: Number(r.id),
  kind: r.kind,
  target: r.target,
  value: r.value ?? null,
  status: r.status,
  message: r.message,
  createdAt: new Date(r.created_at).toISOString(),
});

/** Desktop: replace the snapshot. Stored only while a phone is paired (nothing to show otherwise). */
export async function putDesktopState(userId: string, state: ComputerState): Promise<StoredState | null> {
  const db = sql();
  if ((await deviceCount(userId)) === 0) {
    await db`delete from app.desktop_state where user_id = ${userId}`;
    return null;
  }
  const rows = await db<{ updated_at: Date }[]>`
    insert into app.desktop_state (user_id, state, updated_at) values (${userId}, ${db.json(state as postgres.JSONValue)}, now())
    on conflict (user_id) do update set state = excluded.state, updated_at = excluded.updated_at
    returning updated_at`;
  return { state, updatedAt: toIso(rows[0].updated_at) };
}

/** Desktop signed out (or the user asked): forget the snapshot. */
export async function clearDesktopState(userId: string): Promise<void> {
  await sql()`delete from app.desktop_state where user_id = ${userId}`;
}

export async function getDesktopState(userId: string): Promise<StoredState | null> {
  const rows = await sql()<{ state: ComputerState; updated_at: Date }[]>`
    select state, updated_at from app.desktop_state where user_id = ${userId}`;
  return rows[0] ? { state: rows[0].state, updatedAt: toIso(rows[0].updated_at) } : null;
}

/** Phone: queue an action for the computer. Old actions (1 day) are cleaned up on the way. */
export async function queueAction(userId: string, deviceId: string | null, a: ActionIn): Promise<PhoneAction> {
  const db = sql();
  await db`delete from app.mobile_actions where user_id = ${userId} and created_at < now() - interval '1 day'`;
  const value = a.value === null ? null : db.json(a.value as postgres.JSONValue);
  const [r] = await db<ActionRow[]>`
    insert into app.mobile_actions (user_id, device_id, kind, target, value) values (${userId}, ${deviceId}, ${a.kind}, ${a.target}, ${value})
    returning id, kind, target, value, status, message, created_at`;
  return toAction(r);
}

/** Phone: its recent actions (last 10 minutes), so it can show "sending" / "couldn't" states. */
export async function recentActions(userId: string): Promise<PhoneAction[]> {
  const rows = await sql()<ActionRow[]>`
    select id, kind, target, value, status, message, created_at from app.mobile_actions
     where user_id = ${userId} and created_at > now() - interval '10 minutes'
     order by id desc limit 50`;
  return rows.map(toAction);
}

/** Desktop: take pending actions (each handed out once; stale 'taken' ones retry after a minute; older than 10 minutes are dropped). */
export async function takeActions(userId: string, limit = 20): Promise<PhoneAction[]> {
  const rows = await sql()<ActionRow[]>`
    update app.mobile_actions set status = 'taken', taken_at = now()
     where id in (
       select id from app.mobile_actions
        where user_id = ${userId}
          and (status = 'pending' or (status = 'taken' and taken_at < now() - interval '1 minute'))
          and created_at > now() - interval '10 minutes'
        order by id limit ${limit}
        for update skip locked)
    returning id, kind, target, value, status, message, created_at`;
  return rows.map(toAction).sort((a, b) => a.id - b.id);
}

/** Desktop: finish an action. Returns null if it isn't this user's. */
export async function finishAction(userId: string, id: number, ok: boolean, message: string | null): Promise<PhoneAction | null> {
  const rows = await sql()<ActionRow[]>`
    update app.mobile_actions set status = ${ok ? "done" : "failed"}, message = ${message}, done_at = now()
     where user_id = ${userId} and id = ${id}
    returning id, kind, target, value, status, message, created_at`;
  return rows[0] ? toAction(rows[0]) : null;
}
