// State of the screen-control card in the notch, driven by `flo://agent` events. Pure, so the
// rules that keep the card from spinning forever are unit tested (agentState.test.ts).
import type { HandsfreeEvent } from "../lib/types";

export type AgentStatus = "running" | "confirm" | "done" | "error" | "aborted";

export interface AgentState {
  goal: string;
  steps: string[];
  status: AgentStatus;
  /** latest confirm question / done summary / error text */
  text?: string;
  /** the confirm question is answered by voice (agent mode) */
  voice?: boolean;
  /** when the last backend event (or local change) arrived, ms since epoch */
  at?: number;
  /** the user pressed Stop: late step events from that run are ignored */
  stopped?: boolean;
}

export interface AgentEvent {
  kind: string;
  text?: string;
  voice?: boolean;
}

/**
 * The backend ends every run within 4 minutes (agent.rs RUN_DEADLINE) and always sends a final
 * event. If nothing at all has arrived for longer than this, the run is gone (crash, lost event):
 * the card must not keep spinning.
 */
export const AGENT_STALE_MS = 270_000;
/** Agent mode's "working" spinner: the backend gives up on a request after 3 minutes. */
export const HANDSFREE_STALE_MS = 200_000;

export const isActive = (a: AgentState | null): boolean => !!a && (a.status === "running" || a.status === "confirm");

export function reduceAgent(prev: AgentState | null, e: AgentEvent | null | undefined, now = Date.now()): AgentState | null {
  if (!e || !e.kind) return prev;
  if (e.kind === "start") return { goal: e.text ?? "", steps: [], status: "running", at: now };
  // after Stop, only the run's final word may update the card (and only its text)
  if (prev?.stopped && (e.kind === "step" || e.kind === "confirm")) return prev;
  const base: AgentState = prev ?? { goal: "", steps: [], status: "running" };
  switch (e.kind) {
    case "step":
      return { ...base, status: "running", steps: [...base.steps, e.text ?? ""].slice(-6), at: now };
    case "confirm":
      return { ...base, status: "confirm", text: e.text, voice: !!e.voice, at: now };
    case "done":
      return { ...base, status: "done", text: e.text, at: now };
    case "aborted":
      return { ...base, status: "aborted", text: e.text || "Stopped.", at: now };
    case "error":
      return { ...base, status: "error", text: e.text || "Something went wrong.", at: now };
    default:
      return prev;
  }
}

/** Stop pressed: show it as stopped right away (the backend confirms with its own event). */
export function stopLocally(prev: AgentState | null, now = Date.now()): AgentState | null {
  if (!prev || !isActive(prev)) return prev;
  return { ...prev, status: "aborted", text: "Stopped.", stopped: true, at: now };
}

/** A running card that has heard nothing for too long: show an error instead of a spinner. */
export function expireAgent(prev: AgentState | null, now = Date.now()): AgentState | null {
  if (!prev || !isActive(prev) || prev.at === undefined) return prev;
  if (now - prev.at < AGENT_STALE_MS) return prev;
  return { ...prev, status: "error", text: "Screen control stopped responding. Try again.", at: now };
}

/** Agent mode stuck on "working" with no news: fall back to listening. */
export function expireHandsfree(hf: HandsfreeEvent | null, lastAt: number, now = Date.now()): HandsfreeEvent | null {
  if (!hf || hf.phase !== "thinking" || now - lastAt < HANDSFREE_STALE_MS) return hf;
  return { ...hf, phase: "listening", message: null };
}
