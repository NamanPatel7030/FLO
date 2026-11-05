import { useEffect, useState } from "react";
import clsx from "clsx";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CheckCircle2, Clock, Flame, Gauge, Mic, Type } from "lucide-react";
import { api } from "../../lib/api";
import { formatDuration, formatNumber } from "../../lib/format";
import type { Analytics as A } from "../../lib/types";
import { Card, CardTitle, PageHeader, Skeleton, Stat } from "../ui";

const RANGES = [7, 30, 60] as const;
const S1 = "var(--s1)";
const S2 = "var(--s2)";
const S4 = "var(--s4)";
const axis = { fill: "var(--chart-axis)", fontSize: 11 };

export default function Analytics() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [a, setA] = useState<A | null>(null);
  useEffect(() => {
    setA(null);
    api.getAnalytics(days).then(setA);
  }, [days]);

  const daily = a?.daily.map((d) => ({ ...d, label: new Date(d.day + "T00:00").toLocaleDateString([], { month: "short", day: "numeric" }) })) ?? [];
  const hourly = a?.hourly.map((w, h) => ({ h, label: h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`, words: w })) ?? [];

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="How much faster you're working — computed locally from your history."
        actions={
          <div className="glass flex rounded-xl p-1">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setDays(r)}
                className={clsx("h-7 rounded-lg px-3 text-[12.5px] font-medium transition", days === r ? "glass-strong text-[var(--fg)]" : "text-muted hover:text-[var(--fg)]")}
              >
                {r}d
              </button>
            ))}
          </div>
        }
      />
      {!a ? (
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
          <Skeleton className="col-span-3 h-72" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-6 gap-3">
            <Stat label="Words" value={formatNumber(a.totalWords)} icon={<Type size={13} />} tint="#93ddff" />
            <Stat label="Avg speed" value={`${a.avgWpm}`} sub="words / min" icon={<Gauge size={13} />} tint="#66ceff" />
            <Stat label="Time saved" value={formatDuration(a.minutesSaved * 60)} icon={<Clock size={13} />} tint="#34d399" />
            <Stat label="Streak" value={`${a.streakDays}d`} icon={<Flame size={13} />} tint="#f59e0b" />
            <Stat label="Meetings" value={formatDuration(a.meetingMinutes * 60)} icon={<Mic size={13} />} tint="#f472b6" />
            <Stat label="To-dos done" value={formatNumber(a.todosDone)} icon={<CheckCircle2 size={13} />} tint="#93ddff" />
          </div>

          <Card className="p-5">
            <CardTitle>Words dictated per day</CardTitle>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gw" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3dbbff" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#3dbbff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={28} />
                  <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={formatNumber} width={48} />
                  <Tooltip content={<Tip unit="words" />} cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }} />
                  <Area type="monotone" dataKey="words" stroke={S1} strokeWidth={2} fill="url(#gw)" activeDot={{ r: 4.5, stroke: "var(--bg)", strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-4">
            <Card className="p-5">
              <CardTitle>When you talk (words by hour)</CardTitle>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourly} margin={{ top: 6, right: 6, left: -12, bottom: 0 }} barCategoryGap={2}>
                    <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                    <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval={2} />
                    <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={formatNumber} width={48} />
                    <Tooltip content={<Tip unit="words" />} cursor={{ fill: "var(--glass)" }} />
                    <Bar dataKey="words" fill={S1} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="p-5">
              <CardTitle>Top apps</CardTitle>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={a.topApps} layout="vertical" margin={{ top: 0, right: 40, left: 8, bottom: 0 }} barCategoryGap={6}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="app" tick={{ ...axis, fill: "var(--fg-muted)", fontSize: 12 }} tickLine={false} axisLine={false} width={74} />
                    <Tooltip content={<Tip unit="words" />} cursor={{ fill: "var(--glass)" }} />
                    <Bar dataKey="words" fill={S2} radius={[0, 4, 4, 0]} label={{ position: "right", fill: "var(--fg-muted)", fontSize: 11, formatter: (v: unknown) => formatNumber(Number(v)) }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card className="p-5">
            <CardTitle>To-dos completed per day</CardTitle>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={daily} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={28} />
                  <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} width={48} />
                  <Tooltip content={<Tip unit="done" dataKey="todosDone" />} cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }} />
                  <Line type="monotone" dataKey="todosDone" stroke={S4} strokeWidth={2} dot={false} activeDot={{ r: 4.5, stroke: "var(--bg)", strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function Tip({ active, payload, label, unit, dataKey }: { active?: boolean; payload?: any[]; label?: string | number; unit: string; dataKey?: string }) {
  if (!active || !payload?.length) return null;
  const p = dataKey ? payload.find((x) => x.dataKey === dataKey) ?? payload[0] : payload[0];
  return (
    <div className="glass-strong rounded-xl px-3 py-2 text-[12px] shadow-xl" style={{ background: "color-mix(in srgb, var(--bg) 85%, transparent)" }}>
      <div className="text-faint">{label ?? p.payload?.app}</div>
      <div className="mt-0.5 font-semibold tabular-nums">
        {Number(p.value).toLocaleString()} <span className="font-normal text-muted">{unit}</span>
      </div>
    </div>
  );
}
