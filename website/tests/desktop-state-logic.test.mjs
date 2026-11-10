// Computer snapshot + phone action validation (no server, no database):
//   node --test tests/desktop-state-logic.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTION_KINDS, parseAction, parseSnapshot, STATE_LIMITS } from "../lib/desktop-state.ts";

const snap = (o = {}) => ({
  v: 1,
  computer: { platform: "macos", appVersion: "0.9.1" },
  todos: {
    open: [{ id: "t1", title: "Call the bank", due: "2026-11-10T09:00:00+05:30", source: "phone", createdAt: "2026-11-09T08:00:00Z" }],
    done: [{ id: "t0", title: "Pay rent", completedAt: "2026-11-08T08:00:00Z" }],
  },
  approvals: [{ id: "q1", project: "api", summary: "Run: npm publish", tool: "Bash", at: "2026-11-09T08:00:00Z", expiresAt: "2026-11-09T08:02:00Z" }],
  waiting: [{ id: "s1", project: "web", message: "Claude is waiting for your input", status: "waiting_reply", at: "2026-11-09T08:00:00Z" }],
  settings: [
    { key: "playSounds", label: "Play sounds", section: "Sounds", kind: "toggle", value: true, editable: true },
    { key: "theme", label: "Theme", section: "Appearance", kind: "select", value: "light", editable: true, options: [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }] },
    { key: "autoLanguages", label: "Languages", section: "Speech", kind: "list", value: ["en", "hi"], editable: false },
  ],
  ...o,
});

test("accepts a normal snapshot and keeps only known fields", () => {
  const r = parseSnapshot({ ...snap(), extra: "x", todos: { ...snap().todos, junk: 1 } });
  assert.ok("state" in r, JSON.stringify(r));
  assert.equal(r.state.todos.open[0].title, "Call the bank");
  assert.equal(r.state.approvals[0].summary, "Run: npm publish");
  assert.equal(r.state.settings.length, 3);
  assert.equal(r.state.extra, undefined);
  assert.equal(r.state.todos.junk, undefined);
  assert.deepEqual(r.state.settings[2].value, ["en", "hi"]);
});

test("missing sections become empty lists", () => {
  const r = parseSnapshot({ v: 1 });
  assert.ok("state" in r);
  assert.deepEqual(r.state.todos, { open: [], done: [] });
  assert.deepEqual(r.state.approvals, []);
  assert.deepEqual(r.state.settings, []);
  assert.equal(r.state.computer.platform, "other");
});

test("drops malformed entries instead of failing the whole snapshot", () => {
  const r = parseSnapshot(snap({
    approvals: [{ id: "", summary: "x" }, { id: "q2", project: "p", summary: "Edit a.rs", tool: "Edit", at: "x", expiresAt: "y" }],
    settings: [{ key: "bad key!", label: "x", kind: "toggle", value: true }, { key: "k", label: "K", kind: "weird", value: 1 }, { key: "n", label: "N", section: "S", kind: "number", value: 4, editable: false }],
  }));
  assert.ok("state" in r);
  assert.deepEqual(r.state.approvals.map((a) => a.id), ["q2"]);
  assert.deepEqual(r.state.settings.map((s) => s.key), ["n"]);
});

test("caps list sizes and string lengths", () => {
  const open = Array.from({ length: 300 }, (_, i) => ({ id: `t${i}`, title: "x".repeat(400), createdAt: "2026-11-09T08:00:00Z" }));
  const r = parseSnapshot(snap({ todos: { open, done: [] } }));
  assert.ok("state" in r);
  assert.equal(r.state.todos.open.length, STATE_LIMITS.openTodos);
  assert.ok(r.state.todos.open[0].title.length <= 300);
});

test("rejects non-objects and oversize bodies", () => {
  for (const b of [null, "x", [], 3]) assert.ok("error" in parseSnapshot(b), JSON.stringify(b));
  assert.ok("error" in parseSnapshot(snap({ pad: "x".repeat(STATE_LIMITS.maxBytes + 10) })));
});

test("never stores anything that looks like a secret setting", () => {
  const r = parseSnapshot(snap({
    settings: [
      { key: "openaiApiKey", label: "Key", section: "AI", kind: "text", value: "sk-123", editable: false },
      { key: "slackToken", label: "Slack", section: "AI", kind: "text", value: "xoxb", editable: false },
      { key: "accountPassword", label: "P", section: "A", kind: "text", value: "x", editable: false },
      { key: "theme", label: "Theme", section: "Appearance", kind: "text", value: "light", editable: false },
    ],
  }));
  assert.ok("state" in r);
  assert.deepEqual(r.state.settings.map((s) => s.key), ["theme"]);
});

test("actions: valid kinds, targets and values", () => {
  assert.deepEqual(ACTION_KINDS, ["todo_done", "todo_reopen", "approve", "reject", "setting", "reply", "choose"]);
  assert.deepEqual(parseAction({ kind: "todo_done", target: "t1" }), { kind: "todo_done", target: "t1", value: null });
  assert.deepEqual(parseAction({ kind: "approve", target: "q-1", value: "ignored" }), { kind: "approve", target: "q-1", value: null });
  assert.deepEqual(parseAction({ kind: "setting", target: "playSounds", value: false }), { kind: "setting", target: "playSounds", value: false });
  assert.deepEqual(parseAction({ kind: "setting", target: "theme", value: "dark" }), { kind: "setting", target: "theme", value: "dark" });
  assert.deepEqual(parseAction({ kind: "setting", target: "soundVolume", value: 40 }), { kind: "setting", target: "soundVolume", value: 40 });
});

test("actions: rejects bad shapes", () => {
  for (const b of [
    null,
    {},
    { kind: "delete_everything", target: "t1" },
    { kind: "todo_done" },
    { kind: "todo_done", target: "" },
    { kind: "todo_done", target: "x".repeat(200) },
    { kind: "todo_done", target: "a b" },
    { kind: "setting", target: "theme" },
    { kind: "setting", target: "theme", value: { a: 1 } },
    { kind: "setting", target: "theme", value: "x".repeat(400) },
    { kind: "setting", target: "theme", value: Infinity },
  ]) {
    assert.ok("error" in parseAction(b), JSON.stringify(b));
  }
});

test("hotkeys are not mistaken for secrets", () => {
  const r = parseSnapshot(snap({ settings: [{ key: "hotkeyDictation", label: "Dictation key", section: "Keys", kind: "text", value: "ctrl", editable: false }] }));
  assert.deepEqual(r.state.settings.map((s) => s.key), ["hotkeyDictation"]);
});

// ── why the computer hasn't picked up a phone question yet ──────────────────
import { waitingHint } from "../lib/desktop-state.ts";

test("waiting hint: no computer signed in to this account names the account", () => {
  const h = waitingHint("me@example.com", null, new Date("2026-11-10T10:00:00Z"));
  assert.equal(h.reason, "no_computer");
  assert.match(h.text, /me@example\.com/);
  assert.match(h.text, /sign in/i);
});

test("waiting hint: computer last seen long ago says when", () => {
  const h = waitingHint("me@example.com", "2026-11-10T07:00:00Z", new Date("2026-11-10T10:00:00Z"));
  assert.equal(h.reason, "offline");
  assert.match(h.text, /3 hours ago/);
});

test("waiting hint: recent heartbeat means online, just busy", () => {
  const h = waitingHint("me@example.com", "2026-11-10T09:57:00Z", new Date("2026-11-10T10:00:00Z"));
  assert.equal(h.reason, "busy");
  assert.doesNotMatch(h.text, /sign in/i);
});

test("waiting hint: minutes and singular forms", () => {
  assert.match(waitingHint("a@b.c", "2026-11-10T09:40:00Z", new Date("2026-11-10T10:00:00Z")).text, /20 minutes ago/);
  assert.match(waitingHint("a@b.c", "2026-11-10T09:00:00Z", new Date("2026-11-10T10:00:00Z")).text, /1 hour ago/);
  assert.match(waitingHint("a@b.c", "2026-11-08T09:00:00Z", new Date("2026-11-10T10:00:00Z")).text, /2 days ago/);
});

// ── Claude Code sessions: list in the snapshot, reply / choose from the phone ─
import { readFileSync } from "node:fs";

const session = (o = {}) => ({
  id: "0b9f6a52-3c1e-4d7a-9e55-1f2a3b4c5d6e",
  project: "api-server",
  folder: "api-server",
  state: "waiting_reply",
  message: "Which database should I use?",
  updatedAt: "2026-11-10T08:00:00Z",
  reply: "answer",
  question: {
    id: "q7",
    questions: [{ question: "Which database?", header: "DB", multiSelect: false, options: ["Postgres", "SQLite"] }],
  },
  ...o,
});

test("sessions: kept with known fields, states and question options", () => {
  const r = parseSnapshot(snap({ sessions: [session({ junk: 1 }), session({ id: "s2", state: "working", question: undefined, reply: "queued" })] }));
  assert.ok("state" in r, JSON.stringify(r));
  const [a, b] = r.state.sessions;
  assert.equal(a.junk, undefined);
  assert.equal(a.state, "waiting_reply");
  assert.deepEqual(a.question.questions[0].options, ["Postgres", "SQLite"]);
  assert.equal(a.question.id, "q7");
  assert.equal(b.state, "working");
  assert.equal(b.question, undefined);
  assert.equal(b.reply, "queued");
});

test("sessions: unknown state becomes idle, unknown delivery becomes none, bad ids dropped", () => {
  const r = parseSnapshot(snap({ sessions: [session({ state: "exploded", reply: "shell" }), session({ id: "bad id!" })] }));
  assert.ok("state" in r);
  assert.equal(r.state.sessions.length, 1);
  assert.equal(r.state.sessions[0].state, "idle");
  assert.equal(r.state.sessions[0].reply, "none");
});

test("sessions: capped in count, message length and question size", () => {
  const many = Array.from({ length: 20 }, (_, i) => session({
    id: `s${i}`,
    message: "m".repeat(900),
    question: { id: "q", questions: Array.from({ length: 6 }, () => ({ question: "q".repeat(320), options: Array.from({ length: 12 }, (_, j) => `opt ${j}`) })) },
  }));
  const r = parseSnapshot(snap({ sessions: many }));
  assert.ok("state" in r);
  assert.equal(r.state.sessions.length, STATE_LIMITS.sessions);
  const s = r.state.sessions[0];
  assert.ok(s.message.length <= 400);
  assert.equal(s.question.questions.length, STATE_LIMITS.questions);
  assert.equal(s.question.questions[0].options.length, STATE_LIMITS.questionOptions);
  assert.ok(s.question.questions[0].question.length <= 300);
  // worst case still fits the request limit with room for to-dos and settings
  const worst = Array.from({ length: STATE_LIMITS.sessions }, (_, i) => session({
    id: `w${i}`, message: "m".repeat(400), replyHint: "h".repeat(200),
    question: { id: "q", questions: Array.from({ length: 4 }, () => ({ question: "q".repeat(300), header: "h".repeat(40), options: Array.from({ length: 8 }, () => "o".repeat(80)) })) },
  }));
  assert.ok(JSON.stringify(worst).length < STATE_LIMITS.maxBytes / 2);
});

test("sessions: missing list becomes empty (older desktops)", () => {
  const r = parseSnapshot({ v: 1 });
  assert.deepEqual(r.state.sessions, []);
});

test("actions: reply carries the text (newlines kept, max 4000)", () => {
  const sid = "0b9f6a52-3c1e-4d7a-9e55-1f2a3b4c5d6e";
  assert.deepEqual(parseAction({ kind: "reply", target: sid, value: "  use postgres\nand add an index  " }), { kind: "reply", target: sid, value: "use postgres\nand add an index" });
  assert.equal(parseAction({ kind: "reply", target: sid, value: "x".repeat(4000) }).value.length, 4000);
  for (const value of [undefined, "", "   ", "x".repeat(4001), 5, { t: "x" }]) {
    assert.ok("error" in parseAction({ kind: "reply", target: sid, value }), JSON.stringify(value));
  }
  // control characters are stripped
  assert.equal(parseAction({ kind: "reply", target: sid, value: "a\u0007b\u001bc" }).value, "abc");
});

test("actions: choose carries option labels per question", () => {
  const sid = "s1";
  assert.deepEqual(parseAction({ kind: "choose", target: sid, value: { id: "q7", answers: [["Postgres"]] } }), { kind: "choose", target: sid, value: { id: "q7", answers: [["Postgres"]] } });
  assert.deepEqual(parseAction({ kind: "choose", target: sid, value: { answers: [["A", "B"], ["Yes"]] } }), { kind: "choose", target: sid, value: { answers: [["A", "B"], ["Yes"]] } });
  for (const value of [
    undefined,
    "Postgres",
    { answers: [] },
    { answers: [[]] },
    { answers: [[""]] },
    { answers: [["x".repeat(201)]] },
    { answers: Array.from({ length: 5 }, () => ["a"]) },
    { answers: [Array.from({ length: 11 }, () => "a")] },
    { answers: [[1]] },
    { id: "bad id!", answers: [["a"]] },
  ]) {
    assert.ok("error" in parseAction({ kind: "choose", target: sid, value }), JSON.stringify(value));
  }
});

test("migration 0008 allows every action kind and bounds the value", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0008_session_actions.sql", import.meta.url), "utf8");
  assert.match(sql, /drop constraint if exists mobile_actions_kind_check/);
  assert.match(sql, /add constraint mobile_actions_kind_check/);
  for (const k of ACTION_KINDS) assert.match(sql, new RegExp(`'${k}'`), k);
  assert.match(sql, /mobile_actions_value_size/);
});

test("meetings: kept validated, capped at 3, unknown fields dropped, missing → []", () => {
  assert.deepEqual(parseSnapshot({ v: 1 }).state.meetings, []);
  assert.deepEqual(parseSnapshot(snap({ meetings: "nope" })).state.meetings, []);
  const m = (o = {}) => ({ id: "ev1_20261110T093000Z", title: "Design sync", start: "2026-11-10T09:30:00+05:30", end: "2026-11-10T10:00:00+05:30", attendees: 4, join: true, ...o });
  const r = parseSnapshot(snap({
    meetings: [
      m({ location: "Room 4", description: "secret agenda" }),
      m({ id: "" }),
      m({ id: "e2", title: "y".repeat(300), attendees: 5000, join: "yes" }),
      m({ id: "e3", attendees: -2 }),
      m({ id: "e4", attendees: 2.5 }),
    ],
  }));
  assert.ok("state" in r);
  const ms = r.state.meetings;
  assert.equal(ms.length, STATE_LIMITS.meetings);
  assert.equal(STATE_LIMITS.meetings, 3);
  assert.deepEqual(ms[0], { id: "ev1_20261110T093000Z", title: "Design sync", start: "2026-11-10T09:30:00+05:30", end: "2026-11-10T10:00:00+05:30", attendees: 4, join: true });
  assert.equal(ms[1].id, "e2");
  assert.ok(ms[1].title.length <= 120);
  assert.equal(ms[1].attendees, 1000);
  assert.equal(ms[1].join, false);
  assert.equal(ms[2].attendees, 0);
  assert.equal(ms[0].location, undefined);
  for (const bad of [{ id: "x".repeat(201) }, { title: "" }, { start: "tomorrow" }, { end: "2026-11-10" }, { start: "2026-13-45T99:00" }, { attendees: "4" }]) {
    const got = parseSnapshot(snap({ meetings: [m(bad)] })).state.meetings;
    if ("attendees" in bad) assert.equal(got[0].attendees, 0);
    else assert.deepEqual(got, [], JSON.stringify(bad));
  }
  // ids up to 200 characters (Google event ids can be long)
  assert.equal(parseSnapshot(snap({ meetings: [m({ id: "a".repeat(200) })] })).state.meetings[0].id.length, 200);
});
