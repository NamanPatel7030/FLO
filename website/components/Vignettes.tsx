"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { Bot, Check, FileText, Hash, Mic, Sparkles, Terminal, MousePointer2 } from "lucide-react";

/** Shared frame: a solid dark panel (the FeatureRow wrapper is already glass) for real contrast. */
function Stage({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="relative aspect-[5/4] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#070b11] p-4 shadow-[inset_0_1px_0_rgb(255_255_255_/0.05)]">
      <div aria-hidden className="pointer-events-none absolute -top-16 left-1/2 h-32 w-2/3 -translate-x-1/2 rounded-full bg-brand-500/10 blur-3xl" />
      {label && <span className="absolute left-4 top-3 z-10 font-mono text-[10px] uppercase tracking-[0.14em] text-brand-300/70">{label}</span>}
      <div className="relative h-full">{children}</div>
    </div>
  );
}

function useRun(ref: React.RefObject<HTMLElement | null>) {
  const inView = useInView(ref, { margin: "-20%" });
  const reduce = useReducedMotion();
  return inView && !reduce;
}

function MiniWave({ run, n = 22, color = "#66ceff" }: { run: boolean; n?: number; color?: string }) {
  return (
    <div className="flex h-7 items-center justify-center gap-[3px]" aria-hidden>
      {Array.from({ length: n }).map((_, i) => {
        const center = 1 - Math.abs(i - n / 2) / (n / 2);
        return (
          <motion.span
            key={i}
            className="w-[3px] rounded-full"
            style={{ background: `linear-gradient(180deg,#e3f6ff,${color})` }}
            animate={run ? { height: [4, 6 + center * 22 * (0.5 + ((i * 7) % 10) / 10), 4] } : { height: 5 }}
            transition={{ duration: 0.7 + (i % 5) * 0.1, repeat: Infinity, ease: "easeInOut", delay: i * 0.03 }}
          />
        );
      })}
    </div>
  );
}

/** DICTATION: a live mic + waveform, words typing into a real-looking Slack composer. */
export function DictationVignette() {
  const ref = useRef<HTMLDivElement>(null);
  const run = useRun(ref);
  const full = "Shipping the new onboarding this Friday — I'll share a build tonight.";
  const [n, setN] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return setN(full.length);
    if (!run) return setN(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= full.length) clearInterval(id);
    }, 34);
    return () => clearInterval(id);
  }, [run, reduce]);
  const done = n >= full.length;
  return (
    <div ref={ref}>
      <Stage label="Dictation">
        <div className="flex h-full flex-col">
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <motion.span
              className="flex h-12 w-12 items-center justify-center rounded-full"
              style={{ background: "linear-gradient(135deg,#66ceff,#1a9be0)" }}
              animate={run && !done ? { boxShadow: ["0 0 0 0 rgb(102 206 255 / 0.5)", "0 0 0 14px rgb(102 206 255 / 0)"] } : {}}
              transition={{ duration: 1.4, repeat: Infinity }}
            >
              <Mic size={20} className="text-[#02202f]" />
            </motion.span>
            <MiniWave run={run && !done} />
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[10px] text-muted">hold ⌃ · speak · release</span>
          </div>
          {/* slack composer */}
          <div className="rounded-xl border border-white/10 bg-white/[0.05] p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-faint">
              <Hash size={11} /> launch
            </div>
            <p className="min-h-[34px] text-[13px] leading-snug text-ink">
              {full.slice(0, n)}
              {!done && <span className="ml-0.5 inline-block h-[14px] w-[2px] translate-y-[2px] bg-brand-300" style={{ animation: "flo-caret 1s step-end infinite" }} />}
            </p>
          </div>
        </div>
      </Stage>
    </div>
  );
}

/** ASSISTANT: a scanning light sweeps the window, then a grounded answer types in. */
export function AssistantVignette() {
  const ref = useRef<HTMLDivElement>(null);
  const run = useRun(ref);
  return (
    <div ref={ref}>
      <Stage label="Assistant">
        <div className="flex h-full flex-col gap-3">
          <div className="relative flex-1 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] text-faint">
              <Bot size={12} /> revenue.tsx
            </div>
            <div className="space-y-1.5">
              {[0.95, 0.75, 0.88, 0.6, 0.8].map((w, i) => (
                <div key={i} className="h-2 rounded-full bg-white/[0.08]" style={{ width: `${w * 100}%` }} />
              ))}
            </div>
            {run && (
              <motion.div
                className="absolute inset-y-0 w-28"
                style={{ background: "linear-gradient(90deg,transparent,rgb(102 206 255 / 0.28),transparent)" }}
                animate={{ x: ["-40%", "160%"] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
          </div>
          <div className="flex items-start gap-2 rounded-xl border border-brand-300/25 bg-brand-500/12 p-2.5">
            <Sparkles size={14} className="mt-0.5 shrink-0 text-brand-200" />
            <span className="text-[12.5px] leading-snug text-ink">Revenue is up 23% MoM, driven by the EU launch. Churn held flat at 2.1%.</span>
          </div>
        </div>
      </Stage>
    </div>
  );
}

/** AGENT TRAY: Claude / Codex / Cursor chips with live status dots. */
export function AgentVignette() {
  const ref = useRef<HTMLDivElement>(null);
  const run = useRun(ref);
  const agents = [
    { icon: Sparkles, name: "Claude Code", status: "Done · review", color: "#d97757", dot: "#34d399" },
    { icon: Terminal, name: "Codex", status: "Working…", color: "#cbd5e1", dot: "#66ceff" },
    { icon: MousePointer2, name: "Cursor", status: "Needs approval", color: "#a78bfa", dot: "#fbbf24" },
  ];
  return (
    <div ref={ref}>
      <Stage label="Agent tray">
        <div className="flex h-full flex-col justify-center gap-2.5">
          {agents.map((a, i) => (
            <motion.div
              key={a.name}
              className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5"
              initial={{ opacity: 0, x: -16 }}
              animate={run ? { opacity: 1, x: 0 } : { opacity: 0, x: -16 }}
              transition={{ delay: 0.15 + i * 0.16, duration: 0.5 }}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: `${a.color}26`, color: a.color }}>
                <a.icon size={14} />
              </span>
              <span className="flex-1 text-[13px] font-medium text-ink">{a.name}</span>
              <span className="text-[11.5px] text-muted">{a.status}</span>
              <motion.span
                className="h-2 w-2 rounded-full"
                style={{ background: a.dot }}
                animate={run ? { opacity: [1, 0.3, 1], scale: [1, 0.8, 1] } : {}}
                transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.3 }}
              />
            </motion.div>
          ))}
        </div>
      </Stage>
    </div>
  );
}

/** MEETING: speaker-labelled transcript streams; a real summary + action items assemble. */
export function MeetingVignette() {
  const ref = useRef<HTMLDivElement>(null);
  const run = useRun(ref);
  const lines = [
    { who: "Priya", c: "#f59e0b", t: "Let's ship Friday." },
    { who: "Arjun", c: "#66ceff", t: "I'll own the deck." },
    { who: "Mei", c: "#34d399", t: "QA needs one more day." },
  ];
  const [count, setCount] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return setCount(lines.length);
    if (!run) return setCount(0);
    let i = 0;
    const id = setInterval(() => {
      i = (i % lines.length) + 1;
      setCount(i);
    }, 1100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, reduce]);
  return (
    <div ref={ref}>
      <Stage label="Meeting notes">
        <div className="grid h-full grid-cols-5 gap-2.5">
          <div className="col-span-3 flex flex-col rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
            <div className="mb-2 flex items-center gap-1.5 text-[10.5px] text-muted">
              <span className="h-2 w-2 rounded-full bg-red-500" style={{ animation: "flo-glow 1.4s ease-in-out infinite" }} /> Recording · 12:04
            </div>
            <div className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {lines.slice(0, count).map((l) => (
                  <motion.div key={l.who} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-[#02202f]" style={{ background: l.c }}>
                      {l.who[0]}
                    </span>
                    <p className="text-[12px] leading-snug text-ink">
                      <span className="text-faint">{l.who}: </span>
                      {l.t}
                    </p>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
          <div className="col-span-2 flex flex-col gap-2 rounded-xl border border-brand-300/20 bg-brand-500/[0.08] p-2.5">
            <div className="flex items-center gap-1.5 text-[9.5px] uppercase tracking-wider text-brand-300">
              <FileText size={10} /> Summary
            </div>
            <p className="text-[11px] leading-snug text-muted">Launch set for Friday; QA needs a day.</p>
            <div className="mt-auto space-y-1">
              {["Arjun: own the deck", "Mei: extra QA day"].map((a) => (
                <div key={a} className="flex items-center gap-1.5 rounded-md bg-white/[0.05] px-1.5 py-1 text-[10.5px] text-ink">
                  <Check size={10} className="shrink-0 text-brand-300" /> {a}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Stage>
    </div>
  );
}

/** ATTENTION TO-DOS: a message arrives, a to-do flies into the list and checks off. */
export function TodoVignette() {
  const ref = useRef<HTMLDivElement>(null);
  const run = useRun(ref);
  return (
    <div ref={ref}>
      <Stage label="Attention to-dos">
        <div className="flex h-full flex-col gap-2">
          <motion.div
            className="flex items-center gap-2 self-start rounded-xl rounded-bl-sm border border-white/10 bg-white/[0.06] px-3 py-2"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={run ? { opacity: [0, 1, 1, 0], scale: [0.9, 1, 1, 0.98] } : { opacity: 0 }}
            transition={{ duration: 3, repeat: Infinity, times: [0, 0.15, 0.45, 0.55] }}
          >
            <span className="h-5 w-5 rounded-full bg-gradient-to-br from-amber-300 to-pink-400" />
            <span className="text-[12px] text-ink">“Can you send the invoice today?”</span>
          </motion.div>
          <div className="mt-auto space-y-2">
            <motion.div
              className="flex items-center gap-2 rounded-xl border border-brand-300/25 bg-brand-500/[0.1] px-3 py-2.5"
              initial={{ opacity: 0, y: 16 }}
              animate={run ? { opacity: [0, 0, 1, 1], y: [16, 16, 0, 0] } : { opacity: 0 }}
              transition={{ duration: 3, repeat: Infinity, times: [0, 0.45, 0.6, 1] }}
            >
              <motion.span
                className="flex h-5 w-5 items-center justify-center rounded-md border border-brand-300/50"
                animate={run ? { background: ["transparent", "transparent", "#66ceff"], borderColor: ["#93ddff66", "#93ddff66", "#66ceff"] } : {}}
                transition={{ duration: 3, repeat: Infinity, times: [0, 0.8, 0.92] }}
              >
                <Check size={12} className="text-[#02202f]" />
              </motion.span>
              <span className="text-[12.5px] text-ink">Send the invoice</span>
              <span className="ml-auto text-[10.5px] text-faint">Slack · today</span>
            </motion.div>
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 opacity-70">
              <span className="h-5 w-5 rounded-md border border-white/20" />
              <span className="text-[12.5px] text-muted">Reply to Priya about the deck</span>
              <span className="ml-auto text-[10.5px] text-faint">Gmail · 2h</span>
            </div>
          </div>
        </div>
      </Stage>
    </div>
  );
}

export const VIGNETTES: Record<string, () => React.JSX.Element> = {
  dictation: DictationVignette,
  assistant: AssistantVignette,
  agent: AgentVignette,
  meeting: MeetingVignette,
  todo: TodoVignette,
};
