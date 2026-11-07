"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AudioLines, Minus, Plus, X } from "lucide-react";
import { DownloadCTA } from "../DownloadCTA";
import { EASE_OUT, Reveal } from "../motion/primitives";

/* Everything after the notch story: one look at the app, how Flo compares, who made it, FAQ, CTA. */
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
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.07] text-white/55" aria-label="No">
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
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <motion.path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, ease: "easeInOut" }}
      />
    </svg>
  );
}

export function Outro() {
  return (
    <>
      {/* ── THE APP ──────────────────────────────────────── */}
      <section className="px-5 pb-12 pt-32" id="app">
        <Reveal blur={false} className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">Behind the notch</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[42px] sm:leading-[1.1]">
            One calm app keeps <span className="accent-text">all of it</span>
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-muted">History, notes, to-dos, your dictionary and analytics, in a dashboard that never leaves your Mac.</p>
        </Reveal>
        <Reveal blur={false} className="mx-auto mt-12 max-w-5xl">
          <figure className="shot">
            <div className="shot-bar" aria-hidden>
              <span className="shot-dot" style={{ background: "#ff5f57" }} />
              <span className="shot-dot" style={{ background: "#febc2e" }} />
              <span className="shot-dot" style={{ background: "#28c840" }} />
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/shots/home-dark.png" alt="The Flo dashboard: recent dictations, words this week and time saved" loading="lazy" />
          </figure>
        </Reveal>
      </section>

        {/* ── COMPARE ──────────────────────────────────────── */}
        <section className="px-5 py-24" id="compare" data-testid="compare">
          <Reveal blur={false} className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">Compare</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[42px] sm:leading-[1.1]">The alternative to Wispr Flow and Lemon</h2>
            <p className="mt-4 text-[17px] leading-relaxed text-muted">Everything they do, plus the things they don&apos;t, without sending your life to someone else&apos;s server.</p>
          </Reveal>
          <Reveal blur={false} className="relative mx-auto mt-14 max-w-5xl">
            
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
                      <td className="bg-brand-300/[0.08] px-5 py-3.5"><Mark v={r.flo} /></td>
                      <td className="px-5 py-3.5"><Mark v={r.wispr} /></td>
                      <td className="px-5 py-3.5"><Mark v={r.lemon} /></td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
          <p className="mx-auto mt-4 max-w-5xl px-1 text-[12px] text-muted">Based on our review of the public Wispr Flow and Lemon Mac apps in November 2026. Products change; tell us if something is out of date.</p>
        </section>

        {/* ── MAKER ────────────────────────────────────────── */}
        <section className="px-5 py-24" id="maker">
          <Reveal blur={false}>
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
          <Reveal blur={false} className="mx-auto max-w-2xl text-center">
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
          <Reveal blur={false}>
            <div className="glass-strong relative mx-auto max-w-4xl overflow-hidden rounded-[32px] px-6 py-16 text-center">
              <motion.div
                aria-hidden
                className="absolute -top-36 left-1/2 h-72 w-[80%] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(61_187_255/0.35),transparent)]"
                animate={{ opacity: [0.5, 1, 0.5], scale: [1, 1.1, 1] }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              />
              <AudioLines className="relative mx-auto text-brand-300" />
              <h2 className="relative mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Start speaking instead of typing</h2>
              <p className="relative mx-auto mt-3 max-w-xl text-muted">Free to download. Bring your own AI or stay fully local.</p>
              <div className="relative mt-8 flex justify-center">
                <DownloadCTA size="lg" testId="cta-download" />
              </div>
            </div>
          </Reveal>
        </section>
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
