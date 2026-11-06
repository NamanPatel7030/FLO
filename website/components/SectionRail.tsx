"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { onScene, SCENES, type Scene } from "./scene";

/** Left-rail progress tied to the notch spine: the active scene lights up with a big numeral. */
export function SectionRail() {
  const [scene, setScene] = useState<Scene>("idle");
  useEffect(() => onScene((s) => setScene(s)), []);
  const items = SCENES.filter((s) => s.id !== "idle");
  const activeIndex = Math.max(0, items.findIndex((s) => s.id === scene));

  return (
    <div className="pointer-events-none fixed left-6 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-3 lg:flex" aria-hidden>
      {items.map((s, i) => {
        const active = s.id === scene;
        return (
          <div key={s.id} className="flex items-center gap-3">
            <span className="relative flex h-2 w-2 items-center justify-center">
              <span className={`h-2 w-2 rounded-full transition-colors duration-300 ${i <= activeIndex ? "bg-brand-400" : "bg-white/15"}`} />
              {active && <motion.span layoutId="rail-dot" className="absolute -inset-1.5 rounded-full ring-2 ring-brand-400/60" transition={{ type: "spring", stiffness: 400, damping: 30 }} />}
            </span>
            <motion.span
              className="font-mono text-[11px] uppercase tracking-[0.18em]"
              animate={{ opacity: active ? 1 : 0.3, color: active ? "#93ddff" : "#c2ecff" }}
            >
              {String(i + 1).padStart(2, "0")} · {s.label}
            </motion.span>
          </div>
        );
      })}
    </div>
  );
}
