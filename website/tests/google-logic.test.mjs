// Connect Google pure logic (no server, no database, no Google):
//   node --test tests/google-logic.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeParams,
  claimResponse,
  emailFromIdToken,
  grantedKeys,
  loadScopeKeys,
  parseCodeResponse,
  parseRefreshBody,
  parseRefreshResponse,
  parseScopeKeys,
  scopeParam,
  storeScopeKeys,
} from "../lib/google-logic.ts";

const CAL = "https://www.googleapis.com/auth/calendar.readonly";
const GR = "https://www.googleapis.com/auth/gmail.readonly";
const GS = "https://www.googleapis.com/auth/gmail.send";
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const idToken = (payload) => `${b64u({ alg: "RS256", typ: "JWT" })}.${b64u(payload)}.c2lnbmF0dXJl`;

test("scope keys: known, deduped, ordered; anything else rejected", () => {
  assert.deepEqual(parseScopeKeys(["gmail", "calendar", "gmail"]), ["calendar", "gmail"]);
  assert.deepEqual(parseScopeKeys(["calendar"]), ["calendar"]);
  for (const bad of [[], undefined, null, "calendar", ["drive"], ["calendar", 1], ["Calendar"], Array(9).fill("gmail")]) {
    assert.equal(parseScopeKeys(bad), null, JSON.stringify(bad));
  }
  assert.equal(storeScopeKeys(["calendar", "gmail"]), "calendar gmail");
  assert.deepEqual(loadScopeKeys("gmail calendar junk"), ["calendar", "gmail"]);
  assert.deepEqual(loadScopeKeys(""), []);
});

test("scope param: always openid email, plus each product's scopes", () => {
  assert.equal(scopeParam(["calendar"]), `openid email ${CAL}`);
  assert.equal(scopeParam(["gmail"]), `openid email ${GR} ${GS}`);
  assert.equal(scopeParam(["calendar", "gmail"]), `openid email ${CAL} ${GR} ${GS}`);
});

test("granted keys: Gmail needs both scopes", () => {
  assert.deepEqual(grantedKeys(`openid ${CAL} email ${GR} ${GS}`), ["calendar", "gmail"]);
  assert.deepEqual(grantedKeys(`openid email ${GR}`), []);
  assert.deepEqual(grantedKeys(`${CAL} https://www.googleapis.com/auth/userinfo.email`), ["calendar"]);
  assert.deepEqual(grantedKeys(""), []);
});

test("authorize params: offline + consent + incremental, code flow, our redirect", () => {
  const p = authorizeParams({ clientId: "cid.apps.googleusercontent.com", redirectUri: "https://flo.hellonaman.com/api/google/callback", state: "st", keys: ["calendar"] });
  assert.deepEqual(p, {
    client_id: "cid.apps.googleusercontent.com",
    redirect_uri: "https://flo.hellonaman.com/api/google/callback",
    response_type: "code",
    scope: `openid email ${CAL}`,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: "st",
  });
});

test("email from id_token payload (base64url, unicode), empty when absent or broken", () => {
  assert.equal(emailFromIdToken(idToken({ email: "riya@example.com", email_verified: true })), "riya@example.com");
  assert.equal(emailFromIdToken(idToken({ email: "zoë@exämple.com" })), "zoë@exämple.com");
  assert.equal(emailFromIdToken(idToken({ sub: "1" })), "");
  assert.equal(emailFromIdToken(idToken({ email: "not an email" })), "");
  for (const bad of ["", "a", "a.b.c", "a.!!!.c", 42, null, `x.${"A".repeat(9000)}.y`]) assert.equal(emailFromIdToken(bad), "", String(bad).slice(0, 20));
});

test("code response: needs access + refresh token; keeps scope, email, sane expiry", () => {
  const ok = parseCodeResponse(200, {
    access_token: "ya29.a0-access-token",
    refresh_token: "1//0g-refresh-token",
    expires_in: 3599,
    scope: `openid ${CAL} email`,
    token_type: "Bearer",
    id_token: idToken({ email: "riya@example.com" }),
  });
  assert.deepEqual(ok, {
    ok: true,
    tokens: { accessToken: "ya29.a0-access-token", refreshToken: "1//0g-refresh-token", expiresIn: 3599, scope: `openid ${CAL} email`, email: "riya@example.com" },
  });
  assert.deepEqual(parseCodeResponse(200, { access_token: "ya29.a0-access-token" }), { ok: false, error: "no_refresh_token" });
  assert.deepEqual(parseCodeResponse(200, { refresh_token: "1//0g-refresh-token" }), { ok: false, error: "no_access_token" });
  assert.deepEqual(parseCodeResponse(400, { error: "invalid_grant", error_description: "Bad Request" }), { ok: false, error: "invalid_grant" });
  assert.deepEqual(parseCodeResponse(500, "oops"), { ok: false, error: "http_500" });
  assert.deepEqual(parseCodeResponse(400, { error: "<script>" }), { ok: false, error: "http_400" });
  const odd = parseCodeResponse(200, { access_token: "ya29.a0-access-token", refresh_token: "1//0g-refresh-token", expires_in: "abc" });
  assert.equal(odd.tokens.expiresIn, 3600);
  assert.equal(odd.tokens.email, "");
  assert.equal(parseCodeResponse(200, { access_token: "has space token", refresh_token: "1//0g-refresh-token" }).ok, false);
});

test("refresh response: access token, expiry, optional scope; invalid_grant is its own error", () => {
  assert.deepEqual(parseRefreshResponse(200, { access_token: "ya29.fresh-token", expires_in: 3599, scope: CAL }), { ok: true, accessToken: "ya29.fresh-token", expiresIn: 3599, scope: CAL });
  assert.deepEqual(parseRefreshResponse(200, { access_token: "ya29.fresh-token", expires_in: 3599 }), { ok: true, accessToken: "ya29.fresh-token", expiresIn: 3599 });
  assert.deepEqual(parseRefreshResponse(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }), { ok: false, error: "invalid_grant" });
  assert.deepEqual(parseRefreshResponse(401, { error: "invalid_client" }), { ok: false, error: "google" });
  assert.deepEqual(parseRefreshResponse(200, {}), { ok: false, error: "google" });
  assert.equal(parseRefreshResponse(200, { access_token: "ya29.fresh-token", expires_in: 1e9 }).expiresIn, 86400);
});

test("refresh body: {refresh_token} printable, bounded", () => {
  assert.deepEqual(parseRefreshBody({ refresh_token: "1//0g-refresh-token" }), { refreshToken: "1//0g-refresh-token" });
  for (const bad of [null, [], "x", {}, { refresh_token: 5 }, { refresh_token: "short" }, { refresh_token: "has a space in it" }, { refresh_token: "x".repeat(5000) }, { refreshToken: "1//0g-refresh-token" }]) {
    assert.ok("error" in parseRefreshBody(bad), JSON.stringify(bad).slice(0, 40));
  }
});

test("claim response: camelCase, expiry counts down from when Google issued it", () => {
  const now = 1_800_000_000_000;
  const plain = JSON.stringify({ refresh_token: "1//r", access_token: "ya29.a", expires_in: 3599, scope: CAL, email: "riya@example.com", obtained_at: now - 120_000 });
  assert.deepEqual(claimResponse(plain, now), { refreshToken: "1//r", accessToken: "ya29.a", expiresIn: 3479, scope: CAL, email: "riya@example.com" });
  assert.equal(claimResponse(JSON.stringify({ refresh_token: "1//r", access_token: "ya29.a", expires_in: 10, obtained_at: now - 60_000 }), now).expiresIn, 0);
  assert.equal(claimResponse("not json", now), null);
  assert.equal(claimResponse(JSON.stringify({ access_token: "ya29.a" }), now), null);
});
