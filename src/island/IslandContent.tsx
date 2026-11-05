import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { AlertTriangle, Check, LayoutDashboard, Mic, Sparkles, Square, X, Radio, MessageSquareText } from "lucide-react";
import { api } from "../lib/api";
import { formatClock, type IslandVariant } from "../lib/format";
import type { AssistantResponse, ClaudeEvent, IslandGeometry, Mode, Phase } from "../lib/types";
import { Orbit, Waveform } from "./Waveform";
import type { MeetingInfo } from "./Island";

interface Props {
  variant: IslandVariant;
  notch: boolean;
  geo: IslandGeometry;
  phase: Phase;
  mode: Mode;
  message?: string;
  card: AssistantResponse | null;
  claude?: ClaudeEvent;
  claudeMore: number;
  meeting: MeetingInfo;
  onCloseCard: () => void;
  onClaude: (seen: boolean) => void;
  onToggleMeeting: () => void;
}

/** Layout helper: on the notch, the top row is split into two "wings" around the camera. */
function Wings({ notch, geo, left, right, onClick }: { notch: boolean; geo: IslandGeometry; left: React.ReactNode; right: React.ReactNode; onClick?: () => void }) {
  if (!notch)
    return (
      <div className="flex h-full items-center gap-3 px-4" onClick={onClick}>
        <div className="flex shrink-0 items-center">{left}</div>
        <div className="flex min-w-0 flex-1 items-center justify-end">{right}</div>
      </div>
    );
  return (
    <div className="flex items-center" style={{ height: geo.notchHeight }} onClick={onClick}>
      <div className="flex flex-1 items-center justify-start pl-3.5">{left}</div>
      <div style={{ width: geo.notchWidth - 20 }} />
      <div className="flex flex-1 items-center justify-end pr-3.5">{right}</div>
    </div>
  );
}

function ModeIcon({ mode }: { mode: Mode }) {
  if (mode === "assistant")
    return (
      <motion.div animate={{ rotate: [0, 12, -8, 0] }} transition={{ repeat: Infinity, duration: 2.4 }}>
        <Sparkles size={15} className="text-violet-300" />
      </motion.div>
    );
  if (mode === "meeting") return <span className="h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_10px_#ef4444] animate-pulse" />;
  return (
    <div className="relative">
      <span className="absolute inset-0 -m-1 rounded-full bg-cyan-400/25 animate-ping" />
      <Mic size={15} className="relative text-cyan-200" />
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

export function IslandContent(p: Props) {
  const { variant, notch, geo } = p;
  const elapsed = useClock(p.meeting.startedAt, p.meeting.live);
  const top = notch ? geo.notchHeight : 0;

  switch (variant) {
    case "collapsed":
      return notch ? null : (
        <button className="flex h-full w-full items-center justify-center gap-[3px]" onClick={() => api.openDashboard()} title="Flo Flow">
          {[0.45, 0.8, 1, 0.7, 0.4].map((h, i) => (
            <span key={i} className="w-[3px] rounded-full accent-gradient" style={{ height: 16 * h, opacity: 0.9 }} />
          ))}
        </button>
      );

    case "peek":
      return (
        <div className="flex h-full flex-col">
          {notch && <div style={{ height: top }} />}
          <div className={"flex flex-1 items-center justify-around " + (notch ? "px-3 pb-1.5" : "px-2")}>
            <Quick icon={<Mic size={16} />} label="Dictate" onClick={() => api.startSession("dictation")} />
            <Quick icon={<Sparkles size={16} />} label="Ask" onClick={() => api.startSession("assistant")} />
            <Quick icon={<Radio size={16} />} label="Meeting" onClick={() => api.startMeeting()} />
            <Quick icon={<LayoutDashboard size={16} />} label="Open" onClick={() => api.openDashboard()} />
          </div>
        </div>
      );

    case "listening":
      return (
        <Wings
          notch={notch}
          geo={geo}
          onClick={() => api.stopSession()}
          left={
            <div className="flex items-center gap-2">
              <ModeIcon mode={p.mode} />
              {!notch && <span className="text-[13px] font-medium text-white/90">{p.mode === "assistant" ? "Ask anything" : "Listening"}</span>}
            </div>
          }
          right={<Waveform bars={notch ? 14 : 18} height={notch ? 16 : 22} barWidth={notch ? 2.5 : 3} />}
        />
      );

    case "working":
      return (
        <Wings
          notch={notch}
          geo={geo}
          left={<Orbit size={15} />}
          right={<span className="shimmer text-[12.5px] font-semibold tracking-tight">{p.phase === "transcribing" ? "Transcribing" : p.mode === "assistant" ? "Thinking" : "Polishing"}</span>}
        />
      );

    case "done": {
      const err = p.phase === "error";
      return (
        <Wings
          notch={notch}
          geo={geo}
          left={
            <motion.div initial={{ scale: 0.3, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 600, damping: 18 }}>
              {err ? (
                <AlertTriangle size={15} className="text-amber-300" />
              ) : (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-400">
                  <Check size={11} strokeWidth={3.5} className="text-black" />
                </span>
              )}
            </motion.div>
          }
          right={<span className="max-w-[160px] truncate text-[12.5px] font-medium text-white/85">{p.message ?? (err ? "Something went wrong" : p.mode === "meeting" ? "Notes saved" : "Pasted")}</span>}
        />
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
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_10px_#ef4444] animate-pulse" />
                <span className="font-mono text-[12px] tabular-nums text-white/90">{formatClock(elapsed)}</span>
              </div>
            }
            right={<Waveform bars={10} height={14} barWidth={2.5} color="red" />}
          />
          <div className={"truncate text-[12px] text-white/60 " + (notch ? "px-5 pb-2" : "px-4 pb-2")}>
            {p.meeting.lastLine ?? "Listening for the conversation…"}
          </div>
        </div>
      );

    case "meetingExpanded":
      return (
        <div className="flex h-full flex-col">
          {notch && <div style={{ height: top }} />}
          <div className="flex flex-1 flex-col gap-2 px-5 pb-4 pt-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[13px] font-semibold">Meeting notes</span>
                <span className="font-mono text-[12px] tabular-nums text-white/55">{formatClock(elapsed)}</span>
              </div>
              <div className="flex gap-1.5">
                <button className="rounded-full bg-white/10 px-2.5 py-1 text-[11.5px] hover:bg-white/20" onClick={p.onToggleMeeting}>
                  Minimize
                </button>
                <button
                  className="flex items-center gap-1 rounded-full bg-red-500/90 px-2.5 py-1 text-[11.5px] font-medium hover:bg-red-500"
                  onClick={() => api.stopMeeting()}
                >
                  <Square size={10} fill="currentColor" /> Stop
                </button>
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.06] p-2.5">
              <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-violet-300/90">
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
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full accent-gradient">
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
                    className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-200"
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
                <span className="absolute inset-0 rounded-full bg-[#d97757] animate-ping opacity-60" />
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
  }
}

function Quick({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <motion.button
      whileHover={{ y: -1.5, scale: 1.04 }}
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      className="flex flex-col items-center gap-0.5 rounded-xl px-2 py-1 text-white/80 hover:bg-white/10 hover:text-white"
    >
      {icon}
      <span className="text-[10px] font-medium">{label}</span>
    </motion.button>
  );
}
