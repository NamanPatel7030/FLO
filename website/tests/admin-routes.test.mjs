// /admin and /api/admin/* answer 404 to anyone who isn't a listed admin (same as a missing page), against a
// running server WITHOUT ADMIN_DEMO. No database needed: the gate decides before any query.
//   FLO_SITE=http://localhost:3000 node --test tests/admin-routes.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const base = process.env.FLO_SITE || "";
const skip = base ? false : "set FLO_SITE to a running dev server (without ADMIN_DEMO) to run";

const get = (path, headers = {}) => fetch(base + path, { headers, redirect: "manual" });

test("signed-out visitors get a 404 everywhere under /admin", { skip }, async () => {
  for (const p of ["/admin", "/admin/users", "/admin/users?filter=at_risk", "/admin/users/00000000-0000-4000-8000-000000000001", "/api/admin/users"]) {
    const r = await get(p);
    assert.equal(r.status, 404, p);
    const body = await r.text();
    assert.doesNotMatch(body, /Who.s using Flo|demo@flo\.local|text\/csv|Email,Name/, p);
  }
});

test("an app token or a forged Supabase cookie doesn't open it", { skip }, async () => {
  for (const headers of [{ authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.e30.x" }, { cookie: "sb-x-auth-token=base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0" }]) {
    for (const p of ["/admin", "/api/admin/users"]) assert.equal((await get(p, headers)).status, 404, `${p} ${Object.keys(headers)[0]}`);
  }
});

test("the 404 looks like any missing page", { skip }, async () => {
  const meta = async (p) => ((await (await get(p)).text()).match(/<(meta|title)[^>]*>[^<]*/g) ?? []).join("\n");
  assert.equal(await meta("/admin"), await meta("/no-such-page-here"));
});
