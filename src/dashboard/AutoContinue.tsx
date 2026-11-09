// Auto-continue after a Claude Code usage limit: the waiting / resumed cards on Home's Claude
// sessions card, the run log, and the Settings toggle. Backend: src-tauri/src/autocontinue.rs.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { AlarmClock, Check, Clock3, Loader2, Play, ScrollText, X } from "lucide-react";
import { on } from "../lib/api";
import {
  AC_LOG_EVENT,
  acHeadline,
  autoContinueApi,
  countdown,
  refreshAutoContinue,
  resetLabel,
  useAutoContinue,
  useNow,
  visibleEntries,
  type AutoContinue,
} from "../lib/autoContinue";
import type { Settings } from "../lib/types";
import { Input, Toggle } from "./ui";
import { useStore } from "./store";
import "./autoContinue.css";

/** A small switch (the card's per-session override). */
export function MiniSwitch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={clsx("relative h-[18px] w-[30px] shrink-0 rounded-full transition", checked ? "bg-[var(--ac-amber)]" : "bg-[var(--border-strong)]")}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 700, damping: 35 }}
        className="absolute top-[3px] h-3 w-3 rounded-full bg-[#fff] shadow"
        style={{ left: checked ? 15 : 3 }}
      />
    </button>
  );
}

function StatusIcon({ a }: { a: AutoContinue }) {
  const ring = "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full";
  if (a.status === "waiting")
    return (
      <span className={ring} style={{ background: "var(--ac-chip)" }}>
        {a.auto && <span className="ac-pulse absolute inset-0 rounded-full" style={{ background: "var(--ac-amber)" }} />}
        <AlarmClock size={15} className="relative" style={{ color: "var(--ac-amber)" }} />
      </span>
    );
  if (a.status === "resuming")
    return (
      <span className={ring} style={{ background: "var(--ac-chip)" }}>
        <Loader2 size={15} className="animate-spin" style={{ color: "var(--ac-amber)" }} />
      </span>
    );
  if (a.status === "resumed")
    return (
      <span className={ring + " bg-emerald-400/15"}>
        <Check size={15} strokeWidth={2.6} style={{ color: "var(--ac-ok)" }} />
      </span>
    );
  return (
    <span className={ring + " bg-[var(--glass-strong)]"}>
      <Clock3 size={15} className="text-faint" />
    </span>
  );
}

const linkBtn = "inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] font-medium transition hover:bg-[var(--glass-strong)]";

/** One session that hit its limit. */
export function AutoContinueRow({ a, onLog }: { a: AutoContinue; onLog: (a: AutoContinue) => void }) {
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);
  const toast = useStore((s) => s.toast);
  const when = resetLabel(a.resetsAt ?? a.nextCheckAt, now);
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await f();
    } catch (e) {
      toast({ kind: "error", text: String(e) });
    } finally {
      setBusy(false);
      refreshAutoContinue();
    }
  };
  const waiting = a.status === "waiting";
  const active = waiting || a.status === "resuming";
  const target = a.resetsAt ?? a.nextCheckAt;
  const logBtn = (
    <button className={linkBtn + " text-muted"} onClick={() => onLog(a)}>
      <ScrollText size={12} /> Log
    </button>
  );
  const continueBtn = (
    <button className={linkBtn} style={{ color: "var(--ac-amber)" }} disabled={busy} onClick={() => run(() => autoContinueApi.now(a.sessionId))}>
      <Play size={11} className="fill-current" /> Continue now
    </button>
  );
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      data-testid="ac-row"
      data-status={a.status}
      className="ac-scope rounded-xl px-2.5 py-2"
      style={{ background: active ? "var(--ac-bg)" : "var(--glass)", boxShadow: `inset 0 0 0 1px ${active ? "var(--ac-ring)" : "var(--border)"}` }}
    >
      <div className="flex items-start gap-2.5">
        <StatusIcon a={a} />
        <div className="min-w-0 flex-1">
          <div className="flex min-h-[20px] items-center gap-1.5 text-[13px]">
            <span className="truncate font-medium">{a.project}</span>
            <span className="shrink-0 text-faint">·</span>
            <span className="truncate" style={{ color: active ? "var(--ac-amber-soft)" : a.status === "resumed" ? "var(--ac-ok)" : "var(--fg-muted)" }} data-testid="ac-headline">
              {waiting ? "Waiting for limit reset" : acHeadline(a, now)}
            </span>
            {waiting && (
              <span className="ml-auto shrink-0 rounded-full px-1.5 text-[11px] font-medium tabular-nums leading-[18px]" style={{ background: "var(--ac-chip)", color: "var(--ac-amber)" }} data-testid="ac-countdown">
                {countdown(target, now)}
              </span>
            )}
            {!active && (
              <span className="-my-1 -mr-1 ml-auto flex shrink-0 items-center">
                {logBtn}
                {a.status !== "resumed" && continueBtn}
                <button className={linkBtn + " px-1.5 text-faint"} aria-label={`Dismiss ${a.project}`} title="Dismiss" onClick={() => run(() => autoContinueApi.dismiss(a.sessionId))}>
                  <X size={13} />
                </button>
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[12px] text-muted" title={a.reason}>
            {waiting ? (
              <>
                {a.resetsAt ? (a.auto ? `Resumes ${when}` : `Resets ${when}`) : a.auto ? `No reset time given · retrying ${when}` : "No reset time given"}
                <span className="text-faint"> · {a.reason}</span>
              </>
            ) : a.status === "resuming" ? (
              <>
                Claude is working in the background<span className="text-faint"> · {a.reason}</span>
              </>
            ) : a.status === "resumed" ? (
              <>
                Resumed {resetLabel(a.updatedAt, now)}
                <span className="text-faint"> · {a.reason}</span>
              </>
            ) : (
              a.detail || a.reason
            )}
          </div>
          {a.tzNote && waiting && <div className="mt-0.5 truncate text-[11px] text-faint">{a.tzNote}</div>}
          {active && (
            <div className="-mr-1 mt-1.5 flex flex-wrap items-center justify-end gap-x-1 gap-y-1">
              {waiting ? (
                <label className="mr-auto flex cursor-pointer items-center gap-2 text-[12px]" style={{ color: a.auto ? "var(--ac-amber-soft)" : "var(--fg-muted)" }}>
                  <MiniSwitch checked={a.auto} label={a.resetsAt ? `Auto-continue at ${when}` : "Auto-continue when the limit lifts"} onChange={(v) => run(() => autoContinueApi.set(a.sessionId, v))} />
                  {a.resetsAt ? `Auto-continue at ${when}` : "Auto-continue when it lifts"}
                </label>
              ) : (
                <span className="mr-auto" />
              )}
              {a.status === "resuming" && logBtn}
              {waiting && continueBtn}
              <button className={linkBtn + " text-muted"} disabled={busy} onClick={() => run(() => autoContinueApi.cancel(a.sessionId))}>
                {a.status === "resuming" ? "Stop" : "Cancel"}
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/** The resumed run's output (streams while it runs). */
export function AutoContinueLog({ a, onClose }: { a: AutoContinue; onClose: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    autoContinueApi.log(a.sessionId).then(setLines);
    return on<{ sessionId: string; line: string }>(AC_LOG_EVENT, (e) => e?.sessionId === a.sessionId && setLines((l) => [...l, e.line].slice(-400)));
  }, [a.sessionId]);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [lines]);
  // portal: an animated (transformed) ancestor would otherwise trap this fixed overlay inside the card
  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "var(--scrim)" }} onClick={onClose}>
      <motion.div
        initial={{ y: 10, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        role="dialog"
        aria-label={`Auto-continue log · ${a.project}`}
        className="flex max-h-[70vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-[var(--border)] shadow-[var(--shadow)]"
        style={{ background: "var(--sheet-bg)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
          <ScrollText size={15} className="text-faint" />
          <span className="text-[13.5px] font-semibold">{a.project}</span>
          <span className="text-[12px] text-muted">· resumed run</span>
          <button className="ml-auto rounded-lg p-1 text-faint hover:bg-[var(--glass-strong)]" onClick={onClose} aria-label="Close log">
            <X size={14} />
          </button>
        </div>
        <div ref={box} className="flo-scroll min-h-[160px] overflow-y-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed text-muted select-text" data-testid="ac-log">
          {lines.length === 0 ? <div className="text-faint">Nothing yet.</div> : lines.map((l, i) => <div key={i} className="whitespace-pre-wrap break-words">{l}</div>)}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

/** Every session waiting on (or just back from) a usage limit — Home's Claude sessions card. */
export function AutoContinueList() {
  const all = useAutoContinue();
  const now = useNow(30_000);
  const list = visibleEntries(all, now);
  const [log, setLog] = useState<AutoContinue | null>(null);
  if (list.length === 0) return null;
  return (
    <div className="mb-2 flex flex-col gap-1.5" data-testid="ac-list">
      <AnimatePresence initial={false}>
        {list.map((a) => (
          <AutoContinueRow key={a.sessionId} a={a} onLog={setLog} />
        ))}
      </AnimatePresence>
      <AnimatePresence>{log && <AutoContinueLog a={log} onClose={() => setLog(null)} />}</AnimatePresence>
    </div>
  );
}

/** Settings → Notifications, under "Allow or deny Claude Code from the notch". */
export function AutoContinueSettings({ s, set }: { s: Settings; set: (patch: Partial<Settings>) => void }) {
  const on = !!s.claudeAutoContinue;
  return (
    <div data-testid="ac-settings">
      <Toggle
        label="Auto-continue when limits reset"
        hint="If Claude Code stops at a usage limit, Flo resumes the session a minute after the limit resets, even while you're away. Typing in the session cancels it. Permissions still ask as usual."
        checked={on}
        onChange={(v) => set({ claudeAutoContinue: v })}
      />
      {on && (
        <div className="pb-2.5">
          <div className="mb-1 text-[12px] text-muted">Tell Claude</div>
          <Input
            aria-label="Continue prompt"
            value={s.claudeContinuePrompt ?? "Continue where you left off."}
            maxLength={500}
            onChange={(e) => set({ claudeContinuePrompt: e.target.value })}
            placeholder="Continue where you left off."
          />
        </div>
      )}
    </div>
  );
}
