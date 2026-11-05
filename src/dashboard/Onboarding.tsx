// Lemon-style onboarding (after sign-in, while settings.onboarded === false): one question per
// screen, big chips, slide transitions, a personalised system prompt, setup, then live demos.
// Skippable everywhere; reopen from Settings → General → "Run setup again".
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { ArrowRight, Check, ChevronLeft, Cloud, Cpu, Download, Gauge, Mic, PartyPopper, Radio, ShieldCheck, Sparkles, Wand2 } from "lucide-react";
import { api, isTauri, on } from "../lib/api";
import { EV, type AssistantResponse, type LocalModel, type ModelProgressEvent, type Settings, type StateEvent, type TranscriptEvent } from "../lib/types";
import { formatHotkey } from "../lib/format";
import { APPS, buildProfile, LANGS, ROLES, USES, type Answers, type App, type Lang, type Use } from "../lib/profile";
import { toPlainText } from "../lib/markdown";
import { useAccount } from "../lib/account";
import { useStore } from "./store";
import { Button, Input, Select } from "./ui";
import { PERMISSION_ITEMS, usePermissions } from "./usePermissions";
import { AiProviderFields, providerInfo, ProviderKey } from "./AiSetup";
import { Ribbon, type RibbonMode } from "../island/Ribbon";
import { ClaudeAvatar } from "../island/Tray";

const STEPS = [
  "name",
  "role",
  "uses",
  "languages",
  "apps",
  "personalise",
  "permissions",
  "voice",
  "ai",
  "demo-dictate",
  "demo-handsfree",
  "demo-ask",
  "demo-tray",
  "demo-meetings",
  "typing",
  "done",
] as const;
type Step = (typeof STEPS)[number];
const RECOMMENDED = "large-v3-turbo-q5_0";

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
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const [a, setA] = useState<Answers>(() => ({ name: (status?.user?.name ?? settings?.userName ?? "").split(/\s+/)[0] ?? "", role: "", uses: [], languages: [], apps: [] }));
  const [prompt, setPrompt] = useState<string | null>(null);
  const [seeds, setSeeds] = useState<string[]>([]);
  const [chosenSeeds, setChosenSeeds] = useState<Set<string>>(new Set());
  const profileKey = useRef("");
  if (!settings) return null;
  const s = settings;
  const set = (p: Partial<Settings>) => setSettings({ ...s, ...p });
  const step: Step = STEPS[i];
  const keys = {
    dict: geo?.platform === "windows" ? "Right Ctrl" : formatHotkey(s.hotkeyDictation),
    asst: geo?.platform === "windows" ? "Right Alt" : formatHotkey(s.hotkeyAssistant),
  };

  const finish = () => {
    set({ onboarded: true });
    goPage("home");
  };
  /** furthest step reached, so dots only jump back to completed steps */
  const [maxReached, setMaxReached] = useState(0);
  const go = (d: number) => {
    const n = Math.max(0, Math.min(STEPS.length - 1, i + d));
    // entering Personalise: (re)generate from the answers unless already edited for these answers
    if (STEPS[n] === "personalise") {
      const k = JSON.stringify(a);
      if (k !== profileKey.current) {
        const p = buildProfile(a);
        profileKey.current = k;
        setPrompt(p.systemPrompt);
        setSeeds(p.dictionary);
        setChosenSeeds(new Set(p.dictionary));
      }
    }
    setDir(d);
    setI(n);
    setMaxReached((m) => Math.max(m, n));
  };
  /** jump straight to an already-seen step via the progress dots */
  const jump = (n: number) => {
    if (n === i || n > maxReached) return;
    setDir(n < i ? -1 : 1);
    setI(n);
  };
  const savePersonal = async () => {
    const p = buildProfile(a);
    await setSettings({ ...s, systemPrompt: prompt ?? p.systemPrompt, userName: a.name.trim() || s.userName, language: p.language });
    const have = new Set((await api.listDictionary().catch(() => [])).map((d) => d.word.toLowerCase()));
    for (const w of chosenSeeds) if (!have.has(w.toLowerCase())) await api.addDictionary(w).catch(() => {});
  };
  const next = async () => {
    if (step === "personalise") {
      await savePersonal();
      go(1); // saved → close this step automatically
      return;
    }
    if (step === "done") return finish();
    go(1);
  };
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const isQuestion = i <= 4;
  const isDemo = step.startsWith("demo-");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal aria-label="Set up Flo" data-testid="onboarding" data-step={step}>
      <div className="absolute inset-0" style={{ background: "var(--scrim)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }} />
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(800px 420px at 50% 0%, rgba(61,187,255,0.18), transparent 70%)" }} aria-hidden />
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
        className="relative flex max-h-full w-full max-w-[660px] flex-col overflow-hidden rounded-3xl border border-brand-200/15 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
        style={{ background: "var(--sheet-bg)" }}
      >
        {/* back + progress dots + skip */}
        <div className="flex items-center gap-3 px-7 pt-6">
          {i > 0 ? (
            <button className="flex shrink-0 items-center gap-0.5 text-[12.5px] text-muted hover:text-[var(--fg)]" onClick={() => go(-1)} aria-label="Back">
              <ChevronLeft size={16} /> Back
            </button>
          ) : (
            <span className="w-2" />
          )}
          <div className="flex flex-1 items-center gap-1.5" aria-label={`Step ${i + 1} of ${STEPS.length}`}>
            {STEPS.map((name, k) => (
              <motion.button
                key={name}
                layout
                type="button"
                aria-label={`Step ${k + 1}`}
                disabled={k > maxReached || k === i}
                onClick={() => jump(k)}
                className={clsx("h-1.5 rounded-full transition-colors", k < i ? "bg-brand-400/70 hover:bg-brand-400" : k === i ? "accent-gradient" : "bg-[var(--glass-strong)]", k < i && "cursor-pointer")}
                animate={{ width: k === i ? 22 : 6 }}
                transition={{ type: "spring", stiffness: 500, damping: 36 }}
              />
            ))}
          </div>
          {step !== "done" && (
            <button className="text-[12.5px] text-muted hover:text-[var(--fg)]" onClick={finish}>
              Skip setup
            </button>
          )}
        </div>

        <div className="relative min-h-[400px] flex-1 overflow-y-auto overflow-x-hidden px-7 py-6">
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div
              key={step}
              custom={dir}
              variants={{ enter: (d: number) => ({ opacity: 0, x: 40 * d }), center: { opacity: 1, x: 0 }, exit: (d: number) => ({ opacity: 0, x: -40 * d }) }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {step === "name" && (
                <Question emoji="👋" title="What should Flo call you?" sub="Used in greetings and to spot messages meant for you.">
                  <Input
                    autoFocus
                    aria-label="Your name"
                    placeholder="Your first name"
                    value={a.name}
                    onChange={(e) => setA({ ...a, name: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && next()}
                    className="!h-14 max-w-[360px] !rounded-2xl !text-[18px]"
                  />
                </Question>
              )}
              {step === "role" && (
                <Question emoji="🧭" title={a.name ? `Nice to meet you, ${a.name}. What do you do?` : "What do you do?"} sub="Flo tunes its tone and vocabulary to your work.">
                  <Chips
                    options={ROLES}
                    selected={a.role ? [a.role] : []}
                    onPick={(id) => {
                      setA({ ...a, role: id });
                      setTimeout(() => go(1), 260); // single choice: move on by itself
                    }}
                  />
                </Question>
              )}
              {step === "uses" && (
                <Question emoji="🎯" title="What will you use Flo for?" sub="Pick as many as you like.">
                  <Chips multi options={USES} selected={a.uses} onPick={(id: Use) => setA({ ...a, uses: toggle(a.uses, id) })} />
                </Question>
              )}
              {step === "languages" && (
                <Question emoji="🗣️" title="Which languages do you speak?" sub="Flo keeps the language you speak in, mixes included.">
                  <Chips multi options={LANGS} selected={a.languages} onPick={(id: Lang) => setA({ ...a, languages: toggle(a.languages, id) })} />
                  {a.languages.includes("other") && (
                    <Input autoFocus aria-label="Other language" placeholder="e.g. Marathi, Tamil" value={a.otherLanguage ?? ""} onChange={(e) => setA({ ...a, otherLanguage: e.target.value })} className="mt-3 max-w-[300px]" />
                  )}
                </Question>
              )}
              {step === "apps" && (
                <Question emoji="🧩" title="Where do you write most?" sub="Flo learns these names so it spells them right.">
                  <Chips multi options={APPS} selected={a.apps} onPick={(id: App) => setA({ ...a, apps: toggle(a.apps, id) })} />
                </Question>
              )}
              {step === "personalise" && (
                <Personalise prompt={prompt ?? ""} setPrompt={setPrompt} seeds={seeds} chosen={chosenSeeds} setChosen={setChosenSeeds} />
              )}
              {step === "permissions" && <Permissions />}
              {step === "voice" && <Voice s={s} set={set} />}
              {step === "ai" && <Ai s={s} set={set} />}
              {step === "demo-dictate" && <DemoDictate keyLabel={keys.dict} onDone={() => go(1)} />}
              {step === "demo-handsfree" && <DemoHandsFree keyLabel={keys.dict} onDone={() => go(1)} />}
              {step === "demo-ask" && <DemoAsk keyLabel={keys.asst} onDone={() => go(1)} />}
              {step === "demo-tray" && <DemoTray onDone={() => go(1)} />}
              {step === "demo-meetings" && <DemoMeetings s={s} set={set} />}
              {step === "typing" && <TypingOffer s={s} onMeasure={() => { set({ onboarded: true }); goPage("typing"); }} />}
              {step === "done" && <Done keys={keys} />}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-end border-t border-[var(--border)] px-7 py-4">
          <div className="flex items-center gap-2">
            {(isQuestion || isDemo || step === "ai" || step === "typing") && step !== "demo-meetings" && (
              <Button variant="ghost" onClick={() => go(1)}>
                Skip
              </Button>
            )}
            <Button variant="primary" onClick={next} icon={step === "done" ? <Check size={14} /> : <ArrowRight size={14} />}>
              {step === "done" ? "Start using Flo" : step === "personalise" ? "Save & continue" : "Continue"}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── building blocks ──────────────────────────────────────────────────────────

function Question({ emoji, title, sub, children }: { emoji: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="pt-2">
      <div className="text-[34px] leading-none" aria-hidden>
        {emoji}
      </div>
      <h2 className="mt-4 text-[24px] font-semibold tracking-tight">{title}</h2>
      <p className="mb-6 mt-1.5 text-[13.5px] text-muted">{sub}</p>
      {children}
    </div>
  );
}

function Chips<T extends string>({
  options,
  selected,
  onPick,
  multi,
}: {
  options: { id: T; label: string; emoji?: string }[];
  selected: T[];
  onPick: (id: T) => void;
  multi?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2.5" role={multi ? "group" : "radiogroup"}>
      {options.map((o, k) => {
        const on = selected.includes(o.id);
        return (
          <motion.button
            key={o.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: k * 0.025 }}
            whileTap={{ scale: 0.96 }}
            role={multi ? "checkbox" : "radio"}
            aria-checked={on}
            onClick={() => onPick(o.id)}
            className={clsx(
              "flex h-12 items-center gap-2 rounded-2xl border px-4 text-[14.5px] font-medium transition",
              on ? "border-brand-400/70 bg-brand-400/15 text-[var(--fg)] shadow-[0_0_24px_-8px_rgba(61,187,255,0.7)]" : "border-[var(--border)] bg-[var(--glass)] text-muted hover:border-brand-400/40 hover:text-[var(--fg)]",
            )}
          >
            {o.emoji && <span aria-hidden>{o.emoji}</span>}
            {o.label}
            {on && multi && <Check size={14} strokeWidth={3} className="text-brand-400" />}
          </motion.button>
        );
      })}
    </div>
  );
}

function Title({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="mb-5">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-300/15 text-brand-500 dark:text-brand-200">{icon}</div>
      <h2 className="text-[22px] font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-[13.5px] text-muted">{sub}</p>
    </div>
  );
}

function Personalise({
  prompt,
  setPrompt,
  seeds,
  chosen,
  setChosen,
}: {
  prompt: string;
  setPrompt: (s: string) => void;
  seeds: string[];
  chosen: Set<string>;
  setChosen: (s: Set<string>) => void;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 700);
    return () => clearTimeout(t);
  }, []);
  if (!ready)
    return (
      <div className="flex min-h-[340px] flex-col items-center justify-center gap-4" data-testid="personalising">
        <div className="relative h-[30px] w-[220px] overflow-hidden" aria-hidden>
          <Ribbon width={220} height={30} notchWidth={0} wing={110} mode="think" leftWing />
        </div>
        <p className="text-[14px] text-muted">Personalising Flo for you…</p>
      </div>
    );
  return (
    <>
      <Title icon={<Wand2 size={20} />} title="Made for you" sub="This is how Flo will write for you. Edit anything, it's yours." />
      <label className="mb-1.5 block text-[12px] font-medium text-muted" htmlFor="ob-prompt">
        Your instructions
      </label>
      <textarea
        id="ob-prompt"
        aria-label="System prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={9}
        className="selectable w-full resize-none rounded-2xl border border-[var(--border)] bg-[var(--glass)] px-4 py-3 text-[13px] leading-relaxed outline-none focus:border-brand-400/60"
      />
      {seeds.length > 0 && (
        <>
          <div className="mb-2 mt-4 text-[12px] font-medium text-muted">Words Flo should always spell right</div>
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
                  }}
                  className={clsx("rounded-full border px-2.5 py-1 text-[12px] transition", on ? "border-brand-400/60 bg-brand-400/15" : "border-[var(--border)] text-faint line-through")}
                >
                  {w}
                </button>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function Permissions() {
  const perms = usePermissions(2000);
  return (
    <>
      <Title icon={<ShieldCheck size={20} />} title="A few permissions" sub="Checked live. Grant each one in System Settings, then come back." />
      <div className="flex flex-col gap-2">
        {PERMISSION_ITEMS.map((it) => {
          const ok = !!perms?.[it.key];
          return (
            <div key={it.key} className="flex items-center gap-3 rounded-2xl bg-[var(--glass)] px-4 py-3" data-testid="perm-row">
              <span className={clsx("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", ok ? "bg-emerald-400/15 text-emerald-500 dark:text-emerald-300" : "bg-[var(--glass-strong)] text-faint")}>
                {ok ? <Check size={14} strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium">
                  {it.label} {!it.required && <span className="text-[11.5px] font-normal text-faint">optional</span>}
                </div>
                <div className="text-[12px] text-muted">{it.why}</div>
              </div>
              {ok ? (
                <span className="text-[12px] font-medium text-emerald-600 dark:text-emerald-300">Granted</span>
              ) : (
                <Button size="sm" onClick={() => api.openPermissionSettings(it.kind)}>
                  Grant
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Voice({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
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
    <>
      <Title icon={<Mic size={20} />} title="Your voice engine" sub="On this Mac is private and free. Cloud is lighter on older machines." />
      <div className="grid grid-cols-2 gap-3">
        <button
          className={clsx("rounded-2xl p-4 text-left transition", local ? "glass-strong ring-1 ring-brand-400/50" : "bg-[var(--glass)] hover:bg-[var(--glass-strong)]")}
          onClick={() => set({ sttProvider: "local", sttModel: rec?.id ?? RECOMMENDED })}
        >
          <Cpu size={18} className="text-brand-500 dark:text-brand-300" />
          <div className="mt-2 text-[14px] font-semibold">On this Mac</div>
          <div className="text-[12px] text-muted">Recommended. Audio never leaves.</div>
        </button>
        <button
          className={clsx("rounded-2xl p-4 text-left transition", !local ? "glass-strong ring-1 ring-brand-400/50" : "bg-[var(--glass)] hover:bg-[var(--glass-strong)]")}
          onClick={() => set({ sttProvider: "groq", sttModel: "whisper-large-v3-turbo" })}
        >
          <Cloud size={18} className="text-brand-500 dark:text-brand-300" />
          <div className="mt-2 text-[14px] font-semibold">Cloud</div>
          <div className="text-[12px] text-muted">Groq or OpenAI, your own key.</div>
        </button>
      </div>
      <div className="mt-4 rounded-2xl bg-[var(--glass)] p-4">
        {local ? (
          !rec ? (
            <div className="h-10 animate-pulse rounded-xl bg-[var(--glass-strong)]" />
          ) : (
            <div className="flex items-center gap-3" data-testid="voice-model">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium">{rec.label}</div>
                <div className="text-[12px] text-faint">
                  {rec.languages} · {rec.sizeMb} MB
                </div>
                {pct !== null && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--glass-strong)]" role="progressbar" aria-valuenow={pct}>
                    <motion.div className="accent-gradient h-full" animate={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
              {rec.installed ? (
                <span className="flex items-center gap-1 text-[12.5px] font-medium text-emerald-600 dark:text-emerald-300">
                  <Check size={13} strokeWidth={3} /> Ready
                </span>
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
              <Select
                value={s.sttProvider}
                onChange={(v) => set({ sttProvider: v, sttModel: v === "groq" ? "whisper-large-v3-turbo" : "gpt-4o-mini-transcribe" })}
                options={[
                  { value: "groq", label: "Groq Whisper" },
                  { value: "openai", label: "OpenAI" },
                ]}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13.5px] font-medium">API key</span>
              <ProviderKey info={cloud} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Ai({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  return (
    <>
      <Title icon={<Sparkles size={20} />} title="The brain" sub="Polishes dictation and powers the assistant. Local works offline; cloud is faster." />
      <div className="flex flex-col divide-y divide-[var(--border)] rounded-2xl bg-[var(--glass)] px-4 py-1">
        <AiProviderFields
          s={s}
          set={set}
          row={(label, hint, node) => (
            <div key={label} className="flex items-center justify-between gap-4 py-2.5">
              <div>
                <div className="text-[13.5px] font-medium">{label}</div>
                {hint && <div className="mt-0.5 text-[12px] text-muted">{hint}</div>}
              </div>
              <div className="shrink-0">{node}</div>
            </div>
          )}
        />
      </div>
    </>
  );
}

// ── live demos ───────────────────────────────────────────────────────────────

/** A tiny one-shot burst of light-blue dots (no loop). */
function Burst() {
  return (
    <span className="pointer-events-none absolute left-1/2 top-1/2" aria-hidden>
      {Array.from({ length: 12 }, (_, k) => {
        const ang = (k / 12) * Math.PI * 2;
        return (
          <motion.span
            key={k}
            className="absolute h-1.5 w-1.5 rounded-full"
            style={{ background: k % 3 ? "#66ceff" : "#e3f6ff" }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: Math.cos(ang) * 70, y: Math.sin(ang) * 46, opacity: 0, scale: 0.4 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
        );
      })}
    </span>
  );
}

function DemoShell({
  icon,
  title,
  sub,
  done,
  onSimulate,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  sub: React.ReactNode;
  done: boolean;
  onSimulate?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div data-testid="demo" data-done={done ? "true" : "false"}>
      <Title icon={icon} title={title} sub="" />
      <div className="-mt-4 mb-5 text-[14px]">{sub}</div>
      <div className="relative">
        {children}
        {done && <Burst />}
      </div>
      <div className="mt-4 flex h-6 items-center justify-between text-[13px]">
        {done ? (
          <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-300" data-testid="demo-success">
            <Check size={15} strokeWidth={3} /> Nailed it
          </motion.span>
        ) : (
          <span className="text-faint">Waiting for you…</span>
        )}
        {!isTauri && onSimulate && !done && (
          <button className="text-[12px] text-brand-500 hover:underline dark:text-brand-300" onClick={onSimulate}>
            Simulate (preview)
          </button>
        )}
      </div>
    </div>
  );
}

/** Live phase from backend events → ribbon mode for the demo strip. */
function useLivePhase() {
  const [mode, setMode] = useState<RibbonMode | null>(null);
  const [message, setMessage] = useState<string | undefined>();
  useEffect(
    () =>
      on<StateEvent>(EV.state, (e) => {
        setMessage(e.message);
        setMode(e.phase === "listening" ? "listen" : e.phase === "transcribing" ? "transcribe" : e.phase === "thinking" ? "think" : e.phase === "done" ? "done" : null);
      }),
    [],
  );
  return { mode, message };
}

function Strip({ mode }: { mode: RibbonMode | null }) {
  const W = 300;
  return (
    <div className="relative mx-auto h-[38px] overflow-hidden rounded-b-[16px] bg-black shadow-[inset_0_-1px_0_rgba(147,221,255,0.18)]" style={{ width: W }} data-testid="try-ribbon">
      {mode ? <Ribbon width={W} height={38} notchWidth={0} wing={W / 2} mode={mode} leftWing /> : <div className="flex h-full items-center justify-center text-[11.5px] text-white/35">the notch</div>}
    </div>
  );
}

const PHRASE = "Hello Flo, this is my first dictation";

function DemoDictate({ keyLabel, onDone }: { keyLabel: string; onDone: () => void }) {
  const { mode } = useLivePhase();
  const [text, setText] = useState("");
  const done = !!text;
  useEffect(() => on<TranscriptEvent>(EV.transcript, (t) => t.final && t.text.trim() && setText(t.text.trim())), []);
  useAutoNext(done, onDone);
  return (
    <DemoShell
      icon={<Mic size={20} />}
      title="Your first dictation"
      done={done}
      sub={
        <>
          Click the box, hold <Key>{keyLabel}</Key> and say: <span className="font-semibold text-brand-500 dark:text-brand-200">"{PHRASE}"</span>
        </>
      }
      onSimulate={() =>
        simulate([
          [0, EV.state, { phase: "listening", mode: "dictation" }],
          [900, EV.state, { phase: "transcribing", mode: "dictation" }],
          [1500, EV.transcript, { text: PHRASE + ".", final: true }],
          [1550, EV.state, { phase: "done", mode: "dictation" }],
        ])
      }
    >
      <Strip mode={mode} />
      <textarea
        aria-label="Demo text box"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Your words land here…"
        rows={3}
        className="selectable mt-4 w-full resize-none rounded-2xl border border-[var(--border)] bg-[var(--glass)] px-4 py-3 text-[14px] outline-none focus:border-brand-400/60"
      />
    </DemoShell>
  );
}

function DemoHandsFree({ keyLabel, onDone }: { keyLabel: string; onDone: () => void }) {
  const { mode, message } = useLivePhase();
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (mode === "listen" && message === "hands-free") setSeen(true);
  }, [mode, message]);
  useAutoNext(seen, onDone);
  return (
    <DemoShell
      icon={<Radio size={20} />}
      title="Hands-free"
      done={seen}
      sub={
        <>
          Press <Key>{keyLabel}</Key> + <Key>Space</Key> together, then let go. Flo keeps listening until you press <Key>{keyLabel}</Key> again.
        </>
      }
      onSimulate={() => simulate([[0, EV.state, { phase: "listening", mode: "dictation", message: "hands-free" }]])}
    >
      <Strip mode={mode} />
      <p className="mt-3 text-center text-[12px] text-faint">Great for long messages and walking around.</p>
    </DemoShell>
  );
}

function DemoAsk({ keyLabel, onDone }: { keyLabel: string; onDone: () => void }) {
  const { mode } = useLivePhase();
  const [reply, setReply] = useState<string | null>(null);
  useEffect(() => on<AssistantResponse>(EV.assistant, (r) => r?.reply && setReply(toPlainText(r.reply))), []);
  useAutoNext(!!reply, onDone, 2400);
  return (
    <DemoShell
      icon={<Sparkles size={20} />}
      title="Ask about your screen"
      done={!!reply}
      sub={
        <>
          Hold <Key>{keyLabel}</Key> and ask: <span className="font-semibold text-brand-500 dark:text-brand-200">"What's on my screen?"</span>
        </>
      }
      onSimulate={() => {
        simulate([[0, EV.state, { phase: "thinking", mode: "assistant" }]]);
        api.askAssistant("What's on my screen?").catch(() => {});
      }}
    >
      <Strip mode={mode} />
      {reply && (
        <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 line-clamp-3 rounded-2xl bg-[var(--glass)] px-4 py-3 text-[13px]" data-testid="demo-reply">
          {reply}
        </motion.p>
      )}
    </DemoShell>
  );
}

function DemoTray({ onDone }: { onDone: () => void }) {
  const [added, setAdded] = useState(false);
  useAutoNext(added, onDone, 2600);
  return (
    <DemoShell icon={<PartyPopper size={20} />} title="Your agent tray" done={added} sub="When Claude Code, Codex or Cursor finishes or needs you, it shows up next to the notch. Hover it to see every session.">
      <div className="mx-auto flex h-[38px] w-[300px] items-center justify-between rounded-b-[16px] bg-black px-3" data-testid="tray-preview">
        <AnimatePresence>
          {added && (
            <motion.span initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 520, damping: 22 }}>
              <ClaudeAvatar status="done" source="claude" />
            </motion.span>
          )}
        </AnimatePresence>
        <span />
      </div>
      {added ? (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="island-tip mx-auto mt-2 flex w-[300px] items-center gap-2 rounded-2xl px-3 py-2.5 text-white">
          <ClaudeAvatar status="done" source="claude" />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold">my-app · Done</div>
            <div className="truncate text-[11.5px] text-white/60">Built the login page, all tests pass.</div>
          </div>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px]">Open</span>
        </motion.div>
      ) : (
        <div className="mt-4 text-center">
          <Button variant="primary" onClick={() => setAdded(true)}>
            Show me
          </Button>
        </div>
      )}
    </DemoShell>
  );
}

function DemoMeetings({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  return (
    <DemoShell icon={<Radio size={20} />} title="Meetings, handled" done={false} sub="When Zoom, Meet, Teams, Slack or FaceTime starts using your mic, Flo offers to take notes. Transcribed and summarised on this Mac.">
      <div className="mx-auto w-[340px] overflow-hidden rounded-b-[20px] bg-black px-4 pb-3 pt-[44px] text-white" aria-hidden>
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inset-0 rounded-full bg-red-500 opacity-60 [animation:ping_1s_cubic-bezier(0,0,0.2,1)_3]" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-red-500" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">Zoom call detected</div>
            <div className="text-[11.5px] text-white/60">Take notes on this Mac?</div>
          </div>
          <span className="rounded-full bg-brand-300/30 px-2.5 py-1 text-[11px] font-semibold">Start notes</span>
        </div>
      </div>
      <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 text-[13px]">
        <input type="checkbox" checked={s.meetingDetection} onChange={(e) => set({ meetingDetection: e.target.checked })} className="accent-[#3dbbff]" />
        Offer to take notes when a call starts
      </label>
    </DemoShell>
  );
}

function useAutoNext(done: boolean, next: () => void, ms = 1600) {
  const ref = useRef(next);
  ref.current = next;
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => ref.current(), ms);
    return () => clearTimeout(t);
  }, [done, ms]);
}

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="keycap keycap-active mx-0.5">{children}</kbd>;
}

function TypingOffer({ s, onMeasure }: { s: Settings; onMeasure: () => void }) {
  return (
    <div className="flex flex-col items-center py-4 text-center" data-testid="typing-offer">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-300/15 text-brand-500 dark:text-brand-200">
        <Gauge size={22} />
      </div>
      <h2 className="text-[22px] font-semibold tracking-tight">Measure your typing speed?</h2>
      <p className="mt-1.5 max-w-[420px] text-[13.5px] text-muted">
        Takes about a minute. Flo uses it to show how much time speaking saves you. Your current estimate is {s.typingWpm} wpm. You can always do this later.
      </p>
      <Button variant="primary" className="mt-5" icon={<Gauge size={14} />} onClick={onMeasure}>
        Measure now
      </Button>
    </div>
  );
}

function Done({ keys }: { keys: { dict: string; asst: string } }) {
  const rows = useMemo(
    () => [
      [<Key key="a">{keys.dict}</Key>, "Hold to dictate anywhere"],
      [
        <span key="b">
          <Key>{keys.dict}</Key>+<Key>Space</Key>
        </span>,
        "Hands-free dictation",
      ],
      [<Key key="c">{keys.asst}</Key>, "Hold to ask Flo (it can see your screen)"],
      [<Key key="d">Esc</Key>, "Cancel"],
      [<span key="e" className="text-[12px] text-muted">hover the notch</span>, "Quick actions and your agents"],
    ],
    [keys],
  );
  return (
    <div className="flex flex-col items-center py-2 text-center">
      <motion.div initial={{ scale: 0.6, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 380, damping: 16 }}>
        <div className="accent-gradient flex h-16 w-16 items-center justify-center rounded-3xl shadow-[0_0_40px_-6px_rgba(61,187,255,0.7)]">
          <Check size={30} strokeWidth={3} className="text-white" />
        </div>
      </motion.div>
      <h2 className="mt-5 text-[26px] font-semibold tracking-tight">You're set</h2>
      <p className="mt-1 text-[13.5px] text-muted">Flo lives in your notch. Here's everything you need:</p>
      <div className="mt-6 w-full max-w-[440px] divide-y divide-[var(--border)] rounded-2xl bg-[var(--glass)] px-4 text-left" data-testid="cheatsheet">
        {rows.map(([k, label], n) => (
          <div key={n} className="flex items-center justify-between gap-4 py-2.5 text-[13px]">
            <span className="shrink-0">{k}</span>
            <span className="text-muted">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
