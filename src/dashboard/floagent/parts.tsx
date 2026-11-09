// Small building blocks shared by the Flo Agent tabs.
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { Check, CheckCircle2, CircleAlert, CircleSlash, Copy, Feather, MousePointerClick, Plug, ShieldQuestion, Sparkles, Zap } from "lucide-react";
import { copyText } from "../../lib/clipboard";
import type { AgentRoute, RunStatus, RunStep } from "../../lib/floAgent";

export const EASE = [0.2, 0.8, 0.2, 1] as const;

export const ROUTE_LOOK: Record<AgentRoute, { label: string; icon: (s: number) => React.ReactNode; tint: string; text: string }> = {
  screen: { label: "On screen", icon: (s) => <MousePointerClick size={s} />, tint: "bg-[#3dbbff]/14 ring-[#3dbbff]/25", text: "text-[#0a7cc0] dark:text-[#8fd8ff]" },
  skill: { label: "Skill", icon: (s) => <Zap size={s} />, tint: "bg-[#ff8a5c]/12 ring-[#ff8a5c]/25", text: "text-[#c2541f] dark:text-[#ffb08f]" },
  tools: { label: "Apps", icon: (s) => <Plug size={s} />, tint: "bg-[#a78bfa]/14 ring-[#a78bfa]/25", text: "text-[#6d4fd8] dark:text-[#cbbcff]" },
  answer: { label: "Flo", icon: (s) => <Sparkles size={s} />, tint: "bg-emerald-400/10 ring-emerald-400/20", text: "text-emerald-700 dark:text-emerald-300" },
  hermes: { label: "Hermes", icon: (s) => <Feather size={s} />, tint: "bg-[#f5c97a]/12 ring-[#f5c97a]/25", text: "text-[#a06b06] dark:text-[#f5d595]" },
};

export function RouteBadge({ route, label }: { route: AgentRoute; label?: string }) {
  const l = ROUTE_LOOK[route] ?? ROUTE_LOOK.answer;
  return (
    <span className={clsx("inline-flex h-[22px] items-center gap-1 rounded-full px-2 text-[11px] font-medium ring-1", l.tint, l.text)} data-testid="route-badge" data-route={route}>
      {l.icon(11)}
      {label ?? l.label}
    </span>
  );
}

export function RouteTile({ route, size = 34 }: { route: AgentRoute; size?: number }) {
  const l = ROUTE_LOOK[route] ?? ROUTE_LOOK.answer;
  return (
    <span className={clsx("flex shrink-0 items-center justify-center rounded-xl ring-1", l.tint, l.text)} style={{ width: size, height: size }}>
      {l.icon(Math.round(size * 0.45))}
    </span>
  );
}

const STATUS_LOOK: Record<RunStatus, { label: string; cls: string }> = {
  running: { label: "Working", cls: "bg-[#3dbbff]/14 text-[#0a7cc0] dark:text-[#8fd8ff]" },
  waiting: { label: "Needs you", cls: "bg-amber-400/15 text-amber-700 dark:text-amber-200" },
  done: { label: "Done", cls: "bg-emerald-400/12 text-emerald-700 dark:text-emerald-300" },
  failed: { label: "Didn't finish", cls: "bg-red-500/12 text-red-600 dark:text-red-300" },
  stopped: { label: "Stopped", cls: "bg-white/[0.07] text-muted" },
};

export function RunStatusPill({ status }: { status: RunStatus }) {
  const s = STATUS_LOOK[status] ?? STATUS_LOOK.running;
  return (
    <span className={clsx("inline-flex h-[22px] shrink-0 items-center rounded-full px-2 text-[11px] font-medium", s.cls)} data-testid="run-status" data-status={status}>
      {s.label}
    </span>
  );
}

function StepGlyph({ kind, live }: { kind: RunStep["kind"]; live: boolean }) {
  const base = "relative z-10 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full";
  switch (kind) {
    case "done":
      return <span className={clsx(base, "bg-emerald-400/15 text-emerald-300")}><CheckCircle2 size={12} /></span>;
    case "error":
      return <span className={clsx(base, "bg-red-500/15 text-red-300")}><CircleAlert size={12} /></span>;
    case "stopped":
      return <span className={clsx(base, "bg-white/[0.08] text-muted")}><CircleSlash size={11} /></span>;
    case "confirm":
      return <span className={clsx(base, "bg-amber-400/15 text-amber-700 dark:text-amber-200")}><ShieldQuestion size={11} /></span>;
    case "tool":
      return <span className={clsx(base, "bg-[#a78bfa]/15 text-[#cbbcff]")}><Plug size={10} /></span>;
    default:
      return (
        <span className={base}>
          <span className={clsx("h-[7px] w-[7px] rounded-full", live ? "bg-[var(--accent)] shadow-[0_0_10px_var(--accent)]" : "bg-[var(--border-strong)]")} />
        </span>
      );
  }
}

/** The step timeline of one run. The newest step glows while the run is live. */
export function Timeline({ steps, live }: { steps: RunStep[]; live: boolean }) {
  const shown = steps.filter((s) => s.kind !== "route");
  if (shown.length === 0) return null;
  return (
    <ol className="relative flex flex-col gap-2.5" data-testid="run-timeline">
      <span className="absolute bottom-2 left-[8.5px] top-2 w-px bg-[var(--border)]" aria-hidden />
      <AnimatePresence initial={false}>
        {shown.map((s, i) => (
          <motion.li
            key={`${s.at}-${i}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
            className="flex items-start gap-3"
            data-testid="run-step"
            data-kind={s.kind}
          >
            <StepGlyph kind={s.kind} live={live && i === shown.length - 1} />
            <span
              className={clsx(
                "min-w-0 flex-1 pt-px text-[12.5px] leading-[18px]",
                s.kind === "output" ? "whitespace-pre-wrap font-mono text-[11.5px] text-muted" : s.kind === "done" ? "text-[var(--fg)]" : s.kind === "error" ? "text-red-200" : s.kind === "confirm" ? "text-amber-100" : "text-muted",
              )}
            >
              {s.text}
            </span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}

/** A shell command to copy (Flo never runs install commands itself). */
export function CopyCommand({ cmd, label = "Copy command" }: { cmd: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-black/30 py-1.5 pl-3 pr-1.5" data-testid="copy-command">
      <span className="select-none font-mono text-[11.5px] text-faint">$</span>
      <code className="min-w-0 flex-1 select-all truncate font-mono text-[12px] text-[var(--fg)]" title={cmd}>
        {cmd}
      </code>
      <button
        onClick={async () => {
          if (await copyText(cmd)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }
        }}
        className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11.5px] font-medium text-muted transition hover:bg-[var(--glass)] hover:text-[var(--fg)]"
        aria-label={label}
      >
        {copied ? <Check size={13} className="text-emerald-300" /> : <Copy size={13} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function Dot({ on, warn }: { on: boolean; warn?: boolean }) {
  return <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", warn ? "bg-amber-400" : on ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]" : "bg-[var(--border-strong)]")} />;
}

/** The Hermes mark: a small winged glyph on a warm tile. */
export function HermesTile({ size = 40 }: { size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#2a2213] to-[#120e07] text-[#f5d595] ring-1 ring-[#f5c97a]/25" style={{ width: size, height: size }}>
      <Feather size={Math.round(size * 0.46)} />
    </span>
  );
}
