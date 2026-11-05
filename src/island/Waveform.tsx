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
        : "linear-gradient(180deg,#c4b5fd,#22d3ee)";

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

/** Small orbiting-dots loader used while transcribing / thinking. */
export function Orbit({ size = 16 }: { size?: number }) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: "conic-gradient(from 0deg, transparent 0deg, #a78bfa 120deg, #22d3ee 240deg, transparent 360deg)",
          mask: `radial-gradient(circle, transparent ${size / 2 - 2.5}px, black ${size / 2 - 2}px)`,
          WebkitMask: `radial-gradient(circle, transparent ${size / 2 - 2.5}px, black ${size / 2 - 2}px)`,
          animation: "spin 0.9s linear infinite",
        }}
      />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
