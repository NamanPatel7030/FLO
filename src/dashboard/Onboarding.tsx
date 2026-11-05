// Cinematic first-run onboarding (after sign-in, while settings.onboarded === false).
// Value-first: a wow dictation demo BEFORE any question, then one light question screen, a
// personalised prompt, permissions, setup and optional "glimpses". Big icons (no emojis),
// full-bleed slides, ambient aurora, subtle synthesized sound. Skippable everywhere; reopen from
// Settings → General → "Run setup again".
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import clsx from "clsx";
import {
  ArrowRight, Bot, Check, ChevronLeft, Cloud, Code2, Cpu, Download, FileText, Gauge, Hash, Keyboard, Mail,
  MessagesSquare, Mic, Monitor, Play, Radio, ShieldCheck, Sparkles, Volume2, VolumeX, Wand2,
} from "lucide-react";
import { api, isTauri, on } from "../lib/api";
import { EV, type AssistantResponse, type LocalModel, type ModelProgressEvent, type Settings, type StateEvent, type TranscriptEvent } from "../lib/types";
import { formatHotkey } from "../lib/format";
import { buildProfile, type Answers, type Role, type Use } from "../lib/profile";
import { toPlainText } from "../lib/markdown";
import { useAccount } from "../lib/account";
import { useStore } from "./store";
import { Button, Input, Select } from "./ui";
import { PERMISSION_ITEMS, usePermissions } from "./usePermissions";
import { AiProviderFields, providerInfo, ProviderKey } from "./AiSetup";
import { Ribbon, type RibbonMode } from "../island/Ribbon";
import { ClaudeAvatar } from "../island/Tray";
import { Logo } from "./Logo";
import { Aurora, Burst } from "./onboarding/Aurora";
import * as snd from "../lib/onboardSounds";

const STEPS = [
  "welcome", "try", "profile", "personalise", "permissions", "setup",
  "glimpse-handsfree", "glimpse-ask", "glimpse-tray", "glimpse-meetings", "typing", "done",
] as const;
type Step = (typeof STEPS)[number];
const STEP_NAME: Record<Step, string> = {
  welcome: "Welcome", try: "Try it", profile: "About you", personalise: "Personalise", permissions: "Permissions",
  setup: "Voice & AI", "glimpse-handsfree": "Hands-free", "glimpse-ask": "Ask your screen", "glimpse-tray": "Agent tray",
  "glimpse-meetings": "Meetings", typing: "Typing speed", done: "Done",
};
const RECOMMENDED = "large-v3-turbo-q5_0";

// The one question: what the user will use Flo for. Big icon tiles (no emojis).
const USE_TILES: { id: Use; label: string; icon: React.ReactNode }[] = [
  { id: "emails", label: "Email", icon: <Mail size={30} /> },
  { id: "chat", label: "Slack & chat", icon: <MessagesSquare size={30} /> },
  { id: "coding", label: "Coding prompts", icon: <Code2 size={30} /> },
  { id: "docs", label: "Docs & notes", icon: <FileText size={30} /> },
  { id: "meetings", label: "Meetings", icon: <Mic size={30} /> },
  { id: "social", label: "Social posts", icon: <Hash size={30} /> },
];

/** Derive a role from the chosen uses so we don't have to ask a second question. */
function deriveRole(uses: Use[]): Role {
  if (uses.includes("coding")) return "developer";
  if (uses.includes("social")) return "marketer";
  if (uses.includes("docs")) return "writer";
  if (uses.includes("meetings")) return "founder";
  return "";
}

/** Browser preview only: play the backend events a real key press would produce. */
function simulate(events: [number, string, unknown][]) {
  const m = (window as any).__floMock;
  if (!m) return;
  for (const [at, ev, p] of events) setTimeout(() => m.emit(ev, p), at);
}

export function Onboarding() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const geo = useStore((s) => s.geo);
  const goPage = useStore((s) => s.go);
  const { status } = useAccount();
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const [muted, setMuted] = useState(!snd.soundOn());
  const [name, setName] = useState(() => (status?.user?.name ?? settings?.userName ?? "").split(/\s+/)[0] ?? "");
  const [uses, setUses] = useState<Use[]>([]);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [seeds, setSeeds] = useState<string[]>([]);
  const [chosenSeeds, setChosenSeeds] = useState<Set<string>>(new Set());
  const profileKey = useRef("");
  const [maxReached, setMaxReached] = useState(0);
  if (!settings) return null;
  const s = settings;
  const set = (p: Partial<Settings>) => setSettings({ ...s, ...p });
  const step: Step = STEPS[i];
  const keys = {
    dict: geo?.platform === "windows" ? "Right Ctrl" : formatHotkey(s.hotkeyDictation),
    asst: geo?.platform === "windows" ? "Right Alt" : formatHotkey(s.hotkeyAssistant),
  };
  const answers = (): Answers => ({ name, role: deriveRole(uses), uses, languages: [], apps: [] });

  const finish = () => {
    snd.playFinish();
    set({ onboarded: true });
    goPage("home");
  };
  const go = (d: number) => {
    const n = Math.max(0, Math.min(STEPS.length - 1, i + d));
    if (STEPS[n] === "personalise") {
      const k = JSON.stringify(answers());
      if (k !== profileKey.current) {
        const p = buildProfile(answers());
        profileKey.current = k;
        setPrompt(p.systemPrompt);
        setSeeds(p.dictionary);
        setChosenSeeds(new Set(p.dictionary));
      }
    }
    if (n !== i) snd.playStep();
    setDir(d);
    setI(n);
    setMaxReached((m) => Math.max(m, n));
  };
  const jump = (n: number) => {
    if (n === i || n > maxReached) return;
    setDir(n < i ? -1 : 1);
    setI(n);
  };
  const savePersonal = async () => {
    const p = buildProfile(answers());
    await setSettings({ ...s, systemPrompt: prompt ?? p.systemPrompt, userName: name.trim() || s.userName, language: p.language });
    const have = new Set((await api.listDictionary().catch(() => [])).map((d) => d.word.toLowerCase()));
    for (const w of chosenSeeds) if (!have.has(w.toLowerCase())) await api.addDictionary(w).catch(() => {});
  };
  const next = async () => {
    if (step === "personalise") {
      await savePersonal();
      go(1);
      return;
    }
    if (step === "done") return finish();
    go(1);
  };
  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    snd.setSoundOn(!m);
    if (!m) snd.playTick();
  };

  const canSkip = step !== "welcome" && step !== "done";
  const showContinue = step !== "welcome" && step !== "try" && step !== "glimpse-tray";

  return (
    <div className="fixed inset-0 z-50 flex flex-col text-white" role="dialog" aria-modal aria-label="Set up Flo" data-testid="onboarding" data-step={step}>
      <Aurora />

      {/* top bar: back · progress rail · sound · skip */}
      <div className="relative z-10 flex items-center gap-4 px-8 pt-7">
        {i > 0 ? (
          <button className="flex shrink-0 items-center gap-1 text-[13px] text-white/60 transition hover:text-white" onClick={() => go(-1)} aria-label="Back">
            <ChevronLeft size={17} /> Back
          </button>
        ) : (
          <Logo size={26} />
        )}
        <div className="flex flex-1 items-center justify-center gap-2" aria-label={`Step ${i + 1} of ${STEPS.length}`}>
          {STEPS.map((nm, k) => (
            <button
              key={nm}
              type="button"
              title={STEP_NAME[nm]}
              aria-label={STEP_NAME[nm]}
              disabled={k > maxReached || k === i}
              onClick={() => jump(k)}
              className={clsx("h-1 rounded-full transition-all duration-300", k === i ? "w-9 bg-gradient-to-r from-[#3dbbff] to-[#66ceff]" : k < i ? "w-5 bg-white/45 hover:bg-white/70" : "w-5 bg-white/12", k < i && "cursor-pointer")}
            />
          ))}
        </div>
        <button className="shrink-0 text-white/45 transition hover:text-white" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} title={muted ? "Sound off" : "Sound on"}>
          {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>
        {canSkip ? (
          <button className="shrink-0 text-[13px] text-white/45 transition hover:text-white" onClick={finish}>
            Skip setup
          </button>
        ) : (
          <span className="w-16" />
        )}
      </div>

      {/* full-bleed slide */}
      <div className="relative z-10 flex flex-1 items-center justify-center overflow-hidden px-6">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={step}
            custom={dir}
            variants={{
              enter: (d: number) => ({ opacity: 0, x: reduce ? 0 : 60 * d, scale: 0.98 }),
              center: { opacity: 1, x: 0, scale: 1 },
              exit: (d: number) => ({ opacity: 0, x: reduce ? 0 : -60 * d, scale: 0.98 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className="max-h-full w-full max-w-[760px] overflow-y-auto overflow-x-hidden py-4"
          >
            {step === "welcome" && <Welcome onStart={() => go(1)} />}
            {step === "try" && <TryDemo keyLabel={keys.dict} onDone={() => go(1)} />}
            {step === "profile" && <Profile name={name} setName={setName} uses={uses} setUses={setUses} />}
            {step === "personalise" && <Personalise prompt={prompt ?? ""} setPrompt={setPrompt} seeds={seeds} chosen={chosenSeeds} setChosen={setChosenSeeds} />}
            {step === "permissions" && <Permissions />}
            {step === "setup" && <Setup s={s} set={set} />}
            {step === "glimpse-handsfree" && <DemoHandsFree keyLabel={keys.dict} onDone={() => go(1)} />}
            {step === "glimpse-ask" && <DemoAsk keyLabel={keys.asst} onDone={() => go(1)} />}
            {step === "glimpse-tray" && <DemoTray onDone={() => go(1)} />}
            {step === "glimpse-meetings" && <DemoMeetings s={s} set={set} />}
            {step === "typing" && <TypingOffer s={s} onMeasure={() => { set({ onboarded: true }); goPage("typing"); }} />}
            {step === "done" && <Done keys={keys} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* footer actions */}
      <div className="relative z-10 flex items-center justify-center gap-3 px-8 pb-9 pt-2">
        {canSkip && step !== "personalise" && (
          <Button variant="ghost" onClick={() => go(1)}>
            Skip
          </Button>
        )}
        {showContinue && (
          <Button variant="primary" className="!h-12 !px-7 !text-[15px]" onClick={next} icon={step === "done" ? <Check size={16} /> : <ArrowRight size={16} />}>
            {step === "done" ? "Start using Flo" : step === "personalise" ? "Save & continue" : "Continue"}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── slides ───────────────────────────────────────────────────────────────────

function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-col items-center text-center">
      <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 240, damping: 18 }}>
        <Logo size={92} />
      </motion.div>
      <motion.h1 initial={{ opacity: 0, y: 18, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ delay: 0.15, duration: 0.6 }} className="mt-8 text-[46px] font-semibold leading-tight tracking-tight">
        Welcome to Flo
      </motion.h1>
      <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.5 }} className="mt-3 max-w-[460px] text-[17px] text-white/60">
        Your voice, everywhere you work. Hold a key, speak, and the right words land wherever your cursor is.
      </motion.p>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="mt-10">
        <Button variant="primary" className="!h-14 !px-8 !text-[16px]" icon={<ArrowRight size={18} />} onClick={onStart}>
          Get started
        </Button>
      </motion.div>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }} className="mt-5 text-[12.5px] text-white/35">
        Takes under a minute. Everything is skippable.
      </motion.p>
    </div>
  );
}

const PHRASE = "Hello Flo, this is my first dictation";

/** THE WOW: dictation before any question. Reacts to real backend events; a "Watch it" button
 *  plays a self-contained scripted version so the magic lands even if the user doesn't speak. */
function TryDemo({ keyLabel, onDone }: { keyLabel: string; onDone: () => void }) {
  const [mode, setMode] = useState<RibbonMode | null>(null);
  const [text, setText] = useState("");
  const [typed, setTyped] = useState("");
  const done = !!text;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const offs = [
      on<StateEvent>(EV.state, (e) => setMode(e.phase === "listening" ? "listen" : e.phase === "transcribing" ? "transcribe" : e.phase === "thinking" ? "think" : e.phase === "done" ? "done" : null)),
      on<TranscriptEvent>(EV.transcript, (t) => t.final && t.text.trim() && setText(t.text.trim())),
    ];
    return () => offs.forEach((f) => f());
  }, []);
  useEffect(() => {
    if (!text) return;
    snd.playSuccess();
    let n = 0;
    const id = setInterval(() => {
      n++;
      setTyped(text.slice(0, n));
      if (n >= text.length) clearInterval(id);
    }, 28);
    return () => clearInterval(id);
  }, [text]);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => onDoneRef.current(), 2600);
    return () => clearTimeout(t);
  }, [done]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // self-contained scripted playback (works in the real app, no backend)
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

  return (
    <div className="flex flex-col items-center text-center" data-testid="demo" data-done={done ? "true" : "false"}>
      <h2 className="text-[30px] font-semibold tracking-tight">See it in one breath</h2>
      <p className="mt-2 text-[15px] text-white/60">
        Click the box, hold <Key>{keyLabel}</Key> and say <span className="font-medium text-brand-200">"{PHRASE}"</span>
      </p>

      <div className="relative mt-9 w-full max-w-[520px]">
        <motion.div className="mx-auto mb-5 flex w-fit items-center gap-3" animate={mode === "listen" ? { scale: [1, 1.06, 1] } : { scale: 1 }} transition={{ repeat: mode === "listen" ? Infinity : 0, duration: 1.1 }}>
          <kbd className="keycap keycap-active !h-12 !min-w-[56px] !px-4 !text-[18px]">{keyLabel}</kbd>
          <span className="text-white/40">hold &amp; speak</span>
        </motion.div>

        <div className="relative mx-auto h-[44px] w-[340px] overflow-hidden rounded-b-[18px] bg-black shadow-[inset_0_-1px_0_rgba(147,221,255,0.22)]" data-testid="try-ribbon">
          {mode ? <Ribbon width={340} height={44} notchWidth={0} wing={170} mode={mode} leftWing /> : <div className="flex h-full items-center justify-center text-[12px] text-white/30">your notch</div>}
        </div>

        <div className="relative mt-5">
          <textarea
            aria-label="Demo text box"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Your words land here…"
            rows={3}
            className="selectable w-full resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-left text-[16px] text-white outline-none backdrop-blur-xl focus:border-brand-400/60"
          />
          {done && (
            <div aria-hidden className="pointer-events-none absolute left-5 top-4 text-[16px] text-brand-100">
              {typed}
              <motion.span className="ml-0.5 inline-block h-[18px] w-[2px] translate-y-[3px] bg-brand-300" animate={{ opacity: [1, 0] }} transition={{ repeat: Infinity, duration: 0.7 }} />
            </div>
          )}
          {done && <Burst />}
        </div>

        <div className="mt-5 flex h-7 items-center justify-center gap-4 text-[14px]">
          {done ? (
            <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-1.5 font-medium text-emerald-300" data-testid="demo-success">
              <Check size={16} strokeWidth={3} /> That is dictation. It works in every app.
            </motion.span>
          ) : (
            <>
              <button className="flex items-center gap-1.5 text-white/60 transition hover:text-white" onClick={watch}>
                <Play size={15} /> Watch it
              </button>
              {!isTauri && (
                <button
                  className="text-brand-300 hover:underline"
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Profile({ name, setName, uses, setUses }: { name: string; setName: (v: string) => void; uses: Use[]; setUses: (u: Use[]) => void }) {
  const toggle = (id: Use) => {
    setUses(uses.includes(id) ? uses.filter((x) => x !== id) : [...uses, id]);
    snd.playTick();
  };
  return (
    <div className="flex flex-col items-center text-center">
      <h2 className="text-[30px] font-semibold tracking-tight">{name ? `Nice to meet you, ${name}.` : "A little about you"}</h2>
      <p className="mt-2 text-[15px] text-white/60">What will you use Flo for? Pick any that fit, Flo tunes its tone to match.</p>

      <div className="mt-8 grid w-full max-w-[600px] grid-cols-2 gap-3.5 sm:grid-cols-3">
        {USE_TILES.map((t, k) => {
          const on = uses.includes(t.id);
          return (
            <motion.button
              key={t.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: k * 0.04, type: "spring", stiffness: 300, damping: 22 }}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.96 }}
              role="checkbox"
              aria-checked={on}
              aria-label={t.label}
              onClick={() => toggle(t.id)}
              className={clsx(
                "group relative flex h-[128px] flex-col items-center justify-center gap-3 rounded-3xl border text-[14.5px] font-medium transition",
                on ? "border-brand-400/70 bg-brand-400/15 text-white shadow-[0_0_40px_-10px_rgba(61,187,255,0.8)]" : "border-white/10 bg-white/[0.03] text-white/70 hover:border-brand-400/40 hover:text-white",
              )}
            >
              <span className={clsx("transition-colors", on ? "text-brand-200" : "text-white/50 group-hover:text-brand-200")}>{t.icon}</span>
              {t.label}
              {on && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-brand-400 text-black">
                  <Check size={12} strokeWidth={4} />
                </motion.span>
              )}
            </motion.button>
          );
        })}
      </div>

      <div className="mt-8 w-full max-w-[340px] text-left">
        <label className="mb-1.5 block text-[12.5px] font-medium text-white/50" htmlFor="ob-name">
          What should Flo call you?
        </label>
        <Input id="ob-name" aria-label="Your name" placeholder="Your first name" value={name} onChange={(e) => setName(e.target.value)} className="!h-12 !rounded-2xl !text-[16px]" />
      </div>
    </div>
  );
}

function Title({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="mb-6 flex flex-col items-center text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-brand-400/25 to-brand-300/10 text-brand-200 shadow-[0_0_40px_-12px_rgba(61,187,255,0.8)]">{icon}</div>
      <h2 className="text-[26px] font-semibold tracking-tight">{title}</h2>
      <p className="mt-1.5 max-w-[440px] text-[14px] text-white/55">{sub}</p>
    </div>
  );
}

function Personalise({ prompt, setPrompt, seeds, chosen, setChosen }: { prompt: string; setPrompt: (s: string) => void; seeds: string[]; chosen: Set<string>; setChosen: (s: Set<string>) => void }) {
  const [ready, setReady] = useState(false);
  const [shown, setShown] = useState("");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 900);
    return () => clearTimeout(t);
  }, []);
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
        <div className="relative h-[40px] w-[260px] overflow-hidden" aria-hidden>
          <Ribbon width={260} height={40} notchWidth={0} wing={130} mode="think" leftWing />
        </div>
        <p className="text-[15px] text-white/60">Personalising Flo for you…</p>
      </div>
    );
  return (
    <div className="mx-auto max-w-[560px]">
      <Title icon={<Wand2 size={28} />} title="Made for you" sub="This is how Flo will write in your voice. It is yours, edit anything." />
      <div className="relative">
        <textarea
          id="ob-prompt"
          aria-label="System prompt"
          value={editing ? prompt : shown}
          onFocus={() => setEditing(true)}
          onChange={(e) => {
            setEditing(true);
            setPrompt(e.target.value);
          }}
          rows={9}
          className="selectable w-full resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-[13.5px] leading-relaxed text-white/90 outline-none backdrop-blur-xl focus:border-brand-400/60"
        />
        {!editing && shown.length < prompt.length && <span className="pointer-events-none absolute bottom-4 right-5 h-[14px] w-[2px] animate-pulse bg-brand-300" />}
      </div>
      {seeds.length > 0 && (
        <>
          <div className="mb-2 mt-5 text-[12.5px] font-medium text-white/50">Words Flo should always spell right</div>
          <div className="flex flex-wrap gap-1.5" data-testid="seeds">
            {seeds.map((w) => {
              const on = chosen.has(w);
              return (
                <button
                  key={w}
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => {
                    const n = new Set(chosen);
                    if (on) n.delete(w);
                    else n.add(w);
                    setChosen(n);
                    snd.playTick();
                  }}
                  className={clsx("rounded-full border px-3 py-1 text-[12.5px] transition", on ? "border-brand-400/60 bg-brand-400/15 text-white" : "border-white/10 text-white/40 line-through")}
                >
                  {w}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function Permissions() {
  const perms = usePermissions(2000);
  const ICON: Record<string, React.ReactNode> = { microphone: <Mic size={22} />, accessibility: <Keyboard size={22} />, inputMonitoring: <Keyboard size={22} />, screen: <Monitor size={22} /> };
  return (
    <div className="mx-auto max-w-[520px]">
      <Title icon={<ShieldCheck size={28} />} title="A few permissions" sub="Checked live. Grant each one in System Settings, then come back here." />
      <div className="flex flex-col gap-2.5">
        {PERMISSION_ITEMS.map((it) => {
          const ok = !!perms?.[it.key];
          return (
            <motion.div key={it.key} layout className="flex items-center gap-4 rounded-2xl border border-white/8 bg-white/[0.03] px-5 py-4" data-testid="perm-row">
              <motion.span animate={ok ? { backgroundColor: "rgba(52,211,153,0.16)", color: "#6ee7b7" } : {}} className={clsx("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl", ok ? "" : "bg-white/5 text-white/40")}>
                {ok ? <Check size={22} strokeWidth={3} /> : ICON[it.key] ?? <ShieldCheck size={22} />}
              </motion.span>
              <div className="min-w-0 flex-1 text-left">
                <div className="text-[14.5px] font-medium">
                  {it.label} {!it.required && <span className="text-[11.5px] font-normal text-white/35">optional</span>}
                </div>
                <div className="text-[12.5px] text-white/50">{it.why}</div>
              </div>
              {ok ? (
                <span className="text-[13px] font-medium text-emerald-300">Granted</span>
              ) : (
                <Button size="sm" onClick={() => api.openPermissionSettings(it.kind)}>
                  Grant
                </Button>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/** Voice engine + AI brain condensed into one calm "Make it yours" step. */
function Setup({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const [models, setModels] = useState<LocalModel[] | null>(null);
  const [pr, setPr] = useState<ModelProgressEvent | null>(null);
  useEffect(() => {
    api.listModels().then(setModels);
    return on<ModelProgressEvent>(EV.modelProgress, (e) => {
      setPr(e);
      if (e.done) api.listModels().then(setModels);
    });
  }, []);
  const rec = models?.find((m) => m.id === RECOMMENDED) ?? models?.[0];
  const local = s.sttProvider === "local";
  const pct = pr && !pr.done ? Math.round((pr.received / Math.max(1, pr.total)) * 100) : null;
  const cloud = providerInfo(s.sttProvider === "openai" ? "openai" : "groq")!;
  return (
    <div className="mx-auto max-w-[560px]">
      <Title icon={<Sparkles size={28} />} title="Make it yours" sub="Where your voice is transcribed, and the AI that polishes it. Sensible defaults, change anytime." />

      <div className="mb-2 text-[12.5px] font-medium text-white/50">Voice engine</div>
      <div className="grid grid-cols-2 gap-3">
        <button className={clsx("rounded-2xl border p-4 text-left transition", local ? "border-brand-400/60 bg-brand-400/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]")} onClick={() => set({ sttProvider: "local", sttModel: rec?.id ?? RECOMMENDED })}>
          <Cpu size={20} className="text-brand-200" />
          <div className="mt-2 text-[14.5px] font-semibold">On this Mac</div>
          <div className="text-[12px] text-white/50">Recommended. Audio never leaves.</div>
        </button>
        <button className={clsx("rounded-2xl border p-4 text-left transition", !local ? "border-brand-400/60 bg-brand-400/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]")} onClick={() => set({ sttProvider: "groq", sttModel: "whisper-large-v3-turbo" })}>
          <Cloud size={20} className="text-brand-200" />
          <div className="mt-2 text-[14.5px] font-semibold">Cloud</div>
          <div className="text-[12px] text-white/50">Groq or OpenAI, your key.</div>
        </button>
      </div>
      <div className="mt-3 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
        {local ? (
          !rec ? (
            <div className="h-10 animate-pulse rounded-xl bg-white/5" />
          ) : (
            <div className="flex items-center gap-3" data-testid="voice-model">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium">{rec.label}</div>
                <div className="text-[12px] text-white/40">{rec.languages} · {rec.sizeMb} MB</div>
                {pct !== null && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={pct}>
                    <motion.div className="h-full bg-gradient-to-r from-[#3dbbff] to-[#66ceff]" animate={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
              {rec.installed ? (
                <span className="flex items-center gap-1 text-[12.5px] font-medium text-emerald-300"><Check size={13} strokeWidth={3} /> Ready</span>
              ) : (
                <Button size="sm" variant="primary" disabled={pct !== null} icon={<Download size={13} />} onClick={() => api.downloadModel(rec.id)}>
                  {pct !== null ? `${pct}%` : "Download"}
                </Button>
              )}
            </div>
          )
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13.5px] font-medium">Provider</span>
              <Select value={s.sttProvider} onChange={(v) => set({ sttProvider: v, sttModel: v === "groq" ? "whisper-large-v3-turbo" : "gpt-4o-mini-transcribe" })} options={[{ value: "groq", label: "Groq Whisper" }, { value: "openai", label: "OpenAI" }]} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13.5px] font-medium">API key</span>
              <ProviderKey info={cloud} />
            </div>
          </div>
        )}
      </div>

      <div className="mb-2 mt-5 text-[12.5px] font-medium text-white/50">AI brain</div>
      <div className="flex flex-col divide-y divide-white/8 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-1">
        <AiProviderFields
          s={s}
          set={set}
          row={(label, hint, node) => (
            <div key={label} className="flex items-center justify-between gap-4 py-2.5">
              <div>
                <div className="text-[13.5px] font-medium">{label}</div>
                {hint && <div className="mt-0.5 text-[12px] text-white/45">{hint}</div>}
              </div>
              <div className="shrink-0">{node}</div>
            </div>
          )}
        />
      </div>
    </div>
  );
}

// ── optional glimpses (reuse live backend events) ─────────────────────────────

function GlimpseShell({ icon, title, sub, done, children, onSimulate }: { icon: React.ReactNode; title: string; sub: React.ReactNode; done: boolean; children: React.ReactNode; onSimulate?: () => void }) {
  return (
    <div className="mx-auto max-w-[520px]" data-testid="demo" data-done={done ? "true" : "false"}>
      <Title icon={icon} title={title} sub="" />
      <div className="-mt-3 mb-5 text-center text-[14px] text-white/70">{sub}</div>
      <div className="relative">{children}{done && <Burst />}</div>
      <div className="mt-4 flex h-6 items-center justify-center gap-4 text-[13px]">
        {done ? (
          <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-1.5 font-medium text-emerald-300" data-testid="demo-success">
            <Check size={15} strokeWidth={3} /> Nice
          </motion.span>
        ) : (
          <span className="text-white/35">Optional, skip anytime</span>
        )}
        {!isTauri && onSimulate && !done && (
          <button className="text-[12px] text-brand-300 hover:underline" onClick={onSimulate}>Simulate (preview)</button>
        )}
      </div>
    </div>
  );
}

function useLiveMode() {
  const [mode, setMode] = useState<RibbonMode | null>(null);
  const [message, setMessage] = useState<string | undefined>();
  useEffect(() => on<StateEvent>(EV.state, (e) => { setMessage(e.message); setMode(e.phase === "listening" ? "listen" : e.phase === "transcribing" ? "transcribe" : e.phase === "thinking" ? "think" : e.phase === "done" ? "done" : null); }), []);
  return { mode, message };
}
function Strip({ mode }: { mode: RibbonMode | null }) {
  return (
    <div className="relative mx-auto h-[40px] w-[320px] overflow-hidden rounded-b-[16px] bg-black shadow-[inset_0_-1px_0_rgba(147,221,255,0.2)]" data-testid="try-ribbon">
      {mode ? <Ribbon width={320} height={40} notchWidth={0} wing={160} mode={mode} leftWing /> : <div className="flex h-full items-center justify-center text-[11.5px] text-white/30">the notch</div>}
    </div>
  );
}
function useAutoNext(done: boolean, next: () => void, ms = 1800) {
  const ref = useRef(next);
  ref.current = next;
  useEffect(() => {
    if (!done) return;
    snd.playSuccess();
    const t = setTimeout(() => ref.current(), ms);
    return () => clearTimeout(t);
  }, [done, ms]);
}

function DemoHandsFree({ keyLabel, onDone }: { keyLabel: string; onDone: () => void }) {
  const { mode, message } = useLiveMode();
  const [seen, setSeen] = useState(false);
  useEffect(() => { if (mode === "listen" && message === "hands-free") setSeen(true); }, [mode, message]);
  useAutoNext(seen, onDone);
  return (
    <GlimpseShell icon={<Radio size={28} />} title="Hands-free" done={seen} sub={<>Press <Key>{keyLabel}</Key> + <Key>Space</Key>, then let go. Flo keeps listening until you tap <Key>{keyLabel}</Key> again.</>} onSimulate={() => simulate([[0, EV.state, { phase: "listening", mode: "dictation", message: "hands-free" }]])}>
      <Strip mode={mode} />
      <p className="mt-3 text-center text-[12px] text-white/40">Great for long messages and pacing around.</p>
    </GlimpseShell>
  );
}

function DemoAsk({ keyLabel, onDone }: { keyLabel: string; onDone: () => void }) {
  const { mode } = useLiveMode();
  const [reply, setReply] = useState<string | null>(null);
  useEffect(() => on<AssistantResponse>(EV.assistant, (r) => r?.reply && setReply(toPlainText(r.reply))), []);
  useAutoNext(!!reply, onDone, 2600);
  return (
    <GlimpseShell icon={<Sparkles size={28} />} title="Ask about your screen" done={!!reply} sub={<>Hold <Key>{keyLabel}</Key> and ask <span className="font-medium text-brand-200">"What's on my screen?"</span></>} onSimulate={() => { simulate([[0, EV.state, { phase: "thinking", mode: "assistant" }]]); api.askAssistant("What's on my screen?").catch(() => {}); }}>
      <Strip mode={mode} />
      {reply && <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 line-clamp-3 rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3 text-[13px] text-white/85" data-testid="demo-reply">{reply}</motion.p>}
    </GlimpseShell>
  );
}

function DemoTray({ onDone }: { onDone: () => void }) {
  const [added, setAdded] = useState(false);
  useAutoNext(added, onDone, 2800);
  return (
    <GlimpseShell icon={<Bot size={28} />} title="Your agent tray" done={added} sub="Claude Code, Codex or Cursor sessions appear by the notch when they finish or need you.">
      <div className="mx-auto flex h-[40px] w-[320px] items-center justify-between rounded-b-[16px] bg-black px-3" data-testid="tray-preview">
        <AnimatePresence>{added && <motion.span initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 520, damping: 22 }}><ClaudeAvatar status="done" source="claude" /></motion.span>}</AnimatePresence>
        <span />
      </div>
      {added ? (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="island-tip mx-auto mt-2 flex w-[320px] items-center gap-2 rounded-2xl px-3 py-2.5 text-white">
          <ClaudeAvatar status="done" source="claude" />
          <div className="min-w-0 flex-1"><div className="text-[12.5px] font-semibold">my-app · Done</div><div className="truncate text-[11.5px] text-white/60">Built the login page, all tests pass.</div></div>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px]">Open</span>
        </motion.div>
      ) : (
        <div className="mt-5 text-center"><Button variant="primary" onClick={() => { setAdded(true); snd.playTick(); }}>Show me</Button></div>
      )}
    </GlimpseShell>
  );
}

function DemoMeetings({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  return (
    <GlimpseShell icon={<Radio size={28} />} title="Meetings, handled" done={false} sub="When a call starts using your mic, Flo offers to take notes. Transcribed and summarised on this Mac.">
      <div className="mx-auto w-[340px] overflow-hidden rounded-b-[20px] bg-black px-4 pb-3 pt-[44px] text-white" aria-hidden>
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5"><span className="absolute inset-0 rounded-full bg-red-500 opacity-60 [animation:ping_1s_cubic-bezier(0,0,0.2,1)_3]" /><span className="relative h-2.5 w-2.5 rounded-full bg-red-500" /></span>
          <div className="min-w-0 flex-1"><div className="text-[13px] font-semibold">Zoom call detected</div><div className="text-[11.5px] text-white/60">Take notes on this Mac?</div></div>
          <span className="rounded-full bg-brand-300/30 px-2.5 py-1 text-[11px] font-semibold">Start notes</span>
        </div>
      </div>
      <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 text-[13px] text-white/80">
        <input type="checkbox" checked={s.meetingDetection} onChange={(e) => set({ meetingDetection: e.target.checked })} className="accent-[#3dbbff]" />
        Offer to take notes when a call starts
      </label>
    </GlimpseShell>
  );
}

function TypingOffer({ s, onMeasure }: { s: Settings; onMeasure: () => void }) {
  return (
    <div className="flex flex-col items-center py-4 text-center" data-testid="typing-offer">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-brand-400/25 to-brand-300/10 text-brand-200 shadow-[0_0_40px_-12px_rgba(61,187,255,0.8)]"><Gauge size={28} /></div>
      <h2 className="text-[26px] font-semibold tracking-tight">Measure your typing speed?</h2>
      <p className="mt-2 max-w-[440px] text-[14px] text-white/55">About a minute. Flo uses it to show how much time speaking saves you. Your current estimate is {s.typingWpm} wpm, and you can always do this later.</p>
      <Button variant="primary" className="mt-6 !h-12 !px-6" icon={<Gauge size={15} />} onClick={onMeasure}>Measure now</Button>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="keycap keycap-active mx-0.5">{children}</kbd>;
}

function Done({ keys }: { keys: { dict: string; asst: string } }) {
  const rows = useMemo(
    () => [
      [<Key key="a">{keys.dict}</Key>, "Hold to dictate anywhere"],
      [<span key="b"><Key>{keys.dict}</Key>+<Key>Space</Key></span>, "Hands-free dictation"],
      [<Key key="c">{keys.asst}</Key>, "Hold to ask Flo, it can see your screen"],
      [<Key key="d">Esc</Key>, "Cancel"],
      [<span key="e" className="text-[12px] text-white/50">hover the notch</span>, "Quick actions and your agents"],
    ],
    [keys],
  );
  return (
    <div className="flex flex-col items-center py-2 text-center">
      <motion.div initial={{ scale: 0.5, rotate: -25 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 360, damping: 15 }}>
        <div className="flex h-20 w-20 items-center justify-center rounded-[28px] bg-gradient-to-br from-[#3dbbff] to-[#1a9be0] shadow-[0_0_60px_-8px_rgba(61,187,255,0.9)]">
          <Check size={38} strokeWidth={3} className="text-white" />
        </div>
      </motion.div>
      <motion.h2 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="mt-6 text-[32px] font-semibold tracking-tight">You're all set</motion.h2>
      <p className="mt-1.5 text-[14px] text-white/55">Flo lives in your notch. Here's everything you need.</p>
      <div className="mt-7 w-full max-w-[460px] divide-y divide-white/8 rounded-2xl border border-white/8 bg-white/[0.03] px-5 text-left" data-testid="cheatsheet">
        {rows.map(([k, label], n) => (
          <motion.div key={n} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + n * 0.06 }} className="flex items-center justify-between gap-4 py-3 text-[13.5px]">
            <span className="shrink-0">{k}</span>
            <span className="text-white/55">{label}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
