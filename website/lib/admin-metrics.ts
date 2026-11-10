// Admin panel aggregation: pure functions over rows the server already has (accounts, app check-ins,
// paired phones, app.usage_days, and opt-in app.usage_counts). No imports, so node --test runs it
// directly (tests/admin-logic.test.mjs) and demo mode (lib/admin-demo.ts) uses the same code path.
//
// Days are UTC calendar days ("YYYY-MM-DD"). Nothing here ever sees message contents, tokens or hashes:
// the inputs don't carry them.

export type Surface = "desktop" | "phone";

/** One account, as lib/admin-data.ts reads it. Timestamps are ISO strings or null. */
export type AdminUser = {
  id: string;
  email: string;
  name: string;
  provider: string;
  createdAt: string;
  lastSignInAt: string | null;
  /** first / last desktop app sign-in or launch (app.app_usage) */
  appFirstSeen: string | null;
  appLastSeen: string | null;
  /** paired phones (app.mobile_devices) */
  phones: number;
  phoneLastSeen: string | null;
  phonePlatforms: string[];
  /** from the computer snapshot (app.desktop_state), published while a phone is paired */
  computerPlatform: string | null;
  appVersion: string | null;
  stateUpdatedAt: string | null;
  syncOn: boolean;
  syncItems: number;
  /** phone requests still in app.mobile_requests (kept 7 days) */
  recentRequests: number;
};

export type UsageDay = { userId: string; day: string; surface: Surface; pings: number; requests: number };
export type CountRow = { userId: string; day: string; kind: string; n: number };
export type AnswerRow = { answeredBy: "computer" | "cloud" | null; n: number };
export type Status = "active" | "at_risk" | "never";

export type UserSummary = AdminUser & {
  lastDesktop: string | null;
  lastPhone: string | null;
  lastActive: string | null;
  activeDays30: number;
  minutes7: number;
  phoneAsks: number;
  status: Status;
  counts30: Record<string, number>;
  sharesCounts: boolean;
};

// ── dates ────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => fmt(dayMs(day) + n * DAY);
export const todayUtc = (now = Date.now()) => fmt(now);

/** The last `n` days ending with `today`, oldest first. */
export function lastNDays(today: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(today, i - n + 1));
}

/** Monday of the week `day` is in. */
export function weekStart(day: string): string {
  const dow = new Date(dayMs(day)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
function latest(...isos: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const i of isos) if (i && Number.isFinite(ms(i)) && (best === null || ms(i) > ms(best))) best = i;
  return best;
}

export const minutesFromPings = (pings: number) => pings * 10;

// ── active users ─────────────────────────────────────────────────────────────

export type Triple = { desktop: number; phone: number; either: number };

function activeIn(days: UsageDay[], from: string, to: string): Triple {
  const sets = { desktop: new Set<string>(), phone: new Set<string>(), either: new Set<string>() };
  for (const d of days) {
    if (d.pings <= 0 || d.day < from || d.day > to) continue;
    sets[d.surface].add(d.userId);
    sets.either.add(d.userId);
  }
  return { desktop: sets.desktop.size, phone: sets.phone.size, either: sets.either.size };
}

/** DAU (today), WAU (last 7 days), MAU (last 30 days), per surface and either. */
export function activeUsers(days: UsageDay[], today: string): { dau: Triple; wau: Triple; mau: Triple } {
  return { dau: activeIn(days, today, today), wau: activeIn(days, addDays(today, -6), today), mau: activeIn(days, addDays(today, -29), today) };
}

export function dailyActive(days: UsageDay[], today: string, n: number): ({ day: string } & Triple)[] {
  return lastNDays(today, n).map((day) => ({ day, ...activeIn(days, day, day) }));
}

// ── per user ─────────────────────────────────────────────────────────────────

export function classifyUser(u: { lastActive: string | null }, today: string): Status {
  if (!u.lastActive) return "never";
  return ms(u.lastActive) >= dayMs(addDays(today, -6)) ? "active" : "at_risk";
}

export function buildUserSummaries(users: AdminUser[], days: UsageDay[], counts: CountRow[], today: string): UserSummary[] {
  const byUser = new Map<string, UsageDay[]>();
  for (const d of days) (byUser.get(d.userId) ?? byUser.set(d.userId, []).get(d.userId)!).push(d);
  const countsBy = new Map<string, CountRow[]>();
  for (const c of counts) (countsBy.get(c.userId) ?? countsBy.set(c.userId, []).get(c.userId)!).push(c);
  const from30 = addDays(today, -29);
  const from7 = addDays(today, -6);

  return users.map((u) => {
    const mine = (byUser.get(u.id) ?? []).filter((d) => d.pings > 0 || d.requests > 0);
    const lastDay = (s: Surface) => {
      const ds = mine.filter((d) => d.surface === s && d.pings > 0).map((d) => d.day).sort();
      return ds.length ? `${ds[ds.length - 1]}T00:00:00.000Z` : null;
    };
    const lastDesktop = latest(u.appLastSeen, u.stateUpdatedAt, lastDay("desktop"));
    const lastPhone = latest(u.phoneLastSeen, lastDay("phone"));
    const lastActive = latest(lastDesktop, lastPhone);
    const activeDays30 = new Set(mine.filter((d) => d.pings > 0 && d.day >= from30 && d.day <= today).map((d) => d.day)).size;
    const minutes7 = minutesFromPings(mine.filter((d) => d.day >= from7 && d.day <= today).reduce((s, d) => s + d.pings, 0));
    const phoneAsks = Math.max(
      mine.reduce((s, d) => s + d.requests, 0),
      u.recentRequests,
    );
    const myCounts = countsBy.get(u.id) ?? [];
    const counts30: Record<string, number> = {};
    for (const c of myCounts) if (c.day >= from30 && c.day <= today) counts30[c.kind] = (counts30[c.kind] ?? 0) + c.n;
    return {
      ...u,
      lastDesktop,
      lastPhone,
      lastActive,
      activeDays30,
      minutes7,
      phoneAsks,
      status: classifyUser({ lastActive }, today),
      counts30,
      sharesCounts: myCounts.length > 0,
    };
  });
}

/** One user's last `n` days for the detail page. */
export function userTimeline(days: UsageDay[], userId: string, today: string, n: number) {
  const mine = days.filter((d) => d.userId === userId);
  return lastNDays(today, n).map((day) => {
    const on = mine.filter((d) => d.day === day);
    const pick = (s: Surface) => on.filter((d) => d.surface === s).reduce((a, d) => a + d.pings, 0);
    return { day, desktop: pick("desktop"), phone: pick("phone"), requests: on.reduce((a, d) => a + d.requests, 0) };
  });
}

// ── overview ─────────────────────────────────────────────────────────────────

export type Cohort = { week: string; size: number; weeks: (number | null)[] };

/** Signup-week cohorts (the last `n` weeks): % of each cohort active in weeks 1..4 after signing up. */
export function retentionCohorts(users: { id: string; createdAt: string }[], days: UsageDay[], today: string, n: number): Cohort[] {
  const activeDays = new Map<string, Set<string>>();
  for (const d of days) if (d.pings > 0) (activeDays.get(d.userId) ?? activeDays.set(d.userId, new Set()).get(d.userId)!).add(d.day);
  const thisWeek = weekStart(today);
  const out: Cohort[] = [];
  for (let k = n - 1; k >= 0; k--) {
    const week = addDays(thisWeek, -7 * k);
    const members = users.filter((u) => weekStart(fmt(ms(u.createdAt))) === week);
    const weeks = [1, 2, 3, 4].map((i) => {
      const from = addDays(week, 7 * i);
      const to = addDays(from, 6);
      if (to >= today || members.length === 0) return null; // not over yet
      const hit = members.filter((m) => [...(activeDays.get(m.id) ?? [])].some((d) => d >= from && d <= to)).length;
      return Math.round((hit / members.length) * 100);
    });
    out.push({ week, size: members.length, weeks });
  }
  return out;
}

export function funnel(users: UserSummary[]): { label: string; n: number }[] {
  const desktop = users.filter((u) => u.appFirstSeen || u.lastDesktop);
  const phone = desktop.filter((u) => u.phones > 0 || u.lastPhone);
  const asked = phone.filter((u) => u.phoneAsks > 0);
  return [
    { label: "Signed up", n: users.length },
    { label: "Signed in on a computer", n: desktop.length },
    { label: "Paired a phone", n: phone.length },
    { label: "Asked from the phone", n: asked.length },
  ];
}

const PLATFORM_LABELS: Record<string, string> = { macos: "macOS", windows: "Windows", linux: "Linux", other: "Other", android: "Android", ios: "iOS" };

function tally(values: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

export function overview(users: UserSummary[], days: UsageDay[], answers: AnswerRow[], today: string) {
  const since = (n: number) => users.filter((u) => ms(u.createdAt) >= dayMs(addDays(today, -n + 1))).length;
  const desktop = tally(users.map((u) => u.computerPlatform).filter((p): p is string => !!p));
  const phone = tally(users.flatMap((u) => [...new Set(u.phonePlatforms)]));
  const label = (m: Map<string, number>) => [...m].map(([k, n]) => ({ label: PLATFORM_LABELS[k] ?? k, n })).sort((a, b) => b.n - a.n);
  const platforms = { computers: label(desktop), phones: label(phone) };
  const versions = [...tally(users.map((u) => u.appVersion).filter((v): v is string => !!v))]
    .map(([label, n]) => ({ label, n }))
    .sort((a, b) => b.n - a.n || b.label.localeCompare(a.label, undefined, { numeric: true }));
  const ans = { computer: 0, cloud: 0, unanswered: 0 };
  for (const a of answers) ans[a.answeredBy ?? "unanswered"] += a.n;
  const statuses = { active: 0, at_risk: 0, never: 0 };
  for (const u of users) statuses[u.status] += 1;
  return {
    total: users.length,
    newUsers: { today: since(1), d7: since(7), d30: since(30) },
    active: activeUsers(days, today),
    daily: dailyActive(days, today, 30),
    funnel: funnel(users),
    retention: retentionCohorts(users, days, today, 8),
    platforms,
    versions,
    answers: ans,
    statuses,
    minutes7: users.reduce((s, u) => s + u.minutes7, 0),
    sharing: users.filter((u) => u.sharesCounts).length,
  };
}

// ── users table ──────────────────────────────────────────────────────────────

export const SORTS = ["createdAt", "email", "name", "lastActive", "activeDays30", "minutes7", "phones"] as const;
export type SortKey = (typeof SORTS)[number];
export const FILTERS = ["all", "active", "at_risk", "never"] as const;
export type Filter = (typeof FILTERS)[number];
export type UserQuery = { q?: string; filter?: string; sort?: string; dir?: string; page?: number; per?: number };

export function queryUsers(users: UserSummary[], query: UserQuery) {
  const q = (query.q ?? "").trim().toLowerCase();
  const filter: Filter = (FILTERS as readonly string[]).includes(query.filter ?? "") ? (query.filter as Filter) : "all";
  const sort: SortKey = (SORTS as readonly string[]).includes(query.sort ?? "") ? (query.sort as SortKey) : "createdAt";
  const dir = query.dir === "asc" ? 1 : query.dir === "desc" ? -1 : sort === "email" || sort === "name" ? 1 : -1;
  const per = Math.min(100_000, Math.max(1, Math.floor(query.per ?? 50) || 50));

  let rows = users.filter((u) => (filter === "all" || u.status === filter) && (!q || u.email.toLowerCase().includes(q) || u.name.toLowerCase().includes(q)));
  const key = (u: UserSummary): string | number | null => {
    const v = u[sort];
    if (v === null || v === undefined || v === "") return null;
    if (sort === "createdAt" || sort === "lastActive") return ms(v as string);
    return typeof v === "string" ? v.toLowerCase() : (v as number);
  };
  rows = [...rows].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1; // nulls last
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / per));
  const page = Math.min(pages, Math.max(1, Math.floor(query.page ?? 1) || 1));
  return { rows: rows.slice((page - 1) * per, page * per), total, pages, page, per, filter, sort, dir: dir === 1 ? "asc" : "desc" };
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** One CSV cell. Cells a spreadsheet would run as a formula (= + - @) get a leading apostrophe. */
export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: [keyof T & string, string][]): string {
  const line = (cells: unknown[]) => cells.map(csvEscape).join(",") + "\r\n";
  return line(columns.map(([, label]) => label)) + rows.map((r) => line(columns.map(([k]) => r[k]))).join("");
}

/** The columns of the users CSV export (no tokens, no hashes, no content). */
export function usersCsv(users: UserSummary[]): string {
  const rows = users.map((u) => ({
    email: u.email,
    name: u.name,
    provider: u.provider,
    signedUp: u.createdAt,
    lastDesktop: u.lastDesktop,
    lastPhone: u.lastPhone,
    status: u.status,
    activeDays30: u.activeDays30,
    minutes7: u.minutes7,
    phones: u.phones,
    computer: u.computerPlatform,
    version: u.appVersion,
    sync: u.syncOn,
    phoneAsks: u.phoneAsks,
    dictations30: u.sharesCounts ? (u.counts30.dictations ?? 0) : null,
    words30: u.sharesCounts ? (u.counts30.words ?? 0) : null,
    assistant30: u.sharesCounts ? (u.counts30.assistant_asks ?? 0) : null,
  }));
  return toCsv(rows, [
    ["email", "Email"],
    ["name", "Name"],
    ["provider", "Provider"],
    ["signedUp", "Signed up"],
    ["lastDesktop", "Last active (computer)"],
    ["lastPhone", "Last active (phone)"],
    ["status", "Status"],
    ["activeDays30", "Active days (30d)"],
    ["minutes7", "Minutes open (7d, approx)"],
    ["phones", "Phones"],
    ["computer", "Computer"],
    ["version", "App version"],
    ["sync", "Sync"],
    ["phoneAsks", "Phone asks"],
    ["dictations30", "Dictations (30d, opt-in)"],
    ["words30", "Words (30d, opt-in)"],
    ["assistant30", "Assistant asks (30d, opt-in)"],
  ]);
}
