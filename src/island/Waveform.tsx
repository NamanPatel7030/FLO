import { useEffect, useRef } from "react";
import { on } from "../lib/api";
import { smoothLevels } from "../lib/format";
import { EV, type LevelEvent } from "../lib/types";

/** Live mic waveform. Reads flo://level and animates bars via rAF (no React re-render per frame). */
export function Waveform({
  bars = 24,
  height = 22,
  barWidth = 3,
  gap = 2,
  color = "gradient",
}: {
  bars?: number;
  height?: number;
  barWidth?: number;
  gap?: number;
  color?: "gradient" | "red" | "white";
}) {
  const rms = useRef(0);
  const levels = useRef<number[]>(new Array(bars).fill(0));
  const els = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => on<LevelEvent>(EV.level, (e) => (rms.current = e.rms)), []);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      levels.current = smoothLevels(levels.current, reduce ? rms.current * 0.6 : rms.current, reduce ? 0 : t);
      levels.current.forEach((v, i) => {
        const el = els.current[i];
        if (el) el.style.transform = `scaleY(${Math.max(0.12, v)})`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const bg =
    color === "red"
      ? "linear-gradient(180deg,#fca5a5,#ef4444)"
      : color === "white"
        ? "rgba(255,255,255,0.9)"
        : "linear-gradient(180deg,#e3f6ff,#66ceff 55%,#1a9be0)";

  return (
    <div className="flex items-center" style={{ height, gap }} aria-hidden>
      {Array.from({ length: bars }, (_, i) => (
        <div
          key={i}
          ref={(el) => {
            els.current[i] = el;
          }}
          style={{
            width: barWidth,
            height,
            borderRadius: barWidth,
            background: bg,
            transform: "scaleY(0.12)",
            transformOrigin: "center",
            willChange: "transform",
          }}
        />
      ))}
    </div>
  );
}

/** Three breathing dots — compact "working" indicator for the right wing. */
export function Dots({ color = "#93ddff" }: { color?: string }) {
  return (
    <div className="flex items-center gap-[3px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="block h-[5px] w-[5px] rounded-full"
          style={{ background: color, animation: `flo-dot 1.1s ${i * 0.16}s ease-in-out infinite` }}
        />
      ))}
      <style>{`@keyframes flo-dot{0%,80%,100%{opacity:.25;transform:scale(.7)}40%{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
}

/** Small orbiting-dots loader used while transcribing / thinking. */
export function Orbit({ size = 16 }: { size?: number }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: "conic-gradient(from 0deg, transparent 0deg, #1a9be0 110deg, #93ddff 250deg, #ffffff 340deg, transparent 360deg)",
          mask: `radial-gradient(circle, transparent ${size / 2 - 2.5}px, black ${size / 2 - 2}px)`,
          WebkitMask: `radial-gradient(circle, transparent ${size / 2 - 2.5}px, black ${size / 2 - 2}px)`,
          animation: "spin 0.9s linear infinite",
        }}
      />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
