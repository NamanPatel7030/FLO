import { motion } from "motion/react";
import { Square, Loader2, Check, AlertCircle, MousePointer2 } from "lucide-react";
import type { IslandGeometry } from "../lib/types";

export type AgentStatus = "running" | "confirm" | "done" | "error" | "aborted";

export interface AgentState {
  goal: string;
  steps: string[];
  status: AgentStatus;
  /** latest confirm question / done summary / error text */
  text?: string;
}

/** The live card shown while the computer-control agent runs: streaming steps + a prominent Stop. */
export function AgentCard({ agent, notch, geo, onStop, onDismiss }: { agent: AgentState; notch: boolean; geo: IslandGeometry; onStop: () => void; onDismiss: () => void }) {
  const top = notch ? geo.notchHeight : 0;
  const running = agent.status === "running" || agent.status === "confirm";
  const tone =
    agent.status === "error" ? "#ff6b6b" : agent.status === "done" ? "#34d399" : agent.status === "aborted" ? "#8b8f98" : "var(--accent)";
  const lastStep = agent.steps[agent.steps.length - 1];
  return (
    <div className="flex h-full flex-col px-3.5 pb-3" style={{ paddingTop: top + 6 }}>
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md" style={{ background: "color-mix(in srgb, var(--accent) 22%, transparent)" }}>
          {agent.status === "running" || agent.status === "confirm" ? (
            <Loader2 size={13} className="animate-spin text-[var(--accent)]" />
          ) : agent.status === "done" ? (
            <Check size={13} style={{ color: tone }} />
          ) : agent.status === "error" ? (
            <AlertCircle size={13} style={{ color: tone }} />
          ) : (
            <Square size={11} style={{ color: tone }} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-white/40">Screen control</div>
          <div className="truncate text-[12.5px] font-medium text-white/90">{agent.goal || "Working…"}</div>
        </div>
        {running && (
          <button
            onClick={onStop}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#ff5d5d]/15 px-2.5 py-1.5 text-[12px] font-semibold text-[#ff8f8f] transition hover:bg-[#ff5d5d]/25"
          >
            <Square size={11} fill="currentColor" /> Stop
          </button>
        )}
      </div>

      {agent.status === "confirm" ? (
        <div className="mt-2 rounded-lg bg-white/[0.05] px-2.5 py-2 text-[12px] text-white/80">{agent.text}</div>
      ) : agent.status === "done" || agent.status === "error" || agent.status === "aborted" ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="truncate text-[12px]" style={{ color: tone }}>
            {agent.text ?? (agent.status === "aborted" ? "Stopped." : "Done.")}
          </span>
          <button onClick={onDismiss} className="shrink-0 rounded-md px-2 py-1 text-[11.5px] text-white/55 hover:bg-white/10 hover:text-white">
            Dismiss
          </button>
        </div>
      ) : (
        <div className="relative mt-1.5 flex-1 overflow-hidden">
          {lastStep && (
            <motion.div
              key={lastStep}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-1.5 text-[12px] text-white/80"
            >
              <MousePointer2 size={12} className="shrink-0 text-[var(--accent)]" />
              <span className="truncate">{lastStep}</span>
            </motion.div>
          )}
          {!lastStep && <div className="text-[12px] text-white/45">Looking at the screen…</div>}
          {agent.steps.length > 1 && (
            <div className="mt-1 space-y-0.5">
              {agent.steps.slice(0, -1).slice(-2).map((s, i) => (
                <div key={`${s}-${i}`} className="truncate pl-[18px] text-[11px] text-white/35">
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
