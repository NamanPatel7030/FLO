// Notch tray bits for a Claude session waiting on a usage-limit reset (auto-continue,
// src-tauri/src/autocontinue.rs): a calm amber clock line with a countdown, a short status label
// and the per-session auto-continue switch. The notch is always dark, so colours are fixed.
import { AlarmClock, Loader2 } from "lucide-react";
import { autoContinueApi, countdown, refreshAutoContinue, resetLabel, useNow, type AutoContinue } from "../lib/autoContinue";

/** The session's auto-continue entry while it matters in the tray (waiting / resuming). */
export function acFor(list: AutoContinue[], sessionId: string): AutoContinue | undefined {
  return list.find((a) => a.sessionId === sessionId && (a.status === "waiting" || a.status === "resuming"));
}

export function LimitStatus({ a }: { a: AutoContinue }) {
  return (
    <span className="shrink-0 text-[10px] text-amber-300" title={a.status === "resuming" ? "Resumed after the limit reset" : "Waiting for the usage limit to reset"}>
      {a.status === "resuming" ? "Resumed" : "Limit"}
    </span>
  );
}

/** "Waiting for limit reset · resumes 3:00 PM · 1h 12m" */
export function LimitLine({ a }: { a: AutoContinue }) {
  const now = useNow(1000);
  if (a.status === "resuming")
    return (
      <span className="flex items-center gap-1 truncate text-[11px] leading-tight text-amber-200/80" data-testid="limit-line">
        <Loader2 size={10} className="shrink-0 animate-spin" /> Resumed — continuing
      </span>
    );
  const when = resetLabel(a.resetsAt ?? a.nextCheckAt, now);
  const what = !a.resetsAt ? (a.auto ? `Retrying ${when}` : "No reset time given") : a.auto ? `Resumes ${when}` : `Resets ${when}`;
  return (
    <span className="flex min-w-0 items-center gap-1 text-[11px] leading-tight text-amber-200/80" data-testid="limit-line" title={`Waiting for limit reset · ${what} — ${a.reason}`}>
      <AlarmClock size={10} className="shrink-0 text-amber-300" />
      <span className="truncate">{what}</span>
      <span className="shrink-0 tabular-nums text-amber-300/70">· {countdown(a.resetsAt ?? a.nextCheckAt, now)}</span>
    </span>
  );
}

/** Per-session "Auto-continue at 3:00 PM" switch (tiny, notch-sized). */
export function LimitSwitch({ a }: { a: AutoContinue }) {
  if (a.status !== "waiting") return null;
  const when = resetLabel(a.resetsAt ?? a.nextCheckAt);
  const label = a.resetsAt ? `Auto-continue at ${when}` : "Auto-continue when the limit lifts";
  return (
    <button
      role="switch"
      aria-checked={a.auto}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        autoContinueApi.set(a.sessionId, !a.auto).catch(() => {}).finally(refreshAutoContinue);
      }}
      className={"relative h-[14px] w-[24px] shrink-0 rounded-full transition " + (a.auto ? "bg-amber-400/90" : "bg-white/20")}
    >
      <span className="absolute top-[2px] h-[10px] w-[10px] rounded-full bg-white shadow transition-[left]" style={{ left: a.auto ? 12 : 2 }} />
    </button>
  );
}
