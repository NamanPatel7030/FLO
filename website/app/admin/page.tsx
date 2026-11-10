import Link from "next/link";
import { AdminNav, Card, DailyBars, fmtDay, fmtMinutes, Meters, Stat } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin-auth";
import { loadDataset } from "@/lib/admin-data";
import { buildUserSummaries, overview, type Triple } from "@/lib/admin-metrics";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin", robots: { index: false, follow: false } };

function TripleStat({ label, t, total }: { label: string; t: Triple; total: number }) {
  return (
    <Stat
      label={label}
      value={t.either}
      sub={
        <>
          {t.desktop} computer · {t.phone} phone
          {total > 0 && <span className="fnt"> · {Math.round((t.either / total) * 100)}% of users</span>}
        </>
      }
    />
  );
}

export default async function AdminOverview() {
  const admin = await requireAdmin();
  const data = await loadDataset(admin.demo);
  const users = buildUserSummaries(data.users, data.days, data.counts, data.today);
  const o = overview(users, data.days, data.answers, data.today);
  const answered = o.answers.computer + o.answers.cloud;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[clamp(26px,4vw,36px)] font-semibold tracking-[-0.03em] ink">Who&apos;s using Flo</h1>
          <p className="mt-1 text-[13.5px] mut">UTC days. Activity comes from the apps&apos; normal check-ins; usage counts only from people who opted in.</p>
        </div>
        <AdminNav current="overview" demo={admin.demo} />
      </div>

      {!data.usageReady && (
        <p className="rounded-2xl bg-[rgba(255,170,60,0.16)] px-4 py-3 text-[13px] text-[#7a4700]">
          Daily activity isn&apos;t recorded yet: apply <code>supabase/migrations/0009_usage_days.sql</code>. Last-seen times below still work.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Users" value={o.total} sub={`${o.statuses.never} not activated`} />
        <Stat label="New" value={o.newUsers.d7} sub={`${o.newUsers.today} today · ${o.newUsers.d30} in 30d`} />
        <TripleStat label="Daily active" t={o.active.dau} total={o.total} />
        <TripleStat label="Weekly active" t={o.active.wau} total={o.total} />
        <TripleStat label="Monthly active" t={o.active.mau} total={o.total} />
        <Stat label="At risk" value={o.statuses.at_risk} sub="Active before, not in 7 days" />
      </div>

      <Card title="Active users per day" hint="Users whose computer app or phone checked in that day (last 30 days). Hover a bar for the split.">
        <DailyBars label="Active users per day, last 30 days" unit="active" points={o.daily.map((d) => ({ day: d.day, value: d.either, detail: `${d.desktop} computer, ${d.phone} phone` }))} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Activation" hint="How far each account has got.">
          <ol className="space-y-2.5">
            {o.funnel.map((f, i) => (
              <li key={f.label}>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="ink-2">
                    <span className="fnt">{i + 1}.</span> {f.label}
                  </span>
                  <span className="tabular-nums ink">
                    {f.n} <span className="fnt">· {o.total ? Math.round((f.n / o.total) * 100) : 0}%</span>
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-[rgba(20,40,80,0.07)]">
                  <div className="h-full rounded-full bg-[var(--v2-blue)]" style={{ width: `${o.total ? (f.n / o.total) * 100 : 0}%` }} />
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="Platforms" hint="Computers report their platform in the snapshot they share with a paired phone.">
          <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wider fnt">Computers</p>
          <Meters items={o.platforms.computers} empty="None reported yet." />
          <p className="mb-2 mt-4 text-[11.5px] font-semibold uppercase tracking-wider fnt">Phones</p>
          <Meters items={o.platforms.phones} empty="No phones paired yet." />
        </Card>

        <Card title="App versions" hint="Computers that reported a version.">
          <Meters items={o.versions.slice(0, 8)} empty="No versions reported yet." />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Retention by signup week" hint="Share of each week's new users active 1 to 4 weeks later. Blank: week not over yet." className="lg:col-span-2">
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[420px] text-[12.5px] tabular-nums">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider fnt">
                  <th className="py-1.5 pr-2 font-semibold">Week of</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">Users</th>
                  {[1, 2, 3, 4].map((w) => (
                    <th key={w} className="py-1.5 text-center font-semibold">
                      Wk {w}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {o.retention.map((c) => (
                  <tr key={c.week} className="border-t border-[rgba(20,40,80,0.06)]">
                    <td className="py-1.5 pr-2 ink-2">{fmtDay(c.week)}</td>
                    <td className="py-1.5 pr-2 text-right ink">{c.size}</td>
                    {c.weeks.map((v, i) => (
                      <td key={i} className="p-0.5">
                        <div
                          className={`rounded-md py-1 text-center ${v === null ? "fnt" : v >= 50 ? "text-[#fff]" : "ink"}`}
                          style={{ background: v === null ? "transparent" : `rgb(47 140 255 / ${0.08 + (v / 100) * 0.82})` }}
                        >
                          {v === null ? "" : `${v}%`}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Phone answers (7 days)" hint="Who answered questions asked from a phone.">
          <Meters
            items={[
              { label: "By the user's computer", n: o.answers.computer },
              { label: "By the cloud (computer offline)", n: o.answers.cloud },
              { label: "Not answered", n: o.answers.unanswered },
            ]}
            empty="No phone questions in the last 7 days."
          />
          <p className="mt-3 text-[12.5px] mut">
            {answered} answered · ≈{fmtMinutes(o.minutes7)} apps open this week · {o.sharing} sharing usage counts
          </p>
        </Card>
      </div>

      <p className="text-center text-[12.5px] mut">
        <Link href="/admin/users?filter=at_risk" className="font-semibold text-[#2f8cff] hover:underline">
          See who&apos;s at risk
        </Link>{" "}
        ·{" "}
        <Link href="/admin/users?filter=never" className="font-semibold text-[#2f8cff] hover:underline">
          Never activated
        </Link>
      </p>
    </div>
  );
}
