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

const GRAD = "linear-gradient(180deg,#e3f6ff,#66ceff 55%,#1a9be0)";

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

export function Ribbon({ w = 220, h = 36 }: { w?: number; h?: number }) {
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const gid = `rib${useId().replace(/:/g, "")}`;
  useRaf((t) => {
    const env = 0.35 + 0.65 * envelope(t);
    paths.current.forEach((p, k) => {
      if (!p) return;
      let d = "";
      for (let i = 0; i <= 40; i++) {
        const x = (i / 40) * w;
        const taper = Math.sin((Math.PI * i) / 40);
        const y = h / 2 + Math.sin(i * 0.32 + t * (3.2 + k * 0.7) + k * 1.9) * (h * 0.38) * env * taper * (1 - k * 0.22);
        d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      p.setAttribute("d", d);
    });
  });
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="overflow-visible">
      <defs>
        <linearGradient id={gid} x1="0" x2="1">
          <stop offset="0" stopColor="#1a9be0" stopOpacity="0" />
          <stop offset="0.3" stopColor="#66ceff" />
          <stop offset="0.7" stopColor="#c2ecff" />
          <stop offset="1" stopColor="#1a9be0" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2].map((k) => (
        <path
          key={k}
          ref={(el) => {
            paths.current[k] = el;
          }}
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth={k === 0 ? 2.4 : 1.4}
          strokeOpacity={k === 0 ? 1 : 0.5}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

export function NeonLine({ w = 220 }: { w?: number }) {
  const line = useRef<HTMLDivElement>(null);
  const spark = useRef<HTMLDivElement>(null);
  useRaf((t) => {
    const env = envelope(t);
    if (line.current) line.current.style.transform = `scaleX(${(0.25 + 0.75 * env).toFixed(3)})`;
    if (spark.current) spark.current.style.transform = `translateX(${(((t * 0.6) % 1) * w - 20).toFixed(1)}px)`;
  });
  return (
    <div className="relative h-6 overflow-hidden" style={{ width: w }} aria-hidden>
      <div
        ref={line}
        className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full"
        style={{ background: "linear-gradient(90deg,transparent,#66ceff 20%,#e3f6ff 50%,#66ceff 80%,transparent)", boxShadow: "0 0 10px 2px rgb(61 187 255 / 0.65), 0 0 24px 4px rgb(61 187 255 / 0.3)", willChange: "transform" }}
      />
      <div ref={spark} className="absolute top-1/2 h-[5px] w-10 -translate-y-1/2 rounded-full bg-white/80" style={{ boxShadow: "0 0 12px 3px rgb(194 236 255 / 0.8)", willChange: "transform" }} />
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
          style={{ background: i < n ? "#c2ecff" : "#3dbbff", willChange: "transform, opacity" }}
        />
      ))}
    </div>
  );
}

export function Sparkles({ w = 220, h = 34, n = 22 }: { w?: number; h?: number; n?: number }) {
  return (
    <div className="relative" style={{ width: w, height: h }} aria-hidden>
      {Array.from({ length: n }).map((_, i) => {
        const x = ((i * 37) % 100) / 100;
        const y = ((i * 53 + 17) % 100) / 100;
        const s = 2 + ((i * 7) % 4);
        return (
          <span
            key={i}
            className="sparkle absolute rounded-full bg-brand-100"
            style={{ left: x * (w - 6), top: y * (h - 6), width: s, height: s, animationDelay: `${((i * 0.137) % 1.4).toFixed(2)}s`, boxShadow: "0 0 6px 1px rgb(102 206 255 / 0.9)" }}
          />
        );
      })}
    </div>
  );
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
        pressed ? "translate-y-[1px] border-brand-300/60 bg-brand-400/20 text-brand-100 shadow-[0_0_14px_rgb(61_187_255/0.45)]" : "border-white/15 bg-white/[0.06] text-white/70"
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
