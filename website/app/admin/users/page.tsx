import Link from "next/link";
import { Download, Laptop, Smartphone } from "lucide-react";
import { AdminNav, ago, fmtDate, fmtMinutes, StatusPill } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin-auth";
import { loadDataset } from "@/lib/admin-data";
import { buildUserSummaries, queryUsers, type SortKey } from "@/lib/admin-metrics";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin", robots: { index: false, follow: false } };

type Search = { q?: string; filter?: string; sort?: string; dir?: string; page?: string };

const FILTER_LABELS: [string, string][] = [
  ["all", "Everyone"],
  ["active", "Active (7 days)"],
  ["at_risk", "At risk"],
  ["never", "Never activated"],
];
const PLATFORM: Record<string, string> = { macos: "macOS", windows: "Windows", linux: "Linux", other: "Other" };

export default async function AdminUsers({ searchParams }: { searchParams: Promise<Search> }) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const data = await loadDataset(admin.demo);
  const all = buildUserSummaries(data.users, data.days, data.counts, data.today);
  const res = queryUsers(all, { q: sp.q, filter: sp.filter, sort: sp.sort, dir: sp.dir, page: Number(sp.page) || 1, per: 50 });

  const params = (o: Partial<Search>) => {
    const p = new URLSearchParams();
    const merged = { q: sp.q ?? "", filter: res.filter, sort: res.sort, dir: res.dir, page: String(res.page), ...o };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "filter" && v === "all") && !(k === "page" && v === "1")) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const sortLink = (key: SortKey, label: string, align = "text-left") => {
    const on = res.sort === key;
    const dir = on ? (res.dir === "asc" ? "desc" : "asc") : key === "email" || key === "name" ? "asc" : "desc";
    return (
      <th className={`whitespace-nowrap px-3 py-2 font-semibold ${align}`} aria-sort={on ? (res.dir === "asc" ? "ascending" : "descending") : undefined}>
        <Link href={`/admin/users${params({ sort: key, dir, page: "1" })}`} className={on ? "ink" : "hover:text-[var(--v2-ink)]"}>
          {label}
          {on ? (res.dir === "asc" ? " ↑" : " ↓") : ""}
        </Link>
      </th>
    );
  };
  const csvHref = `/api/admin/users${params({ page: "1" })}`;
  const now = Date.now();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[clamp(26px,4vw,36px)] font-semibold tracking-[-0.03em] ink">Users</h1>
          <p className="mt-1 text-[13.5px] mut">
            {res.total} of {all.length} · minutes are approximate (10-minute blocks the app was open)
          </p>
        </div>
        <AdminNav current="users" demo={admin.demo} />
      </div>

      <form method="get" action="/admin/users" className="g-2 flex flex-wrap items-center gap-2 rounded-[20px] p-3">
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search email or name"
          aria-label="Search email or name"
          className="h-9 min-w-0 flex-1 basis-48 rounded-full border border-[rgba(20,40,80,0.1)] bg-[rgba(255,255,255,0.8)] px-4 text-[13.5px] outline-none focus:border-[var(--v2-blue)]"
        />
        <select name="filter" defaultValue={res.filter} aria-label="Filter" className="h-9 rounded-full border border-[rgba(20,40,80,0.1)] bg-[rgba(255,255,255,0.8)] px-3 text-[13.5px]">
          {FILTER_LABELS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <input type="hidden" name="sort" value={res.sort} />
        <input type="hidden" name="dir" value={res.dir} />
        <button type="submit" className="h-9 rounded-full bg-[#0b1220] px-4 text-[13.5px] font-semibold text-[#fff]">
          Apply
        </button>
        <a href={csvHref} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[rgba(20,40,80,0.12)] bg-[rgba(255,255,255,0.8)] px-3.5 text-[13.5px] font-semibold ink-2" download>
          <Download size={14} /> CSV
        </a>
      </form>

      <div className="g-2 overflow-hidden rounded-[22px]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-[13px]">
            <thead className="bg-[rgba(255,255,255,0.5)] text-[11px] uppercase tracking-wider fnt">
              <tr>
                {sortLink("email", "User")}
                {sortLink("createdAt", "Signed up")}
                {sortLink("lastActive", "Last active")}
                {sortLink("activeDays30", "Days (30d)", "text-right")}
                {sortLink("minutes7", "Time (7d)", "text-right")}
                {sortLink("phones", "Phone")}
                <th className="px-3 py-2 font-semibold">Computer</th>
                <th className="px-3 py-2 font-semibold">Sync</th>
                <th className="px-3 py-2 font-semibold">Counts (30d, opt-in)</th>
              </tr>
            </thead>
            <tbody>
              {res.rows.map((u) => (
                <tr key={u.id} className="border-t border-[rgba(20,40,80,0.06)] align-top hover:bg-[rgba(255,255,255,0.45)]">
                  <td className="max-w-[260px] px-3 py-2.5">
                    <Link href={`/admin/users/${u.id}`} className="block truncate font-semibold ink hover:underline">
                      {u.email}
                    </Link>
                    <span className="flex items-center gap-2 text-[12px] mut">
                      <span className="truncate">{u.name || "—"}</span>
                      <StatusPill status={u.status} />
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 ink-2">
                    {fmtDate(u.createdAt)}
                    <span className="block text-[12px] fnt">{u.provider}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 ink-2">
                    <span className="flex items-center gap-1.5"><Laptop size={13} className="fnt" aria-label="Computer" /> {ago(u.lastDesktop, now)}</span>
                    <span className="flex items-center gap-1.5 text-[12px] mut"><Smartphone size={13} className="fnt" aria-label="Phone" /> {u.phones || u.lastPhone ? ago(u.lastPhone, now) : "—"}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums ink">{u.activeDays30}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums ink">{u.minutes7 ? `≈${fmtMinutes(u.minutes7)}` : "0"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 ink-2">
                    {u.phones ? `Yes (${u.phones})` : "No"}
                    {u.phoneAsks > 0 && <span className="block text-[12px] fnt">{u.phoneAsks} asks</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 ink-2">
                    {u.computerPlatform ? PLATFORM[u.computerPlatform] ?? u.computerPlatform : "—"}
                    {u.appVersion && <span className="block text-[12px] fnt">v{u.appVersion}</span>}
                  </td>
                  <td className="px-3 py-2.5 ink-2">{u.syncOn ? "On" : "—"}</td>
                  <td className="px-3 py-2.5 text-[12px] mut">
                    {u.sharesCounts ? (
                      <>
                        {(u.counts30.dictations ?? 0).toLocaleString("en")} dictations · {(u.counts30.words ?? 0).toLocaleString("en")} words
                        <span className="block">
                          {u.counts30.assistant_asks ?? 0} asks · {u.counts30.agent_runs ?? 0} agent runs · {u.counts30.meetings ?? 0} meetings
                        </span>
                      </>
                    ) : (
                      <span className="fnt">Not shared</span>
                    )}
                  </td>
                </tr>
              ))}
              {res.rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center mut">
                    No users match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {res.pages > 1 && (
        <nav className="flex items-center justify-center gap-2 text-[13px]" aria-label="Pages">
          {res.page > 1 && (
            <Link href={`/admin/users${params({ page: String(res.page - 1) })}`} className="g-2 rounded-full px-3.5 py-1.5 font-semibold ink-2">
              ← Previous
            </Link>
          )}
          <span className="mut">
            Page {res.page} of {res.pages}
          </span>
          {res.page < res.pages && (
            <Link href={`/admin/users${params({ page: String(res.page + 1) })}`} className="g-2 rounded-full px-3.5 py-1.5 font-semibold ink-2">
              Next →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
