"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  BookA,
  Check,
  Cloud,
  Cpu,
  FileText,
  KeyRound,
  Laptop,
  ListChecks,
  Lock,
  Mic,
  NotebookPen,
  RotateCcw,
  Sparkles,
  Trash2,
  UserRound,
  Wand2,
  WifiOff,
} from "lucide-react";
import { EASE, GlassWindow, Heading, Reveal, Section, Wave } from "./ui";

/* ── Trust strip: four facts you can check, right under the hero ─────────────────────────── */

const FACTS = [
  { icon: Cpu, tint: "text-[#2f8cff]", title: "On-device speech model", body: "Whisper large-v3-turbo turns your voice into text locally." },
  { icon: WifiOff, tint: "text-[#7a6cff]", title: "Dictation works offline", body: "No connection needed to talk and type." },
  { icon: ListChecks, tint: "text-[#ff7eb0]", title: "No telemetry by default", body: "Usage counts only if you turn them on. Every request is in the app's network log." },
  { icon: Trash2, tint: "text-[#3fbf98]", title: "Delete any time", body: "Uninstall to remove local data. Email us to delete your account." },
];

export function TrustStrip() {
  return (
    <section aria-label="Why you can trust Flo" className="px-4 pb-4 pt-14 sm:px-6">
      <Reveal className="mx-auto max-w-6xl">
        <div className="g grid gap-px overflow-hidden rounded-[28px] sm:grid-cols-2 lg:grid-cols-4" data-testid="trust-strip">
          {FACTS.map((f) => (
            <div key={f.title} className="flex gap-3.5 p-5 sm:p-6">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[rgba(255,255,255,0.85)] shadow-sm ${f.tint}`}>
                <f.icon size={18} />
              </span>
              <div className="min-w-0">
                <p className="text-[14.5px] font-semibold leading-snug tracking-tight ink">{f.title}</p>
                <p className="mt-1 text-[13px] leading-snug mut">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-[13px] mut">
          Open about what&apos;s stored, and where.{" "}
          <Link href="/privacy" className="inline-flex items-center gap-1 font-semibold text-[#2f8cff] hover:underline">
            Read the privacy policy <ArrowRight size={13} />
          </Link>
        </p>
      </Reveal>
    </section>
  );
}

/* ── Precise: click the misheard word, Flo learns it, the next sentence comes out right ──── */

type Phase = "wrong" | "picking" | "learned" | "next";
const SECOND = "Tauri builds are green, so ship it.";

function FixDemo() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("wrong");
  const [typed, setTyped] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clear, []);

  const pick = () => {
    clear();
    setPhase("learned");
    if (reduce) {
      setTyped(SECOND.length);
      setPhase("next");
      return;
    }
    timers.current.push(
      setTimeout(() => {
        setPhase("next");
        for (let i = 1; i <= SECOND.length; i++) timers.current.push(setTimeout(() => setTyped(i), i * 34));
      }, 900),
    );
  };
  const reset = () => {
    clear();
    setTyped(0);
    setPhase("wrong");
  };

  const fixed = phase === "learned" || phase === "next";
  const shown = SECOND.slice(0, typed);
  const firstWord = shown.slice(0, 5);
  const rest = shown.slice(5);

  return (
    <GlassWindow
      title="Notes"
      right={
        fixed ? (
          <button type="button" onClick={reset} className="grid h-8 w-8 place-items-center rounded-full bg-[rgba(255,255,255,0.75)] mut transition hover:text-[var(--v2-ink)]" aria-label="Try the demo again">
            <RotateCcw size={14} />
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(255,255,255,0.75)] px-2.5 py-1 text-[11.5px] font-semibold ink-2">
            <Mic size={12} className="text-[#7a6cff]" /> Dictated
          </span>
        )
      }
    >
      <div className="p-5 sm:p-7" data-testid="fix-demo">
        <p className="text-[11.5px] font-semibold uppercase tracking-wider fnt">You said</p>
        <p className="mt-1 text-[14px] italic mut">&ldquo;Ship the build with Tauri tonight.&rdquo;</p>

        <p className="mt-5 text-[11.5px] font-semibold uppercase tracking-wider fnt">Flo typed</p>
        <div className="relative mt-1.5 text-[clamp(20px,2.4vw,26px)] font-semibold leading-snug tracking-[-0.02em] ink">
          Ship the build with{" "}
          {fixed ? (
            <motion.span key="fixed" initial={reduce ? false : { opacity: 0, y: 6, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.4, ease: EASE }} className="fixed-word inline-block">
              Tauri
            </motion.span>
          ) : (
            <span className="relative inline-block">
              <button
                type="button"
                className="fixable"
                data-hint={phase === "wrong" || undefined}
                aria-expanded={phase === "picking"}
                aria-label="Tory, misheard. Click to correct it"
                onClick={() => setPhase(phase === "picking" ? "wrong" : "picking")}
                data-testid="fix-word"
              >
                Tory
              </button>
              <AnimatePresence>
                {phase === "picking" && (
                  <motion.span
                    initial={reduce ? false : { opacity: 0, y: -4, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2, ease: EASE }}
                    className="absolute left-0 top-[calc(100%+8px)] z-10 flex w-[180px] border border-[rgba(20,40,80,0.08)] bg-[rgba(255,255,255,0.98)] shadow-[0_20px_40px_-16px_rgb(40_60_120/0.35)] flex-col gap-1 rounded-2xl p-1.5 text-[14px] font-medium tracking-normal"
                    role="menu"
                  >
                    <span className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider fnt">Did you mean</span>
                    <button type="button" role="menuitem" onClick={pick} className="flex items-center justify-between rounded-xl bg-[#0b1220] px-3 py-2 text-left text-[#fff]" data-testid="fix-pick">
                      Tauri <Check size={14} />
                    </button>
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
          )}{" "}
          tonight.
        </div>

        <div className="mt-4 min-h-[36px]">
          <AnimatePresence mode="wait">
            {fixed ? (
              <motion.span
                key="chip"
                initial={reduce ? false : { opacity: 0, y: 6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
                className="hw-notch inline-flex items-center gap-2.5 rounded-2xl py-1.5 pl-1.5 pr-3.5 text-[13px] sm:rounded-full"
                data-testid="learned-chip"
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[#5fd3b0] text-[#05221a]">
                  <Check size={13} strokeWidth={3} />
                </span>
                <span>
                  <b>Learned</b> <span className="text-[rgba(255,255,255,0.65)]">Tory → Tauri, saved on this computer</span>
                </span>
              </motion.span>
            ) : (
              <motion.span key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-2 text-[13.5px] mut">
                <Wand2 size={14} className="text-[#ff7eb0]" /> Flo misheard a name. Click <b className="ink-2">Tory</b> to fix it.
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <div className={`mt-5 rounded-2xl border border-dashed p-4 transition-colors duration-500 ${phase === "next" ? "border-[rgba(63,191,152,0.45)] bg-[rgba(63,191,152,0.06)]" : "border-[rgba(20,40,80,0.12)]"}`}>
          <p className="text-[11.5px] font-semibold uppercase tracking-wider fnt">Next time you say it</p>
          <p className="mt-1.5 min-h-[1.5em] text-[17px] font-medium leading-snug ink" aria-live="polite">
            {phase === "next" ? (
              <>
                {firstWord.length > 0 && <span className={firstWord.length === 5 ? "fixed-word" : ""}>{firstWord}</span>}
                {rest}
                {typed < SECOND.length && <span className="caret-v2" />}
              </>
            ) : (
              <span className="text-[15px] fnt">Fix the word above, then watch.</span>
            )}
          </p>
          {phase === "next" && typed >= SECOND.length && (
            <motion.p initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-[#1f8f6c]">
              <Sparkles size={13} /> Right the first time. No fix needed.
            </motion.p>
          )}
        </div>
      </div>
    </GlassWindow>
  );
}

const PRECISE = [
  { icon: Cpu, title: "A large speech model, on device", body: "Whisper large-v3-turbo, one of the most accurate open speech models, runs on your computer." },
  { icon: FileText, title: "Clean text, not a raw transcript", body: "Ums and uhs dropped. Punctuation and capitals added. Ready to send." },
  { icon: BookA, title: "Learns every fix you make", body: "Correct a word once and Flo gets it right from then on. The lesson is stored on your computer." },
];

export function PreciseSection() {
  return (
    <Section id="precise">
      <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
        <div>
          <Heading
            align="left"
            tag="02 · Precise"
            title="Precise. And it keeps learning."
            accent="keeps learning."
            lead="Flo writes what you meant, with names, numbers and punctuation in place. When it mishears a word, fix it once. Flo learns the fix locally and uses it every time after."
          />
          <ul className="mt-8 grid gap-3">
            {PRECISE.map((p, n) => (
              <Reveal key={p.title} delay={n * 0.06}>
                <li className="g-2 flex gap-4 rounded-2xl p-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0b1220] text-[#fff]">
                    <p.icon size={18} />
                  </span>
                  <span>
                    <span className="block text-[15px] font-semibold ink">{p.title}</span>
                    <span className="mt-0.5 block text-[13.5px] leading-snug mut">{p.body}</span>
                  </span>
                </li>
              </Reveal>
            ))}
          </ul>
        </div>
        <Reveal delay={0.1}>
          <FixDemo />
        </Reveal>
      </div>
    </Section>
  );
}

/* ── Private by design: your voice flows into your computer and stays there ─────────────── */

const LOCAL = [
  { icon: Cpu, label: "Speech-to-text model" },
  { icon: FileText, label: "Dictation history" },
  { icon: NotebookPen, label: "Meeting notes and to-dos" },
  { icon: BookA, label: "Your dictionary" },
  { icon: Sparkles, label: "Learned corrections" },
  { icon: KeyRound, label: "API keys, in the keychain" },
];

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="g-2 inline-flex items-center gap-3 rounded-full py-1.5 pl-4 pr-1.5 text-[13.5px] font-semibold ink-2"
      data-testid="cloud-toggle"
    >
      {label}
      <span className={`relative h-7 w-12 rounded-full transition-colors duration-300 ${on ? "bg-[#7a6cff]" : "bg-[rgba(20,40,80,0.16)]"}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-[#fff] shadow transition-all duration-300 ${on ? "left-6" : "left-1"}`} />
      </span>
    </button>
  );
}

function Flow({ off }: { off?: boolean }) {
  return (
    <div className="flow h-12 lg:h-auto lg:min-h-[160px]" data-off={off || undefined} aria-hidden>
      <span className="flow-line" />
      <i className="flow-dot" />
      <i className="flow-dot" />
      <i className="flow-dot" />
    </div>
  );
}

export function PrivateByDesign() {
  const [cloud, setCloud] = useState(false);
  return (
    <Section id="private">
      <Heading
        tag="04 · Private by design"
        title="Your words live on your computer."
        accent="your computer."
        lead="Flo turns your voice into text right on your laptop. Your history, notes, dictionary and every correction are saved there too, and Flo never trains on any of it. Cloud AI is optional and stays off until you add your own key."
      />

      <Reveal className="mt-12">
        <div className="g relative overflow-hidden rounded-[36px] p-5 sm:p-8 lg:p-10" data-testid="privacy-diagram">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(50%_60%_at_50%_0%,rgba(194,214,255,0.55),transparent_70%),radial-gradient(40%_50%_at_100%_100%,rgba(216,204,255,0.45),transparent_70%)]" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-[14px] font-semibold ink">
              <Lock size={15} className="text-[#3fbf98]" /> Where your data goes
            </p>
            <Toggle on={cloud} onChange={setCloud} label="Optional cloud AI" />
          </div>

          <div className="mt-8 grid items-stretch lg:grid-cols-[minmax(0,0.8fr)_72px_minmax(0,1.5fr)_72px_minmax(0,1fr)]">
            {/* you */}
            <div className="g-2 flex flex-col items-center justify-center rounded-[26px] p-6 text-center">
              <span className="grid h-16 w-16 place-items-center rounded-full text-[#fff]" style={{ background: "linear-gradient(135deg,#2f8cff,#7a6cff)", boxShadow: "0 0 0 10px rgb(122 108 255 / 0.12)" }}>
                <Wave bars={5} />
              </span>
              <p className="mt-5 text-[16px] font-semibold ink">You speak</p>
              <p className="mt-1 text-[13px] leading-snug mut">Hold a key and talk, in any app.</p>
            </div>

            <Flow />

            {/* your computer */}
            <div className="relative rounded-[26px] bg-[#0b1220] p-5 text-[#fff] shadow-[0_30px_60px_-30px_rgb(11_18_32/0.7)] sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 whitespace-nowrap text-[15px] font-semibold">
                  <Laptop size={17} className="text-[#8fd0ff]" /> Your computer
                </p>
                <span className="whitespace-nowrap rounded-full bg-[rgba(95,211,176,0.16)] px-2.5 py-1 text-[11.5px] font-semibold text-[#5fd3b0]">Encrypted on disk</span>
              </div>
              <ul className="mt-5 grid gap-2 sm:grid-cols-2">
                {LOCAL.map((l, n) => (
                  <motion.li
                    key={l.label}
                    initial={{ opacity: 0, y: 8 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.4, delay: 0.15 + n * 0.06, ease: EASE }}
                    className="flex items-center gap-2.5 rounded-xl bg-[rgba(255,255,255,0.06)] px-3 py-2.5 text-[13.5px] ring-1 ring-[rgba(255,255,255,0.08)]"
                  >
                    <l.icon size={15} className="shrink-0 text-[#b9a8ff]" />
                    <span className="min-w-0">{l.label}</span>
                  </motion.li>
                ))}
              </ul>
              <p className="mt-4 text-[12.5px] leading-snug text-[rgba(255,255,255,0.6)]">Stays here. Uninstall Flo and it&apos;s gone.</p>
            </div>

            <Flow off={!cloud} />

            {/* outside */}
            <div className={`flex flex-col rounded-[26px] border border-dashed p-5 transition-colors duration-500 sm:p-6 ${cloud ? "border-[rgba(122,108,255,0.45)] bg-[rgba(255,255,255,0.6)]" : "border-[rgba(20,40,80,0.16)] bg-[rgba(255,255,255,0.3)]"}`}>
              <p className="flex items-center gap-2 text-[15px] font-semibold ink">
                <Cloud size={17} className={cloud ? "text-[#7a6cff]" : "fnt"} /> Outside
              </p>
              <div className="mt-4 space-y-2.5 text-[13px]">
                <div className={`rounded-xl p-3 transition-all duration-500 ${cloud ? "g-2" : "bg-[rgba(255,255,255,0.4)] opacity-70"}`}>
                  <p className="flex items-center justify-between gap-2 font-semibold ink">
                    Your AI provider
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${cloud ? "bg-[#7a6cff] text-[#fff]" : "bg-[rgba(20,40,80,0.08)] mut"}`}>{cloud ? "On" : "Off"}</span>
                  </p>
                  <p className="mt-1 leading-snug mut">{cloud ? "Only the text you ask about, sent with your own key." : "Nothing is sent."}</p>
                </div>
                <div className="rounded-xl bg-[rgba(255,255,255,0.4)] p-3">
                  <p className="flex items-center gap-1.5 font-semibold ink">
                    <UserRound size={13} /> Flo account
                  </p>
                  <p className="mt-1 leading-snug mut">Name, email and sign-in. It can't read your words.</p>
                </div>
              </div>
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.p
              key={cloud ? "on" : "off"}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="mx-auto mt-8 max-w-2xl text-center text-[14.5px] leading-relaxed ink-2"
              aria-live="polite"
            >
              {cloud
                ? "With cloud AI on, only the text you ask the assistant about goes to the provider you picked, with your key. Cloud speech is a separate choice. Every request shows up in the network log."
                : "With cloud AI off, dictation runs entirely on your computer. Flo's server handles your sign-in and can't read your words."}
            </motion.p>
          </AnimatePresence>
        </div>
      </Reveal>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          [Mic, "Your voice", "Turned into text on your computer by default. Cloud speech only if you choose it."],
          [Sparkles, "Not training data", "Flo doesn't collect your words, so they can't train a model."],
          [Lock, "Sync is optional", "Off by default. Turn it on and it's end-to-end encrypted with a key only you hold."],
        ].map(([I, k, v], n) => {
          const Icon = I as typeof Lock;
          return (
            <Reveal key={k as string} delay={n * 0.06} className="g-2 rounded-2xl p-5">
              <Icon size={18} className="text-[#3fbf98]" />
              <p className="mt-3 text-[15px] font-semibold ink">{k as string}</p>
              <p className="mt-1 text-[13.5px] leading-snug mut">{v as string}</p>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}
