// Sample data for the admin panel's demo mode (ADMIN_DEMO=1, never on Vercel; see lib/admin-access.ts).
// Fake people on example.com, generated deterministically from `today`, shaped exactly like the rows
// lib/admin-data.ts reads, so the panel renders through the same aggregation with no database.
import type { AdminUser, AnswerRow, CountRow, UsageDay } from "./admin-metrics";

const FIRST = ["Ava", "Liam", "Maya", "Noah", "Priya", "Arjun", "Zara", "Leo", "Isha", "Omar", "Mia", "Kabir", "Sara", "Ethan", "Anya", "Ravi", "Lena", "Dev", "Nora", "Yusuf", "Tara", "Ivan", "Meera", "Jon"];
const LAST = ["Shah", "Patel", "Kim", "Garcia", "Rao", "Mehta", "Nguyen", "Silva", "Khan", "Iyer", "Brown", "Das"];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;

export function demoData(today: string): { users: AdminUser[]; days: UsageDay[]; counts: CountRow[]; answers: AnswerRow[] } {
  const r = rng(today.split("-").reduce((s, x) => s * 31 + Number(x), 7));
  const end = Date.parse(`${today}T06:00:00Z`);
  const iso = (t: number) => new Date(t).toISOString();
  const users: AdminUser[] = [];
  const days: UsageDay[] = [];
  const counts: CountRow[] = [];

  for (let i = 0; i < 48; i++) {
    const first = FIRST[i % FIRST.length];
    const last = LAST[(i * 7) % LAST.length];
    const signedUp = end - Math.floor(r() * 75) * DAY - Math.floor(r() * 20) * 3_600_000;
    // 0 never opened the app, 1 tried it and stopped, 2 casual, 3 daily
    const kind = i % 6 === 5 ? 0 : i % 5 === 4 ? 1 : r() < 0.55 ? 2 : 3;
    const hasPhone = kind >= 2 && r() < 0.55;
    const platform = r() < 0.72 ? "macos" : r() < 0.7 ? "windows" : "linux";
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    let lastDesk: number | null = null;
    let lastPhone: number | null = null;
    let firstDesk: number | null = null;
    const startDay = Math.ceil((signedUp - (end - 90 * DAY)) / DAY);
    const stopAfter = kind === 1 ? 3 + Math.floor(r() * 10) : Infinity;
    let active = 0;
    for (let k = Math.max(0, startDay); k <= 90; k++) {
      const t = end - (90 - k) * DAY;
      if (t < signedUp || kind === 0 || active >= stopAfter) continue;
      const p = kind === 3 ? 0.85 : kind === 2 ? 0.4 : 0.6;
      if (r() > p) continue;
      active++;
      const day = iso(t).slice(0, 10);
      const pings = 1 + Math.floor(r() * (kind === 3 ? 40 : 14));
      days.push({ userId: id, day, surface: "desktop", pings, requests: 0 });
      firstDesk ??= t;
      lastDesk = t;
      if (hasPhone && r() < 0.5) {
        days.push({ userId: id, day, surface: "phone", pings: 1 + Math.floor(r() * 6), requests: Math.floor(r() * 4) });
        lastPhone = t;
      }
      if (i % 3 === 0) {
        const dict = Math.floor(pings * (1 + r() * 2));
        counts.push({ userId: id, day, kind: "dictations", n: dict }, { userId: id, day, kind: "words", n: dict * (8 + Math.floor(r() * 30)) }, { userId: id, day, kind: "assistant_asks", n: Math.floor(r() * 8) });
        if (r() < 0.2) counts.push({ userId: id, day, kind: "meetings", n: 1 });
        if (r() < 0.15) counts.push({ userId: id, day, kind: "agent_runs", n: 1 + Math.floor(r() * 3) });
      }
    }
    users.push({
      id,
      email: `${first}.${last}${i}@example.com`.toLowerCase(),
      name: `${first} ${last}`,
      provider: r() < 0.8 ? "google" : "email",
      createdAt: iso(signedUp),
      lastSignInAt: iso(Math.max(signedUp, lastDesk ?? signedUp)),
      appFirstSeen: firstDesk ? iso(firstDesk) : null,
      appLastSeen: lastDesk ? iso(lastDesk) : null,
      phones: hasPhone ? 1 : 0,
      phoneLastSeen: lastPhone ? iso(lastPhone) : null,
      phonePlatforms: hasPhone ? ["android"] : [],
      computerPlatform: hasPhone && firstDesk ? platform : null,
      appVersion: hasPhone && firstDesk ? (r() < 0.7 ? "0.9.4" : r() < 0.6 ? "0.9.3" : "0.9.1") : null,
      stateUpdatedAt: hasPhone && lastDesk ? iso(lastDesk) : null,
      syncOn: kind >= 2 && r() < 0.3,
      syncItems: 0,
      recentRequests: hasPhone ? Math.floor(r() * 5) : 0,
    });
  }
  const answers: AnswerRow[] = [
    { answeredBy: "computer", n: 41 },
    { answeredBy: "cloud", n: 17 },
    { answeredBy: null, n: 3 },
  ];
  return { users, days, counts, answers };
}
