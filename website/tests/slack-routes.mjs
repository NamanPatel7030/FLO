// Connect Slack routes against the running dev server (no real Slack calls, no real tokens).
//   cd website && node tests/slack-routes.mjs        (needs `npm run dev` on :3000; never `next build`)
// Covers: setup page when SLACK_CLIENT_ID/SECRET are missing, start/state validation (CSRF cookie,
// single use, cancel), claim single-use + verifier + account binding + expiry + rate limit.
// Handoff rows are seeded straight into the DB, sealed exactly like lib/slack.ts does.
import { createClient } from "@libsql/client";
import { SignJWT } from "jose";
import { createCipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.FLO_SITE ?? "http://localhost:3000";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(resolve(root, ".env.local"), "utf8")
    .split("\n")
    .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
);
const SECRET = env.AUTH_SECRET;
if (!SECRET) throw new Error("website/.env.local has no AUTH_SECRET");
const dbUrl = (env.DATABASE_URL || "file:./flo.db").replace(/^file:\.\//, `file:${root}/`);
const db = createClient({ url: dbUrl, authToken: env.DATABASE_AUTH_TOKEN || undefined });

// a fresh fake client IP per run so the per-IP limiter doesn't carry over between runs
const ip = `10.${rnd(255)}.${rnd(255)}.${rnd(255)}`;
function rnd(n) {
  return Math.floor(Math.random() * n);
}
const H = (extra = {}) => ({ "x-forwarded-for": ip, ...extra });

let pass = 0;
let fail = 0;
function check(name, ok, info = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !info ? "" : `  → ${info}`}`);
}

const b64u = (b) => Buffer.from(b).toString("base64url");
const challengeOf = (v) => createHash("sha256").update(v).digest("base64url");
function seal(plain, aad) {
  const key = Buffer.from(hkdfSync("sha256", SECRET, "", "flo/slack-handoff/v1", 32));
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}
const get = (path, headers = {}) => fetch(BASE + path, { redirect: "manual", headers: H(headers) });
const post = (path, body, headers = {}) =>
  fetch(BASE + path, { method: "POST", redirect: "manual", headers: H({ "content-type": "application/json", ...headers }), body: JSON.stringify(body) });
const loc = (r) => r.headers.get("location") ?? "";

async function seed({ code = b64u(randomBytes(24)), verifier = b64u(randomBytes(32)), userId = null, ttl = 5 * 60_000, token = "xoxp-test-not-a-real-token" } = {}) {
  await db.execute({
    sql: "INSERT INTO slack_handoffs (code, sealed, challenge, user_id, team, slack_user, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [code, seal(token, code), challengeOf(verifier), userId, "Northwind", "U123", Date.now() + ttl],
  });
  return { code, verifier, token };
}
const rows = async (code) => (await db.execute({ sql: "SELECT 1 FROM slack_handoffs WHERE code = ?", args: [code] })).rows.length;

// ── 1. developer setup page when Slack isn't configured ──────────────────────
const configured = !!(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET);
{
  const r = await get("/api/slack/install?state=whatever");
  if (configured) {
    check("install with unknown state → expired page (Slack configured)", r.status === 302 && loc(r).includes("/slack/connected?error=expired"), `${r.status} ${loc(r)}`);
  } else {
    check("install without SLACK_CLIENT_ID/SECRET → setup page", r.status === 302 && loc(r).endsWith("/slack/setup"), `${r.status} ${loc(r)}`);
    const p = await get("/slack/setup");
    const html = await p.text();
    check("setup page names the missing keys", p.status === 200 && html.includes("SLACK_CLIENT_ID") && html.includes("SLACK_CLIENT_SECRET"));
    check("setup page prints a manifest with this site's callback + all user scopes", html.includes("/api/slack/callback") && html.includes("search:read") && html.includes("chat:write"));
    check("setup page never prints secret values", !html.includes(SECRET));
  }
}

// ── 2. start + state validation ─────────────────────────────────────────────
{
  const bad = await post("/api/slack/start", { challenge: "short" });
  check("start rejects a malformed challenge", bad.status === 400, String(bad.status));
  const verifier = b64u(randomBytes(32));
  const r = await post("/api/slack/start", { challenge: challengeOf(verifier) });
  const j = await r.json();
  const state = new URL(j.url ?? "http://x/").searchParams.get("state") ?? "";
  check("start returns this site's install URL with a one-time state", r.status === 200 && j.url.startsWith(`${BASE}/api/slack/install?state=`) && state.length >= 30, JSON.stringify(j));

  const noCookie = await get(`/api/slack/callback?state=${state}&code=fake`);
  check("callback without the browser's state cookie → error=state (CSRF)", loc(noCookie).includes("error=state"), loc(noCookie));
  const wrongCookie = await get(`/api/slack/callback?state=${state}&code=fake`, { cookie: "flo_slack_state=someone-elses" });
  check("callback with a different state cookie → error=state", loc(wrongCookie).includes("error=state"), loc(wrongCookie));
  const unknown = await get(`/api/slack/callback?state=nope-not-issued&code=fake`, { cookie: "flo_slack_state=nope-not-issued" });
  check("callback with an unissued state → error=expired", loc(unknown).includes("error=expired"), loc(unknown));
  const denied = await get(`/api/slack/callback?state=${state}&error=access_denied`, { cookie: `flo_slack_state=${state}` });
  check("user cancels on Slack → error=denied, cookie cleared", loc(denied).includes("error=denied") && /flo_slack_state=;/.test(denied.headers.get("set-cookie") ?? ""), loc(denied));
  const again = await get(`/api/slack/callback?state=${state}&code=fake`, { cookie: `flo_slack_state=${state}` });
  check("the same state can't be used twice → error=expired", loc(again).includes("error=expired"), loc(again));
  const replay = await get(`/api/slack/install?state=${state}`);
  check("install with a used state never reaches Slack", replay.status === 302 && !loc(replay).includes("slack.com"), loc(replay));

  // an expired state
  await db.execute({ sql: "INSERT INTO slack_states (state, challenge, user_id, expires_at) VALUES (?, ?, NULL, ?)", args: ["old-state-" + ip, challengeOf("x"), Date.now() - 1000] });
  const old = await get(`/api/slack/callback?state=old-state-${ip}&code=fake`, { cookie: `flo_slack_state=old-state-${ip}` });
  check("expired state → error=expired", loc(old).includes("error=expired"), loc(old));

  const page = await get("/slack/connected?error=denied");
  check("error page explains what happened", (await page.text()).includes("cancelled on Slack"));
  const ok = await get("/slack/connected?code=abcdefghijklmnopqrstuvwx&team=Northwind");
  const okHtml = await ok.text();
  check("success page: Slack connected, close this tab, hands off via flo://slack", okHtml.includes("Slack connected") && okHtml.includes("close this tab") && okHtml.includes("flo://slack?code=abcdefghijklmnopqrstuvwx"));
}

// ── 3. claim: single use, verifier, account binding, expiry ─────────────────
{
  const warm = await post("/api/slack/claim", { code: "nope", verifier: b64u(randomBytes(32)) });
  check("claim with an unknown code → 401", warm.status === 401, String(warm.status));
  check("claim without a verifier → 400", (await post("/api/slack/claim", { code: "abc" })).status === 400);

  const h = await seed();
  const wrong = await post("/api/slack/claim", { code: h.code, verifier: b64u(randomBytes(32)) });
  check("claim with the wrong verifier → 401", wrong.status === 401, String(wrong.status));
  check("…and doesn't burn the code", (await rows(h.code)) === 1);
  const good = await post("/api/slack/claim", { code: h.code, verifier: h.verifier });
  const gj = await good.json();
  check("claim with code + verifier → the token (once)", good.status === 200 && gj.token === h.token && gj.team === "Northwind", JSON.stringify(gj));
  check("claim response isn't cacheable", (good.headers.get("cache-control") ?? "").includes("no-store"));
  check("row deleted after the claim", (await rows(h.code)) === 0);
  const twice = await post("/api/slack/claim", { code: h.code, verifier: h.verifier });
  check("second claim of the same code → 401", twice.status === 401, String(twice.status));

  const ex = await seed({ ttl: -1000 });
  const expired = await post("/api/slack/claim", { code: ex.code, verifier: ex.verifier });
  check("expired handoff → 401", expired.status === 401, String(expired.status));

  const sealedRow = (await db.execute({ sql: "SELECT sealed FROM slack_handoffs WHERE code = ?", args: [ex.code] })).rows[0];
  check("token is stored encrypted, not in plain text", !!sealedRow && !String(sealedRow.sealed).includes("xoxp-"));

  const bound = await seed({ userId: "u_slack_test" });
  const anon = await post("/api/slack/claim", { code: bound.code, verifier: bound.verifier });
  check("account-bound handoff without the app session → 401", anon.status === 401, String(anon.status));
  const key = new TextEncoder().encode(SECRET);
  const other = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("u_someone_else").setIssuedAt().setExpirationTime("5m").sign(key);
  const mismatch = await post("/api/slack/claim", { code: bound.code, verifier: bound.verifier }, { authorization: `Bearer ${other}` });
  check("…with another account's session → 401", mismatch.status === 401, String(mismatch.status));
  const mine = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("u_slack_test").setIssuedAt().setExpirationTime("5m").sign(key);
  const right = await post("/api/slack/claim", { code: bound.code, verifier: bound.verifier }, { authorization: `Bearer ${mine}` });
  check("…with the same account's session → 200", right.status === 200, String(right.status));

  // rate limit (30 / 15 min per IP); this run already used some
  let limited = false;
  for (let i = 0; i < 35 && !limited; i++) limited = (await post("/api/slack/claim", { code: "x" + i, verifier: b64u(randomBytes(32)) })).status === 429;
  check("claim is rate-limited per IP", limited);
  await db.execute({ sql: "DELETE FROM slack_handoffs WHERE code = ?", args: [ex.code] });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
