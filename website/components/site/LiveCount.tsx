"use client";

import { useEffect, useState } from "react";
import { animate, useReducedMotion } from "motion/react";

type Stats = { signedUp: number; usingFlo: number; activeWeek: number; joinedToday: number; since: string };

/** Counts up to `to` once it's known. */
function Num({ to }: { to: number }) {
  const reduce = useReducedMotion();
  const [v, setV] = useState(0);
  useEffect(() => {
    if (reduce) return setV(to);
    const c = animate(0, to, { duration: 1.2, ease: [0.22, 1, 0.36, 1], onUpdate: (x) => setV(Math.round(x)) });
    return () => c.stop();
  }, [to, reduce]);
  return <span className="tabular-nums">{v.toLocaleString("en-IN")}</span>;
}

/**
 * Real, live counts from the database (no padding, no fake numbers): confirmed sign-ups, accounts
 * whose Mac app has signed in, and those active in the last 7 days. Refreshes every minute.
 */
export function LiveCount({ compact = false }: { compact?: boolean }) {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/stats")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => alive && j && typeof j.signedUp === "number" && setS(j))
        .catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  if (!s) return null;
  const since = new Date(s.since).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const items = [
    { n: s.signedUp, label: s.signedUp === 1 ? "person signed up" : "people signed up" },
    { n: s.usingFlo, label: "using Flo on their Mac" },
    { n: s.activeWeek, label: "active this week" },
  ];
  if (compact)
    return (
      <span className="tag" data-testid="live-count">
        <span className="relative flex h-2 w-2">
          <span className="absolute inset-0 animate-ping rounded-full bg-[#3fbf98] opacity-60 motion-reduce:animate-none" />
          <span className="relative h-2 w-2 rounded-full bg-[#3fbf98]" />
        </span>
        <b className="ink"><Num to={s.signedUp} /></b> signed up · <b className="ink"><Num to={s.usingFlo} /></b> using Flo
      </span>
    );
  return (
    <div className="g mx-auto mt-10 grid max-w-3xl grid-cols-3 divide-x divide-[rgba(20,30,60,0.08)] overflow-hidden rounded-[26px]" data-testid="live-count">
      {items.map((it) => (
        <div key={it.label} className="px-3 py-5 text-center">
          <p className="text-[clamp(28px,4vw,40px)] font-semibold leading-none tracking-[-0.03em] ink"><Num to={it.n} /></p>
          <p className="mt-2 text-[12.5px] mut">{it.label}</p>
        </div>
      ))}
      <p className="col-span-3 flex items-center justify-center gap-2 border-t border-[rgba(20,30,60,0.06)] px-4 py-2.5 text-[11.5px] fnt">
        <span className="h-1.5 w-1.5 rounded-full bg-[#3fbf98] shadow-[0_0_8px_#3fbf98]" /> Live from our database since {since}
        {s.joinedToday > 0 && <span className="ink">· {s.joinedToday} joined today</span>}
      </p>
    </div>
  );
}
