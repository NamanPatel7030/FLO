// Notch ribbon: ONE thin luminous line inside the wings (never behind the camera, never touching
// the notch silhouette). Canvas, ≤30 fps, amplitude eased from the mic level with a critically
// damped spring (no jitter). Unmounted when idle → zero work; after "done" settles the loop stops.
import { useEffect, useRef } from "react";
import { on } from "../lib/api";
import { EV, type LevelEvent } from "../lib/types";
import { gateLevel, initialGate } from "../lib/gate";

export type RibbonMode = "listen" | "transcribe" | "think" | "done";

const FRAME_MS = 1000 / 30;

export function Ribbon({
  width,
  height,
  notchWidth,
  wing,
  mode,
  leftWing,
  bright = false,
}: {
  width: number;
  height: number;
  notchWidth: number;
  /** wing width each side of the camera (logical px) */
  wing: number;
  mode: RibbonMode;
  /** draw in the left wing too (false while an icon sits there) */
  leftWing: boolean;
  /** hands-free: a little brighter */
  bright?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ mode, leftWing, bright, level: 0 });
  live.current.mode = mode;
  live.current.leftWing = leftWing;
  live.current.bright = bright;

  useEffect(() => on<LevelEvent>(EV.level, (e) => (live.current.level = e.rms)), []);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // critically damped spring for amplitude (ω = 9)
    const gate = initialGate();
    let amp = 0.06;
    let vel = 0;
    let leftAlpha = live.current.leftWing ? 1 : 0;
    let doneAt = 0;
    let fade = 1;
    let last = 0;
    let raf = 0;
    const t0 = performance.now();
    const mid = height * 0.56;
    const pad = 7;
    const segs = () => [
      { x0: pad, x1: wing - pad / 2, a: leftAlpha }, // left wing
      { x0: width - wing + pad / 2, x1: width - pad, a: 1 }, // right wing
    ];

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < FRAME_MS) return;
      const dt = Math.min(0.1, (now - (last || now)) / 1000);
      last = now;
      const L = live.current;
      const t = (now - t0) / 1000;

      // targets per mode
      let target = 0.15;
      // listen: adaptive noise gate → almost flat (≤1px breathing) unless you speak
      if (L.mode === "listen") target = 0.06 + 0.03 * Math.sin(t * 1.6) + gateLevel(gate, L.level, dt) * 0.91;
      else if (L.mode === "transcribe") target = 0.1;
      else if (L.mode === "think") target = 0.14;
      else if (L.mode === "done") {
        if (!doneAt) {
          doneAt = now;
          vel += 5; // tiny ripple kick
        }
        target = 0;
      }
      const w = 9;
      vel += (w * w * (target - amp) - 2 * w * vel) * dt;
      amp += vel * dt;
      leftAlpha += ((L.leftWing ? 1 : 0) - leftAlpha) * Math.min(1, dt * 8);
      if (L.mode === "done") fade = Math.max(0, 1 - (now - doneAt) / 700);
      else {
        doneAt = 0;
        fade = Math.min(1, fade + dt * 4);
      }

      g.clearRect(0, 0, width, height);
      const A = (height * 0.26) * amp;
      const speed = reduce ? 0 : 1;
      // light pulse along the ribbon: transcribe = travels left → right, think = breathes from the centre
      const span = width;
      const pulseAt = (x: number) => {
        if (L.mode === "transcribe") {
          const p = ((t * 0.55) % 1.2) - 0.1;
          return Math.exp(-Math.pow((x / span - p) / 0.07, 2));
        }
        if (L.mode === "think") {
          const breath = 0.5 + 0.5 * Math.sin(t * 2.2);
          const d = Math.abs(x / span - 0.5);
          return Math.exp(-Math.pow((d - 0.32 * breath) / 0.09, 2)) * (0.6 + 0.4 * breath);
        }
        return 0;
      };

      for (const s of segs()) {
        if (s.a < 0.02 || s.x1 <= s.x0) continue;
        const pts: [number, number][] = [];
        const n = Math.max(12, Math.round((s.x1 - s.x0) / 2));
        for (let i = 0; i <= n; i++) {
          const x = s.x0 + ((s.x1 - s.x0) * i) / n;
          const u = i / n;
          const env = Math.sin(Math.PI * u); // flat at the wing edges
          const y = mid + env * A * (0.62 * Math.sin(x * 0.11 + t * 2.4 * speed) + 0.38 * Math.sin(x * 0.19 - t * 3.7 * speed));
          pts.push([x, y]);
        }
        const path = () => {
          g.beginPath();
          pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        };
        const alpha = s.a * fade * (L.bright ? 1 : 0.88);
        // soft glow
        path();
        g.strokeStyle = `rgba(102,206,255,${0.16 * alpha})`;
        g.lineWidth = 5;
        g.lineCap = "round";
        g.stroke();
        // core
        const grad = g.createLinearGradient(s.x0, 0, s.x1, 0);
        grad.addColorStop(0, `rgba(102,206,255,${0.15 * alpha})`);
        grad.addColorStop(0.5, `rgba(227,246,255,${0.95 * alpha})`);
        grad.addColorStop(1, `rgba(102,206,255,${0.15 * alpha})`);
        path();
        g.strokeStyle = grad;
        g.lineWidth = 1.5;
        g.stroke();
        // travelling light pulse (working phases)
        if (L.mode === "transcribe" || L.mode === "think") {
          const pg = g.createLinearGradient(s.x0, 0, s.x1, 0);
          for (let k = 0; k <= 8; k++) {
            const x = s.x0 + ((s.x1 - s.x0) * k) / 8;
            pg.addColorStop(k / 8, `rgba(255,255,255,${(0.95 * pulseAt(x) * alpha).toFixed(3)})`);
          }
          path();
          g.strokeStyle = pg;
          g.lineWidth = 2.2;
          g.stroke();
        }
      }
      // done: stop drawing once the ripple has settled and faded
      if (L.mode === "done" && fade <= 0) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [width, height, notchWidth, wing]);

  return (
    <canvas
      ref={canvas}
      aria-hidden
      data-testid="island-ribbon"
      data-mode={mode}
      className="pointer-events-none absolute left-0 top-0"
      style={{ width, height }}
    />
  );
}
