"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Mic, RotateCcw, Sparkles } from "lucide-react";
import { LANGS } from "./data";
import { EASE, Heading, Reveal, Section, Wave, useLoop } from "./ui";

/* ── 01 Dictation: a big stat on the left, a press-and-hold demo on the right ───────────── */

const RAW = ["so", "um", "the", "launch", "is", "moving", "to", "thursday", "uh", "can", "everyone", "update", "their", "tasks", "by", "wednesday"];
const CLEAN = "The launch is moving to Thursday. Can everyone update their tasks by Wednesday?";

function HoldDemo() {
  const [held, setHeld] = useState(false);
  const [words, setWords] = useState(0);
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const start = () => {
    if (held) return;
    setHeld(true);
    setDone(false);
    setWords(0);
    clearInterval(timer.current);
    timer.current = setInterval(() => setWords((w) => Math.min(RAW.length, w + 1)), 170);
  };
  const stop = () => {
    if (!held) return;
    setHeld(false);
    clearInterval(timer.current);
    setDone(true);
  };
  useEffect(() => () => clearInterval(timer.current), []);
  // keyboard: hold Space or Enter on the button
  const onKey = (e: React.KeyboardEvent, down: boolean) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (down && !e.repeat) start();
    if (!down) stop();
  };
  return (
    <div className="g rounded-[32px] p-5 sm:p-7" data-testid="hold-demo">
      <div className="g-2 rounded-2xl p-4">
        <p className="text-[11.5px] font-semibold uppercase tracking-wider fnt">New message · Mail</p>
        <p className="mt-2 text-[13px] mut">
          To: <span className="ink-2">team@acme.co</span>
        </p>
        <div className="mt-3 min-h-[84px] text-[16px] leading-relaxed ink" aria-live="polite">
          {done ? (
            <motion.span initial={{ opacity: 0, filter: "blur(4px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} transition={{ duration: 0.4 }}>
              {CLEAN}
            </motion.span>
          ) : held ? (
            <span className="mut">
              {RAW.slice(0, words).join(" ")}
              <span className="caret-v2" />
            </span>
          ) : (
            <span className="fnt">Press and hold the button, then let go.</span>
          )}
        </div>
      </div>
      <div className="mt-6 flex items-center gap-5">
        <button
          type="button"
          onPointerDown={start}
          onPointerUp={stop}
          onPointerLeave={stop}
          onKeyDown={(e) => onKey(e, true)}
          onKeyUp={(e) => onKey(e, false)}
          aria-pressed={held}
          className="relative grid h-20 w-20 shrink-0 select-none place-items-center rounded-full text-[#fff] transition-transform active:scale-95"
          style={{ background: held ? "linear-gradient(135deg,#2f8cff,#7a6cff)" : "linear-gradient(180deg,#1f2940,#0b1220)", boxShadow: held ? "0 0 0 10px rgb(122 108 255 / 0.15), 0 16px 40px -12px rgb(80 90 255 / 0.7)" : "0 14px 30px -12px rgb(11 18 32 / 0.6)" }}
          data-testid="hold-button"
        >
          {held ? <Wave bars={5} /> : <Mic size={26} />}
          <span className="sr-only">Hold to dictate</span>
        </button>
        <div>
          <p className="text-[15px] font-semibold ink">{held ? "Listening… let go to type it" : done ? "Cleaned up and typed" : "Hold to talk"}</p>
          <p className="mt-0.5 text-[13.5px] mut">
            {done ? (
              <span className="inline-flex items-center gap-1.5">
                <Check size={14} className="text-[#3fbf98]" /> Fillers removed, punctuation added
              </span>
            ) : (
              <>
                On your Mac: hold <span className="kbd">control</span> anywhere
              </>
            )}
          </p>
        </div>
        {done && (
          <button type="button" onClick={() => setDone(false)} className="ml-auto grid h-10 w-10 place-items-center rounded-full bg-[rgba(255,255,255,0.7)] mut hover:text-[var(--v2-ink)]" aria-label="Reset demo">
            <RotateCcw size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

export function Dictation() {
  return (
    <Section id="dictation">
      <div className="grid items-center gap-14 lg:grid-cols-[1fr_1.05fr]">
        <div>
          <Heading
            align="left"
            tag="01 · Dictation"
            title="Hold Control. Talk. It's typed."
            accent="It's typed."
            lead="Hold Control anywhere and speak. Let go, and clean, punctuated text lands right where your cursor is: Slack, Mail, VS Code or any text box."
          />
          <Reveal delay={0.1} className="mt-10 flex items-end gap-5">
            <span className="serif-i grad-text text-[112px] leading-[0.8] sm:text-[140px]">4×</span>
            <p className="max-w-[16rem] pb-2 text-[15px] leading-snug ink-2">
              You speak three to four times faster than you type. A reply that took a minute now takes fifteen seconds.
            </p>
          </Reveal>
          <Reveal delay={0.15}>
            <ul className="mt-8 grid gap-3 sm:grid-cols-3">
              {[
                ["Private", "Whisper runs on your Mac. Your audio never leaves it."],
                ["0.2 s", "Text appears about 0.2 s after you let go."],
                ["Unlimited", "No word caps and no usage meter."],
              ].map(([k, v]) => (
                <li key={k} className="g-2 rounded-2xl p-4">
                  <p className="text-[15px] font-semibold ink">{k}</p>
                  <p className="mt-1 text-[13px] leading-snug mut">{v}</p>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
        <Reveal delay={0.1}>
          <HoldDemo />
        </Reveal>
      </div>
    </Section>
  );
}

/* ── 02 Languages: three tall cards, the active one opens wide ───────────────────────── */

const TINT = ["from-[#ffe1d0] to-[#ffc6dc]", "from-[#d9f4ea] to-[#c8e6ff]", "from-[#dfe6ff] to-[#e8dcff]"];

export function LanguagesSection() {
  const { ref, i } = useLoop(3, 3600, 0);
  const [pick, setPick] = useState<number | null>(null);
  const on = pick ?? i;
  return (
    <Section id="languages">
      <Heading
        tag="02 · Hindi, Gujarati & English"
        title="Speak the language you think in."
        accent="you think in."
        lead="Tell Flo which languages you speak. Each time you talk it picks the right one by itself and writes it in the proper script. Hindi is never mistaken for Urdu."
      />
      <div ref={ref} className="mt-14 flex flex-col gap-3 md:h-[380px] md:flex-row">
        {LANGS.map((l, k) => {
          const open = k === on;
          return (
            <motion.button
              key={l.code}
              type="button"
              layout
              onClick={() => setPick(k)}
              aria-pressed={open}
              transition={{ layout: { duration: 0.6, ease: EASE } }}
              className={`g relative overflow-hidden rounded-[30px] p-6 text-left md:p-8 ${open ? "md:flex-[2.4]" : "md:flex-1"}`}
            >
              <div className={`absolute inset-0 -z-10 bg-gradient-to-br opacity-70 ${TINT[k]}`} />
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold uppercase tracking-wider ink-2">{l.en}</span>
                  {open && (
                    <span className="flex items-center gap-1.5 rounded-full bg-[rgba(255,255,255,0.75)] px-2.5 py-1 text-[11.5px] font-semibold ink-2">
                      <Sparkles size={12} className="text-[#7a6cff]" /> Auto-detected
                    </span>
                  )}
                </div>
                <span className="serif mt-4 block text-[96px] leading-none ink md:mt-auto md:text-[140px]">{l.glyph}</span>
                <AnimatePresence mode="wait">
                  {open && (
                    <motion.p
                      key={l.code}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.5, delay: 0.2, ease: EASE }}
                      className="mt-4 text-[20px] font-medium leading-snug ink md:text-[24px]"
                      lang={l.code}
                    >
                      “{l.text}”
                    </motion.p>
                  )}
                </AnimatePresence>
                <span className="mt-3 text-[14px] font-semibold mut">{l.name}</span>
              </div>
            </motion.button>
          );
        })}
      </div>
      <Reveal className="mt-6 flex flex-wrap justify-center gap-2">
        {["Native script, not romanised guesses", "Same on-device speed as English", "Hinglish, Spanish, German and French too"].map((t) => (
          <span key={t} className="chip2 cursor-default">
            <Check size={14} className="text-[#3fbf98]" /> {t}
          </span>
        ))}
      </Reveal>
    </Section>
  );
}

/* ── 06 Learns words: one wide banner, a word corrects itself ────────────────────────── */

export function LearnsWords() {
  const { ref, i } = useLoop(3, 2400, 2);
  return (
    <Section id="learns" className="!py-16">
      <div ref={ref} className="g relative overflow-hidden rounded-[36px] px-6 py-12 text-center sm:px-12 md:py-16">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_80%_at_50%_0%,rgba(194,214,255,0.6),transparent_70%)]" />
        <span className="tag">
          <span className="tag-dot" />
          06 · Learns your words
        </span>
        <p className="mx-auto mt-8 max-w-4xl text-[clamp(28px,4.4vw,56px)] font-semibold leading-[1.1] tracking-[-0.04em] ink">
          “Ship the build with{" "}
          <span className="relative inline-block">
            <span className={`transition-all duration-500 ${i >= 1 ? "text-[#c0c7d4] line-through decoration-[#ff7eb0] decoration-[3px]" : ""}`}>Tory</span>
            <AnimatePresence>
              {i >= 1 && (
                <motion.span
                  initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5, ease: EASE }}
                  className="serif-i grad-text ml-3 text-[1.15em]"
                >
                  Tauri
                </motion.span>
              )}
            </AnimatePresence>
          </span>{" "}
          tonight.”
        </p>
        <div className="mt-8 flex justify-center">
          <AnimatePresence>
            {i >= 1 && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, ease: EASE }}
                className="hw-notch flex items-center gap-3 rounded-full py-2 pl-2 pr-4 text-[13.5px]"
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-[#5fd3b0] text-[#05221a]">
                  <Check size={14} strokeWidth={3} />
                </span>
                Sorry, my mistake. Updating <b>Tory</b> to <b>Tauri</b>.
                <span className="rounded-full bg-[rgba(255,255,255,0.15)] px-2.5 py-0.5 text-[12px] font-semibold">Undo</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <p className="v2-lead mx-auto mt-8 max-w-2xl">
          Fix a word once and Flo notices. Names, product terms and jargon stop being a fight. Your dictionary stays on your Mac.
        </p>
      </div>
    </Section>
  );
}
