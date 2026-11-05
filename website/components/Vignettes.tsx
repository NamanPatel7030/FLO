"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { Bot, Check, FileText, Hash, Mic, Sparkles, Terminal, MousePointer2 } from "lucide-react";

/** Shared frame for a vignette: glass panel, fixed aspect so layout never jumps. */
function Stage({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="glass relative aspect-[4/3] w-full overflow-hidden rounded-2xl p-4">
      {label && <span className="absolute left-4 top-3 font-mono text-[10px] uppercase tracking-wider text-faint">{label}</span>}
      {children}
    </div>
  );
}

function useRun(ref: React.RefObject<HTMLElement | null>) {
  const inView = useInView(ref, { margin: "-20%" });
  const reduce = useReducedMotion();
  return inView && !reduce;
}

/** DICTATION: a mic pulse → a wave → words type into a field. */
export function DictationVignette() {
  const ref = useRef<HTMLDivElement>(null);
  const run = useRun(ref);
  const full = "Ship the new onboarding before Friday.";
  const [n, setN] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) {
      setN(full.length);
      return;
    }
    if (!run) {
      setN(0);
      return;
    }
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= full.length) clearInterval(id);
    }, 42);
    return () => clearInterval(id);
  }, [run, reduce]);
  return (
    <div ref={ref}>
      <Stage label="Dictation">
        <div className="absolute left-1/2 top-9 -translate-x-1/2">
          <motion.span
            className="flex h-11 w-11 items-center justify-center rounded-full"
            style={{ background: "linear-gradient(135deg,#66ceff,#1a9be0)" }}
            animate={run ? { scale: [1, 1.12, 1], boxShadow: ["0 0 0 0 rgb(102 206 255 / 0.5)", "0 0 0 16px rgb(102 206 255 / 0)", "0 0 0 0 rgb(102 206 255 / 0)"] } : {}}
            transition={{ duration: 1.6, repeat: Infinity }}
          >
            <Mic size={18} className="text-[#02202f]" />
          </motion.span>
        </div>
        <div className="absolute inset-x-4 bottom-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] text-faint">
            <Hash size={10} /> launch
          </div>
          <p className="text-[13px] leading-snug text-ink">
            {full.slice(0, n)}
            <span className="ml-0.5 inline-block h-[14px] w-[2px] translate-y-[2px] bg-brand-300" style={{ animation: "flo-caret 1s step-end infinite" }} />
          </p>
        </div>
      </Stage>
    </div>
  );
}

/** ASSISTANT: a scanning light sweeps the screenshot, then an answer types in. */
export function AssistantVignette() {
  const ref = useRef<HTMLDivElement>(null);
  const run = useRun(ref);
  return (
    <div ref={ref}>
      <Stage label="Assistant">
        <div className="absolute inset-4 top-9 overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
          {/* fake window content */}
          <div className="space-y-1.5 p-3">
            {[0.9, 0.7, 0.8, 0.5].map((w, i) => (
              <div key={i} className="h-1.5 rounded-full bg-white/10" style={{ width: `${w * 100}%` }} />
            ))}
          </div>
          {/* scan sweep */}
          {run && (
            <motion.div
              className="absolute inset-y-0 w-24"
              style={{ background: "linear-gradient(90deg,transparent,rgb(102 206 255 / 0.22),transparent)" }}
              animate={{ x: ["-30%", "130%"] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
          {/* answer bubble */}
          <motion.div
            className="absolute inset-x-3 bottom-3 flex items-start gap-2 rounded-lg border border-brand-300/20 bg-brand-500/10 p-2"
            initial={{ opacity: 0, y: 10 }}
            animate={run ? { opacity: [0, 0, 1], y: [10, 10, 0] } : { opacity: 0 }}
            transition={{ duration: 2.6, repeat: Infinity, times: [0, 0.55, 0.75] }}
          >
            <Sparkles size={13} className="mt-0.5 shrink-0 text-brand-200" />
            <span className="text-[12px] leading-snug text-ink">That error is a missing await on line 42. Add it and the test passes.</span>
          </motion.div>
        </div>
      </Stage>
    </div>
  );
}

/** AGENT TRAY: Claude / Codex / Cursor chips stack in with pulsing status dots. */
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
        <div className="absolute inset-x-4 bottom-4 top-9 flex flex-col justify-center gap-2">
          {agents.map((a, i) => (
            <motion.div
              key={a.name}
              className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
              initial={{ opacity: 0, x: -16 }}
              animate={run ? { opacity: 1, x: 0 } : { opacity: 0, x: -16 }}
              transition={{ delay: 0.2 + i * 0.18, duration: 0.5 }}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: `${a.color}22`, color: a.color }}>
                <a.icon size={13} />
              </span>
              <span className="flex-1 text-[12.5px] text-ink">{a.name}</span>
              <span className="text-[11px] text-faint">{a.status}</span>
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

/** MEETING: transcript lines stream in; a summary assembles on the side. */
export function MeetingVignette() {
  const ref = useRef<HTMLDivElement>(null);
  const run = useRun(ref);
  const lines = ["We ship Friday.", "Priya owns the deck.", "QA needs one more day."];
  const [count, setCount] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) {
      setCount(lines.length);
      return;
    }
    if (!run) {
      setCount(0);
      return;
    }
    let i = 0;
    const id = setInterval(() => {
      i = (i % lines.length) + 1;
      setCount(i);
    }, 900);
    return () => clearInterval(id);
  }, [run, reduce, lines.length]);
  return (
    <div ref={ref}>
      <Stage label="Meeting notes">
        <div className="absolute inset-x-4 bottom-4 top-9 grid grid-cols-5 gap-2">
          <div className="col-span-3 space-y-1.5 overflow-hidden">
            <div className="flex items-center gap-1.5 text-[10px] text-faint">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> live
            </div>
            <AnimatePresence initial={false}>
              {lines.slice(0, count).map((l) => (
                <motion.p key={l} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-[11.5px] leading-snug text-muted">
                  {l}
                </motion.p>
              ))}
            </AnimatePresence>
          </div>
          <div className="col-span-2 rounded-lg border border-brand-300/15 bg-brand-500/[0.06] p-2">
            <div className="mb-1 flex items-center gap-1 text-[9px] uppercase tracking-wider text-brand-300">
              <FileText size={9} /> Summary
            </div>
            <motion.div animate={run ? { opacity: [0.4, 1, 0.4] } : {}} transition={{ duration: 2, repeat: Infinity }} className="space-y-1">
              <div className="h-1 w-full rounded bg-brand-300/25" />
              <div className="h-1 w-4/5 rounded bg-brand-300/25" />
              <div className="h-1 w-3/5 rounded bg-brand-300/25" />
            </motion.div>
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
        <div className="absolute inset-x-4 bottom-4 top-9 flex flex-col gap-2">
          <motion.div
            className="flex items-center gap-2 self-start rounded-xl rounded-bl-sm border border-white/10 bg-white/[0.04] px-3 py-1.5"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={run ? { opacity: [0, 1, 1, 0], scale: [0.9, 1, 1, 0.98] } : { opacity: 0 }}
            transition={{ duration: 3, repeat: Infinity, times: [0, 0.15, 0.45, 0.55] }}
          >
            <span className="h-5 w-5 rounded-full bg-gradient-to-br from-amber-300 to-pink-400" />
            <span className="text-[11.5px] text-ink">“Can you send the invoice today?”</span>
          </motion.div>
          <motion.div
            className="mt-auto flex items-center gap-2 rounded-xl border border-brand-300/20 bg-brand-500/[0.08] px-3 py-2"
            initial={{ opacity: 0, y: 16 }}
            animate={run ? { opacity: [0, 0, 1, 1], y: [16, 16, 0, 0] } : { opacity: 0 }}
            transition={{ duration: 3, repeat: Infinity, times: [0, 0.45, 0.6, 1] }}
          >
            <motion.span
              className="flex h-5 w-5 items-center justify-center rounded-md border border-brand-300/40"
              animate={run ? { background: ["transparent", "transparent", "#66ceff"], borderColor: ["#93ddff66", "#93ddff66", "#66ceff"] } : {}}
              transition={{ duration: 3, repeat: Infinity, times: [0, 0.8, 0.92] }}
            >
              <Check size={12} className="text-[#02202f]" />
            </motion.span>
            <span className="text-[12px] text-ink">Send the invoice</span>
            <span className="ml-auto text-[10px] text-faint">from Slack · today</span>
          </motion.div>
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
