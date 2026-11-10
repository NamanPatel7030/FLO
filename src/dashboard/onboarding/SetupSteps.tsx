// Setup steps, part two: permissions, voice and AI, and the ready screen.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { Check, Cloud, Cpu, Download, Mic, MousePointerClick, ShieldCheck } from "lucide-react";
import { api, on } from "../../lib/api";
import { EV, type LocalModel, type ModelProgressEvent, type Settings } from "../../lib/types";
import type { NotchlingMood } from "../../lib/notchling";
import { usePermissions } from "../usePermissions";
import { SETUP_PERMS, accessibilityState, nextSetupPerm, setupDone } from "./perms";
import { AiProviderFields, providerInfo, ProviderKey } from "../AiSetup";
import { Select } from "../ui";
import { Btn, Heading, Key, Rise, Stagger, rise } from "./parts";

const RECOMMENDED = "large-v3-turbo-q5_0";

// ── permissions ─────────────────────────────────────────────────────────────

/** Only what dictation needs: the microphone and Accessibility (which also runs the Flo key).
 *  Screen Recording, Automation and Calendar are asked later, when a feature first needs them. */
export { SETUP_PERMS };

const PERM_COPY: Record<string, { title: string; why: string; icon: React.ReactNode }> = {
  microphone: { title: "Microphone", why: "So I can hear you while you hold your Flo key.", icon: <Mic size={24} /> },
  accessibility: { title: "Accessibility", why: "So your Flo key works and I can type where your cursor is.", icon: <MousePointerClick size={24} /> },
};

/** One step, two switches, live check marks. Polls every second; once both are on it moves on by
 *  itself (no "I did it" button, no relaunch). */
export function Permissions({ title, sub, setMood, onStatus, onDone }: { title: string; sub: string; setMood: (m: NotchlingMood | null) => void; onStatus: (allOk: boolean) => void; onDone?: () => void }) {
  const perms = usePermissions(1000);
  const [askedAx, setAskedAx] = useState<number | null>(null);
  const [resetting, setResetting] = useState(false);
  const allOk = setupDone(perms);
  const ax = accessibilityState(perms, askedAx, Date.now());
  const offerReset = ax === "stale" || ax === "stuck";
  const next = nextSetupPerm(perms);
  const done = SETUP_PERMS.filter((it) => perms?.[it.key]).length;
  const line = !perms
    ? "Checking what I'm allowed to do..."
    : allOk
      ? "All set, thank you. I can hear you and type for you now."
      : ax === "waiting"
        ? "Turn on Flo in System Settings. I'll notice the moment you do."
        : offerReset
          ? "Still off for me. If the switch already looks on, reset it below."
          : `${done} of ${SETUP_PERMS.length} done.`;
  const mood: NotchlingMood = !perms ? "think" : allOk ? "happy" : offerReset ? "worried" : "listen";
  useEffect(() => setMood(mood), [mood, setMood]);
  useEffect(() => onStatus(allOk), [allOk, onStatus]);
  // move on by itself once both land while this step is up (not when they were already on)
  const [wasMissing, setWasMissing] = useState(false);
  useEffect(() => {
    if (perms && !allOk) setWasMissing(true);
  }, [perms, allOk]);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (!allOk || !wasMissing) return;
    const t = setTimeout(() => doneRef.current?.(), 1100);
    return () => clearTimeout(t);
  }, [allOk, wasMissing]);

  const allow = (key: string) => {
    if (key === "accessibility") setAskedAx(Date.now());
    api.openPermissionSettings(key === "accessibility" ? "accessibility" : "microphone");
  };
  const reset = async () => {
    setResetting(true);
    setAskedAx(Date.now());
    await api.resetAccessibility().catch(() => {});
    setResetting(false);
  };

  return (
    <div className="flex w-full flex-col items-center">
      <Heading title={title} sub={sub} />
      <div className="onb-glass mt-9 flex w-full max-w-[640px] flex-col divide-y divide-[rgb(20_40_80/0.07)] px-6 py-2" data-testid="perm-card">
        {SETUP_PERMS.map((it) => {
          const ok = !!perms?.[it.key];
          const c = PERM_COPY[it.key];
          return (
            <div key={it.key} className="flex items-center gap-5 py-4" data-testid="perm-row" data-perm={it.key} data-granted={ok ? "true" : "false"}>
              <motion.span
                animate={ok ? { background: "linear-gradient(135deg, #3fd0a4, #2fb8c9)", color: "#ffffff" } : { background: "linear-gradient(135deg, #d9efff, #e8e1ff)", color: "#3e4a8a" }}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px]"
              >
                {ok ? <Check size={24} strokeWidth={3} /> : c?.icon ?? <ShieldCheck size={24} />}
              </motion.span>
              <div className="min-w-0 flex-1 text-left">
                <div className="text-[17px] font-semibold">{c?.title ?? it.label}</div>
                <div className="onb-muted mt-0.5 text-[14px] leading-snug">{c?.why ?? it.why}</div>
              </div>
              <div className="shrink-0">
                {ok ? (
                  <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="flex h-11 items-center gap-1.5 text-[15px] font-semibold text-[#1f9e78]">
                    <Check size={17} strokeWidth={3} /> Allowed
                  </motion.span>
                ) : (
                  <Btn kind={next === it.key ? "primary" : "soft"} aria-label={`Allow ${c?.title ?? it.label}`} className="!h-11 !px-7 !text-[15px]" onClick={() => allow(it.key)}>
                    Allow
                  </Btn>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <AnimatePresence>
        {offerReset && !allOk && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="w-full max-w-[640px] overflow-hidden"
            data-testid="ax-reset"
          >
            <div className="mt-4 flex items-center gap-4 rounded-[18px] border border-[#f3d9b8] bg-[#fff8ef] px-5 py-3 text-left">
              <span className="flex-1 text-[14.5px] text-[#7a4a12]">
                {ax === "stale" ? "An update reset Flo's switch. It may still look on in System Settings." : "Switch already on? It may belong to an older copy of Flo."}
              </span>
              <Btn kind="soft" className="!h-10 !px-5 !text-[14px]" disabled={resetting} onClick={reset}>
                Reset and ask again
              </Btn>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        <motion.p
          key={line}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className={clsx("mt-6 text-[16px] font-medium", allOk ? "text-[#1f9e78]" : offerReset ? "text-[#c46a12]" : "text-[#5b6678]")}
          data-testid="onboard-line"
        >
          {line}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

// ── voice engine + AI brain ─────────────────────────────────────────────────

export function SetupStep({ title, sub, s, set }: { title: string; sub: string; s: Settings; set: (p: Partial<Settings>) => void }) {
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
  const engine = (on: boolean, icon: React.ReactNode, label: string, hint: string, onClick: () => void) => (
    <motion.button
      type="button"
      variants={rise}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      role="radio"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className="onb-choice flex h-[96px] items-center gap-5 rounded-[22px] px-6 text-left"
    >
      <span className="onb-icon h-16 w-16 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[18px] font-semibold">{label}</span>
        <span className="onb-muted mt-0.5 block text-[14px]">{hint}</span>
      </span>
    </motion.button>
  );
  const row = (label: string, hint: string | undefined, node: React.ReactNode) => (
    <div key={label} className="flex items-center justify-between gap-4 py-3.5">
      <div>
        <div className="text-[16px] font-semibold">{label}</div>
        {hint && <div className="onb-muted mt-0.5 text-[13.5px]">{hint}</div>}
      </div>
      <div className="shrink-0">{node}</div>
    </div>
  );
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col items-center">
      <Heading title={title} sub={sub} />
      <Stagger className="mt-6 w-full">
        <Rise className="onb-label mb-3">I listen</Rise>
        <div className="grid grid-cols-2 gap-4" role="radiogroup" aria-label="Voice engine">
          {engine(local, <Cpu size={28} />, "On this Mac", "Recommended. Audio never leaves.", () => set({ sttProvider: "local", sttModel: rec?.id ?? RECOMMENDED }))}
          {engine(!local, <Cloud size={28} />, "In the cloud", "Groq or OpenAI, with your key.", () => set({ sttProvider: "groq", sttModel: "whisper-large-v3-turbo" }))}
        </div>
        <Rise className="onb-glass mt-3 px-6 py-1">
          {local ? (
            !rec ? (
              <div className="my-3 h-12 animate-pulse rounded-xl bg-[#eef1f8]" />
            ) : (
              <div className="flex items-center gap-4 py-3.5" data-testid="voice-model">
                <div className="min-w-0 flex-1">
                  <div className="text-[16px] font-semibold">{rec.label}</div>
                  <div className="onb-faint mt-0.5 text-[13.5px]">
                    {rec.languages} · {rec.sizeMb} MB
                  </div>
                  {pct !== null && (
                    <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-[#e6eaf3]" role="progressbar" aria-valuenow={pct}>
                      <motion.div className="h-full bg-gradient-to-r from-[#2f8cff] to-[#7a6cff]" animate={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
                {rec.installed ? (
                  <span className="flex items-center gap-1.5 text-[15px] font-semibold text-[#1f9e78]">
                    <Check size={16} strokeWidth={3} /> Ready
                  </span>
                ) : (
                  <Btn className="!h-11 !px-5 !text-[14.5px]" disabled={pct !== null} icon={<Download size={15} />} onClick={() => api.downloadModel(rec.id)}>
                    {pct !== null ? `${pct}%` : "Download"}
                  </Btn>
                )}
              </div>
            )
          ) : (
            <div className="flex flex-col divide-y divide-[rgb(20_40_80/0.07)]">
              {row(
                "Provider",
                undefined,
                <Select
                  value={s.sttProvider}
                  onChange={(v) => set({ sttProvider: v, sttModel: v === "groq" ? "whisper-large-v3-turbo" : "gpt-4o-mini-transcribe" })}
                  options={[
                    { value: "groq", label: "Groq Whisper" },
                    { value: "openai", label: "OpenAI" },
                  ]}
                />,
              )}
              {row("API key", undefined, <ProviderKey info={cloud} />)}
            </div>
          )}
        </Rise>

        <Rise className="onb-label mb-3 mt-6">I think with</Rise>
        <Rise className="onb-glass flex flex-col divide-y divide-[rgb(20_40_80/0.07)] px-6 py-1">
          <AiProviderFields s={s} set={set} row={row} />
        </Rise>
      </Stagger>
    </div>
  );
}

// ── ready ───────────────────────────────────────────────────────────────────

export function Done({ title, sub, keys }: { title: string; sub: string; keys: { dict: string; asst: string } }) {
  const cards: { k: React.ReactNode; label: string; hint: string }[] = [
    { k: <Key big>{keys.dict}</Key>, label: "Hold to dictate", hint: "Talk, let go, and the words appear in any app." },
    {
      k: (
        <span className="flex items-center gap-1.5">
          <Key big>{keys.dict}</Key>
          <span className="text-[20px] font-semibold text-[#8a94a6]">+</span>
          <Key big>Space</Key>
        </span>
      ),
      label: "Hands-free",
      hint: `For long messages. Tap ${keys.dict} again to stop.`,
    },
    { k: <Key big>{keys.asst}</Key>, label: "Hold to ask", hint: "Ask about your screen or tell me to do something." },
  ];
  return (
    <div className="flex w-full flex-col items-center text-center">
      <Heading title={title} sub={sub} />
      <div className="mt-9 w-full max-w-[900px]" data-testid="cheatsheet">
      <Stagger className="grid w-full grid-cols-3 gap-5">
        {cards.map((c) => (
          <motion.div key={c.label} variants={rise} className="onb-glass flex h-[230px] flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="flex h-16 items-center">{c.k}</div>
            <div className="text-[19px] font-semibold">{c.label}</div>
            <div className="onb-muted -mt-2 text-[14.5px] leading-snug">{c.hint}</div>
          </motion.div>
        ))}
        <Rise className="onb-faint col-span-3 mt-1 text-[14.5px]">
          <Key>Esc</Key> cancels. Hover the notch for quick actions.
        </Rise>
      </Stagger>
      </div>
    </div>
  );
}
