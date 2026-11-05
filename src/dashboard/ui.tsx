import { motion } from "motion/react";
import clsx from "clsx";
import type { ReactNode } from "react";
import type { ProjectStatus, TodoSource } from "../lib/types";

export function Card({ className, children, strong, onClick }: { className?: string; children: ReactNode; strong?: boolean; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={clsx(strong ? "glass-strong" : "glass", "rounded-2xl", onClick && "cursor-pointer transition hover:bg-[var(--glass-hover)]", className)}>
      {children}
    </div>
  );
}

export function CardTitle({ icon, children, action }: { icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2 text-[13px] font-semibold tracking-tight">
        {icon && <span className="text-muted">{icon}</span>}
        {children}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-[13.5px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "glass",
  size = "md",
  icon,
  disabled,
  className,
  type = "button",
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "glass" | "ghost" | "danger";
  size?: "sm" | "md";
  icon?: ReactNode;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <motion.button
      type={type}
      whileTap={{ scale: 0.96 }}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl font-medium transition disabled:opacity-40",
        size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-9 px-3.5 text-[13px]",
        variant === "primary" && "accent-gradient text-white shadow-[0_6px_20px_-6px_rgba(139,92,246,0.7)] hover:brightness-110",
        variant === "glass" && "glass-strong hover:bg-[var(--glass-hover)]",
        variant === "ghost" && "text-muted hover:bg-[var(--glass)] hover:text-[var(--fg)]",
        variant === "danger" && "bg-red-500/15 text-red-400 hover:bg-red-500/25",
        className,
      )}
    >
      {icon}
      {children}
    </motion.button>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-6 py-2.5">
      <div>
        <div className="text-[13.5px] font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-muted">{hint}</div>}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx("relative h-[22px] w-[38px] shrink-0 rounded-full transition", checked ? "accent-gradient" : "bg-[var(--border-strong)]")}
      >
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 700, damping: 35 }}
          className="absolute top-[3px] h-4 w-4 rounded-full bg-white shadow"
          style={{ left: checked ? 19 : 3 }}
        />
      </button>
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        "h-9 w-full rounded-xl border border-[var(--border)] bg-[var(--glass)] px-3 text-[13.5px] outline-none transition placeholder:text-[var(--fg-faint)] focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/20",
        props.className,
      )}
    />
  );
}

export function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-9 rounded-xl border border-[var(--border)] bg-[var(--glass)] px-2.5 text-[13.5px] outline-none focus:border-violet-400/60"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-[#1b1b24] text-white">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-xl bg-[var(--glass-strong)]", className)} />;
}

export function Empty({ icon, title, hint, action }: { icon: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl glass-strong text-muted">{icon}</div>
      <div className="text-[14px] font-medium">{title}</div>
      {hint && <div className="max-w-xs text-[12.5px] text-muted">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

const STATUS: Record<ProjectStatus, { label: string; cls: string; dot: string }> = {
  active: { label: "Active", cls: "bg-emerald-500/12 text-emerald-500 dark:text-emerald-300", dot: "bg-emerald-400" },
  paused: { label: "Paused", cls: "bg-zinc-500/15 text-muted", dot: "bg-zinc-400" },
  blocked: { label: "Blocked", cls: "bg-amber-500/15 text-amber-500", dot: "bg-amber-400" },
  done: { label: "Done", cls: "bg-sky-500/15 text-sky-400", dot: "bg-sky-400" },
};

export function StatusPill({ status }: { status: ProjectStatus }) {
  const s = STATUS[status];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium", s.cls)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

const SOURCE: Record<TodoSource, string> = {
  voice: "Voice",
  assistant: "Assistant",
  attention: "From screen",
  meeting: "Meeting",
  manual: "Manual",
};

export function SourceBadge({ source, app }: { source: TodoSource; app?: string }) {
  return (
    <span
      className={clsx(
        "rounded-md px-1.5 py-[1px] text-[10.5px] font-medium",
        source === "attention" ? "bg-cyan-500/12 text-cyan-600 dark:text-cyan-300" : "bg-[var(--glass-strong)] text-muted",
      )}
    >
      {source === "attention" && app ? `${app}` : SOURCE[source]}
    </span>
  );
}

export function ProgressRing({ value, color, size = 44, stroke = 4, children }: { value: number; color: string; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--border-strong)" strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - Math.min(1, Math.max(0, value))) }}
          transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold">{children}</div>
    </div>
  );
}

export function Stat({ label, value, sub, icon, tint }: { label: string; value: ReactNode; sub?: ReactNode; icon: ReactNode; tint: string }) {
  return (
    <Card className="relative overflow-hidden p-4">
      <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-25 blur-2xl" style={{ background: tint }} />
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg" style={{ background: `${tint}22`, color: tint }}>
          {icon}
        </span>
        {label}
      </div>
      <div className="mt-2.5 text-[26px] font-semibold tracking-tight tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-[11.5px] text-faint">{sub}</div>}
    </Card>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-[var(--border-strong)] bg-[var(--glass-strong)] px-1.5 font-mono text-[11.5px] font-medium shadow-[inset_0_-1px_0_var(--border-strong)]">
      {children}
    </kbd>
  );
}
