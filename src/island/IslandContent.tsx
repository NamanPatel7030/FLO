import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { AlertTriangle, Check, Copy, History, LayoutDashboard, MessageSquareText, Mic, Radio, Sparkles, Square, X } from "lucide-react";
import { api } from "../lib/api";
import { formatClock, ISLAND_GAP, ISLAND_ROW, ISLAND_WING, wantsFix, type IslandVariant } from "../lib/format";
import type { AssistantResponse, ClaudeEvent, Dictation, IslandGeometry, Mode, Phase } from "../lib/types";
import { Dots, Orbit, Waveform } from "./Waveform";
import type { MeetingInfo } from "./Island";
import { copyText } from "../lib/clipboard";

interface Props {
  variant: IslandVariant;
  notch: boolean;
  geo: IslandGeometry;
  phase: Phase;
  mode: Mode;
  message?: string;
  card: AssistantResponse | null;
  result: string | null;
  history: Dictation[] | null;
  claude?: ClaudeEvent;
  claudeMore: number;
  meeting: MeetingInfo;
  onCloseCard: () => void;
  onCloseError: () => void;
  onCloseHistory: () => void;
  onOpenHistory: () => void;
  onClaude: (seen: boolean) => void;
  onToggleMeeting: () => void;
  /** peek tile under the cursor (backend hit-testing), -1 = none */
  hotTile?: number;
  /** configured push-to-talk keys, already formatted ("⌃", "fn") */
  keys: { dict: string; asst: string };
}

/** Number of quick actions in the peek menu (for hit-testing). */
export const PEEK_ACTIONS = 5;

function CopyButton({ text, label = true }: { text: string; label?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={
        "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-medium transition " +
        (done ? "bg-brand-300/20 text-brand-200" : "bg-white/[0.08] text-white/80 hover:bg-white/[0.14] hover:text-white")
      }
      onClick={async (e) => {
        e.stopPropagation();
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        }
      }}
      aria-label="Copy"
    >
      {done ? <Check size={12} strokeWidth={3} /> : <Copy size={12} />}
      {label && (done ? "Copied" : "Copy")}
    </button>
  );
}

/** Top row on the notch: [ wing | camera notch | wing ], both wings identical, content centred. */
function Wings({ notch, geo, left, right, onClick }: { notch: boolean; geo: IslandGeometry; left: React.ReactNode; right: React.ReactNode; onClick?: () => void }) {
  if (!notch)
    return (
      <div className="flex h-full items-center gap-3 px-4" onClick={onClick}>
        <div className="flex shrink-0 items-center">{left}</div>
        <div className="flex min-w-0 flex-1 items-center justify-end">{right}</div>
      </div>
    );
  return (
    <div className="flex items-center justify-center" style={{ height: geo.notchHeight }} onClick={onClick}>
      <div className="flex shrink-0 items-center justify-center" style={{ width: ISLAND_WING }}>
        {left}
      </div>
      <div className="shrink-0" style={{ width: geo.notchWidth }} />
      <div className="flex shrink-0 items-center justify-center" style={{ width: ISLAND_WING }}>
        {right}
      </div>
    </div>
  );
}

/** Content area that starts below the camera notch (never behind it). */
function Below({ notch, geo, children, className = "" }: { notch: boolean; geo: IslandGeometry; children: React.ReactNode; className?: string }) {
  return (
    <div className={"absolute inset-x-0 bottom-0 flex flex-col px-4 " + className} style={{ top: notch ? geo.notchHeight + ISLAND_GAP : 10 }}>
      {children}
    </div>
  );
}

function ModeIcon({ mode }: { mode: Mode }) {
  if (mode === "assistant")
    return (
      <motion.div animate={{ rotate: [0, 12, -8, 0] }} transition={{ repeat: Infinity, duration: 2.4 }}>
        <Sparkles size={15} className="text-brand-300" />
      </motion.div>
    );
  if (mode === "meeting") return <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500 shadow-[0_0_10px_#ef4444]" />;
  return (
    <div className="relative">
      <span className="absolute inset-0 -m-1 animate-ping rounded-full bg-brand-400/25" />
      <Mic size={15} className="relative text-brand-200" />
    </div>
  );
}

function useClock(startedAt: number, live: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [live]);
  return live ? Math.max(0, (now - startedAt) / 1000) : 0;
}

const workingLabel = (phase: Phase, mode: Mode) =>
  phase === "transcribing" ? "Transcribing…" : mode === "assistant" ? "Thinking…" : "Polishing…";

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const CheckBadge = () => (
  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-300 shadow-[0_0_10px_rgba(102,206,255,0.6)]">
    <Check size={11} strokeWidth={3.5} className="text-black" />
  </span>
);

export function IslandContent(p: Props) {
  const { variant, notch, geo } = p;
  const elapsed = useClock(p.meeting.startedAt, p.meeting.live);
  const top = notch ? geo.notchHeight : 0;

  switch (variant) {
    case "collapsed":
      return notch ? null : (
        <button className="flex h-full w-full items-center justify-center gap-[3px]" onClick={() => api.openDashboard()} title="Flo">
          {[0.45, 0.8, 1, 0.7, 0.4].map((h, i) => (
            <span key={i} className="accent-gradient w-[3px] rounded-full" style={{ height: 16 * h, opacity: 0.9 }} />
          ))}
        </button>
      );

    case "peek": {
      const actions = [
        { icon: <Mic size={16} />, label: "Dictate", run: () => api.startSession("dictation") },
        { icon: <Sparkles size={16} />, label: "Ask", run: () => api.startSession("assistant") },
        { icon: <Radio size={16} />, label: "Meeting", run: () => api.startMeeting() },
        { icon: <History size={16} />, label: "History", run: p.onOpenHistory },
        { icon: <LayoutDashboard size={16} />, label: "Open", run: () => api.openDashboard() },
      ];
      return (
        <div className="flex h-full flex-col">
          {notch && <div style={{ height: top }} />}
          <div className={"grid flex-1 grid-cols-5 items-center gap-1.5 " + (notch ? "px-3 pb-2.5 pt-1" : "px-2 py-1.5")}>
            {actions.map((a, i) => (
              <Quick key={a.label} index={i} hot={p.hotTile === i} icon={a.icon} label={a.label} onClick={a.run} />
            ))}
          </div>
        </div>
      );
    }

    case "listening": {
      const ask = p.mode === "assistant";
      if (!notch)
        return (
          <Wings
            notch={false}
            geo={geo}
            onClick={() => api.stopSession()}
            left={
              <div className="flex items-center gap-2">
                <ModeIcon mode={p.mode} />
                <span className="text-[13px] font-medium text-white/90">{ask ? "Ask Flo anything" : "Listening…"}</span>
              </div>
            }
            right={<Waveform bars={14} height={20} barWidth={3} />}
          />
        );
      return (
        <div className="flex h-full cursor-pointer flex-col" onClick={() => api.stopSession()}>
          <Wings notch geo={geo} left={<ModeIcon mode={p.mode} />} right={<Waveform bars={8} height={15} barWidth={2.5} gap={2} />} />
          <div className="flex items-center justify-center gap-2 px-4" style={{ height: ISLAND_ROW }}>
            <span className="text-[13px] font-medium text-white/90">{ask ? "Ask Flo anything" : "Listening…"}</span>
            {p.message === "hands-free" ? (
              <span className="flex items-center gap-1.5 text-[12px] text-white/45">
                <span className="rounded-full border border-brand-300/30 bg-brand-300/10 px-1.5 py-px text-[10.5px] font-medium text-brand-200">hands-free</span>
                tap {ask ? p.keys.asst : p.keys.dict} to {ask ? "send" : "paste"} · esc to cancel
              </span>
            ) : (
              <span className="text-[12px] text-white/40">
                release {ask ? p.keys.asst : p.keys.dict} to {ask ? "send" : "paste"} · + space for hands-free
              </span>
            )}
          </div>
        </div>
      );
    }

    case "working":
      if (!notch)
        return (
          <Wings
            notch={false}
            geo={geo}
            left={<Orbit size={15} />}
            right={<span className="shimmer text-[13px] font-semibold tracking-tight">{workingLabel(p.phase, p.mode)}</span>}
          />
        );
      return (
        <div className="flex h-full flex-col">
          <Wings notch geo={geo} left={<Orbit size={14} />} right={<Dots />} />
          <div className="flex items-center justify-center px-4" style={{ height: ISLAND_ROW }}>
            <span className="shimmer text-[13px] font-semibold tracking-tight">{workingLabel(p.phase, p.mode)}</span>
          </div>
        </div>
      );

    case "done":
      return (
        <Wings
          notch={notch}
          geo={geo}
          left={
            <motion.div initial={{ scale: 0.3, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 600, damping: 18 }}>
              <CheckBadge />
            </motion.div>
          }
          right={<span className="truncate text-[11px] font-medium text-white/85">{p.mode === "meeting" ? "Saved" : "Done"}</span>}
        />
      );

    case "result": {
      const text = p.result ?? "";
      return (
        <div className="relative h-full">
          {notch && <Wings notch geo={geo} left={<CheckBadge />} right={<span className="text-[11px] font-medium text-white/80">Pasted</span>} />}
          <Below notch={notch} geo={geo} className="pb-2">
            <div className="flex items-start gap-3">
              {!notch && (
                <span className="mt-0.5">
                  <CheckBadge />
                </span>
              )}
              <p className="selectable line-clamp-2 min-w-0 flex-1 text-[13px] leading-[18px] text-white/90">{text}</p>
              <CopyButton text={text} />
            </div>
          </Below>
        </div>
      );
    }

    case "error": {
      const msg = p.message ?? "Something went wrong";
      return (
        <div className="relative h-full">
          {notch && (
            <Wings
              notch
              geo={geo}
              left={<AlertTriangle size={14} className="text-amber-300" />}
              right={
                <button className="rounded-full p-1 text-white/50 hover:bg-white/10 hover:text-white" onClick={p.onCloseError} aria-label="Dismiss">
                  <X size={13} />
                </button>
              }
            />
          )}
          <Below notch={notch} geo={geo} className="pb-2">
            <div className="flex items-start gap-2">
              {!notch && <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-300" />}
              <p className={"selectable flex-1 text-[13px] leading-[18px] text-white/85 " + (notch ? "line-clamp-3" : "line-clamp-4")}>{msg}</p>
            </div>
            {wantsFix(msg) && (
              <div className="mt-2 flex justify-end">
                <button
                  className="rounded-full bg-brand-300/15 px-3 py-1 text-[11.5px] font-medium text-brand-200 hover:bg-brand-300/25"
                  onClick={() => {
                    p.onCloseError();
                    api.openDashboard("settings");
                  }}
                >
                  Fix in Settings
                </button>
              </div>
            )}
          </Below>
        </div>
      );
    }

    case "history": {
      const items = p.history ?? [];
      return (
        <div className="relative h-full">
          <Below notch={notch} geo={geo} className="pb-2">
            <div className="flex h-[30px] shrink-0 items-center justify-between">
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-white/80">
                <History size={13} className="text-brand-300" /> Recent
              </span>
              <button className="rounded-full p-1 text-white/50 hover:bg-white/10 hover:text-white" onClick={p.onCloseHistory} aria-label="Close">
                <X size={13} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {items.length === 0 ? (
                <p className="flex h-[54px] items-center justify-center text-[13px] text-white/55">Nothing yet — hold {p.keys.dict} and speak.</p>
              ) : (
                items.map((d) => (
                  <div key={d.id} className="flex h-[54px] items-center gap-3 border-t border-white/[0.06] first:border-t-0">
                    <div className="min-w-0 flex-1">
                      <div className="text-[10.5px] text-white/40">
                        {timeOf(d.createdAt)} · {d.app}
                      </div>
                      <p className="selectable line-clamp-2 text-[12.5px] leading-[17px] text-white/90">{d.finalText}</p>
                    </div>
                    <CopyButton text={d.finalText} label={false} />
                  </div>
                ))
              )}
            </div>
            <button
              className="flex h-[30px] shrink-0 items-center justify-center rounded-lg text-[12px] font-medium text-brand-300 hover:bg-white/[0.06]"
              onClick={() => {
                p.onCloseHistory();
                api.openDashboard("history");
              }}
            >
              See all history →
            </button>
          </Below>
        </div>
      );
    }

    case "meeting":
      return (
        <div className="flex h-full cursor-pointer flex-col" onClick={p.onToggleMeeting}>
          <Wings
            notch={notch}
            geo={geo}
            left={
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500 shadow-[0_0_10px_#ef4444]" />
                <span className="font-mono text-[12px] tabular-nums text-white/90">{formatClock(elapsed)}</span>
              </div>
            }
            right={<Waveform bars={10} height={14} barWidth={2.5} color="red" />}
          />
          <div className={"truncate text-[12px] text-white/60 " + (notch ? "px-5 pb-2" : "px-4 pb-2")}>{p.meeting.lastLine ?? "Listening for the conversation…"}</div>
        </div>
      );

    case "meetingExpanded":
      return (
        <div className="flex h-full flex-col">
          {notch && <div style={{ height: top }} />}
          <div className="flex flex-1 flex-col gap-2 px-5 pb-4 pt-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                <span className="text-[13px] font-semibold">Meeting notes</span>
                <span className="font-mono text-[12px] tabular-nums text-white/55">{formatClock(elapsed)}</span>
              </div>
              <div className="flex gap-1.5">
                <button className="rounded-full bg-white/10 px-2.5 py-1 text-[11.5px] hover:bg-white/20" onClick={p.onToggleMeeting}>
                  Minimize
                </button>
                <button className="flex items-center gap-1 rounded-full bg-red-500/90 px-2.5 py-1 text-[11.5px] font-medium hover:bg-red-500" onClick={(e) => {
                    e.stopPropagation();
                    const b = e.currentTarget;
                    if (b.dataset.busy) return;
                    b.dataset.busy = "1";
                    b.lastChild && (b.lastChild.textContent = " Stopping…");
                    api.stopMeeting().catch(() => {
                      delete b.dataset.busy;
                      b.lastChild && (b.lastChild.textContent = " Stop");
                    });
                  }}>
                  <Square size={10} fill="currentColor" /> Stop
                </button>
              </div>
            </div>
            <div className="rounded-xl border border-brand-200/10 bg-brand-300/[0.06] p-2.5">
              <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-brand-300">
                <Sparkles size={11} /> Live summary
              </div>
              <p className="line-clamp-3 text-[12.5px] leading-snug text-white/85">{p.meeting.summary || "Summary appears after a minute of conversation."}</p>
            </div>
            <p className="line-clamp-2 text-[12px] text-white/55">“{p.meeting.lastLine ?? "…"}”</p>
          </div>
        </div>
      );

    case "card": {
      const c = p.card;
      if (!c) return null;
      return (
        <div className="flex h-full flex-col">
          {notch && <div style={{ height: top }} />}
          <div className="flex min-h-0 flex-1 flex-col gap-2 px-5 pb-4 pt-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 text-[11.5px] text-white/50">
                <MessageSquareText size={13} className="shrink-0" />
                <span className="truncate">{c.query}</span>
              </div>
              <button className="rounded-full p-1 text-white/50 hover:bg-white/10 hover:text-white" onClick={p.onCloseCard} aria-label="Dismiss">
                <X size={13} />
              </button>
            </div>
            <div className="flex min-h-0 gap-2.5">
              <span className="accent-gradient mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full">
                <Sparkles size={11} />
              </span>
              <p className="selectable line-clamp-5 overflow-hidden text-[13.5px] leading-snug text-white/95">{c.reply}</p>
            </div>
            {c.results.length > 0 && (
              <div className="mt-auto flex flex-wrap gap-1.5">
                {c.results.map((r, i) => (
                  <motion.span
                    key={i}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 + i * 0.07 }}
                    className="rounded-full border border-brand-300/25 bg-brand-300/10 px-2 py-0.5 text-[11px] text-brand-100"
                  >
                    {r}
                  </motion.span>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    case "claude": {
      const c = p.claude;
      if (!c) return null;
      const needs = c.kind === "notification";
      return (
        <div className="flex h-full flex-col">
          {notch && <div style={{ height: top }} />}
          <div className="flex flex-1 flex-col gap-1.5 px-5 pb-3.5 pt-1.5">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inset-0 animate-ping rounded-full bg-[#d97757] opacity-60" />
                <span className="relative h-2.5 w-2.5 rounded-full bg-[#d97757] shadow-[0_0_10px_#d97757]" />
              </span>
              <span className="truncate text-[13px] font-semibold">
                {needs ? "Claude needs you" : "Claude finished"} <span className="text-white/50">· {c.project}</span>
              </span>
              {p.claudeMore > 0 && <span className="ml-auto rounded-full bg-white/10 px-1.5 text-[10.5px] text-white/70">+{p.claudeMore}</span>}
            </div>
            <p className="line-clamp-2 text-[12.5px] leading-snug text-white/70">{c.message}</p>
            <div className="mt-auto flex justify-end gap-1.5">
              <button className="rounded-full px-3 py-1 text-[11.5px] text-white/70 hover:bg-white/10" onClick={() => p.onClaude(false)}>
                Dismiss
              </button>
              <button className="rounded-full bg-[#d97757] px-3 py-1 text-[11.5px] font-medium text-white hover:brightness-110" onClick={() => p.onClaude(true)}>
                Open
              </button>
            </div>
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}

function Quick({ icon, label, onClick, hot, index }: { icon: React.ReactNode; label: string; onClick: () => void; hot?: boolean; index: number }) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 8, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 520, damping: 30, delay: 0.03 + index * 0.035 }}
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      data-hot={hot ? "true" : "false"}
      className="island-tile flex h-[52px] flex-col items-center justify-center gap-1 rounded-xl text-white/85 hover:text-white"
    >
      <span
        className="flex items-center justify-center text-brand-200"
        style={{ filter: hot ? "drop-shadow(0 0 8px rgba(102,206,255,0.85))" : "drop-shadow(0 0 4px rgba(102,206,255,0.35))" }}
      >
        {icon}
      </span>
      <span className={"text-[10.5px] font-medium " + (hot ? "text-white" : "text-white/75")}>{label}</span>
    </motion.button>
  );
}
