"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

/** requestAnimationFrame loop that writes straight to the DOM (no React re-render per frame). */
function useRaf(cb: (t: number) => void) {
  const reduce = useReducedMotion();
  const ref = useRef(cb);
  useEffect(() => {
    ref.current = cb;
  });
  useEffect(() => {
    let id = 0;
    const start = performance.now();
    const loop = (now: number) => {
      ref.current((now - start) / 1000);
      id = requestAnimationFrame(loop);
    };
    if (reduce) {
      ref.current(0.9);
      return;
    }
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [reduce]);
}

/** A believable speech envelope: syllable bursts riding on slower phrase swells, with brief pauses. */
export function envelope(t: number) {
  const syll = Math.max(0, Math.sin(t * 9.2) * 0.6 + Math.sin(t * 5.3 + 1.2) * 0.5);
  const phrase = 0.55 + 0.45 * Math.sin(t * 1.4 + 0.6);
  const pause = Math.sin(t * 0.9) > 0.82 ? 0.25 : 1;
  return Math.min(1, 0.12 + syll * phrase * pause);
}

/* Colours come from CSS vars set on the notch (the visitor's chosen palette), with Flo blue as fallback. */
const HI = "var(--vh, #e3f6ff)";
const A = "var(--va, #66ceff)";
const B = "var(--vb, #1a9be0)";
const glow = (pct: number) => `color-mix(in srgb, ${A} ${pct}%, transparent)`;
const GRAD = `linear-gradient(180deg,${HI},${A} 55%,${B})`;

export function VoiceBars({ n = 24, h = 24, w = 3, gap = 3, energy = 1 }: { n?: number; h?: number; w?: number; gap?: number; energy?: number }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  useRaf((t) => {
    const env = envelope(t) * energy;
    for (let i = 0; i < n; i++) {
      const el = bars.current[i];
      if (!el) continue;
      const bell = 0.45 + 0.55 * Math.sin((Math.PI * (i + 0.5)) / n);
      const jitter = 0.5 + 0.5 * Math.abs(Math.sin(i * 1.7 + t * 6.1 + Math.sin(t * 2.3 + i) * 1.4));
      el.style.transform = `scaleY(${Math.max(0.14, env * bell * jitter).toFixed(3)})`;
    }
  });
  return (
    <div className="flex items-center" style={{ height: h, gap }} aria-hidden>
      {Array.from({ length: n }).map((_, i) => (
        <span
          key={i}
          ref={(el) => {
            bars.current[i] = el;
          }}
          className="block rounded-full"
          style={{ width: w, height: "100%", background: GRAD, transform: "scaleY(0.3)", willChange: "transform" }}
        />
      ))}
    </div>
  );
}

export function Ribbon({ w = 220, h = 36, lines = 3, mirror = false }: { w?: number; h?: number; lines?: number; mirror?: boolean }) {
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const gid = `rib${useId().replace(/:/g, "")}`;
  useRaf((t) => {
    const env = 0.35 + 0.65 * envelope(t);
    paths.current.forEach((p, k) => {
      if (!p) return;
      let d = "";
      const sign = mirror && k % 2 ? -1 : 1;
      for (let i = 0; i <= 40; i++) {
        const x = (i / 40) * w;
        const taper = Math.sin((Math.PI * i) / 40);
        const wobble = mirror ? Math.sin(i * 0.32 + t * 3.2) : Math.sin(i * 0.32 + t * (3.2 + k * 0.7) + k * 1.9);
        const y = h / 2 + sign * wobble * (h * 0.38) * env * taper * (mirror ? 1 : 1 - k * 0.22);
        d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      p.setAttribute("d", d);
    });
  });
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
      <defs>
        <linearGradient id={gid} x1="0" x2="1">
          <stop offset="0" style={{ stopColor: B, stopOpacity: 0 }} />
          <stop offset="0.3" style={{ stopColor: A }} />
          <stop offset="0.7" style={{ stopColor: HI }} />
          <stop offset="1" style={{ stopColor: B, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {Array.from({ length: lines }, (_, k) => (
        <path
          key={k}
          ref={(el) => {
            paths.current[k] = el;
          }}
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth={k === 0 || mirror ? 2.2 : 1.4}
          strokeOpacity={k === 0 || mirror ? 1 : 0.5}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

export function NeonLine({ w = 220, comet = false }: { w?: number; comet?: boolean }) {
  const line = useRef<HTMLDivElement>(null);
  const spark = useRef<HTMLDivElement>(null);
  useRaf((t) => {
    const env = envelope(t);
    if (line.current) line.current.style.transform = `scaleX(${(comet ? 0.15 + 0.25 * env : 0.25 + 0.75 * env).toFixed(3)})`;
    if (spark.current) {
      const speed = comet ? 0.5 + env * 0.4 : 0.6;
      spark.current.style.transform = `translateX(${(((t * speed) % 1) * w - 20).toFixed(1)}px) scaleX(${comet ? (1 + env * 1.2).toFixed(2) : "1"})`;
    }
  });
  return (
    <div className="relative h-6 overflow-hidden" style={{ width: w }} aria-hidden>
      <div
        ref={line}
        className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full"
        style={{ background: `linear-gradient(90deg,transparent,${A} 20%,${HI} 50%,${A} 80%,transparent)`, boxShadow: `0 0 10px 2px ${glow(65)}, 0 0 24px 4px ${glow(30)}`, willChange: "transform" }}
      />
      <div
        ref={spark}
        className="absolute top-1/2 h-[5px] w-10 -translate-y-1/2 rounded-full"
        style={{ background: comet ? `linear-gradient(90deg,transparent,${A},${HI})` : "rgb(255 255 255 / 0.8)", boxShadow: `0 0 12px 3px ${glow(80)}`, willChange: "transform" }}
      />
    </div>
  );
}

export function Helix({ n = 18, w = 220, h = 32 }: { n?: number; w?: number; h?: number }) {
  const dots = useRef<(HTMLSpanElement | null)[]>([]);
  useRaf((t) => {
    const env = 0.45 + 0.55 * envelope(t);
    for (let i = 0; i < n * 2; i++) {
      const el = dots.current[i];
      if (!el) continue;
      const k = i % n;
      const strand = i < n ? 1 : -1;
      const a = k * 0.55 + t * 3.4;
      const y = Math.sin(a) * strand * (h * 0.36) * env;
      const depth = (Math.cos(a) * strand + 1) / 2;
      el.style.transform = `translate(${((k / (n - 1)) * (w - 8)).toFixed(1)}px, ${(h / 2 - 3 + y).toFixed(1)}px) scale(${(0.5 + depth * 0.7).toFixed(2)})`;
      el.style.opacity = (0.35 + depth * 0.65).toFixed(2);
    }
  });
  return (
    <div className="relative" style={{ width: w, height: h }} aria-hidden>
      {Array.from({ length: n * 2 }).map((_, i) => (
        <span
          key={i}
          ref={(el) => {
            dots.current[i] = el;
          }}
          className="absolute left-0 top-0 h-[6px] w-[6px] rounded-full"
          style={{ background: i < n ? HI : A, willChange: "transform, opacity" }}
        />
      ))}
    </div>
  );
}

export function Sparkles({ w = 220, h = 34, n = 22, line = false }: { w?: number; h?: number; n?: number; line?: boolean }) {
  return (
    <div className="relative" style={{ width: w, height: h }} aria-hidden>
      {Array.from({ length: n }).map((_, i) => {
        const x = line ? i / Math.max(1, n - 1) : ((i * 37) % 100) / 100;
        const y = line ? 0.5 + 0.2 * Math.sin(i * 0.9) : ((i * 53 + 17) % 100) / 100;
        const s = line ? 5 : 2 + ((i * 7) % 4);
        return (
          <span
            key={i}
            className="sparkle absolute rounded-full"
            style={{
              left: x * (w - 6),
              top: y * (h - 6),
              width: s,
              height: s,
              background: HI,
              animationDelay: `${(line ? i * 0.11 : (i * 0.137) % 1.4).toFixed(2)}s`,
              boxShadow: `0 0 6px 1px ${glow(90)}`,
            }}
          />
        );
      })}
    </div>
  );
}

/** Pulsing orb with a halo that breathes with the voice. */
export function PulseOrb({ h = 34 }: { h?: number }) {
  const core = useRef<HTMLSpanElement>(null);
  const halo = useRef<HTMLSpanElement>(null);
  useRaf((t) => {
    const env = envelope(t);
    if (core.current) core.current.style.transform = `scale(${(0.65 + 0.45 * env).toFixed(3)})`;
    if (halo.current) {
      halo.current.style.transform = `scale(${(0.9 + 0.9 * env).toFixed(3)})`;
      halo.current.style.opacity = (0.3 + 0.6 * env).toFixed(2);
    }
  });
  return (
    <div className="relative flex items-center justify-center" style={{ width: h * 1.8, height: h }} aria-hidden>
      <span ref={halo} className="absolute rounded-full" style={{ width: h * 0.85, height: h * 0.85, background: `radial-gradient(circle, ${glow(75)}, transparent 70%)`, willChange: "transform, opacity" }} />
      <span ref={core} className="absolute rounded-full" style={{ width: h * 0.62, height: h * 0.62, background: `radial-gradient(circle at 35% 30%, ${HI}, ${A} 55%, ${B})`, boxShadow: `0 0 14px ${glow(70)}`, willChange: "transform" }} />
    </div>
  );
}

/** A travelling wave of dots. */
export function DotWave({ w = 220, h = 30 }: { w?: number; h?: number }) {
  const n = Math.max(8, Math.round(w / 12));
  const dots = useRef<(HTMLSpanElement | null)[]>([]);
  useRaf((t) => {
    const env = 0.3 + 0.7 * envelope(t);
    for (let i = 0; i < n; i++) {
      const el = dots.current[i];
      if (!el) continue;
      const y = Math.sin(i * 0.7 - t * 5) * (h * 0.36) * env * Math.sin((Math.PI * (i + 0.5)) / n);
      el.style.transform = `translateY(${y.toFixed(1)}px)`;
    }
  });
  return (
    <div className="flex items-center justify-between" style={{ width: w, height: h }} aria-hidden>
      {Array.from({ length: n }).map((_, i) => (
        <span
          key={i}
          ref={(el) => {
            dots.current[i] = el;
          }}
          className="block h-[6px] w-[6px] rounded-full"
          style={{ background: i % 2 ? A : HI, boxShadow: `0 0 6px ${glow(60)}`, willChange: "transform" }}
        />
      ))}
    </div>
  );
}

/** ECG-style trace that spikes with each syllable. */
export function Heartbeat({ w = 220, h = 32 }: { w?: number; h?: number }) {
  const path = useRef<SVGPathElement>(null);
  useRaf((t) => {
    const env = 0.35 + 0.65 * envelope(t);
    let d = "";
    const N = 72;
    for (let i = 0; i <= N; i++) {
      const x = (i / N) * w;
      const ph = (i / N) * 3 - t * 1.2;
      const f = ph - Math.floor(ph);
      const spike = f > 0.42 && f < 0.5 ? -Math.sin(((f - 0.42) / 0.08) * Math.PI) : f > 0.5 && f < 0.56 ? 0.5 * Math.sin(((f - 0.5) / 0.06) * Math.PI) : 0;
      const y = h / 2 + spike * h * 0.44 * env;
      d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    path.current?.setAttribute("d", d);
  });
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
      <path ref={path} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" style={{ stroke: A }} />
    </svg>
  );
}

/** Dots orbiting on a tilted ring. */
export function Orbit({ w = 220, h = 32 }: { w?: number; h?: number }) {
  const n = 10;
  const dots = useRef<(HTMLSpanElement | null)[]>([]);
  useRaf((t) => {
    const env = 0.5 + 0.5 * envelope(t);
    for (let i = 0; i < n; i++) {
      const el = dots.current[i];
      if (!el) continue;
      const a = t * 1.6 + (i / n) * Math.PI * 2;
      const x = w / 2 - 3 + Math.cos(a) * (w * 0.42) * env;
      const y = h / 2 - 3 + Math.sin(a) * (h * 0.32);
      const depth = (Math.sin(a) + 1) / 2;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(0.5 + depth * 0.8).toFixed(2)})`;
      el.style.opacity = (0.35 + depth * 0.65).toFixed(2);
    }
  });
  return (
    <div className="relative" style={{ width: w, height: h }} aria-hidden>
      {Array.from({ length: n }).map((_, i) => (
        <span
          key={i}
          ref={(el) => {
            dots.current[i] = el;
          }}
          className="absolute left-0 top-0 h-[6px] w-[6px] rounded-full"
          style={{ background: i % 3 ? A : HI, willChange: "transform, opacity" }}
        />
      ))}
    </div>
  );
}

/** Concentric rings rippling out from the centre (CSS keyframes, transform/opacity only). */
export function Ripple({ h = 34 }: { h?: number }) {
  return (
    <div className="relative flex items-center justify-center" style={{ width: h * 2.4, height: h }} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="ripple absolute rounded-full" style={{ width: h * 0.9, height: h * 0.9, border: `2px solid ${A}`, animationDelay: `${i * 0.6}s` }} />
      ))}
      <span className="absolute h-2.5 w-2.5 rounded-full" style={{ background: HI, boxShadow: `0 0 10px ${glow(90)}` }} />
    </div>
  );
}

/** A little LED matrix lighting up like a spectrum analyser. */
export function PixelGrid({ w = 220, h = 30 }: { w?: number; h?: number }) {
  const cols = Math.max(8, Math.round(w / 9));
  const rows = 4;
  const cells = useRef<(HTMLSpanElement | null)[]>([]);
  useRaf((t) => {
    const env = envelope(t);
    for (let c = 0; c < cols; c++) {
      const bell = 0.4 + 0.6 * Math.sin((Math.PI * (c + 0.5)) / cols);
      const lvl = env * bell * (0.55 + 0.45 * Math.abs(Math.sin(c * 1.3 + t * 5.2))) * rows;
      for (let r = 0; r < rows; r++) {
        const el = cells.current[c * rows + r];
        if (el) el.style.opacity = r === rows - 1 || rows - r <= lvl + 0.5 ? "1" : "0.14";
      }
    }
  });
  return (
    <div className="grid" style={{ width: w, height: h, gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)`, gridAutoFlow: "column", gap: 2 }} aria-hidden>
      {Array.from({ length: cols * rows }).map((_, i) => (
        <span
          key={i}
          ref={(el) => {
            cells.current[i] = el;
          }}
          className="rounded-[1.5px]"
          style={{ background: i % rows === 0 ? HI : A, opacity: 0.14 }}
        />
      ))}
    </div>
  );
}

/** Draws one of the 15 listening styles by index. */
export function StyleViz({ style, w, h = 32 }: { style: number; w: number; h?: number }) {
  switch (style) {
    case 0:
      return <Ribbon w={w} h={h + 2} />;
    case 1:
      return <VoiceBars n={Math.round(w / 7)} h={h - 2} />;
    case 2:
      return <NeonLine w={w} />;
    case 3:
      return <Helix w={w} h={h} />;
    case 4:
      return <Sparkles w={w} h={h + 2} />;
    case 5:
      return <PulseOrb h={h + 2} />;
    case 6:
      return <DotWave w={w} h={h} />;
    case 7:
      return <VoiceBars n={Math.round(w / 5)} h={h - 2} w={1.5} gap={3.5} />;
    case 8:
      return <Heartbeat w={w} h={h} />;
    case 9:
      return <Orbit w={w} h={h} />;
    case 10:
      return <Ripple h={h + 2} />;
    case 11:
      return <PixelGrid w={w} h={h - 4} />;
    case 12:
      return <NeonLine w={w} comet />;
    case 13:
      return <Ribbon w={w} h={h + 2} lines={2} mirror />;
    default:
      return <Sparkles w={w} h={h} n={Math.round(w / 14)} line />;
  }
}

/** Types `text` out once (restarts when the key/text changes). Static under reduced motion. */
export function Typewriter({ text, speed = 22, delay = 0, caret = true, className }: { text: string; speed?: number; delay?: number; caret?: boolean; className?: string }) {
  const reduce = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduce) {
      setN(text.length);
      return;
    }
    setN(0);
    let i = 0;
    let id: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      id = setInterval(() => {
        i += 1;
        setN(i);
        if (i >= text.length && id) clearInterval(id);
      }, speed);
    }, delay);
    return () => {
      clearTimeout(start);
      if (id) clearInterval(id);
    };
  }, [text, speed, delay, reduce]);
  return (
    <span className={className}>
      {text.slice(0, n)}
      {caret && <Caret />}
    </span>
  );
}

export function Caret() {
  return <span className="ml-[1px] inline-block h-[1.05em] w-[2px] translate-y-[2px] rounded-full bg-brand-300" style={{ animation: "flo-caret 1s steps(1) infinite" }} />;
}

export function Dots() {
  return (
    <span className="inline-flex items-center gap-[3px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-[5px] w-[5px] rounded-full bg-brand-300" style={{ animation: `flo-dot 1s ease-in-out ${i * 0.16}s infinite` }} />
      ))}
    </span>
  );
}

export function Keycap({ children, pressed = false, className = "" }: { children: React.ReactNode; pressed?: boolean; className?: string }) {
  return (
    <span
      className={`inline-flex h-[22px] min-w-[26px] items-center justify-center rounded-[6px] border px-1.5 font-mono text-[11px] transition-all duration-200 ${
        pressed ? "translate-y-[1px] border-brand-300/60 bg-brand-400/20 text-brand-100 shadow-[0_0_14px_rgb(61_187_255/0.45)]" : "border-white/20 bg-gradient-to-b from-white/[0.14] to-white/[0.03] text-white/80 shadow-[inset_0_1px_0_rgb(255_255_255/0.25),inset_0_-2px_0_rgb(0_0_0/0.4)]"
      } ${className}`}
    >
      {children}
    </span>
  );
}

/** Claude's starburst, drawn so we don't ship a logo image. */
export function ClaudeMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {Array.from({ length: 8 }).map((_, i) => (
        <rect key={i} x="11" y="2" width="2.2" height="9" rx="1.1" fill="#d97757" transform={`rotate(${i * 45} 12 12)`} />
      ))}
    </svg>
  );
}

/** Live mm:ss counter, mounted-only so server and client markup agree. */
export function Timer({ from = 0 }: { from?: number }) {
  const [s, setS] = useState(from);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setS((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, [reduce]);
  return <span className="font-mono tabular-nums">{`${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`}</span>;
}
