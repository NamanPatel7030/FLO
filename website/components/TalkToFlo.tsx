"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Mic, Square } from "lucide-react";
import { useVoice } from "./useVoice";

const SCRIPT = "Hey Flo, turn these notes into a clear update for the team.";

/**
 * The wow: talk to Flo in the browser before downloading. Real transcription via the native
 * Web Speech API with a live mic waveform. Falls back to a scripted "Preview" when the API is
 * unsupported or permission is denied — the visitor always sees the magic.
 */
export function TalkToFlo() {
  const reduce = useReducedMotion();
  const [level, setLevel] = useState(0);
  const { status, transcript, start, stop } = useVoice(setLevel);
  const [preview, setPreview] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const live = status === "listening";
  const canSpeak = status !== "unsupported";

  const runPreview = () => {
    setPreviewing(true);
    setPreview("");
    let i = 0;
    previewTimer.current && clearInterval(previewTimer.current);
    previewTimer.current = setInterval(() => {
      i += 1;
      setPreview(SCRIPT.slice(0, i));
      if (i >= SCRIPT.length) {
        previewTimer.current && clearInterval(previewTimer.current);
        setTimeout(() => setPreviewing(false), 1400);
      }
    }, 34);
  };

  useEffect(() => () => void (previewTimer.current && clearInterval(previewTimer.current)), []);

  const toggle = async () => {
    if (!canSpeak) return runPreview();
    if (live) return stop();
    const ok = await start();
    if (!ok) runPreview(); // denied/error → still show it
  };

  const shown = live ? transcript : previewing ? preview : transcript || "";
  const label = live ? "Listening…" : status === "denied" ? "Mic blocked — showing a preview" : status === "unsupported" ? "Preview" : "Hold to talk, or just click";
  const bars = 28;

  return (
    <div className="glass-strong relative mx-auto w-full max-w-xl overflow-hidden rounded-[28px] p-6 sm:p-7">
      <div className="pointer-events-none absolute -top-20 left-1/2 h-40 w-2/3 -translate-x-1/2 rounded-full bg-brand-500/20 blur-3xl" />
      <div className="relative flex items-center justify-between">
        <span className="eyebrow">Try it now</span>
        <span className="text-[12px] text-faint">{canSpeak ? "Your voice never leaves this page" : "Live preview"}</span>
      </div>

      {/* live field */}
      <div className="relative mt-4 min-h-[88px] rounded-2xl border border-white/10 bg-black/40 p-4">
        {shown ? (
          <p className="text-[16px] leading-relaxed text-ink">
            {shown}
            {(live || previewing) && <span className="ml-0.5 inline-block h-[1.1em] w-[2px] -translate-y-[2px] bg-brand-300 align-middle" style={{ animation: "flo-caret 1s steps(1) infinite" }} />}
          </p>
        ) : (
          <p className="text-[16px] text-faint">{canSpeak ? "Press the mic and say anything. Flo types it here." : "Press play to see Flo in action."}</p>
        )}
      </div>

      {/* waveform */}
      <div className="mt-4 flex h-9 items-center justify-center gap-[3px]" aria-hidden>
        {Array.from({ length: bars }).map((_, i) => {
          const center = 1 - Math.abs(i - bars / 2) / (bars / 2);
          const h = live ? 4 + level * 30 * (0.4 + center) * (0.6 + ((i * 7) % 10) / 10) : 5;
          return (
            <motion.span
              key={i}
              className="w-[3px] rounded-full"
              style={{ background: "linear-gradient(180deg,#e3f6ff,#66ceff 55%,#1a9be0)" }}
              animate={reduce ? { height: 6 } : previewing ? { height: [5, 6 + ((i * 5) % 18), 5] } : { height: Math.max(4, h) }}
              transition={previewing ? { duration: 0.8, repeat: Infinity, ease: "easeInOut", delay: i * 0.03 } : { duration: 0.1 }}
            />
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-center gap-3">
        <button
          onClick={toggle}
          className={`btn ${live ? "btn-glass" : "btn-primary"} px-6 py-3 text-[15px]`}
          aria-pressed={live}
        >
          {live ? (
            <>
              <Square size={15} fill="currentColor" /> Stop
            </>
          ) : (
            <>
              <Mic size={16} /> {canSpeak ? "Talk to Flo" : "Play preview"}
            </>
          )}
        </button>
      </div>
      <p className="mt-3 text-center text-[12px] text-faint">{label}</p>
    </div>
  );
}
