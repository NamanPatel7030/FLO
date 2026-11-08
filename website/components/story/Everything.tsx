"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
import {
  Activity,
  AppWindow,
  ArrowDownToLine,
  BarChart3,
  BookText,
  Bot,
  Check,
  Cpu,
  Database,
  Globe,
  History,
  Keyboard,
  KeyRound,
  Languages,
  LayoutGrid,
  ListChecks,
  Lock,
  MessageSquare,
  Mic,
  Network,
  NotebookPen,
  Palette,
  RefreshCw,
  RotateCcw,
  ScanEye,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  Volume2,
  Waves,
  Zap,
} from "lucide-react";
import { EASE_OUT } from "../motion/primitives";
import { SectionHead } from "./Outro";
import { PALETTES, SOUNDS, STYLES } from "./chapters";
import { playSound } from "./sound";
import { useStory } from "./StoryContext";
import { ClaudeMark, Keycap, StyleViz } from "./viz";

/* "Everything Flo does": a filterable bento of every shipped feature that isn't a story chapter. */

type Cat = "Voice" | "Assistant" | "Work" | "Notch" | "Privacy & setup";
const CATS: ("All" | Cat)[] = ["All", "Voice", "Assistant", "Work", "Notch", "Privacy & setup"];

type Tile = { id: string; cat: Cat; icon: React.ReactNode; title: string; body: string; wide?: boolean; demo?: React.ReactNode; tag?: string };

/** Runs `cb` every `ms` while the element is on screen (and motion is allowed). */
function useTicker(ms: number, n: number) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-40px" });
  const { reduce } = useStory();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!inView || reduce) return;
    const id = setInterval(() => setI((v) => (v + 1) % n), ms);
    return () => clearInterval(id);
  }, [inView, reduce, ms, n]);
  return { ref, i };
}

/* ── micro-demos ─────────────────────────────────────────────────────────── */

const RELEASE = ["Skills can call MCP tools", "Hands-free agent asks before sending", "Clock widget shows time zones"];

/** The headline micro-demo: a notch-style update card you can actually click through. */
function UpdateDemo() {
  const [st, setSt] = useState<"idle" | "down" | "ready" | "done">("idle");
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(t.current), []);
  const start = () => {
    setSt("down");
    clearTimeout(t.current);
    t.current = setTimeout(() => setSt("ready"), 2400);
  };
  return (
    <div className="upd mt-5 rounded-[22px] bg-black p-4 ring-1 ring-white/10" data-testid="update-demo" data-state={st}>
      <div className="flex items-center gap-3">
        <span className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${st === "done" ? "bg-emerald-400/15 text-emerald-300" : "bg-brand-400/15 text-brand-200"} ring-1 ring-white/10`}>
          {st === "done" ? <Check size={18} strokeWidth={3} /> : st === "ready" ? <RefreshCw size={17} /> : <ArrowDownToLine size={17} className={st === "down" ? "upd-bob" : ""} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">
            {st === "idle" && "Flo 1.4 is ready"}
            {st === "down" && "Downloading Flo 1.4…"}
            {st === "ready" && "Signature checked. Restart to finish"}
            {st === "done" && "You're on Flo 1.4"}
          </div>
          <div className="truncate text-[12px] text-white/55">{st === "done" ? "Took one click and one restart" : st === "down" ? "In the background, keep working" : "Verified with Flo's signing key before it installs"}</div>
        </div>
        {st === "idle" && (
          <button type="button" className="upd-btn" onClick={start} data-testid="update-go">
            Update
          </button>
        )}
        {st === "ready" && (
          <button type="button" className="upd-btn" onClick={() => setSt("done")} data-testid="update-restart">
            Restart
          </button>
        )}
        {st === "done" && (
          <button type="button" className="upd-btn upd-ghost" onClick={() => setSt("idle")} aria-label="Replay the update demo">
            <RotateCcw size={13} />
          </button>
        )}
      </div>
      <div className="mt-3 h-[5px] overflow-hidden rounded-full bg-white/10">
        <div className="upd-bar h-full w-full origin-left rounded-full bg-gradient-to-r from-brand-200 to-brand-500" />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {RELEASE.map((r, k) => (
          <span key={r} className="upd-note rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/70 ring-1 ring-white/10" style={{ ["--d" as string]: `${k * 90}ms` }}>
            {r}
          </span>
        ))}
      </div>
    </div>
  );
}

const HELLOS = [
  ["Hello", "English"],
  ["नमस्ते", "Hindi"],
  ["નમસ્તે", "Gujarati"],
  ["Kal milte hain", "Hinglish"],
  ["Hola", "Spanish"],
  ["Hallo", "German"],
  ["Bonjour", "French"],
] as const;

function LangDemo() {
  const { ref, i } = useTicker(1500, HELLOS.length);
  return (
    <div ref={ref} className="mt-4 flex h-14 items-center justify-between rounded-2xl bg-black/30 px-4 ring-1 ring-white/10">
      <div className="relative h-8 flex-1 overflow-hidden">
        <AnimatePresence initial={false}>
          <motion.span
            key={i}
            className="absolute inset-0 flex items-center font-display text-[22px] font-semibold"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_OUT } }}
            exit={{ opacity: 0, y: -14, transition: { duration: 0.25 } }}
          >
            {HELLOS[i][0]}
          </motion.span>
        </AnimatePresence>
      </div>
      <span className="shrink-0 rounded-full bg-brand-400/15 px-2 py-0.5 text-[11px] text-brand-100 ring-1 ring-brand-300/25">{HELLOS[i][1]} · auto</span>
    </div>
  );
}

const NODES = [
  { x: 180, y: 70, r: 9, t: "Acme" },
  { x: 92, y: 36, r: 6, t: "Priya" },
  { x: 74, y: 108, r: 6, t: "Design sync" },
  { x: 270, y: 34, r: 7, t: "Q3 deck" },
  { x: 292, y: 112, r: 6, t: "Nimbus" },
  { x: 196, y: 128, r: 5, t: "Onboarding" },
  { x: 24, y: 64, r: 4, t: "Rahul" },
  { x: 340, y: 70, r: 4, t: "Pricing" },
];
const EDGES = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 5],
  [1, 2],
  [3, 4],
  [4, 7],
  [2, 6],
  [5, 4],
  [1, 6],
];

function VaultDemo() {
  const [hover, setHover] = useState<number | null>(null);
  const near = (k: number) => hover === null || hover === k || EDGES.some(([a, b]) => (a === hover && b === k) || (b === hover && a === k));
  return (
    <div className="mt-4 overflow-hidden rounded-2xl bg-black/30 ring-1 ring-white/10">
      <svg viewBox="0 0 364 150" className="block w-full" role="img" aria-label="A knowledge graph linking projects, people and meetings">
        {EDGES.map(([a, b], k) => (
          <line
            key={k}
            x1={NODES[a].x}
            y1={NODES[a].y}
            x2={NODES[b].x}
            y2={NODES[b].y}
            stroke="#66ceff"
            strokeWidth="1"
            style={{ opacity: hover === null ? 0.28 : hover === a || hover === b ? 0.8 : 0.08, transition: "opacity .3s" }}
          />
        ))}
        {NODES.map((n, k) => (
          <g key={n.t} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)} style={{ opacity: near(k) ? 1 : 0.3, transition: "opacity .3s", cursor: "pointer" }}>
            <circle cx={n.x} cy={n.y} r={n.r + 6} fill="#3dbbff" className="vault-pulse" style={{ animationDelay: `${k * 0.4}s`, transformOrigin: `${n.x}px ${n.y}px` }} />
            <circle cx={n.x} cy={n.y} r={n.r} fill={k === 0 ? "#c2ecff" : "#66ceff"} />
            <text x={n.x} y={n.y + n.r + 12} textAnchor="middle" fontSize="10" fill="rgb(226 240 255 / 0.75)">
              {n.t}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

const AI = ["Claude", "OpenAI", "Gemini", "Groq", "OpenRouter", "MiniMax", "Qwen", "Ollama Cloud", "Ollama", "LM Studio"];
function ProviderDemo() {
  const row = (items: string[], rev: boolean) => (
    <div className="overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
      <div className={`marquee-track gap-2 ${rev ? "marquee-rev" : ""}`} style={{ animationDuration: "30s" }}>
        {[...items, ...items].map((p, k) => (
          <span key={k} className={`mr-2 inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] ring-1 ${p === "Ollama" || p === "LM Studio" ? "bg-emerald-400/10 text-emerald-200 ring-emerald-300/25" : "bg-white/[0.06] text-white/80 ring-white/12"}`}>
            {p === "Ollama" || p === "LM Studio" ? <Cpu size={12} /> : <KeyRound size={12} className="opacity-60" />}
            {p}
          </span>
        ))}
      </div>
    </div>
  );
  return (
    <div className="mt-4 flex flex-col gap-2">
      {row(AI.slice(0, 5), false)}
      {row(AI.slice(5), true)}
    </div>
  );
}

function TypingDemo() {
  return (
    <div className="mt-4 flex flex-col gap-2 text-[12px]">
      {[
        ["Typing", 42, "#93ddff", 0.28],
        ["Speaking", 150, "#3dbbff", 1],
      ].map(([l, wpm, c, v], k) => (
        <div key={l as string}>
          <div className="mb-1 flex justify-between text-white/65">
            <span>{l}</span>
            <span className="font-mono text-white/90">{wpm} wpm</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="h-full origin-left rounded-full"
              style={{ background: c as string }}
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: v as number }}
              viewport={{ once: true }}
              transition={{ duration: 1.1, delay: 0.2 + k * 0.25, ease: EASE_OUT }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function AnalyticsDemo() {
  const bars = [0.35, 0.55, 0.42, 0.7, 0.62, 0.88, 1];
  return (
    <div className="mt-4">
      <div className="flex h-16 items-end gap-1.5">
        {bars.map((b, k) => (
          <motion.span
            key={k}
            className="flex-1 origin-bottom rounded-t-md bg-gradient-to-t from-brand-600/60 to-brand-300"
            style={{ height: `${b * 100}%` }}
            initial={{ scaleY: 0 }}
            whileInView={{ scaleY: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, delay: 0.1 + k * 0.07, ease: EASE_OUT }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-white/55">
        <span>Mon</span>
        <span className="text-brand-100">2 h 14 m saved this week</span>
        <span>Sun</span>
      </div>
    </div>
  );
}

function HistoryDemo() {
  return (
    <div className="mt-4 rounded-2xl bg-black/30 p-2.5 ring-1 ring-white/10 text-[12px]">
      <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-white/[0.06] px-2 py-1 text-white/70">
        <Search size={12} /> invoice
      </div>
      {[
        ["Slack", "…send the <b>invoice</b> by Friday…", "2 h"],
        ["Mail", "Attached the March <b>invoice</b>…", "Tue"],
      ].map(([a, t, w]) => (
        <div key={a} className="flex items-center gap-2 px-1 py-1 text-white/75">
          <span className="w-9 shrink-0 text-white/45">{a}</span>
          <span className="truncate [&_b]:font-semibold [&_b]:text-brand-200" dangerouslySetInnerHTML={{ __html: t }} />
          <span className="ml-auto shrink-0 text-white/40">{w}</span>
        </div>
      ))}
    </div>
  );
}

function SlackDemo() {
  const [sent, setSent] = useState<null | boolean>(null);
  return (
    <div className="mt-4 rounded-[18px] bg-black p-3 ring-1 ring-white/10">
      {sent === null ? (
        <>
          <div className="flex items-center gap-2 text-[12.5px] font-semibold">
            <MessageSquare size={13} className="text-brand-300" /> Send to Rahul on Slack?
          </div>
          <p className="mt-1 text-[12px] text-white/65">“Invoice is out, should land today.”</p>
          <div className="mt-2 flex justify-end gap-1.5">
            <button type="button" className="upd-btn upd-ghost" onClick={() => setSent(false)}>
              Cancel
            </button>
            <button type="button" className="upd-btn" onClick={() => setSent(true)} data-testid="slack-send">
              Send
            </button>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-between gap-2 py-1 text-[12.5px]">
          <span className="flex items-center gap-2">
            {sent ? <Check size={14} className="text-emerald-300" /> : <RotateCcw size={13} className="text-white/60" />}
            {sent ? "Sent to Rahul" : "Cancelled. Nothing sent."}
          </span>
          <button type="button" className="text-[11px] text-brand-200 hover:text-brand-100" onClick={() => setSent(null)}>
            Replay
          </button>
        </div>
      )}
    </div>
  );
}

const SAYS = ["open Slack", "play lofi on YouTube", "volume up", "google biryani near me", "Spotify kholo"];
function InstantDemo() {
  const { ref, i } = useTicker(1700, SAYS.length);
  return (
    <div ref={ref} className="mt-4 flex h-11 items-center gap-2 overflow-hidden rounded-full bg-black/40 px-3.5 ring-1 ring-white/10">
      <Zap size={13} className="shrink-0 text-brand-300" />
      <div className="relative h-6 flex-1">
        <AnimatePresence initial={false}>
          <motion.span
            key={i}
            className="absolute inset-0 flex items-center truncate text-[13px] text-white/90"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT } }}
            exit={{ opacity: 0, y: -10, transition: { duration: 0.2 } }}
          >
            “{SAYS[i]}”
          </motion.span>
        </AnimatePresence>
      </div>
      <span className="shrink-0 text-[10.5px] text-emerald-300/90">0 tokens</span>
    </div>
  );
}

function AccentDemo() {
  const { demo, setDemo } = useStory();
  const cur = demo.custom.color;
  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Accent colour">
        {PALETTES.map((p, i) => (
          <button
            type="button"
            key={p.name}
            role="radio"
            aria-checked={i === cur}
            aria-label={p.name}
            title={`${p.name}: the notch at the top follows too`}
            onClick={() => setDemo((d) => ({ custom: { ...d.custom, color: i } }))}
            className={`h-7 w-7 cursor-pointer rounded-full transition-transform hover:scale-110 ${i === cur ? "ring-2 ring-white/90 ring-offset-2 ring-offset-[#071a2b]" : "ring-1 ring-white/20"}`}
            style={{ background: p.swatch }}
          />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-white/50">Tap one: the notch on this page changes with it.</p>
    </div>
  );
}

const CUES = ["ready", "working", "done", "error", "notify"];
function SoundDemo() {
  const [on, setOn] = useState(-1);
  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-1.5">
        {SOUNDS.map((s, i) => (
          <button
            type="button"
            key={s}
            aria-pressed={on === i}
            className="chip"
            onClick={() => {
              setOn(i);
              playSound(i);
            }}
          >
            <Volume2 size={11} className={on === i ? "" : "opacity-50"} /> {s}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1 text-[10.5px] text-white/45">
        {CUES.map((c) => (
          <span key={c} className="rounded-full px-1.5 ring-1 ring-white/10">
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

function LookDemo() {
  const { ref, i } = useTicker(1800, STYLES.length);
  const { demo } = useStory();
  const pal = PALETTES[demo.custom.color];
  return (
    <div ref={ref} className="mt-4 flex h-11 items-center gap-3 rounded-full bg-black px-4 ring-1 ring-white/10" style={{ ["--vh" as string]: pal.hi, ["--va" as string]: pal.a, ["--vb" as string]: pal.b }}>
      <Mic size={13} style={{ color: pal.a }} className="shrink-0" />
      <div className="flex flex-1 justify-center overflow-hidden" key={i}>
        <StyleViz style={i} w={130} h={24} />
      </div>
      <span className="w-[74px] shrink-0 truncate text-right text-[10.5px] text-white/60">{STYLES[i]}</span>
    </div>
  );
}

function KeysDemo() {
  return (
    <div className="mt-4 flex flex-col gap-1.5 text-[12px] text-white/70">
      <span className="flex items-center gap-2">
        <Keycap>control</Keycap> hold to dictate
      </span>
      <span className="flex items-center gap-2">
        <Keycap>fn</Keycap> hold for the assistant
      </span>
      <span className="flex items-center gap-2">
        <Keycap>fn</Keycap>
        <Keycap>fn</Keycap> double-tap for hands-free
      </span>
    </div>
  );
}

function NetDemo() {
  return (
    <div className="mt-4 flex flex-col gap-1 font-mono text-[11px]">
      {[
        ["api.anthropic.com", "assistant · 412 tok", true],
        ["localhost:11434", "ollama · local", true],
        ["tracker.example", "blocked", false],
      ].map(([h, w, ok]) => (
        <div key={h as string} className="flex items-center gap-2 rounded-lg bg-black/30 px-2 py-1 ring-1 ring-white/[0.07]">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ok ? "bg-emerald-300" : "bg-red-400"}`} />
          <span className={`truncate ${ok ? "text-white/85" : "text-white/45 line-through"}`}>{h}</span>
          <span className="ml-auto shrink-0 text-white/45">{w}</span>
        </div>
      ))}
    </div>
  );
}

function AgentsDemo() {
  return (
    <div className="mt-4 flex flex-wrap gap-1.5 text-[12px]">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#d97757]/15 px-2.5 py-1 text-[#f3b49b] ring-1 ring-[#d97757]/30">
        <ClaudeMark size={12} /> Claude Code
      </span>
      {["Codex CLI", "Cursor", "Any tool · webhook"].map((a) => (
        <span key={a} className="rounded-full bg-white/[0.06] px-2.5 py-1 text-white/80 ring-1 ring-white/12">
          {a}
        </span>
      ))}
    </div>
  );
}

/* ── the tiles ───────────────────────────────────────────────────────────── */

const TILES: Tile[] = [
  {
    id: "updates",
    cat: "Privacy & setup",
    icon: <RefreshCw size={16} />,
    tag: "New",
    title: "In-app updates: one click, restart, done",
    body: "Flo tells you when a new version is ready. It downloads in the background, checks the signature against the key built into the app, and one restart later you're current.",
    wide: true,
    demo: <UpdateDemo />,
  },
  { id: "languages", cat: "Voice", icon: <Languages size={16} />, title: "7 languages, auto-detected", body: "English, Hindi, Gujarati, Hinglish, Spanish, German and French, each in its own script.", demo: <LangDemo /> },
  { id: "typing", cat: "Voice", icon: <Keyboard size={16} />, title: "Typing test", body: "Measure your real typing speed. Flo uses it to show how much time speaking saves you.", demo: <TypingDemo /> },
  {
    id: "vault",
    cat: "Assistant",
    icon: <Waves size={16} />,
    title: "A memory that draws itself",
    body: "Flo Vault links your projects, people, meetings and topics into a local, Obsidian-style graph as you work. Search it, edit it, and let the assistant draw on it. Hover a node.",
    wide: true,
    demo: <VaultDemo />,
  },
  { id: "instant", cat: "Voice", icon: <Zap size={16} />, title: "Instant commands", body: "Open apps and sites, search, play music and change the volume, handled on your Mac with no AI call.", demo: <InstantDemo /> },
  { id: "slack", cat: "Work", icon: <MessageSquare size={16} />, title: "Slack, handled", body: "Unanswered DMs and @mentions become to-dos. Reply by voice; nothing sends until you confirm in the notch.", demo: <SlackDemo /> },
  { id: "analytics", cat: "Work", icon: <BarChart3 size={16} />, title: "Analytics", body: "Words dictated, time saved, streaks and speaking pace over 7, 30 or 60 days.", demo: <AnalyticsDemo /> },
  { id: "history", cat: "Work", icon: <History size={16} />, title: "Searchable history", body: "Every dictation and every answer, kept on your Mac and one search away.", demo: <HistoryDemo /> },
  {
    id: "providers",
    cat: "Assistant",
    icon: <Bot size={16} />,
    title: "Any AI: your key, or none at all",
    body: "Bring a key for Claude, OpenAI, Gemini, Groq, OpenRouter, MiniMax, Qwen or Ollama Cloud, or run fully local with Ollama and LM Studio. Pick a model per feature.",
    wide: true,
    demo: <ProviderDemo />,
  },
  { id: "accent", cat: "Notch", icon: <Palette size={16} />, title: "One accent, everywhere", body: "Pick any colour. Buttons, charts, the logo and the notch all follow it.", demo: <AccentDemo /> },
  { id: "sounds", cat: "Notch", icon: <Volume2 size={16} />, title: "Sounds you choose", body: "Chime, Glass, Soft or Pop, set separately for each cue. Tap to hear them.", demo: <SoundDemo /> },
  { id: "look", cat: "Notch", icon: <Sparkles size={16} />, title: "15 animations, 4 sizes", body: "From Ribbon to Constellation, Small to Biggest. Text in the notch grows with it.", demo: <LookDemo /> },
  { id: "agents", cat: "Assistant", icon: <AppWindow size={16} />, title: "Every coding agent", body: "Claude Code, Codex CLI and Cursor sessions in the notch tray, plus any tool through a local webhook.", demo: <AgentsDemo /> },
  { id: "deeper", cat: "Assistant", icon: <Globe size={16} />, title: "Go deeper, or search the web", body: "Every quick answer offers a deeper look at your screen, a web search, or the full answer in the app." },
  { id: "knowledge", cat: "Assistant", icon: <BookText size={16} />, title: "Knowledge docs", body: "Pin notes and docs and set your own system prompt. Only the relevant pieces are sent with a request, so tokens stay low." },
  { id: "notes", cat: "Work", icon: <NotebookPen size={16} />, title: "Meeting library", body: "Every meeting with its summary, action items and transcript. Rename a speaker once and Flo knows the voice next time." },
  { id: "todos", cat: "Work", icon: <ListChecks size={16} />, title: "To-dos, in detail", body: "Details, due dates, snooze, and bulk complete or delete. Every to-do says where it came from." },
  { id: "attention", cat: "Work", icon: <ScanEye size={16} />, title: "Spots to-dos on screen", body: "On-device OCR reads the window you're in for things you've promised. Screenshots are never saved, and you can pause it any time." },
  { id: "shortcuts", cat: "Voice", icon: <Keyboard size={16} />, title: "Your keys, your way", body: "Remap dictation and the assistant to the keys you like. If macOS grabs fn, one click fixes it.", demo: <KeysDemo /> },
  { id: "speech", cat: "Voice", icon: <Activity size={16} />, title: "Choose your speech engine", body: "On-device Whisper by default, with models you download and remove in Settings. Or Groq or OpenAI Whisper with your own key." },
  { id: "network", cat: "Privacy & setup", icon: <Network size={16} />, title: "Network log", body: "Every request Flo makes: which host, why, and how many tokens. Anything off the allow-list is blocked.", demo: <NetDemo /> },
  { id: "encrypted", cat: "Privacy & setup", icon: <Database size={16} />, title: "Encrypted on disk", body: "History, notes and to-dos live in an encrypted database. Its key and your API keys stay in the macOS Keychain." },
  { id: "permissions", cat: "Privacy & setup", icon: <ShieldCheck size={16} />, title: "Permissions, fixed for you", body: "Flo checks microphone, accessibility and screen access, and repairs them in one click when macOS forgets." },
  { id: "platforms", cat: "Privacy & setup", icon: <LayoutGrid size={16} />, title: "Mac, Windows and Linux", body: "Off the Mac, the island sits bottom-right. Hold Right Ctrl to dictate and Right Alt for the assistant." },
  { id: "account", cat: "Privacy & setup", icon: <UserRound size={16} />, title: "An account that holds nothing", body: "Sign in only to download. Your dictation, notes, to-dos and keys never touch our servers." },
];

export function Everything() {
  const [cat, setCat] = useState<(typeof CATS)[number]>("All");
  const tiles = cat === "All" ? TILES : TILES.filter((t) => t.cat === cat);
  return (
    <section className="px-5 pb-12 pt-28" id="everything" data-testid="everything">
      <SectionHead
        eyebrow="Everything Flo does"
        title="And everything else, in one app."
        accent="everything else,"
        sub="The notch story covers the big moments. Here is the rest of what ships in Flo today."
      />
      <div className="mx-auto mt-10 flex max-w-6xl justify-center">
        <div className="bento-tabs flex max-w-full gap-1 overflow-x-auto rounded-full bg-white/[0.05] p-1 ring-1 ring-white/12" role="tablist" aria-label="Filter features">
          {CATS.map((c) => {
            const n = c === "All" ? TILES.length : TILES.filter((t) => t.cat === c).length;
            return (
              <button type="button" key={c} role="tab" aria-selected={cat === c} onClick={() => setCat(c)} className={`seg shrink-0 whitespace-nowrap px-3.5 ${cat === c ? "is-on" : ""}`} data-testid={`bento-tab-${c.split(" ")[0].toLowerCase()}`}>
                {c} <span className="ml-0.5 text-[11px] opacity-60">{n}</span>
              </button>
            );
          })}
        </div>
      </div>
      <motion.div layout className="mx-auto mt-8 grid max-w-6xl grid-flow-dense grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <AnimatePresence mode="popLayout" initial={false}>
          {tiles.map((t, k) => (
            <motion.article
              layout
              key={t.id}
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.55, delay: Math.min(k, 8) * 0.04, ease: EASE_OUT }}
              className={`bento-tile relative flex min-w-0 flex-col rounded-[26px] p-5 ${t.wide ? "sm:col-span-2" : ""} ${t.id === "updates" ? "bento-feature" : ""}`}
              data-testid={`tile-${t.id}`}
            >
              <div className="flex items-center gap-2.5">
                <span className="bento-ico flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-brand-200">{t.icon}</span>
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/45">{t.cat}</span>
                {t.tag && <span className="ml-auto rounded-full bg-brand-300/20 px-2 py-0.5 text-[10.5px] font-semibold text-brand-100 ring-1 ring-brand-300/40">{t.tag}</span>}
              </div>
              <h3 className={`mt-3.5 font-display font-semibold leading-snug tracking-tight text-ink ${t.wide ? "text-[20px]" : "text-[16.5px]"}`}>{t.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{t.body}</p>
              {t.demo && <div className="mt-auto">{t.demo}</div>}
            </motion.article>
          ))}
        </AnimatePresence>
      </motion.div>
      <p className="mx-auto mt-6 flex max-w-6xl items-center justify-center gap-2 text-[12.5px] text-white/50">
        <Lock size={12} /> Everything above runs on your Mac unless you choose a cloud provider with your own key.
      </p>
    </section>
  );
}
