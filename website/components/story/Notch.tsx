"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  BatteryMedium,
  BellRing,
  CalendarClock,
  CalendarDays,
  Check,
  Clock,
  CloudSun,
  FileText,
  ListTodo,
  Mic,
  Monitor,
  MessageSquare,
  Pause,
  Play,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Sparkles as SparkIcon,
  Square,
  Undo2,
  Video,
  X,
} from "lucide-react";
import { CHAPTER_INDEX, CHAPTERS, DEADLINES, LANGS, PALETTES, PROMPTS, SIZES, STYLES, WIDGETS, type ChapterId } from "./chapters";
import { DEFAULT_DEMO, derive, useStory, type Derived } from "./StoryContext";
import { ClaudeMark, Dots, Keycap, StyleViz, Timer, Typewriter, VoiceBars } from "./viz";

type Size = { w: number; h: number; r: number };
const S = (w: number, h: number, r: number): Size => ({ w, h, r });

/** Exact notch geometry for every chapter/phase/demo state. Content below is laid out to fit these boxes. */
export function notchSize(id: ChapterId | "idle", phase: number, bar = true, d?: Derived): Size {
  const s = baseSize(id, phase, d ?? derive(id, phase, 0, DEFAULT_DEMO, false));
  // expanded cards start below the camera housing, like the real notch
  return bar && s.h >= EXPANDED ? { ...s, h: s.h + BAR_PAD } : s;
}
const EXPANDED = 80;
const BAR_PAD = 26;

/** Widget grid shape for `n` widgets turned on. */
function widgetGrid(n: number) {
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  return { cols, rows: Math.ceil(n / cols) };
}

const CUSTOM_SIZES = [S(330, 52, 20), S(370, 58, 22), S(420, 64, 24), S(470, 70, 26)];
const CUSTOM_VIZ_W = [180, 215, 255, 300];

function baseSize(id: ChapterId | "idle", phase: number, d: Derived): Size {
  switch (id) {
    case "hero":
      return phase === 0 ? S(232, 36, 14) : S(316, 42, 17);
    case "dictation":
      return [S(390, 58, 22), S(272, 44, 18), S(276, 42, 17)][phase];
    case "languages":
      return [S(400, 58, 22), S(272, 44, 18), S(320, 44, 18)][phase];
    case "assistant":
      return [S(450, 86, 26), S(450, 86, 26), S(360, 44, 18)][phase];
    case "learns":
      if (phase === 2 && d.learned === "undone") return S(350, 44, 18);
      return [S(260, 40, 16), S(450, 122, 28), S(330, 44, 18)][phase];
    case "todos":
      return phase === 0 ? S(360, 38, 15) : S(430, 218, 30);
    case "deadlines":
      if (phase === 2 && d.reminder !== "ring") return S(380, 44, 18);
      return [S(380, 44, 18), S(430, 112, 28), S(440, 120, 28)][phase];
    case "meetings":
      return phase === 0 ? S(330, 44, 18) : S(460, 222, 30);
    case "claude":
      if (phase === 2 && d.claude !== "ask") return S(400, 44, 18);
      return [S(330, 38, 15), S(420, 88, 26), S(450, 120, 28)][phase];
    case "widgets": {
      const n = d.widgets.filter(Boolean).length;
      if (n === 0) return S(340, 44, 18);
      const { cols, rows } = widgetGrid(n);
      return S(cols === 1 ? 300 : cols === 2 ? 540 : 690, rows === 1 ? 150 : 268, 32);
    }
    case "custom":
      return CUSTOM_SIZES[d.size] ?? CUSTOM_SIZES[1];
    case "privacy":
      return S(460, 184, 30);
    default:
      return S(204, 34, 13);
  }
}

/** The tallest the notch gets in a chapter (to keep chapter copy clear of it). */
export function maxNotchH(id: ChapterId) {
  const c = CHAPTERS[CHAPTER_INDEX[id]];
  return Math.max(...c.phases.map((_, p) => notchSize(id, p).h));
}

/** The concave "ears" where the notch flows into the top edge. */
function Ear({ side }: { side: "l" | "r" }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" className={`absolute top-0 ${side === "l" ? "-left-[11.5px]" : "-right-[11.5px] -scale-x-100"}`} aria-hidden>
      <path d="M0 0H12V12A12 12 0 0 0 0 0Z" fill="#000" />
    </svg>
  );
}

const SPRING = { type: "spring", stiffness: 300, damping: 32, mass: 0.9 } as const;

export function NotchShell({
  size,
  inline,
  reduce,
  glow,
  d,
  id,
  onHover,
  children,
}: {
  size: Size;
  inline?: boolean;
  reduce?: boolean;
  glow?: boolean;
  d?: Derived;
  id?: ChapterId | "idle";
  onHover?: (on: boolean) => void;
  children: React.ReactNode;
}) {
  const rim = "0 0 0 1px rgb(102 206 255 / 0.10), 0 10px 34px -8px rgb(61 187 255 / 0.38), 0 24px 60px -20px rgb(0 0 0 / 0.9), inset 0 -1px 0 rgb(150 220 255 / 0.22)";
  const pal = PALETTES[d?.color ?? 0];
  const vars = { ["--vh" as string]: pal.hi, ["--va" as string]: pal.a, ["--vb" as string]: pal.b };
  const data = {
    "data-notch": id ?? "idle",
    "data-style": d ? STYLES[d.style] : undefined,
    "data-size": d ? SIZES[d.size] : undefined,
    "data-color": pal.name,
  };
  if (inline) {
    return (
      <div className="relative mx-auto w-full" style={{ maxWidth: size.w, ...vars }} {...data}>
        <div className="relative overflow-hidden bg-black text-white" style={{ minHeight: size.h, borderRadius: `0 0 ${size.r}px ${size.r}px`, boxShadow: rim }}>
          <span aria-hidden className="notch-inner" />
          {children}
          <span aria-hidden className="notch-rim" />
        </div>
      </div>
    );
  }
  return (
    <div className="relative" style={vars} {...data} data-testid="notch">
      {/* layered glow: a wide soft halo plus a tight bright core under the notch */}
      <div aria-hidden className={`notch-halo absolute -bottom-10 left-1/2 h-16 w-[130%] -translate-x-1/2 rounded-full bg-brand-500/20 blur-2xl transition-opacity duration-700 ${glow ? "opacity-100" : "opacity-40"}`} />
      {glow && <div aria-hidden className="notch-breathe absolute -bottom-4 left-1/2 h-8 w-[70%] -translate-x-1/2 rounded-full bg-brand-400/45 blur-xl" />}
      <Ear side="l" />
      <Ear side="r" />
      <motion.div
        className="pointer-events-auto relative overflow-hidden bg-black text-white"
        style={{ boxShadow: rim }}
        initial={false}
        animate={{ width: size.w, height: size.h, borderBottomLeftRadius: size.r, borderBottomRightRadius: size.r }}
        transition={reduce ? { duration: 0 } : SPRING}
        onMouseEnter={onHover ? () => onHover(true) : undefined}
        onMouseLeave={onHover ? () => onHover(false) : undefined}
      >
        <span aria-hidden className="notch-inner" />
        {children}
        <span aria-hidden className="notch-rim" />
      </motion.div>
    </div>
  );
}

/** Cross-fades between content states (opacity + small translate only). */
export function Swap({ k, inline, top = 0, children }: { k: string; inline?: boolean; top?: number; children: React.ReactNode }) {
  if (inline) return <div className="relative flex w-full py-1.5" style={{ minHeight: "inherit" }}>{children}</div>;
  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={k}
        className="absolute inset-x-0 bottom-0"
        style={{ top }}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.32, delay: 0.1, ease: [0.16, 1, 0.3, 1] } }}
        exit={{ opacity: 0, y: -4, transition: { duration: 0.14 } }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

const Row = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`flex h-full w-full items-center gap-3 px-5 ${className}`}>{children}</div>
);
const Ok = () => (
  <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-black" style={{ background: "var(--va, #66ceff)" }}>
    <Check size={11} strokeWidth={3.2} />
  </span>
);
const Muted = ({ children }: { children: React.ReactNode }) => <span className="text-white/55">{children}</span>;

/** A notch button. Real <button>s: every one of them does something. */
function Btn({ children, primary, onClick, label, testId }: { children: React.ReactNode; primary?: boolean; onClick: () => void; label?: string; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-testid={testId}
      className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-[transform,filter,background-color] duration-150 hover:brightness-110 active:scale-95 ${
        primary ? "bg-gradient-to-b from-brand-200 to-brand-400 text-[#001522]" : "bg-white/[0.1] text-white/90 ring-1 ring-white/15 hover:bg-white/[0.16]"
      }`}
    >
      {children}
    </button>
  );
}

export const TODOS = [
  { t: "Send the Q3 deck to Priya", why: "You said “I'll send it tonight” on Zoom · 11:20", icon: Video },
  { t: "Reply to Rahul about the invoice", why: "Unanswered Slack DM · 2 h ago", icon: MessageSquare },
  { t: "Review Aditi's PR #482", why: "Review requested, seen on screen in GitHub", icon: Monitor },
];

const HOSTS = [
  ["api.anthropic.com", "your key", true, "Claude, with the key in your Keychain"],
  ["localhost:11434", "Ollama", true, "Local models, never leaves this Mac"],
  ["huggingface.co", "model download", true, "One-time Whisper model download"],
  ["ads.tracker.io", "not on the list", false, "Blocked: not on your allow-list"],
] as const;

/** What the notch shows for chapter `id` at `phase`. `inline` = mobile, in-flow copy. */
export function NotchContent({ id, phase, cycle, inline, d }: { id: ChapterId | "idle"; phase: number; cycle: number; inline?: boolean; d: Derived }) {
  const { interact, setPhase, setDemo } = useStory();
  const ch = id === "idle" ? -1 : CHAPTER_INDEX[id];
  // privacy rows highlight in place (hovering them must not re-mount the list)
  const key = id === "privacy" ? id : `${id}-${phase}-${cycle}-${d.learned}-${d.reminder}-${d.claude}`;
  const lang = LANGS[d.lang % LANGS.length];
  const drive = () => interact(ch);
  let body: React.ReactNode = null;

  switch (id) {
    case "hero":
      body =
        phase === 0 ? (
          <Row className="justify-between px-4">
            <span className="mini-eq" aria-hidden>
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className="notch-led" aria-hidden />
          </Row>
        ) : (
          <Row className="justify-center gap-2.5 text-[12.5px] font-medium tracking-[-0.005em] text-white/85">
            <VoiceBars n={7} h={15} w={2.5} gap={2} energy={0.7} />
            <span className="flex items-center gap-1.5">
              Hold <span className="kcap">fn</span> to talk
            </span>
          </Row>
        );
      break;

    case "dictation":
    case "languages":
      if (phase === 0)
        body = (
          <Row>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-400/15 text-brand-200 ring-1 ring-brand-300/25">
              <Mic size={15} />
            </span>
            <div className="flex flex-1 justify-center overflow-hidden">
              <VoiceBars n={inline ? 18 : 26} h={26} />
            </div>
            {id === "languages" ? <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[11px] text-white/70 ring-1 ring-white/10">auto</span> : <Keycap pressed>fn</Keycap>}
          </Row>
        );
      else if (phase === 1)
        body = (
          <Row className="justify-center text-[13px] text-white/85">
            <Dots /> Transcribing…
          </Row>
        );
      else
        body =
          id === "dictation" ? (
            <Row className="justify-center text-[13px]">
              <Ok /> Typed in Slack <Muted>· 0.2 s</Muted>
            </Row>
          ) : (
            <Row className="justify-center text-[13px]">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-400/20 text-[14px] text-brand-100">{lang.glyph}</span>
              {lang.name} <Muted>detected · typed</Muted>
            </Row>
          );
      break;

    case "assistant":
      if (phase === 0)
        body = (
          <div className="flex h-full flex-col justify-center gap-2 px-5">
            <div className="flex items-center gap-2 text-[11.5px] text-white/60">
              <Keycap pressed>control</Keycap> Assistant is listening
              <span className="ml-auto">
                <VoiceBars n={10} h={16} w={2.5} gap={2} />
              </span>
            </div>
            <Typewriter text={PROMPTS[d.prompt].say} speed={45} className="text-[15px] text-white" />
          </div>
        );
      else if (phase === 1)
        body = (
          <div className="flex h-full flex-col justify-center gap-2 px-5">
            <div className="flex items-center gap-2 text-[12.5px] text-white/85">
              <SparkIcon size={14} className="text-brand-300" /> Reading #team-general <Dots />
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {["14 messages", "Hinglish", "warm, festive", "Priya, Rahul"].map((c, i) => (
                <span key={c} className="chip-in rounded-full bg-brand-400/12 px-2 py-0.5 text-brand-100 ring-1 ring-brand-300/20" style={{ animationDelay: `${0.25 + i * 0.3}s` }}>
                  {c}
                </span>
              ))}
            </div>
          </div>
        );
      else
        body = (
          <Row className="justify-center text-[13px]">
            <Ok /> {d.prompt === 1 ? "Summary typed into #team-general" : "Draft typed into #team-general"}
          </Row>
        );
      break;

    case "learns":
      if (phase === 0)
        body = (
          <Row className="justify-center text-[12.5px] text-white/75">
            <Ok /> Typed in Slack
          </Row>
        );
      else if (phase === 1)
        body = (
          <div className="flex h-full flex-col justify-center gap-2.5 px-5 py-3">
            <div className="flex items-center gap-2 text-[14px] font-semibold">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.svg" alt="" className="h-5 w-5 rounded-md" /> Sorry, my mistake
            </div>
            <div className="text-[13px] text-white/80">
              Updated: <s className="text-white/45 decoration-red-400/70">tory</s> <span className="text-white/45">→</span> <span className="font-semibold text-brand-200">Tauri</span> from now on
            </div>
            <div className="flex justify-end gap-2">
              <Btn
                testId="learn-undo"
                onClick={() => {
                  drive();
                  setDemo({ learned: "undone" });
                  setPhase(ch, 2);
                }}
              >
                <Undo2 size={12} /> Undo
              </Btn>
              <Btn
                primary
                testId="learn-ok"
                onClick={() => {
                  drive();
                  setDemo({ learned: "kept" });
                  setPhase(ch, 2, true);
                }}
              >
                Got it
              </Btn>
            </div>
          </div>
        );
      else
        body =
          d.learned === "undone" ? (
            <Row className="justify-center text-[13px]">
              <Undo2 size={14} className="text-white/60" /> Undone. Flo keeps writing <span className="font-semibold">tory</span>
            </Row>
          ) : (
            <Row className="justify-center text-[13px]">
              <SparkIcon size={14} className="text-brand-300" /> Heard “Tauri”, wrote <span className="font-semibold text-brand-200">Tauri</span>
            </Row>
          );
      break;

    case "todos": {
      const left = d.todos.filter((x) => !x).length;
      const tray = (
        <div className="flex h-[38px] items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label={phase > 0 ? "Close to-dos" : "Open to-dos"}
              aria-expanded={phase > 0}
              data-testid="todo-tray"
              onClick={() => {
                drive();
                setPhase(ch, phase > 0 ? 0 : 1);
              }}
              className={`relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-white/[0.16] ${phase > 0 ? "bg-white/[0.12]" : ""}`}
            >
              <ListTodo size={16} className="text-[#f1e3c6]" />
              <span className="absolute -right-1 -top-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-brand-400 px-1 text-[9.5px] font-bold text-black">{left}</span>
              {phase === 0 && !inline && <Pointer className="pointer-in pointer-events-none absolute left-3 top-3" />}
            </button>
            <ClaudeMark size={15} />
          </div>
          <div className="flex items-center gap-3 text-white/50">
            <CalendarClock size={15} />
            <Mic size={15} />
          </div>
        </div>
      );
      body =
        phase === 0 ? (
          tray
        ) : (
          <div className="flex h-full flex-col">
            {tray}
            <div className="beige mx-3 mb-3 flex-1 rounded-[20px] p-3.5">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[13px] font-bold">To-dos</span>
                <span className="text-[11px] opacity-70">{left === 3 ? "3 today" : left === 0 ? "all done 🎉" : `${left} left`}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {TODOS.map((td, i) => {
                  const done = d.todos[i];
                  return (
                    <button
                      type="button"
                      key={td.t}
                      role="checkbox"
                      aria-checked={done}
                      data-testid={`todo-${i}`}
                      onClick={() => {
                        drive();
                        setDemo({ todos: d.todos.map((v, k) => (k === i ? !v : v)) });
                      }}
                      className="-mx-1.5 flex cursor-pointer gap-2.5 rounded-xl px-1.5 py-0.5 text-left transition-colors hover:bg-[#7a5d2e]/10"
                    >
                      <span className={`mt-[2px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors ${done ? "border-[#7a5d2e] bg-[#7a5d2e] text-[#f4ead7]" : "border-[#a58c62]"}`}>
                        {done && <Check size={10} strokeWidth={3.4} />}
                      </span>
                      <span className={`min-w-0 transition-opacity duration-500 ${done ? "opacity-45" : ""}`}>
                        <span className={`block text-[12.5px] font-semibold leading-tight ${done ? "line-through" : ""}`}>{td.t}</span>
                        <span className="mt-0.5 flex items-center gap-1 text-[10.5px] leading-tight opacity-70">
                          <td.icon size={10} className="shrink-0" /> {td.why}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      break;
    }

    case "deadlines": {
      const dl = DEADLINES[d.deadline];
      if (phase === 0)
        body = (
          <Row className="justify-center text-[12.5px] text-white/85">
            <CalendarClock size={15} className="text-brand-300" /> Deadline heard: <span className="text-brand-200">“{dl.say}”</span>
          </Row>
        );
      else if (phase === 1)
        body = (
          <div className="flex h-full flex-col justify-center gap-2 px-4">
            <div className="flex items-center gap-1.5 px-1 text-[11px] text-white/60">
              <ListTodo size={12} /> Added to Reminders
            </div>
            <div className="beige flex items-center gap-2.5 rounded-2xl px-3 py-2.5">
              <span className="h-4 w-4 shrink-0 rounded-full border-[1.5px] border-[#a58c62]" />
              <span className="text-[13px] font-semibold">Send requirements to client</span>
              <span className="ml-auto shrink-0 rounded-full bg-[#7a5d2e] px-2 py-0.5 text-[10.5px] font-semibold text-[#f4ead7]" data-testid="deadline-due">
                due {dl.due}
              </span>
            </div>
          </div>
        );
      else if (d.reminder === "snoozed")
        body = (
          <Row className="justify-center text-[13px]">
            <Clock size={14} className="text-brand-300" /> Snoozed <Muted>· back in 10 minutes</Muted>
          </Row>
        );
      else if (d.reminder === "done")
        body = (
          <Row className="justify-center text-[13px]">
            <Ok /> Done. One less thing to remember.
          </Row>
        );
      else
        body = (
          <div className="flex h-full flex-col justify-center gap-2 px-5">
            <div className="flex items-center gap-2 text-[11.5px] text-amber-200">
              <BellRing size={13} className="bell-ring" /> Reminder · due {dl.ring}
            </div>
            <div className="text-[15px] font-semibold">Send requirements to client</div>
            <div className="flex justify-end gap-2">
              <Btn
                testId="remind-snooze"
                onClick={() => {
                  drive();
                  setDemo({ reminder: "snoozed" });
                  setPhase(ch, 2);
                }}
              >
                <Clock size={12} /> 10 min
              </Btn>
              <Btn
                primary
                testId="remind-done"
                onClick={() => {
                  drive();
                  setDemo({ reminder: "done" });
                  setPhase(ch, 2);
                }}
              >
                <Check size={12} strokeWidth={3} /> Done
              </Btn>
            </div>
          </div>
        );
      break;
    }

    case "meetings":
      body =
        phase === 0 ? (
          <Row className="text-[12.5px]">
            <button
              type="button"
              aria-label="Stop recording"
              data-testid="notch-rec-stop"
              onClick={() => {
                drive();
                setPhase(ch, 1);
              }}
              className="group flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full bg-red-500/15 ring-1 ring-red-400/40 transition-colors hover:bg-red-500/30"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-red-500 group-hover:hidden" style={{ animation: "flo-glow 1.2s ease-in-out infinite", boxShadow: "0 0 10px rgb(239 68 68 / 0.8)" }} />
              <Square size={9} className="hidden fill-red-400 text-red-400 group-hover:block" />
            </button>
            <span className="text-white/90">Recording</span>
            <span className="text-white/60">
              <Timer from={24 * 60 + 7} />
            </span>
            <span className="ml-auto">
              <VoiceBars n={12} h={18} w={2.5} gap={2} energy={0.85} />
            </span>
          </Row>
        ) : (
          <div className="flex h-full flex-col gap-2.5 px-5 py-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              <FileText size={14} className="text-brand-300" /> Design sync <Muted>· 24 min · 3 people</Muted>
            </div>
            <p className="text-[12.5px] leading-snug text-white/80">Onboarding v2 ships next sprint. The pricing page waits for legal sign-off. Client needs requirements before Monday.</p>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-brand-300/90">Action items</div>
            <div className="flex flex-col gap-1.5">
              {[
                ["P", "Priya", "Finish the onboarding deck", "Thu", "#f59e9e"],
                ["R", "Rahul", "Share the API timeline", "Fri", "#9ee2b8"],
                ["Y", "You", "Send requirements to client", "Mon", "#66ceff"],
              ].map(([a, who, what, when, c], i) => (
                <div key={who} className="chip-in flex items-center gap-2 text-[12.5px]" style={{ animationDelay: `${0.2 + i * 0.18}s` }}>
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-black" style={{ background: c }}>
                    {a}
                  </span>
                  <span className="text-white/90">{what}</span>
                  <span className="ml-auto text-white/55">
                    {who} · {when}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      break;

    case "claude":
      if (phase === 0)
        body = (
          <div className="flex h-full items-center justify-between px-4 text-[12px]">
            <span className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.08]">
              <span className="spin-slow">
                <ClaudeMark size={16} />
              </span>
              <span className="absolute -right-1 -top-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[#d97757] px-1 text-[9.5px] font-bold text-black">3</span>
            </span>
            <span className="text-white/65">2 running · 1 waiting on tests</span>
          </div>
        );
      else if (phase === 1)
        body = (
          <div className="flex h-full items-center gap-3 px-5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#d97757]/15 ring-1 ring-[#d97757]/30">
              <ClaudeMark size={18} />
            </span>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold">
                Claude finished <Muted>· Flo</Muted>
              </div>
              <div className="truncate text-[11.5px] text-white/60">{d.opened ? "Opened the session in your terminal" : "6 files changed · tests passed · 4m 12s"}</div>
            </div>
            <span className="ml-auto">
              <Btn
                primary
                testId="claude-open"
                onClick={() => {
                  drive();
                  setDemo({ opened: true });
                  setPhase(ch, 1);
                }}
              >
                {d.opened ? <Check size={12} strokeWidth={3} /> : null}
                {d.opened ? "Opened" : "Open"}
              </Btn>
            </span>
          </div>
        );
      else if (d.claude !== "ask")
        body = (
          <Row className="justify-center text-[13px]" >
            {d.claude === "allowed" ? (
              <>
                <Ok /> Allowed <span className="font-mono text-[12px] text-white/80">npm publish</span> <Muted>· Claude continues</Muted>
              </>
            ) : (
              <>
                <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-red-400/90 text-black">
                  <X size={11} strokeWidth={3.2} />
                </span>
                Denied <Muted>· Claude will ask another way</Muted>
              </>
            )}
          </Row>
        );
      else
        body = (
          <div className="flex h-full flex-col justify-center gap-2 px-5">
            <div className="flex items-center gap-2 text-[13.5px] font-semibold">
              <span className="h-2 w-2 rounded-full bg-amber-400" style={{ animation: "flo-glow 1.2s ease-in-out infinite" }} />
              Claude needs you <Muted>· api</Muted>
            </div>
            <div className="rounded-lg bg-white/[0.06] px-2.5 py-1.5 font-mono text-[12px] text-white/90 ring-1 ring-white/10">Allow npm publish?</div>
            <div className="flex justify-end gap-2">
              <Btn
                testId="claude-deny"
                onClick={() => {
                  drive();
                  setDemo({ claude: "denied" });
                  setPhase(ch, 2);
                }}
              >
                <X size={12} strokeWidth={3} /> Deny
              </Btn>
              <Btn
                primary
                testId="claude-allow"
                onClick={() => {
                  drive();
                  setDemo({ claude: "allowed" });
                  setPhase(ch, 2);
                }}
              >
                <Check size={12} strokeWidth={3} /> Allow
              </Btn>
            </div>
          </div>
        );
      break;

    case "widgets": {
      const on = WIDGETS.map((w, i) => (d.widgets[i] ? i : -1)).filter((i) => i >= 0);
      if (on.length === 0) {
        body = (
          <Row className="justify-center text-[12.5px] text-white/70">
            <SparkIcon size={14} className="text-brand-300" /> No widgets on. Pick some to fill the notch.
          </Row>
        );
        break;
      }
      const { cols } = widgetGrid(on.length);
      body = (
        <div className={`grid h-full gap-2 p-3 ${inline ? "grid-cols-1 sm:grid-cols-2" : ""}`} style={{ gridTemplateColumns: inline ? undefined : `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "1fr" }} data-widgets={on.length}>
          {on.map((i) => (
            <Widget key={WIDGETS[i]} i={i} d={d} onToggle={() => {
              drive();
              setDemo((x) => ({ playing: !x.playing }));
            }} />
          ))}
        </div>
      );
      break;
    }

    case "custom": {
      const vw = inline ? 170 : CUSTOM_VIZ_W[d.size] ?? 215;
      body = (
        <Row className="justify-between">
          <Mic size={15} className="shrink-0" style={{ color: "var(--va)" }} />
          <div className="flex flex-1 justify-center" key={d.style}>
            <StyleViz style={d.style} w={vw} h={[28, 32, 34, 38][d.size] ?? 32} />
          </div>
          <span className="w-12 shrink-0 text-right text-[10.5px] text-white/60">{STYLES[d.style].split(" ")[0]}</span>
        </Row>
      );
      break;
    }

    case "privacy":
      body = (
        <div className="flex h-full flex-col px-4 py-3.5">
          <div className="mb-2 flex items-center gap-2 px-1 text-[12.5px] font-semibold">
            <ShieldCheck size={14} className="text-brand-300" /> Network allow-list
            <span className="ml-auto text-[11px] font-normal text-white/55">{HOSTS[phase]?.[3] ?? "3 allowed · 1 blocked"}</span>
          </div>
          {HOSTS.map(([h, why, ok], i) => (
            <button
              type="button"
              key={h}
              data-testid={`host-${i}`}
              onMouseEnter={() => {
                drive();
                setPhase(ch, i);
              }}
              onFocus={() => {
                drive();
                setPhase(ch, i);
              }}
              onClick={() => {
                drive();
                setPhase(ch, i);
              }}
              className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-[7px] text-left text-[12.5px] transition-colors duration-300 ${i === phase ? (ok ? "bg-brand-400/12 ring-1 ring-brand-300/25" : "bg-red-500/10 ring-1 ring-red-400/25") : "hover:bg-white/[0.05]"}`}
            >
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${ok ? "bg-brand-300/20 text-brand-200" : "bg-red-500/20 text-red-300"}`}>
                {ok ? <Check size={10} strokeWidth={3.2} /> : <X size={10} strokeWidth={3.2} />}
              </span>
              <span className={`font-mono ${ok ? "text-white/90" : "text-white/55 line-through"}`}>{h}</span>
              <span className="ml-auto text-[11px] text-white/55">{why}</span>
            </button>
          ))}
        </div>
      );
      break;
  }

  return (
    <Swap k={key} inline={inline} top={baseSize(id, phase, d).h >= EXPANDED ? BAR_PAD : 0}>
      {body}
    </Swap>
  );
}

function Widget({ i, d, onToggle }: { i: number; d: Derived; onToggle: () => void }) {
  switch (i) {
    case 0:
      return (
        <div className="flex min-w-0 items-center gap-3 rounded-[18px] bg-white/[0.07] p-3 ring-1 ring-white/10">
          <span className={`h-14 w-14 shrink-0 rounded-xl ${d.playing ? "spin-art" : ""}`} style={{ background: "conic-gradient(from 210deg,#1a9be0,#c2ecff,#3dbbff,#083a57,#1a9be0)" }} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">Midnight City</div>
            <div className="truncate text-[11px] text-white/60">M83 · {d.playing ? "Now playing" : "Paused"}</div>
            <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-white/10">
              <div className="np-progress h-full w-full origin-left rounded-full bg-brand-300" style={{ animationPlayState: d.playing ? "running" : "paused" }} />
            </div>
            <div className="mt-1.5 flex items-center gap-3 text-white/75">
              <SkipBack size={12} />
              <button type="button" onClick={onToggle} aria-label={d.playing ? "Pause" : "Play"} data-testid="np-toggle" className="-m-1 cursor-pointer rounded-full p-1 transition-colors hover:bg-white/15 hover:text-white">
                {d.playing ? <Pause size={13} /> : <Play size={13} />}
              </button>
              <SkipForward size={12} />
            </div>
          </div>
        </div>
      );
    case 1:
      return (
        <div className="beige min-w-0 rounded-[18px] p-3">
          <div className="mb-1.5 flex justify-between text-[12px] font-bold">
            Today <span className="font-medium opacity-70">3</span>
          </div>
          {["Send the Q3 deck", "Reply to Rahul", "Requirements · Mon"].map((t, k) => (
            <div key={t} className="flex items-center gap-2 py-[2px] text-[11.5px]">
              <span className={`h-3 w-3 shrink-0 rounded-full border-[1.5px] border-[#a58c62] ${k === 0 ? "bg-[#7a5d2e]" : ""}`} />
              <span className={`truncate ${k === 0 ? "line-through opacity-60" : ""}`}>{t}</span>
            </div>
          ))}
        </div>
      );
    case 2:
      return (
        <div className="beige min-w-0 rounded-[18px] p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold">
            <ClaudeMark size={12} /> Claude
          </div>
          {[
            ["flo-mvp", "running", "#3dbbff"],
            ["api", "needs you", "#e59a2f"],
            ["docs", "done", "#4f9a62"],
          ].map(([n, s, c]) => (
            <div key={n} className="flex items-center gap-2 py-[2px] text-[11.5px]">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c }} />
              <span className="font-semibold">{n}</span>
              <span className="ml-auto opacity-70">{s}</span>
            </div>
          ))}
        </div>
      );
    case 3:
      return (
        <div className="flex min-w-0 items-center gap-3 rounded-[18px] bg-gradient-to-br from-brand-700/50 to-brand-900/60 p-3 ring-1 ring-brand-300/20">
          <CloudSun size={34} className="shrink-0 text-brand-100" />
          <div>
            <div className="font-display text-[26px] font-semibold leading-none">31°</div>
            <div className="mt-1 text-[11px] text-white/70">Ahmedabad · Clear</div>
            <div className="text-[11px] text-white/55">H 33° · L 21°</div>
          </div>
        </div>
      );
    case 4:
      return (
        <div className="flex min-w-0 flex-col justify-center gap-1 rounded-[18px] bg-white/[0.07] p-3 ring-1 ring-white/10">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-red-300">
            <CalendarDays size={12} /> Sat 7
          </div>
          <div className="text-[13px] font-semibold">Design sync</div>
          <div className="text-[11px] text-white/60">15:00 · in 40 min · Zoom</div>
        </div>
      );
    default:
      return (
        <div className="flex min-w-0 items-center gap-3 rounded-[18px] bg-white/[0.07] p-3 ring-1 ring-white/10">
          <BatteryMedium size={30} className="shrink-0 text-emerald-300" />
          <div>
            <div className="font-display text-[22px] font-semibold leading-none">82%</div>
            <div className="mt-1 text-[11px] text-white/60">About 9 h left</div>
          </div>
        </div>
      );
  }
}

function Pointer({ className = "" }: { className?: string }) {
  return (
    <svg width="16" height="20" viewBox="0 0 16 20" className={className} aria-hidden>
      <path d="M1 1l0 15 4-4 3 7 3-1.4-3-6.6h5.5z" fill="#fff" stroke="#000" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function chapterIdAt(i: number): ChapterId | "idle" {
  return i < 0 ? "idle" : CHAPTERS[i].id;
}
