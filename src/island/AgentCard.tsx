import { motion } from "motion/react";
import { Square, Loader2, Check, AlertCircle, MousePointer2, Mic, X } from "lucide-react";
import type { HandsfreeEvent, IslandGeometry } from "../lib/types";

import type { AgentState } from "./agentState";

export type { AgentState, AgentStatus } from "./agentState";

/** Pulsing accent ring around a mic: "Flo is listening" (agent mode). */
function ListeningDot({ size = 26, busy = false }: { size?: number; busy?: boolean }) {
  return (
    <span className="relative flex shrink-0 items-center justify-center" style={{ width: size, height: size }} aria-hidden>
      {!busy && (
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ border: "1.5px solid var(--accent)" }}
          initial={{ scale: 0.8, opacity: 0.7 }}
          animate={{ scale: 1.45, opacity: 0 }}
          transition={{ type: "tween", duration: 1.6, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <span
        className="flex items-center justify-center rounded-full"
        style={{ width: size - 4, height: size - 4, background: "color-mix(in srgb, var(--accent) 24%, transparent)", boxShadow: "0 0 12px -2px var(--accent)" }}
      >
        {busy ? <Loader2 size={12} className="animate-spin text-[var(--accent)]" /> : <Mic size={12} className="text-[var(--accent)]" />}
      </span>
    </span>
  );
}

/** Agent mode (hands-free): a persistent pill that shows Flo is listening, and what it last heard. */
export function AgentModePill({ hf, notch, geo, exitHint, onExit }: { hf: HandsfreeEvent; notch: boolean; geo: IslandGeometry; exitHint: string; onExit: () => void }) {
  const top = notch ? geo.notchHeight : 0;
  const thinking = hf.phase === "thinking";
  const label = thinking ? "Agent mode · working" : "Agent mode · listening";
  return (
    <div data-testid="agent-mode-pill" className="flex h-full items-center gap-2.5 px-3.5" style={{ paddingTop: top ? top + 4 : 0 }} role="status" aria-label={label}>
      <ListeningDot busy={thinking} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">{label}</span>
          <span className="ml-auto shrink-0 truncate text-[10px] text-white/35">{exitHint}</span>
        </div>
        <div className="truncate text-[12.5px] text-white/85" data-testid="agent-mode-heard">
          {hf.message ? hf.message : hf.heard ? `“${hf.heard}”` : <span className="text-white/45">Just say what to do — “open Chrome and play lofi”</span>}
        </div>
      </div>
      <button onClick={onExit} title="Turn off agent mode" aria-label="Turn off agent mode" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white/50 transition hover:bg-white/10 hover:text-white">
        <X size={13} />
      </button>
    </div>
  );
}

/** The live card shown while the computer-control agent runs: streaming steps + a prominent Stop. */
export function AgentCard({
  agent,
  notch,
  geo,
  onStop,
  onDismiss,
  onAnswer,
  handsfree = false,
  queued,
}: {
  agent: AgentState;
  notch: boolean;
  geo: IslandGeometry;
  onStop: () => void;
  onDismiss: () => void;
  /** answer a confirm question (Yes / No buttons; agent mode also listens for a spoken answer) */
  onAnswer?: (yes: boolean) => void;
  /** agent mode is on: Flo keeps listening ("say stop") */
  handsfree?: boolean;
  /** a request said during the run, which goes next */
  queued?: string | null;
}) {
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
          <div className="flex items-center gap-1.5 truncate text-[10px] font-semibold uppercase tracking-wider text-white/40">
            Screen control
            {handsfree && (
              <span className="flex items-center gap-1 normal-case tracking-normal text-[var(--accent)]" data-testid="agent-handsfree">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" /> listening · say “stop”
              </span>
            )}
          </div>
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
        <div className="mt-2 rounded-lg bg-white/[0.05] px-2.5 py-2" data-testid="agent-confirm">
          <div className="line-clamp-2 text-[12.5px] font-medium leading-[17px] text-white/90">{agent.text}</div>
          <div className="mt-1.5 flex items-center gap-2">
            {agent.voice ? (
              <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--accent)]">
                <ListeningDot size={18} /> Say “yes” or “no”
              </span>
            ) : (
              <span className="text-[11.5px] text-white/45">Nothing happens until you answer.</span>
            )}
            <span className="ml-auto flex gap-1.5">
              <button onClick={() => onAnswer?.(false)} className="rounded-md bg-white/[0.08] px-2.5 py-1 text-[11.5px] font-medium text-white/75 hover:bg-white/[0.14]">
                No
              </button>
              <button onClick={() => onAnswer?.(true)} className="rounded-md bg-[var(--accent)]/25 px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-[var(--accent)]/35">
                Yes
              </button>
            </span>
          </div>
        </div>
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
              transition={{ type: "tween", duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center gap-1.5 text-[12px] text-white/80"
              data-testid="agent-step"
            >
              <MousePointer2 size={12} className="shrink-0 text-[var(--accent)]" />
              <span className="truncate">{lastStep}</span>
            </motion.div>
          )}
          {!lastStep && <div className="text-[12px] text-white/45">Looking at the screen…</div>}
          {queued ? (
            <div className="mt-1 truncate pl-[18px] text-[11px] text-white/45">Next: “{queued}”</div>
          ) : (
            agent.steps.length > 1 && (
              <div className="mt-1 space-y-0.5">
                {agent.steps
                  .slice(0, -1)
                  .slice(-2)
                  .map((s, i) => (
                    <div key={`${s}-${i}`} className="truncate pl-[18px] text-[11px] text-white/35">
                      {s}
                    </div>
                  ))}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
