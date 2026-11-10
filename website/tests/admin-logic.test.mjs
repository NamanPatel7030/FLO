// Admin panel: access check, usage aggregation, CSV, and the usage-count payload (no server, no database):
//   node --test tests/admin-logic.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { adminEmails, adminGate, isAdmin } from "../lib/admin-access.ts";
import {
  activeUsers,
  buildUserSummaries,
  classifyUser,
  csvEscape,
  dailyActive,
  funnel,
  lastNDays,
  minutesFromPings,
  overview,
  queryUsers,
  retentionCohorts,
  toCsv,
  weekStart,
} from "../lib/admin-metrics.ts";
import { parseUsageCounts, shouldBump, USAGE_BLOCK_MS, USAGE_KINDS } from "../lib/usage-logic.ts";
import { demoData } from "../lib/admin-demo.ts";

// ── access ───────────────────────────────────────────────────────────────────

test("ADMIN_EMAILS: comma separated, trimmed, case-insensitive", () => {
  const env = { ADMIN_EMAILS: " Naman@Example.com, ops@flo.app ,," };
  assert.deepEqual([...adminEmails(env)].sort(), ["naman@example.com", "ops@flo.app"]);
  assert.equal(isAdmin("naman@example.com", env), true);
  assert.equal(isAdmin("NAMAN@EXAMPLE.COM ", env), true);
  assert.equal(isAdmin("ops@flo.app", env), true);
});

test("everyone else is not an admin", () => {
  const env = { ADMIN_EMAILS: "naman@example.com" };
  for (const e of [null, undefined, "", "  ", "other@example.com", "naman@example.com.evil.io", "xnaman@example.com"]) assert.equal(isAdmin(e, env), false, String(e));
  // unset / empty list → nobody
  assert.equal(isAdmin("naman@example.com", {}), false);
  assert.equal(isAdmin("naman@example.com", { ADMIN_EMAILS: "" }), false);
  assert.equal(isAdmin("naman@example.com", { ADMIN_EMAILS: " , " }), false);
});

test("the gate needs a signed-in user with a confirmed, listed email; otherwise it's a 404", () => {
  const env = { ADMIN_EMAILS: "naman@example.com" };
  assert.equal(adminGate(null, env).status, 404);
  assert.equal(adminGate({ email: "naman@example.com", confirmed: false }, env).status, 404);
  assert.equal(adminGate({ email: "other@example.com", confirmed: true }, env).status, 404);
  assert.deepEqual(adminGate({ email: "Naman@Example.com", confirmed: true }, env), { status: 200, email: "naman@example.com", demo: false });
});

test("demo mode only with ADMIN_DEMO=1 and never on Vercel", () => {
  assert.deepEqual(adminGate(null, { ADMIN_DEMO: "1" }), { status: 200, email: "demo@flo.local", demo: true });
  assert.equal(adminGate(null, { ADMIN_DEMO: "1", VERCEL: "1" }).status, 404);
  assert.equal(adminGate(null, { ADMIN_DEMO: "true" }).status, 404);
});

// ── dates ────────────────────────────────────────────────────────────────────

test("lastNDays ends today, oldest first; weeks start on Monday", () => {
  assert.deepEqual(lastNDays("2026-11-10", 3), ["2026-11-08", "2026-11-09", "2026-11-10"]);
  assert.deepEqual(lastNDays("2026-03-01", 2), ["2026-02-28", "2026-03-01"]);
  assert.equal(weekStart("2026-11-10"), "2026-11-09"); // Tuesday → Monday
  assert.equal(weekStart("2026-11-09"), "2026-11-09");
  assert.equal(weekStart("2026-11-15"), "2026-11-09"); // Sunday
});

// ── DAU / WAU / MAU ──────────────────────────────────────────────────────────

const TODAY = "2026-11-10";
const d = (userId, day, surface, pings = 3, requests = 0) => ({ userId, day, surface, pings, requests });

test("DAU / WAU / MAU per surface and either", () => {
  const days = [
    d("a", "2026-11-10", "desktop"),
    d("a", "2026-11-10", "phone"),
    d("b", "2026-11-05", "desktop"), // 6 days ago: in WAU
    d("c", "2026-11-03", "phone"), // 7 days ago: outside WAU, inside MAU
    d("e", "2026-10-12", "desktop"), // 29 days ago: inside MAU
    d("f", "2026-10-11", "desktop"), // 30 days ago: outside
    d("g", "2026-11-10", "desktop", 0), // zero pings never count
  ];
  const r = activeUsers(days, TODAY);
  assert.deepEqual(r.dau, { desktop: 1, phone: 1, either: 1 });
  assert.deepEqual(r.wau, { desktop: 2, phone: 1, either: 2 });
  assert.deepEqual(r.mau, { desktop: 3, phone: 2, either: 4 });
});

test("dailyActive is one point per day for the chart", () => {
  const days = [d("a", "2026-11-10", "desktop"), d("a", "2026-11-10", "phone"), d("b", "2026-11-10", "phone"), d("b", "2026-11-09", "desktop")];
  const s = dailyActive(days, TODAY, 3);
  assert.deepEqual(s, [
    { day: "2026-11-08", desktop: 0, phone: 0, either: 0 },
    { day: "2026-11-09", desktop: 1, phone: 0, either: 1 },
    { day: "2026-11-10", desktop: 1, phone: 2, either: 2 },
  ]);
});

test("minutes active ≈ pings × 10 (each ping is one active 10-minute block)", () => {
  assert.equal(minutesFromPings(0), 0);
  assert.equal(minutesFromPings(7), 70);
  assert.equal(USAGE_BLOCK_MS, 10 * 60_000);
});

// ── classification ───────────────────────────────────────────────────────────

test("active / at risk / never activated", () => {
  assert.equal(classifyUser({ lastActive: "2026-11-09T10:00:00Z" }, TODAY), "active");
  assert.equal(classifyUser({ lastActive: "2026-11-04T00:00:00Z" }, TODAY), "active"); // 6 days
  assert.equal(classifyUser({ lastActive: "2026-11-02T23:00:00Z" }, TODAY), "at_risk"); // >7 days
  assert.equal(classifyUser({ lastActive: null }, TODAY), "never");
});

// ── retention ────────────────────────────────────────────────────────────────

test("week cohorts: share of each signup week active in weeks 1..4 after", () => {
  // cohort of week 2026-10-05 (Mon): u1, u2. Week 1 = 10-12..10-18, week 2 = 10-19..10-25, ...
  const users = [
    { id: "u1", createdAt: "2026-10-06T09:00:00Z" },
    { id: "u2", createdAt: "2026-10-11T09:00:00Z" },
    { id: "u3", createdAt: "2026-11-09T09:00:00Z" }, // this week's cohort: nothing measurable yet
  ];
  const days = [d("u1", "2026-10-13", "desktop"), d("u1", "2026-10-20", "phone"), d("u2", "2026-10-14", "desktop"), d("u1", "2026-11-03", "desktop")];
  const c = retentionCohorts(users, days, TODAY, 8);
  const oct5 = c.find((x) => x.week === "2026-10-05");
  assert.equal(oct5.size, 2);
  assert.deepEqual(oct5.weeks, [100, 50, 0, 50]);
  const now = c.find((x) => x.week === "2026-11-09");
  assert.equal(now.size, 1);
  assert.deepEqual(now.weeks, [null, null, null, null]); // weeks that haven't finished show as null
  // partially elapsed: cohort of 10-26 has week 1 (11-02..11-08) done, week 2 in progress
  const c2 = retentionCohorts([{ id: "x", createdAt: "2026-10-27T00:00:00Z" }], [d("x", "2026-11-03", "desktop")], TODAY, 8);
  assert.deepEqual(c2.find((x) => x.week === "2026-10-26").weeks, [100, null, null, null]);
});

// ── summaries, funnel, overview ──────────────────────────────────────────────

const baseUser = (o) => ({
  id: "u",
  email: "u@example.com",
  name: "",
  provider: "google",
  createdAt: "2026-10-01T00:00:00Z",
  lastSignInAt: null,
  appFirstSeen: null,
  appLastSeen: null,
  phones: 0,
  phoneLastSeen: null,
  phonePlatforms: [],
  computerPlatform: null,
  appVersion: null,
  stateUpdatedAt: null,
  syncOn: false,
  syncItems: 0,
  recentRequests: 0,
  ...o,
});

test("user summaries: last active, active days, minutes, usage counts", () => {
  const users = [
    baseUser({ id: "a", email: "a@example.com", appFirstSeen: "2026-10-02T00:00:00Z", appLastSeen: "2026-11-10T08:00:00Z", phones: 1, phoneLastSeen: "2026-11-09T08:00:00Z", computerPlatform: "macos", appVersion: "0.9.1", syncOn: true }),
    baseUser({ id: "b", email: "b@example.com" }),
  ];
  const days = [d("a", "2026-11-10", "desktop", 6), d("a", "2026-11-09", "phone", 2, 3), d("a", "2026-11-01", "desktop", 4), d("a", "2026-10-01", "desktop", 9)];
  const counts = [{ userId: "a", day: "2026-11-10", kind: "dictations", n: 12 }, { userId: "a", day: "2026-11-09", kind: "dictations", n: 3 }, { userId: "a", day: "2026-11-09", kind: "words", n: 400 }];
  const [a, b] = buildUserSummaries(users, days, counts, TODAY);
  assert.equal(a.lastDesktop, "2026-11-10T08:00:00Z");
  assert.equal(a.lastPhone, "2026-11-09T08:00:00Z");
  assert.equal(a.lastActive, "2026-11-10T08:00:00Z");
  assert.equal(a.activeDays30, 3); // 11-10, 11-09 and 11-01; 10-01 is outside
  assert.equal(a.minutes7, 80); // 6 + 2 pings in the last 7 days
  assert.equal(a.phoneAsks, 3);
  assert.equal(a.status, "active");
  assert.deepEqual(a.counts30, { dictations: 15, words: 400 });
  assert.equal(a.sharesCounts, true);
  assert.equal(b.status, "never");
  assert.equal(b.sharesCounts, false);
  assert.equal(b.minutes7, 0);
});

test("a usage day alone (no app_usage row yet) still counts as last active", () => {
  const [u] = buildUserSummaries([baseUser({ id: "a" })], [d("a", "2026-11-08", "phone")], [], TODAY);
  assert.equal(u.lastPhone, "2026-11-08T00:00:00.000Z");
  assert.equal(u.status, "active");
});

test("activation funnel: signed up → desktop signed in → phone paired → phone ask used", () => {
  const users = [
    baseUser({ id: "1" }),
    baseUser({ id: "2", appFirstSeen: "2026-10-02T00:00:00Z" }),
    baseUser({ id: "3", appFirstSeen: "2026-10-02T00:00:00Z", phones: 1 }),
    baseUser({ id: "4", appFirstSeen: "2026-10-02T00:00:00Z", phones: 1, recentRequests: 2 }),
  ];
  const s = buildUserSummaries(users, [d("3", "2026-11-01", "phone", 1, 1)], [], TODAY);
  assert.deepEqual(
    funnel(s).map((x) => [x.label, x.n]),
    [
      ["Signed up", 4],
      ["Signed in on a computer", 3],
      ["Paired a phone", 2],
      ["Asked from the phone", 2],
    ],
  );
});

test("overview: new users, platform split, versions, answers", () => {
  const users = [
    baseUser({ id: "1", createdAt: "2026-11-10T01:00:00Z", computerPlatform: "macos", appVersion: "0.9.1" }),
    baseUser({ id: "2", createdAt: "2026-11-05T01:00:00Z", computerPlatform: "windows", appVersion: "0.9.1", phones: 1, phonePlatforms: ["android"] }),
    baseUser({ id: "3", createdAt: "2026-10-20T01:00:00Z", computerPlatform: "macos", appVersion: "0.8.0" }),
    baseUser({ id: "4", createdAt: "2026-08-01T01:00:00Z" }),
  ];
  const s = buildUserSummaries(users, [], [], TODAY);
  const o = overview(s, [], [{ answeredBy: "computer", n: 5 }, { answeredBy: "cloud", n: 2 }, { answeredBy: null, n: 1 }], TODAY);
  assert.equal(o.total, 4);
  assert.deepEqual(o.newUsers, { today: 1, d7: 2, d30: 3 });
  assert.deepEqual(o.platforms, {
    computers: [
      { label: "macOS", n: 2 },
      { label: "Windows", n: 1 },
    ],
    phones: [{ label: "Android", n: 1 }],
  });
  assert.deepEqual(o.versions, [
    { label: "0.9.1", n: 2 },
    { label: "0.8.0", n: 1 },
  ]);
  assert.deepEqual(o.answers, { computer: 5, cloud: 2, unanswered: 1 });
});

// ── users table ──────────────────────────────────────────────────────────────

test("search, filter, sort and paginate the users table", () => {
  const users = [
    baseUser({ id: "1", email: "zed@example.com", name: "Zed", appLastSeen: "2026-11-10T00:00:00Z", createdAt: "2026-09-01T00:00:00Z" }),
    baseUser({ id: "2", email: "amy@example.com", name: "Amy", appLastSeen: "2026-10-01T00:00:00Z", createdAt: "2026-09-02T00:00:00Z" }),
    baseUser({ id: "3", email: "bob@other.io", name: "Bob", createdAt: "2026-09-03T00:00:00Z" }),
  ];
  const s = buildUserSummaries(users, [], [], TODAY);
  assert.deepEqual(queryUsers(s, { q: "EXAMPLE" }).rows.map((u) => u.id), ["3", "2", "1"].filter((x) => x !== "3"));
  assert.deepEqual(queryUsers(s, { filter: "active" }).rows.map((u) => u.id), ["1"]);
  assert.deepEqual(queryUsers(s, { filter: "at_risk" }).rows.map((u) => u.id), ["2"]);
  assert.deepEqual(queryUsers(s, { filter: "never" }).rows.map((u) => u.id), ["3"]);
  assert.deepEqual(queryUsers(s, { sort: "email", dir: "asc" }).rows.map((u) => u.email), ["amy@example.com", "bob@other.io", "zed@example.com"]);
  // default: newest sign-ups first
  assert.deepEqual(queryUsers(s, {}).rows.map((u) => u.id), ["3", "2", "1"]);
  // nulls sort last either way
  assert.deepEqual(queryUsers(s, { sort: "lastActive", dir: "desc" }).rows.map((u) => u.id), ["1", "2", "3"]);
  assert.deepEqual(queryUsers(s, { sort: "lastActive", dir: "asc" }).rows.map((u) => u.id), ["2", "1", "3"]);
  const p = queryUsers(s, { per: 2, page: 2 });
  assert.deepEqual([p.rows.length, p.total, p.pages, p.page], [1, 3, 2, 2]);
  // out-of-range page clamps; junk sort falls back
  assert.equal(queryUsers(s, { per: 2, page: 99 }).page, 2);
  assert.equal(queryUsers(s, { sort: "token_hash" }).rows.length, 3);
});

// ── CSV ──────────────────────────────────────────────────────────────────────

test("CSV escaping: quotes, commas, newlines, and spreadsheet formulas", () => {
  assert.equal(csvEscape("plain"), "plain");
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(csvEscape("a,b"), '"a,b"');
  assert.equal(csvEscape("line\nbreak"), '"line\nbreak"');
  assert.equal(csvEscape("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvEscape("+1"), "'+1");
  assert.equal(csvEscape("@x"), "'@x");
  assert.equal(csvEscape("-2"), "'-2");
  assert.equal(csvEscape(null), "");
  assert.equal(csvEscape(42), "42");
  assert.equal(csvEscape(true), "yes");
  const csv = toCsv([{ a: "x", b: 1 }, { a: "y,z", b: null }], [["a", "A"], ["b", "B"]]);
  assert.equal(csv, 'A,B\r\nx,1\r\n"y,z",\r\n');
});

// ── usage pings + counts ─────────────────────────────────────────────────────

test("a ping is written at most once per 10 minutes per user and surface", () => {
  const seen = new Map();
  const t0 = 1_000_000_000;
  assert.equal(shouldBump(seen, "u:desktop", t0), true);
  assert.equal(shouldBump(seen, "u:desktop", t0 + 60_000), false);
  assert.equal(shouldBump(seen, "u:phone", t0 + 60_000), true);
  assert.equal(shouldBump(seen, "u:desktop", t0 + USAGE_BLOCK_MS), true);
  // the map stays bounded
  for (let i = 0; i < 25_000; i++) shouldBump(seen, `x${i}`, t0 + USAGE_BLOCK_MS * 3);
  assert.ok(seen.size <= 20_001);
});

test("usage counts: only known kinds, whole numbers, recent days", () => {
  const ok = parseUsageCounts({ days: [{ day: "2026-11-10", counts: { dictations: 4, words: 120, assistant_asks: 2, agent_runs: 0, meetings: 1 } }] }, TODAY);
  assert.deepEqual(ok, {
    rows: [
      { day: "2026-11-10", kind: "dictations", n: 4 },
      { day: "2026-11-10", kind: "words", n: 120 },
      { day: "2026-11-10", kind: "assistant_asks", n: 2 },
      { day: "2026-11-10", kind: "agent_runs", n: 0 },
      { day: "2026-11-10", kind: "meetings", n: 1 },
    ],
  });
  assert.deepEqual(USAGE_KINDS, ["dictations", "words", "assistant_asks", "agent_runs", "meetings"]);
  // unknown kinds and text are dropped, never stored
  const junk = parseUsageCounts({ days: [{ day: "2026-11-09", counts: { dictations: 1, transcript: "hello", secret: 5 } }] }, TODAY);
  assert.deepEqual(junk, { rows: [{ day: "2026-11-09", kind: "dictations", n: 1 }] });
  for (const bad of [
    null,
    {},
    { days: "x" },
    { days: [{ day: "2026-13-01", counts: { dictations: 1 } }] },
    { days: [{ day: "2025-01-01", counts: { dictations: 1 } }] }, // too old
    { days: [{ day: "2026-11-20", counts: { dictations: 1 } }] }, // future
    { days: [{ day: "2026-11-10", counts: { dictations: -1 } }] },
    { days: [{ day: "2026-11-10", counts: { dictations: 1.5 } }] },
    { days: [{ day: "2026-11-10", counts: { dictations: "3" } }] },
    { days: [{ day: "2026-11-10", counts: { words: 1e9 } }] },
    { days: Array.from({ length: 40 }, () => ({ day: "2026-11-10", counts: { dictations: 1 } })) },
  ]) {
    assert.ok("error" in parseUsageCounts(bad, TODAY), JSON.stringify(bad)?.slice(0, 80));
  }
});

// ── demo data ────────────────────────────────────────────────────────────────

test("demo data is fake, deterministic and flows through the same aggregation", () => {
  const a = demoData(TODAY);
  const b = demoData(TODAY);
  assert.deepEqual(a, b);
  assert.ok(a.users.length >= 20);
  assert.ok(a.users.every((u) => u.email.endsWith("@example.com")));
  const s = buildUserSummaries(a.users, a.days, a.counts, TODAY);
  const o = overview(s, a.days, a.answers, TODAY);
  assert.equal(o.total, a.users.length);
  assert.ok(o.active.mau.either > 0);
  assert.ok(new Set(s.map((u) => u.status)).size === 3);
});
