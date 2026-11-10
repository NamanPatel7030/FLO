// Setup steps, part one: hello, the dictation try-out and the two short questions about you.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import {
  AlertCircle, ArrowRight, Briefcase, Check, Code2, FileText, GraduationCap, Handshake, Hash, Mail, Megaphone, MessagesSquare, Mic,
  Palette, PenLine, RotateCcw, Rocket,
} from "lucide-react";
import { api, on } from "../../lib/api";
import { EV, type LevelEvent, type StateEvent, type TranscriptEvent } from "../../lib/types";
import { LANGS, type Role, type Use } from "../../lib/profile";
import type { NotchlingMood } from "../../lib/notchling";
import { Ribbon, type RibbonMode } from "../../island/Ribbon";
import * as snd from "../../lib/onboardSounds";
import { usePermissions } from "../usePermissions";
import { hotkeyReady } from "./perms";
import { Burst } from "./Aurora";
import { Btn, ChoiceCard, Chip, Heading, Key, Rise, Stagger, rise } from "./parts";
import { friendlyError, toggle, type SetupAnswers } from "./flow";

export const toRibbon = (phase: string): RibbonMode | null =>
  phase === "listening" ? "listen" : phase === "transcribing" ? "transcribe" : phase === "thinking" ? "think" : phase === "done" ? "done" : null;

// ── welcome ──────────────────────────────────────────────────────────────────

export function Welcome({ title, sub, name, setName, onStart }: { title: string; sub: string; name: string; setName: (v: string) => void; onStart: () => void }) {
  return (
    <div className="flex flex-col items-center text-center">
      <Heading title={title} sub={sub} big />
      <Stagger className="mt-10 flex w-full max-w-[440px] flex-col items-center gap-5">
        <Rise className="w-full">
          <label className="onb-label mb-3 block" htmlFor="ob-name">
            What should I call you?
          </label>
          <input
            id="ob-name"
            aria-label="Your name"
            placeholder="Your first name"
            value={name}
            autoComplete="given-name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onStart()}
            className="onb-field selectable h-16 px-6 text-center text-[20px] font-medium"
          />
        </Rise>
        <Rise>
          <Btn onClick={onStart} icon={<ArrowRight size={18} />} className="!h-14 !px-9 !text-[16.5px]">
            Let's begin
          </Btn>
        </Rise>
        <Rise className="onb-faint text-[14px]">About two minutes. You can change everything later.</Rise>
      </Stagger>
    </div>
  );
}

// ── the try-out ──────────────────────────────────────────────────────────────

const PHRASE = "Hello Flo, this is my first dictation";
const BARS = 22;

/** The first dictation. Real end to end: the mic, the speech model and the AI cleanup all run,
 *  and the words come back here as an event (setup capture), not pasted into some other app. Hold
 *  the Flo key or the big button; the bars show the mic is hearing you. */
export function TryDemo({ keyLabel, keyWord, onSuccess, setMood }: { keyLabel: string; keyWord?: string; onSuccess: () => void; setMood: (m: NotchlingMood | null) => void }) {
  const perms = usePermissions(1500);
  const [mode, setMode] = useState<RibbonMode | null>(null);
  const [text, setText] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<{ text: string; fixMic?: boolean } | null>(null);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const [hint, setHint] = useState<string | null>(null);
  const holding = useRef<number | null>(null);
  const starting = useRef<Promise<unknown>>(Promise.resolve());
  const done = !!text;
  const listening = mode === "listen";
  const micOk = !perms || perms.microphone;
  const keyOk = hotkeyReady(perms);

  // while this step is up, dictations made in Flo's window come back here instead of being pasted
  useEffect(() => {
    api.setSetupCapture(true).catch(() => {});
    return () => {
      api.setSetupCapture(false).catch(() => {});
    };
  }, []);
  useEffect(() => {
    const offs = [
      on<StateEvent>(EV.state, (e) => {
        if (e.mode && e.mode !== "dictation") return;
        setMode(toRibbon(e.phase));
        if (e.phase === "listening") {
          setError(null);
          setHint(null);
        }
        if (e.phase === "error" && e.message) setError(friendlyError(e.message));
      }),
      on<LevelEvent>(EV.level, (l) => setLevels((p) => [...p.slice(1), Math.min(1, Math.max(0, l.rms))])),
      on<TranscriptEvent>(EV.transcript, (t) => {
        if (t.final && t.text.trim()) {
          setError(null);
          setText(t.text.trim());
        }
      }),
    ];
    return () => offs.forEach((f) => f());
  }, []);
  useEffect(() => {
    if (!listening) setLevels(Array(BARS).fill(0));
  }, [listening]);
  useEffect(() => {
    setMood(done ? "celebrate" : error ? "worried" : listening ? "listen" : mode === "transcribe" || mode === "think" ? "talk" : null);
  }, [done, error, listening, mode, setMood]);
  useEffect(() => {
    if (!text) return;
    snd.playSuccess();
    let n = 0;
    const id = setInterval(() => {
      n++;
      setTyped(text.slice(0, n));
      if (n >= text.length) clearInterval(id);
    }, 24);
    return () => clearInterval(id);
  }, [text]);
  const success = useRef(onSuccess);
  success.current = onSuccess;
  useEffect(() => {
    if (done) success.current();
  }, [done]);

  const press = () => {
    if (holding.current !== null) return;
    if (!micOk) {
      setError({ text: "Allow the microphone first, then hold the button again.", fixMic: true });
      return;
    }
    holding.current = Date.now();
    setError(null);
    setHint(null);
    starting.current = api.startSession("dictation").catch((e) => setError(friendlyError(String(e?.message ?? e))));
  };
  const release = () => {
    if (holding.current === null) return;
    const held = Date.now() - holding.current;
    holding.current = null;
    // wait for the start to land first, so a quick tap can't leave the mic open
    if (held < 400) {
      setHint("Keep holding while you talk, then let go.");
      starting.current.finally(() => api.cancelSession().catch(() => {}));
      return;
    }
    starting.current.finally(() => api.stopSession().catch((e) => setError(friendlyError(String(e?.message ?? e)))));
  };
  // leaving the step mid-hold never leaves the mic open
  useEffect(
    () => () => {
      if (holding.current !== null) starting.current.finally(() => api.cancelSession().catch(() => {}));
    },
    [],
  );
  const again = () => {
    setText("");
    setTyped("");
    setError(null);
  };

  const status = done
    ? { tone: "ok", text: "You did it. That works in every app." }
    : error
      ? { tone: "err", text: error.text }
      : listening
        ? { tone: "live", text: "I'm listening. Let go when you're done." }
        : mode === "transcribe" || mode === "think"
          ? { tone: "live", text: "Writing it down for you..." }
          : hint
            ? { tone: "hint", text: hint }
            : null;

  return (
    <div className="flex w-full flex-col items-center text-center" data-testid="demo" data-done={done ? "true" : "false"}>
      <Heading title="Now say something" />
      <Stagger className="flex w-full flex-col items-center">
        <Rise className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[17px] text-[#5b6678]">
          Hold <Key>{keyLabel}</Key>
          {keyWord && <span className="text-[14px]">({keyWord})</span>} or the mic button and say
          <span className="font-semibold text-[#0b1220]">"{PHRASE}"</span>
        </Rise>

        {/* what's missing, with the fix right here */}
        <AnimatePresence initial={false}>
          {perms && (!micOk || !keyOk) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="w-full max-w-[680px] overflow-hidden"
              data-testid="try-needs"
            >
              <div className="mt-5 flex items-center gap-4 rounded-[20px] border border-[#f3d9b8] bg-[#fff8ef] px-5 py-3.5 text-left">
                <AlertCircle size={22} className="shrink-0 text-[#c46a12]" />
                <span className="flex-1 text-[15px] text-[#7a4a12]">
                  {!micOk ? "Allow the microphone first so I can hear you." : `Your ${keyLabel} key needs Accessibility. Until then, hold the mic button.`}
                </span>
                <Btn kind="soft" className="!h-10 !px-5 !text-[14px]" onClick={() => api.openPermissionSettings(!micOk ? "microphone" : "accessibility")}>
                  {!micOk ? "Allow microphone" : "Allow"}
                </Btn>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* a little app window with the real notch on top */}
        <motion.div variants={rise} className="onb-glass relative mt-6 w-full max-w-[680px] overflow-visible px-8 pb-7 pt-0">
          <div className="onb-notch hw absolute left-1/2 top-0 h-[40px] w-[320px] -translate-x-1/2 overflow-hidden rounded-b-[18px] shadow-[0_10px_24px_-12px_rgb(11_18_32/0.6)]" data-testid="try-ribbon">
            {mode ? (
              <Ribbon width={320} height={40} notchWidth={0} wing={160} mode={mode} leftWing />
            ) : (
              <div className="flex h-full items-center justify-center text-[12px] text-white/45">your notch</div>
            )}
          </div>
          <div className="relative mt-[60px]">
            <textarea
              aria-label="Demo text box"
              value={text}
              readOnly
              placeholder="Your words land here..."
              rows={3}
              className="onb-field selectable resize-none px-6 py-5 text-left text-[19px] leading-relaxed"
              style={done ? { color: "transparent", caretColor: "transparent" } : undefined}
            />
            {done && (
              <div aria-hidden className="pointer-events-none absolute left-6 right-6 top-5 text-left text-[19px] leading-relaxed text-[#0b1220]">
                {typed}
                <motion.span className="ml-0.5 inline-block h-[20px] w-[2px] translate-y-[3px] bg-[#2f8cff]" animate={{ opacity: [1, 0] }} transition={{ repeat: Infinity, duration: 0.7 }} />
              </div>
            )}
            {done && <Burst />}
          </div>

          {/* live mic level around the big hold-to-talk button */}
          <div className="mt-6 flex items-center justify-center gap-6">
            <Meter levels={levels} live={listening} flip />
            <div className="flex flex-col items-center gap-2">
              <motion.button
                type="button"
                aria-label="Hold to talk"
                data-testid="try-mic"
                data-live={listening ? "true" : "false"}
                onPointerDown={(e) => {
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId); // keep the release even if the pointer drifts off
                  } catch {
                    /* synthetic pointer */
                  }
                  press();
                }}
                onPointerUp={release}
                onPointerCancel={release}
                onKeyDown={(e) => {
                  if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                    e.preventDefault();
                    press();
                  }
                }}
                onKeyUp={(e) => {
                  if (e.key === " " || e.key === "Enter") release();
                }}
                animate={listening ? { scale: 1.06 } : { scale: 1 }}
                whileHover={{ y: -2 }}
                transition={{ type: "spring", stiffness: 420, damping: 22 }}
                className={clsx(
                  "flex h-[88px] w-[88px] touch-none select-none items-center justify-center rounded-full transition-colors",
                  listening
                    ? "bg-gradient-to-br from-[#2f8cff] to-[#7a6cff] text-white shadow-[0_18px_40px_-14px_rgb(80_100_255/0.8)]"
                    : "bg-[#0b1220] text-white shadow-[0_14px_30px_-12px_rgb(11_18_32/0.6)]",
                )}
              >
                <Mic size={36} />
              </motion.button>
              <span className="text-[13.5px] font-medium text-[#8a94a6]">{listening ? "Listening" : "Hold to talk"}</span>
            </div>
            <Meter levels={levels} live={listening} />
          </div>
        </motion.div>

        <div className="mt-5 flex min-h-8 items-center justify-center gap-4 text-[16px]">
          <AnimatePresence mode="wait">
            {status && (
              <motion.span
                key={status.text}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                role={status.tone === "err" ? "alert" : undefined}
                className={clsx(
                  "flex items-center gap-2 font-medium",
                  status.tone === "ok" ? "text-[#1f9e78]" : status.tone === "err" ? "text-[#c4462b]" : status.tone === "hint" ? "text-[#5b6678]" : "text-[#2f8cff]",
                )}
                data-testid={done ? "demo-success" : status.tone === "err" ? "demo-error" : undefined}
              >
                {done && <Check size={18} strokeWidth={3} />}
                {status.text}
              </motion.span>
            )}
          </AnimatePresence>
          {error?.fixMic && (
            <button className="onb-link text-[15px]" onClick={() => api.openPermissionSettings("microphone")}>
              Open mic settings
            </button>
          )}
          {done && (
            <button className="flex items-center gap-1.5 text-[15px] font-medium text-[#5b6678] hover:text-[#0b1220]" onClick={again}>
              <RotateCcw size={15} /> Try again
            </button>
          )}
        </div>
      </Stagger>
    </div>
  );
}

/** A row of bars that follows the mic level (newest nearest the button). */
function Meter({ levels, live, flip }: { levels: number[]; live: boolean; flip?: boolean }) {
  const half = levels.slice(-Math.floor(BARS / 2));
  const bars = flip ? half : [...half].reverse();
  return (
    <div className={clsx("flex h-16 items-center gap-[5px]", flip && "flex-row")} aria-hidden data-testid="try-meter">
      {bars.map((v, k) => {
        const h = live ? 8 + Math.min(1, v * 2.2) * 56 : 8;
        return <motion.span key={k} className={clsx("w-[6px] rounded-full", live ? "bg-gradient-to-t from-[#2f8cff] to-[#7a6cff]" : "bg-[#0b1220]/12")} animate={{ height: h }} transition={{ type: "spring", stiffness: 500, damping: 30 }} />;
      })}
    </div>
  );
}

// ── two short questions ──────────────────────────────────────────────────────

const ROLE_TILES: { id: Exclude<Role, "">; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: "developer", label: "I build software", hint: "Developer", icon: <Code2 size={28} /> },
  { id: "founder", label: "I run a company", hint: "Founder", icon: <Rocket size={28} /> },
  { id: "designer", label: "I design things", hint: "Designer", icon: <Palette size={28} /> },
  { id: "writer", label: "I write", hint: "Writer", icon: <PenLine size={28} /> },
  { id: "marketer", label: "I tell stories", hint: "Marketing", icon: <Megaphone size={28} /> },
  { id: "sales", label: "I close deals", hint: "Sales", icon: <Handshake size={28} /> },
  { id: "student", label: "I'm learning", hint: "Student", icon: <GraduationCap size={28} /> },
  { id: "other", label: "A bit of everything", hint: "Something else", icon: <Briefcase size={28} /> },
];

export function RoleStep({ title, sub, a, set, onPicked }: { title: string; sub: string; a: SetupAnswers; set: (p: Partial<SetupAnswers>) => void; onPicked: () => void }) {
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(t.current), []);
  return (
    <div className="flex w-full flex-col items-center">
      <Heading title={title} sub={sub} />
      <Stagger className="mt-9 grid w-full max-w-[880px] grid-cols-4 gap-4">
        {ROLE_TILES.map((r) => (
          <ChoiceCard
            key={r.id}
            role="radio"
            on={a.role === r.id}
            label={r.label}
            hint={r.hint}
            icon={r.icon}
            className="h-[172px]"
            onClick={() => {
              snd.playTick();
              const picking = a.role !== r.id;
              set({ role: picking ? r.id : "" });
              clearTimeout(t.current);
              if (picking) t.current = setTimeout(onPicked, 650);
            }}
          />
        ))}
      </Stagger>
    </div>
  );
}

const USE_TILES: { id: Use; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: "emails", label: "Email", hint: "Warm and clear", icon: <Mail size={28} /> },
  { id: "chat", label: "Slack & chat", hint: "Short and casual", icon: <MessagesSquare size={28} /> },
  { id: "coding", label: "Coding prompts", hint: "Keeps code names exact", icon: <Code2 size={28} /> },
  { id: "docs", label: "Docs & notes", hint: "Tidy headings", icon: <FileText size={28} /> },
  { id: "meetings", label: "Meetings", hint: "Decisions and owners", icon: <Mic size={28} /> },
  { id: "social", label: "Social posts", hint: "Punchy and human", icon: <Hash size={28} /> },
];

export function UsesStep({ title, sub, a, set }: { title: string; sub: string; a: SetupAnswers; set: (p: Partial<SetupAnswers>) => void }) {
  return (
    <div className="flex w-full flex-col items-center">
      <Heading title={title} sub={sub} />
      <Stagger className="mt-8 grid w-full max-w-[820px] grid-cols-3 gap-4">
        {USE_TILES.map((u) => (
          <ChoiceCard
            key={u.id}
            on={a.uses.includes(u.id)}
            label={u.label}
            hint={u.hint}
            icon={u.icon}
            className="h-[150px]"
            onClick={() => {
              snd.playTick();
              set({ uses: toggle(a.uses, u.id) });
            }}
          />
        ))}
      </Stagger>
      <Stagger className="mt-8 flex w-full max-w-[820px] flex-col items-center">
        <Rise className="onb-label mb-3">I speak</Rise>
        <div className="flex flex-wrap items-center justify-center gap-2.5" data-testid="languages">
          {LANGS.map((l) => (
            <Chip
              key={l.id}
              on={a.languages.includes(l.id)}
              onClick={() => {
                snd.playTick();
                set({ languages: toggle(a.languages, l.id) });
              }}
            >
              {l.id === "other" ? "Something else" : l.label}
            </Chip>
          ))}
          <AnimatePresence>
            {a.languages.includes("other") && (
              <motion.input
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 190, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                aria-label="Other language"
                placeholder="Which one?"
                value={a.otherLanguage}
                onChange={(e) => set({ otherLanguage: e.target.value })}
                className="onb-field selectable h-11 !rounded-full px-4 text-[15px]"
              />
            )}
          </AnimatePresence>
        </div>
      </Stagger>
    </div>
  );
}
