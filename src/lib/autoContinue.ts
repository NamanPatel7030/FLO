// Auto-continue after a Claude Code usage limit resets (backend: src-tauri/src/autocontinue.rs).
// One shared store for the notch tray and the dashboard: loaded once, kept fresh by the
// flo://autocontinue event (the backend sends the full list on every change).
import { useEffect, useState } from "react";
import { invokeRaw, on } from "./api";

export type AutoContinueStatus = "waiting" | "resuming" | "resumed" | "failed" | "cancelled";

export interface AutoContinue {
  sessionId: string;
  project: string;
  cwd: string;
  /** when Claude hit the limit (ISO) */
  limitedAt: string;
  /** when the limit lifts; null = not given (Flo retries every 15 min) */
  resetsAt: string | null;
  /** when Flo acts next (reset + 1 min, or the back-off) */
  nextCheckAt: string;
  /** the limit message, as Claude Code wrote it */
  reason: string;
  status: AutoContinueStatus;
  /** per-session override; null = follow Settings */
  enabled: boolean | null;
  /** resume attempts today (max 3) */
  cycles: number;
  cycleDay: string;
  detail: string | null;
  tzNote: string | null;
  updatedAt: string;
  /** effective: auto-continue is on for this session */
  auto: boolean;
}

export const AC_EVENT = "flo://autocontinue";
export const AC_LOG_EVENT = "flo://autocontinue-log";

export const autoContinueApi = {
  list: () => invokeRaw<AutoContinue[]>("list_auto_continue").catch(() => [] as AutoContinue[]),
  /** null = follow Settings */
  set: (sessionId: string, enabled: boolean | null) => invokeRaw<AutoContinue[]>("set_auto_continue", { sessionId, enabled }),
  now: (sessionId: string) => invokeRaw<void>("auto_continue_now", { sessionId }),
  cancel: (sessionId: string) => invokeRaw<void>("cancel_auto_continue", { sessionId }),
  dismiss: (sessionId: string) => invokeRaw<void>("dismiss_auto_continue", { sessionId }),
  log: (sessionId: string) => invokeRaw<string[]>("auto_continue_log", { sessionId }).catch(() => [] as string[]),
};

// ── shared store ─────────────────────────────────────────────────────────────
let list: AutoContinue[] = [];
let started = false;
const subs = new Set<(l: AutoContinue[]) => void>();
function publish(l: AutoContinue[]) {
  list = Array.isArray(l) ? l : [];
  subs.forEach((s) => s(list));
}
function start() {
  if (started) return;
  started = true;
  on<AutoContinue[]>(AC_EVENT, publish);
  autoContinueApi.list().then(publish);
}
/** Refetch (after a command, in case the event is slow). */
export const refreshAutoContinue = () => autoContinueApi.list().then(publish);

/** Every auto-continue entry (newest first). */
export function useAutoContinue(): AutoContinue[] {
  const [l, setL] = useState(list);
  useEffect(() => {
    start();
    subs.add(setL);
    setL(list);
    return () => {
      subs.delete(setL);
    };
  }, []);
  return l;
}

/** Ticks every `ms` so countdowns move. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

// ── formatting ───────────────────────────────────────────────────────────────
/** "3:00 PM" today, "tomorrow 9:00 AM", "Mon 9:00 AM" this week, else "Nov 20, 9:00 AM". */
export function resetLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  const clock = t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(t) - day(new Date(now))) / 86_400_000);
  if (days <= 0) return clock;
  if (days === 1) return `tomorrow ${clock}`;
  if (days < 7) return `${t.toLocaleDateString("en-US", { weekday: "short" })} ${clock}`;
  return `${t.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${clock}`;
}

/** "1h 12m", "4m 05s", "now" until `iso`. */
export function countdown(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

/** One-line state for a card: "Resumes 3:00 PM", "Resets 3:00 PM · auto-continue off", … */
export function acHeadline(a: AutoContinue, now = Date.now()): string {
  const when = resetLabel(a.resetsAt ?? a.nextCheckAt, now);
  switch (a.status) {
    case "waiting":
      if (!a.resetsAt) return a.auto ? `Retrying ${resetLabel(a.nextCheckAt, now)}` : "Waiting for the limit to lift";
      return a.auto ? `Resumes ${when}` : `Resets ${when}`;
    case "resuming":
      return "Resumed — continuing";
    case "resumed":
      return "Continued after the reset";
    case "failed":
      return "Didn't continue";
    case "cancelled":
      return "Auto-continue cancelled";
  }
}

/** Entries worth showing: active ones, and finished ones from the last 6 hours. */
export function visibleEntries(l: AutoContinue[], now = Date.now()): AutoContinue[] {
  return l.filter((a) => a.status === "waiting" || a.status === "resuming" || now - new Date(a.updatedAt).getTime() < 6 * 3_600_000);
}
