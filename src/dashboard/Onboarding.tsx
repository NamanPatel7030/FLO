// First-run setup wizard (settings.onboarded === false). Full-window glass steps, skippable,
// reopened from Settings → General → "Run setup again".
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, Check, Cloud, Cpu, Download, Keyboard, Mic, PartyPopper, ShieldCheck, Sparkles } from "lucide-react";
import { api, on } from "../lib/api";
import { EV, type LocalModel, type ModelProgressEvent, type Settings, type StateEvent, type TranscriptEvent } from "../lib/types";
import { formatHotkey } from "../lib/format";
import { useStore } from "./store";
import { Button, Select } from "./ui";
import { Logo } from "./Logo";
import { PERMISSION_ITEMS, usePermissions } from "./usePermissions";
import { AiProviderFields, providerInfo, ProviderKey } from "./AiSetup";
import { Ribbon, type RibbonMode } from "../island/Ribbon";

const STEPS = ["Welcome", "Permissions", "Voice", "AI", "Shortcuts", "Done"] as const;
const RECOMMENDED = "large-v3-turbo-q5_0";

export function Onboarding() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [step, setStep] = useState(0);
  if (!settings) return null;
  const s = settings;
  const set = (p: Partial<Settings>) => setSettings({ ...s, ...p });
  const finish = () => set({ onboarded: true });
  const next = () => (step === STEPS.length - 1 ? finish() : setStep(step + 1));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal aria-label="Set up Flo" data-testid="onboarding">
      <div className="absolute inset-0" style={{ background: "var(--scrim)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }} />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(800px 420px at 50% 0%, rgba(61,187,255,0.18), transparent 70%)" }}
        aria-hidden
      />
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
        className="relative flex max-h-full w-full max-w-[640px] flex-col overflow-hidden rounded-3xl border border-brand-200/15 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
        style={{ background: "var(--sheet-bg)" }}
      >
        {/* header: progress + skip */}
        <div className="flex items-center gap-3 px-7 pt-6">
          <div className="flex flex-1 gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((name, i) => (
              <span
                key={name}
                title={name}
                className={clsx("h-1 flex-1 rounded-full transition-colors duration-300", i <= step ? "accent-gradient" : "bg-[var(--glass-strong)]")}
              />
            ))}
          </div>
          {step < STEPS.length - 1 && (
            <button className="text-[12.5px] text-muted hover:text-[var(--fg)]" onClick={finish}>
              Skip setup
            </button>
          )}
        </div>

        <div className="min-h-[340px] flex-1 overflow-y-auto px-7 py-6">
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}>
              {step === 0 && <Welcome />}
              {step === 1 && <Permissions />}
              {step === 2 && <Voice s={s} set={set} />}
              {step === 3 && <Ai s={s} set={set} />}
              {step === 4 && <Shortcuts s={s} />}
              {step === 5 && <Done s={s} />}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border)] px-7 py-4">
          {step > 0 ? (
            <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => setStep(step - 1)}>
              Back
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {(step === 3 || step === 4) && (
              <Button variant="ghost" onClick={next}>
                Skip
              </Button>
            )}
            <Button variant="primary" onClick={next} icon={step === STEPS.length - 1 ? <Check size={14} /> : <ArrowRight size={14} />}>
              {step === 0 ? "Get started" : step === STEPS.length - 1 ? "Start using Flo" : "Continue"}
            </Button>
          </div>
        </div>
      </motion.div>
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

function Welcome() {
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <Logo size={64} />
      <h1 className="mt-5 text-[30px] font-semibold tracking-tight">Flo</h1>
      <p className="text-[15px] text-muted">Your Assistant</p>
      <p className="mt-6 max-w-[420px] text-[13.5px] leading-relaxed text-muted">
        Speak anywhere and it types for you. Ask it anything, take meeting notes, and keep an eye on your Claude sessions, all from the notch. Two minutes to set up.
      </p>
    </div>
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
              <span
                className={clsx(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                  ok ? "bg-emerald-400/15 text-emerald-500 dark:text-emerald-300" : "bg-[var(--glass-strong)] text-faint",
                )}
              >
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

/** "Hold ⌃ and say hello": live test using the real backend events and the notch ribbon. */
function Shortcuts({ s }: { s: Settings }) {
  const geo = useStore((x) => x.geo);
  const key = geo?.platform === "windows" ? "Right Ctrl" : formatHotkey(s.hotkeyDictation);
  const [mode, setMode] = useState<RibbonMode | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  useEffect(() => {
    const offs = [
      on<StateEvent>(EV.state, (e) => {
        if (e.mode === "meeting") return;
        if (e.phase === "listening") {
          setHeard(null);
          setMode("listen");
        } else if (e.phase === "transcribing") setMode("transcribe");
        else if (e.phase === "thinking") setMode("think");
        else if (e.phase === "done") setMode("done");
        else if (e.phase === "idle") setMode((m) => (m === "done" ? m : null));
      }),
      on<TranscriptEvent>(EV.transcript, (t) => t.final && t.text.trim() && setHeard(t.text.trim())),
    ];
    return () => offs.forEach((f) => f());
  }, []);
  const W = 300;
  return (
    <>
      <Title icon={<Keyboard size={20} />} title="Try it" sub="Hold the key, say something, let go. Flo types it wherever your cursor is." />
      <div className="flex flex-col items-center gap-5 py-2">
        <div className="text-[15px]">
          Hold <kbd className="keycap keycap-active mx-1">{key}</kbd> and say <span className="font-semibold text-brand-500 dark:text-brand-200">"hello"</span>
        </div>
        <div className="relative h-[38px] overflow-hidden rounded-b-[16px] bg-black shadow-[inset_0_-1px_0_rgba(147,221,255,0.18)]" style={{ width: W }} data-testid="try-ribbon">
          {mode ? (
            <Ribbon width={W} height={38} notchWidth={0} wing={W / 2} mode={mode} leftWing />
          ) : (
            <div className="flex h-full items-center justify-center text-[11.5px] text-white/35">waiting for your voice</div>
          )}
        </div>
        <div className="h-6 text-[13.5px]" aria-live="polite">
          {heard ? (
            <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-300" data-testid="try-heard">
              <Check size={14} strokeWidth={3} /> Heard: "{heard}"
            </span>
          ) : null}
        </div>
        <p className="text-[12px] text-faint">Assistant: hold {geo?.platform === "windows" ? "Right Alt" : formatHotkey(s.hotkeyAssistant)}. Change keys any time in Settings.</p>
      </div>
    </>
  );
}

function Done({ s }: { s: Settings }) {
  const info = providerInfo(s.llmProvider);
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <motion.div initial={{ scale: 0.6, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 380, damping: 16 }}>
        <div className="accent-gradient flex h-16 w-16 items-center justify-center rounded-3xl shadow-[0_0_40px_-6px_rgba(61,187,255,0.7)]">
          <PartyPopper size={28} className="text-white" />
        </div>
      </motion.div>
      <h2 className="mt-5 text-[24px] font-semibold tracking-tight">You're all set</h2>
      <p className="mt-1 text-[13.5px] text-muted">Flo lives in your notch. Hover it any time for quick actions.</p>
      <div className="mt-6 grid w-full max-w-[420px] grid-cols-2 gap-2 text-left text-[12.5px]">
        <div className="rounded-xl bg-[var(--glass)] px-3 py-2">
          <div className="text-faint">Voice</div>
          <div className="font-medium">{s.sttProvider === "local" ? "On this Mac" : s.sttProvider === "groq" ? "Groq" : "OpenAI"}</div>
        </div>
        <div className="rounded-xl bg-[var(--glass)] px-3 py-2">
          <div className="text-faint">AI</div>
          <div className="truncate font-medium">{s.llmProvider === "none" ? "Off" : `${info?.label ?? s.llmProvider} · ${s.llmModel}`}</div>
        </div>
      </div>
    </div>
  );
}
