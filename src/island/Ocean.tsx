// Ocean wave: 3 layered sine waves (navy → teal-blue → light blue, with foam) drifting at different
// speeds for parallax. GPU-cheap: CSS transform drift only; when `react` is set, ONE rAF loop
// scales the wave amplitude from the mic level (flo://level). Reduced motion → static.
import { useEffect, useMemo, useRef } from "react";
import { on } from "../lib/api";
import { EV, type LevelEvent } from "../lib/types";

const LAYERS = [
  { color: "#062a44", opacity: 0.95, amp: 0.55, speed: 14, phase: 0 },
  { color: "#0e6aa0", opacity: 0.7, amp: 0.75, speed: 9, phase: 0.33 },
  { color: "#66ceff", opacity: 0.45, amp: 1, speed: 6, phase: 0.66 },
];

/** Seamless sine path spanning 2× width (so translating by -width loops perfectly). */
function wavePath(width: number, height: number, amp: number, phase: number, waves = 2): string {
  const w2 = width * 2;
  const mid = height * 0.45;
  const a = (height * 0.38) * amp;
  const steps = 48;
  let d = `M0 ${height} L0 ${mid}`;
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * w2;
    const y = mid - Math.sin((x / width) * Math.PI * 2 * waves + phase * Math.PI * 2) * a;
    d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d + ` L${w2} ${height} Z`;
}

export function Ocean({
  width,
  height = 14,
  react = false,
  calm = false,
  foam = true,
  className = "",
  style,
}: {
  width: number;
  height?: number;
  /** amplitude follows the mic level */
  react?: boolean;
  /** slow, gentle swell (working / thinking / backdrop) */
  calm?: boolean;
  foam?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const groups = useRef<(SVGGElement | null)[]>([]);
  const paths = useMemo(() => LAYERS.map((l) => wavePath(width, height, l.amp, l.phase)), [width, height]);

  useEffect(() => {
    if (!react) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    let level = 0;
    let smooth = 0.25;
    const off = on<LevelEvent>(EV.level, (e) => (level = e.rms));
    let raf = 0;
    const tick = () => {
      const target = 0.25 + Math.min(1, Math.sqrt(Math.max(0, level)) * 1.2) * 0.9;
      smooth += (target - smooth) * (target > smooth ? 0.35 : 0.08);
      groups.current.forEach((g, i) => g && (g.style.transform = `scaleY(${(smooth * (0.75 + i * 0.15)).toFixed(3)})`));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      off();
    };
  }, [react]);

  const k = calm ? 2.2 : 1;
  return (
    <svg
      aria-hidden
      className={"pointer-events-none block " + className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ overflow: "hidden", ...style }}
    >
      {LAYERS.map((l, i) => (
        <g
          key={i}
          ref={(el) => {
            groups.current[i] = el;
          }}
          style={{ transformOrigin: `0 ${height}px`, transform: react ? "scaleY(0.3)" : calm ? "scaleY(0.6)" : "scaleY(0.8)", transition: "transform 0.4s ease" }}
        >
          <path
            d={paths[i]}
            fill={l.color}
            opacity={l.opacity}
            className="flo-ocean-drift"
            style={{ animationDuration: `${l.speed * k}s`, ["--w" as string]: `${-width}px` } as React.CSSProperties}
          />
        </g>
      ))}
      {foam && (
        <path
          d={paths[2]}
          fill="none"
          stroke="#c2ecff"
          strokeOpacity={0.35}
          strokeWidth={0.8}
          className="flo-ocean-drift"
          style={{ animationDuration: `${LAYERS[2].speed * k}s`, ["--w" as string]: `${-width}px` } as React.CSSProperties}
        />
      )}
    </svg>
  );
}
