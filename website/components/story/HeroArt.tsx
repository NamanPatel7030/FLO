"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, type MotionValue } from "motion/react";
import { BatteryFull, BellRing, Check, Languages, Mail, Search, Sparkles, Wifi } from "lucide-react";
import { Logo } from "../Logo";
import { Typewriter } from "./viz";
import { useStory } from "./StoryContext";

/* Original illustrations for the hero: a macOS-style menu bar the real notch sits in, and four
   glass cards (what Flo does) wired to the notch with thin lines of travelling light. */

/** The menu bar: same height as the idle notch, so the fixed notch reads as part of the screen. */
export function Menubar() {
  return (
    <div aria-hidden className="menubar hero-in pointer-events-none absolute inset-x-0 top-0 hidden items-center justify-between px-5 md:flex" style={{ animationDelay: "40ms" }}>
      <div className="flex items-center gap-5">
        <span className="flex items-center gap-2 font-semibold text-white/90">
          <Logo size={16} /> Flo
        </span>
        <span className="hidden lg:inline">File</span>
        <span className="hidden lg:inline">Edit</span>
        <span className="hidden lg:inline">View</span>
        <span className="hidden xl:inline">Window</span>
        <span className="hidden xl:inline">Help</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5 rounded-full bg-brand-400/10 px-2 py-0.5 text-[11.5px] text-brand-100 ring-1 ring-brand-300/25">
          <span className="mini-eq">
            <i />
            <i />
            <i />
          </span>
          Flo
        </span>
        <BatteryFull size={17} className="hidden lg:block" />
        <Wifi size={15} />
        <Search size={14} className="hidden lg:block" />
        <span className="tabular-nums">Sun 8 Nov&nbsp; 9:41</span>
      </div>
    </div>
  );
}

function CardHead({ icon, label, meta }: { icon: React.ReactNode; label: string; meta?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-b from-brand-300/35 to-brand-600/20 text-brand-100 ring-1 ring-brand-200/25">{icon}</span>
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-brand-200/90">{label}</span>
      {meta && <span className="ml-auto text-[10.5px] text-white/50">{meta}</span>}
    </div>
  );
}

const HELLO = [
  { t: "नमस्ते", l: "हिन्दी · Hindi" },
  { t: "કેમ છો", l: "ગુજરાતી · Gujarati" },
  { t: "Hello", l: "English" },
];

export function LangCard() {
  const { reduce } = useStory();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setI((v) => (v + 1) % HELLO.length), 2400);
    return () => clearInterval(id);
  }, [reduce]);
  const h = HELLO[i];
  return (
    <div className="hcard p-4">
      <CardHead icon={<Languages size={13} />} label="You said" meta="auto" />
      <div className="relative mt-3 h-[38px] overflow-hidden">
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={h.t}
            className="absolute inset-0 flex items-center font-display text-[28px] font-semibold leading-none text-white"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } }}
            exit={{ opacity: 0, y: -14, transition: { duration: 0.2 } }}
          >
            {h.t}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-white/60">
        <span className="h-1.5 w-1.5 rounded-full bg-brand-300 shadow-[0_0_8px_#3dbbff]" />
        <span key={h.l} className="chip-in">
          {h.l}, in its own script
        </span>
      </div>
    </div>
  );
}

export function TodoCard() {
  return (
    <div className="hcard p-4">
      <CardHead icon={<Check size={13} strokeWidth={3} />} label="To-do caught" meta="Zoom · 11:20" />
      <div className="mt-3 flex items-start gap-2.5">
        <span className="relative mt-[2px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full ring-[1.5px] ring-brand-300/70">
          <span className="check-in absolute inset-0 flex items-center justify-center rounded-full bg-brand-400 text-[#001522]" style={{ animationDelay: "2.8s" }}>
            <Check size={11} strokeWidth={3.4} />
          </span>
        </span>
        <div className="min-w-0">
          <div className="text-[14px] font-medium leading-snug text-white">Send the Q3 deck to Priya</div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-white/55">You said “I&apos;ll send it tonight”</div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/[0.06] px-2.5 py-2 text-[11.5px] text-white/80 ring-1 ring-white/10">
        <BellRing size={13} className="bell-ring text-amber-200" />
        Reminder <span className="text-white/45">·</span> <span className="font-semibold text-brand-100">Mon 9:55</span>
      </div>
    </div>
  );
}

export function MeetCard() {
  const lines = [
    { who: "Aditi", c: "#f472b6", t: "Can we ship the build on Friday?" },
    { who: "Rahul", c: "#fbbf24", t: "QA signs off Thursday night." },
    { who: "You", c: "#66ceff", t: "Then I'll send it tonight." },
  ];
  return (
    <div className="hcard p-4">
      <CardHead
        icon={<span className="h-2 w-2 rounded-full bg-red-400 shadow-[0_0_8px_#f87171]" style={{ animation: "flo-glow 1.4s ease-in-out infinite" }} />}
        label="Weekly sync"
        meta="12:04"
      />
      <ul className="mt-3 flex flex-col gap-2">
        {lines.map((l, k) => (
          <li key={l.who} className="line-in flex gap-2 text-[12.5px] leading-snug" style={{ animationDelay: `${1.7 + k * 0.6}s` }}>
            <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ background: l.c, boxShadow: `0 0 8px ${l.c}` }} />
            <span>
              <span className="font-semibold" style={{ color: l.c }}>
                {l.who}
              </span>{" "}
              <span className="text-white/80">{l.t}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="line-in mt-3 text-[11px] text-brand-200/80" style={{ animationDelay: "3.6s" }}>
        → 1 action item added to your to-dos
      </div>
    </div>
  );
}

export function DraftCard() {
  return (
    <div className="hcard p-4">
      <CardHead icon={<Mail size={13} />} label="Drafted by Flo" meta={<Sparkles size={12} className="text-brand-200" />} />
      <div className="mt-3 text-[11.5px] text-white/50">
        To <span className="text-white/80">Priya</span> · Re: Q3 deck
      </div>
      <p className="mt-1.5 min-h-[54px] text-[13px] leading-snug text-white/90">
        <Typewriter text="Hi Priya, attaching the Q3 deck now. Happy to walk you through it tomorrow at 10." speed={30} delay={2100} />
      </p>
      <div className="mt-3 flex items-center gap-2">
        <span className="rounded-full bg-gradient-to-b from-brand-200 to-brand-400 px-3 py-1 text-[11.5px] font-semibold text-[#001522]">Insert</span>
        <span className="rounded-full bg-white/[0.08] px-3 py-1 text-[11.5px] text-white/75 ring-1 ring-white/12">Shorter</span>
        <span className="ml-auto font-mono text-[10.5px] text-white/40">⌃ hold</span>
      </div>
    </div>
  );
}

type Spot = { key: string; side: "l" | "r"; top: string; w: number; edge: string; depth: number; delay: number; float: number; el: React.ReactNode };

const SPOTS: Spot[] = [
  { key: "lang", side: "l", top: "19%", w: 224, edge: "max(28px, calc(50% - 680px))", depth: 1.2, delay: 0.9, float: 0, el: <LangCard /> },
  { key: "meet", side: "l", top: "51%", w: 250, edge: "max(20px, calc(50% - 700px))", depth: 0.7, delay: 1.05, float: 1.8, el: <MeetCard /> },
  { key: "todo", side: "r", top: "18%", w: 246, edge: "max(24px, calc(50% - 690px))", depth: 1, delay: 0.98, float: 0.9, el: <TodoCard /> },
  { key: "draft", side: "r", top: "52%", w: 258, edge: "max(20px, calc(50% - 705px))", depth: 0.8, delay: 1.12, float: 2.6, el: <DraftCard /> },
];

function Drift({ s, mx, my, children, setRef }: { s: Spot; mx: MotionValue<number>; my: MotionValue<number>; children: React.ReactNode; setRef: (el: HTMLDivElement | null) => void }) {
  const x = useTransform(mx, (v) => v * 12 * s.depth);
  const y = useTransform(my, (v) => v * 9 * s.depth);
  return (
    <motion.div ref={setRef} className="absolute" style={{ top: s.top, width: s.w, [s.side === "l" ? "left" : "right"]: s.edge, x, y }}>
      <div className="hfloat" style={{ animationDelay: `-${s.float}s` }}>
        <div className="hcard-in" style={{ animationDelay: `${s.delay}s` }}>
          {children}
        </div>
      </div>
    </motion.div>
  );
}

type Wire = { d: string; end: [number, number]; delay: number };

/** Desktop hero: the four cards drifting with the pointer, wired to the notch. */
export function HeroCards() {
  const { reduce, active } = useStory();
  const box = useRef<HTMLDivElement>(null);
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const [wires, setWires] = useState<{ w: number; h: number; list: Wire[] } | null>(null);
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const mx = useSpring(rawX, { stiffness: 60, damping: 18, mass: 0.6 });
  const my = useSpring(rawY, { stiffness: 60, damping: 18, mass: 0.6 });

  // pointer parallax (desktop hero only)
  useEffect(() => {
    if (reduce || active !== 0) return;
    const on = (e: PointerEvent) => {
      rawX.set((e.clientX / window.innerWidth - 0.5) * 2);
      rawY.set((e.clientY / window.innerHeight - 0.5) * 2);
    };
    window.addEventListener("pointermove", on, { passive: true });
    return () => window.removeEventListener("pointermove", on);
  }, [reduce, active, rawX, rawY]);

  // wire geometry from the notch to each card's resting position (layout boxes, not transforms)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (!W) return;
      const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--notch-zoom")) || 1;
      const sy = 24 * z;
      const r = (k: string) => {
        const n = refs.current[k];
        return n ? { x: n.offsetLeft, y: n.offsetTop, w: n.offsetWidth, h: n.offsetHeight } : null;
      };
      const list: Wire[] = [];
      for (const [top, bottom, side] of [
        ["lang", "meet", -1],
        ["todo", "draft", 1],
      ] as const) {
        const a = r(top);
        const b = r(bottom);
        if (!a || !b) continue;
        const sx = W / 2 + side * 104 * z;
        const tx = a.x + a.w / 2;
        const ty = a.y - 6;
        list.push({ d: `M${sx} ${sy} C${sx + side * 150} ${sy + 46} ${tx} ${sy + 26} ${tx} ${ty}`, end: [tx, ty], delay: side < 0 ? 0 : 0.5 });
        const bx = b.x + b.w / 2;
        const by = b.y - 6;
        const ay = a.y + a.h + 6;
        const mid = (ay + by) / 2;
        list.push({ d: `M${tx} ${ay} C${tx} ${mid} ${bx} ${mid} ${bx} ${by}`, end: [bx, by], delay: side < 0 ? 1.6 : 2.1 });
      }
      setWires({ w: W, h: H, list });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    Object.values(refs.current).forEach((n) => n && ro.observe(n));
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={box} aria-hidden className="pointer-events-none absolute inset-0 hidden xl:block">
      {wires && (
        <svg className="absolute inset-0" width={wires.w} height={wires.h} viewBox={`0 0 ${wires.w} ${wires.h}`}>
          <defs>
            <linearGradient id="wire-g" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#e9f8ff" />
              <stop offset="1" stopColor="#3dbbff" />
            </linearGradient>
          </defs>
          {wires.list.map((w, k) => (
            <g key={k}>
              <path d={w.d} pathLength={100} className="wire-base" style={{ animationDelay: `${0.9 + k * 0.15}s` }} />
              {!reduce && <path d={w.d} pathLength={100} className="wire-pulse" stroke="url(#wire-g)" style={{ animationDelay: `${2.4 + w.delay}s` }} />}
              <circle cx={w.end[0]} cy={w.end[1]} r={2.6} className="wire-dot" />
            </g>
          ))}
        </svg>
      )}
      {SPOTS.map((s) => (
        <Drift
          key={s.key}
          s={s}
          mx={mx}
          my={my}
          setRef={(el) => {
            refs.current[s.key] = el;
          }}
        >
          {s.el}
        </Drift>
      ))}
    </div>
  );
}

/** Phones: two of the cards, side by side, under the hero copy. */
export function HeroCardsMobile() {
  return (
    <div className="hero-in mt-10 grid w-full max-w-md grid-cols-1 gap-3 text-left min-[400px]:grid-cols-2 md:hidden" style={{ animationDelay: "650ms" }}>
      <LangCard />
      <TodoCard />
    </div>
  );
}
