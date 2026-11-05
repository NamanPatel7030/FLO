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
