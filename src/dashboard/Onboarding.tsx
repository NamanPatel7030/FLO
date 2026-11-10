// First-run setup (after sign-in, while settings.onboarded === false). Always light: airy pastel
// glass with Notchling hanging from the top edge like a real notch, guiding each step with its
// mood. Seven steps: hello and your name, permissions, a real first dictation, voice and AI, two
// short questions about you, the keys to remember, then a signature finale before Flo opens. Reopen from Settings → General →
// "Run setup again". Step list and profile logic live in onboarding/flow.ts (unit-tested).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import clsx from "clsx";
import { ArrowRight, Check, ChevronLeft, Volume2, VolumeX } from "lucide-react";
import { api } from "../lib/api";
import type { Settings } from "../lib/types";
import { formatHotkey, hotkeyWords } from "../lib/format";
import { applyTheme } from "../lib/theme";
import { useAccount } from "../lib/account";
import type { NotchlingMood } from "../lib/notchling";
import * as snd from "../lib/onboardSounds";
import { useStore } from "./store";
import { Sky } from "./onboarding/Aurora";
import { HangingNotch, useWakeUp } from "./onboarding/Mascot";
import { Btn, EASE } from "./onboarding/parts";
import { Finale } from "./onboarding/Finale";
import { RoleStep, TryDemo, UsesStep, Welcome } from "./onboarding/Steps";
import { Done, Permissions, SetupStep } from "./onboarding/SetupSteps";
import { CHAPTERS, EMPTY_ANSWERS, STEPS, STEP_MOOD, STEP_NAME, clampStep, headline, profileFor, type SetupAnswers, type Step } from "./onboarding/flow";
import "./onboarding/onboarding.css";

/** Setup is always light, whatever the app theme. Embedded app widgets (selects, key fields, the
 *  typing test) read the theme from <html>, so hold data-theme="light" while setup is open and
 *  hand the real theme back when it closes. */
function useLightTheme(active: boolean) {
  useLayoutEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const force = () => {
      if (root.dataset.theme !== "light") {
        root.dataset.theme = "light";
        root.style.colorScheme = "light";
      }
    };
    force();
    const mo = new MutationObserver(force);
    mo.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mo.disconnect();
      const st = useStore.getState().settings;
      if (st) applyTheme(st);
    };
  }, [active]);
}

/** Start the speech model download as soon as setup opens, so it's ready (or nearly) by the time the
 *  person has allowed the mic and Accessibility and tries their first dictation. Only for the
 *  on-device engine and only when the chosen model isn't on disk yet; the backend ignores a second
 *  request for a download already running (the Download button on the Voice step). */
function useBackgroundModel(settings: Settings | null) {
  const started = useRef(false);
  const local = settings?.sttProvider === "local";
  const model = settings?.sttModel;
  useEffect(() => {
    if (started.current || !local || !model) return;
    started.current = true;
    api
      .listModels()
      .then((ms) => {
        const m = ms.find((x) => x.id === model);
        if (m && !m.installed) api.downloadModel(m.id).catch(() => {});
      })
      .catch(() => {});
  }, [local, model]);
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
  const [maxReached, setMaxReached] = useState(0);
  const [muted, setMuted] = useState(!snd.soundOn());
  const [answers, setAnswers] = useState<SetupAnswers>(() => ({ ...EMPTY_ANSWERS, name: (status?.user?.name ?? settings?.userName ?? "").split(/\s+/)[0] ?? "" }));
  const [moodOverride, setMoodOverride] = useState<NotchlingMood | null>(null);
  const [tried, setTried] = useState(false);
  const [permsOk, setPermsOk] = useState(false);
  const [phase, setPhase] = useState<"steps" | "finale" | "leaving">("steps");
  const wake = useWakeUp(true);
  useLightTheme(phase !== "leaving");

  const setMood = useCallback((m: NotchlingMood | null) => setMoodOverride(m), []);
  const onPerms = useCallback((ok: boolean) => setPermsOk(ok), []);
  const onTried = useCallback(() => setTried(true), []);
  useBackgroundModel(settings);

  if (!settings) return null;
  const s = settings;
  const set = (p: Partial<Settings>) => setSettings({ ...s, ...p });
  const step: Step = STEPS[i];
  const keys = {
    dict: geo?.platform === "windows" ? "Right Ctrl" : formatHotkey(s.hotkeyDictation),
    asst: geo?.platform === "windows" ? "Right Alt" : formatHotkey(s.hotkeyAssistant),
  };
  const patch = (p: Partial<SetupAnswers>) => setAnswers((a) => ({ ...a, ...p }));
  const h = headline(step, answers.name);
  const mood: NotchlingMood = (step === "welcome" && wake) || moodOverride || STEP_MOOD[step];
  const chapter = CHAPTERS.findIndex((c) => c.steps.includes(step));

  const go = (d: number) => {
    const n = clampStep(i + d);
    if (n === i) return;
    snd.playStep();
    setMoodOverride(null);
    setDir(d);
    setI(n);
    setMaxReached((m) => Math.max(m, n));
  };
  const jump = (n: number) => {
    if (n === i || n > maxReached) return;
    setMoodOverride(null);
    setDir(n < i ? -1 : 1);
    setI(n);
  };
  // the answers become a personal prompt, the speech language and dictionary words, saved when
  // the last question is answered
  const savePersonal = async () => {
    const p = profileFor(answers);
    await setSettings({ ...s, systemPrompt: p.systemPrompt, userName: answers.name.trim() || s.userName, language: p.language });
    const have = new Set((await api.listDictionary().catch(() => [])).map((d) => d.word.toLowerCase()));
    for (const w of p.dictionary) if (!have.has(w.toLowerCase())) await api.addDictionary(w).catch(() => {});
  };
  const next = async () => {
    if (step === "uses") await savePersonal();
    if (step === "done") {
      snd.playFinish();
      goPage("home");
      setPhase("finale");
      return;
    }
    go(1);
  };
  // the finale ends: give the app its theme back and fade setup away to reveal the dashboard
  const endFinale = () => setPhase("leaving");
  const finish = () => set({ onboarded: true });
  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    snd.setSoundOn(!m);
    if (!m) snd.playTick();
  };

  // footer: Back on the left, one forward action on the right (never a generic "Skip")
  const forward: { label: string; kind: "primary" | "soft"; disabled?: boolean; icon?: React.ReactNode }[] =
    step === "welcome"
      ? []
      : step === "try"
        ? tried
          ? [{ label: "Continue", kind: "primary" }]
          : [{ label: "I'll try it later", kind: "soft" }]
        : step === "permissions"
          ? permsOk
            ? [{ label: "Continue", kind: "primary" }]
            : [{ label: "I'll do this later", kind: "soft" }]
          : step === "done"
            ? [{ label: "Start using Flo", kind: "primary", icon: <Check size={17} strokeWidth={2.6} /> }]
            : [{ label: "Continue", kind: "primary" }];

  return (
    <motion.div
      className="onb fixed inset-0 z-50 flex flex-col overflow-hidden"
      role="dialog"
      aria-modal
      aria-label="Set up Flo"
      data-testid="onboarding"
      data-step={step}
      initial={false}
      animate={phase === "leaving" ? { opacity: 0, scale: 1.04, filter: "blur(10px)" } : { opacity: 1, scale: 1, filter: "blur(0px)" }}
      transition={{ duration: reduce ? 0.2 : 0.7, ease: EASE }}
      onAnimationComplete={() => phase === "leaving" && finish()}
    >
      <Sky hue={chapter * 8} />
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-10 h-9" />

      {/* Notchling, hanging from the top edge; sound toggle top right */}
      <div className="relative z-20 flex shrink-0 justify-center">
        <HangingNotch mood={mood} big={step === "welcome"} avatar={s.avatar} accent={s.accent} />
        <button
          className="absolute right-6 top-5 flex h-8 w-8 items-center justify-center rounded-full text-[#8a94a6] transition hover:bg-white/70 hover:text-[#0b1220]"
          onClick={toggleMute}
          aria-label={muted ? "Unmute" : "Mute"}
          title={muted ? "Sound off" : "Sound on"}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
      </div>

      {/* the step */}
      <div className="relative z-10 flex min-h-0 flex-1 justify-center px-8">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div
            key={step}
            custom={dir}
            variants={{
              enter: (d: number) => ({ opacity: 0, x: reduce ? 0 : 48 * d, filter: reduce ? "none" : "blur(10px)" }),
              center: { opacity: 1, x: 0, filter: "blur(0px)" },
              exit: (d: number) => ({ opacity: 0, x: reduce ? 0 : -48 * d, filter: reduce ? "none" : "blur(10px)" }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: "spring", stiffness: 240, damping: 30, filter: { duration: 0.3 } }}
            className="flex h-full w-full max-w-[940px] flex-col overflow-y-auto overflow-x-hidden px-1"
          >
            <div className={clsx("my-auto flex w-full flex-col items-center pb-2", step === "welcome" ? "pt-2" : "pt-1")}>
            {step === "welcome" && <Welcome title={h.title} sub={h.sub} name={answers.name} setName={(name) => patch({ name })} onStart={() => go(1)} />}
            {step === "permissions" && <Permissions title={h.title} sub={h.sub} setMood={setMood} onStatus={onPerms} onDone={() => go(1)} />}
            {step === "try" && <TryDemo keyLabel={keys.dict} keyWord={geo?.platform === "windows" ? undefined : hotkeyWords(s.hotkeyDictation)} onSuccess={onTried} setMood={setMood} />}
            {step === "setup" && <SetupStep title={h.title} sub={h.sub} s={s} set={set} />}
            {step === "role" && <RoleStep title={h.title} sub={h.sub} a={answers} set={patch} onPicked={() => go(1)} />}
            {step === "uses" && <UsesStep title={h.title} sub={h.sub} a={answers} set={patch} />}
            {step === "done" && <Done title={h.title} sub={h.sub} keys={keys} />}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* footer: chapters on the left, Back + forward on the right */}
      <div className="relative z-10 flex h-[96px] shrink-0 items-center justify-between gap-4 px-10">
        <nav className="flex items-center gap-5" aria-label={`Step ${i + 1} of ${STEPS.length}`}>
          {CHAPTERS.map((c, ci) => (
            <div key={c.name} className="flex flex-col gap-1.5">
              <span className={clsx("text-[12px] font-semibold uppercase tracking-[0.12em] transition-colors duration-300", ci === chapter ? "text-[#0b1220]" : ci < chapter ? "text-[#5b6678]" : "text-[#a3acbb]")}>{c.name}</span>
              <div className="flex items-center gap-1">
                {c.steps.map((nm) => {
                  const k = STEPS.indexOf(nm);
                  return (
                    <button
                      key={nm}
                      type="button"
                      title={STEP_NAME[nm]}
                      aria-label={STEP_NAME[nm]}
                      aria-current={k === i ? "step" : undefined}
                      disabled={k > maxReached || k === i}
                      onClick={() => jump(k)}
                      className={clsx("onb-dot", k === i ? "w-8 bg-gradient-to-r from-[#2f8cff] to-[#7a6cff]" : k <= maxReached ? "w-3 cursor-pointer bg-[#0b1220]/35 hover:bg-[#0b1220]/60" : "w-3 bg-[#0b1220]/10")}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-2.5">
          {i > 0 && (
            <Btn kind="soft" aria-label="Back" onClick={() => go(-1)} className="!px-4">
              <ChevronLeft size={18} className="-ml-1" />
              Back
            </Btn>
          )}
          <AnimatePresence mode="popLayout" initial={false}>
            {forward.map((f) => (
              <motion.div key={`${f.kind}-${f.label}`} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ type: "spring", stiffness: 380, damping: 28 }}>
                <Btn kind={f.kind} disabled={f.disabled} onClick={f.kind === "soft" ? () => go(1) : next} icon={f.icon ?? (f.kind === "primary" ? <ArrowRight size={17} /> : undefined)}>
                  {f.label}
                </Btn>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>{phase !== "steps" && <Finale onEnd={endFinale} />}</AnimatePresence>
    </motion.div>
  );
}
