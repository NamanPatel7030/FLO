"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";

export const EASE = [0.22, 1, 0.36, 1] as const;

/** Fades and lifts its children in once, the first time they scroll into view. */
export function Reveal({ children, delay = 0, y = 24, className = "" }: { children: React.ReactNode; delay?: number; y?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.8, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** Section heading: a small tag, a big title (with a serif italic accent), and a lead line. */
export function Heading({
  tag,
  title,
  accent,
  lead,
  align = "center",
  className = "",
}: {
  tag: string;
  title: string;
  accent?: string;
  lead?: string;
  align?: "center" | "left";
  className?: string;
}) {
  const parts = accent && title.includes(accent) ? title.split(accent) : [title];
  return (
    <Reveal className={`${align === "center" ? "mx-auto text-center" : ""} max-w-3xl ${className}`}>
      <span className="tag">
        <span className="tag-dot" />
        {tag}
      </span>
      <h2 className="v2-h2 mt-5">
        {parts[0]}
        {parts.length > 1 && (
          <>
            <span className="serif-i grad-text">{accent}</span>
            {parts[1]}
          </>
        )}
      </h2>
      {lead && <p className={`v2-lead mt-5 ${align === "center" ? "mx-auto" : ""} max-w-2xl`}>{lead}</p>}
    </Reveal>
  );
}

/** A full-width section with consistent rhythm. */
export function Section({ id, children, className = "" }: { id?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={`relative scroll-mt-24 px-4 py-24 sm:px-6 md:py-32 ${className}`}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

/** Steps through `n` states every `ms` while on screen; holds still under reduced motion. */
export function useLoop(n: number, ms: number, still = n - 1) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-60px" });
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce) {
      setI(still);
      return;
    }
    if (!inView) return;
    const id = setInterval(() => setI((v) => (v + 1) % n), ms);
    return () => clearInterval(id);
  }, [inView, reduce, n, ms, still]);
  return { ref, i, inView, reduce: !!reduce };
}

/** Types `text` out once `on` is true. Returns the visible slice. */
export function useTyped(text: string, on: boolean, speed = 22) {
  const reduce = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) {
      setN(0);
      return;
    }
    if (reduce) {
      setN(text.length);
      return;
    }
    setN(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, on, speed, reduce]);
  return text.slice(0, n);
}

export function Wave({ on = true, color = "#fff", bars = 7, className = "" }: { on?: boolean; color?: string; bars?: number; className?: string }) {
  return (
    <span className={`vwave ${className}`} data-on={on || undefined} style={{ ["--wc" as string]: color }} aria-hidden>
      {Array.from({ length: bars }, (_, k) => (
        <i key={k} style={{ animationDelay: `${-k * 0.12}s` }} />
      ))}
    </span>
  );
}

/** A small macOS-style window frame in glass. */
export function GlassWindow({ title, children, className = "", right }: { title?: string; children: React.ReactNode; className?: string; right?: React.ReactNode }) {
  return (
    <div className={`g overflow-hidden rounded-[26px] ${className}`}>
      <div className="flex items-center gap-2 border-b border-[rgba(255,255,255,0.7)] px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-[#ff6b6b]/80" />
        <span className="h-3 w-3 rounded-full bg-[#ffc94d]/80" />
        <span className="h-3 w-3 rounded-full bg-[#4fd27a]/80" />
        {title && <span className="ml-2 text-[12.5px] font-semibold text-[var(--v2-ink-2)]">{title}</span>}
        <span className="ml-auto">{right}</span>
      </div>
      {children}
    </div>
  );
}

export function ClaudeMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {Array.from({ length: 8 }).map((_, i) => (
        <rect key={i} x="11" y="2" width="2.2" height="9" rx="1.1" fill="#d97757" transform={`rotate(${i * 45} 12 12)`} />
      ))}
    </svg>
  );
}
