// Encrypted sync API (website/app/api/sync) against a running dev server.
// Run: FLO_TEST_DATABASE_URL=postgres://postgres@localhost:54329/flo_test node --test tests/sync-routes.test.mjs
// The dev server must use the same database (DATABASE_URL, with migration 0004 applied) and AUTH_SECRET.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { appToken, BASE, connect, loadEnv, seedUser, testDbUrl } from "./helpers.mjs";

const env = loadEnv();
const dbUrl = testDbUrl();
const skip = dbUrl && env.AUTH_SECRET ? false : "set FLO_TEST_DATABASE_URL (local Postgres the dev server uses) and AUTH_SECRET";
const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
let sql;
const users = [];

before(async () => {
  if (skip) return;
  sql = connect(dbUrl);
});
after(async () => {
  if (!sql) return;
  if (users.length) await sql`delete from auth.users where id in ${sql(users)}`;
  await sql.end();
});

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function newUser() {
  const u = await seedUser(sql, { name: "Sync Tester", email: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com` });
  users.push(u.id);
  return { token: await appToken(env.AUTH_SECRET, u.id, "10m"), id: u.id };
}
const item = (o = {}) => ({ kind: "todos", id: "t1", rev: 10, nonce: "bm9uY2U=", ct: "Y2lwaGVy", deleted: false, ...o });

test("needs the app token", { skip }, async () => {
  assert.equal((await call("GET", "/api/sync/pull")).status, 401);
  assert.equal((await call("POST", "/api/sync/push", { body: { items: [] } })).status, 401);
});

test("push, last writer wins, pull pages by cursor, wipe", { skip }, async () => {
  const a = await newUser();
  const b = await newUser();
  assert.equal((await call("POST", "/api/sync/push", { token: a.token, body: { items: [item(), item({ id: "t2" })] } })).json.accepted, 2);
  // an older rev for t1 is ignored; a newer tombstone for t2 wins
  const r = await call("POST", "/api/sync/push", { token: a.token, body: { items: [item({ rev: 5, ct: "T0xE" }), item({ id: "t2", rev: 20, deleted: true })] } });
  assert.equal(r.json.accepted, 1);
  const pull = await call("GET", "/api/sync/pull?since=0", { token: a.token });
  assert.equal(pull.status, 200);
  const byId = Object.fromEntries(pull.json.items.map((i) => [i.id, i]));
  assert.equal(byId.t1.ct, "Y2lwaGVy");
  assert.equal(byId.t2.deleted, true);
  assert.equal(byId.t2.ct, "");
  // nothing new after the cursor
  assert.equal((await call("GET", `/api/sync/pull?since=${pull.json.cursor}`, { token: a.token })).json.items.length, 0);
  // another account sees none of it
  assert.equal((await call("GET", "/api/sync/pull?since=0", { token: b.token })).json.items.length, 0);
  // key check: registered once, returned after
  assert.equal((await call("POST", "/api/sync/key", { token: a.token, body: {} })).json.check, null);
  assert.equal((await call("POST", "/api/sync/key", { token: a.token, body: { check: '{"n":"a","c":"b"}' } })).json.created, true);
  const again = await call("POST", "/api/sync/key", { token: a.token, body: { check: '{"n":"x","c":"y"}' } });
  assert.equal(again.json.created, false);
  assert.equal(again.json.check, '{"n":"a","c":"b"}');
  // wipe
  assert.equal((await call("DELETE", "/api/sync", { token: a.token })).status, 200);
  assert.equal((await call("GET", "/api/sync/pull?since=0", { token: a.token })).json.items.length, 0);
  assert.equal((await call("POST", "/api/sync/key", { token: a.token, body: {} })).json.check, null);
});

test("rejects bad batches", { skip }, async () => {
  const a = await newUser();
  assert.equal((await call("POST", "/api/sync/push", { token: a.token, body: { items: [item({ ct: "" })] } })).status, 400);
  assert.equal((await call("GET", "/api/sync/pull?since=-4", { token: a.token })).status, 400);
});
