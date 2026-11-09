"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, BellRing, Check, Cpu, Languages, ListTodo, ShieldCheck } from "lucide-react";
import { DownloadCTA } from "../DownloadCTA";
import { EASE, Wave, useLoop, useTyped } from "./ui";

const SAID = "Hey team, I pushed the new onboarding flow. Can you review it before Friday?";

/** The live notch: idle → listening (wave + live words) → typed. */
function HeroStage() {
  // 0 idle · 1 listening · 2 typed · 3 rest
  const { ref, i } = useLoop(4, 2600, 2);
  const listening = i === 1;
  const typed = useTyped(SAID, i >= 2, 18);
  const live = useTyped("hey team I pushed the new onboarding flow", listening, 55);
  return (
    <div ref={ref} className="relative mx-auto mt-16 w-full max-w-5xl md:mt-20">
      {/* floating cards */}
      <motion.div
        className="g-2 float-y absolute -left-4 top-24 text-left z-10 hidden w-56 rounded-2xl p-3.5 lg:block xl:-left-16"
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 1.2, duration: 0.8, ease: EASE }}
      >
        <div className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wider text-[#2f8cff]">
          <ListTodo size={13} /> To-do caught
        </div>
        <p className="mt-1.5 text-[13.5px] font-medium ink">Send Acme the homepage copy</p>
        <p className="mt-0.5 text-[11.5px] fnt">From Zoom · Acme weekly</p>
      </motion.div>
      <motion.div
        className="g-2 float-y absolute -right-4 top-40 text-left z-10 hidden w-52 rounded-2xl p-3.5 lg:block xl:-right-14"
        style={{ animationDelay: "-3s" }}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 1.5, duration: 0.8, ease: EASE }}
      >
        <div className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wider text-[#7a6cff]">
          <BellRing size={13} /> Reminder · 4:55
        </div>
        <p className="mt-1.5 text-[13.5px] font-medium ink">Review onboarding by Friday</p>
        <div className="mt-2 flex gap-1.5">
          <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold ink-2">Snooze</span>
          <span className="rounded-full bg-[#0b1220] px-2.5 py-1 text-[11px] font-semibold text-white">Done</span>
        </div>
      </motion.div>
      <motion.div
        className="g-2 float-y absolute -bottom-6 left-10 z-10 hidden rounded-2xl px-3.5 py-2.5 md:block"
        style={{ animationDelay: "-5s" }}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.8, duration: 0.8, ease: EASE }}
      >
        <span className="text-[13px] font-medium ink-2">
          <span className="serif-i text-[18px] ink">नमस्ते</span> · Hindi detected, written in Devanagari
        </span>
      </motion.div>

      {/* the "screen" */}
      <motion.div
        initial={{ opacity: 0, y: 40, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.5, duration: 1, ease: EASE }}
        className="g g-rim overflow-hidden rounded-[30px] p-2"
      >
        <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-b from-white/70 to-white/30">
          {/* menu bar + notch */}
          <div className="relative flex h-9 items-center justify-between px-4 text-[12px] font-semibold ink-2">
            <span className="flex items-center gap-4">
              <span className="text-[14px]"></span> Slack <span className="hidden font-medium mut sm:inline">File</span>
              <span className="hidden font-medium mut sm:inline">Edit</span>
            </span>
            <span className="mut">Thu 9:41</span>
            <div className="absolute left-1/2 top-0 -translate-x-1/2">
              <motion.div
                className="hw-notch flex items-center justify-center overflow-hidden rounded-b-[18px]"
                animate={{ width: listening ? 360 : i >= 2 ? 250 : 170, height: listening ? 54 : 34 }}
                transition={{ duration: 0.5, ease: EASE }}
              >
                <AnimatePresence mode="wait">
                  {listening && (
                    <motion.div key="l" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex w-full items-center gap-3 px-4 pt-2">
                      <Wave color="#8fd0ff" bars={6} />
                      <span className="min-w-0 flex-1 truncate text-left text-[12px] font-medium text-white/85">{live || "Listening…"}</span>
                      <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white/70">⌃ held</span>
                    </motion.div>
                  )}
                  {i >= 2 && (
                    <motion.div key="t" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 text-[11.5px] font-semibold text-white/85">
                      <span className="grid h-4 w-4 place-items-center rounded-full bg-[#5fd3b0] text-[#05221a]">
                        <Check size={10} strokeWidth={3.5} />
                      </span>
                      Typed in 0.2 s
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </div>
          </div>
          {/* app body */}
          <div className="grid min-h-[300px] grid-cols-[150px_1fr] gap-0 sm:min-h-[340px] sm:grid-cols-[190px_1fr]">
            <div className="border-r border-white/70 px-3 py-5 text-[13px]">
              <p className="px-2 text-[11px] font-semibold uppercase tracking-wider fnt">Channels</p>
              {["general", "launch", "design"].map((c) => (
                <p key={c} className={`mt-1 rounded-lg px-2 py-1.5 ${c === "launch" ? "bg-white/80 font-semibold ink shadow-sm" : "mut"}`}>
                  # {c}
                </p>
              ))}
            </div>
            <div className="flex flex-col justify-end gap-4 p-4 sm:p-6">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#ffb38a] to-[#ff7eb0] text-[13px] font-bold text-white">P</span>
                <div className="text-left">
                  <p className="text-[13px] font-semibold ink">
                    Priya <span className="font-normal fnt">9:38</span>
                  </p>
                  <p className="text-[14px] ink-2">Is the onboarding ready to look at?</p>
                </div>
              </div>
              <div className="g-2 min-h-[64px] rounded-2xl px-4 py-3 text-left text-[14.5px] ink">
                {typed ? (
                  <>
                    {typed}
                    {typed.length < SAID.length && <span className="caret-v2" />}
                  </>
                ) : (
                  <span className="fnt">
                    Message #launch
                    {listening && <span className="caret-v2" />}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative px-4 pb-20 pt-32 sm:px-6 md:pt-40" aria-labelledby="hero-title">
      <div className="mx-auto max-w-6xl text-center">
        <motion.span initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }} className="tag">
          <span className="tag-dot" />
          Flo for macOS · lives in your notch
        </motion.span>
        <motion.h1
          id="hero-title"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.1, ease: EASE }}
          className="mx-auto mt-7 max-w-5xl text-[clamp(48px,8.4vw,120px)] font-semibold leading-[0.92] tracking-[-0.055em] ink"
        >
          Your Mac, at the
          <br />
          <span className="serif-i grad-text pr-2 text-[1.1em] tracking-[-0.02em]">speed of speech.</span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.25, ease: EASE }}
          className="v2-lead mx-auto mt-7 max-w-xl"
        >
          Hold a key and talk. Flo types, drafts, remembers and reminds you, right from the notch you already have. It all runs on your Mac.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.35, ease: EASE }}
          className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <DownloadCTA size="lg" testId="hero-get-flo" />
          <a href="#dictation" className="btn btn-glass h-14 px-7 text-[15px] ink">
            See it work <ArrowDown size={16} />
          </a>
        </motion.div>
        <motion.ul
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.55 }}
          className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[13.5px] font-medium mut"
        >
          <li className="flex items-center gap-1.5">
            <Check size={15} className="text-[#2f8cff]" /> Free to download
          </li>
          <li className="flex items-center gap-1.5">
            <Cpu size={15} className="text-[#7a6cff]" /> On-device Whisper
          </li>
          <li className="flex items-center gap-1.5">
            <Languages size={15} className="text-[#ff7eb0]" /> English, हिन्दी, ગુજરાતી
          </li>
          <li className="flex items-center gap-1.5">
            <ShieldCheck size={15} className="text-[#3fbf98]" /> Your own key, or fully offline
          </li>
        </motion.ul>
        <HeroStage />
      </div>
    </section>
  );
}

const APPS = ["Slack", "Gmail", "VS Code", "Notion", "Linear", "Cursor", "Figma", "WhatsApp", "Mail", "Docs", "Zoom", "Upwork", "Terminal", "ChatGPT"];

/** "Works in every app": a slow marquee of glass chips. */
export function AppsMarquee() {
  return (
    <div className="px-4 pb-6">
      <p className="text-center text-[12.5px] font-semibold uppercase tracking-[0.2em] fnt">Wherever your cursor is</p>
      <div className="marquee-mask mx-auto mt-5 max-w-5xl overflow-hidden">
        <div className="marquee2 gap-3 pr-3">
          {[...APPS, ...APPS].map((a, k) => (
            <span key={k} className="g-2 shrink-0 rounded-full px-5 py-2.5 text-[14px] font-semibold ink-2" aria-hidden={k >= APPS.length || undefined}>
              {a}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
