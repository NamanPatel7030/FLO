// Notch visualiser: ONE animation inside the wings (never behind the camera, never touching the
// notch silhouette). Six selectable styles, all ≤30 fps, canvas + accent gradient, amplitude eased
// from the mic level with a critically damped spring. Unmounted when idle → zero work.
import { useEffect, useRef } from "react";
import { on } from "../lib/api";
import { EV, type LevelEvent, type NotchStyle } from "../lib/types";
import { gateLevel, initialGate } from "../lib/gate";
import { hexToRgb, normalizeHex } from "../lib/theme";

export type RibbonMode = "listen" | "transcribe" | "think" | "done";
const FRAME_MS = 1000 / 30;

function readAccent(explicit?: string): { a: [number, number, number]; from: [number, number, number]; to: [number, number, number]; soft: [number, number, number] } {
  const css = (k: string, fb: string) => {
    if (typeof getComputedStyle === "undefined") return fb;
    return getComputedStyle(document.documentElement).getPropertyValue(k).trim() || fb;
  };
  const a = normalizeHex(explicit || css("--accent", "#3dbbff"));
  return {
    a: hexToRgb(a),
    from: hexToRgb(normalizeHex(css("--accent-grad-from", "#1a9be0"))),
    to: hexToRgb(normalizeHex(css("--accent-grad-to", "#93ddff"))),
    soft: hexToRgb(normalizeHex(css("--accent-soft", "#c2ecff"))),
  };
}

export function NotchViz({
  style = "ribbon",
  accent,
  width,
  height,
  notchWidth,
  wing,
  mode,
  leftWing,
  bright = false,
  sim = false,
  single = false,
}: {
  style?: NotchStyle;
  accent?: string;
  width: number;
  height: number;
  notchWidth: number;
  wing: number;
  mode: RibbonMode;
  leftWing: boolean;
  bright?: boolean;
  /** synthesize a "speaking" level envelope (for gallery previews, no mic) */
  sim?: boolean;
  /** one segment across the whole width (previews), instead of two wings around the notch */
  single?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ mode, leftWing, bright, level: 0, sim });
  live.current.mode = mode;
  live.current.leftWing = leftWing;
  live.current.bright = bright;
  live.current.sim = sim;

  useEffect(() => {
    if (sim) return;
    return on<LevelEvent>(EV.level, (e) => (live.current.level = e.rms));
  }, [sim]);

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
    const col = readAccent(accent);
    const rgba = (c3: [number, number, number], al: number) => `rgba(${c3[0]},${c3[1]},${c3[2]},${al})`;

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

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < FRAME_MS) return;
      const dt = Math.min(0.1, (now - (last || now)) / 1000);
      last = now;
      const L = live.current;
      const t = (now - t0) / 1000;
      const speed = reduce ? 0 : 1;
      // previews: synthesize a lively speaking envelope so the style visibly moves without a mic
      if (L.sim) L.level = 0.12 + 0.5 * Math.pow(0.5 + 0.5 * Math.sin(t * 2.3), 2) + 0.2 * Math.max(0, Math.sin(t * 5.1));

      // shared amplitude: adaptive gate on listen; calm targets on working; settle on done
      let target = 0.15;
      if (L.mode === "listen") target = 0.08 + 0.03 * Math.sin(t * 1.6) + gateLevel(gate, L.level, dt) * 0.9;
      else if (L.mode === "transcribe") target = 0.26;
      else if (L.mode === "think") target = 0.22;
      else if (L.mode === "done") {
        if (!doneAt) {
          doneAt = now;
          vel += 5;
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

      // while working, the two wings are a complementary PAIR, not a mirror:
      //   transcribe → left: spinning arc · right: glyph ticks streaming (sound → text)
      //   think      → left: breathing rings · right: a calm flowing sheen
      const working = L.mode === "transcribe" || L.mode === "think";
      const segList: { x0: number; x1: number; a: number; side: "left" | "right" }[] = single
        ? [{ x0: pad * 2, x1: width - pad * 2, a: 1, side: "right" }]
        : [
            { x0: pad, x1: wing - pad / 2, a: leftAlpha, side: "left" },
            { x0: width - wing + pad / 2, x1: width - pad, a: 1, side: "right" },
          ];
      for (const s of segList) {
        if (s.a < 0.02 || s.x1 <= s.x0) continue;
        const a0 = s.a * fade * (L.bright ? 1 : 0.9);
        const ctx: Ctx = { x0: s.x0, x1: s.x1, w: s.x1 - s.x0, cx: (s.x0 + s.x1) / 2, mid, height, amp, t, speed, alpha: a0, col, rgba, mode: L.mode, side: s.side };
        if (working) drawWorking(g, ctx);
        else drawStyle(g, style, ctx);
      }
      if (L.mode === "done" && fade <= 0) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [width, height, notchWidth, wing, style, accent, single]);

  return (
    <canvas
      ref={canvas}
      aria-hidden
      data-testid="island-ribbon"
      data-mode={mode}
      data-style={style}
      className="pointer-events-none absolute left-0 top-0"
      style={{ width, height }}
    />
  );
}

type Ctx = {
  x0: number;
  x1: number;
  w: number;
  cx: number;
  mid: number;
  height: number;
  amp: number;
  t: number;
  speed: number;
  alpha: number;
  col: ReturnType<typeof readAccent>;
  rgba: (c: [number, number, number], a: number) => string;
  mode: RibbonMode;
  side?: "left" | "right";
};

// ── working-mode PAIR: left and right are intentionally different motifs ──────
function drawWorking(g: CanvasRenderingContext2D, c: Ctx) {
  if (c.mode === "think") (c.side === "left" ? drawCogRings : drawFlow)(g, c);
  else (c.side === "left" ? drawOrbit : drawStream)(g, c);
}

// LEFT · transcribe — a spinning arc that reads as "processing"
function drawOrbit(g: CanvasRenderingContext2D, c: Ctx) {
  const r = c.height * 0.3;
  g.lineCap = "round";
  g.beginPath();
  g.arc(c.cx, c.mid, r, 0, Math.PI * 2);
  g.strokeStyle = c.rgba(c.col.a, 0.16 * c.alpha);
  g.lineWidth = 1.5;
  g.stroke();
  const rot = c.t * 3.4 * c.speed;
  const grad = g.createLinearGradient(c.cx - r, 0, c.cx + r, 0);
  grad.addColorStop(0, c.rgba(c.col.to, 0.1 * c.alpha));
  grad.addColorStop(1, c.rgba(c.col.soft, 0.95 * c.alpha));
  g.beginPath();
  g.arc(c.cx, c.mid, r, rot, rot + Math.PI * 0.7);
  g.strokeStyle = grad;
  g.lineWidth = 2.2;
  g.stroke();
  const lx = c.cx + Math.cos(rot + Math.PI * 0.7) * r;
  const ly = c.mid + Math.sin(rot + Math.PI * 0.7) * r;
  g.beginPath();
  g.arc(lx, ly, 1.8, 0, Math.PI * 2);
  g.fillStyle = c.rgba(c.col.soft, 0.95 * c.alpha);
  g.fill();
}

// RIGHT · transcribe — short glyph ticks streaming left→right ("sound becoming text")
function drawStream(g: CanvasRenderingContext2D, c: Ctx) {
  const n = 9;
  for (let i = 0; i < n; i++) {
    const phase = (c.t * 0.9 * c.speed + i / n) % 1;
    const x = c.x0 + phase * c.w;
    const env = Math.sin(Math.PI * phase);
    const h = 2 + env * c.height * 0.5;
    g.fillStyle = c.rgba(c.col.soft, env * 0.9 * c.alpha);
    g.beginPath();
    g.roundRect(x, c.mid - h / 2, 2, h, 1);
    g.fill();
  }
  const hx = c.x0 + ((c.t * 0.5 * c.speed) % 1) * c.w;
  const band = g.createRadialGradient(hx, c.mid, 0, hx, c.mid, 10);
  band.addColorStop(0, c.rgba(c.col.a, 0.3 * c.alpha));
  band.addColorStop(1, c.rgba(c.col.a, 0));
  g.fillStyle = band;
  g.fillRect(c.x0, 0, c.w, c.height);
}

// LEFT · think — concentric breathing rings ("cognition")
function drawCogRings(g: CanvasRenderingContext2D, c: Ctx) {
  const maxR = c.height * 0.46;
  for (let i = 0; i < 3; i++) {
    const phase = (c.t * 0.5 * c.speed + i / 3) % 1;
    const r = 2 + phase * maxR;
    g.beginPath();
    g.arc(c.cx, c.mid, r, 0, Math.PI * 2);
    g.strokeStyle = c.rgba(c.col.a, (1 - phase) * 0.5 * c.alpha);
    g.lineWidth = 1.3;
    g.stroke();
  }
  const breath = 0.6 + 0.4 * Math.sin(c.t * 2.2 * c.speed);
  const r0 = c.height * 0.12 * (0.8 + breath * 0.5);
  const core = g.createRadialGradient(c.cx, c.mid, 0, c.cx, c.mid, r0);
  core.addColorStop(0, c.rgba(c.col.soft, 0.95 * c.alpha));
  core.addColorStop(1, c.rgba(c.col.from, 0.1 * c.alpha));
  g.fillStyle = core;
  g.beginPath();
  g.arc(c.cx, c.mid, r0, 0, Math.PI * 2);
  g.fill();
}

// RIGHT · think — a calm flowing line with a travelling sheen (no ticks)
function drawFlow(g: CanvasRenderingContext2D, c: Ctx) {
  const A = c.height * 0.2;
  const n = Math.max(12, Math.round(c.w / 2));
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const x = c.x0 + (c.w * i) / n;
    const env = Math.sin(Math.PI * (i / n));
    pts.push([x, c.mid + env * A * Math.sin(x * 0.08 + c.t * 1.4 * c.speed)]);
  }
  const p = (c.t * 0.25 * c.speed) % 1;
  const grad = g.createLinearGradient(c.x0, 0, c.x1, 0);
  grad.addColorStop(Math.max(0, p - 0.3), c.rgba(c.col.from, 0.12 * c.alpha));
  grad.addColorStop(p, c.rgba(c.col.soft, 0.9 * c.alpha));
  grad.addColorStop(Math.min(1, p + 0.3), c.rgba(c.col.to, 0.12 * c.alpha));
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.strokeStyle = grad;
  g.lineWidth = 1.6;
  g.lineCap = "round";
  g.stroke();
}

function drawStyle(g: CanvasRenderingContext2D, style: NotchStyle, c: Ctx) {
  switch (style) {
    case "wave":
      return drawWave(g, c);
    case "bars":
      return drawBars(g, c);
    case "pulse":
      return drawPulse(g, c);
    case "orb":
      return drawOrb(g, c);
    case "aurora":
      return drawAurora(g, c);
    case "spectrum":
      return drawSpectrum(g, c);
    case "comet":
      return drawComet(g, c);
    case "ripple":
      return drawRipple(g, c);
    case "liquid":
      return drawLiquid(g, c);
    case "helix":
      return drawHelix(g, c);
    case "neon":
      return drawNeon(g, c);
    case "sparkle":
      return drawSparkle(g, c);
    case "equalizer":
      return drawEqualizer(g, c);
    case "constellation":
      return drawConstellation(g, c);
    default:
      return drawRibbon(g, c);
  }
}

// frequency bars tinted across the accent range (soft → accent → deep)
function drawSpectrum(g: CanvasRenderingContext2D, c: Ctx) {
  const count = Math.max(7, Math.floor(c.w / 7));
  const gap = 2;
  const bw = (c.w - gap * (count - 1)) / count;
  const maxH = c.height * 0.56;
  const mix = (t: number): [number, number, number] => {
    const stops = [c.col.from, c.col.a, c.col.soft, c.col.to];
    const p = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(p));
    const f = p - i;
    return [0, 1, 2].map((k) => Math.round(stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f)) as [number, number, number];
  };
  for (let i = 0; i < count; i++) {
    const x = c.x0 + i * (bw + gap);
    const phase = c.t * 6 * c.speed + i * 0.55;
    const env = 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(phase), 2);
    const h = Math.max(2, maxH * c.amp * env + 2);
    const y = c.mid - h / 2;
    g.fillStyle = c.rgba(mix(i / (count - 1)), 0.92 * c.alpha);
    g.beginPath();
    g.roundRect(x, y, bw, h, Math.min(bw / 2, 2));
    g.fill();
  }
}

// a bright streak that sweeps across the wing leaving a fading trail
function drawComet(g: CanvasRenderingContext2D, c: Ctx) {
  const prog = (c.t * (0.35 + c.amp * 0.9) * c.speed) % 1;
  const hx = c.x0 + c.w * prog;
  const A = c.height * 0.22 * (0.6 + c.amp);
  const hy = c.mid + Math.sin(c.t * 3 * c.speed) * A;
  const trail = 14;
  for (let i = trail; i >= 0; i--) {
    const tp = prog - i * 0.018;
    if (tp < 0) continue;
    const x = c.x0 + c.w * tp;
    const y = c.mid + Math.sin((c.t - i * 0.02) * 3 * c.speed) * A;
    const a = (1 - i / trail) * 0.5 * c.alpha;
    g.beginPath();
    g.arc(x, y, 1.6 * (1 - i / trail) + 0.4, 0, Math.PI * 2);
    g.fillStyle = c.rgba(c.col.soft, a);
    g.fill();
  }
  const glow = g.createRadialGradient(hx, hy, 0, hx, hy, 7);
  glow.addColorStop(0, c.rgba(c.col.soft, 0.95 * c.alpha));
  glow.addColorStop(1, c.rgba(c.col.a, 0));
  g.fillStyle = glow;
  g.beginPath();
  g.arc(hx, hy, 7, 0, Math.PI * 2);
  g.fill();
}

// concentric rings expanding from the centre on sound
function drawRipple(g: CanvasRenderingContext2D, c: Ctx) {
  const rings = 3;
  const maxR = Math.min(c.w, c.height * 2.2) * 0.5;
  for (let i = 0; i < rings; i++) {
    const phase = (c.t * (0.6 + c.amp * 1.2) * c.speed + i / rings) % 1;
    const r = 3 + phase * maxR;
    const a = (1 - phase) * 0.6 * c.alpha;
    g.beginPath();
    g.arc(c.cx, c.mid, r, 0, Math.PI * 2);
    g.strokeStyle = c.rgba(c.col.a, a);
    g.lineWidth = 1.5;
    g.stroke();
  }
  const r0 = c.height * 0.1 * (1 + c.amp);
  const core = g.createRadialGradient(c.cx, c.mid, 0, c.cx, c.mid, r0);
  core.addColorStop(0, c.rgba(c.col.soft, 0.95 * c.alpha));
  core.addColorStop(1, c.rgba(c.col.from, 0.1 * c.alpha));
  g.fillStyle = core;
  g.beginPath();
  g.arc(c.cx, c.mid, r0, 0, Math.PI * 2);
  g.fill();
}

// a gooey blob that wobbles with the level
function drawLiquid(g: CanvasRenderingContext2D, c: Ctx) {
  const R = c.height * 0.3 * (0.7 + c.amp * 0.9);
  const lobes = 6;
  const pts: [number, number][] = [];
  const steps = 36;
  for (let i = 0; i <= steps; i++) {
    const ang = (i / steps) * Math.PI * 2;
    const wob = 1 + 0.18 * Math.sin(ang * lobes + c.t * 2.4 * c.speed) + 0.12 * Math.sin(ang * 3 - c.t * 1.7 * c.speed) * c.amp * 3;
    pts.push([c.cx + Math.cos(ang) * R * wob, c.mid + Math.sin(ang) * R * wob * 0.9]);
  }
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  const fill = g.createRadialGradient(c.cx, c.mid, 0, c.cx, c.mid, R * 1.4);
  fill.addColorStop(0, c.rgba(c.col.soft, 0.9 * c.alpha));
  fill.addColorStop(0.7, c.rgba(c.col.a, 0.7 * c.alpha));
  fill.addColorStop(1, c.rgba(c.col.from, 0.15 * c.alpha));
  g.fillStyle = fill;
  g.fill();
}

// drifting dots that connect with lines when near
function drawConstellation(g: CanvasRenderingContext2D, c: Ctx) {
  const n = Math.max(4, Math.floor(c.w / 16));
  const nodes: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const sx = c.x0 + c.w * ((i + 0.5) / n);
    const x = sx + Math.sin(c.t * 1.2 * c.speed + i * 1.3) * 5;
    const y = c.mid + Math.sin(c.t * 1.7 * c.speed + i * 2.1) * c.height * 0.3 * (0.5 + c.amp);
    nodes.push([x, y]);
  }
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i][0] - nodes[j][0];
      const dy = nodes[i][1] - nodes[j][1];
      const d = Math.hypot(dx, dy);
      const lim = 34;
      if (d < lim) {
        g.beginPath();
        g.moveTo(nodes[i][0], nodes[i][1]);
        g.lineTo(nodes[j][0], nodes[j][1]);
        g.strokeStyle = c.rgba(c.col.a, (1 - d / lim) * 0.45 * c.alpha);
        g.lineWidth = 1;
        g.stroke();
      }
    }
  }
  for (const [x, y] of nodes) {
    g.beginPath();
    g.arc(x, y, 1.8, 0, Math.PI * 2);
    g.fillStyle = c.rgba(c.col.soft, 0.95 * c.alpha);
    g.fill();
  }
}

// one thin luminous line (the original)
function drawRibbon(g: CanvasRenderingContext2D, c: Ctx) {
  const A = c.height * 0.26 * c.amp;
  const n = Math.max(12, Math.round(c.w / 2));
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const x = c.x0 + (c.w * i) / n;
    const env = Math.sin(Math.PI * (i / n));
    const y = c.mid + env * A * (0.62 * Math.sin(x * 0.11 + c.t * 2.4 * c.speed) + 0.38 * Math.sin(x * 0.19 - c.t * 3.7 * c.speed));
    pts.push([x, y]);
  }
  const path = () => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  };
  path();
  g.strokeStyle = c.rgba(c.col.a, 0.16 * c.alpha);
  g.lineWidth = 5;
  g.lineCap = "round";
  g.stroke();
  const grad = g.createLinearGradient(c.x0, 0, c.x1, 0);
  grad.addColorStop(0, c.rgba(c.col.from, 0.15 * c.alpha));
  grad.addColorStop(0.5, c.rgba(c.col.soft, 0.95 * c.alpha));
  grad.addColorStop(1, c.rgba(c.col.to, 0.15 * c.alpha));
  path();
  g.strokeStyle = grad;
  g.lineWidth = 1.5;
  g.stroke();
}

// filled sine ribbon
function drawWave(g: CanvasRenderingContext2D, c: Ctx) {
  const A = c.height * 0.3 * c.amp;
  const n = Math.max(14, Math.round(c.w / 2));
  const top: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const x = c.x0 + (c.w * i) / n;
    const env = Math.sin(Math.PI * (i / n));
    const y = c.mid + env * A * (0.6 * Math.sin(x * 0.09 + c.t * 2.2 * c.speed) + 0.4 * Math.sin(x * 0.17 - c.t * 3.3 * c.speed));
    top.push([x, y]);
  }
  g.beginPath();
  top.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.lineTo(c.x1, c.mid + c.height);
  g.lineTo(c.x0, c.mid + c.height);
  g.closePath();
  const fill = g.createLinearGradient(0, c.mid - A, 0, c.mid + A);
  fill.addColorStop(0, c.rgba(c.col.soft, 0.5 * c.alpha));
  fill.addColorStop(1, c.rgba(c.col.from, 0.04 * c.alpha));
  g.fillStyle = fill;
  g.fill();
  g.beginPath();
  top.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.strokeStyle = c.rgba(c.col.soft, 0.9 * c.alpha);
  g.lineWidth = 1.5;
  g.stroke();
}

// equalizer bars
function drawBars(g: CanvasRenderingContext2D, c: Ctx) {
  const count = Math.max(5, Math.floor(c.w / 10));
  const gap = 3;
  const bw = (c.w - gap * (count - 1)) / count;
  const maxH = c.height * 0.5;
  for (let i = 0; i < count; i++) {
    const x = c.x0 + i * (bw + gap);
    const phase = c.t * 5 * c.speed + i * 0.7;
    const env = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(phase));
    const h = Math.max(2, maxH * c.amp * env + 2);
    const y = c.mid - h / 2;
    const grad = g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, c.rgba(c.col.to, 0.95 * c.alpha));
    grad.addColorStop(1, c.rgba(c.col.from, 0.5 * c.alpha));
    g.fillStyle = grad;
    const r = Math.min(bw / 2, 2);
    g.beginPath();
    g.roundRect(x, y, bw, h, r);
    g.fill();
  }
}

// breathing dot + ring
function drawPulse(g: CanvasRenderingContext2D, c: Ctx) {
  const base = c.height * 0.14;
  const r = base * (1 + c.amp * 1.6);
  const breath = 0.5 + 0.5 * Math.sin(c.t * 3 * c.speed);
  // outer ring
  g.beginPath();
  g.arc(c.cx, c.mid, r + 4 + breath * 5, 0, Math.PI * 2);
  g.strokeStyle = c.rgba(c.col.a, (0.35 - breath * 0.25) * c.alpha);
  g.lineWidth = 1.5;
  g.stroke();
  // core
  const grad = g.createRadialGradient(c.cx, c.mid, 0, c.cx, c.mid, r);
  grad.addColorStop(0, c.rgba(c.col.soft, 0.95 * c.alpha));
  grad.addColorStop(1, c.rgba(c.col.from, 0.1 * c.alpha));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(c.cx, c.mid, r, 0, Math.PI * 2);
  g.fill();
}

// glowing sphere with a drifting highlight
function drawOrb(g: CanvasRenderingContext2D, c: Ctx) {
  const r = c.height * 0.2 * (1 + c.amp * 0.8);
  const hx = c.cx + Math.cos(c.t * 1.6 * c.speed) * r * 0.3;
  const hy = c.mid + Math.sin(c.t * 1.6 * c.speed) * r * 0.3;
  const glow = g.createRadialGradient(c.cx, c.mid, 0, c.cx, c.mid, r * 1.9);
  glow.addColorStop(0, c.rgba(c.col.a, 0.4 * c.alpha));
  glow.addColorStop(1, c.rgba(c.col.a, 0));
  g.fillStyle = glow;
  g.beginPath();
  g.arc(c.cx, c.mid, r * 1.9, 0, Math.PI * 2);
  g.fill();
  const body = g.createRadialGradient(hx, hy, 0, c.cx, c.mid, r);
  body.addColorStop(0, c.rgba(c.col.soft, 0.98 * c.alpha));
  body.addColorStop(0.6, c.rgba(c.col.to, 0.85 * c.alpha));
  body.addColorStop(1, c.rgba(c.col.from, 0.5 * c.alpha));
  g.fillStyle = body;
  g.beginPath();
  g.arc(c.cx, c.mid, r, 0, Math.PI * 2);
  g.fill();
}

// soft drifting colour clouds
function drawAurora(g: CanvasRenderingContext2D, c: Ctx) {
  const blobs = [c.col.from, c.col.a, c.col.to];
  const h = c.height;
  for (let i = 0; i < blobs.length; i++) {
    const px = c.x0 + c.w * (0.3 + 0.4 * (0.5 + 0.5 * Math.sin(c.t * (0.5 + i * 0.25) * c.speed + i)));
    const py = c.mid + Math.sin(c.t * (0.7 + i * 0.3) * c.speed + i * 2) * h * 0.15;
    const r = h * (0.42 + 0.14 * Math.sin(c.t * 0.6 + i)) * (0.8 + c.amp);
    const grad = g.createRadialGradient(px, py, 0, px, py, r);
    grad.addColorStop(0, c.rgba(blobs[i], 0.4 * c.alpha));
    grad.addColorStop(1, c.rgba(blobs[i], 0));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(px, py, r, 0, Math.PI * 2);
    g.fill();
  }
}

/** Back-compat alias: the original ribbon style. Used by Onboarding / SignIn. */
export function Ribbon(props: Omit<Parameters<typeof NotchViz>[0], "style">) {
  return <NotchViz style="ribbon" {...props} />;
}

// ── newer styles ────────────────────────────────────────────────────────────
const frac = (v: number) => v - Math.floor(v);
const mixRgb = (a: [number, number, number], b: [number, number, number], p: number): [number, number, number] => [
  Math.round(a[0] + (b[0] - a[0]) * p),
  Math.round(a[1] + (b[1] - a[1]) * p),
  Math.round(a[2] + (b[2] - a[2]) * p),
];

// two strands twisting around each other; the front strand is brighter, rungs join them
function drawHelix(g: CanvasRenderingContext2D, c: Ctx) {
  const n = Math.max(12, Math.floor(c.w / 8));
  const A = c.height * 0.24 * (0.45 + c.amp * 1.4);
  for (let i = 0; i <= n; i++) {
    const p = i / n;
    const x = c.x0 + c.w * p;
    const ph = p * Math.PI * 4 + c.t * 2.2 * c.speed;
    const y1 = c.mid + Math.sin(ph) * A;
    const y2 = c.mid - Math.sin(ph) * A;
    const z = (Math.cos(ph) + 1) / 2; // 0 back … 1 front
    const edge = Math.sin(Math.PI * p);
    if (i % 2 === 0) {
      g.strokeStyle = c.rgba(c.col.a, 0.22 * c.alpha * edge);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y1);
      g.lineTo(x, y2);
      g.stroke();
    }
    for (const [y, front, col] of [
      [y1, z, c.col.soft],
      [y2, 1 - z, c.col.from],
    ] as [number, number, [number, number, number]][]) {
      g.fillStyle = c.rgba(col, (0.35 + 0.6 * front) * c.alpha * edge);
      g.beginPath();
      g.arc(x, y, 1 + 1.2 * front, 0, Math.PI * 2);
      g.fill();
    }
  }
}

// a single glowing tube of light that breathes with your voice
function drawNeon(g: CanvasRenderingContext2D, c: Ctx) {
  const A = c.height * 0.3 * (0.2 + c.amp * 1.3);
  const path = () => {
    g.beginPath();
    for (let x = c.x0; x <= c.x1; x += 2) {
      const p = (x - c.x0) / c.w;
      const env = Math.sin(Math.PI * p);
      const y = c.mid + Math.sin(p * Math.PI * 3 + c.t * 3 * c.speed) * A * env * (0.7 + 0.3 * Math.sin(p * 9 - c.t * 5 * c.speed));
      if (x === c.x0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
  };
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  g.shadowColor = c.rgba(c.col.a, 0.9 * c.alpha);
  g.shadowBlur = 10;
  g.strokeStyle = c.rgba(c.col.a, 0.5 * c.alpha);
  g.lineWidth = 3.4;
  path();
  g.stroke();
  g.shadowBlur = 0;
  g.strokeStyle = c.rgba(c.col.soft, 0.95 * c.alpha);
  g.lineWidth = 1.2;
  path();
  g.stroke();
  g.restore();
}

// twinkling particles that rise faster and brighter the louder you speak
function drawSparkle(g: CanvasRenderingContext2D, c: Ctx) {
  const n = Math.round(10 + c.w / 12);
  for (let i = 0; i < n; i++) {
    const r = frac(Math.sin(i * 12.9898) * 43758.5453);
    const r2 = frac(Math.sin(i * 78.233) * 24634.6345);
    const x = c.x0 + c.w * r;
    const life = frac(c.t * (0.22 + r2 * 0.35) * c.speed + r);
    const y = c.height * 0.88 - life * c.height * 0.75 * (0.55 + c.amp);
    const tw = Math.sin(life * Math.PI);
    const size = (0.6 + r2 * 1.3) * (0.7 + c.amp);
    const a = tw * c.alpha * (0.35 + 0.65 * Math.min(1, c.amp * 2));
    g.fillStyle = c.rgba(r2 > 0.5 ? c.col.soft : c.col.a, a);
    g.beginPath();
    g.arc(x, y, size, 0, Math.PI * 2);
    g.fill();
    if (r2 > 0.62) {
      g.strokeStyle = c.rgba(c.col.soft, a * 0.6);
      g.lineWidth = 0.7;
      g.beginPath();
      g.moveTo(x - size * 3, y);
      g.lineTo(x + size * 3, y);
      g.moveTo(x, y - size * 3);
      g.lineTo(x, y + size * 3);
      g.stroke();
    }
  }
}

// mirrored rounded bars around the centre line, coloured across the accent gradient
function drawEqualizer(g: CanvasRenderingContext2D, c: Ctx) {
  const n = Math.max(8, Math.floor(c.w / 7));
  const bw = Math.max(2, (c.w / n) * 0.55);
  for (let i = 0; i < n; i++) {
    const p = (i + 0.5) / n;
    const x = c.x0 + c.w * p;
    const env = 0.35 + 0.65 * Math.sin(Math.PI * p);
    const jitter = 0.55 + 0.45 * Math.abs(Math.sin(i * 1.7 + c.t * (4 + (i % 3)) * c.speed));
    const h = Math.max(1.5, c.height * 0.4 * env * (0.12 + c.amp * 1.1) * jitter);
    g.fillStyle = c.rgba(mixRgb(c.col.from, c.col.to, p), 0.9 * c.alpha);
    g.beginPath();
    g.roundRect(x - bw / 2, c.mid - h, bw, h * 2, bw / 2);
    g.fill();
  }
}
