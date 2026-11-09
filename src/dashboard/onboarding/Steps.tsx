// Setup steps, part one: hello, the dictation try-out and the playful questions about you.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import {
  ArrowRight, Briefcase, Code2, FileText, GraduationCap, Handshake, Hash, Mail, Megaphone, MessagesSquare, Mic,
  Palette, PenLine, Play, Rocket, Sparkles, Check,
} from "lucide-react";
import { isTauri, on } from "../../lib/api";
import { EV, type StateEvent, type TranscriptEvent } from "../../lib/types";
import { APPS, LANGS, type Role, type Use } from "../../lib/profile";
import type { NotchlingMood } from "../../lib/notchling";
import { Ribbon, type RibbonMode } from "../../island/Ribbon";
import * as snd from "../../lib/onboardSounds";
import { Burst } from "./Aurora";
import { Btn, ChoiceCard, Chip, Heading, Key, Rise, Stagger, rise, EASE } from "./parts";
import { TONES, toggle, type SetupAnswers } from "./flow";

/** Browser preview only: play the backend events a real key press would produce. */
export function simulate(events: [number, string, unknown][]) {
  const m = (window as any).__floMock;
  if (!m) return;
  for (const [at, ev, p] of events) setTimeout(() => m.emit(ev, p), at);
}

export const toRibbon = (phase: string): RibbonMode | null =>
  phase === "listening" ? "listen" : phase === "transcribing" ? "transcribe" : phase === "thinking" ? "think" : phase === "done" ? "done" : null;

// ── welcome ──────────────────────────────────────────────────────────────────

export function Welcome({ title, sub, name, setName, onStart }: { title: string; sub: string; name: string; setName: (v: string) => void; onStart: () => void }) {
  return (
    <div className="flex flex-col items-center text-center">
      <Heading title={title} sub={sub} big />
      <Stagger className="mt-8 flex w-full max-w-[380px] flex-col items-center gap-4">
        <Rise className="w-full">
          <label className="onb-label mb-2 block" htmlFor="ob-name">
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
            className="onb-field selectable h-14 px-5 text-center text-[18px] font-medium"
          />
        </Rise>
        <Rise>
          <Btn onClick={onStart} icon={<ArrowRight size={17} />} className="!h-[52px] !px-8 !text-[15.5px]">
            Let's begin
          </Btn>
        </Rise>
        <Rise className="onb-faint text-[12.5px]">About two minutes. You can change everything later.</Rise>
      </Stagger>
    </div>
  );
}

// ── the try-out ──────────────────────────────────────────────────────────────

const PHRASE = "Hello Flo, this is my first dictation";

/** Dictation before any question. Reacts to real backend events; "Watch it" plays a scripted
 *  version so it lands even if the person doesn't speak. */
export function TryDemo({ keyLabel, keyWord, onDone, onSuccess, setMood }: { keyLabel: string; keyWord?: string; onDone: () => void; onSuccess: () => void; setMood: (m: NotchlingMood | null) => void }) {
  const [mode, setMode] = useState<RibbonMode | null>(null);
  const [text, setText] = useState("");
  const [typed, setTyped] = useState("");
  const done = !!text;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const offs = [
      on<StateEvent>(EV.state, (e) => setMode(toRibbon(e.phase))),
      on<TranscriptEvent>(EV.transcript, (t) => t.final && t.text.trim() && setText(t.text.trim())),
    ];
    return () => offs.forEach((f) => f());
  }, []);
  useEffect(() => {
    setMood(done ? "celebrate" : mode === "listen" ? "listen" : mode === "transcribe" || mode === "think" ? "talk" : null);
  }, [done, mode, setMood]);
  useEffect(() => {
    if (!text) return;
    snd.playSuccess();
    let n = 0;
    const id = setInterval(() => {
      n++;
      setTyped(text.slice(0, n));
      if (n >= text.length) clearInterval(id);
    }, 26);
    return () => clearInterval(id);
  }, [text]);
  const cbs = useRef({ onDone, onSuccess });
  cbs.current = { onDone, onSuccess };
  useEffect(() => {
    if (!done) return;
    cbs.current.onSuccess();
    const t = setTimeout(() => cbs.current.onDone(), 2800);
    return () => clearTimeout(t);
  }, [done]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const watch = () => {
    setText("");
    setTyped("");
    const push = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    setMode("listen");
    push(1100, () => setMode("transcribe"));
    push(1800, () => setText(PHRASE));
    push(1850, () => setMode("done"));
    push(3200, () => setMode(null));
  };
  const status = done
    ? "You did it. That works in every app."
    : mode === "listen"
      ? "I'm all ears. Keep talking."
      : mode === "transcribe" || mode === "think"
        ? "Writing it down for you..."
        : null;

  return (
    <div className="flex flex-col items-center text-center" data-testid="demo" data-done={done ? "true" : "false"}>
      <Heading title="Let's try it right now" />
      <Stagger className="flex w-full flex-col items-center">
        <Rise className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[15px] text-[#5b6678]">
          Click the box, hold <Key>{keyLabel}</Key> and say
          <span className="font-semibold text-[#0b1220]">"{PHRASE}"</span>
        </Rise>

        {/* a little app window with the real notch on top */}
        <motion.div variants={rise} className="onb-glass relative mt-6 w-full max-w-[560px] overflow-visible px-6 pb-5 pt-0">
          <div className="flex items-center gap-1.5 pt-3.5">
            {["#ff6b6b", "#ffc04d", "#3fd07a"].map((c) => (
              <span key={c} className="h-2.5 w-2.5 rounded-full" style={{ background: c, opacity: 0.75 }} />
            ))}
          </div>
          <div className="onb-notch hw absolute left-1/2 top-0 h-[38px] w-[300px] -translate-x-1/2 overflow-hidden rounded-b-[16px] shadow-[0_10px_24px_-12px_rgb(11_18_32/0.6)]" data-testid="try-ribbon">
            {mode ? (
              <Ribbon width={300} height={38} notchWidth={0} wing={150} mode={mode} leftWing />
            ) : (
              <div className="flex h-full items-center justify-center text-[11.5px] text-white/45">your notch</div>
            )}
          </div>
          <div className="relative mt-6">
            <textarea
              aria-label="Demo text box"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Your words land here..."
              rows={3}
              className="onb-field selectable resize-none px-5 py-4 text-left text-[16px]"
              style={done ? { color: "transparent", caretColor: "transparent" } : undefined}
            />
            {done && (
              <div aria-hidden className="pointer-events-none absolute left-5 right-5 top-4 text-left text-[16px] text-[#0b1220]">
                {typed}
                <motion.span className="ml-0.5 inline-block h-[18px] w-[2px] translate-y-[3px] bg-[#2f8cff]" animate={{ opacity: [1, 0] }} transition={{ repeat: Infinity, duration: 0.7 }} />
              </div>
            )}
            {done && <Burst />}
          </div>
          <div className="mt-4 flex items-center justify-center gap-4">
            <Key big down={mode === "listen"}>
              <span className="flex flex-col items-center leading-none">
                <span>{keyLabel}</span>
                {keyWord && <span className="mt-1 text-[9.5px] font-semibold tracking-wide opacity-60">{keyWord}</span>}
              </span>
            </Key>
            <span className="text-left text-[13px] leading-snug text-[#8a94a6]">
              hold to talk,
              <br />
              let go to type
            </span>
          </div>
        </motion.div>

        <div className="mt-4 flex h-7 items-center justify-center gap-5 text-[14px]">
          <AnimatePresence mode="wait">
            {status ? (
              <motion.span
                key={status}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={clsx("flex items-center gap-1.5 font-medium", done ? "text-[#1f9e78]" : "text-[#2f8cff]")}
                data-testid={done ? "demo-success" : undefined}
              >
                {done && <Check size={16} strokeWidth={3} />}
                {status}
              </motion.span>
            ) : (
              <motion.span key="links" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-5">
                <button className="flex items-center gap-1.5 font-medium text-[#5b6678] transition hover:text-[#0b1220]" onClick={watch}>
                  <Play size={14} /> Watch it
                </button>
                {!isTauri && (
                  <button
                    className="onb-link"
                    onClick={() =>
                      simulate([
                        [0, EV.state, { phase: "listening", mode: "dictation" }],
                        [900, EV.state, { phase: "transcribing", mode: "dictation" }],
                        [1500, EV.transcript, { text: PHRASE + ".", final: true }],
                        [1550, EV.state, { phase: "done", mode: "dictation" }],
                      ])
                    }
                  >
                    Simulate (preview)
                  </button>
                )}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </Stagger>
    </div>
  );
}

// ── questions ────────────────────────────────────────────────────────────────

const ROLE_TILES: { id: Exclude<Role, "">; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: "developer", label: "I build software", hint: "Developer", icon: <Code2 size={22} /> },
  { id: "founder", label: "I run a company", hint: "Founder", icon: <Rocket size={22} /> },
  { id: "designer", label: "I design things", hint: "Designer", icon: <Palette size={22} /> },
  { id: "writer", label: "I write", hint: "Writer", icon: <PenLine size={22} /> },
  { id: "marketer", label: "I tell stories", hint: "Marketing", icon: <Megaphone size={22} /> },
  { id: "sales", label: "I close deals", hint: "Sales", icon: <Handshake size={22} /> },
  { id: "student", label: "I'm learning", hint: "Student", icon: <GraduationCap size={22} /> },
  { id: "other", label: "A bit of everything", hint: "Something else", icon: <Briefcase size={22} /> },
];

export function RoleStep({ title, sub, a, set, onPicked }: { title: string; sub: string; a: SetupAnswers; set: (p: Partial<SetupAnswers>) => void; onPicked: () => void }) {
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(t.current), []);
  return (
    <div className="flex flex-col items-center">
      <Heading title={title} sub={sub} />
      <Stagger className="mt-7 grid w-full max-w-[720px] grid-cols-4 gap-3" >
        {ROLE_TILES.map((r) => (
          <ChoiceCard
            key={r.id}
            role="radio"
            on={a.role === r.id}
            label={r.label}
            hint={r.hint}
            icon={r.icon}
            className="h-[134px]"
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
  { id: "emails", label: "Email", hint: "Warm and clear", icon: <Mail size={22} /> },
  { id: "chat", label: "Slack & chat", hint: "Short and casual", icon: <MessagesSquare size={22} /> },
  { id: "coding", label: "Coding prompts", hint: "Precise, keeps code names", icon: <Code2 size={22} /> },
  { id: "docs", label: "Docs & notes", hint: "Tidy headings", icon: <FileText size={22} /> },
  { id: "meetings", label: "Meetings", hint: "Decisions and owners", icon: <Mic size={22} /> },
  { id: "social", label: "Social posts", hint: "Punchy and human", icon: <Hash size={22} /> },
];

export function UsesStep({ title, sub, a, set }: { title: string; sub: string; a: SetupAnswers; set: (p: Partial<SetupAnswers>) => void }) {
  return (
    <div className="flex flex-col items-center">
      <Heading title={title} sub={sub} />
      <Stagger className="mt-6 grid w-full max-w-[640px] grid-cols-3 gap-3">
        {USE_TILES.map((u) => (
          <ChoiceCard
            key={u.id}
            on={a.uses.includes(u.id)}
            label={u.label}
            hint={u.hint}
            icon={u.icon}
            className="h-[118px]"
            onClick={() => {
              snd.playTick();
              set({ uses: toggle(a.uses, u.id) });
            }}
          />
        ))}
      </Stagger>
      <Stagger className="mt-6 flex w-full max-w-[640px] flex-col items-center">
        <Rise className="onb-label mb-2.5">Apps you live in</Rise>
        <div className="flex flex-wrap justify-center gap-2" data-testid="apps">
          {APPS.filter((x) => x.id !== "other").map((ap) => (
            <Chip
              key={ap.id}
              on={a.apps.includes(ap.id)}
              onClick={() => {
                snd.playTick();
                set({ apps: toggle(a.apps, ap.id) });
              }}
            >
              {ap.label}
            </Chip>
          ))}
        </div>
      </Stagger>
    </div>
  );
}

export function VoiceStep({ title, sub, a, set }: { title: string; sub: string; a: SetupAnswers; set: (p: Partial<SetupAnswers>) => void }) {
  return (
    <div className="flex flex-col items-center">
      <Heading title={title} sub={sub} />
      <Stagger className="mt-6 flex w-full max-w-[680px] flex-col items-center">
        <Rise className="onb-label mb-2.5">I speak</Rise>
        <div className="flex flex-wrap items-center justify-center gap-2" data-testid="languages">
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
                animate={{ width: 170, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                aria-label="Other language"
                placeholder="Which one?"
                value={a.otherLanguage}
                onChange={(e) => set({ otherLanguage: e.target.value })}
                className="onb-field selectable h-9 !rounded-full px-4 text-[13.5px]"
              />
            )}
          </AnimatePresence>
        </div>

        <Rise className="onb-label mb-2.5 mt-7">And I like to sound</Rise>
        <div className="grid w-full grid-cols-4 gap-3" role="radiogroup" aria-label="Tone">
          {TONES.map((t) => {
            const picked = a.tone === t.id;
            return (
              <motion.button
                key={t.id}
                type="button"
                variants={rise}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.97 }}
                role="radio"
                aria-checked={picked}
                aria-label={t.label}
                onClick={() => {
                  snd.playTick();
                  set({ tone: picked ? "" : t.id });
                }}
                className="onb-choice flex flex-col items-start gap-3 rounded-[22px] p-3.5 text-left"
              >
                <span className="flex h-5 w-full items-center justify-between text-[14px] font-semibold">
                  {t.label}
                  {picked && (
                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="onb-tick">
                      <Check size={12} strokeWidth={3.5} />
                    </motion.span>
                  )}
                </span>
                <span
                  className={clsx(
                    "rounded-2xl rounded-bl-md px-3 py-2 text-[12.5px] leading-snug transition-colors",
                    picked ? "bg-gradient-to-br from-[#2f8cff] to-[#7a6cff] text-white" : "bg-[#eef1f8] text-[#2a3446]",
                  )}
                >
                  {t.sample}
                </span>
              </motion.button>
            );
          })}
        </div>
      </Stagger>
    </div>
  );
}

// ── the personal prompt ─────────────────────────────────────────────────────

export function Personalise({ title, sub, prompt, setPrompt, seeds, chosen, setChosen, setMood }: {
  title: string;
  sub: string;
  prompt: string;
  setPrompt: (s: string) => void;
  seeds: string[];
  chosen: Set<string>;
  setChosen: (s: Set<string>) => void;
  setMood: (m: NotchlingMood | null) => void;
}) {
  const [ready, setReady] = useState(false);
  const [shown, setShown] = useState("");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setMood("think");
    const t = setTimeout(() => {
      setReady(true);
      setMood(null);
    }, 1100);
    return () => clearTimeout(t);
  }, [setMood]);
  useEffect(() => {
    if (!ready || !prompt) return;
    let n = 0;
    const id = setInterval(() => {
      n += 3;
      setShown(prompt.slice(0, n));
      if (n >= prompt.length) clearInterval(id);
    }, 12);
    return () => clearInterval(id);
  }, [ready, prompt]);

  if (!ready)
    return (
      <div className="flex min-h-[340px] flex-col items-center justify-center gap-5" data-testid="personalising">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="onb-notch hw relative h-[40px] w-[260px] overflow-hidden rounded-full" aria-hidden>
          <Ribbon width={260} height={40} notchWidth={0} wing={130} mode="think" leftWing />
        </motion.div>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="onb-sub flex items-center gap-2">
          <Sparkles size={15} className="text-[#7a6cff]" /> Writing your profile...
        </motion.p>
      </div>
    );
  return (
    <div className="mx-auto flex w-full max-w-[620px] flex-col items-center">
      <Heading title={title} sub={sub} />
      <motion.div className="relative mt-5 w-full" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.5, ease: EASE }}>
        <textarea
          id="ob-prompt"
          aria-label="System prompt"
          value={editing ? prompt : shown}
          onFocus={() => setEditing(true)}
          onChange={(e) => {
            setEditing(true);
            setPrompt(e.target.value);
          }}
          rows={8}
          className="onb-field onb-glass selectable resize-none !rounded-[22px] px-5 py-4 text-[13.5px] leading-relaxed text-[#2a3446]"
        />
        {!editing && shown.length < prompt.length && <span className="pointer-events-none absolute bottom-4 right-5 h-[14px] w-[2px] animate-pulse bg-[#2f8cff]" />}
      </motion.div>
      {seeds.length > 0 && (
        <Stagger className="mt-4 flex w-full flex-col items-center">
          <Rise className="onb-label mb-2">Words I'll always spell right</Rise>
          <div className="flex flex-wrap justify-center gap-1.5" data-testid="seeds">
            {seeds.map((w) => (
              <Chip
                key={w}
                on={chosen.has(w)}
                onClick={() => {
                  const n = new Set(chosen);
                  if (n.has(w)) n.delete(w);
                  else n.add(w);
                  setChosen(n);
                  snd.playTick();
                }}
              >
                {w}
              </Chip>
            ))}
          </div>
        </Stagger>
      )}
    </div>
  );
}
