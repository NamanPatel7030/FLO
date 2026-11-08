import "server-only";
import { createClient, type Client } from "@libsql/client";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";

/**
 * Accounts store. `file:./flo.db` locally, Turso (`libsql://…` + DATABASE_AUTH_TOKEN) in production.
 * Tables are created on first use, so there's no migration step to forget.
 */
export type User = { id: string; email: string; name: string; image?: string | null };
type Row = User & { password_hash: string | null };

let client: Client | null = null;
let ready: Promise<void> | null = null;

function db(): Client {
  if (!client) {
    client = createClient({
      url: process.env.DATABASE_URL || "file:./flo.db",
      authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
    });
  }
  return client;
}

async function init() {
  if (!ready) {
    ready = db()
      .batch(
        [
          `CREATE TABLE IF NOT EXISTS users(
             id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '',
             image TEXT, password_hash TEXT, created_at TEXT NOT NULL)`,
          `CREATE TABLE IF NOT EXISTS accounts(
             user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider TEXT NOT NULL,
             provider_account_id TEXT NOT NULL, PRIMARY KEY(provider, provider_account_id))`,
          `CREATE TABLE IF NOT EXISTS handoffs(
             code TEXT PRIMARY KEY, state TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
             expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)`,
          // one-click Connect Slack (lib/slack.ts): short-lived, deleted once claimed
          `CREATE TABLE IF NOT EXISTS slack_states(
             state TEXT PRIMARY KEY, challenge TEXT NOT NULL, user_id TEXT, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)`,
          `CREATE TABLE IF NOT EXISTS slack_handoffs(
             code TEXT PRIMARY KEY, sealed TEXT NOT NULL, challenge TEXT NOT NULL, user_id TEXT, team TEXT NOT NULL DEFAULT '',
             slack_user TEXT NOT NULL DEFAULT '', expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)`,
          // presence + phone relay (see docs/mobile-api.md, lib/mobile.ts)
          `CREATE TABLE IF NOT EXISTS presence(
             user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL, since TEXT NOT NULL)`,
          `CREATE TABLE IF NOT EXISTS mobile_devices(
             id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
             platform TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, push_token TEXT, created_at TEXT NOT NULL, last_seen TEXT NOT NULL)`,
          `CREATE TABLE IF NOT EXISTS pair_codes(
             code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
             expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)`,
          `CREATE TABLE IF NOT EXISTS notifications(
             id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
             kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, data TEXT, created_at TEXT NOT NULL)`,
          `CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, id)`,
        ],
        "write",
      )
      .then(() => undefined)
      .catch((e) => {
        ready = null;
        throw e;
      });
  }
  return ready;
}

/** The ready (tables created) client, for feature modules like lib/mobile.ts. */
export async function readyDb(): Promise<Client> {
  await init();
  return db();
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

const toUser = (r: Record<string, unknown>): User => ({
  id: String(r.id),
  email: String(r.email),
  name: String(r.name ?? ""),
  image: (r.image as string | null) ?? null,
});

export async function findUserByEmail(email: string): Promise<Row | null> {
  await init();
  const rs = await db().execute({ sql: "SELECT * FROM users WHERE email = ?", args: [normalizeEmail(email)] });
  const r = rs.rows[0] as unknown as Record<string, unknown> | undefined;
  return r ? { ...toUser(r), password_hash: (r.password_hash as string | null) ?? null } : null;
}

export async function findUserById(id: string): Promise<User | null> {
  await init();
  const rs = await db().execute({ sql: "SELECT id, email, name, image FROM users WHERE id = ?", args: [id] });
  const r = rs.rows[0] as unknown as Record<string, unknown> | undefined;
  return r ? toUser(r) : null;
}

export class EmailTakenError extends Error {}

export async function createUser(name: string, email: string, password: string): Promise<User> {
  await init();
  const id = randomUUID();
  const hash = await bcrypt.hash(password, 10);
  try {
    await db().execute({
      sql: "INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [id, normalizeEmail(email), name.trim(), hash, new Date().toISOString()],
    });
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      // a Google-only account may already exist for this email: attach a password to it
      const existing = await findUserByEmail(email);
      if (existing && !existing.password_hash) {
        await db().execute({ sql: "UPDATE users SET password_hash = ?, name = COALESCE(NULLIF(name, ''), ?) WHERE id = ?", args: [hash, name.trim(), existing.id] });
        return toUser(existing as unknown as Record<string, unknown>);
      }
      throw new EmailTakenError("An account with this email already exists. Sign in instead.");
    }
    throw e;
  }
  return { id, email: normalizeEmail(email), name: name.trim(), image: null };
}

// a real cost-10 hash so unknown emails take about as long as wrong passwords
let dummy: string | null = null;
const dummyHash = () => (dummy ??= bcrypt.hashSync(randomBytes(16).toString("hex"), 10));

/** Email + password check. Returns the user or null (same timing either way). */
export async function verifyPassword(email: string, password: string): Promise<User | null> {
  const u = await findUserByEmail(email);
  const ok = await bcrypt.compare(password, u?.password_hash ?? dummyHash());
  return u && u.password_hash && ok ? { id: u.id, email: u.email, name: u.name, image: u.image } : null;
}

/** Google sign-in: find by linked account, else by email (links it), else create. */
export async function upsertOAuthUser(provider: string, providerAccountId: string, email: string, name: string, image?: string | null): Promise<User> {
  await init();
  const linked = await db().execute({
    sql: "SELECT u.id, u.email, u.name, u.image FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.provider = ? AND a.provider_account_id = ?",
    args: [provider, providerAccountId],
  });
  if (linked.rows[0]) return toUser(linked.rows[0] as unknown as Record<string, unknown>);
  let user: User | null = await findUserByEmail(email);
  if (!user) {
    const id = randomUUID();
    await db().execute({
      sql: "INSERT INTO users (id, email, name, image, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [id, normalizeEmail(email), name || email.split("@")[0], image ?? null, new Date().toISOString()],
    });
    user = { id, email: normalizeEmail(email), name, image };
  } else if (image && !user.image) {
    await db().execute({ sql: "UPDATE users SET image = ? WHERE id = ?", args: [image, user.id] });
  }
  await db().execute({
    sql: "INSERT OR IGNORE INTO accounts (user_id, provider, provider_account_id) VALUES (?, ?, ?)",
    args: [user.id, provider, providerAccountId],
  });
  return { id: user.id, email: user.email, name: user.name, image: user.image ?? null };
}

/** One-time code (5 min) the website hands to the desktop app. */
export async function createHandoff(userId: string, state: string): Promise<string> {
  await init();
  const code = randomBytes(18).toString("base64url");
  await db().execute({
    sql: "INSERT INTO handoffs (code, state, user_id, expires_at) VALUES (?, ?, ?, ?)",
    args: [code, state, userId, Date.now() + 5 * 60_000],
  });
  return code;
}

/** Redeem a handoff code once. `state` (when given) must match the one it was issued for. */
export async function redeemHandoff(code: string, state?: string): Promise<User | null> {
  await init();
  const rs = await db().execute({
    sql: "UPDATE handoffs SET used = 1 WHERE code = ? AND used = 0 AND expires_at > ? RETURNING user_id, state",
    args: [code, Date.now()],
  });
  const r = rs.rows[0] as unknown as { user_id: string; state: string } | undefined;
  if (!r) return null;
  if (state && state !== r.state) return null;
  return findUserById(r.user_id);
}

// ── one-click Connect Slack (see lib/slack.ts) ──────────────────────────────
/** One-time OAuth state for Connect Slack, bound to the desktop's challenge (and Flo account when signed in). */
export async function createSlackState(state: string, challenge: string, userId: string | null, ttlMs: number): Promise<void> {
  await init();
  const now = Date.now();
  await db().execute({ sql: "DELETE FROM slack_states WHERE expires_at < ?", args: [now] });
  await db().execute({
    sql: "INSERT INTO slack_states (state, challenge, user_id, expires_at) VALUES (?, ?, ?, ?)",
    args: [state, challenge, userId, now + ttlMs],
  });
}

/** Is this state live (issued, unused, unexpired)? Doesn't consume it. */
export async function slackStateLive(state: string): Promise<boolean> {
  await init();
  const rs = await db().execute({ sql: "SELECT 1 FROM slack_states WHERE state = ? AND used = 0 AND expires_at > ?", args: [state, Date.now()] });
  return rs.rows.length > 0;
}

/** Consume a state once (the OAuth callback). */
export async function consumeSlackState(state: string): Promise<{ challenge: string; userId: string | null } | null> {
  await init();
  const rs = await db().execute({
    sql: "UPDATE slack_states SET used = 1 WHERE state = ? AND used = 0 AND expires_at > ? RETURNING challenge, user_id",
    args: [state, Date.now()],
  });
  const r = rs.rows[0] as unknown as { challenge: string; user_id: string | null } | undefined;
  if (!r) return null;
  await db().execute({ sql: "DELETE FROM slack_states WHERE state = ?", args: [state] });
  return { challenge: String(r.challenge), userId: r.user_id ? String(r.user_id) : null };
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
  await init();
  const now = Date.now();
  await db().execute({ sql: "DELETE FROM slack_handoffs WHERE expires_at < ?", args: [now] });
  await db().execute({
    sql: "INSERT INTO slack_handoffs (code, sealed, challenge, user_id, team, slack_user, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [h.code, h.sealed, h.challenge, h.userId, h.team, h.slackUser, now + h.ttlMs],
  });
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
  await init();
  const rs = await db().execute({
    sql: `UPDATE slack_handoffs SET used = 1
          WHERE code = ? AND challenge = ? AND used = 0 AND expires_at > ? AND (user_id IS NULL OR user_id = ?)
          RETURNING sealed, team, slack_user`,
    args: [code, challenge, Date.now(), userId ?? ""],
  });
  const r = rs.rows[0] as unknown as { sealed: string; team: string; slack_user: string } | undefined;
  if (!r) return null;
  await db().execute({ sql: "DELETE FROM slack_handoffs WHERE code = ?", args: [code] });
  return { sealed: String(r.sealed), team: String(r.team ?? ""), slackUser: String(r.slack_user ?? "") };
}
