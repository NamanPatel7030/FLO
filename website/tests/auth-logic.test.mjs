// Pure auth helpers (no server, no database): node --test tests/auth-logic.test.mjs
// Node 22.18+/24 runs these .ts files directly (type stripping); they have no imports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { authMessage, classifyAuthError, isExistingAccountSignup } from "../lib/auth-messages.ts";
import { authNotice } from "../lib/site.ts";
import { safeNext } from "../lib/validate.ts";

test("Supabase error codes map to the right problem", () => {
  const cases = [
    [{ code: "invalid_credentials", message: "Invalid login credentials" }, "invalid_credentials"],
    [{ message: "Invalid login credentials" }, "invalid_credentials"],
    [{ code: "email_not_confirmed" }, "email_not_confirmed"],
    [{ message: "Email not confirmed" }, "email_not_confirmed"],
    [{ code: "user_already_exists" }, "user_already_exists"],
    [{ code: "email_exists" }, "user_already_exists"],
    [{ message: "User already registered" }, "user_already_exists"],
    [{ code: "weak_password" }, "weak_password"],
    [{ code: "same_password" }, "same_password"],
    [{ code: "over_email_send_rate_limit" }, "rate_limited"],
    [{ code: "over_request_rate_limit" }, "rate_limited"],
    [{ status: 429, message: "x" }, "rate_limited"],
    [{ code: "validation_failed", message: "Unsupported provider: provider is not enabled" }, "provider_disabled"],
    [{ code: "provider_disabled" }, "provider_disabled"],
    [{ code: "signup_disabled" }, "signup_disabled"],
    [{ message: "Auth session missing!" }, "session_missing"],
    [{ message: "Failed to fetch" }, "network"],
    [{ message: "something odd" }, "unknown"],
    [null, "unknown"],
  ];
  for (const [err, want] of cases) assert.equal(classifyAuthError(err), want, JSON.stringify(err));
});

test("friendly copy: login, unconfirmed email, Google off, context-specific fallbacks", () => {
  assert.match(authMessage("invalid_credentials"), /don't match/);
  assert.match(authMessage("email_not_confirmed"), /^Confirm your email first/);
  assert.match(authMessage("provider_disabled"), /Google sign-in isn't turned on/);
  assert.match(authMessage("rate_limited", "signup"), /sent a few emails/);
  assert.match(authMessage("rate_limited", "login"), /Too many attempts/);
  assert.match(authMessage("unknown", "signup"), /create your account/);
  assert.match(authMessage("unknown", "reset"), /update your password/);
  assert.match(authMessage("unknown", "forgot"), /send the email/);
  // house style: no em dashes in user-facing copy
  for (const p of ["invalid_credentials", "email_not_confirmed", "user_already_exists", "weak_password", "same_password", "rate_limited", "provider_disabled", "signup_disabled", "session_missing", "network", "unknown"]) {
    for (const ctx of ["login", "signup", "reset", "forgot", "google"]) assert.ok(!authMessage(p, ctx).includes("—"), `${p}/${ctx}`);
  }
});

test("existing-account detection for obfuscated sign-ups (confirmations on)", () => {
  assert.equal(isExistingAccountSignup({ identities: [] }), true);
  assert.equal(isExistingAccountSignup({ identities: [{ provider: "email" }] }), false);
  assert.equal(isExistingAccountSignup({}), false);
  assert.equal(isExistingAccountSignup(null), false);
});

test("next= stays a same-site relative path (no open redirects)", () => {
  assert.equal(safeNext("/download?os=mac"), "/download?os=mac");
  assert.equal(safeNext("/app/connect?state=abc"), "/app/connect?state=abc");
  for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "evil", "", null, undefined, 42]) assert.equal(safeNext(bad), "/download", String(bad));
  assert.equal(safeNext("//x", "/auth/reset"), "/auth/reset");
});

test("callback ?error= codes have a message; unknown ones show nothing", () => {
  for (const c of ["link", "google", "provider", "config"]) assert.ok(authNotice(c));
  assert.equal(authNotice("<script>"), null);
  assert.equal(authNotice(undefined), null);
});
