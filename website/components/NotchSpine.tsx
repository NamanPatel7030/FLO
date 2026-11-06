"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Mic, Radio, Sparkles, Terminal } from "lucide-react";
import { onScene, type Scene } from "./scene";

/**
 * The ownable element: a real black notch pinned to the top-center of the viewport that stays for
 * the whole page and PERFORMS the product live. Docked sections drive which scene it shows.
 * Pure transform/opacity; a single always-on waveform; retreats to a slim pill on mobile.
 */
const SIZES: Record<Scene, { w: number; h: number }> = {
  idle: { w: 200, h: 34 },
  dictation: { w: 420, h: 62 },
  assistant: { w: 460, h: 112 },
  meeting: { w: 440, h: 92 },
  agent: { w: 430, h: 96 },
  todos: { w: 440, h: 92 },
};

function Wave({ n = 18, active = true }: { n?: number; active?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex items-center gap-[3px]" aria-hidden>
      {Array.from({ length: n }).map((_, i) => (
        <motion.span
          key={i}
          className="w-[2.5px] rounded-full"
          style={{ background: "linear-gradient(180deg,#e3f6ff,#66ceff 55%,#1a9be0)" }}
          animate={reduce || !active ? { height: 6 } : { height: [5, 7 + ((i * 5) % 16), 5] }}
          transition={{ duration: 0.9 + (i % 5) * 0.12, repeat: Infinity, ease: "easeInOut", delay: i * 0.04 }}
        />
      ))}
    </div>
  );
}

function Typewriter({ text, className }: { text: string; className?: string }) {
  const [n, setN] = useState(0);
  const reduce = useReducedMotion();
  useEffect(() => {
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
    }, 38);
    return () => clearInterval(id);
  }, [text, reduce]);
  return (
    <span className={className}>
      {text.slice(0, n)}
      <span className="ml-[1px] inline-block h-[1em] w-[2px] -translate-y-[1px] bg-brand-300 align-middle" style={{ animation: "flo-caret 1s steps(1) infinite" }} />
    </span>
  );
}

export function NotchSpine() {
  const [scene, setScene] = useState<Scene>("idle");
  const [live, setLive] = useState<string | undefined>();

  useEffect(() => onScene((s, l) => {
    setScene(s);
    setLive(l);
  }), []);

  const size = SIZES[scene];

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-40 hidden justify-center sm:flex" aria-hidden>
      <motion.div
        className="relative overflow-hidden rounded-b-[20px] bg-black text-white"
        style={{ boxShadow: "0 18px 50px -20px rgb(0 0 0 / 0.9), inset 0 -1px 0 rgb(102 206 255 / 0.25)" }}
        animate={{ width: size.w, height: size.h }}
        transition={{ type: "spring", stiffness: 260, damping: 30 }}
      >
        {/* bottom accent line */}
        <div className="absolute inset-x-6 bottom-0 h-px bg-gradient-to-r from-transparent via-brand-400/70 to-transparent" />
        <AnimatePresence mode="wait">
          <motion.div
            key={scene}
            className="flex h-full w-full items-center gap-3 px-5"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
          >
            {scene === "idle" && (
              <div className="flex w-full items-center justify-center gap-2 text-[12px] text-white/60">
                <Sparkles size={13} className="text-brand-300" /> Flo
              </div>
            )}
            {scene === "dictation" && (
              <>
                <Mic size={16} className="shrink-0 text-brand-200" />
                <Typewriter text={live ?? "Ship the new onboarding before Friday."} className="truncate text-[13px] text-white/90" />
                <div className="ml-auto shrink-0">
                  <Wave n={10} />
                </div>
              </>
            )}
            {scene === "assistant" && (
              <div className="flex w-full flex-col justify-center gap-1.5">
                <div className="flex items-center gap-2 text-[11px] text-white/45">
                  <Sparkles size={12} className="text-brand-300" /> what&apos;s this chart telling me?
                </div>
                <p className="text-[12.5px] leading-snug text-white/90">Revenue is up 23% MoM, driven by the EU launch. Churn is flat.</p>
              </div>
            )}
            {scene === "meeting" && (
              <div className="flex w-full flex-col justify-center gap-1.5">
                <div className="flex items-center gap-2 text-[11px] text-white/55">
                  <span className="h-2 w-2 rounded-full bg-red-500" style={{ animation: "flo-glow 1.4s ease-in-out infinite" }} /> Recording · 12:04
                </div>
                <Typewriter text="…so Priya owns the deck, due Thursday." className="text-[12.5px] text-white/85" />
              </div>
            )}
            {scene === "agent" && (
              <div className="flex w-full items-center gap-2.5">
                <Radio size={15} className="shrink-0 text-brand-200" />
                <div className="flex items-center -space-x-1.5">
                  {["#d97757", "#ffffff", "#66ceff"].map((c, i) => (
                    <span key={i} className="flex h-6 w-6 items-center justify-center rounded-full bg-[#15181d] ring-2 ring-black" style={{ color: c }}>
                      <Terminal size={11} />
                    </span>
                  ))}
                </div>
                <span className="text-[12px] text-white/80">Claude Code finished · review</span>
                <span className="ml-auto h-2 w-2 rounded-full bg-amber-400" style={{ animation: "flo-glow 1.4s ease-in-out infinite" }} />
              </div>
            )}
            {scene === "todos" && (
              <div className="flex w-full flex-col justify-center gap-1.5">
                <div className="flex items-center gap-2 text-[12px] text-white/90">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-300 text-black">
                    <Check size={11} strokeWidth={3} />
                  </span>
                  Reply to Rahul about the invoice
                </div>
                <div className="flex items-center gap-2 text-[12px] text-white/45">
                  <span className="h-4 w-4 rounded-full border border-white/25" /> Send the Q3 deck
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
