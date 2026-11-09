// Presence + phone relay API (docs/mobile-api.md) against a running dev server.
// Run: FLO_TEST_DATABASE_URL=postgres://postgres@localhost:54329/flo_test node --test tests/mobile-api.test.mjs
// The dev server must use the same database (DATABASE_URL) and AUTH_SECRET. Accounts live in Supabase
// Auth, so test users are seeded into the local stand-in's auth.users and get an app token minted
// with AUTH_SECRET, exactly what /api/app/login hands the desktop app. See tests/helpers.mjs.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { appToken, BASE, connect, loadEnv, seedUser, testDbUrl } from "./helpers.mjs";

const env = loadEnv();
const dbUrl = testDbUrl();
const skip = dbUrl && env.AUTH_SECRET ? false : "set FLO_TEST_DATABASE_URL (local Postgres the dev server uses) and AUTH_SECRET";
// spread requests over fake client IPs so the per-IP limiters don't trip on reruns
const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
let sql;
const users = [];

before(async () => {
  if (skip) return;
  sql = connect(dbUrl);
  // the dev server must be reading the same database
  const u = await newUser();
  const me = await call("GET", "/api/app/me", { token: u.token });
  assert.equal(me.status, 200, `dev server at ${BASE} can't see the test database (is its DATABASE_URL ${dbUrl}?): ${JSON.stringify(me.json)}`);
  assert.deepEqual(Object.keys(me.json.user).sort(), ["email", "id", "image", "name"]);
});
after(async () => {
  if (!sql) return;
  if (users.length) await sql`delete from auth.users where id in ${sql(users)}`;
  await sql.end();
});

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function newUser() {
  const u = await seedUser(sql, { name: "Pres Tester", email: `presence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com` });
  users.push(u.id);
  return { token: await appToken(env.AUTH_SECRET, u.id, "10m"), email: u.email, id: u.id };
}

async function pairPhone(token, pushToken = "fcm-test-token") {
  const start = await call("POST", "/api/mobile/pair/start", { token });
  assert.equal(start.status, 200);
  const claim = await call("POST", "/api/mobile/pair/claim", {
    body: { code: start.json.code, deviceName: "Pixel 9", platform: "android", pushToken },
  });
  assert.equal(claim.status, 200, JSON.stringify(claim.json));
  return { start: start.json, claim: claim.json };
}

test("everything needs auth", { skip }, async () => {
  for (const [m, p] of [
    ["GET", "/api/presence"],
    ["POST", "/api/presence"],
    ["POST", "/api/mobile/pair/start"],
    ["GET", "/api/mobile/devices"],
    ["POST", "/api/push"],
    ["GET", "/api/mobile/inbox"],
    ["POST", "/api/mobile/device"],
    ["DELETE", "/api/mobile/device"],
  ]) {
    const r = await call(m, p, { token: m === "POST" && p === "/api/push" ? "flod_bogus" : undefined, body: m === "POST" ? {} : undefined });
    assert.equal(r.status, 401, `${m} ${p}`);
  }
});

test("presence defaults to active and toggles; since is kept when unchanged", { skip }, async () => {
  const { token } = await newUser();
  const g = await call("GET", "/api/presence", { token });
  assert.equal(g.status, 200);
  assert.equal(g.json.status, "active");
  assert.ok(Date.parse(g.json.since));
  const a = await call("POST", "/api/presence", { token, body: { status: "away" } });
  assert.deepEqual(Object.keys(a.json).sort(), ["since", "status"]);
  assert.equal(a.json.status, "away");
  const again = await call("POST", "/api/presence", { token, body: { status: "away" } });
  assert.equal(again.json.since, a.json.since);
  const bad = await call("POST", "/api/presence", { token, body: { status: "afk" } });
  assert.equal(bad.status, 400);
});

test("pairing: QR payload + code, single use, device token works for mobile routes only", { skip }, async () => {
  const { token, email } = await newUser();
  const { start, claim } = await pairPhone(token);
  assert.match(start.code, /^\d{3} \d{3}$/);
  assert.equal(start.payload, `flo-pair://${new URL(BASE).host}/${start.code.replace(" ", "")}?scheme=${new URL(BASE).protocol.replace(":", "")}`);
  const ttl = Date.parse(start.expiresAt) - Date.now();
  assert.ok(ttl > 4 * 60_000 && ttl <= 5 * 60_000 + 2000, `ttl ${ttl}`);
  assert.match(claim.deviceToken, /^flod_/);
  assert.equal(claim.user.email, email);
  assert.equal(claim.server, BASE);

  // single use
  const reuse = await call("POST", "/api/mobile/pair/claim", { body: { code: start.code, deviceName: "x", platform: "android" } });
  assert.equal(reuse.status, 401);

  // device token: presence works, desktop-only routes don't
  const dev = claim.deviceToken;
  assert.equal((await call("GET", "/api/presence", { token: dev })).status, 200);
  assert.equal((await call("GET", "/api/mobile/devices", { token: dev })).status, 401);
  assert.equal((await call("POST", "/api/push", { token: dev, body: { kind: "reminder", title: "x" } })).status, 401);
  // and the desktop token can't use phone-only routes
  assert.equal((await call("GET", "/api/mobile/inbox", { token })).status, 401);

  // devices list, rotate push token, then desktop removes it
  const list = await call("GET", "/api/mobile/devices", { token });
  assert.equal(list.json.length, 1);
  assert.deepEqual(Object.keys(list.json[0]).sort(), ["id", "lastSeen", "name", "platform"]);
  assert.equal(list.json[0].name, "Pixel 9");
  assert.equal((await call("POST", "/api/mobile/device", { token: dev, body: { pushToken: "rotated" } })).json.ok, true);
  const del = await call("DELETE", `/api/mobile/devices/${list.json[0].id}`, { token });
  assert.equal(del.status, 200);
  assert.equal((await call("GET", "/api/presence", { token: dev })).status, 401);
});

test("phone can sign itself out", { skip }, async () => {
  const { token } = await newUser();
  const { claim } = await pairPhone(token);
  assert.equal((await call("DELETE", "/api/mobile/device", { token: claim.deviceToken })).status, 200);
  assert.equal((await call("GET", "/api/mobile/devices", { token })).json.length, 0);
});

test("bad codes are rejected", { skip }, async () => {
  const r = await call("POST", "/api/mobile/pair/claim", { body: { code: "12", deviceName: "x", platform: "android" } });
  assert.equal(r.status, 400);
  const ios = await call("POST", "/api/mobile/pair/claim", { body: { code: "123 456", deviceName: "x", platform: "ios" } });
  assert.equal(ios.status, 400);
});

test("push: stored always, pushed only while away; inbox pages by id", { skip }, async () => {
  const { token } = await newUser();
  const { claim } = await pairPhone(token);
  await call("POST", "/api/presence", { token, body: { status: "active" } });

  const p1 = await call("POST", "/api/push", { token, body: { kind: "claude_done", title: "Claude finished in api", body: "3 files changed" } });
  assert.equal(p1.status, 200);
  assert.equal(p1.json.stored, true);
  assert.equal(p1.json.pushed, 0);
  assert.equal(p1.json.reason, "user is active");

  await call("POST", "/api/presence", { token, body: { status: "away" } });
  const p2 = await call("POST", "/api/push", {
    token,
    body: { kind: "todos_digest", title: "3 to-dos today", body: "Ship it · Call mom · Review PR", data: { count: 3 } },
  });
  assert.equal(p2.json.stored, true);
  assert.equal(p2.json.pushed, 0);
  assert.equal(p2.json.reason, "push not configured"); // dev server has no FCM_SERVICE_ACCOUNT

  const inbox = await call("GET", "/api/mobile/inbox", { token: claim.deviceToken });
  assert.equal(inbox.json.length, 2);
  assert.deepEqual(Object.keys(inbox.json[0]).sort(), ["body", "createdAt", "data", "id", "kind", "title"]);
  assert.equal(inbox.json[1].kind, "todos_digest");
  assert.deepEqual(inbox.json[1].data, { count: "3" });
  const after = await call("GET", `/api/mobile/inbox?after=${inbox.json[0].id}`, { token: claim.deviceToken });
  assert.equal(after.json.length, 1);

  const badKind = await call("POST", "/api/push", { token, body: { kind: "spam", title: "x" } });
  assert.equal(badKind.status, 400);
  const badData = await call("POST", "/api/push", { token, body: { kind: "reminder", title: "x", data: { nested: { a: 1 } } } });
  assert.equal(badData.status, 400);
});

test("claim accepts the full QR payload (with ?scheme=)", { skip }, async () => {
  const { token } = await newUser();
  const start = await call("POST", "/api/mobile/pair/start", { token });
  const claim = await call("POST", "/api/mobile/pair/claim", { body: { code: start.json.payload, deviceName: "Pixel 9", platform: "android" } });
  assert.equal(claim.status, 200, JSON.stringify(claim.json));
});

test("app tokens: unknown, deleted or pre-Supabase (non-uuid) subjects are signed out", { skip }, async () => {
  const legacy = await appToken(env.AUTH_SECRET, "u_legacy_libsql_id");
  assert.equal((await call("GET", "/api/app/me", { token: legacy })).status, 401);
  assert.equal((await call("GET", "/api/presence", { token: legacy })).status, 401);
  const ghost = await appToken(env.AUTH_SECRET, "00000000-0000-4000-8000-000000000000");
  assert.equal((await call("GET", "/api/app/me", { token: ghost })).status, 401);
  const { token, id } = await newUser();
  assert.equal((await call("GET", "/api/app/me", { token })).status, 200);
  await sql`delete from auth.users where id = ${id}`;
  assert.equal((await call("GET", "/api/app/me", { token })).status, 401);
  const forged = await new (await import("jose")).SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(id).setExpirationTime("5m").sign(new TextEncoder().encode("not-the-secret"));
  assert.equal((await call("GET", "/api/app/me", { token: forged })).status, 401);
});

test("desktop sign-in handoff: one-time code, state-bound, 5 minutes", { skip }, async () => {
  const { id, email } = await newUser();
  // /api/app/handoff needs the browser's Supabase cookie session; seed the row it would create
  const code = `test-${Math.random().toString(36).slice(2)}`;
  await sql`insert into app.handoffs (code, state, user_id, expires_at) values (${code}, 'st-1', ${id}, now() + interval '5 minutes')`;
  assert.equal((await call("POST", "/api/app/exchange", { body: { code, state: "other" } })).status, 401, "wrong state");
  const ok = await call("POST", "/api/app/exchange", { body: { code: `${code}-2`, state: "st-1" } });
  assert.equal(ok.status, 401, "unknown code");
  await sql`insert into app.handoffs (code, state, user_id, expires_at) values (${code + "-b"}, 'st-1', ${id}, now() + interval '5 minutes')`;
  const good = await call("POST", "/api/app/exchange", { body: { code: code + "-b", state: "st-1" } });
  assert.equal(good.status, 200, JSON.stringify(good.json));
  assert.equal(good.json.user.email, email);
  assert.equal(good.json.user.id, id);
  assert.ok(good.json.token.split(".").length === 3);
  assert.equal((await call("GET", "/api/app/me", { token: good.json.token })).status, 200);
  assert.equal((await call("POST", "/api/app/exchange", { body: { code: code + "-b", state: "st-1" } })).status, 401, "single use");
  await sql`insert into app.handoffs (code, state, user_id, expires_at) values (${code + "-old"}, 'st-1', ${id}, now() - interval '1 second')`;
  assert.equal((await call("POST", "/api/app/exchange", { body: { code: code + "-old", state: "st-1" } })).status, 401, "expired");
  assert.equal((await call("POST", "/api/app/handoff", { body: { state: "x" } })).status, 401, "handoff needs a website session");
});

test("inbox keeps the newest 100 per account", { skip }, async () => {
  const { token } = await newUser();
  const { claim } = await pairPhone(token);
  await call("POST", "/api/presence", { token, body: { status: "active" } });
  const uid = (await call("GET", "/api/app/me", { token })).json.user.id;
  await sql`insert into app.notifications (user_id, kind, title) select ${uid}, 'reminder', 'n' || g from generate_series(1, 104) g`;
  const p = await call("POST", "/api/push", { token, body: { kind: "reminder", title: "last one" } });
  assert.equal(p.status, 200);
  const [{ n }] = await sql`select count(*)::int as n from app.notifications where user_id = ${uid}`;
  assert.equal(n, 100);
  const first = await call("GET", "/api/mobile/inbox", { token: claim.deviceToken });
  assert.equal(first.json.length, 100);
  assert.equal(first.json.at(-1).title, "last one");
});
