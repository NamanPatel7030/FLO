"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  BellRing,
  CalendarClock,
  Check,
  Clock,
  CloudSun,
  FileText,
  ListTodo,
  Mic,
  Monitor,
  MessageSquare,
  Pause,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Sparkles as SparkIcon,
  Video,
  X,
} from "lucide-react";
import { CHAPTERS, LANGS, STYLES, type ChapterId } from "./chapters";
import { ClaudeMark, Dots, Helix, Keycap, NeonLine, Ribbon, Sparkles, Timer, Typewriter, VoiceBars } from "./viz";

type Size = { w: number; h: number; r: number };
const S = (w: number, h: number, r: number): Size => ({ w, h, r });

/** Exact notch geometry for every chapter/phase. Content below is laid out to fit these boxes. */
export function notchSize(id: ChapterId | "idle", phase: number, bar = true): Size {
  const s = baseSize(id, phase);
  // expanded cards start below the menu bar, like the real notch's content sits under the camera housing
  return bar && s.h >= EXPANDED ? { ...s, h: s.h + BAR_PAD } : s;
}
const EXPANDED = 80;
const BAR_PAD = 26;

function baseSize(id: ChapterId | "idle", phase: number): Size {
  switch (id) {
    case "hero":
      return phase === 0 ? S(204, 34, 13) : S(300, 40, 16);
    case "dictation":
      return [S(390, 58, 22), S(272, 44, 18), S(276, 42, 17)][phase];
    case "languages":
      return [S(400, 58, 22), S(272, 44, 18), S(320, 44, 18)][phase];
    case "assistant":
      return [S(450, 86, 26), S(450, 86, 26), S(360, 44, 18)][phase];
    case "learns":
      return [S(260, 40, 16), S(450, 122, 28), S(330, 44, 18)][phase];
    case "todos":
      return phase === 0 ? S(360, 38, 15) : S(430, 218, 30);
    case "deadlines":
      return [S(360, 44, 18), S(430, 112, 28), S(440, 120, 28)][phase];
    case "meetings":
      return phase === 0 ? S(330, 44, 18) : S(460, 222, 30);
    case "claude":
      return [S(330, 38, 15), S(420, 88, 26), S(450, 120, 28)][phase];
    case "widgets":
      return S(540, 268, 32);
    case "custom":
      return [S(330, 52, 20), S(370, 58, 22), S(420, 64, 24), S(470, 70, 26), S(370, 58, 22)][phase];
    case "privacy":
      return S(460, 184, 30);
    default:
      return S(204, 34, 13);
  }
}

/** The concave "ears" where the notch flows into the menu bar. */
function Ear({ side }: { side: "l" | "r" }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      className={`absolute top-0 ${side === "l" ? "-left-[11.5px]" : "-right-[11.5px] -scale-x-100"}`}
      aria-hidden
    >
      <path d="M0 0H12V12A12 12 0 0 0 0 0Z" fill="#000" />
    </svg>
  );
}

const SPRING = { type: "spring", stiffness: 300, damping: 32, mass: 0.9 } as const;

export function NotchShell({ size, inline, reduce, glow, children }: { size: Size; inline?: boolean; reduce?: boolean; glow?: boolean; children: React.ReactNode }) {
  const rim = "0 0 0 1px rgb(102 206 255 / 0.10), 0 10px 34px -8px rgb(61 187 255 / 0.38), 0 24px 60px -20px rgb(0 0 0 / 0.9), inset 0 -1px 0 rgb(150 220 255 / 0.22)";
  if (inline) {
    return (
      <div className="relative mx-auto w-full" style={{ maxWidth: size.w }}>
        <div className="relative overflow-hidden bg-black text-white" style={{ minHeight: size.h, borderRadius: `0 0 ${size.r}px ${size.r}px`, boxShadow: rim }}>
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="relative">
      {glow && <div aria-hidden className="notch-breathe absolute -bottom-5 left-1/2 h-9 w-[78%] -translate-x-1/2 rounded-full bg-brand-400/35 blur-xl" />}
      <Ear side="l" />
      <Ear side="r" />
      <motion.div
        className="relative overflow-hidden bg-black text-white"
        style={{ boxShadow: rim }}
        initial={false}
        animate={{ width: size.w, height: size.h, borderBottomLeftRadius: size.r, borderBottomRightRadius: size.r }}
        transition={reduce ? { duration: 0 } : SPRING}
      >
        {children}
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
  <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-brand-300 text-black">
    <Check size={11} strokeWidth={3.2} />
  </span>
);
const Muted = ({ children }: { children: React.ReactNode }) => <span className="text-white/45">{children}</span>;

function Btn({ children, primary }: { children: React.ReactNode; primary?: boolean }) {
  return (
    <span
      className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold ${
        primary ? "bg-gradient-to-b from-brand-200 to-brand-400 text-[#001522]" : "bg-white/[0.08] text-white/85 ring-1 ring-white/10"
      }`}
    >
      {children}
    </span>
  );
}

export const TODOS = [
  { t: "Send the Q3 deck to Priya", why: "You said “I'll send it tonight” on Zoom · 11:20", icon: Video },
  { t: "Reply to Rahul about the invoice", why: "Unanswered Slack DM · 2 h ago", icon: MessageSquare },
  { t: "Review Aditi's PR #482", why: "Review requested, seen on screen in GitHub", icon: Monitor },
];

/** What the notch shows for chapter `id` at `phase`. `inline` = mobile, in-flow copy. */
export function NotchContent({ id, phase, cycle, inline }: { id: ChapterId | "idle"; phase: number; cycle: number; inline?: boolean }) {
  const key = `${id}-${phase}`;
  const lang = LANGS[cycle % LANGS.length];
  let body: React.ReactNode = null;

  switch (id) {
    case "hero":
      body =
        phase === 0 ? null : (
          <Row className="justify-center text-[12.5px] text-white/75">
            <VoiceBars n={6} h={14} w={2.5} gap={2} energy={0.6} />
            Hold <Keycap>fn</Keycap> to talk
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
            {id === "languages" ? (
              <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[11px] text-white/60 ring-1 ring-white/10">auto</span>
            ) : (
              <Keycap pressed>fn</Keycap>
            )}
          </Row>
        );
      else if (phase === 1)
        body = (
          <Row className="justify-center text-[13px] text-white/80">
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
            <div className="flex items-center gap-2 text-[11.5px] text-white/50">
              <Keycap pressed>control</Keycap> Assistant is listening
              <span className="ml-auto">
                <VoiceBars n={10} h={16} w={2.5} gap={2} />
              </span>
            </div>
            <Typewriter text="draft a Dhanteras wish for the team" speed={45} className="text-[15px] text-white" />
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
            <Ok /> Draft typed into #team-general
          </Row>
        );
      break;

    case "learns":
      if (phase === 0)
        body = (
          <Row className="justify-center text-[12.5px] text-white/70">
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
            <div className="text-[13px] text-white/75">
              Updated: <s className="text-white/40 decoration-red-400/70">tory</s> <span className="text-white/40">→</span> <span className="font-semibold text-brand-200">Tauri</span> from now on
            </div>
            <div className="flex justify-end gap-2">
              <Btn>Undo</Btn>
              <Btn primary>Got it</Btn>
            </div>
          </div>
        );
      else
        body = (
          <Row className="justify-center text-[13px]">
            <SparkIcon size={14} className="text-brand-300" /> Heard “Tauri”, wrote <span className="font-semibold text-brand-200">Tauri</span>
          </Row>
        );
      break;

    case "todos": {
      const tray = (
        <div className="flex h-[38px] items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <span className={`relative flex h-7 w-7 items-center justify-center rounded-lg ${phase > 0 ? "bg-white/[0.12]" : ""}`}>
              <ListTodo size={16} className="text-[#f1e3c6]" />
              <span className="absolute -right-1 -top-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-brand-400 px-1 text-[9.5px] font-bold text-black">
                {phase === 2 ? 2 : 3}
              </span>
              {phase === 0 && !inline && <Pointer className="pointer-in absolute left-3 top-3" />}
            </span>
            <ClaudeMark size={15} />
          </div>
          <div className="flex items-center gap-3 text-white/45">
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
                <span className="text-[11px] opacity-60">{phase === 2 ? "2 left" : "3 today"}</span>
              </div>
              <div className="flex flex-col gap-2.5">
                {TODOS.map((td, i) => {
                  const done = phase === 2 && i === 0;
                  return (
                    <div key={td.t} className="flex gap-2.5">
                      <span className={`mt-[2px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px] ${done ? "border-[#7a5d2e] bg-[#7a5d2e] text-[#f4ead7]" : "border-[#a58c62]"}`}>
                        {done && <Check size={10} strokeWidth={3.4} />}
                      </span>
                      <div className={`min-w-0 transition-opacity duration-500 ${done ? "opacity-45" : ""}`}>
                        <div className={`text-[12.5px] font-semibold leading-tight ${done ? "line-through" : ""}`}>{td.t}</div>
                        <div className="mt-0.5 flex items-center gap-1 text-[10.5px] leading-tight opacity-65">
                          <td.icon size={10} className="shrink-0" /> {td.why}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      break;
    }

    case "deadlines":
      if (phase === 0)
        body = (
          <Row className="justify-center text-[12.5px] text-white/85">
            <CalendarClock size={15} className="text-brand-300" /> Deadline heard: <span className="text-brand-200">“by next Monday”</span>
          </Row>
        );
      else if (phase === 1)
        body = (
          <div className="flex h-full flex-col justify-center gap-2 px-4">
            <div className="flex items-center gap-1.5 px-1 text-[11px] text-white/50">
              <ListTodo size={12} /> Added to Reminders
            </div>
            <div className="beige flex items-center gap-2.5 rounded-2xl px-3 py-2.5">
              <span className="h-4 w-4 shrink-0 rounded-full border-[1.5px] border-[#a58c62]" />
              <span className="text-[13px] font-semibold">Send requirements to client</span>
              <span className="ml-auto shrink-0 rounded-full bg-[#7a5d2e] px-2 py-0.5 text-[10.5px] font-semibold text-[#f4ead7]">due Mon, 10:00</span>
            </div>
          </div>
        );
      else
        body = (
          <div className="flex h-full flex-col justify-center gap-2 px-5">
            <div className="flex items-center gap-2 text-[11.5px] text-amber-200/90">
              <BellRing size={13} className="bell-ring" /> Reminder · due 9:55
            </div>
            <div className="text-[15px] font-semibold">Send requirements to client</div>
            <div className="flex justify-end gap-2">
              <Btn>
                <Clock size={12} /> 10 min
              </Btn>
              <Btn primary>
                <Check size={12} strokeWidth={3} /> Done
              </Btn>
            </div>
          </div>
        );
      break;

    case "meetings":
      body =
        phase === 0 ? (
          <Row className="text-[12.5px]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" style={{ animation: "flo-glow 1.2s ease-in-out infinite", boxShadow: "0 0 10px rgb(239 68 68 / 0.8)" }} />
            <span className="text-white/90">Recording</span>
            <span className="text-white/55">
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
            <p className="text-[12.5px] leading-snug text-white/75">Onboarding v2 ships next sprint. The pricing page waits for legal sign-off. Client needs requirements before Monday.</p>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-brand-300/80">Action items</div>
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
                  <span className="ml-auto text-white/45">
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
            <span className="text-white/55">2 running · 1 waiting on tests</span>
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
              <div className="truncate text-[11.5px] text-white/50">6 files changed · tests passed · 4m 12s</div>
            </div>
            <span className="ml-auto">
              <Btn primary>Open</Btn>
            </span>
          </div>
        );
      else
        body = (
          <div className="flex h-full flex-col justify-center gap-2 px-5">
            <div className="flex items-center gap-2 text-[13.5px] font-semibold">
              <span className="h-2 w-2 rounded-full bg-amber-400" style={{ animation: "flo-glow 1.2s ease-in-out infinite" }} />
              Claude needs you <Muted>· api</Muted>
            </div>
            <div className="rounded-lg bg-white/[0.06] px-2.5 py-1.5 font-mono text-[12px] text-white/85 ring-1 ring-white/10">Allow npm publish?</div>
            <div className="flex justify-end gap-2">
              <Btn>
                <X size={12} strokeWidth={3} /> Deny
              </Btn>
              <Btn primary>
                <Check size={12} strokeWidth={3} /> Allow
              </Btn>
            </div>
          </div>
        );
      break;

    case "widgets":
      body = (
        <div className={`grid h-full gap-2 p-3 ${inline ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 grid-rows-2"}`}>
          <div className="flex items-center gap-3 rounded-[18px] bg-white/[0.06] p-3 ring-1 ring-white/10">
            <span className="h-14 w-14 shrink-0 rounded-xl" style={{ background: "conic-gradient(from 210deg,#1a9be0,#c2ecff,#3dbbff,#083a57,#1a9be0)" }} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">Midnight City</div>
              <div className="truncate text-[11px] text-white/50">M83 · Now playing</div>
              <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-white/10">
                <div className="np-progress h-full w-full origin-left rounded-full bg-brand-300" />
              </div>
              <div className="mt-1.5 flex items-center gap-3 text-white/70">
                <SkipBack size={12} />
                <Pause size={13} />
                <SkipForward size={12} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-[18px] bg-gradient-to-br from-brand-700/50 to-brand-900/60 p-3 ring-1 ring-brand-300/20">
            <CloudSun size={34} className="shrink-0 text-brand-100" />
            <div>
              <div className="font-display text-[26px] font-semibold leading-none">31°</div>
              <div className="mt-1 text-[11px] text-white/60">Ahmedabad · Clear</div>
              <div className="text-[11px] text-white/45">H 33° · L 21°</div>
            </div>
          </div>
          <div className="beige rounded-[18px] p-3">
            <div className="mb-1.5 flex justify-between text-[12px] font-bold">
              Today <span className="font-medium opacity-60">3</span>
            </div>
            {["Send the Q3 deck", "Reply to Rahul", "Requirements · Mon"].map((t, i) => (
              <div key={t} className="flex items-center gap-2 py-[2px] text-[11.5px]">
                <span className={`h-3 w-3 rounded-full border-[1.5px] border-[#a58c62] ${i === 0 ? "bg-[#7a5d2e]" : ""}`} />
                <span className={i === 0 ? "line-through opacity-50" : ""}>{t}</span>
              </div>
            ))}
          </div>
          <div className="beige rounded-[18px] p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold">
              <ClaudeMark size={12} /> Claude
            </div>
            {[
              ["flo-mvp", "running", "#3dbbff"],
              ["api", "needs you", "#e59a2f"],
              ["docs", "done", "#4f9a62"],
            ].map(([n, s, c]) => (
              <div key={n} className="flex items-center gap-2 py-[2px] text-[11.5px]">
                <span className="h-2 w-2 rounded-full" style={{ background: c }} />
                <span className="font-semibold">{n}</span>
                <span className="ml-auto opacity-60">{s}</span>
              </div>
            ))}
          </div>
        </div>
      );
      break;

    case "custom": {
      const vw = inline ? 170 : [190, 220, 260, 300, 220][phase];
      const viz = [<Ribbon key="r" w={vw} h={34} />, <VoiceBars key="b" n={Math.round(vw / 7)} h={30} />, <NeonLine key="n" w={vw} />, <Helix key="h" w={vw} h={32} />, <Sparkles key="s" w={vw} h={34} />][phase];
      body = (
        <Row className="justify-between">
          <Mic size={15} className="shrink-0 text-brand-200" />
          <div className="flex flex-1 justify-center">{viz}</div>
          <span className="shrink-0 text-[10.5px] text-white/45">{STYLES[phase].split(" ")[0]}</span>
        </Row>
      );
      break;
    }

    case "privacy": {
      const hosts = [
        ["api.anthropic.com", "your key", true],
        ["localhost:11434", "Ollama", true],
        ["huggingface.co", "model download", true],
        ["ads.tracker.io", "not on the list", false],
      ] as const;
      body = (
        <div className="flex h-full flex-col px-4 py-3.5">
          <div className="mb-2 flex items-center gap-2 px-1 text-[12.5px] font-semibold">
            <ShieldCheck size={14} className="text-brand-300" /> Network allow-list
            <span className="ml-auto text-[11px] font-normal text-white/45">3 allowed · 1 blocked</span>
          </div>
          {hosts.map(([h, why, ok], i) => (
            <div
              key={h}
              className={`flex items-center gap-2.5 rounded-xl px-2.5 py-[7px] text-[12.5px] transition-colors duration-300 ${i === phase ? (ok ? "bg-brand-400/12 ring-1 ring-brand-300/25" : "bg-red-500/10 ring-1 ring-red-400/25") : ""}`}
            >
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${ok ? "bg-brand-300/20 text-brand-200" : "bg-red-500/20 text-red-300"}`}>
                {ok ? <Check size={10} strokeWidth={3.2} /> : <X size={10} strokeWidth={3.2} />}
              </span>
              <span className={`font-mono ${ok ? "text-white/90" : "text-white/45 line-through"}`}>{h}</span>
              <span className="ml-auto text-[11px] text-white/45">{why}</span>
            </div>
          ))}
        </div>
      );
      break;
    }
  }

  return (
    <Swap k={key} inline={inline} top={baseSize(id, phase).h >= EXPANDED ? BAR_PAD : 0}>
      {body}
    </Swap>
  );
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
