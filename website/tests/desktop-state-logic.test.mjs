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
  assert.deepEqual(ACTION_KINDS, ["todo_done", "todo_reopen", "approve", "reject", "setting"]);
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
