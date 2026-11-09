// Notchling in onboarding: the welcome "notch drop" and a guide with a speech bubble for every step.
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Notchling } from "../../lib/NotchlingFace";
import type { AvatarSettings, NotchlingMood } from "../../lib/notchling";

const EASE = [0.22, 1, 0.36, 1] as const;

/** The mascot with a short line in a speech bubble. The bubble re-pops whenever the line changes. */
export function Guide({ mood, line, avatar, accent, size = 64 }: { mood: NotchlingMood; line: string; avatar?: AvatarSettings; accent?: string; size?: number }) {
  return (
    <div className="mx-auto mb-6 flex w-fit max-w-full items-center gap-4" data-testid="onboard-guide" data-mood={mood}>
      <motion.div key={mood} initial={{ scale: 0.92 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 420, damping: 16 }}>
        <Notchling mood={mood} avatar={avatar} accent={accent} size={size} />
      </motion.div>
      <AnimatePresence mode="wait">
        <motion.div
          key={line}
          initial={{ opacity: 0, x: -6, scale: 0.96 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 4 }}
          transition={{ duration: 0.25, ease: EASE }}
          className="relative max-w-[440px] rounded-2xl rounded-bl-md border border-white/12 bg-white/[0.08] px-4 py-2.5 text-left text-[14.5px] leading-snug text-white/90 shadow-[0_10px_30px_-14px_rgba(0,0,0,0.6)] backdrop-blur-xl"
          data-testid="onboard-line"
        >
          <span aria-hidden className="absolute -left-[7px] bottom-2.5 h-3 w-3 rotate-45 border-b border-l border-white/12 bg-[#1b2236]" />
          {line}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

const hello = (h: number) => (h < 5 ? "Up late?" : h < 12 ? "Good morning!" : h < 17 ? "Good afternoon!" : h < 22 ? "Good evening!" : "Up late?");

/** Welcome: a sliver of MacBook screen edge; the notch drops in, blinks awake, gets excited, says hi. */
export function NotchDrop({ avatar, accent, name }: { avatar?: AvatarSettings; accent?: string; name?: string }) {
  const reduce = useReducedMotion();
  const [mood, setMood] = useState<NotchlingMood>(reduce ? "happy" : "sleepy");
  const [said, setSaid] = useState(!!reduce);
  useEffect(() => {
    if (reduce) return;
    const t = [setTimeout(() => setMood("surprised"), 900), setTimeout(() => setMood("excited"), 1500), setTimeout(() => setSaid(true), 1700), setTimeout(() => setMood("happy"), 3600)];
    return () => t.forEach(clearTimeout);
  }, [reduce]);
  const greet = `${hello(new Date().getHours())} I'm Flo${name ? `, nice to meet you ${name}` : ""}. I live right here, in your notch.`;
  return (
    <div className="relative mx-auto w-full max-w-[560px]" data-testid="notch-drop" data-mood={mood}>
      {/* the screen's top edge */}
      <div className="relative h-[190px] overflow-hidden rounded-t-[26px] border border-b-0 border-white/10 bg-gradient-to-b from-white/[0.06] to-transparent">
        <div className="absolute inset-x-0 top-0 h-[10px] bg-black/60" />
        <motion.div
          className="absolute left-1/2 top-0 -translate-x-1/2"
          initial={reduce ? false : { y: -170 }}
          animate={{ y: 0 }}
          transition={{ duration: 0.85, ease: EASE, delay: 0.15 }}
        >
          <div className="drop-shadow-[0_18px_40px_rgba(122,108,255,0.45)]">
            <Notchling variant="bare" mood={mood} avatar={avatar} accent={accent} size={150} testId="welcome-notchling" />
          </div>
        </motion.div>
      </div>
      <div className="flex h-[64px] items-start justify-center">
        <AnimatePresence>
          {said && (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="relative mt-2 rounded-2xl border border-white/12 bg-white/[0.08] px-4 py-2.5 text-[15px] text-white/90 backdrop-blur-xl"
              data-testid="welcome-line"
            >
              <span aria-hidden className="absolute -top-[7px] left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-l border-t border-white/12 bg-[#1b2236]" />
              {greet}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
