// Notchling hangs from the top edge of the window like a real notch and guides every step.
// It stays mounted for the whole setup: it drops in and wakes up on the welcome step, then
// shrinks up into a small notch and changes mood with each step.
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Notchling } from "../../lib/NotchlingFace";
import type { AvatarSettings, NotchlingMood } from "../../lib/notchling";

const BASE = 124; // rendered height in px at full size
const SPRING = { type: "spring", stiffness: 210, damping: 26, mass: 0.9 } as const;

/** The welcome wake-up: sleepy, a start, excitement, then a happy hello. */
export function useWakeUp(active: boolean): NotchlingMood | null {
  const reduce = useReducedMotion();
  const [mood, setMood] = useState<NotchlingMood | null>(active && !reduce ? "sleepy" : null);
  useEffect(() => {
    if (!active || reduce) return;
    const t = [setTimeout(() => setMood("surprised"), 1000), setTimeout(() => setMood("excited"), 1600), setTimeout(() => setMood(null), 3400)];
    return () => t.forEach(clearTimeout);
    // only on first mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return mood;
}

export function HangingNotch({ mood, big, avatar, accent }: { mood: NotchlingMood; big: boolean; avatar?: AvatarSettings; accent?: string }) {
  const reduce = useReducedMotion();
  const scale = big ? 1 : 0.5;
  return (
    <motion.div
      className="relative z-20 mx-auto flex shrink-0 justify-center"
      initial={false}
      animate={{ height: BASE * scale + (big ? 10 : 6) }}
      transition={SPRING}
      data-testid="onboard-guide"
      data-mood={mood}
    >
      <motion.div
        style={{ transformOrigin: "50% 0%" }}
        initial={reduce ? false : { y: -BASE - 20 }}
        animate={{ y: 0, scale }}
        transition={{ y: { duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.2 }, scale: SPRING }}
      >
        <motion.div
          key={mood}
          initial={reduce ? false : { scale: 0.9, y: -2 }}
          animate={{ scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 15 }}
          style={{ transformOrigin: "50% 0%", filter: "drop-shadow(0 16px 26px rgb(80 70 170 / 0.28))" }}
        >
          <Notchling variant="bare" mood={mood} avatar={avatar} accent={accent} size={BASE} testId="welcome-notchling" />
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
