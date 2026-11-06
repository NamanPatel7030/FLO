"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  AudioLines,
  BellRing,
  BookText,
  Bot,
  BrainCircuit,
  Clock,
  CloudOff,
  CreditCard,
  Gauge,
  KeyRound,
  Lock,
  MessageSquare,
  Minus,
  Network,
  Plus,
  ShieldCheck,
  SpellCheck,
  Sparkles,
  X,
} from "lucide-react";
import { TalkToFlo } from "./TalkToFlo";
import { Playground } from "./Playground";
import { VIGNETTES } from "./Vignettes";
import { useSceneDock, type Scene } from "./scene";
import { CountUp, CursorGlow, EASE_OUT, Magnetic, Reveal, ScrollProgress, Stagger, StaggerItem, TiltCard, useParallax } from "./motion/primitives";

/** A real app screenshot in a tasteful window frame. */
function Shot({ src, alt, bar = true, className = "" }: { src: string; alt: string; bar?: boolean; className?: string }) {
  return (
    <figure className={`shot ${className}`}>
      {bar && (
        <div className="shot-bar" aria-hidden>
          <span className="shot-dot" style={{ background: "#ff5f57" }} />
          <span className="shot-dot" style={{ background: "#febc2e" }} />
          <span className="shot-dot" style={{ background: "#28c840" }} />
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading="lazy" />
    </figure>
  );
}

const MARQUEE = ["Slack", "Gmail", "VS Code", "Notion", "Cursor", "Chrome", "Linear", "Figma", "Terminal", "WhatsApp", "Docs", "Claude"];

function AppsMarquee() {
  return (
    <div className="relative overflow-hidden py-2" aria-hidden>
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-black to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-black to-transparent" />
      <div className="marquee-track gap-10">
        {[...MARQUEE, ...MARQUEE].map((a, i) => (
          <span key={i} className="whitespace-nowrap text-[15px] font-medium text-faint">
            {a}
          </span>
        ))}
      </div>
    </div>
  );
}

const PAINS = [
  { icon: Clock, title: "Typing is slow", body: "You think at 150 words a minute and type at 40. Every email, prompt and Slack reply waits on your fingers." },
  { icon: Activity, title: "Context switching", body: "Copy, open ChatGPT, paste, wait, copy back. Five steps to ask one question about what is already on your screen." },
  { icon: CloudOff, title: "Your voice goes to a server", body: "Most dictation apps stream every word you say to the cloud and keep your history on their servers." },
  { icon: CreditCard, title: "Subscriptions and word caps", body: "Pay monthly, then hit a weekly word limit right when you are in flow." },
  { icon: BellRing, title: "Things fall through the cracks", body: "A review request, an invoice, three action items from a meeting. Nobody writes them down." },
  { icon: Bot, title: "Agent sessions you forget", body: "Claude Code finished ten minutes ago and is waiting for you. You only notice when you switch windows." },
];

const FEATURES: { scene: Exclude<Scene, "idle">; kicker: string; title: string; body: string; vignette: keyof typeof VIGNETTES }[] = [
  { scene: "dictation", kicker: "Dictation", title: "Speak. It types.", body: "Hold a key and talk. Clean, punctuated text lands exactly where your cursor is — in any app, on device, no word caps.", vignette: "dictation" },
  { scene: "assistant", kicker: "Assistant", title: "Ask about your screen.", body: "Hold fn and ask. Go deeper reads the window you are on. Search the web brings real sources. Selected text gets rewritten in place.", vignette: "assistant" },
  { scene: "meeting", kicker: "Meetings", title: "Every meeting, remembered.", body: "A live transcript as people talk, a rolling summary, and action items that quietly become to-dos when the call ends.", vignette: "meeting" },
  { scene: "agent", kicker: "Agents", title: "Your agents, in view.", body: "Claude Code, Codex and Cursor sessions live in your notch. Hover for status, click to jump straight back to the window.", vignette: "agent" },
  { scene: "todos", kicker: "To-dos", title: "Nothing slips.", body: "Flo notices what needs you — an unanswered ask, a deadline, a promised follow-up — and adds it to your list, on device.", vignette: "todo" },
];

const EXTRA = [
  { icon: MessageSquare, title: "Slack, handled", body: "Unanswered DMs and mentions become to-dos. Say a reply and confirm before anything is sent." },
  { icon: BookText, title: "Your context, your rules", body: "Upload notes and a system prompt. Flo sends only the few relevant lines, never the whole library." },
  { icon: SpellCheck, title: "Learns your spellings", body: "Fix a word once and Flo asks to remember it. Names and jargon come out right next time." },
  { icon: Gauge, title: "Analytics and typing test", body: "Words, speed and time saved, measured against your real typing speed." },
  { icon: KeyRound, title: "Your keys or fully local", body: "Claude, OpenAI, Gemini, Groq, MiniMax or Qwen keys, or run everything with Ollama." },
  { icon: Sparkles, title: "Lives in the notch", body: "A calm island in your MacBook notch, bottom-right on Windows and Linux. Out of the way until you need it." },
];

type Cell = "yes" | "no" | "partial" | string;
const COMPARE: { row: string; flo: Cell; wispr: Cell; lemon: Cell }[] = [
  { row: "On-device speech to text", flo: "yes", wispr: "no", lemon: "partial" },
  { row: "Bring your own AI key", flo: "yes", wispr: "no", lemon: "no" },
  { row: "Fully local mode (Ollama)", flo: "yes", wispr: "no", lemon: "no" },
  { row: "Assistant that reads your screen", flo: "yes", wispr: "partial", lemon: "yes" },
  { row: "Live meeting notes", flo: "yes", wispr: "yes", lemon: "yes" },
  { row: "Claude Code / Codex / Cursor tray", flo: "yes", wispr: "no", lemon: "no" },
  { row: "Slack to-dos with confirmed send", flo: "yes", wispr: "partial", lemon: "partial" },
  { row: "History and memory stay on device", flo: "yes", wispr: "no", lemon: "no" },
  { row: "No word or task caps", flo: "yes", wispr: "no", lemon: "no" },
  { row: "Windows and Linux", flo: "Mac, Win, Linux", wispr: "Mac, Windows", lemon: "Mac" },
  { row: "Price", flo: "Free, your keys", wispr: "Subscription", lemon: "Free, then paid" },
];

const FAQ = [
  { q: "Does my voice leave my Mac?", a: "Not by default. Speech is transcribed on device with Whisper. If you choose a cloud speech or AI provider, Flo sends text straight to that provider with your own key. Every request appears in the network log." },
  { q: "Why do I need an account?", a: "Only to download Flo and sign in on your devices. Your dictation, notes, to-dos and keys never touch our servers." },
  { q: "Which AI models can I use?", a: "Claude, OpenAI, Gemini, Groq, OpenRouter, MiniMax, Qwen and Ollama Cloud with your own key, or local models through Ollama and LM Studio." },
  { q: "Does it work on Windows and Linux?", a: "Yes. The island sits in the bottom-right corner. Hold Right Ctrl to dictate and Right Alt for the assistant." },
  { q: "How is this different from Wispr Flow or Lemon?", a: "Flo combines dictation, a screen-aware assistant, meeting notes, to-dos and an agent tray in one app, keeps everything on your device and lets you choose the AI you pay for." },
  { q: "What does it cost?", a: "Flo is free. You pay your AI provider directly for what you use, or nothing at all with local models." },
];

function Mark({ v }: { v: Cell }) {
  if (v === "yes")
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-300/15 text-brand-200" aria-label="Yes">
        <DrawCheck />
      </span>
    );
  if (v === "no")
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/5 text-white/35" aria-label="No">
        <X size={13} strokeWidth={2.5} />
      </span>
    );
  if (v === "partial")
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-300/10 text-amber-200/80" aria-label="Partly">
        <Minus size={13} strokeWidth={3} />
      </span>
    );
  return <span className="text-[13px] text-muted">{v}</span>;
}

function DrawCheck() {
  const reduce = useReducedMotion();
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <motion.path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, ease: "easeInOut" }}
      />
    </svg>
  );
}

function Words({ text, className }: { text: string; className?: string }) {
  const reduce = useReducedMotion();
  const words = text.split(" ");
  return (
    <span className={className}>
      {words.map((w, i) => (
        <span key={i} className="inline-block overflow-hidden align-bottom">
          <motion.span
            className="inline-block"
            initial={reduce ? { opacity: 0 } : { y: "110%", opacity: 0, filter: "blur(8px)" }}
            animate={{ y: "0%", opacity: 1, filter: "blur(0px)" }}
            transition={{ delay: 0.15 + i * 0.07, duration: 0.7, ease: EASE_OUT }}
          >
            {w}
            {i < words.length - 1 ? " " : ""}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

function FeatureRow({ f, i }: { f: (typeof FEATURES)[number]; i: number }) {
  const ref = useSceneDock<HTMLDivElement>(f.scene);
  const Vig = VIGNETTES[f.vignette];
  const flip = i % 2 === 1;
  return (
    <div ref={ref} className="grid items-center gap-8 py-16 sm:py-20 lg:grid-cols-2 lg:gap-16" data-testid={`feature-${f.scene}`}>
      <motion.div
        className={flip ? "lg:order-2" : ""}
        initial={{ opacity: 0, x: flip ? 40 : -40 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.7, ease: EASE_OUT }}
      >
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-[44px] font-semibold leading-none text-brand-500/30 sm:text-[64px]">{String(i + 1).padStart(2, "0")}</span>
          <p className="eyebrow">{f.kicker}</p>
        </div>
        <h3 className="mt-4 text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-[1.05]">{f.title}</h3>
        <p className="mt-4 max-w-md text-[16.5px] leading-relaxed text-muted">{f.body}</p>
      </motion.div>
      <motion.div
        className={flip ? "lg:order-1" : ""}
        initial={{ opacity: 0, y: 30, scale: 0.97 }}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.8, ease: EASE_OUT }}
      >
        <div className="glass rounded-[28px] p-5">
          <Vig />
        </div>
      </motion.div>
    </div>
  );
}

export function Landing({ signedIn }: { signedIn: boolean }) {
  const heroDock = useSceneDock<HTMLElement>("idle");
  const painDock = useSceneDock<HTMLElement>("dictation");
  const compareDock = useSceneDock<HTMLElement>("agent");
  const heroShot = useParallax(50);
  return (
    <>
      <ScrollProgress />
      <CursorGlow />
      <main>
        {/* ── HERO ─────────────────────────────────────────── */}
        <section ref={heroDock} className="relative px-5 pb-20 pt-28 sm:pt-36" data-testid="hero">
          <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <motion.div
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-[12.5px] text-muted"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-75" />
                  <span className="relative h-1.5 w-1.5 rounded-full bg-brand-400" />
                </span>
                Look up — that notch is Flo, live
              </motion.div>
              <h1 className="mt-5 text-[46px] font-semibold leading-[0.98] tracking-[-0.035em] sm:text-[84px]">
                <Words text="Speak." />
                <br />
                <span className="accent-text">
                  <Words text="Flo" />
                </span>{" "}
                <Words text="does" /> <Words text="the" /> <Words text="rest." />
              </h1>
              <Reveal mount delay={0.55} className="mt-6 max-w-lg text-[18px] leading-relaxed text-muted sm:text-[20px]">
                Private voice dictation, a screen-aware assistant, live meeting notes and to-dos — all living in your notch. Try it right here, no download.
              </Reveal>
              <Reveal mount delay={0.7} className="mt-8 flex flex-wrap items-center gap-3">
                <Magnetic>
                  <Link href={signedIn ? "/download" : "/signup?next=/download"} className="btn btn-primary px-7 py-3.5 text-[15px]" data-testid="hero-cta">
                    Download Flo for free
                  </Link>
                </Magnetic>
                <span className="text-[13px] text-faint">macOS 13+ · Windows &amp; Linux beta · No card</span>
              </Reveal>
            </div>
            <Reveal mount delay={0.4}>
              <TalkToFlo />
            </Reveal>
          </div>

          {/* real product shot, floating with the live notch above it */}
          <Reveal mount delay={0.85} className="mx-auto mt-20 max-w-5xl">
            <motion.div ref={heroShot.ref} style={{ y: heroShot.y }} className="relative">
              <div aria-hidden className="absolute -inset-x-10 -top-10 bottom-0 -z-10 rounded-[40px] bg-brand-500/[0.07] blur-3xl" />
              <Shot src="/shots/home-dark.png" alt="The Flo dashboard: dictation, assistant, meeting notes and to-dos" />
              <div className="absolute -top-6 left-1/2 w-[62%] -translate-x-1/2 overflow-hidden rounded-2xl border border-brand-300/15 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] sm:-top-9 sm:w-[46%]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/shots/notch-working.png" alt="The Flo notch transcribing live" loading="lazy" className="block w-full" />
              </div>
            </motion.div>
          </Reveal>
        </section>

        {/* ── APPS MARQUEE ─────────────────────────────────── */}
        <section className="px-5 py-10">
          <p className="mx-auto mb-5 max-w-5xl text-center text-[12.5px] uppercase tracking-[0.18em] text-faint">Types where your cursor is</p>
          <AppsMarquee />
        </section>

        {/* ── STAT STRIP ───────────────────────────────────── */}
        <section className="px-5 py-8">
          <Stagger className="mx-auto grid max-w-5xl grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { n: 3, suffix: "×", l: "faster than typing" },
              { n: 100, suffix: "%", l: "on-device option" },
              { n: 0, suffix: "", l: "word caps" },
              { n: 8, suffix: "+", l: "AI providers" },
            ].map((s) => (
              <StaggerItem key={s.l} className="glass rounded-2xl p-5 text-center">
                <div className="text-3xl font-semibold accent-text sm:text-4xl">
                  <CountUp to={s.n} suffix={s.suffix} />
                </div>
                <div className="mt-1 text-[13px] text-muted">{s.l}</div>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        {/* ── PAIN ─────────────────────────────────────────── */}
        <section ref={painDock} className="px-5 py-24" id="pain" data-testid="pain">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">The problem</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[42px] sm:leading-[1.1]">Your ideas move faster than your keyboard</h2>
            <p className="mt-4 text-[17px] leading-relaxed text-muted">And the tools that promise to help either send everything to the cloud or charge you by the word.</p>
          </Reveal>
          <Stagger className="mx-auto mt-14 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PAINS.map((p) => (
              <StaggerItem key={p.title}>
                <TiltCard className="glass h-full rounded-3xl p-6">
                  <p.icon size={20} className="text-brand-300" />
                  <h3 className="mt-4 text-[17px] font-semibold">{p.title}</h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{p.body}</p>
                </TiltCard>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        {/* ── FEATURE SEQUENCE (docked to the notch spine) ─── */}
        <section className="px-5 py-10" id="features" data-testid="features">
          <Reveal className="mx-auto max-w-3xl text-center">
            <p className="eyebrow">One key, everything</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[46px] sm:leading-[1.05]">Watch the notch as you scroll.</h2>
            <p className="mt-4 text-[17px] leading-relaxed text-muted">It performs each thing Flo does, live, while you read about it.</p>
          </Reveal>
          <div className="mx-auto max-w-5xl">
            {FEATURES.map((f, i) => (
              <FeatureRow key={f.scene} f={f} i={i} />
            ))}
          </div>
        </section>

        {/* ── BENTO: THE REAL APP ──────────────────────────── */}
        <section className="px-5 py-24" id="app">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">The app</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[46px] sm:leading-[1.05]">Not a mockup. The real thing.</h2>
            <p className="mt-4 text-[17px] leading-relaxed text-muted">Every pixel here is Flo running. Dark or light, your accent, your notch.</p>
          </Reveal>
          <Stagger className="mx-auto mt-14 grid max-w-6xl auto-rows-[200px] grid-cols-2 gap-4 lg:grid-cols-4">
            <StaggerItem className="col-span-2 row-span-2">
              <div className="group relative h-full overflow-hidden rounded-3xl">
                <Shot src="/shots/home-dark.png" alt="Flo dashboard in dark mode" className="h-full [&_img]:h-full [&_img]:object-cover [&_img]:object-left-top" />
                <span className="pointer-events-none absolute bottom-4 left-5 text-[13px] font-medium text-ink/90">Your day, at a glance</span>
              </div>
            </StaggerItem>
            <StaggerItem className="col-span-2 row-span-1">
              <div className="relative h-full overflow-hidden rounded-3xl">
                <Shot src="/shots/home-light.png" alt="Flo dashboard in a light blue theme" bar={false} className="h-full [&_img]:h-full [&_img]:object-cover [&_img]:object-left-top" />
                <span className="pointer-events-none absolute bottom-4 left-5 text-[13px] font-medium text-[#0c1826]">Light theme, your accent</span>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="relative h-full overflow-hidden rounded-3xl">
                <Shot src="/shots/analytics-dark.png" alt="Analytics: words, speed and time saved" bar={false} className="h-full [&_img]:h-full [&_img]:object-cover [&_img]:object-left-top" />
                <span className="pointer-events-none absolute bottom-3 left-4 text-[12px] font-medium text-ink/90">Time saved</span>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="relative h-full overflow-hidden rounded-3xl">
                <Shot src="/shots/notes-dark.png" alt="Live meeting notes with transcript and summary" bar={false} className="h-full [&_img]:h-full [&_img]:object-cover [&_img]:object-left-top" />
                <span className="pointer-events-none absolute bottom-3 left-4 text-[12px] font-medium text-ink/90">Meeting notes</span>
              </div>
            </StaggerItem>
            <StaggerItem className="col-span-2">
              <div className="relative flex h-full flex-col justify-between overflow-hidden rounded-3xl glass p-5">
                <div>
                  <p className="eyebrow">Make it yours</p>
                  <h3 className="mt-2 text-[18px] font-semibold">Six notch styles. Any accent.</h3>
                </div>
                <Shot src="/shots/appearance-dark.png" alt="Appearance settings: theme, accent and notch animations" bar={false} className="mt-3 [&_img]:max-h-[120px] [&_img]:object-cover [&_img]:object-left-top" />
              </div>
            </StaggerItem>
          </Stagger>
        </section>

        {/* ── PLAYGROUND ───────────────────────────────────── */}
        <section className="px-5 py-24" id="playground" data-testid="playground">
          <Reveal className="mx-auto mb-12 max-w-2xl text-center">
            <p className="eyebrow">Playground</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[42px] sm:leading-[1.1]">Tell Flo what you want. Watch it land.</h2>
            <p className="mt-4 text-[17px] leading-relaxed text-muted">Pick an app and a tone, then run it. This is exactly how it feels on your Mac.</p>
          </Reveal>
          <Reveal>
            <Playground />
          </Reveal>
        </section>

        {/* ── MORE FEATURES ────────────────────────────────── */}
        <section className="px-5 py-24">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">And more</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[42px] sm:leading-[1.1]">
              Everything else it <span className="accent-text">quietly handles</span>
            </h2>
          </Reveal>
          <Stagger className="mx-auto mt-14 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {EXTRA.map((f) => (
              <StaggerItem key={f.title}>
                <TiltCard className="glass group h-full rounded-3xl p-6">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-300/10 text-brand-200 ring-1 ring-brand-300/20">
                    <f.icon size={19} />
                  </span>
                  <h3 className="mt-5 text-[17px] font-semibold">{f.title}</h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{f.body}</p>
                </TiltCard>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        {/* ── COMPARE ──────────────────────────────────────── */}
        <section ref={compareDock} className="px-5 py-24" id="compare" data-testid="compare">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">Compare</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[42px] sm:leading-[1.1]">The alternative to Wispr Flow and Lemon</h2>
            <p className="mt-4 text-[17px] leading-relaxed text-muted">Everything they do, plus the things they don&apos;t, without sending your life to someone else&apos;s server.</p>
          </Reveal>
          <Reveal className="relative mx-auto mt-14 max-w-5xl">
            <div aria-hidden className="absolute inset-y-6 left-1/2 w-[33%] -translate-x-[6%] rounded-3xl bg-brand-500/[0.06] blur-xl" />
            <div className="glass relative overflow-x-auto rounded-3xl">
              <table className="w-full min-w-[620px] text-left text-[14px]" data-testid="compare-table">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="px-5 py-4 font-medium text-faint" scope="col">
                      <span className="sr-only">Feature</span>
                    </th>
                    <th className="px-5 py-4" scope="col">
                      <span className="inline-flex items-center gap-2 font-semibold text-ink">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/logo.svg" alt="" className="h-5 w-5 rounded-md" /> Flo
                      </span>
                    </th>
                    <th className="px-5 py-4 font-medium text-muted" scope="col">Wispr Flow</th>
                    <th className="px-5 py-4 font-medium text-muted" scope="col">Lemon</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE.map((r, i) => (
                    <motion.tr
                      key={r.row}
                      className="border-b border-white/5 last:border-0"
                      initial={{ opacity: 0, x: -14 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true, margin: "-40px" }}
                      transition={{ delay: i * 0.05, duration: 0.5 }}
                    >
                      <th scope="row" className="px-5 py-3.5 font-normal text-muted">{r.row}</th>
                      <td className="bg-brand-300/[0.05] px-5 py-3.5"><Mark v={r.flo} /></td>
                      <td className="px-5 py-3.5"><Mark v={r.wispr} /></td>
                      <td className="px-5 py-3.5"><Mark v={r.lemon} /></td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
          <p className="mx-auto mt-4 max-w-5xl px-1 text-[12px] text-faint">Based on our review of the public Wispr Flow and Lemon Mac apps in November 2026. Products change; tell us if something is out of date.</p>
        </section>

        {/* ── PRIVACY ──────────────────────────────────────── */}
        <section className="px-5 py-24" id="privacy" data-testid="privacy">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">Privacy</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[42px] sm:leading-[1.1]">
              Private by design, <span className="accent-text">not by promise</span>
            </h2>
          </Reveal>
          <Reveal className="mx-auto mt-14 max-w-5xl">
            <PrivacyDiagram />
          </Reveal>
          <Stagger className="mx-auto mt-4 grid max-w-5xl gap-4 sm:grid-cols-3">
            {[
              { icon: ShieldCheck, t: "Egress guard", b: "Every network call goes through one gate with an allow list. Unknown hosts are blocked, always." },
              { icon: Network, t: "See every request", b: "The network log shows each call: which host, why, and how many tokens it used." },
              { icon: Lock, t: "Encrypted on disk", b: "History, notes and to-dos live in an encrypted database. The key lives in your Keychain." },
            ].map((p) => (
              <StaggerItem key={p.t}>
                <div className="glass h-full rounded-3xl p-6">
                  <p.icon size={20} className="text-brand-300" />
                  <h3 className="mt-4 text-[17px] font-semibold">{p.t}</h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{p.b}</p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </section>

        {/* ── MAKER ────────────────────────────────────────── */}
        <section className="px-5 py-24" id="maker">
          <Reveal>
            <div className="glass-strong mx-auto flex max-w-4xl flex-col items-center gap-8 rounded-[32px] p-8 sm:flex-row sm:p-10">
              <div className="relative shrink-0">
                <motion.div className="absolute -inset-1 rounded-full accent-bg opacity-70 blur-[2px]" animate={{ rotate: 360 }} transition={{ duration: 18, repeat: Infinity, ease: "linear" }} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/naman.png" alt="Naman Gundaniya" className="relative h-32 w-32 rounded-full object-cover object-top" style={{ background: "radial-gradient(circle at 40% 30%, #3dbbff, #083a57 70%)" }} />
              </div>
              <div className="text-center sm:text-left">
                <p className="eyebrow">Made by</p>
                <h3 className="mt-2 text-2xl font-semibold">Naman Gundaniya</h3>
                <p className="text-muted">Forward Deployed Engineer</p>
                <blockquote className="mt-5 text-[20px] leading-snug text-ink sm:text-[22px]">“I&apos;m the human. AI is my leverage. Together, we build anything.”</blockquote>
                <a href="https://hellonaman.com" target="_blank" rel="noreferrer" className="mt-4 inline-block text-[14px] text-brand-300 hover:text-brand-200">
                  hellonaman.com
                </a>
              </div>
            </div>
          </Reveal>
        </section>

        {/* ── FAQ ──────────────────────────────────────────── */}
        <section className="px-5 py-24" id="faq" data-testid="faq">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">FAQ</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[42px] sm:leading-[1.1]">Questions, answered</h2>
          </Reveal>
          <div className="mx-auto mt-12 flex max-w-3xl flex-col gap-3">
            {FAQ.map((f, i) => (
              <Faq key={f.q} q={f.q} a={f.a} i={i} />
            ))}
          </div>
        </section>

        {/* ── CTA ──────────────────────────────────────────── */}
        <section className="px-5 pb-28 pt-8">
          <Reveal>
            <div className="glass-strong relative mx-auto max-w-4xl overflow-hidden rounded-[32px] px-6 py-16 text-center">
              <motion.div
                aria-hidden
                className="absolute -top-28 left-1/2 h-56 w-[70%] -translate-x-1/2 rounded-full bg-brand-500/25 blur-3xl"
                animate={{ opacity: [0.5, 1, 0.5], scale: [1, 1.1, 1] }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              />
              <AudioLines className="relative mx-auto text-brand-300" />
              <h2 className="relative mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Start speaking instead of typing</h2>
              <p className="relative mx-auto mt-3 max-w-xl text-muted">Free to download. Bring your own AI or stay fully local.</p>
              <div className="relative mt-8 flex justify-center">
                <Magnetic>
                  <Link href={signedIn ? "/download" : "/signup?next=/download"} className="btn btn-primary px-8 py-4 text-[16px]">
                    Get Flo for free
                  </Link>
                </Magnetic>
              </div>
            </div>
          </Reveal>
        </section>
      </main>
    </>
  );
}

function Faq({ q, a, i }: { q: string; a: string; i: number }) {
  const [open, setOpen] = useState(false);
  return (
    <motion.div
      className="glass overflow-hidden rounded-2xl"
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ delay: i * 0.05 }}
    >
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-[16px] font-medium" aria-expanded={open}>
        {q}
        <motion.span animate={{ rotate: open ? 45 : 0 }} transition={{ duration: 0.2 }} className="text-brand-300">
          <Plus size={18} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE_OUT }}>
            <p className="px-5 pb-5 text-[15px] leading-relaxed text-muted">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function PrivacyDiagram() {
  const reduce = useReducedMotion();
  return (
    <div className="glass grid items-center gap-4 rounded-3xl p-8 sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
      {[
        { icon: AudioLines, label: "Your voice", sub: "mic" },
        { icon: BrainCircuit, label: "On-device", sub: "Whisper on your Mac" },
        { icon: Lock, label: "Stays local", sub: "encrypted database" },
      ].map((s, i) => (
        <Fragment key={s.label}>
          <motion.div className="flex flex-col items-center gap-2 text-center" initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: i * 0.25 }}>
            <motion.span
              className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-300/10 text-brand-200 ring-1 ring-brand-300/25"
              animate={reduce || i !== 2 ? undefined : { scale: [1, 0.92, 1] }}
              transition={{ duration: 0.5, delay: 1 }}
            >
              <s.icon size={22} />
            </motion.span>
            <div>
              <div className="text-[14px] font-semibold text-ink">{s.label}</div>
              <div className="text-[12px] text-faint">{s.sub}</div>
            </div>
          </motion.div>
          {i < 2 && (
            <div className="hidden h-[2px] w-full overflow-hidden rounded-full bg-white/5 sm:block">
              <motion.div className="h-full bg-gradient-to-r from-brand-600 to-brand-300" initial={{ x: "-100%" }} whileInView={{ x: "0%" }} viewport={{ once: true }} transition={{ delay: 0.3 + i * 0.25, duration: 0.6 }} />
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}
