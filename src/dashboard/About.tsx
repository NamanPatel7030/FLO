// Settings → About: Flo + its maker, laid out on the golden ratio.
//   · grid splits are 1 : φ (1.618), type steps by φ (13 → 21 → 34 → 55), spacing is Fibonacci
//     (5 · 8 · 13 · 21 · 34 · 55 · 89 px), and a golden spiral is drawn faintly behind the hero.
//   · the accent-coloured orb tilts toward the cursor; tap it for a golden-angle burst.
//   · the signature draws itself when the card scrolls into view (and again on hover).
// Everything respects prefers-reduced-motion (no tilt, no spin, instant drawing).
import { useEffect, useRef, useState } from "react";
import { animate, AnimatePresence, motion, useInView, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { Clock3, Flame, Globe, Mic, ShieldCheck, Type } from "lucide-react";
import { api } from "../lib/api";
import { deviceWord } from "../lib/os";
import { formatDuration, formatNumber } from "../lib/format";
import type { Analytics } from "../lib/types";
import { LogoMark } from "./Logo";
import { MAKER_SITE, openExternal, Portrait, SignatureMark } from "./Signature";

const GithubIcon = () => (
  <svg viewBox="0 0 24 24" width={15} height={15} fill="currentColor" aria-hidden>
    <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
  </svg>
);
const LinkedinIcon = () => (
  <svg viewBox="0 0 24 24" width={15} height={15} fill="currentColor" aria-hidden>
    <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" />
  </svg>
);

const LINKS = [
  { icon: <Globe size={15} />, label: "hellonaman.com", url: MAKER_SITE },
  { icon: <GithubIcon />, label: "GitHub", url: "https://github.com/NamanPatel7030" },
  { icon: <LinkedinIcon />, label: "LinkedIn", url: "https://linkedin.com/in/naman-gundaniya" },
];

// ── the golden ratio, as design tokens ───────────────────────────────────────────────────────
const PHI = (1 + Math.sqrt(5)) / 2;
/** Fibonacci spacing scale (px): consecutive steps differ by ≈ φ. */
const F = { 1: 5, 2: 8, 3: 13, 4: 21, 5: 34, 6: 55, 7: 89, 8: 144 } as const;
/** Type scale: 13 · 21 · 34 · 55 (each ×φ). */
const T = { body: 13, lead: 21, title: 34, display: 55 } as const;
/** 1 : φ grid split. */
const GOLDEN_COLS = `${PHI}fr 1fr`;
/** The golden angle (360° / φ²) — how sunflowers pack seeds; used to scatter the burst. */
const GOLDEN_ANGLE = 360 / (PHI * PHI);

/** A golden spiral built from quarter-circle arcs through successively smaller φ-squares. */
function goldenSpiral(W: number, H: number, n: number): { d: string; squares: [number, number, number][] } {
  let x = 0,
    y = 0,
    w = W,
    h = H;
  let d = "";
  const squares: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    let s: number, start: [number, number], end: [number, number];
    switch (i % 4) {
      case 0:
        s = h;
        squares.push([x, y, s]);
        start = [x, y + s];
        end = [x + s, y];
        x += s;
        w -= s;
        break;
      case 1:
        s = w;
        squares.push([x, y, s]);
        start = [x, y];
        end = [x + s, y + s];
        y += s;
        h -= s;
        break;
      case 2:
        s = h;
        squares.push([x + w - s, y, s]);
        start = [x + w, y];
        end = [x + w - s, y + s];
        w -= s;
        break;
      default:
        s = w;
        squares.push([x, y + h - s, s]);
        start = [x + w, y + h];
        end = [x, y + h - s];
        h -= s;
    }
    if (i === 0) d += `M${start[0].toFixed(2)} ${start[1].toFixed(2)}`;
    d += ` A${s.toFixed(2)} ${s.toFixed(2)} 0 0 1 ${end[0].toFixed(2)} ${end[1].toFixed(2)}`;
  }
  return { d, squares };
}
const SPIRAL = goldenSpiral(1000 * PHI, 1000, 12);
/** Where the spiral converges (its "eye"): the centre of the innermost square. The logo sits here. */
const EYE = (() => {
  const sq = goldenSpiral(1000 * PHI, 1000, 30).squares;
  const [x, y, w] = sq[sq.length - 1];
  return [x + w / 2, y + w / 2] as const;
})();
/** px per viewBox unit: the golden rectangle is drawn 377 px tall (a Fibonacci number). */
const SPIRAL_SCALE = 377 / 1000;

function SpiralMotif({ reduce }: { reduce: boolean }) {
  // drawn so its eye lands exactly on the logo (the centre of the orb column), fading outward from there
  const k = SPIRAL_SCALE;
  const fade = `radial-gradient(circle 290px at ${EYE[0] * k}px ${EYE[1] * k}px, #000 30%, transparent 100%)`;
  return (
    <svg
      viewBox={`0 0 ${1000 * PHI} 1000`}
      className="pointer-events-none absolute"
      style={{
        width: 1000 * PHI * k,
        height: 1000 * k,
        left: `calc(50% - ${EYE[0] * k}px)`,
        top: `calc(50% - ${EYE[1] * k}px)`,
        WebkitMaskImage: fade,
        maskImage: fade,
      }}
      aria-hidden
    >
      {SPIRAL.squares.map(([x, y, s], i) => (
        <motion.rect
          key={i}
          x={x}
          y={y}
          width={s}
          height={s}
          fill="none"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          style={{ stroke: "rgb(var(--accent-2-rgb) / 0.09)" }}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 + i * 0.09, duration: 0.6 }}
        />
      ))}
      <motion.path
        d={SPIRAL.d}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        style={{ stroke: "rgb(var(--accent-rgb) / 0.4)" }}
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 2.6, ease: [0.65, 0, 0.35, 1], delay: 0.2 }}
      />
    </svg>
  );
}

// ── hero orb: tilts toward the cursor; click → golden-angle burst ──────────────────────────────
type Burst = { id: number };

function Orb({ reduce }: { reduce: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-1, 1], [14, -14]), { stiffness: 180, damping: 18 });
  const ry = useSpring(useTransform(mx, [-1, 1], [-14, 14]), { stiffness: 180, damping: 18 });
  const gx = useTransform(mx, [-1, 1], ["30%", "70%"]);
  const gy = useTransform(my, [-1, 1], ["30%", "70%"]);
  const glare = useTransform(() => `radial-gradient(circle at ${gx.get()} ${gy.get()}, rgb(255 255 255 / 0.22), transparent 55%)`);
  const spin = useMotionValue(0);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [taps, setTaps] = useState(0);

  const onMove = (e: React.PointerEvent) => {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    mx.set(((e.clientX - r.left) / r.width) * 2 - 1);
    my.set(((e.clientY - r.top) / r.height) * 2 - 1);
  };
  const onLeave = () => {
    mx.set(0);
    my.set(0);
  };
  const onTap = () => {
    setTaps((t) => t + 1);
    const id = Date.now() + Math.random();
    setBursts((b) => [...b, { id }]);
    window.setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), 1400);
    if (!reduce) animate(spin, spin.get() + 360, { type: "spring", stiffness: 70, damping: 12 });
  };

  return (
    <div className="relative flex h-full items-center justify-center" style={{ perspective: 610 }}>
      <SpiralMotif reduce={reduce} />
      {/* halo rings at φ-scaled radii */}
      {[F[8], F[8] / PHI + F[8] / PHI / PHI].map((d, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute rounded-full"
          style={{
            width: d * (i === 0 ? 1.3 : 1.15),
            height: d * (i === 0 ? 1.3 : 1.15),
            border: "1px solid rgb(var(--accent-2-rgb) / 0.14)",
            boxShadow: i === 0 ? "inset 0 0 40px rgb(var(--accent-rgb) / 0.08)" : undefined,
          }}
        />
      ))}
      <span
        aria-hidden
        className="absolute rounded-full"
        style={{
          width: F[8] * 1.3,
          height: F[8] * 1.3,
          background: "conic-gradient(from 0deg, transparent 0deg, rgb(var(--accent-rgb) / 0.55) 60deg, transparent 140deg, transparent 220deg, rgb(var(--accent-2-rgb) / 0.4) 290deg, transparent 360deg)",
          WebkitMask: "radial-gradient(circle, transparent 64%, #000 65%, #000 67%, transparent 68%)",
          mask: "radial-gradient(circle, transparent 64%, #000 65%, #000 67%, transparent 68%)",
          animation: reduce ? undefined : "flo-spin 13s linear infinite",
        }}
      />
      <span aria-hidden className="absolute h-[144px] w-[144px] rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgb(var(--accent-rgb) / 0.55), transparent 70%)" }} />

      <motion.button
        ref={ref}
        type="button"
        aria-label="Flo logo — tap me"
        title="Tap me"
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        onClick={onTap}
        whileTap={reduce ? undefined : { scale: 0.92 }}
        className="relative rounded-[28px] outline-none"
        style={{ rotateX: rx, rotateY: ry, rotateZ: spin, transformStyle: "preserve-3d" }}
      >
        <LogoMark size={F[7] + F[5] / 2} style={{ display: "block", filter: "drop-shadow(0 14px 34px rgb(var(--accent-rgb) / 0.55))" }} />
        <motion.span aria-hidden className="pointer-events-none absolute inset-0 rounded-[26px]" style={{ background: glare }} />
      </motion.button>

      {/* golden-angle burst: 21 sparks, each turned 137.5° from the last */}
      <AnimatePresence>
        {bursts.map((b) => (
          <span key={b.id} aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {Array.from({ length: 21 }, (_, k) => {
              const a = (k * GOLDEN_ANGLE * Math.PI) / 180;
              const dist = F[6] + Math.sqrt(k + 1) * F[3];
              const size = k % 3 === 0 ? 7 : 4;
              return (
                <motion.span
                  key={k}
                  className="absolute rounded-full"
                  style={{ width: size, height: size, background: k % 2 ? "var(--accent-soft)" : "var(--accent)", boxShadow: "0 0 10px rgb(var(--accent-rgb) / 0.9)" }}
                  initial={{ x: 0, y: 0, opacity: 1, scale: 0.4 }}
                  animate={reduce ? { opacity: 0 } : { x: Math.cos(a) * dist, y: Math.sin(a) * dist, opacity: 0, scale: 1.1 }}
                  transition={{ duration: 1.1 + (k % 5) * 0.06, ease: [0.16, 1, 0.3, 1] }}
                />
              );
            })}
          </span>
        ))}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        <motion.span
          key={taps >= 5 ? "phi" : "tap"}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="absolute bottom-[13px] z-10 rounded-full border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_85%,transparent)] px-[10px] py-[3px] text-[10.5px] font-medium tracking-wide text-faint backdrop-blur-md"
        >
          {taps >= 5 ? "φ = 1.6180339887…" : taps > 0 ? `${taps} / 5` : "tap the logo"}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

// ── maker card ────────────────────────────────────────────────────────────────────────────────
function TiltPortrait({ reduce }: { reduce: boolean }) {
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-1, 1], [12, -12]), { stiffness: 220, damping: 16 });
  const ry = useSpring(useTransform(mx, [-1, 1], [-12, 12]), { stiffness: 220, damping: 16 });
  const [hot, setHot] = useState(false);
  return (
    <div style={{ perspective: 377 }} className="shrink-0">
      <motion.div
        onPointerMove={(e) => {
          if (reduce) return;
          const r = e.currentTarget.getBoundingClientRect();
          mx.set(((e.clientX - r.left) / r.width) * 2 - 1);
          my.set(((e.clientY - r.top) / r.height) * 2 - 1);
        }}
        onPointerEnter={() => setHot(true)}
        onPointerLeave={() => {
          mx.set(0);
          my.set(0);
          setHot(false);
        }}
        className="relative rounded-full"
        style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }}
        animate={{ scale: hot && !reduce ? 1.05 : 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
      >
        <span
          aria-hidden
          className="absolute -inset-[8px] rounded-full transition-opacity duration-300"
          style={{ background: "conic-gradient(from 210deg, rgb(var(--accent-rgb) / 0.0), rgb(var(--accent-rgb) / 0.7), rgb(var(--accent-2-rgb) / 0.0) 70%)", filter: "blur(10px)", opacity: hot ? 1 : 0.35 }}
        />
        <Portrait size={F[7]} screen="about" cycle />
      </motion.div>
    </div>
  );
}

function MakerCard({ reduce }: { reduce: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: false, amount: 0.5 });
  const [sigKey, setSigKey] = useState(0);
  const seen = useRef(false);
  useEffect(() => {
    // draw the signature the first time the card is on screen (remount restarts the stroke)
    if (inView && !seen.current) {
      seen.current = true;
      setSigKey((k) => k + 1);
    }
  }, [inView]);
  return (
    <div
      ref={ref}
      onMouseEnter={() => setSigKey((k) => k + 1)}
      className="glass relative isolate flex flex-col overflow-hidden rounded-[21px]"
      style={{ padding: F[5] - F[1], clipPath: "inset(0 round 21px)" }}
      data-testid="about-maker"
    >
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ background: "radial-gradient(377px 233px at 100% 0%, rgb(var(--accent-rgb) / 0.13), transparent 70%)" }} />
      <div className="relative mb-[13px] text-[10.5px] font-semibold uppercase tracking-[0.2em] text-faint">Made by</div>
      <div className="relative flex items-center" style={{ gap: F[4] }}>
        <TiltPortrait reduce={reduce} />
        <div className="min-w-0">
          <div className="font-semibold tracking-tight" style={{ fontSize: T.lead, lineHeight: 1.15 }}>
            Naman Gundaniya
          </div>
          <div className="mt-[5px] text-muted" style={{ fontSize: T.body }}>
            Forward Deployed Engineer
          </div>
        </div>
      </div>
      <blockquote
        className="relative mt-[21px] border-l-2 pl-[13px] italic text-[var(--fg)]/90"
        style={{ fontSize: T.body * 1.236, lineHeight: PHI, borderColor: "rgb(var(--accent-rgb) / 0.55)", fontFamily: "ui-serif, 'New York', Georgia, serif" }}
      >
        I'm the human. AI is my leverage. Together, we build anything.
      </blockquote>
      <div className="relative mt-[5px] flex justify-end pr-[8px]" aria-label="Naman">
        {sigKey > 0 ? <SignatureMark key={sigKey} id="about-sig" className="h-[34px] w-[78px]" /> : <span className="h-[34px] w-[78px]" />}
      </div>
      <div className="relative mt-auto flex flex-wrap pt-[13px]" style={{ gap: F[2] }}>
        {LINKS.map((l) => (
          <motion.button
            key={l.url}
            onClick={() => openExternal(l.url)}
            whileHover={reduce ? undefined : { y: -2 }}
            whileTap={reduce ? undefined : { scale: 0.96 }}
            className="btn-glass flex h-[34px] items-center gap-1.5 rounded-[13px] px-[13px] text-[12.5px]"
            title={l.url}
            aria-label={l.label}
          >
            <span className="text-brand-300">{l.icon}</span>
            {l.label}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// ── by the numbers (the same analytics the Home page uses) ────────────────────────────────────
function CountUp({ value, format, reduce }: { value: number; format: (n: number) => string; reduce: boolean }) {
  const [shown, setShown] = useState(reduce ? value : 0);
  useEffect(() => {
    if (reduce) {
      setShown(value);
      return;
    }
    const c = animate(0, value, { duration: PHI, ease: [0.16, 1, 0.3, 1], onUpdate: setShown });
    return () => c.stop();
  }, [value, reduce]);
  return <>{format(shown)}</>;
}

function Numbers({ reduce }: { reduce: boolean }) {
  const [a, setA] = useState<Analytics | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .getAnalytics(30)
      .then((x) => alive && setA(x))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const stats = [
    { label: "Words dictated", icon: <Type size={14} />, value: a?.totalWords, fmt: (n: number) => formatNumber(n) },
    { label: "Time saved", icon: <Clock3 size={14} />, value: a ? a.minutesSaved * 60 : undefined, fmt: (n: number) => formatDuration(n) },
    { label: "Dictations", icon: <Mic size={14} />, value: a?.totalDictations, fmt: (n: number) => formatNumber(n) },
    { label: "Day streak", icon: <Flame size={14} />, value: a?.streakDays, fmt: (n: number) => `${Math.round(n)}` },
  ];
  return (
    <div
      className="glass relative isolate flex flex-col overflow-hidden rounded-[21px]"
      style={{ padding: F[5] - F[1], clipPath: "inset(0 round 21px)" }}
      data-testid="about-numbers"
    >
      <div className="mb-[13px] flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-faint">By the numbers</span>
        <span className="rounded-full border border-[var(--border)] px-[8px] py-[2px] text-[10.5px] text-faint">30 days</span>
      </div>
      <div className="grid flex-1 grid-cols-2 grid-rows-2" style={{ gap: F[2] }}>
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.08, ease: [0.16, 1, 0.3, 1], duration: 0.5 }}
            className="group relative flex flex-col justify-between overflow-hidden rounded-[13px] border border-[var(--border)] p-[13px] transition-colors hover:border-[rgb(var(--accent-rgb)/0.45)]"
            style={{ background: "linear-gradient(160deg, rgb(var(--accent-rgb) / 0.08), transparent 60%)" }}
          >
            <span
              className="flex h-[26px] w-[26px] items-center justify-center rounded-[8px] text-brand-300 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110"
              style={{ background: "rgb(var(--accent-rgb) / 0.14)" }}
            >
              {s.icon}
            </span>
            <div>
              <div className="accent-text font-semibold tabular-nums tracking-tight" style={{ fontSize: T.lead + 5, lineHeight: 1.1 }}>
                {s.value !== undefined ? <CountUp value={s.value} format={s.fmt} reduce={reduce} /> : "–"}
              </div>
              <div className="mt-[3px] text-muted" style={{ fontSize: 12 }}>
                {s.label}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────────────────────
/** The running app's version (from the bundle), so About always matches what's installed. */
function useAppVersion(): string | null {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => {
    import("@tauri-apps/api/app")
      .then((m) => m.getVersion())
      .then(setV)
      .catch(() => setV(null));
  }, []);
  return v;
}

export function About() {
  const reduce = !!useReducedMotion();
  const version = useAppVersion();
  return (
    <div className="flex flex-col" style={{ gap: F[4] }} data-testid="about">
      {/* hero: a golden rectangle split 1.618 : 1 — words left, orb right */}
      <div className="glass-strong relative isolate overflow-hidden rounded-[34px]" style={{ height: F[8] + F[7], display: "grid", gridTemplateColumns: GOLDEN_COLS, clipPath: "inset(0 round 34px)" }}>
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(610px 233px at 78% 50%, rgb(var(--accent-rgb) / 0.16), transparent 70%)" }} />
        <div className="relative flex flex-col justify-center" style={{ paddingLeft: F[6], paddingRight: F[4] }}>
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 13 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="flex items-baseline"
            style={{ gap: F[3] }}
          >
            <span className="accent-text font-bold tracking-[-0.04em]" style={{ fontSize: T.display, lineHeight: 1 }}>
              Flo
            </span>
            <span className="font-medium text-muted" style={{ fontSize: T.lead }}>
              · Your Assistant
            </span>
          </motion.div>
          <motion.p
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12, duration: 0.6 }}
            className="mt-[13px] max-w-[377px] text-muted"
            style={{ fontSize: T.body + 1, lineHeight: PHI }}
          >
            Speak, and it's typed. Ask, and it's done. A voice assistant that lives in your notch.
          </motion.p>
          <motion.div
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.24 }}
            className="mt-[21px] flex flex-wrap items-center"
            style={{ gap: F[2] }}
          >
            {version && <span className="rounded-full border border-[var(--border-strong)] bg-[var(--glass)] px-[13px] py-[5px] text-[12px] tabular-nums text-muted" data-testid="about-version">Version {version}</span>}
            <span className="inline-flex items-center gap-1.5 rounded-full px-[13px] py-[5px] text-[12px] text-muted" style={{ background: "rgb(var(--accent-rgb) / 0.10)" }}>
              <ShieldCheck size={13} className="text-brand-300" /> Local-first. Your data stays on your {deviceWord()}.
            </span>
          </motion.div>
        </div>
        <Orb reduce={reduce} />
      </div>

      {/* maker : numbers = φ : 1 */}
      <div className="grid items-stretch" style={{ gridTemplateColumns: GOLDEN_COLS, gap: F[4] }}>
        <MakerCard reduce={reduce} />
        <Numbers reduce={reduce} />
      </div>

      <div className="flex items-center justify-center gap-[8px] text-[11.5px] text-faint">
        <span className="h-px w-[34px] bg-[var(--border-strong)]" aria-hidden />
        <span>
          Laid out on the golden ratio <span className="accent-text font-semibold">φ = 1.618</span>
        </span>
        <span className="h-px w-[34px] bg-[var(--border-strong)]" aria-hidden />
      </div>
    </div>
  );
}
