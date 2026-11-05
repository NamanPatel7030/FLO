// Ambient gradient-mesh background for the onboarding canvas. GPU-only (transform/opacity on a
// few big blurred blobs), paused + static under prefers-reduced-motion.
import { motion, useReducedMotion } from "motion/react";

const BLOBS = [
  { c: "#1a9be0", x: "12%", y: "18%", s: 560, d: 26 },
  { c: "#3dbbff", x: "78%", y: "28%", s: 620, d: 32 },
  { c: "#0a4f7a", x: "58%", y: "82%", s: 680, d: 38 },
  { c: "#66ceff", x: "28%", y: "70%", s: 440, d: 30 },
];

export function Aurora() {
  const reduce = useReducedMotion();
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-0" style={{ background: "radial-gradient(1200px 700px at 50% -10%, rgba(61,187,255,0.10), transparent 60%), #05070c" }} />
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
            background: `radial-gradient(circle, ${b.c}55, transparent 70%)`,
            filter: "blur(60px)",
            willChange: "transform",
          }}
          animate={reduce ? undefined : { x: [0, 40, -30, 0], y: [0, -30, 20, 0], scale: [1, 1.08, 0.96, 1] }}
          transition={reduce ? undefined : { duration: b.d, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
      {/* fine grain + vignette */}
      <div className="absolute inset-0" style={{ background: "radial-gradient(120% 100% at 50% 50%, transparent 55%, rgba(0,0,0,0.6) 100%)" }} />
    </div>
  );
}

/** One-shot burst of light particles (success feedback). */
export function Burst({ n = 16 }: { n?: number }) {
  return (
    <span className="pointer-events-none absolute left-1/2 top-1/2 z-10" aria-hidden>
      {Array.from({ length: n }, (_, k) => {
        const ang = (k / n) * Math.PI * 2 + (k % 2) * 0.3;
        const dist = 60 + (k % 4) * 22;
        return (
          <motion.span
            key={k}
            className="absolute rounded-full"
            style={{ width: k % 3 ? 5 : 7, height: k % 3 ? 5 : 7, background: k % 3 ? "#66ceff" : "#e3f6ff", boxShadow: "0 0 10px rgba(102,206,255,0.8)" }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, opacity: 0, scale: 0.3 }}
            transition={{ duration: 1, ease: "easeOut" }}
          />
        );
      })}
    </span>
  );
}
