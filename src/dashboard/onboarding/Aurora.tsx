// Light pastel sky behind setup: a few big blurred blobs (blue, lilac, mint, peach) drifting
// slowly. GPU-only (transform on blurred layers); still under prefers-reduced-motion.
import { motion, useReducedMotion } from "motion/react";

const BLOBS = [
  { c: "#a9dcff", x: "8%", y: "6%", s: 620, d: 28 },
  { c: "#d8ccff", x: "92%", y: "10%", s: 640, d: 34 },
  { c: "#c4f0e2", x: "88%", y: "92%", s: 600, d: 31 },
  { c: "#ffd6c4", x: "18%", y: "96%", s: 580, d: 36 },
  { c: "#e4dcff", x: "50%", y: "55%", s: 460, d: 40 },
];

/** `hue` shifts the sky a little per chapter so the journey feels like it moves somewhere. */
export function Sky({ hue = 0 }: { hue?: number }) {
  const reduce = useReducedMotion();
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, #f8f9fd, #f2f4fb)" }} />
      <motion.div className="absolute inset-0" animate={{ filter: `hue-rotate(${hue}deg)` }} transition={{ duration: 1.6, ease: "easeInOut" }}>
        {BLOBS.map((b, i) => (
          <motion.div
            key={i}
            className="absolute rounded-full"
            style={{
              left: b.x,
              top: b.y,
              width: b.s,
              height: b.s,
              marginLeft: -b.s / 2,
              marginTop: -b.s / 2,
              background: `radial-gradient(circle, ${b.c} 0%, ${b.c}00 68%)`,
              opacity: 0.95,
              willChange: "transform",
            }}
            animate={reduce ? undefined : { x: [0, 50, -36, 0], y: [0, -34, 26, 0], scale: [1, 1.1, 0.95, 1] }}
            transition={reduce ? undefined : { duration: b.d, repeat: Infinity, ease: "easeInOut" }}
          />
        ))}
      </motion.div>
      {/* a soft white veil in the middle keeps text crisp */}
      <div className="absolute inset-0" style={{ background: "radial-gradient(60% 55% at 50% 48%, rgb(255 255 255 / 0.55), transparent 75%)" }} />
    </div>
  );
}

/** One-shot burst of pastel confetti dots (success feedback). */
export function Burst({ n = 18 }: { n?: number }) {
  const cols = ["#2f8cff", "#7a6cff", "#3fd0a4", "#ff9a7a", "#c264ff"];
  return (
    <span className="pointer-events-none absolute left-1/2 top-1/2 z-10" aria-hidden>
      {Array.from({ length: n }, (_, k) => {
        const ang = (k / n) * Math.PI * 2 + (k % 2) * 0.3;
        const dist = 70 + (k % 4) * 26;
        return (
          <motion.span
            key={k}
            className="absolute rounded-full"
            style={{ width: k % 3 ? 6 : 8, height: k % 3 ? 6 : 8, background: cols[k % cols.length] }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, opacity: 0, scale: 0.4 }}
            transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          />
        );
      })}
    </span>
  );
}
