import "server-only";
import { createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";
import { findUserById, readyDb, type User } from "./db";
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
  const db = await readyDb();
  const rs = await db.execute({ sql: "SELECT id, user_id FROM mobile_devices WHERE token_hash = ?", args: [hashSecret("device", t)] });
  const r = rs.rows[0] as unknown as { id: string; user_id: string } | undefined;
  if (!r) return null;
  const user = await findUserById(r.user_id);
  if (!user) return null;
  await db.execute({ sql: "UPDATE mobile_devices SET last_seen = ? WHERE id = ?", args: [new Date().toISOString(), r.id] });
  return { user, deviceId: r.id };
}

export async function anyCaller(req: Request): Promise<Caller | null> {
  return (await desktopCaller(req)) ?? (await mobileCaller(req));
}

export const unauthorized = () => Response.json({ error: "Not signed in." }, { status: 401 });

// ── presence ─────────────────────────────────────────────────────────────────

export async function getPresence(userId: string): Promise<Presence> {
  const db = await readyDb();
  const rs = await db.execute({ sql: "SELECT status, since FROM presence WHERE user_id = ?", args: [userId] });
  const r = rs.rows[0] as unknown as { status: string; since: string } | undefined;
  if (r) return { status: r.status === "away" ? "away" : "active", since: String(r.since) };
  return setPresence(userId, "active");
}

export async function setPresence(userId: string, status: "active" | "away"): Promise<Presence> {
  const db = await readyDb();
  const now = new Date().toISOString();
  // keep `since` when the status doesn't actually change
  await db.execute({
    sql: `INSERT INTO presence (user_id, status, since) VALUES (?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET since = CASE WHEN presence.status = excluded.status THEN presence.since ELSE excluded.since END,
          status = excluded.status`,
    args: [userId, status, now],
  });
  const rs = await db.execute({ sql: "SELECT status, since FROM presence WHERE user_id = ?", args: [userId] });
  const r = rs.rows[0] as unknown as { status: string; since: string };
  return { status: r.status === "away" ? "away" : "active", since: String(r.since) };
}

// ── pairing ──────────────────────────────────────────────────────────────────

/** New 6-digit single-use code (5 min). Returns the digits ("483920"). */
export async function startPairing(userId: string): Promise<{ digits: string; expiresAt: string }> {
  const db = await readyDb();
  const now = Date.now();
  await db.execute({ sql: "DELETE FROM pair_codes WHERE expires_at < ? OR used = 1 OR user_id = ?", args: [now, userId] });
  for (let i = 0; i < 8; i++) {
    const digits = String(randomInt(0, 1_000_000)).padStart(6, "0");
    try {
      await db.execute({
        sql: "INSERT INTO pair_codes (code_hash, user_id, expires_at) VALUES (?, ?, ?)",
        args: [hashSecret("pair", digits), userId, now + PAIR_TTL_MS],
      });
      return { digits, expiresAt: new Date(now + PAIR_TTL_MS).toISOString() };
    } catch (e) {
      if (!String(e).includes("UNIQUE")) throw e; // an active code collided: draw again
    }
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
  const db = await readyDb();
  const rs = await db.execute({
    sql: "UPDATE pair_codes SET used = 1 WHERE code_hash = ? AND used = 0 AND expires_at > ? RETURNING user_id",
    args: [hashSecret("pair", digits), Date.now()],
  });
  const r = rs.rows[0] as unknown as { user_id: string } | undefined;
  if (!r) return null;
  const user = await findUserById(r.user_id);
  if (!user) return null;
  const deviceToken = DEVICE_PREFIX + randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  if (pushToken) await db.execute({ sql: "UPDATE mobile_devices SET push_token = NULL WHERE push_token = ?", args: [pushToken] });
  await db.execute({
    sql: "INSERT INTO mobile_devices (id, user_id, name, platform, token_hash, push_token, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    args: [randomUUID(), user.id, deviceName, platform, hashSecret("device", deviceToken), pushToken, now, now],
  });
  return { deviceToken, user };
}

// ── devices ──────────────────────────────────────────────────────────────────

export async function listDevices(userId: string): Promise<Device[]> {
  const db = await readyDb();
  const rs = await db.execute({
    sql: "SELECT id, name, platform, last_seen FROM mobile_devices WHERE user_id = ? ORDER BY created_at DESC",
    args: [userId],
  });
  return rs.rows.map((r) => ({ id: String(r.id), name: String(r.name), platform: String(r.platform), lastSeen: String(r.last_seen) }));
}

export async function removeDevice(userId: string, id: string): Promise<boolean> {
  const db = await readyDb();
  const rs = await db.execute({ sql: "DELETE FROM mobile_devices WHERE id = ? AND user_id = ?", args: [id, userId] });
  return rs.rowsAffected > 0;
}

export async function setPushToken(deviceId: string, pushToken: string | null): Promise<void> {
  const db = await readyDb();
  if (pushToken) await db.execute({ sql: "UPDATE mobile_devices SET push_token = NULL WHERE push_token = ? AND id <> ?", args: [pushToken, deviceId] });
  await db.execute({ sql: "UPDATE mobile_devices SET push_token = ? WHERE id = ?", args: [pushToken, deviceId] });
}

export async function pushTargets(userId: string): Promise<{ id: string; pushToken: string }[]> {
  const db = await readyDb();
  const rs = await db.execute({ sql: "SELECT id, push_token FROM mobile_devices WHERE user_id = ? AND push_token IS NOT NULL", args: [userId] });
  return rs.rows.map((r) => ({ id: String(r.id), pushToken: String(r.push_token) }));
}

/** FCM said this token is gone: forget it (the device stays paired and can re-register). */
export async function dropPushToken(pushToken: string): Promise<void> {
  const db = await readyDb();
  await db.execute({ sql: "UPDATE mobile_devices SET push_token = NULL WHERE push_token = ?", args: [pushToken] });
}

export async function deviceCount(userId: string): Promise<number> {
  const db = await readyDb();
  const rs = await db.execute({ sql: "SELECT COUNT(*) AS n FROM mobile_devices WHERE user_id = ?", args: [userId] });
  return Number((rs.rows[0] as unknown as { n: number }).n);
}

// ── inbox ────────────────────────────────────────────────────────────────────

export async function storeNotification(userId: string, kind: string, title: string, body: string, data: unknown): Promise<InboxItem> {
  const db = await readyDb();
  const createdAt = new Date().toISOString();
  const json = data === undefined || data === null ? null : JSON.stringify(data);
  const rs = await db.execute({
    sql: "INSERT INTO notifications (user_id, kind, title, body, data, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    args: [userId, kind, title, body, json, createdAt],
  });
  const id = Number((rs.rows[0] as unknown as { id: number }).id);
  await db.execute({
    sql: `DELETE FROM notifications WHERE user_id = ? AND id NOT IN
            (SELECT id FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ${INBOX_KEEP})`,
    args: [userId, userId],
  });
  return { id, kind, title, body, data: data ?? null, createdAt };
}

export async function inbox(userId: string, after: number): Promise<InboxItem[]> {
  const db = await readyDb();
  const rs = await db.execute({
    sql: `SELECT id, kind, title, body, data, created_at FROM notifications WHERE user_id = ? AND id > ? ORDER BY id ASC LIMIT ${INBOX_KEEP}`,
    args: [userId, after],
  });
  return rs.rows.map((r) => {
    let data: unknown = null;
    try {
      data = r.data ? JSON.parse(String(r.data)) : null;
    } catch {
      data = null;
    }
    return { id: Number(r.id), kind: String(r.kind), title: String(r.title), body: String(r.body), data, createdAt: String(r.created_at) };
  });
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
