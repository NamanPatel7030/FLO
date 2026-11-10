// Phone Ask: direct-answer prompt, answer cleanup, screen-context validation and the cloud
// fallback decision (no server, no database):
//   node --test tests/phone-ask-logic.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CLOUD_AFTER_MS,
  cleanAnswer,
  cleanContext,
  cleanPhoneAnswer,
  computerOffline,
  phoneAnswerSystem,
  phoneAnswerUser,
  queuedOffline,
  shouldAnswerInCloud,
} from "../lib/phone-ask.ts";
import { root } from "./helpers.mjs";

const now = new Date("2026-11-10T10:00:00Z");
const ago = (ms) => new Date(now.getTime() - ms).toISOString();
const req = (o = {}) => ({ mode: "ask", status: "pending", createdAt: ago(CLOUD_AFTER_MS + 1000), cloudTriedAt: null, ...o });

test("cloud answers a pending ask after 8 s when the computer is off", () => {
  assert.equal(CLOUD_AFTER_MS, 8000);
  assert.equal(shouldAnswerInCloud(req(), null, now), true, "no computer ever signed in");
  assert.equal(shouldAnswerInCloud(req(), ago(13 * 60_000), now), true, "computer last seen 13 minutes ago");
});

test("cloud leaves it to the computer when it is online, too early, or already handled", () => {
  assert.equal(shouldAnswerInCloud(req(), ago(60_000), now), false, "computer online");
  assert.equal(shouldAnswerInCloud(req({ createdAt: ago(3000) }), null, now), false, "too early");
  for (const status of ["taken", "done", "failed"]) assert.equal(shouldAnswerInCloud(req({ status }), null, now), false, status);
  assert.equal(shouldAnswerInCloud(req({ cloudTriedAt: ago(2000) }), null, now), false, "cloud already tried once");
  assert.equal(shouldAnswerInCloud(req({ mode: "todo" }), null, now), false, "to-dos need the computer");
  assert.equal(shouldAnswerInCloud(req({ mode: "note" }), null, now), false, "notes need the computer");
  assert.equal(shouldAnswerInCloud(req({ createdAt: "garbage" }), null, now), false);
});

test("to-dos and notes stay queued for the computer when it is off", () => {
  assert.equal(queuedOffline(req({ mode: "todo" }), null, now), true);
  assert.equal(queuedOffline(req({ mode: "note" }), ago(20 * 60_000), now), true);
  assert.equal(queuedOffline(req({ mode: "todo" }), ago(60_000), now), false, "online: it will pick it up");
  assert.equal(queuedOffline(req({ mode: "ask" }), null, now), false);
  assert.equal(queuedOffline(req({ mode: "todo", createdAt: ago(1000) }), null, now), false);
});

test("computer offline = no snapshot, or none in 12 minutes", () => {
  assert.equal(computerOffline(null, now), true);
  assert.equal(computerOffline(ago(11 * 60_000), now), false);
  assert.equal(computerOffline(ago(12 * 60_000 + 1), now), true);
  assert.equal(computerOffline("nonsense", now), true);
});

test("phone prompt: the deliverable only, the user's language, short answers", () => {
  const p = phoneAnswerSystem("Today: 2026-11-10");
  const l = p.toLowerCase();
  assert.match(l, /inserted directly into the text field/);
  assert.match(l, /output only the finished text/);
  assert.match(l, /no preamble/);
  assert.match(l, /hinglish/);
  assert.match(l, /gujarati/);
  assert.match(l, /1-3 sentences/);
  assert.ok(p.includes("Today: 2026-11-10"));
  assert.ok(!l.includes("json"));
});

test("phone prompt matches the computer's (src-tauri/src/prompts.rs PHONE_ANSWER_RULES)", () => {
  const rs = readFileSync(resolve(root, "../src-tauri/src/prompts.rs"), "utf8");
  const m = /pub const PHONE_ANSWER_RULES: &str = r#"([\s\S]*?)"#;/.exec(rs);
  assert.ok(m, "PHONE_ANSWER_RULES not found in prompts.rs");
  assert.ok(phoneAnswerSystem("").startsWith(m[1]), "website/lib/phone-ask.ts PHONE_ANSWER_RULES drifted from prompts.rs");
});

test("user message carries the phone screen", () => {
  const u = phoneAnswerUser("how should I reply?", "App: WhatsApp (com.whatsapp)\nWindow: Priya\n\nPriya: coming tonight?");
  assert.ok(u.includes("What's on the user's phone screen (app: WhatsApp (com.whatsapp)):"), u);
  assert.ok(u.includes("Priya: coming tonight?"));
  assert.ok(u.trimEnd().endsWith("how should I reply?"));
  assert.equal(phoneAnswerUser("draft a message: happy Diwali", null), "draft a message: happy Diwali");
  assert.equal(phoneAnswerUser("x", "  "), "x");
  assert.ok(phoneAnswerUser("x", "hello").includes("What's on the user's phone screen:"));
});

test("answer cleanup strips preambles, wrapping quotes and sign-off offers", () => {
  assert.equal(cleanPhoneAnswer("Here's a draft:\n\nHappy Diwali! Wishing you light and joy."), "Happy Diwali! Wishing you light and joy.");
  assert.equal(cleanPhoneAnswer('Sure! Here is the message:\n"Happy Diwali to you and your family!"'), "Happy Diwali to you and your family!");
  assert.equal(cleanPhoneAnswer("“Happy Diwali!”"), "Happy Diwali!");
  assert.equal(cleanPhoneAnswer("Draft: Happy Diwali, Priya!"), "Happy Diwali, Priya!");
  assert.equal(cleanPhoneAnswer("```\nHappy Diwali!\n```"), "Happy Diwali!");
  assert.equal(cleanPhoneAnswer("Happy Diwali!\n\nLet me know if you'd like any changes."), "Happy Diwali!");
  assert.equal(cleanPhoneAnswer("Happy Diwali — lots of love!"), "Happy Diwali, lots of love!");
  assert.equal(cleanPhoneAnswer("Meeting at 5: see you there"), "Meeting at 5: see you there");
  assert.equal(cleanPhoneAnswer('She said "yes" and left.'), 'She said "yes" and left.');
  assert.equal(cleanPhoneAnswer("Line one\nLine two"), "Line one\nLine two");
  assert.equal(cleanPhoneAnswer("Here you go:"), "Here you go:");
  assert.equal(cleanPhoneAnswer("  "), "");
});

test("screen context: keeps lines, strips control characters, caps keeping the newest (bottom) text", () => {
  assert.equal(cleanContext(undefined), null);
  assert.equal(cleanContext(42), null);
  assert.equal(cleanContext("   \n  "), null);
  assert.equal(cleanContext("App: WhatsApp\r\n\n\n\nPriya:\u0007  hi   there "), "App: WhatsApp\n\nPriya: hi there");
  const long = "App: Chat\n" + Array.from({ length: 2000 }, (_, i) => `msg ${i}`).join("\n");
  const c = cleanContext(long);
  assert.ok(c.length <= 6000, String(c.length));
  assert.ok(c.startsWith("App: Chat\n"), "keeps the header line");
  assert.ok(c.endsWith("msg 1999"), "keeps the newest messages");
  assert.ok(!c.includes("\nmsg 0\n"));
});

test("answers keep their line breaks (an email draft stays an email)", () => {
  assert.equal(cleanAnswer("Hi Priya,\r\n\nThanks for the update.\n\n\n\nBest,\nParth\u0000"), "Hi Priya,\n\nThanks for the update.\n\nBest,\nParth");
  assert.equal(cleanAnswer("  "), null);
  assert.equal(cleanAnswer(7), null);
  const long = cleanAnswer("a".repeat(5000));
  assert.equal(long.length, 4000);
  assert.ok(long.endsWith("…"));
});

test("migration 0007 adds nullable, capped columns and keeps the table closed", () => {
  const m = readFileSync(resolve(root, "supabase/migrations/0007_request_context.sql"), "utf8");
  assert.match(m, /add column if not exists context text/);
  assert.match(m, /char_length\(context\) <= 6000/);
  assert.match(m, /add column if not exists answered_by text/);
  assert.match(m, /answered_by in \('computer', 'cloud'\)/);
  assert.match(m, /add column if not exists cloud_tried_at timestamptz/);
  assert.doesNotMatch(m, /\bgrant\b/i);
  assert.doesNotMatch(m, /create policy/i);
});

test("phone answer cleanup drops the instruction echoed as a label", () => {
  assert.equal(cleanPhoneAnswer("Message to Priya: I'll be 10 minutes late."), "I'll be 10 minutes late.");
  assert.equal(cleanPhoneAnswer("Message for this person - Happy Diwali!"), "Happy Diwali!");
  assert.equal(cleanPhoneAnswer("Reply to Bhavya: Sure, tonight works."), "Sure, tonight works.");
  assert.equal(cleanPhoneAnswer("**Message:** Happy Diwali!"), "Happy Diwali!");
  assert.equal(cleanPhoneAnswer("Your message: See you at 5"), "See you at 5");
  assert.equal(cleanPhoneAnswer("Text to send:\nHappy Diwali!"), "Happy Diwali!");
  assert.equal(cleanPhoneAnswer("Message me when you reach home."), "Message me when you reach home.");
  assert.equal(cleanPhoneAnswer("Reply to all with the deck, please."), "Reply to all with the deck, please.");
  assert.equal(cleanPhoneAnswer("Meeting at 5: see you there"), "Meeting at 5: see you there");
});
