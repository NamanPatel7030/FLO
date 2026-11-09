// Setup steps, part two: permissions, voice and AI, and the ready screen.
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { Check, Cloud, Cpu, Download, Keyboard, Mic, MousePointerClick, ShieldCheck } from "lucide-react";
import { api, on } from "../../lib/api";
import { EV, type LocalModel, type ModelProgressEvent, type Settings } from "../../lib/types";
import type { NotchlingMood } from "../../lib/notchling";
import { PERMISSION_ITEMS, usePermissions } from "../usePermissions";
import { AiProviderFields, providerInfo, ProviderKey } from "../AiSetup";
import { Select } from "../ui";
import { Btn, Heading, Key, Rise, Stagger, rise } from "./parts";

const RECOMMENDED = "large-v3-turbo-q5_0";

// ── permissions ─────────────────────────────────────────────────────────────

/** Only what dictation needs. Screen Recording stays optional and lives in Settings. */
export const SETUP_PERMS = PERMISSION_ITEMS.filter((it) => it.required);

const PERM_COPY: Record<string, { title: string; why: string; icon: React.ReactNode }> = {
  microphone: { title: "Microphone", why: "So I can hear you while you hold your Flo key.", icon: <Mic size={30} /> },
  accessibility: { title: "Accessibility", why: "So I can type the words where your cursor is.", icon: <MousePointerClick size={30} /> },
  inputMonitoring: { title: "Input Monitoring", why: "So I notice when you hold your Flo key.", icon: <Keyboard size={30} /> },
};

export function Permissions({ title, sub, setMood, onStatus }: { title: string; sub: string; setMood: (m: NotchlingMood | null) => void; onStatus: (allOk: boolean) => void }) {
  const perms = usePermissions(1500);
  const [asked, setAsked] = useState<string | null>(null);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    setWaited(false);
    if (!asked) return;
    const t = setTimeout(() => setWaited(true), 7000);
    return () => clearTimeout(t);
  }, [asked]);
  const allOk = !!perms && SETUP_PERMS.every((it) => perms[it.key]);
  const stuck = waited && !!asked && !perms?.[asked as keyof typeof perms];
  const done = SETUP_PERMS.filter((it) => perms?.[it.key]).length;
  const line = !perms
    ? "Checking what I'm allowed to do..."
    : allOk
      ? "All set, thank you. I can hear you and type for you now."
      : stuck
        ? "I still can't see it. Turn Flo on in System Settings, then come back here."
        : `${done} of ${SETUP_PERMS.length} done. Click Allow, then turn Flo on.`;
  const mood: NotchlingMood = !perms ? "think" : allOk ? "happy" : stuck ? "worried" : "listen";
  useEffect(() => setMood(mood), [mood, setMood]);
  useEffect(() => onStatus(allOk), [allOk, onStatus]);

  return (
    <div className="flex w-full flex-col items-center">
      <Heading title={title} sub={sub} />
      <Stagger className="mt-9 grid w-full max-w-[880px] grid-cols-3 gap-5">
        {SETUP_PERMS.map((it) => {
          const ok = !!perms?.[it.key];
          const c = PERM_COPY[it.key];
          return (
            <motion.div
              key={it.key}
              variants={rise}
              className={clsx("onb-glass flex h-[270px] flex-col items-center px-6 pb-6 pt-7 text-center transition-shadow", ok && "!border-[#bfeedd]")}
              data-testid="perm-row"
              data-granted={ok ? "true" : "false"}
            >
              <motion.span
                animate={ok ? { background: "linear-gradient(135deg, #3fd0a4, #2fb8c9)", color: "#ffffff" } : { background: "linear-gradient(135deg, #d9efff, #e8e1ff)", color: "#3e4a8a" }}
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px]"
              >
                {ok ? <Check size={30} strokeWidth={3} /> : c?.icon ?? <ShieldCheck size={30} />}
              </motion.span>
              <div className="mt-5 text-[19px] font-semibold">{c?.title ?? it.label}</div>
              <div className="onb-muted mt-2 text-[14.5px] leading-snug">{c?.why ?? it.why}</div>
              <div className="mt-auto pt-4">
                {ok ? (
                  <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="flex h-11 items-center gap-1.5 text-[15px] font-semibold text-[#1f9e78]">
                    <Check size={17} strokeWidth={3} /> Allowed
                  </motion.span>
                ) : (
                  <Btn
                    aria-label={`Allow ${c?.title ?? it.label}`}
                    className="!h-11 !px-7 !text-[15px]"
                    onClick={() => {
                      setAsked(it.key);
                      api.openPermissionSettings(it.kind);
                    }}
                  >
                    Allow
                  </Btn>
                )}
              </div>
            </motion.div>
          );
        })}
      </Stagger>
      <AnimatePresence mode="wait">
        <motion.p
          key={line}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className={clsx("mt-6 text-[16px] font-medium", allOk ? "text-[#1f9e78]" : stuck ? "text-[#c46a12]" : "text-[#5b6678]")}
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
