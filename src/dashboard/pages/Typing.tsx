// Typing speed test page — chrome (duration, sound, New passage) around the reusable TypingTest.
import { useState } from "react";
import { motion } from "motion/react";
import clsx from "clsx";
import { RotateCw, Volume2, VolumeX } from "lucide-react";
import { setSoundOn, soundOn } from "../../lib/keySounds";
import { TypingTest } from "../TypingTest";
import { PageHeader } from "../ui";

const DURATIONS = [1, 3, 5] as const;

export default function Typing() {
  const [minutes, setMinutes] = useState<(typeof DURATIONS)[number]>(5);
  const [sound, setSound] = useState(soundOn);
  const [nonce, setNonce] = useState(0); // remount TypingTest for New passage / duration change

  return (
    <div className="mx-auto max-w-[920px]">
      <PageHeader
        title="Typing test"
        subtitle="Measure your real typing speed. Flo uses it to show how much time speaking saves you."
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => setNonce((n) => n + 1)} className="btn-glass flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium" title="New passage" aria-label="New passage">
              <RotateCw size={14} /> New passage
            </button>
            <button
              onClick={() => {
                setSoundOn(!sound);
                setSound(!sound);
              }}
              className="btn-glass flex h-9 w-9 items-center justify-center rounded-xl"
              title={sound ? "Mute key sounds" : "Unmute key sounds"}
              aria-label={sound ? "Mute key sounds" : "Unmute key sounds"}
            >
              {sound ? <Volume2 size={15} /> : <VolumeX size={15} />}
            </button>
            <div className="glass inline-flex rounded-xl p-1">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => {
                    setMinutes(d);
                    setNonce((n) => n + 1);
                  }}
                  className={clsx("relative h-8 rounded-lg px-3 text-[13px] font-medium transition", minutes === d ? "text-[var(--fg)]" : "text-muted hover:text-[var(--fg)]")}
                  aria-pressed={minutes === d}
                >
                  {minutes === d && <motion.span layoutId="typing-dur" className="absolute inset-0 rounded-lg glass-strong" />}
                  <span className="relative">{d} min</span>
                </button>
              ))}
            </div>
          </div>
        }
      />
      <TypingTest key={`${minutes}-${nonce}`} minutes={minutes} />
    </div>
  );
}
