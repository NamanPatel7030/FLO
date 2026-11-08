// Presence + phone relay API (docs/mobile-api.md) against a running dev server.
// Run: node --test tests/mobile-api.test.mjs   (BASE=http://localhost:3000 by default)
import { test } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.BASE || "http://localhost:3000";
// spread requests over fake client IPs so the per-IP limiters don't trip on reruns
const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

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
  const email = `presence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = "correct horse battery";
  const s = await call("POST", "/api/signup", { body: { name: "Pres Tester", email, password } });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  const l = await call("POST", "/api/app/login", { body: { email, password } });
  assert.equal(l.status, 200, JSON.stringify(l.json));
  return { token: l.json.token, email };
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

test("everything needs auth", async () => {
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

test("presence defaults to active and toggles; since is kept when unchanged", async () => {
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

test("pairing: QR payload + code, single use, device token works for mobile routes only", async () => {
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

test("phone can sign itself out", async () => {
  const { token } = await newUser();
  const { claim } = await pairPhone(token);
  assert.equal((await call("DELETE", "/api/mobile/device", { token: claim.deviceToken })).status, 200);
  assert.equal((await call("GET", "/api/mobile/devices", { token })).json.length, 0);
});

test("bad codes are rejected", async () => {
  const r = await call("POST", "/api/mobile/pair/claim", { body: { code: "12", deviceName: "x", platform: "android" } });
  assert.equal(r.status, 400);
  const ios = await call("POST", "/api/mobile/pair/claim", { body: { code: "123 456", deviceName: "x", platform: "ios" } });
  assert.equal(ios.status, 400);
});

test("push: stored always, pushed only while away; inbox pages by id", async () => {
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

test("claim accepts the full QR payload (with ?scheme=)", async () => {
  const { token } = await newUser();
  const start = await call("POST", "/api/mobile/pair/start", { token });
  const claim = await call("POST", "/api/mobile/pair/claim", { body: { code: start.json.payload, deviceName: "Pixel 9", platform: "android" } });
  assert.equal(claim.status, 200, JSON.stringify(claim.json));
});
