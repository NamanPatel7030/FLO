import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ago, Card, DailyBars, fmtDate, fmtMinutes, fmtTime, Stat, StatusPill } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin-auth";
import { loadUser } from "@/lib/admin-data";
import { buildUserSummaries, minutesFromPings, userTimeline } from "@/lib/admin-metrics";
import { isUuid } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin", robots: { index: false, follow: false } };

const PLATFORM: Record<string, string> = { macos: "macOS", windows: "Windows", linux: "Linux", other: "Other", android: "Android", ios: "iOS" };
const COUNT_LABELS: [string, string][] = [
  ["dictations", "Dictations"],
  ["words", "Words dictated"],
  ["assistant_asks", "Assistant questions"],
  ["agent_runs", "Agent runs"],
  ["meetings", "Meetings recorded"],
];

/** One account: activity, devices and request counts. Never the content of questions, answers or screens. */
export default async function AdminUser({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const d = await loadUser(id, admin.demo);
  if (!d) notFound();
  const [u] = buildUserSummaries([d.user], d.days, d.counts, d.today);
  const timeline = userTimeline(d.days, id, d.today, 60);
  const now = Date.now();
  const total60 = timeline.reduce((s, t) => s + t.desktop + t.phone, 0);
  const activeDays60 = timeline.filter((t) => t.desktop + t.phone > 0).length;
  const counts60: Record<string, number> = {};
  for (const c of d.counts) counts60[c.kind] = (counts60[c.kind] ?? 0) + c.n;
  const byMode = d.requests.reduce<Record<string, number>>((m, r) => ((m[r.mode] = (m[r.mode] ?? 0) + 1), m), {});

  return (
    <div className="space-y-4">
      <Link href="/admin/users" className="inline-flex items-center gap-1.5 text-[13px] font-semibold mut hover:text-[var(--v2-ink)]">
        <ArrowLeft size={14} /> All users
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 break-all text-[clamp(22px,3.4vw,32px)] font-semibold tracking-[-0.03em] ink">{u.email}</h1>
        <StatusPill status={u.status} />
      </div>
      <p className="-mt-2 text-[13.5px] mut">
        {u.name || "No name"} · {u.provider} · signed up {fmtDate(u.createdAt)} · last web sign-in {ago(u.lastSignInAt, now)}
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Last on computer" value={ago(u.lastDesktop, now)} sub={u.appFirstSeen ? `First ${fmtDate(u.appFirstSeen)}` : "Never signed in on a computer"} />
        <Stat label="Last on phone" value={u.phones || u.lastPhone ? ago(u.lastPhone, now) : "—"} sub={u.phones ? `${u.phones} paired` : "No phone paired"} />
        <Stat label="Active days (60d)" value={activeDays60} sub={`${u.activeDays30} in the last 30`} />
        <Stat label="Time open (60d)" value={`≈${fmtMinutes(minutesFromPings(total60))}`} sub={`≈${fmtMinutes(u.minutes7)} in the last 7 days`} />
      </div>

      {!d.usageReady && <p className="rounded-2xl bg-[rgba(255,170,60,0.16)] px-4 py-3 text-[13px] text-[#7a4700]">Daily activity needs migration 0009.</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Computer: minutes open per day" hint="Last 60 days, approximate (10-minute blocks).">
          <DailyBars label="Computer minutes per day" unit="min" height={120} points={timeline.map((t) => ({ day: t.day, value: minutesFromPings(t.desktop) }))} />
        </Card>
        <Card title="Phone: minutes in use per day" hint="Last 60 days, approximate. Requests sent that day in the tooltip.">
          <DailyBars
            label="Phone minutes per day"
            unit="min"
            height={120}
            color="var(--v2-violet)"
            points={timeline.map((t) => ({ day: t.day, value: minutesFromPings(t.phone), detail: t.requests ? `${t.requests} requests` : undefined }))}
          />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Computer" hint="From the snapshot the app shares with a paired phone, and its check-ins.">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            <dt className="mut">Platform</dt>
            <dd className="ink">{u.computerPlatform ? PLATFORM[u.computerPlatform] ?? u.computerPlatform : "Not reported"}</dd>
            <dt className="mut">App version</dt>
            <dd className="ink">{u.appVersion ? `v${u.appVersion}` : "Not reported"}</dd>
            <dt className="mut">Snapshot</dt>
            <dd className="ink">{fmtTime(u.stateUpdatedAt)}</dd>
            <dt className="mut">First seen</dt>
            <dd className="ink">{fmtTime(u.appFirstSeen)}</dd>
            <dt className="mut">Last check-in</dt>
            <dd className="ink">{fmtTime(u.appLastSeen)}</dd>
            <dt className="mut">Presence</dt>
            <dd className="ink">{d.presence ? `${d.presence.status}, since ${fmtTime(d.presence.since)}` : "—"}</dd>
            <dt className="mut">Sync</dt>
            <dd className="ink">{u.syncOn ? `On · ${u.syncItems} encrypted items` : "Off"}</dd>
          </dl>
        </Card>

        <Card title="Phones">
          {d.devices.length === 0 ? (
            <p className="text-[13px] mut">No phone paired.</p>
          ) : (
            <ul className="space-y-2.5 text-[13px]">
              {d.devices.map((x, i) => (
                <li key={i} className="rounded-xl bg-[rgba(255,255,255,0.55)] px-3 py-2">
                  <p className="font-semibold ink">
                    {x.name} <span className="font-normal fnt">· {PLATFORM[x.platform] ?? x.platform}</span>
                  </p>
                  <p className="text-[12px] mut">
                    Paired {fmtDate(x.pairedAt)} · seen {ago(x.lastSeen, now)} · push {x.push ? "on" : "off"}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {d.notifications.length > 0 && (
            <p className="mt-3 text-[12px] mut">Inbox (30d): {d.notifications.map((n) => `${n.n} ${n.kind.replace(/_/g, " ")}`).join(" · ")}</p>
          )}
        </Card>

        <Card title="Usage counts (60d)" hint="Only if they turned on Share usage counts in the app.">
          {d.counts.length === 0 ? (
            <p className="text-[13px] mut">Not shared.</p>
          ) : (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[13px]">
              {COUNT_LABELS.map(([k, l]) => (
                <div key={k} className="contents">
                  <dt className="mut">{l}</dt>
                  <dd className="text-right tabular-nums ink">{(counts60[k] ?? 0).toLocaleString("en")}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>
      </div>

      <Card title="Recent phone requests" hint="Kept 7 days on the server. Times and outcome only: the question, screen and answer are never shown here.">
        {d.requests.length === 0 ? (
          <p className="text-[13px] mut">None in the last 7 days.</p>
        ) : (
          <>
            <p className="mb-2 text-[12.5px] mut">
              {Object.entries(byMode)
                .map(([m, n]) => `${n} ${m}${n === 1 ? "" : "s"}`)
                .join(" · ")}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-[12.5px] tabular-nums">
                <thead className="text-[11px] uppercase tracking-wider fnt">
                  <tr>
                    <th className="py-1.5 pr-3 font-semibold">Sent</th>
                    <th className="py-1.5 pr-3 font-semibold">Kind</th>
                    <th className="py-1.5 pr-3 font-semibold">Status</th>
                    <th className="py-1.5 pr-3 font-semibold">Answered by</th>
                    <th className="py-1.5 font-semibold">Took</th>
                  </tr>
                </thead>
                <tbody>
                  {d.requests.map((r, i) => (
                    <tr key={i} className="border-t border-[rgba(20,40,80,0.06)]">
                      <td className="py-1.5 pr-3 ink-2">{fmtTime(r.createdAt)}</td>
                      <td className="py-1.5 pr-3 ink">{r.mode}</td>
                      <td className="py-1.5 pr-3 ink-2">{r.status}</td>
                      <td className="py-1.5 pr-3 ink-2">{r.answeredBy ?? "—"}</td>
                      <td className="py-1.5 ink-2">{r.doneAt ? `${Math.max(0, Math.round((Date.parse(r.doneAt) - Date.parse(r.createdAt)) / 1000))}s` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
