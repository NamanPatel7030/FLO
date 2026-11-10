import "server-only";
import { sql, toIso } from "./db";
import { demoData } from "./admin-demo";
import { todayUtc, type AdminUser, type AnswerRow, type CountRow, type UsageDay } from "./admin-metrics";

/**
 * Reads for the admin panel. Only metadata and counts: never tokens, hashes, push tokens, phone request
 * text or answers, screen context, notification bodies or sync ciphertext. Aggregation is in
 * lib/admin-metrics.ts (pure); demo mode swaps these reads for lib/admin-demo.ts.
 *
 * Everything is loaded at once and aggregated in memory, which is fine for thousands of accounts.
 */
export type AdminDataset = { users: AdminUser[]; days: UsageDay[]; counts: CountRow[]; answers: AnswerRow[]; today: string; usageReady: boolean };

const isoOrNull = (v: unknown) => (v ? toIso(v) : null);
const missingTable = (e: unknown) => /relation .* does not exist/i.test(String((e as Error)?.message ?? e));

type UserRow = {
  id: string;
  email: string;
  name: string;
  provider: string;
  created_at: Date;
  last_sign_in_at: Date | null;
  first_seen: Date | null;
  last_seen: Date | null;
  phones: number;
  phone_last_seen: Date | null;
  phone_platforms: string[] | null;
  computer_platform: string | null;
  app_version: string | null;
  state_updated_at: Date | null;
  sync_on: boolean;
  sync_items: number;
  recent_requests: number;
};

const toAdminUser = (r: UserRow): AdminUser => ({
  id: String(r.id),
  email: String(r.email ?? ""),
  name: String(r.name ?? ""),
  provider: String(r.provider ?? "email"),
  createdAt: toIso(r.created_at),
  lastSignInAt: isoOrNull(r.last_sign_in_at),
  appFirstSeen: isoOrNull(r.first_seen),
  appLastSeen: isoOrNull(r.last_seen),
  phones: Number(r.phones ?? 0),
  phoneLastSeen: isoOrNull(r.phone_last_seen),
  phonePlatforms: (r.phone_platforms ?? []).map(String),
  computerPlatform: r.computer_platform ? String(r.computer_platform).slice(0, 20) : null,
  appVersion: r.app_version ? String(r.app_version).slice(0, 40) : null,
  stateUpdatedAt: isoOrNull(r.state_updated_at),
  syncOn: Boolean(r.sync_on),
  syncItems: Number(r.sync_items ?? 0),
  recentRequests: Number(r.recent_requests ?? 0),
});

async function readUsers(userId?: string): Promise<AdminUser[]> {
  const db = sql();
  const one = userId ? db`and u.id = ${userId}::uuid` : db``;
  const rows = await db<UserRow[]>`
    select u.id,
           coalesce(u.email, '') as email,
           coalesce(p.name, '') as name,
           coalesce(u.raw_app_meta_data ->> 'provider', 'email') as provider,
           u.created_at, u.last_sign_in_at,
           au.first_seen, au.last_seen,
           coalesce(md.phones, 0) as phones, md.phone_last_seen, md.phone_platforms,
           ds.state -> 'computer' ->> 'platform' as computer_platform,
           ds.state -> 'computer' ->> 'appVersion' as app_version,
           ds.updated_at as state_updated_at,
           (sk.user_id is not null) as sync_on,
           coalesce(si.items, 0) as sync_items,
           coalesce(mr.n, 0) as recent_requests
      from auth.users u
      left join public.profiles p on p.id = u.id
      left join app.app_usage au on au.user_id = u.id
      left join app.desktop_state ds on ds.user_id = u.id
      left join app.sync_keys sk on sk.user_id = u.id
      left join (select user_id, count(*)::int as phones, max(last_seen) as phone_last_seen, array_agg(distinct platform) as phone_platforms
                   from app.mobile_devices group by user_id) md on md.user_id = u.id
      left join (select user_id, count(*)::int as items from app.sync_items where not deleted group by user_id) si on si.user_id = u.id
      left join (select user_id, count(*)::int as n from app.mobile_requests group by user_id) mr on mr.user_id = u.id
     where u.deleted_at is null and u.email_confirmed_at is not null ${one}
     order by u.created_at desc`;
  return rows.map(toAdminUser);
}

async function readDays(sinceDays: number, userId?: string): Promise<{ days: UsageDay[]; ready: boolean }> {
  const db = sql();
  const one = userId ? db`and user_id = ${userId}::uuid` : db``;
  try {
    const rows = await db<{ user_id: string; day: string; surface: "desktop" | "phone"; pings: number; requests: number }[]>`
      select user_id, day::text as day, surface, pings, requests from app.usage_days
       where day >= (now() at time zone 'utc')::date - ${sinceDays}::int ${one}`;
    return { days: rows.map((r) => ({ userId: String(r.user_id), day: r.day, surface: r.surface, pings: Number(r.pings), requests: Number(r.requests) })), ready: true };
  } catch (e) {
    if (missingTable(e)) return { days: [], ready: false }; // 0009 not applied yet
    throw e;
  }
}

async function readCounts(sinceDays: number, userId?: string): Promise<CountRow[]> {
  const db = sql();
  const one = userId ? db`and user_id = ${userId}::uuid` : db``;
  try {
    const rows = await db<{ user_id: string; day: string; kind: string; n: number }[]>`
      select user_id, day::text as day, kind, n from app.usage_counts
       where day >= (now() at time zone 'utc')::date - ${sinceDays}::int ${one}`;
    return rows.map((r) => ({ userId: String(r.user_id), day: r.day, kind: r.kind, n: Number(r.n) }));
  } catch (e) {
    if (missingTable(e)) return [];
    throw e;
  }
}

export async function loadDataset(demo: boolean): Promise<AdminDataset> {
  const today = todayUtc();
  if (demo) return { ...demoData(today), today, usageReady: true };
  const [users, d, counts, answers] = await Promise.all([
    readUsers(),
    readDays(120),
    readCounts(60),
    sql()<{ answered_by: "computer" | "cloud" | null; n: number }[]>`
      select answered_by, count(*)::int as n from app.mobile_requests where created_at > now() - interval '7 days' group by answered_by`,
  ]);
  return { users, days: d.days, counts, answers: answers.map((a) => ({ answeredBy: a.answered_by, n: Number(a.n) })), today, usageReady: d.ready };
}

// ── one user ─────────────────────────────────────────────────────────────────

export type DeviceInfo = { name: string; platform: string; pairedAt: string; lastSeen: string; push: boolean };
/** Phone requests with timestamps and outcome only (never the text, screen context or answer). */
export type RequestMeta = { mode: string; status: string; answeredBy: string | null; createdAt: string; doneAt: string | null };

export type UserDetail = {
  user: AdminUser;
  days: UsageDay[];
  counts: CountRow[];
  devices: DeviceInfo[];
  requests: RequestMeta[];
  notifications: { kind: string; n: number }[];
  presence: { status: string; since: string } | null;
  today: string;
  usageReady: boolean;
};

export async function loadUser(id: string, demo: boolean): Promise<UserDetail | null> {
  const today = todayUtc();
  if (demo) {
    const data = demoData(today);
    const user = data.users.find((u) => u.id === id);
    if (!user) return null;
    const devices: DeviceInfo[] = user.phones ? [{ name: "Pixel 8", platform: "android", pairedAt: user.appFirstSeen ?? user.createdAt, lastSeen: user.phoneLastSeen ?? user.createdAt, push: true }] : [];
    const requests: RequestMeta[] = Array.from({ length: user.recentRequests }, (_, i) => ({
      mode: ["ask", "todo", "ask", "note"][i % 4],
      status: "done",
      answeredBy: i % 3 === 0 ? "cloud" : "computer",
      createdAt: new Date(Date.parse(`${today}T05:00:00Z`) - i * 7_200_000).toISOString(),
      doneAt: new Date(Date.parse(`${today}T05:00:20Z`) - i * 7_200_000).toISOString(),
    }));
    return {
      user,
      days: data.days.filter((d) => d.userId === id),
      counts: data.counts.filter((c) => c.userId === id),
      devices,
      requests,
      notifications: user.phones ? [{ kind: "claude_done", n: 6 }, { kind: "todo_due", n: 2 }] : [],
      presence: user.phones ? { status: "active", since: user.appLastSeen ?? user.createdAt } : null,
      today,
      usageReady: true,
    };
  }

  const [user] = await readUsers(id);
  if (!user) return null;
  const db = sql();
  const [d, counts, devices, requests, notifications, presence] = await Promise.all([
    readDays(60, id),
    readCounts(60, id),
    db<{ name: string; platform: string; created_at: Date; last_seen: Date; push: boolean }[]>`
      select name, platform, created_at, last_seen, (push_token is not null) as push
        from app.mobile_devices where user_id = ${id} order by created_at desc`,
    db<{ mode: string; status: string; answered_by: string | null; created_at: Date; done_at: Date | null }[]>`
      select mode, status, answered_by, created_at, done_at
        from app.mobile_requests where user_id = ${id} order by created_at desc limit 50`,
    db<{ kind: string; n: number }[]>`
      select kind, count(*)::int as n from app.notifications
       where user_id = ${id} and created_at > now() - interval '30 days' group by kind order by n desc`,
    db<{ status: string; since: Date }[]>`select status, since from app.presence where user_id = ${id}`,
  ]);
  return {
    user,
    days: d.days,
    counts,
    devices: devices.map((x) => ({ name: String(x.name).slice(0, 80), platform: String(x.platform), pairedAt: toIso(x.created_at), lastSeen: toIso(x.last_seen), push: Boolean(x.push) })),
    requests: requests.map((r) => ({ mode: r.mode, status: r.status, answeredBy: r.answered_by, createdAt: toIso(r.created_at), doneAt: isoOrNull(r.done_at) })),
    notifications: notifications.map((n) => ({ kind: n.kind, n: Number(n.n) })),
    presence: presence[0] ? { status: presence[0].status, since: toIso(presence[0].since) } : null,
    today,
    usageReady: d.ready,
  };
}
