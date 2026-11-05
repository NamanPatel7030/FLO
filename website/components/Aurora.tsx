"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * Living aurora backdrop: slow-drifting gradient blobs + fine noise, composited on GPU
 * (transform/opacity only). Falls back to a static wash under reduced motion.
 */
export function Aurora() {
  const reduce = useReducedMotion();
  const blobs = [
    { c: "rgb(26 155 224 / 0.26)", size: 760, top: "-14%", left: "6%", dur: 20, dx: 90, dy: 50 },
    { c: "rgb(102 206 255 / 0.18)", size: 620, top: "8%", left: "64%", dur: 26, dx: -80, dy: 70 },
    { c: "rgb(13 90 133 / 0.30)", size: 820, top: "58%", left: "30%", dur: 32, dx: 70, dy: -60 },
    { c: "rgb(147 221 255 / 0.12)", size: 500, top: "70%", left: "76%", dur: 24, dx: -60, dy: -40 },
  ];
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-black">
      {/* base vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(1200px 700px at 50% -20%, rgb(26 155 224 / 0.12), transparent 65%), radial-gradient(900px 800px at 50% 120%, rgb(8 58 87 / 0.30), transparent 60%)",
        }}
      />
      {blobs.map((b, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            top: b.top,
            left: b.left,
            width: b.size,
            height: b.size,
            background: `radial-gradient(circle, ${b.c}, transparent 70%)`,
            filter: "blur(10px)",
            willChange: "transform",
          }}
          animate={reduce ? undefined : { x: [0, b.dx, 0], y: [0, b.dy, 0], scale: [1, 1.08, 1] }}
          transition={{ duration: b.dur, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
      {/* grain */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
      />
      {/* top fade so the nav floats */}
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/80 to-transparent" />
    </div>
  );
}
