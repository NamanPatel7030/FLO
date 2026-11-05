/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import {
  Activity,
  AudioLines,
  BellRing,
  BookText,
  Bot,
  BrainCircuit,
  Check,
  Clock,
  CloudOff,
  CreditCard,
  Gauge,
  KeyRound,
  ListTodo,
  Lock,
  MessageSquare,
  Mic,
  Minus,
  Network,
  NotebookPen,
  ScanEye,
  ShieldCheck,
  Sparkles,
  SpellCheck,
  X,
} from "lucide-react";
import { auth } from "@/auth";
import { Backdrop } from "@/components/Backdrop";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { NotchDemo } from "@/components/NotchDemo";

const PAINS = [
  { icon: Clock, title: "Typing is slow", body: "You think at 150 words a minute and type at 40. Every email, prompt and Slack reply waits on your fingers." },
  { icon: Activity, title: "Context switching", body: "Copy, open ChatGPT, paste, wait, copy back. Five steps to ask one question about what is already on your screen." },
  { icon: CloudOff, title: "Your voice goes to someone's server", body: "Most dictation apps stream every word you say to the cloud and keep your history on their servers." },
  { icon: CreditCard, title: "Subscriptions and word caps", body: "Pay monthly, then hit a weekly word limit right when you are in flow." },
  { icon: BellRing, title: "Things fall through the cracks", body: "A teammate asks for a review, a client asks for an invoice, a meeting ends with three action items. Nobody writes them down." },
  { icon: Bot, title: "Agent sessions you forget", body: "Claude Code finished ten minutes ago and is waiting for you. You only notice when you switch windows." },
];

const FEATURES = [
  { icon: Mic, title: "Dictation anywhere", body: "Hold ⌃ and speak. Clean, punctuated text lands where your cursor is. Add Space for hands-free.", tag: "⌃ hold" },
  { icon: ScanEye, title: "Assistant that sees your screen", body: "Hold fn and ask. Go deeper reads the window you are on; Search the web brings sources.", tag: "fn hold" },
  { icon: NotebookPen, title: "Live meeting notes", body: "Live transcript as people talk, a rolling summary and action items that become to-dos." },
  { icon: ListTodo, title: "Attention to-dos", body: "Flo notices what needs you (unanswered asks, deadlines) and adds it to your list. On device." },
  { icon: Bot, title: "Agent tray", body: "Claude Code, Codex and Cursor sessions live in your notch. Hover to see status, click to jump back." },
  { icon: MessageSquare, title: "Slack, handled", body: "Unanswered DMs and mentions become to-dos. Say a reply and confirm before anything is sent." },
  { icon: BookText, title: "Your context, your rules", body: "Upload notes and a system prompt. Flo only sends the few relevant lines, never the whole library." },
  { icon: SpellCheck, title: "Learns your spellings", body: "Fix a word once and Flo asks to remember it. Names and jargon come out right next time." },
  { icon: Gauge, title: "Analytics and typing test", body: "Words, speed and time saved, measured against your real typing speed." },
  { icon: KeyRound, title: "Your keys or fully local", body: "Bring Claude, OpenAI, Gemini, Groq, MiniMax or Qwen keys, or run everything with Ollama." },
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
  { row: "History and memory stay on your Mac", flo: "yes", wispr: "no", lemon: "no" },
  { row: "No word or task caps", flo: "yes", wispr: "no", lemon: "no" },
  { row: "Windows and Linux", flo: "Mac, Windows, Linux (beta)", wispr: "Mac, Windows", lemon: "Mac" },
  { row: "Price", flo: "Free, your own keys", wispr: "Subscription", lemon: "Free tier, then paid" },
];

const FAQ = [
  { q: "Does my voice leave my Mac?", a: "Not by default. Speech is transcribed on device with Whisper. If you choose a cloud speech or AI provider, Flo sends text straight to that provider with your own key. Every request appears in the network log." },
  { q: "Why do I need an account?", a: "Only to download Flo and sign in on your devices. Your dictation, notes, to-dos and keys never touch our servers." },
  { q: "Which AI models can I use?", a: "Claude, OpenAI, Gemini, Groq, OpenRouter, MiniMax, Qwen and Ollama Cloud with your own key, or local models through Ollama and LM Studio." },
  { q: "Does it work on Windows and Linux?", a: "Yes. The island sits in the bottom-right corner on Windows and Linux. Hold Right Ctrl to dictate and Right Alt for the assistant." },
  { q: "How is this different from Wispr Flow or Lemon?", a: "Flo combines dictation, a screen-aware assistant, meeting notes, to-dos and an agent tray in one app, keeps everything on your Mac and lets you choose the AI you pay for." },
  { q: "What does it cost?", a: "Flo is free. You pay your AI provider directly for what you use, or nothing at all with local models." },
];

function Mark({ v }: { v: Cell }) {
  if (v === "yes")
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-300/15 text-brand-200" aria-label="Yes">
        <Check size={14} strokeWidth={3} />
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

function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: React.ReactNode; sub?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[42px] sm:leading-[1.1]">{title}</h2>
      {sub && <p className="mt-4 text-[17px] leading-relaxed text-muted">{sub}</p>}
    </div>
  );
}

export default async function Home() {
  const session = await auth();
  const signedIn = !!session?.user;
  return (
    <>
      <Backdrop />
      <Nav signedIn={signedIn} />
      <main>
        {/* HERO */}
        <section className="px-5 pb-20 pt-32 sm:pt-40" data-testid="hero">
          <div className="mx-auto max-w-4xl text-center">
            <a href="#features" className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] text-muted">
              <Sparkles size={14} className="text-brand-300" /> Dictation, assistant, meetings and to-dos in your notch
            </a>
            <h1 className="mt-6 text-[44px] font-semibold leading-[1.02] tracking-[-0.03em] sm:text-[76px]">
              Speak. <span className="accent-text">Flo</span> writes,
              <br className="hidden sm:block" /> answers and remembers.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-[18px] leading-relaxed text-muted sm:text-[20px]">
              Privately, on your Mac. Hold a key, talk, and the right words appear wherever you work. Ask about your screen. Never lose a follow-up again.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href={signedIn ? "/download" : "/signup?next=/download"} className="btn btn-primary px-7 py-3.5 text-[15px]" data-testid="hero-cta">
                Download Flo for free
              </Link>
              <a href="#how" className="btn btn-glass px-6 py-3.5 text-[15px]">
                See how it works
              </a>
            </div>
            <p className="mt-4 text-[13px] text-faint">macOS 13+ · Windows and Linux beta · No credit card</p>
          </div>
          <div className="mx-auto mt-16 max-w-4xl">
            <NotchDemo />
          </div>
        </section>

        {/* PAIN */}
        <section className="px-5 py-24" id="pain" data-testid="pain">
          <SectionHead eyebrow="The problem" title="Your ideas move faster than your keyboard" sub="And the tools that promise to help either send everything to the cloud or charge you by the word." />
          <div className="mx-auto mt-14 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PAINS.map((p) => (
              <div key={p.title} className="glass rounded-3xl p-6">
                <p.icon size={20} className="text-brand-300" />
                <h3 className="mt-4 text-[17px] font-semibold">{p.title}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{p.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* FEATURES */}
        <section className="px-5 py-24" id="features" data-testid="features">
          <SectionHead eyebrow="Features" title={<>One key. <span className="accent-text">Everything you need.</span></>} sub="Flo lives in your MacBook notch and stays out of the way until you need it." />
          <div className="mx-auto mt-14 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div key={f.title} className={`glass group relative overflow-hidden rounded-3xl p-6 transition hover:border-brand-300/30 ${i < 2 ? "lg:col-span-1" : ""}`}>
                <div className="flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-300/10 text-brand-200 ring-1 ring-brand-300/20">
                    <f.icon size={19} />
                  </span>
                  {f.tag && <span className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[11px] text-faint">{f.tag}</span>}
                </div>
                <h3 className="mt-5 text-[17px] font-semibold">{f.title}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* HOW */}
        <section className="px-5 py-24" id="how" data-testid="how">
          <SectionHead eyebrow="How it works" title="Ready in three minutes" />
          <ol className="mx-auto mt-14 grid max-w-5xl gap-4 sm:grid-cols-3">
            {[
              { n: "1", t: "Create your account", b: "Sign up with email or Google, then download Flo for your computer." },
              { n: "2", t: "Sign in and set up", b: "Flo asks a few questions, checks permissions and lets you try each feature." },
              { n: "3", t: "Hold a key and talk", b: "⌃ to dictate, fn to ask. Flo handles the rest, right from your notch." },
            ].map((s) => (
              <li key={s.n} className="glass rounded-3xl p-6">
                <span className="accent-text text-3xl font-semibold">{s.n}</span>
                <h3 className="mt-3 text-[17px] font-semibold">{s.t}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{s.b}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* COMPARE */}
        <section className="px-5 py-24" id="compare" data-testid="compare">
          <SectionHead eyebrow="Compare" title="The alternative to Wispr Flow and Lemon" sub="Everything they do, plus the things they don't, without sending your life to someone else's server." />
          <div className="glass mx-auto mt-14 max-w-5xl overflow-x-auto rounded-3xl">
            <table className="w-full min-w-[620px] text-left text-[14px]" data-testid="compare-table">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-5 py-4 font-medium text-faint" scope="col">
                    <span className="sr-only">Feature</span>
                  </th>
                  <th className="px-5 py-4" scope="col">
                    <span className="inline-flex items-center gap-2 font-semibold text-ink">
                      <img src="/logo.svg" alt="" className="h-5 w-5 rounded-md" /> Flo
                    </span>
                  </th>
                  <th className="px-5 py-4 font-medium text-muted" scope="col">Wispr Flow</th>
                  <th className="px-5 py-4 font-medium text-muted" scope="col">Lemon</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map((r) => (
                  <tr key={r.row} className="border-b border-white/5 last:border-0">
                    <th scope="row" className="px-5 py-3.5 font-normal text-muted">{r.row}</th>
                    <td className="bg-brand-300/[0.04] px-5 py-3.5"><Mark v={r.flo} /></td>
                    <td className="px-5 py-3.5"><Mark v={r.wispr} /></td>
                    <td className="px-5 py-3.5"><Mark v={r.lemon} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mx-auto mt-4 max-w-5xl px-1 text-[12px] text-faint">Based on our review of the public Wispr Flow and Lemon Mac apps in November 2026. Products change; tell us if something is out of date.</p>
        </section>

        {/* PRIVACY */}
        <section className="px-5 py-24" id="privacy" data-testid="privacy">
          <SectionHead eyebrow="Privacy" title={<>Private by design, <span className="accent-text">not by promise</span></>} />
          <div className="mx-auto mt-14 grid max-w-6xl gap-4 sm:grid-cols-3">
            {[
              { icon: ShieldCheck, t: "Egress guard", b: "Every network call goes through one gate with an allow list. Unknown hosts are blocked, always." },
              { icon: Network, t: "See every request", b: "The network log shows each call: which host, why, and how many tokens it used." },
              { icon: Lock, t: "Encrypted on disk", b: "History, notes and to-dos live in an encrypted database. The key lives in your Keychain." },
            ].map((p) => (
              <div key={p.t} className="glass rounded-3xl p-6">
                <p.icon size={20} className="text-brand-300" />
                <h3 className="mt-4 text-[17px] font-semibold">{p.t}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{p.b}</p>
              </div>
            ))}
          </div>
          <div className="glass mx-auto mt-4 flex max-w-6xl flex-col items-start gap-4 rounded-3xl p-6 sm:flex-row sm:items-center">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-300/10 text-brand-200 ring-1 ring-brand-300/20">
              <BrainCircuit size={20} />
            </span>
            <p className="text-[15px] leading-relaxed text-muted">
              <span className="font-semibold text-ink">Spend fewer tokens.</span> Flo only calls an AI model when it actually helps: clean short sentences are tidied on device, screen text is sent only when you ask about your screen, and meeting summaries update with just the new lines.
            </p>
          </div>
        </section>

        {/* MAKER */}
        <section className="px-5 py-24" id="maker" data-testid="maker">
          <div className="glass-strong mx-auto flex max-w-4xl flex-col items-center gap-8 rounded-[32px] p-8 sm:flex-row sm:p-10">
            <div className="relative shrink-0">
              <div className="absolute -inset-1 rounded-full accent-bg opacity-70 blur-[2px]" />
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
        </section>

        {/* FAQ */}
        <section className="px-5 py-24" id="faq" data-testid="faq">
          <SectionHead eyebrow="FAQ" title="Questions, answered" />
          <div className="mx-auto mt-12 flex max-w-3xl flex-col gap-3">
            {FAQ.map((f) => (
              <details key={f.q} className="glass group rounded-2xl px-5 py-4 open:pb-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-medium">
                  {f.q}
                  <span className="text-brand-300 transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-[15px] leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="px-5 pb-28 pt-8">
          <div className="glass-strong relative mx-auto max-w-4xl overflow-hidden rounded-[32px] px-6 py-14 text-center">
            <div aria-hidden className="absolute -top-24 left-1/2 h-48 w-[70%] -translate-x-1/2 rounded-full bg-brand-500/20 blur-3xl" />
            <AudioLines className="mx-auto text-brand-300" />
            <h2 className="relative mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Start speaking instead of typing</h2>
            <p className="relative mx-auto mt-3 max-w-xl text-muted">Free to download. Bring your own AI or stay fully local.</p>
            <Link href={signedIn ? "/download" : "/signup?next=/download"} className="btn btn-primary relative mt-8 px-7 py-3.5 text-[15px]">
              Get Flo
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
