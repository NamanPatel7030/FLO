import Link from "next/link";

/** Small server-rendered pieces for /admin. Light glass (.v2 tokens) like the rest of the site. */

export function Card({ title, hint, children, className = "" }: { title?: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`g-2 min-w-0 rounded-[22px] p-4 sm:p-5 ${className}`}>
      {title && (
        <header className="mb-3">
          <h2 className="text-[14.5px] font-semibold tracking-tight ink">{title}</h2>
          {hint && <p className="mt-0.5 text-[12.5px] leading-snug mut">{hint}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="g-2 min-w-0 rounded-[20px] px-4 py-3.5">
      <p className="text-[11.5px] font-semibold uppercase tracking-wider fnt">{label}</p>
      <p className="mt-1 text-[26px] font-semibold leading-none tracking-tight tabular-nums ink">{value}</p>
      {sub && <p className="mt-1.5 text-[12.5px] leading-snug mut">{sub}</p>}
    </div>
  );
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const shortFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

export const fmtDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : "—");
export const fmtDay = (day: string) => shortFmt.format(new Date(`${day}T00:00:00Z`));
export const fmtTime = (iso: string | null) => (iso ? `${timeFmt.format(new Date(iso))} UTC` : "—");

export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  const d = Math.round(s / 86_400);
  return d < 60 ? `${d}d ago` : fmtDate(iso);
}

export function fmtMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return `${h}h${min % 60 ? ` ${min % 60}m` : ""}`;
}

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

/**
 * Daily columns (inline SVG, no chart library): one bar per day, 2px gaps, rounded tops anchored to the
 * baseline. Each column has a full-height hover target with a native tooltip; a table view follows.
 */
export function DailyBars({ points, label, unit, color = "var(--v2-blue)", height = 160 }: { points: { day: string; value: number; detail?: string }[]; label: string; unit: string; color?: string; height?: number }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const nice = niceMax(max);
  const w = 10;
  const gap = 2;
  const width = points.length * (w + gap) - gap;
  const first = points[0]?.day;
  const last = points[points.length - 1]?.day;
  return (
    <figure className="min-w-0" aria-label={label}>
      <div className="flex gap-2">
        <div className="flex flex-col justify-between py-0 text-right text-[11px] tabular-nums fnt" style={{ height }} aria-hidden>
          <span>{nice}</span>
          <span>{Math.round(nice / 2)}</span>
          <span>0</span>
        </div>
        <div className="relative min-w-0 flex-1" style={{ height }}>
          <div className="absolute inset-x-0 top-0 border-t border-dashed border-[rgba(20,40,80,0.08)]" />
          <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-[rgba(20,40,80,0.08)]" />
          <div className="absolute inset-x-0 bottom-0 border-t border-[rgba(20,40,80,0.16)]" />
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img" aria-label={label}>
            {points.map((p, i) => {
              const h = p.value > 0 ? Math.max(2, (p.value / nice) * height) : 0;
              const x = i * (w + gap);
              const r = Math.min(4, h / 2, w / 2);
              return (
                <g key={p.day} className="admin-bar">
                  <title>{`${fmtDay(p.day)}: ${p.value} ${unit}${p.detail ? ` (${p.detail})` : ""}`}</title>
                  <rect x={x - gap / 2} y={0} width={w + gap} height={height} fill="transparent" />
                  {h > 0 && <path d={`M${x},${height} V${height - h + r} Q${x},${height - h} ${x + r},${height - h} H${x + w - r} Q${x + w},${height - h} ${x + w},${height - h + r} V${height} Z`} fill={color} />}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <div className="mt-1.5 flex justify-between pl-8 text-[11px] fnt">
        <span>{first && fmtDay(first)}</span>
        <span>{last && fmtDay(last)}</span>
      </div>
      <details className="mt-2 text-[12px] mut">
        <summary className="cursor-pointer select-none">Show as table</summary>
        <div className="mt-2 max-h-56 overflow-auto rounded-xl border border-[rgba(20,40,80,0.08)]">
          <table className="w-full text-left tabular-nums">
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.day} className="border-t border-[rgba(20,40,80,0.06)] first:border-0">
                  <td className="px-3 py-1">{fmtDay(p.day)}</td>
                  <td className="px-3 py-1 text-right ink">{p.value}</td>
                  <td className="px-3 py-1 fnt">{p.detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function niceMax(n: number): number {
  if (n <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(n));
  return [1, 2, 4, 5, 10].map((m) => m * p).find((v) => v >= n) ?? n;
}

/** Labelled horizontal meters (share of a total), value in ink, bar carries no meaning on its own. */
export function Meters({ items, total, empty = "No data yet." }: { items: { label: string; n: number }[]; total?: number; empty?: string }) {
  const of = total ?? items.reduce((s, i) => s + i.n, 0);
  if (!items.length || of === 0) return <p className="text-[13px] mut">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.label}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="truncate ink-2">{i.label}</span>
            <span className="shrink-0 tabular-nums ink">
              {i.n} <span className="fnt">· {pct(i.n, of)}%</span>
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[rgba(20,40,80,0.07)]">
            <div className="h-full rounded-full bg-[var(--v2-blue)]" style={{ width: `${pct(i.n, of)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

const STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: "Active", cls: "bg-[rgba(63,191,152,0.14)] text-[#17795a]" },
  at_risk: { label: "At risk", cls: "bg-[rgba(255,170,60,0.16)] text-[#9a5a00]" },
  never: { label: "Not activated", cls: "bg-[rgba(20,40,80,0.07)] text-[#5b6678]" },
};

export function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.never;
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${s.cls}`}>● {s.label}</span>;
}

export function AdminNav({ current, demo }: { current: "overview" | "users"; demo: boolean }) {
  const tab = (href: string, key: string, label: string) => (
    <Link href={href} aria-current={current === key ? "page" : undefined} className={`rounded-full px-3.5 py-1.5 text-[13.5px] font-semibold ${current === key ? "bg-[#0b1220] text-[#fff]" : "ink-2 hover:bg-[rgba(255,255,255,0.7)]"}`}>
      {label}
    </Link>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tab("/admin", "overview", "Overview")}
      {tab("/admin/users", "users", "Users")}
      {demo && <span className="rounded-full bg-[rgba(255,170,60,0.18)] px-2.5 py-1 text-[11.5px] font-semibold text-[#9a5a00]">Demo data</span>}
    </div>
  );
}
