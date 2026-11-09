"use client";

import { AnimatePresence, motion } from "motion/react";
import { BellRing, Check, ListTodo, Lock } from "lucide-react";
import { EASE, Wave, useLoop, useTyped } from "./ui";

const LINES = [
  { said: "Remind me to send Priya the deck by five", app: "Reminders", out: "Send Priya the deck · today 17:00" },
  { said: "कल सुबह दस बजे तक डेमो भेज दूँगा", app: "WhatsApp", out: "Hindi detected · written in Devanagari" },
  { said: "Draft a thank-you note to the Acme team", app: "Mail", out: "Draft typed into Mail · 84 words" },
];

/** The right-hand stage on the auth pages: frosted pastel glass with a live notch. */
export function AuthShowcase({ title, sub }: { title: string; sub: string }) {
  // each line: listen (typing) → result card
  const { ref, i } = useLoop(LINES.length * 2, 2600, 1);
  const line = LINES[Math.floor(i / 2)];
  const listening = i % 2 === 0;
  const said = useTyped(line.said, listening, 40);
  return (
    <div ref={ref} className="g relative flex h-full flex-col overflow-hidden rounded-[40px]">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_20%_10%,rgba(169,220,255,0.9),transparent_70%),radial-gradient(60%_50%_at_90%_30%,rgba(216,204,255,0.9),transparent_70%),radial-gradient(60%_60%_at_50%_100%,rgba(255,214,196,0.8),transparent_70%)]" />
      <div className="dotgrid absolute inset-0 -z-10 opacity-60" />

      <div className="flex justify-center">
        <motion.div
          className="hw-notch flex items-center gap-3 overflow-hidden rounded-b-[24px] px-5"
          animate={{ width: listening ? 440 : 300, height: listening ? 66 : 44 }}
          transition={{ duration: 0.5, ease: EASE }}
        >
          <AnimatePresence mode="wait">
            {listening ? (
              <motion.div key="l" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex w-full items-center gap-3 pt-2">
                <Wave color="#8fd0ff" bars={6} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-white/85">{said || "Listening…"}</span>
              </motion.div>
            ) : (
              <motion.div key="d" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex w-full items-center justify-center gap-2 text-[12.5px] font-semibold text-white/85">
                <span className="grid h-4 w-4 place-items-center rounded-full bg-[#5fd3b0] text-[#05221a]">
                  <Check size={10} strokeWidth={3.5} />
                </span>
                Done in {line.app}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      <div className="relative flex flex-1 items-center justify-center px-10">
        <div className="relative w-full max-w-md">
          <motion.div className="g-2 float-y rounded-[26px] p-5" key={line.out} initial={{ opacity: 0, y: 16 }} animate={{ opacity: listening ? 0.5 : 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
            <p className="text-[11.5px] font-semibold uppercase tracking-wider text-[#7a6cff]">{line.app}</p>
            <p className="mt-2 text-[17px] font-medium leading-snug ink">{listening ? "…" : line.out}</p>
          </motion.div>
          <div className="g-2 float-y absolute -left-10 -top-24 w-52 rounded-2xl p-3.5" style={{ animationDelay: "-2s" }}>
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#2f8cff]">
              <ListTodo size={13} /> To-do caught
            </p>
            <p className="mt-1.5 text-[13px] font-medium ink">Reply to Jon about the logo</p>
          </div>
          <div className="g-2 float-y absolute -bottom-24 -right-8 w-52 rounded-2xl p-3.5" style={{ animationDelay: "-4s" }}>
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#d14d84]">
              <BellRing size={13} /> In 5 minutes
            </p>
            <p className="mt-1.5 text-[13px] font-medium ink">Standup with the design team</p>
          </div>
        </div>
      </div>

      <div className="px-10 pb-10">
        <p className="text-[clamp(28px,2.6vw,40px)] font-semibold leading-[1.05] tracking-[-0.04em] ink">
          {title.split(".")[0]}.
          {title.split(".").slice(1).join(".").trim() && <span className="serif-i grad-text pl-2">{title.split(".").slice(1).join(".").trim()}</span>}
        </p>
        <p className="mt-3 max-w-md text-[15px] mut">{sub}</p>
        <p className="mt-5 flex items-center gap-2 text-[12.5px] font-medium fnt">
          <Lock size={13} /> Your words stay on your Mac. The account only signs you in.
        </p>
      </div>
    </div>
  );
}
