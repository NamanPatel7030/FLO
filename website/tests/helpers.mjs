// Shared bits for the website tests. Integration tests need a Postgres the dev server also uses:
//   FLO_TEST_DATABASE_URL=postgres://postgres@localhost:54329/flo_test
// with supabase/tests/supabase-stub.sql + supabase/migrations/0001_init.sql applied (tests/migration.test.mjs
// does that), and the dev server started with the same DATABASE_URL (e.g. in .env.development.local).
// Test users are inserted straight into the stub's auth.users, so this refuses to run against a remote
// database unless FLO_TEST_ALLOW_REMOTE=1: never point it at a real Supabase project.
import postgres from "postgres";
import { SignJWT } from "jose";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BASE = process.env.BASE || process.env.FLO_SITE || "http://localhost:3000";

/** .env.local overlaid with .env.development.local (same precedence as `next dev`), then process.env. */
export function loadEnv() {
  const out = {};
  for (const f of [".env.local", ".env.development.local"]) {
    const p = resolve(root, f);
    if (!existsSync(p)) continue;
    for (const l of readFileSync(p, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return { ...out, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(AUTH_SECRET|DATABASE_URL|SLACK_|NEXT_PUBLIC_)/.test(k))) };
}

export function testDbUrl() {
  const url = process.env.FLO_TEST_DATABASE_URL || "";
  if (!url) return null;
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  if (!local && process.env.FLO_TEST_ALLOW_REMOTE !== "1") throw new Error("FLO_TEST_DATABASE_URL must be a local database (it inserts test users into auth.users).");
  return url;
}

export const connect = (url) => postgres(url, { prepare: false, max: 2, onnotice: () => {} });

/** A Supabase-shaped test user (auth.users row → profile via the trigger). */
export async function seedUser(sql, { name = "Test User", email } = {}) {
  const addr = email ?? `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const [u] = await sql`insert into auth.users (email, raw_user_meta_data) values (${addr}, ${sql.json({ name })}) returning id`;
  return { id: u.id, email: addr, name };
}

export async function appToken(secret, sub, ttl = "5m") {
  return new SignJWT({}).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(sub).setIssuedAt().setExpirationTime(ttl).sign(new TextEncoder().encode(secret));
}
