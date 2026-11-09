// Setup steps, part two: permissions, voice and AI, the optional superpowers, typing speed and
// the ready screen. Same backend calls as before; only the look changed.
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { Bot, Check, ChevronDown, Cloud, Cpu, Download, Gauge, Keyboard, Mic, Monitor, Radio, ShieldCheck, Sparkles, Video } from "lucide-react";
import { api, isTauri, on } from "../../lib/api";
import { EV, type AssistantResponse, type LocalModel, type ModelProgressEvent, type Settings, type StateEvent } from "../../lib/types";
import { toPlainText } from "../../lib/markdown";
import type { NotchlingMood } from "../../lib/notchling";
import { Ribbon, type RibbonMode } from "../../island/Ribbon";
import { ClaudeAvatar } from "../../island/Tray";
import * as snd from "../../lib/onboardSounds";
import { PERMISSION_ITEMS, usePermissions } from "../usePermissions";
import { AiProviderFields, providerInfo, ProviderKey } from "../AiSetup";
import { Select } from "../ui";
import { TypingTest } from "../TypingTest";
import { AvatarEditor } from "../AvatarEditor";
import { Burst } from "./Aurora";
import { Btn, Heading, Key, Rise, Stagger, rise, EASE } from "./parts";
import { simulate, toRibbon } from "./Steps";

const RECOMMENDED = "large-v3-turbo-q5_0";

// ── permissions ─────────────────────────────────────────────────────────────

const PERM_ICON: Record<string, React.ReactNode> = {
  microphone: <Mic size={20} />,
  accessibility: <Keyboard size={20} />,
  inputMonitoring: <Keyboard size={20} />,
  screen: <Monitor size={20} />,
};

export function Permissions({ title, sub, setMood, onStatus }: { title: string; sub: string; setMood: (m: NotchlingMood | null) => void; onStatus: (allOk: boolean) => void }) {
  const perms = usePermissions(2000);
  const [asked, setAsked] = useState<string | null>(null);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    setWaited(false);
    if (!asked) return;
    const t = setTimeout(() => setWaited(true), 7000);
    return () => clearTimeout(t);
  }, [asked]);
  const required = PERMISSION_ITEMS.filter((it) => it.required);
  const allOk = !!perms && required.every((it) => perms[it.key]);
  const stuck = waited && !!asked && !perms?.[asked as keyof typeof perms];
  const line = !perms
    ? "Checking what I'm allowed to do..."
    : allOk
      ? "All set, thank you. I can hear you and type for you now."
      : stuck
        ? "I still can't see it. Flip the switch in System Settings, then come back."
        : !perms.microphone
          ? "I only listen while you hold the key."
          : "Almost there. Accessibility lets me type where your cursor is.";
  const mood: NotchlingMood = !perms ? "think" : allOk ? "happy" : stuck ? "worried" : !perms.microphone ? "listen" : "think";
  useEffect(() => setMood(mood), [mood, setMood]);
  useEffect(() => onStatus(allOk), [allOk, onStatus]);
  const done = PERMISSION_ITEMS.filter((it) => perms?.[it.key]).length;

  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col items-center">
      <Heading title={title} sub={sub} />
      <Stagger className="mt-6 flex w-full flex-col gap-2.5">
        {PERMISSION_ITEMS.map((it) => {
          const ok = !!perms?.[it.key];
          return (
            <motion.div key={it.key} variants={rise} className="onb-glass flex items-center gap-4 !rounded-[20px] px-4 py-3" data-testid="perm-row">
              <motion.span
                animate={ok ? { background: "linear-gradient(135deg, #3fd0a4, #2fb8c9)", color: "#ffffff" } : { background: "linear-gradient(135deg, #d9efff, #e8e1ff)", color: "#3e4a8a" }}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
              >
                {ok ? <Check size={20} strokeWidth={3} /> : PERM_ICON[it.key] ?? <ShieldCheck size={20} />}
              </motion.span>
              <div className="min-w-0 flex-1 text-left">
                <div className="text-[14.5px] font-semibold">
                  {it.label} {!it.required && <span className="onb-faint ml-1 text-[11.5px] font-medium">optional</span>}
                </div>
                <div className="onb-muted text-[12.5px]">{it.why}</div>
              </div>
              {ok ? (
                <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="text-[13px] font-semibold text-[#1f9e78]">
                  Granted
                </motion.span>
              ) : (
                <Btn
                  kind="soft"
                  className="!h-9 !px-4 !text-[13px]"
                  onClick={() => {
                    setAsked(it.key);
                    api.openPermissionSettings(it.kind);
                  }}
                >
                  Grant
                </Btn>
              )}
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
          className={clsx("mt-4 text-[13.5px] font-medium", allOk ? "text-[#1f9e78]" : stuck ? "text-[#c46a12]" : "text-[#5b6678]")}
          data-testid="onboard-line"
        >
          {line} <span className="onb-faint font-normal">({done} of {PERMISSION_ITEMS.length})</span>
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
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      role="radio"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className="onb-choice flex items-center gap-3 rounded-[20px] p-3.5 text-left"
    >
      <span className="onb-icon h-11 w-11 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[14.5px] font-semibold">{label}</span>
        <span className="onb-muted block text-[12px]">{hint}</span>
      </span>
    </motion.button>
  );
  return (
    <div className="mx-auto flex w-full max-w-[620px] flex-col items-center">
      <Heading title={title} sub={sub} />
      <Stagger className="mt-5 w-full">
        <Rise className="onb-label mb-2">I listen</Rise>
        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Voice engine">
          {engine(local, <Cpu size={20} />, "On this Mac", "Recommended. Audio never leaves.", () => set({ sttProvider: "local", sttModel: rec?.id ?? RECOMMENDED }))}
          {engine(!local, <Cloud size={20} />, "In the cloud", "Groq or OpenAI, with your key.", () => set({ sttProvider: "groq", sttModel: "whisper-large-v3-turbo" }))}
        </div>
        <Rise className="onb-glass mt-2.5 !rounded-[20px] px-4 py-3">
          {local ? (
            !rec ? (
              <div className="h-10 animate-pulse rounded-xl bg-[#eef1f8]" />
            ) : (
              <div className="flex items-center gap-3" data-testid="voice-model">
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold">{rec.label}</div>
                  <div className="onb-faint text-[12px]">
                    {rec.languages} · {rec.sizeMb} MB
                  </div>
                  {pct !== null && (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e6eaf3]" role="progressbar" aria-valuenow={pct}>
                      <motion.div className="h-full bg-gradient-to-r from-[#2f8cff] to-[#7a6cff]" animate={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
                {rec.installed ? (
                  <span className="flex items-center gap-1 text-[12.5px] font-semibold text-[#1f9e78]">
                    <Check size={13} strokeWidth={3} /> Ready
                  </span>
                ) : (
                  <Btn className="!h-9 !px-4 !text-[13px]" disabled={pct !== null} icon={<Download size={13} />} onClick={() => api.downloadModel(rec.id)}>
                    {pct !== null ? `${pct}%` : "Download"}
                  </Btn>
                )}
              </div>
            )
          ) : (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13.5px] font-semibold">Provider</span>
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
                <span className="text-[13.5px] font-semibold">API key</span>
                <ProviderKey info={cloud} />
              </div>
            </div>
          )}
        </Rise>

        <Rise className="onb-label mb-2 mt-5">I think with</Rise>
        <Rise className="onb-glass flex flex-col divide-y divide-[rgb(20_40_80/0.07)] !rounded-[20px] px-4 py-0.5">
          <AiProviderFields
            s={s}
            set={set}
            row={(label, hint, node) => (
              <div key={label} className="flex items-center justify-between gap-4 py-2.5">
                <div>
                  <div className="text-[13.5px] font-semibold">{label}</div>
                  {hint && <div className="onb-muted mt-0.5 text-[12px]">{hint}</div>}
                </div>
                <div className="shrink-0">{node}</div>
              </div>
            )}
          />
        </Rise>
      </Stagger>
    </div>
  );
}

// ── superpowers: four optional mini demos in one step ───────────────────────

type Power = "handsfree" | "ask" | "tray" | "meetings";
const POWERS: { id: Power; label: string; icon: React.ReactNode }[] = [
  { id: "handsfree", label: "Hands-free", icon: <Radio size={16} /> },
  { id: "ask", label: "Ask your screen", icon: <Sparkles size={16} /> },
  { id: "tray", label: "Agent tray", icon: <Bot size={16} /> },
  { id: "meetings", label: "Meetings", icon: <Video size={16} /> },
];

function useLiveMode() {
  const [mode, setMode] = useState<RibbonMode | null>(null);
  const [message, setMessage] = useState<string | undefined>();
  useEffect(
    () =>
      on<StateEvent>(EV.state, (e) => {
        setMessage(e.message);
        setMode(toRibbon(e.phase));
      }),
    [],
  );
  return { mode, message };
}

function Strip({ mode, label = "the notch" }: { mode: RibbonMode | null; label?: string }) {
  return (
    <div className="onb-notch hw relative mx-auto h-[40px] w-[320px] overflow-hidden rounded-b-[16px] shadow-[0_10px_24px_-12px_rgb(11_18_32/0.6)]" data-testid="try-ribbon">
      {mode ? <Ribbon width={320} height={40} notchWidth={0} wing={160} mode={mode} leftWing /> : <div className="flex h-full items-center justify-center text-[11.5px] text-white/40">{label}</div>}
    </div>
  );
}

export function Powers({ title, sub, keys, s, set, setMood }: { title: string; sub: string; keys: { dict: string; asst: string }; s: Settings; set: (p: Partial<Settings>) => void; setMood: (m: NotchlingMood | null) => void }) {
  const [tab, setTab] = useState<Power>("handsfree");
  const [won, setWon] = useState<Set<Power>>(new Set());
  const { mode, message } = useLiveMode();
  const [reply, setReply] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  useEffect(() => on<AssistantResponse>(EV.assistant, (r) => r?.reply && setReply(toPlainText(r.reply))), []);
  const win = useRef<(p: Power) => void>(() => {});
  win.current = (p: Power) => {
    if (won.has(p)) return;
    snd.playSuccess();
    setWon((w) => new Set(w).add(p));
  };
  useEffect(() => {
    if (mode === "listen" && message === "hands-free") win.current("handsfree");
  }, [mode, message]);
  useEffect(() => {
    if (reply) win.current("ask");
  }, [reply]);
  useEffect(() => {
    if (added) win.current("tray");
  }, [added]);
  // after a win, glide to the next trick
  const lastWon = useRef(0);
  useEffect(() => {
    if (won.size <= lastWon.current) return;
    lastWon.current = won.size;
    const i = POWERS.findIndex((p) => p.id === tab);
    if (i < POWERS.length - 1 && won.has(tab)) {
      const t = setTimeout(() => setTab(POWERS[i + 1].id), 2000);
      return () => clearTimeout(t);
    }
  }, [won, tab]);
  const moodFor: Record<Power, NotchlingMood> = { handsfree: "listen", ask: "think", tray: "cool", meetings: "talk" };
  useEffect(() => setMood(won.has(tab) ? "excited" : moodFor[tab]), [tab, won, setMood]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto flex w-full max-w-[620px] flex-col items-center">
      <Heading title={title} sub={sub} />
      <div className="onb-glass relative mt-5 flex gap-1 !rounded-full p-1" role="tablist" aria-label="Superpowers">
        {POWERS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={tab === p.id}
            onClick={() => setTab(p.id)}
            className={clsx("relative flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-colors", tab === p.id ? "text-[#ffffff]" : "text-[#5b6678] hover:text-[#0b1220]")}
          >
            {tab === p.id && <motion.span layoutId="onb-power-pill" className="absolute inset-0 rounded-full bg-[#0b1220]" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            <span className="relative flex items-center gap-1.5">
              {won.has(p.id) ? <Check size={15} strokeWidth={3} className={tab === p.id ? "text-[#7ef0c8]" : "text-[#1f9e78]"} /> : p.icon}
              {p.label}
            </span>
          </button>
        ))}
      </div>

      <div className="relative mt-4 w-full">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
            transition={{ duration: 0.32, ease: EASE }}
            className="onb-glass relative flex min-h-[236px] flex-col items-center justify-center px-6 pb-5 pt-0 text-center"
            data-testid="demo"
            data-power={tab}
            data-done={won.has(tab) ? "true" : "false"}
          >
            {tab === "handsfree" && (
              <>
                <Strip mode={mode} />
                <p className="mt-6 text-[15px] text-[#2a3446]">
                  Press <Key>{keys.dict}</Key> + <Key>Space</Key>, then let go.
                </p>
                <p className="onb-muted mt-1.5 text-[13px]">I keep listening until you tap {keys.dict} again. Great for long messages.</p>
                {!isTauri && !won.has("handsfree") && (
                  <button className="onb-link mt-3 text-[12.5px]" onClick={() => simulate([[0, EV.state, { phase: "listening", mode: "dictation", message: "hands-free" }]])}>
                    Simulate (preview)
                  </button>
                )}
              </>
            )}
            {tab === "ask" && (
              <>
                <Strip mode={mode} />
                <p className="mt-6 text-[15px] text-[#2a3446]">
                  Hold <Key>{keys.asst}</Key> and ask <span className="font-semibold text-[#0b1220]">"What's on my screen?"</span>
                </p>
                {reply ? (
                  <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 line-clamp-3 rounded-2xl rounded-bl-md bg-[#eef1f8] px-4 py-2.5 text-left text-[13px] text-[#2a3446]" data-testid="demo-reply">
                    {reply}
                  </motion.p>
                ) : (
                  <p className="onb-muted mt-1.5 text-[13px]">I can read what's in front of you and answer in a sentence.</p>
                )}
                {!isTauri && !reply && (
                  <button
                    className="onb-link mt-3 text-[12.5px]"
                    onClick={() => {
                      simulate([[0, EV.state, { phase: "thinking", mode: "assistant" }]]);
                      api.askAssistant("What's on my screen?").catch(() => {});
                    }}
                  >
                    Simulate (preview)
                  </button>
                )}
              </>
            )}
            {tab === "tray" && (
              <>
                <div className="onb-notch hw mx-auto flex h-[40px] w-[320px] items-center justify-between rounded-b-[16px] px-3" data-testid="tray-preview">
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
                  <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="onb-notch hw mx-auto mt-2 flex w-[320px] items-center gap-2 rounded-2xl px-3 py-2.5 text-left">
                    <ClaudeAvatar status="done" source="claude" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-semibold">my-app · Done</div>
                      <div className="truncate text-[11.5px] text-white/60">Built the login page, all tests pass.</div>
                    </div>
                    <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px]">Open</span>
                  </motion.div>
                ) : (
                  <>
                    <p className="mt-6 text-[15px] text-[#2a3446]">Claude Code, Codex or Cursor sessions show up by the notch when they finish or need you.</p>
                    <Btn
                      className="mt-4 !h-10"
                      onClick={() => {
                        setAdded(true);
                        snd.playTick();
                      }}
                    >
                      Show me
                    </Btn>
                  </>
                )}
              </>
            )}
            {tab === "meetings" && (
              <>
                <div className="onb-notch hw mx-auto w-[340px] overflow-hidden rounded-b-[20px] px-4 pb-3 pt-[40px]" aria-hidden>
                  <div className="flex items-center gap-3 text-left">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inset-0 rounded-full bg-red-500 opacity-60 [animation:ping_1s_cubic-bezier(0,0,0.2,1)_3]" />
                      <span className="relative h-2.5 w-2.5 rounded-full bg-red-500" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold">Zoom call detected</div>
                      <div className="text-[11.5px] text-white/60">Take notes on this Mac?</div>
                    </div>
                    <span className="rounded-full bg-[#2f8cff]/40 px-2.5 py-1 text-[11px] font-semibold">Start notes</span>
                  </div>
                </div>
                <p className="onb-muted mt-4 text-[13px]">When a call starts using your mic, I offer to take notes, right on this Mac.</p>
                <label className="mt-3 flex cursor-pointer items-center justify-center gap-2.5 text-[13.5px] font-medium text-[#2a3446]">
                  <input type="checkbox" checked={s.meetingDetection} onChange={(e) => set({ meetingDetection: e.target.checked })} className="h-4 w-4 accent-[#2f8cff]" />
                  Offer to take notes when a call starts
                </label>
              </>
            )}
            {won.has(tab) && tab !== "meetings" && (
              <>
                <Burst />
                <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-3 flex items-center gap-1.5 text-[13.5px] font-semibold text-[#1f9e78]" data-testid="demo-success">
                  <Check size={15} strokeWidth={3} /> Nice, you've got it
                </motion.span>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── typing speed ────────────────────────────────────────────────────────────

export function Typing({ title, sub, s, measuring, setMeasuring, onDone }: { title: string; sub: string; s: Settings; measuring: boolean; setMeasuring: (v: boolean) => void; onDone: () => void }) {
  if (measuring) {
    return (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="w-full py-1" data-testid="typing-inline">
        <h2 className="onb-title mb-4 text-center !text-[24px]">Type the passage. One minute.</h2>
        <TypingTest minutes={1} compact autoApply onApplied={() => setTimeout(onDone, 1600)} />
      </motion.div>
    );
  }
  return (
    <div className="flex flex-col items-center text-center" data-testid="typing-offer">
      <Heading title={title} sub={sub} />
      <Stagger className="mt-7 flex flex-col items-center">
        <Rise className="onb-glass flex items-center gap-5 px-6 py-5">
          <span className="onb-icon h-14 w-14">
            <Gauge size={26} />
          </span>
          <div className="text-left">
            <div className="onb-label">Right now I guess</div>
            <div className="text-[30px] font-bold leading-none tracking-tight">
              {s.typingWpm}
              <span className="onb-muted ml-1.5 text-[14px] font-medium">words a minute</span>
            </div>
          </div>
        </Rise>
        <Rise className="mt-6">
          <Btn icon={<Gauge size={16} />} onClick={() => setMeasuring(true)} className="!h-12 !px-7">
            Measure now
          </Btn>
        </Rise>
        <Rise className="onb-faint mt-3 text-[12.5px]">Most people talk about three times faster than they type.</Rise>
      </Stagger>
    </div>
  );
}

// ── ready ───────────────────────────────────────────────────────────────────

export function Done({ title, sub, keys, s, set }: { title: string; sub: string; keys: { dict: string; asst: string }; s: Settings; set: (p: Partial<Settings>) => void }) {
  const [open, setOpen] = useState(false);
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => editor.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 380);
    return () => clearTimeout(t);
  }, [open]);
  const rows = useMemo(
    () => [
      [<Key key="a">{keys.dict}</Key>, "Hold to dictate anywhere"],
      [
        <span key="b">
          <Key>{keys.dict}</Key>+<Key>Space</Key>
        </span>,
        "Hands-free dictation",
      ],
      [<Key key="c">{keys.asst}</Key>, "Hold to ask Flo about your screen"],
      [<Key key="d">Esc</Key>, "Cancel"],
      [<span key="e" className="onb-muted text-[12.5px] font-medium">Hover the notch</span>, "Quick actions and your agents"],
    ],
    [keys],
  );
  return (
    <div className="flex w-full flex-col items-center text-center">
      <Heading title={title} sub={sub} />
      <Stagger className="mt-5 w-full max-w-[500px]">
        <Rise className="onb-glass px-5 text-left">
          <div data-testid="cheatsheet">
            {rows.map(([k, label], n) => (
              <div key={n} className="flex items-center justify-between gap-4 border-b border-[rgb(20_40_80/0.07)] py-2 text-[13.5px] last:border-0">
                <span className="shrink-0">{k}</span>
                <span className="onb-muted">{label}</span>
              </div>
            ))}
          </div>
        </Rise>
        <Rise className="onb-glass mt-3 overflow-hidden text-left">
          <div data-testid="onboard-avatar">
            <button className="flex w-full items-center justify-between px-5 py-3 text-[14px] font-semibold" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              Make me yours: eyes, glow and extras
              <motion.span animate={{ rotate: open ? 180 : 0 }}>
                <ChevronDown size={17} className="onb-muted" />
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {open && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }}>
                  <div ref={editor} className="px-5 pb-5">
                    <AvatarEditor compact value={s.avatar} accent={s.accent} onChange={(avatar) => set({ avatar })} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Rise>
      </Stagger>
    </div>
  );
}
