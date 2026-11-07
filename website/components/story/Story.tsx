"use client";

import Link from "next/link";
import { ArrowDown, Check, Cpu, Languages, ShieldCheck } from "lucide-react";
import { CHAPTERS, type Chapter } from "./chapters";
import { NotchContent, NotchShell, chapterIdAt, notchSize } from "./Notch";
import { Stage } from "./stages";
import { usePhase, useStory } from "./StoryContext";

/** Desktop: the one notch, pinned under the menu bar, morphing with the chapter in view. */
export function FixedNotch() {
  const { active, loop, reduce } = useStory();
  const id = chapterIdAt(active);
  const phase = active >= 0 && loop.ch === active && !reduce ? loop.phase : active >= 0 ? (reduce ? CHAPTERS[active].still : 0) : 0;
  const size = notchSize(id, phase);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] hidden justify-center md:flex" aria-hidden>
      <NotchShell size={size} reduce={reduce} glow={id === "hero" || id === "idle"}>
        {id !== "idle" && <NotchContent id={id} phase={phase} cycle={active >= 0 && loop.ch === active ? loop.cycle : 0} />}
      </NotchShell>
    </div>
  );
}

/** Slim chapter rail on the right edge (large screens). */
export function Rail() {
  const { active, goTo } = useStory();
  const show = active >= 1;
  return (
    <nav
      aria-label="Chapters"
      className={`fixed right-5 top-1/2 z-40 hidden -translate-y-1/2 flex-col items-end gap-1.5 transition-opacity duration-500 lg:flex ${show ? "opacity-100" : "pointer-events-none opacity-0"}`}
    >
      {CHAPTERS.slice(1).map((c, k) => {
        const i = k + 1;
        const on = i === active;
        return (
          <button key={c.id} onClick={() => goTo(i)} className="group flex h-5 items-center gap-2.5 rounded-full pl-2" aria-current={on ? "step" : undefined} aria-label={`${i}. ${c.label}`}>
            <span className={`text-[11.5px] transition-all duration-300 ${on ? "translate-x-0 text-brand-100 opacity-100" : "translate-x-1 text-white/50 opacity-0 group-hover:translate-x-0 group-hover:opacity-100"}`}>{c.label}</span>
            <span className={`h-[2px] rounded-full transition-all duration-300 ${on ? "w-7 bg-brand-300 shadow-[0_0_10px_rgb(61_187_255/0.8)]" : i < active ? "w-3.5 bg-brand-300/45" : "w-3.5 bg-white/20 group-hover:bg-white/50"}`} />
          </button>
        );
      })}
    </nav>
  );
}

function InlineNotch({ i }: { i: number }) {
  const c = CHAPTERS[i];
  const { phase, cycle } = usePhase(i);
  return (
    <div className="mini-screen mb-8 px-3 pb-6 md:hidden" aria-hidden>
      <NotchShell inline size={notchSize(c.id, phase, false)}>
        <NotchContent inline id={c.id} phase={phase} cycle={cycle} />
      </NotchShell>
    </div>
  );
}

function Copy({ c, i }: { c: Chapter; i: number }) {
  return (
    <div>
      <p className="eyebrow rise" style={{ ["--d" as string]: "0ms" }}>
        <span className="text-brand-300/60">{String(i).padStart(2, "0")}</span> · {c.eyebrow}
      </p>
      <h2 id={`h-${c.id}`} className="rise mt-4 text-[clamp(30px,min(3.5vw,5.8vh),52px)] font-semibold leading-[1.03] text-balance" style={{ ["--d" as string]: "60ms" }}>
        {c.title}
      </h2>
      <p className="ch-what rise mt-4 max-w-[34rem] text-[16.5px] leading-relaxed text-muted" style={{ ["--d" as string]: "120ms" }}>
        {c.what}
      </p>
      <div className="why ch-gap rise mt-5 max-w-[34rem] rounded-2xl px-4 py-3.5" style={{ ["--d" as string]: "180ms" }}>
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-brand-300">Why it matters</div>
        <p className="mt-1 text-[15px] leading-snug text-ink/90">{c.why}</p>
      </div>
      <ul className="ch-gap ch-bullets rise mt-5 flex flex-col gap-2" style={{ ["--d" as string]: "240ms" }}>
        {c.bullets.map((b) => (
          <li key={b} className="flex items-start gap-2.5 text-[14.5px] text-white/70">
            <span className="mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-300/15 text-brand-200">
              <Check size={10} strokeWidth={3} />
            </span>
            {b}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChapterView({ i }: { i: number }) {
  const c = CHAPTERS[i];
  const { isActive, phase, cycle, live } = usePhase(i);
  // leave room for the tallest state the notch reaches in this chapter, then centre the rest
  const top = Math.max(140, Math.max(...c.phases.map((_, p) => notchSize(c.id, p).h)) + 60);
  return (
    <article data-chapter={i} data-active={isActive} className="chapter px-4 py-16 md:px-0 md:py-0" aria-labelledby={`h-${c.id}`}>
      <InlineNotch i={i} />
      <span aria-hidden className="ch-num pointer-events-none absolute left-[max(2rem,calc(50%-36rem))] top-[64px] hidden font-display text-[150px] font-bold leading-none md:block">
        {String(i).padStart(2, "0")}
      </span>
      <div className="ch-grid relative mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-8 md:h-full md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] md:gap-14 md:px-8 md:pb-10" style={{ ["--top" as string]: `${top}px` }}>
        <Copy c={c} i={i} />
        <div className="rise" style={{ ["--d" as string]: "200ms" }}>
          <Stage id={c.id} phase={phase} cycle={cycle} live={live} />
        </div>
      </div>
    </article>
  );
}

function Hero({ signedIn }: { signedIn: boolean }) {
  const c = CHAPTERS[0];
  const { goTo, active } = useStory();
  return (
    <article data-chapter={0} data-active={active === 0} className="chapter hero px-4 pb-20 pt-28 md:px-0 md:pb-0 md:pt-0">
      <InlineNotch i={0} />
      <div className="mx-auto flex max-w-4xl flex-col items-center text-center md:h-full md:justify-center md:pt-10">
        <p className="hero-in eyebrow" style={{ animationDelay: "80ms" }}>
          {c.eyebrow}
        </p>
        <h1 className="hero-in mt-5 text-[clamp(44px,8vw,104px)] font-semibold leading-[0.95] tracking-[-0.045em]" style={{ animationDelay: "160ms" }}>
          Your Mac, at the
          <br />
          <span className="accent-text">speed of speech.</span>
        </h1>
        <p className="hero-in mt-6 max-w-xl text-balance text-[17px] leading-relaxed text-muted sm:text-[19px]" style={{ animationDelay: "280ms" }}>
          {c.what}
        </p>
        <div className="hero-in mt-9 flex flex-col items-center gap-3 sm:flex-row" style={{ animationDelay: "380ms" }}>
          <Link href={signedIn ? "/download" : "/signup?next=/download"} className="btn btn-primary px-7 py-3.5 text-[15.5px]" data-testid="hero-get-flo">
            Get Flo for Mac, free
          </Link>
          <button onClick={() => goTo(1)} className="btn btn-glass px-6 py-3.5 text-[15.5px]">
            Watch the notch <ArrowDown size={16} />
          </button>
        </div>
        <div className="hero-in mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[13px] text-white/50" style={{ animationDelay: "480ms" }}>
          <span className="flex items-center gap-1.5">
            <Cpu size={14} className="text-brand-300" /> On-device Whisper
          </span>
          <span className="flex items-center gap-1.5">
            <Languages size={14} className="text-brand-300" /> English, हिन्दी, ગુજરાતી
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-brand-300" /> Bring your own key, or stay offline
          </span>
        </div>
        <button onClick={() => goTo(1)} className="hero-in scroll-cue mt-14 hidden flex-col items-center gap-2 text-[12px] text-white/40 md:flex" style={{ animationDelay: "700ms" }}>
          Scroll. The notch will show you.
          <span className="relative h-10 w-px overflow-hidden bg-white/10">
            <span className="cue-dot absolute left-0 top-0 h-3 w-px bg-brand-300" />
          </span>
        </button>
      </div>
    </article>
  );
}

export function Story({ signedIn }: { signedIn: boolean }) {
  const { storyRef } = useStory();
  return (
    <div ref={storyRef} id="story" className="relative">
      <div className="relative md:sticky md:top-0 md:h-screen md:overflow-hidden">
        <div aria-hidden className="cone pointer-events-none absolute left-1/2 top-0 hidden h-[560px] w-[900px] -translate-x-1/2 md:block" />
        <Hero signedIn={signedIn} />
        {CHAPTERS.slice(1).map((c, k) => (
          <ChapterView key={c.id} i={k + 1} />
        ))}
      </div>
      {/* scroll track: one screen per chapter (desktop only) */}
      <div aria-hidden className="pointer-events-none hidden md:block" style={{ marginTop: "-100vh" }}>
        {CHAPTERS.map((c) => (
          <div key={c.id} id={`ch-${c.id}`} className="h-screen" />
        ))}
      </div>
    </div>
  );
}
