"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, Hash, Mic } from "lucide-react";

const SENTENCE = "Hey team, I pushed the new onboarding flow. Can you review it before Friday?";
type Phase = "idle" | "listening" | "transcribing" | "done" | "typed";

/** Sine ribbon drawn as an SVG path; amplitude follows a fake "voice" envelope. */
function Ribbon({ active, calm }: { active: boolean; calm: boolean }) {
  const path = useRef<SVGPathElement>(null);
  const glow = useRef<SVGPathElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const t0 = performance.now();
    const W = 120;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 33) return; // ≤30 fps
      last = now;
      const t = (now - t0) / 1000;
      const voice = active ? 0.35 + 0.65 * Math.abs(Math.sin(t * 2.3) * Math.cos(t * 0.9)) : 0;
      const amp = calm ? 0.6 : 1 + voice * 6.5;
      let d = "";
      for (let x = 0; x <= W; x += 3) {
        const env = Math.sin((Math.PI * x) / W);
        const y = 9 + env * amp * (Math.sin(x * 0.11 + t * 5.2) * 0.7 + Math.sin(x * 0.23 - t * 3.1) * 0.3);
        d += `${x === 0 ? "M" : "L"}${x},${y.toFixed(2)} `;
      }
      path.current?.setAttribute("d", d);
      glow.current?.setAttribute("d", d);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [active, calm]);
  return (
    <svg viewBox="0 0 120 18" className="h-[18px] w-[120px]" aria-hidden>
      <defs>
        <linearGradient id="rb" x1="0" x2="1">
          <stop offset="0" stopColor="#66ceff" stopOpacity="0" />
          <stop offset="0.3" stopColor="#93ddff" />
          <stop offset="0.7" stopColor="#e3f6ff" />
          <stop offset="1" stopColor="#66ceff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path ref={glow} fill="none" stroke="#66ceff" strokeOpacity="0.25" strokeWidth="5" strokeLinecap="round" />
      <path ref={path} fill="none" stroke="url(#rb)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function NotchDemo() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>(reduce ? "typed" : "idle");
  const [typed, setTyped] = useState(reduce ? SENTENCE.length : 0);

  useEffect(() => {
    if (reduce) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, f: () => void) => timers.push(setTimeout(() => !cancelled && f(), ms));
    const cycle = () => {
      setTyped(0);
      setPhase("idle");
      at(900, () => setPhase("listening"));
      at(4300, () => setPhase("transcribing"));
      at(5300, () => setPhase("done"));
      at(5500, () => {
        setPhase("typed");
        let i = 0;
        const tick = () => {
          if (cancelled) return;
          i = Math.min(SENTENCE.length, i + 3);
          setTyped(i);
          if (i < SENTENCE.length) timers.push(setTimeout(tick, 16));
        };
        tick();
      });
      at(10500, cycle);
    };
    cycle();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [reduce]);

  const live = phase === "listening" || phase === "transcribing" || phase === "done";
  const notchW = 168;
  const wing = 56;

  return (
    <div className="relative mx-auto w-full max-w-[720px]" aria-label="Flo dictation demo" role="img">
      {/* screen */}
      <div className="glass-strong relative overflow-hidden rounded-[28px] p-0">
        {/* menu bar */}
        <div className="relative flex h-9 items-center justify-between border-b border-white/5 bg-black/40 px-4 text-[11px] text-white/60">
          <span className="font-semibold text-white/80">Slack</span>
          <span className="hidden sm:inline">Thu 9:41</span>
          {/* notch + island */}
          <div className="absolute left-1/2 top-0 -translate-x-1/2">
            <motion.div
              initial={false}
              animate={{ width: live ? notchW + wing * 2 : notchW, height: phase === "done" ? 30 : 30 }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
              className="relative flex h-[30px] items-center justify-between rounded-b-[14px] bg-black"
              style={{ boxShadow: live ? "inset 0 -1px 0 rgb(102 206 255 / 0.45)" : "none" }}
            >
              <div className="flex w-[56px] items-center justify-center">
                {live && (
                  <motion.span initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-brand-200">
                    {phase === "done" ? (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-300">
                        <Check size={10} strokeWidth={3.5} className="text-black" />
                      </span>
                    ) : (
                      <Mic size={13} />
                    )}
                  </motion.span>
                )}
              </div>
              <div className="flex w-[56px] items-center justify-center overflow-hidden">
                {(phase === "listening" || phase === "transcribing") && (
                  <div className="relative">
                    <Ribbon active={phase === "listening"} calm={phase === "transcribing"} />
                    {phase === "transcribing" && (
                      <span
                        className="absolute inset-y-0 w-6"
                        style={{
                          background: "linear-gradient(90deg, transparent, rgb(227 246 255 / 0.9), transparent)",
                          animation: "flo-sweep 0.9s linear infinite",
                          left: 0,
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        </div>
        {/* app body */}
        <div className="grid grid-cols-[120px_1fr] text-left sm:grid-cols-[170px_1fr]">
          <div className="hidden flex-col gap-1 border-r border-white/5 bg-white/[0.02] p-3 text-[12px] text-white/50 sm:flex">
            <span className="mb-1 text-white/70">Channels</span>
            {["general", "launch", "design"].map((c) => (
              <span key={c} className={`flex items-center gap-1 rounded-md px-2 py-1 ${c === "launch" ? "bg-brand-400/10 text-brand-100" : ""}`}>
                <Hash size={11} />
                {c}
              </span>
            ))}
          </div>
          <div className="col-span-2 flex min-h-[230px] flex-col justify-end gap-3 p-4 sm:col-span-1">
            <div className="flex gap-2.5">
              <span className="h-7 w-7 shrink-0 rounded-lg bg-gradient-to-br from-amber-300 to-rose-400" />
              <div>
                <p className="text-[12px] text-white/50">
                  <span className="font-semibold text-white/80">Priya</span> 9:38
                </p>
                <p className="text-[13px] text-white/80">Is the onboarding ready to look at?</p>
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[13px]">
              <p className="min-h-[38px] text-white/90">
                {typed > 0 ? SENTENCE.slice(0, typed) : <span className="text-white/30">Message #launch</span>}
                {phase !== "typed" || typed < SENTENCE.length ? (
                  <span className="ml-px inline-block h-[14px] w-[1.5px] translate-y-[2px] bg-brand-300" style={{ animation: "flo-caret 1s steps(1) infinite" }} />
                ) : null}
              </p>
            </div>
          </div>
        </div>
      </div>
      {/* key hint */}
      <div className="mt-4 flex items-center justify-center gap-2 text-[13px] text-muted">
        <kbd className={`rounded-lg border px-2 py-1 font-mono text-[12px] transition ${phase === "listening" ? "border-brand-300/60 bg-brand-300/15 text-brand-100" : "border-white/15 bg-white/5"}`}>⌃ control</kbd>
        <span>hold, speak, release. It types where your cursor is.</span>
      </div>
    </div>
  );
}
