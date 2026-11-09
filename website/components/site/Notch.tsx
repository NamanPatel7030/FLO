"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CloudSun, ListChecks, Pause, Play, StickyNote, Timer, Volume2 } from "lucide-react";
import { PALETTES, SIZES, SOUNDS, STYLES } from "./data";
import { playSound } from "./sound";
import { ClaudeMark, EASE, Heading, Reveal, Section, Wave } from "./ui";

/* ── 12 Widgets: a mosaic of live mini widgets ─────────────────────────────────────────── */

function useNow() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function zoneTime(now: Date | null, tz: string) {
  if (!now) return "--:--";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(now);
}

export function WidgetsSection() {
  const now = useNow();
  const [playing, setPlaying] = useState(true);
  return (
    <Section id="widgets">
      <Heading
        tag="12 · Widgets"
        title="Glance up. It's all there."
        accent="all there."
        lead="Open the notch for live widgets. The things you check fifty times a day are one glance away, and gone the moment you move on."
      />
      <div className="mt-14 grid auto-rows-[150px] grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <Reveal className="g col-span-2 row-span-2 flex flex-col overflow-hidden rounded-[30px] p-5">
          <div className="relative flex-1 overflow-hidden rounded-[22px] bg-gradient-to-br from-[#ffb38a] via-[#ff7eb0] to-[#7a6cff]">
            <div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_30%_30%,rgba(255,255,255,0.5),transparent_70%)]" />
            <span className="absolute bottom-4 left-4 text-[13px] font-semibold text-white/90">Now Playing</span>
            {playing && (
              <span className="absolute right-4 top-4">
                <Wave bars={5} />
              </span>
            )}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[16px] font-semibold ink">lofi beats to code to</p>
              <p className="text-[13px] mut">YouTube · works with any app</p>
            </div>
            <button type="button" onClick={() => setPlaying((v) => !v)} className="grid h-11 w-11 place-items-center rounded-full bg-[#0b1220] text-white" aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-black/[0.07]">
            <div className="np-progress h-full w-full origin-left rounded-full bg-[#0b1220]" style={{ animationPlayState: playing ? "running" : "paused" }} />
          </div>
        </Reveal>
        <Reveal delay={0.04} className="g col-span-2 rounded-[30px] p-5">
          <p className="text-[12px] font-semibold uppercase tracking-wider fnt">Clock & time zones</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              ["Mumbai", "Asia/Kolkata"],
              ["London", "Europe/London"],
              ["San Francisco", "America/Los_Angeles"],
            ].map(([c, tz]) => (
              <div key={c}>
                <p className="text-[28px] font-semibold tabular-nums tracking-tight ink" suppressHydrationWarning>
                  {zoneTime(now, tz)}
                </p>
                <p className="text-[12px] mut">{c}</p>
              </div>
            ))}
          </div>
        </Reveal>
        <Reveal delay={0.08} className="g flex flex-col justify-between rounded-[30px] p-5">
          <CloudSun size={26} className="text-[#ffb020]" />
          <div>
            <p className="text-[30px] font-semibold leading-none ink">24°</p>
            <p className="mt-1 text-[12.5px] mut">Sunny · Mumbai</p>
          </div>
        </Reveal>
        <Reveal delay={0.1} className="g flex flex-col justify-between rounded-[30px] p-5">
          <span className="flex items-center gap-2 text-[12px] font-semibold mut">
            <ClaudeMark size={16} /> Claude
          </span>
          <div>
            <p className="text-[30px] font-semibold leading-none ink">3</p>
            <p className="mt-1 text-[12.5px] mut">sessions · 1 waiting</p>
          </div>
        </Reveal>
        <Reveal delay={0.12} className="g rounded-[30px] p-5">
          <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider fnt">
            <ListChecks size={14} /> Today
          </p>
          <ul className="mt-2.5 space-y-1.5 text-[13px] ink-2">
            <li>• Send Acme the copy</li>
            <li>• Review Priya&apos;s PR</li>
            <li className="fnt line-through">• Book the dentist</li>
          </ul>
        </Reveal>
        <Reveal delay={0.14} className="g flex items-center gap-4 rounded-[30px] p-5">
          <svg viewBox="0 0 40 40" className="h-16 w-16 -rotate-90" aria-hidden>
            <circle cx="20" cy="20" r="16" fill="none" stroke="rgb(20 40 80 / 0.08)" strokeWidth="4" />
            <circle cx="20" cy="20" r="16" fill="none" stroke="url(#pg)" strokeWidth="4" strokeLinecap="round" strokeDasharray="100.5" strokeDashoffset="28" />
            <defs>
              <linearGradient id="pg">
                <stop offset="0" stopColor="#2f8cff" />
                <stop offset="1" stopColor="#ff7eb0" />
              </linearGradient>
            </defs>
          </svg>
          <div>
            <p className="text-[20px] font-semibold tabular-nums ink">18:24</p>
            <p className="text-[12px] mut">Pomodoro</p>
          </div>
        </Reveal>
        <Reveal delay={0.16} className="g flex flex-col justify-between rounded-[30px] p-5">
          <Timer size={22} className="text-[#7a6cff]" />
          <div>
            <p className="font-mono text-[22px] font-semibold tabular-nums ink">02:41.6</p>
            <p className="text-[12px] mut">Stopwatch</p>
          </div>
        </Reveal>
        <Reveal delay={0.18} className="g flex flex-col justify-between rounded-[30px] bg-[#fff8d6]/60 p-5">
          <StickyNote size={22} className="text-[#e0a800]" />
          <p className="serif-i text-[20px] leading-tight ink">Call mom after the standup</p>
        </Reveal>
      </div>
    </Section>
  );
}

/* ── 13 Make it yours: pick colour, style, size and sound; the notch follows ──────────── */

function Viz({ style, color }: { style: string; color: string }) {
  if (style === "Equalizer")
    return (
      <span className="vwave h-[22px]" data-on style={{ ["--wc" as string]: color }}>
        {Array.from({ length: 9 }, (_, k) => (
          <i key={k} style={{ animationDelay: `${-k * 0.1}s`, width: 4 }} />
        ))}
      </span>
    );
  if (style === "Neon")
    return <span className="block h-[3px] w-28 rounded-full" style={{ background: color, boxShadow: `0 0 12px ${color}, 0 0 24px ${color}` }} />;
  if (style === "Helix")
    return (
      <span className="flex items-center gap-1.5">
        {Array.from({ length: 9 }, (_, k) => (
          <motion.i key={k} className="block h-2 w-2 rounded-full" style={{ background: color }} animate={{ y: [-6, 6, -6] }} transition={{ duration: 1.2, repeat: Infinity, delay: k * 0.1, ease: "easeInOut" }} />
        ))}
      </span>
    );
  if (style === "Sparkle")
    return (
      <span className="flex items-center gap-2">
        {Array.from({ length: 5 }, (_, k) => (
          <motion.span key={k} style={{ color }} animate={{ scale: [0.6, 1.2, 0.6], opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.4, repeat: Infinity, delay: k * 0.2 }}>
            ✦
          </motion.span>
        ))}
      </span>
    );
  // Ribbon
  return (
    <svg viewBox="0 0 120 24" className="h-6 w-32" aria-hidden>
      <motion.path
        d="M0 12 Q 15 0 30 12 T 60 12 T 90 12 T 120 12"
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        animate={{ d: ["M0 12 Q 15 0 30 12 T 60 12 T 90 12 T 120 12", "M0 12 Q 15 24 30 12 T 60 12 T 90 12 T 120 12", "M0 12 Q 15 0 30 12 T 60 12 T 90 12 T 120 12"] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      />
    </svg>
  );
}

const WIDTH = { Small: 220, Big: 280, Bigger: 330, Biggest: 380 } as const;

export function CustomSection() {
  const [pal, setPal] = useState(0);
  const [style, setStyle] = useState<string>(STYLES[0]);
  const [size, setSize] = useState<(typeof SIZES)[number]>("Big");
  const p = PALETTES[pal];
  const color = pal === 5 ? "#ff7eb0" : p.a;
  return (
    <Section id="custom">
      <div className="g relative overflow-hidden rounded-[40px] p-6 sm:p-10 md:p-14">
        <motion.div className="absolute inset-0 -z-10" animate={{ background: `radial-gradient(70% 80% at 50% 0%, ${p.hi}, transparent 70%)` }} transition={{ duration: 0.6 }} />
        <Heading tag="13 · Make it yours" title="It's your notch. Style it." accent="Style it." lead="15 animations, four sizes, a sound and a colour. You'll see it dozens of times a day. It should feel like yours, not ours." />
        <div className="mt-10 flex justify-center">
          <motion.div className="hw-notch flex h-16 items-center justify-center rounded-b-[26px] rounded-t-[10px]" animate={{ width: WIDTH[size] }} transition={{ duration: 0.45, ease: EASE }}>
            <AnimatePresence mode="wait">
              <motion.span key={style} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                <Viz style={style} color={color} />
              </motion.span>
            </AnimatePresence>
          </motion.div>
        </div>
        <div className="mx-auto mt-10 grid max-w-3xl gap-6 md:grid-cols-2">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wider fnt">Colour</p>
            <div className="mt-3 flex flex-wrap gap-2.5" role="radiogroup" aria-label="Accent colour">
              {PALETTES.map((x, k) => (
                <button
                  key={x.name}
                  role="radio"
                  aria-checked={k === pal}
                  aria-label={x.name}
                  onClick={() => setPal(k)}
                  className={`h-10 w-10 rounded-full ring-offset-2 ring-offset-white/60 transition ${k === pal ? "scale-110 ring-2 ring-[#0b1220]" : "ring-1 ring-black/10 hover:scale-105"}`}
                  style={{ background: x.swatch }}
                />
              ))}
            </div>
            <p className="mt-6 text-[12px] font-semibold uppercase tracking-wider fnt">Size</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SIZES.map((s) => (
                <button key={s} type="button" className="chip2" aria-pressed={s === size} onClick={() => setSize(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wider fnt">Animation · 5 of 15</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {STYLES.slice(0, 5).map((s) => (
                <button key={s} type="button" className="chip2" aria-pressed={s === style} onClick={() => setStyle(s)}>
                  {s}
                </button>
              ))}
            </div>
            <p className="mt-6 text-[12px] font-semibold uppercase tracking-wider fnt">Sound · tap to hear</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SOUNDS.map((s, k) => (
                <button key={s} type="button" className="chip2" onClick={() => playSound(k)}>
                  <Volume2 size={14} /> {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
