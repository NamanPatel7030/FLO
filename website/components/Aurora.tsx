"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * Living aurora backdrop: slow-drifting gradient blobs + fine noise, composited on GPU
 * (transform/opacity only). Falls back to a static wash under reduced motion.
 */
export function Aurora() {
  const reduce = useReducedMotion();
  const blobs = [
    { c: "rgb(26 155 224 / 0.22)", size: 820, top: "-30%", left: "-8%", dur: 26, dx: 120, dy: 60 },
    { c: "rgb(102 206 255 / 0.14)", size: 680, top: "-10%", left: "62%", dur: 30, dx: -110, dy: 90 },
    { c: "rgb(13 90 133 / 0.32)", size: 900, top: "60%", left: "20%", dur: 34, dx: 100, dy: -80 },
  ];
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#05070a]">
      {/* base vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(900px 520px at 50% -12%, rgb(26 155 224 / 0.16), transparent 65%), radial-gradient(900px 800px at 50% 120%, rgb(8 58 87 / 0.3), transparent 60%)",
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
            filter: "blur(90px)",
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
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#05070a]/80 to-transparent" />
    </div>
  );
}
