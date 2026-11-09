"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Mascot, type Mood } from "./Mascot";
import { EASE, Heading, Reveal, Section, useLoop } from "./ui";

const MOODS: { mood: Mood; name: string; when: string }[] = [
  { mood: "happy", name: "Happy", when: "Ready when you are." },
  { mood: "listen", name: "Listening", when: "You're holding the key and talking." },
  { mood: "think", name: "Thinking", when: "Drafting your reply." },
  { mood: "celebrate", name: "Celebrating", when: "You hit today's 2,000 words." },
  { mood: "fire", name: "On fire", when: "Day 7 of your streak." },
  { mood: "love", name: "In love", when: "You said thank you." },
  { mood: "cool", name: "Cool", when: "10,000 words this week." },
  { mood: "sleepy", name: "Sleepy", when: "It's past midnight." },
  { mood: "sad", name: "Missing you", when: "Three days without a word." },
  { mood: "excited", name: "Excited", when: "You're back!" },
];

/** Meet Notchling: the mascot cycles through its moods; tap any to see it. */
export function MeetNotchling() {
  const { ref, i } = useLoop(MOODS.length, 2600, 0);
  const [pick, setPick] = useState<number | null>(null);
  const on = pick ?? i;
  const m = MOODS[on];
  return (
    <Section id="notchling">
      <div ref={ref} className="g relative overflow-hidden rounded-[40px] p-6 sm:p-10 md:p-14">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_70%_at_25%_30%,rgba(169,220,255,0.7),transparent_70%),radial-gradient(50%_60%_at_85%_80%,rgba(255,194,214,0.7),transparent_70%)]" />
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
          <div className="flex flex-col items-center">
            <AnimatePresence mode="wait">
              <motion.div key={m.mood} initial={{ opacity: 0, y: -24, scale: 0.92 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.96 }} transition={{ duration: 0.45, ease: EASE }} className="drop-shadow-[0_30px_40px_rgba(80,60,170,0.35)]">
                <Mascot mood={m.mood} size={260} />
              </motion.div>
            </AnimatePresence>
            <div className="hw-notch mt-6 rounded-full px-4 py-2 text-[14px]" aria-live="polite">
              <b>{m.name}.</b> <span className="text-[rgba(255,255,255,0.7)]">{m.when}</span>
            </div>
          </div>
          <div>
            <Heading
              align="left"
              tag="Meet Notchling"
              title="Your notch has feelings."
              accent="feelings."
              lead="Flo's mascot is the notch itself. It listens while you talk, thinks while it drafts, throws confetti when you hit your goal, and quietly misses you if you've been away. Make it yours: eyes, mouth, glow and accessories."
            />
            <Reveal delay={0.1} className="mt-8 grid grid-cols-5 gap-2">
              {MOODS.map((x, k) => (
                <button key={x.mood} type="button" onClick={() => setPick(k)} aria-pressed={k === on} aria-label={x.name} className={`g-2 grid place-items-center rounded-2xl p-1.5 transition hover:-translate-y-0.5 ${k === on ? "ring-2 ring-[#0b1220]" : ""}`}>
                  <Mascot mood={x.mood} size={52} title={x.name} />
                </button>
              ))}
            </Reveal>
          </div>
        </div>
      </div>
    </Section>
  );
}
