"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  AppWindow,
  BarChart3,
  BookText,
  Check,
  Database,
  Globe,
  History,
  KeyRound,
  Keyboard,
  LayoutGrid,
  Lock,
  Minus,
  Network,
  NotebookPen,
  Plus,
  RefreshCw,
  ScanEye,
  ShieldCheck,
  Share2,
  UserRound,
  WifiOff,
  X,
} from "lucide-react";
import { DownloadCTA } from "../DownloadCTA";
import { Logo } from "../Logo";
import { NamanAvatar } from "../NamanAvatar";
import { EASE, Heading, Reveal, Section, useLoop } from "./ui";
import { NotchEyes } from "./Mascot";
import { LiveCount } from "./LiveCount";

/* ── 14 Privacy: a live network log next to three promises ─────────────────────────────── */

const LOG = [
  { host: "api.anthropic.com", why: "Assistant · your key", ok: true },
  { host: "huggingface.co", why: "Download Whisper model", ok: true },
  { host: "tracker.ads-network.io", why: "Not on the allow-list", ok: false },
  { host: "api.open-meteo.com", why: "Weather widget", ok: true },
  { host: "i.ytimg.com", why: "Now Playing artwork", ok: true },
  { host: "telemetry.unknown.app", why: "Not on the allow-list", ok: false },
];

export function PrivacySection() {
  const { ref, i } = useLoop(LOG.length + 2, 1000, LOG.length);
  const rows = LOG.slice(0, Math.min(LOG.length, i + 1));
  return (
    <Section id="privacy">
      <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <Heading
            align="left"
            tag="14 · Private by design"
            title="Local first. Enforced, not promised."
            accent="Enforced,"
            lead="Your voice, notes and to-dos stay on your Mac in an encrypted database. Bring your own AI key, or run fully local with Ollama."
          />
          <div className="mt-8 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {[
              [KeyRound, "Keys in Keychain", "Your keys live in the macOS Keychain."],
              [WifiOff, "Fully offline", "Run everything with local models."],
              [Lock, "We see nothing", "Never your dictation, notes or to-dos."],
            ].map(([I, k, v], n) => {
              const Icon = I as typeof Lock;
              return (
                <Reveal key={k as string} delay={n * 0.06} className="g-2 rounded-2xl p-4">
                  <Icon size={18} className="text-[#3fbf98]" />
                  <p className="mt-3 text-[14.5px] font-semibold ink">{k as string}</p>
                  <p className="mt-1 text-[13px] leading-snug mut">{v as string}</p>
                </Reveal>
              );
            })}
          </div>
        </div>
        <Reveal>
          <div ref={ref} className="g rounded-[32px] p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 text-[14px] font-semibold ink">
                <Network size={16} className="text-[#2f8cff]" /> Network log
              </p>
              <span className="rounded-full bg-[#3fbf98]/12 px-2.5 py-1 text-[11.5px] font-semibold text-[#1f8f6c]">Allow-list on</span>
            </div>
            <ul className="mt-4 min-h-[324px] space-y-2 font-mono text-[12.5px]">
              <AnimatePresence initial={false}>
                {rows.map((r) => (
                  <motion.li
                    key={r.host}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.35, ease: EASE }}
                    className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 ${r.ok ? "g-2" : "bg-[#ff5d6c]/[0.07] ring-1 ring-[#ff5d6c]/20"}`}
                  >
                    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${r.ok ? "bg-[#3fbf98] text-[#fff]" : "bg-[#ff5d6c] text-[#fff]"}`}>
                      {r.ok ? <Check size={11} strokeWidth={3.5} /> : <X size={11} strokeWidth={3.5} />}
                    </span>
                    <span className={`min-w-0 flex-1 truncate ${r.ok ? "ink" : "text-[#c0364a] line-through"}`}>{r.host}</span>
                    <span className="hidden shrink-0 font-sans text-[12px] mut sm:inline">{r.why}</span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
            <p className="mt-3 text-[12.5px] mut">Every network call passes through one allow-list you can see, host by host. Anything not on it is blocked.</p>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

/* ── And everything else: filterable feature grid ─────────────────────────────────────── */

type Cat = "Voice" | "Assistant" | "Work" | "Setup";
const MORE: { cat: Cat; icon: typeof Lock; title: string; body: string }[] = [
  { cat: "Assistant", icon: Share2, title: "A memory that draws itself", body: "Flo Vault links your projects, people, meetings and topics into a local, Obsidian-style graph as you work. Search it, edit it, and let the assistant draw on it." },
  { cat: "Assistant", icon: KeyRound, title: "Any AI: your key, or none at all", body: "Claude, OpenAI, Gemini, Groq, OpenRouter, MiniMax, Qwen or Ollama Cloud with your own key, or fully local with Ollama and LM Studio." },
  { cat: "Assistant", icon: AppWindow, title: "Every coding agent", body: "Claude Code, Codex CLI and Cursor sessions in the notch tray, plus any tool through a local webhook." },
  { cat: "Assistant", icon: Globe, title: "Go deeper, or search the web", body: "Every quick answer offers a deeper look at your screen, a web search, or the full answer in the app." },
  { cat: "Assistant", icon: BookText, title: "Knowledge docs", body: "Pin notes and docs and set your own system prompt. Only the relevant pieces are sent, so tokens stay low." },
  { cat: "Voice", icon: Keyboard, title: "Your keys, your way", body: "Remap dictation and the assistant to the keys you like. If macOS grabs fn, one click fixes it." },
  { cat: "Voice", icon: Activity, title: "Choose your speech engine", body: "On-device Whisper by default, or Groq or OpenAI Whisper with your own key." },
  { cat: "Voice", icon: Keyboard, title: "Typing test", body: "Measure your real typing speed. Flo uses it to show how much time speaking saves you." },
  { cat: "Work", icon: BarChart3, title: "Analytics", body: "Words dictated, time saved, streaks and speaking pace over 7, 30 or 60 days." },
  { cat: "Work", icon: History, title: "Searchable history", body: "Every dictation and every answer, kept on your Mac and one search away." },
  { cat: "Work", icon: NotebookPen, title: "Meeting library", body: "Every meeting with its summary, action items and transcript. Rename a speaker once and Flo knows the voice." },
  { cat: "Work", icon: ScanEye, title: "Spots to-dos on screen", body: "On-device OCR reads the window you're in for things you've promised. Screenshots are never saved." },
  { cat: "Setup", icon: RefreshCw, title: "One-click updates", body: "Downloads in the background, checks the signature against the key built into the app, then one restart." },
  { cat: "Setup", icon: Database, title: "Encrypted on disk", body: "History, notes and to-dos live in an encrypted database. Its key and your API keys stay in the Keychain." },
  { cat: "Setup", icon: ShieldCheck, title: "Permissions, fixed for you", body: "Flo checks microphone, accessibility and screen access, and repairs them in one click." },
  { cat: "Setup", icon: LayoutGrid, title: "Mac, Windows and Linux", body: "Off the Mac, the island sits bottom-right. Hold Right Ctrl to dictate and Right Alt for the assistant." },
  { cat: "Setup", icon: UserRound, title: "An account that holds nothing", body: "Sign in only to download. Your dictation, notes, to-dos and keys never touch our servers." },
];
const CATS: ("All" | Cat)[] = ["All", "Voice", "Assistant", "Work", "Setup"];

export function MoreSection() {
  const [cat, setCat] = useState<"All" | Cat>("All");
  const list = MORE.filter((m) => cat === "All" || m.cat === cat);
  return (
    <Section id="features">
      <Heading tag="And everything else" title="Small things, done properly." accent="done properly." />
      <div className="mt-8 flex flex-wrap justify-center gap-2" role="tablist" aria-label="Filter features">
        {CATS.map((c) => (
          <button key={c} role="tab" aria-selected={c === cat} className="chip2" onClick={() => setCat(c)}>
            {c}
            <span className="text-[11.5px] opacity-60">{c === "All" ? MORE.length : MORE.filter((m) => m.cat === c).length}</span>
          </button>
        ))}
      </div>
      <motion.div layout className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence mode="popLayout">
          {list.map((m) => {
            const Icon = m.icon;
            return (
              <motion.article
                key={m.title}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.35, ease: EASE }}
                className="g group rounded-[26px] p-6 transition-transform duration-300 hover:-translate-y-1"
              >
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[rgba(255,255,255,0.8)] text-[#7a6cff] shadow-sm transition group-hover:bg-[#0b1220] group-hover:text-[#fff]">
                  <Icon size={18} />
                </span>
                <h3 className="mt-4 text-[16px] font-semibold tracking-tight ink">{m.title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed mut">{m.body}</p>
              </motion.article>
            );
          })}
        </AnimatePresence>
      </motion.div>
    </Section>
  );
}

/* ── Compare ────────────────────────────────────────────────────────────────────────────── */

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

function Mark({ v }: { v: Cell }) {
  if (v === "yes")
    return (
      <span className="inline-grid h-6 w-6 place-items-center rounded-full bg-[#3fbf98] text-[#fff]" aria-label="Yes">
        <Check size={13} strokeWidth={3.5} />
      </span>
    );
  if (v === "no")
    return (
      <span className="inline-grid h-6 w-6 place-items-center rounded-full bg-black/[0.06] fnt" aria-label="No">
        <Minus size={13} strokeWidth={3} />
      </span>
    );
  if (v === "partial") return <span className="text-[13px] font-medium mut">Partly</span>;
  return <span className="text-[13px] font-medium ink-2">{v}</span>;
}

export function CompareSection() {
  return (
    <Section id="compare">
      <span data-testid="compare" className="sr-only" />
      <Heading
        tag="Compare"
        title="The alternative to Wispr Flow and Lemon"
        accent="The alternative"
        lead="Everything they do, plus the things they don't, without sending your life to someone else's server."
      />
      <Reveal className="g mx-auto mt-12 max-w-4xl overflow-x-auto rounded-[30px]">
        <table className="w-full min-w-[560px] text-left text-[14px]" data-testid="compare-table">
          <thead>
            <tr className="border-b border-[rgba(255,255,255,0.8)]">
              <th className="px-5 py-4" scope="col">
                <span className="sr-only">Feature</span>
              </th>
              <th className="bg-[rgba(255,255,255,0.5)] px-5 py-4" scope="col">
                <span className="inline-flex items-center gap-2 font-semibold ink">
                  <Logo size={20} /> Flo
                </span>
              </th>
              <th className="px-5 py-4 font-medium mut" scope="col">Wispr Flow</th>
              <th className="px-5 py-4 font-medium mut" scope="col">Lemon</th>
            </tr>
          </thead>
          <tbody>
            {COMPARE.map((r) => (
              <tr key={r.row} className="border-b border-[rgba(255,255,255,0.6)] last:border-0">
                <th scope="row" className="px-5 py-3.5 font-medium ink-2">{r.row}</th>
                <td className="bg-[rgba(255,255,255,0.5)] px-5 py-3.5"><Mark v={r.flo} /></td>
                <td className="px-5 py-3.5"><Mark v={r.wispr} /></td>
                <td className="px-5 py-3.5"><Mark v={r.lemon} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Reveal>
      <p className="mx-auto mt-4 max-w-4xl px-1 text-[12px] fnt">Based on our review of the public Wispr Flow and Lemon Mac apps in November 2026. Products change; tell us if something is out of date.</p>
    </Section>
  );
}

/* ── Maker ──────────────────────────────────────────────────────────────────────────────── */

export function MakerSection() {
  return (
    <Section id="maker" className="!py-16">
      <Reveal className="g mx-auto flex max-w-4xl flex-col items-center gap-8 rounded-[36px] p-8 sm:flex-row sm:p-10">
        <div className="relative shrink-0">
          <div className="absolute -inset-1.5 rounded-full bg-[conic-gradient(from_0deg,#2f8cff,#7a6cff,#ff7eb0,#ffb38a,#2f8cff)] opacity-80" />
          <NamanAvatar size={128} screen="maker" cycle className="relative ring-4 ring-[#fff]" />
        </div>
        <div className="text-center sm:text-left">
          <p className="text-[12px] font-semibold uppercase tracking-[0.2em] fnt">Made by</p>
          <h3 className="mt-2 text-[24px] font-semibold tracking-tight ink">Naman Gundaniya</h3>
          <p className="mut">Forward Deployed Engineer</p>
          <blockquote className="serif-i mt-5 text-[26px] leading-snug ink sm:text-[30px]">“I&apos;m the human. AI is my leverage. Together, we build anything.”</blockquote>
          <a href="https://hellonaman.com" target="_blank" rel="noreferrer" className="mt-4 inline-block text-[14px] font-semibold text-[#2f8cff] hover:underline">
            hellonaman.com
          </a>
        </div>
      </Reveal>
    </Section>
  );
}

/* ── FAQ ────────────────────────────────────────────────────────────────────────────────── */

const FAQ = [
  { q: "Does my voice leave my Mac?", a: "Not by default. Speech is transcribed on device with Whisper. If you choose a cloud speech or AI provider, Flo sends text straight to that provider with your own key. Every request appears in the network log." },
  { q: "Why do I need an account?", a: "Only to download Flo and sign in on your devices. Your dictation, notes, to-dos and keys never touch our servers." },
  { q: "Which AI models can I use?", a: "Claude, OpenAI, Gemini, Groq, OpenRouter, MiniMax, Qwen and Ollama Cloud with your own key, or local models through Ollama and LM Studio." },
  { q: "Does it work on Windows and Linux?", a: "Yes. The island sits in the bottom-right corner. Hold Right Ctrl to dictate and Right Alt for the assistant." },
  { q: "How is this different from Wispr Flow or Lemon?", a: "Flo combines dictation, a screen-aware assistant, meeting notes, to-dos and an agent tray in one app, keeps everything on your device and lets you choose the AI you pay for." },
  { q: "How do updates work?", a: "Flo checks for new versions itself. Click Update, keep working while it downloads, then restart once. Every download is checked against the signing key built into Flo before it installs." },
  { q: "What does it cost?", a: "Flo is free. You pay your AI provider directly for what you use, or nothing at all with local models." },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`overflow-hidden rounded-[22px] transition-colors ${open ? "g" : "g-2"}`}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-[16px] font-semibold ink" aria-expanded={open}>
        {q}
        <motion.span animate={{ rotate: open ? 45 : 0 }} transition={{ duration: 0.2 }} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[rgba(255,255,255,0.8)]">
          <Plus size={16} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }}>
            <p className="px-5 pb-5 text-[15px] leading-relaxed mut">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function FaqSection() {
  return (
    <Section id="faq">
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <Heading align="left" tag="FAQ" title="Questions, answered." accent="answered." lead="Anything else? Write to Naman at hellonaman.com." />
        <Reveal>
          <div className="flex flex-col gap-2.5" data-testid="faq">
            {FAQ.map((f) => (
              <FaqItem key={f.q} {...f} />
            ))}
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

/* ── Final call to action ──────────────────────────────────────────────────────────────── */

export function FinalCTA() {
  return (
    <Section className="!pb-16">
      <Reveal className="g relative overflow-hidden rounded-[44px] px-6 py-20 text-center sm:px-12 md:py-28">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(50%_70%_at_20%_100%,rgba(169,220,255,0.8),transparent_70%),radial-gradient(50%_70%_at_80%_0%,rgba(216,204,255,0.85),transparent_70%),radial-gradient(40%_50%_at_90%_100%,rgba(255,214,196,0.7),transparent_70%)]" />
        <div className="hw-notch mx-auto flex h-10 w-48 items-center justify-center gap-2 rounded-b-[18px] rounded-t-md text-[12px] font-semibold">
          <NotchEyes /> <span className="text-[rgba(255,255,255,0.85)]">Flo is listening</span>
        </div>
        <h2 className="mx-auto mt-10 max-w-3xl text-[clamp(44px,7vw,96px)] font-semibold leading-[0.95] tracking-[-0.05em] ink">
          Stop typing.
          <br />
          <span className="serif-i grad-text pr-2 text-[1.08em] tracking-[-0.02em]">Start talking.</span>
        </h2>
        <p className="v2-lead mx-auto mt-6 max-w-lg">Free to download. Private by default. Ready in about a minute.</p>
        <LiveCount />
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <DownloadCTA size="lg" testId="final-get-flo" menu="up" />
          <Link href="/login" className="btn btn-glass h-14 px-7 text-[15px] ink">
            I have an account
          </Link>
        </div>
      </Reveal>
    </Section>
  );
}

export function SiteFooter() {
  return (
    <footer className="px-4 pb-28 sm:px-6">
      <div className="g-2 mx-auto max-w-6xl rounded-[32px] p-8 sm:p-10">
        <div className="flex flex-col gap-10 sm:flex-row sm:justify-between">
          <div className="max-w-xs">
            <div className="flex items-center gap-2.5">
              <Logo size={30} />
              <span className="text-[17px] font-semibold ink">Flo</span>
            </div>
            <p className="mt-3 text-[14px] leading-relaxed mut">Private voice dictation, a screen-aware assistant and live meeting notes. Your data stays on your Mac.</p>
          </div>
          <div className="grid grid-cols-2 gap-10 text-[14px] sm:grid-cols-3">
            <div className="flex flex-col gap-2.5">
              <span className="font-semibold ink">Product</span>
              <a href="/#features" className="mut hover:text-[var(--v2-ink)]">Features</a>
              <a href="/#compare" className="mut hover:text-[var(--v2-ink)]">Compare</a>
              <Link href="/download" className="mut hover:text-[var(--v2-ink)]">Download</Link>
              <Link href="/changelog" className="mut hover:text-[var(--v2-ink)]">What&apos;s new</Link>
            </div>
            <div className="flex flex-col gap-2.5">
              <span className="font-semibold ink">Company</span>
              <a href="https://hellonaman.com" target="_blank" rel="noreferrer" className="mut hover:text-[var(--v2-ink)]">Made by Naman</a>
              <Link href="/privacy" className="mut hover:text-[var(--v2-ink)]">Privacy</Link>
              <Link href="/terms" className="mut hover:text-[var(--v2-ink)]">Terms</Link>
            </div>
            <div className="flex flex-col gap-2.5">
              <span className="font-semibold ink">Account</span>
              <Link href="/login" className="mut hover:text-[var(--v2-ink)]">Sign in</Link>
              <Link href="/signup?next=/download" className="mut hover:text-[var(--v2-ink)]">Create account</Link>
            </div>
          </div>
        </div>
        <div className="mt-10 flex flex-col justify-between gap-2 border-t border-[rgba(255,255,255,0.8)] pt-6 text-[12.5px] fnt sm:flex-row">
          <span>© {new Date().getFullYear()} Flo. Built by Naman Gundaniya.</span>
          <span className="serif-i text-[15px]">Speak. Flo writes, answers and remembers.</span>
        </div>
      </div>
    </footer>
  );
}
