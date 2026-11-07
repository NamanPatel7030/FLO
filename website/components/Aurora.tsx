"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * The liquid-glass backdrop: a deep blue → near-black gradient with slow-drifting light pools in the
 * brand blues. The pools are radial gradients (already soft, so no `filter: blur`), moved with
 * transforms only. Static under reduced motion.
 */
export function Aurora() {
  const reduce = useReducedMotion();
  const pools = [
    { c: "rgb(61 187 255 / 0.30)", size: 900, top: "-28%", left: "-14%", dur: 28, dx: 140, dy: 70 },
    { c: "rgb(26 155 224 / 0.28)", size: 760, top: "4%", left: "58%", dur: 32, dx: -130, dy: 110 },
    { c: "rgb(11 58 92 / 0.85)", size: 1100, top: "48%", left: "-10%", dur: 36, dx: 120, dy: -90 },
    { c: "rgb(61 187 255 / 0.16)", size: 700, top: "70%", left: "62%", dur: 30, dx: -100, dy: -60 },
  ];
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" style={{ background: "linear-gradient(165deg, #0b3a5c 0%, #072238 30%, #05121f 62%, #05070a 100%)" }}>
      {pools.map((b, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            top: b.top,
            left: b.left,
            width: b.size,
            height: b.size,
            background: `radial-gradient(circle at 50% 50%, ${b.c}, transparent 68%)`,
            willChange: "transform",
          }}
          animate={reduce ? undefined : { x: [0, b.dx, 0], y: [0, b.dy, 0], scale: [1, 1.1, 1] }}
          transition={{ duration: b.dur, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
      {/* caustic sheen: a faint diagonal light band that slowly sweeps */}
      <motion.div
        className="absolute -inset-[20%]"
        style={{ background: "linear-gradient(115deg, transparent 38%, rgb(194 236 255 / 0.05) 48%, rgb(102 206 255 / 0.07) 50%, transparent 60%)", willChange: "transform" }}
        animate={reduce ? undefined : { x: ["-12%", "12%", "-12%"] }}
        transition={{ duration: 40, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* grain */}
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
      />
      {/* a darker band at the very top so the black notch reads as hardware */}
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#05070a]/70 to-transparent" />
    </div>
  );
}
