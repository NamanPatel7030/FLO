import { motion } from "motion/react";
import clsx from "clsx";
import { useId, useState, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import type { ProjectStatus, TodoSource } from "../lib/types";

/** Hover/focus tooltip. Keyboard reachable; links the trigger to the bubble via aria-describedby. */
export function Tooltip({ text, children, side = "top" }: { text: ReactNode; children: ReactNode; side?: "top" | "bottom" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      <span aria-describedby={open ? id : undefined}>{children}</span>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={clsx(
            "pointer-events-none absolute left-1/2 z-50 w-max max-w-[260px] -translate-x-1/2 rounded-xl border border-[var(--border-strong)] px-3 py-2 text-[12px] leading-snug text-[var(--fg)] shadow-[var(--shadow)]",
            side === "top" ? "bottom-full mb-2" : "top-full mt-2",
          )}
          style={{ background: "var(--menu-bg)" }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

/** A small "?" that reveals a tooltip. Place next to a label. */
export function InfoDot({ text }: { text: ReactNode }) {
  return (
    <Tooltip text={text}>
      <button type="button" aria-label="More info" className="inline-flex text-faint transition hover:text-[var(--fg)]">
        <HelpCircle size={13} />
      </button>
    </Tooltip>
  );
}

/** Helper subtext under a field/label. */
export function FieldHelp({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-[12px] leading-relaxed text-muted">{children}</p>;
}

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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-[240px] flex-1">
        <h1 className="text-[28px] font-semibold tracking-[-0.03em]">
          {title}
          <span aria-hidden className="serif-accent ink-grad text-[1.1em]">.</span>
        </h1>
        {subtitle && <p className="mt-1 text-[13.5px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 whitespace-nowrap">{actions}</div>}
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
  "aria-label": ariaLabel,
  title,
}: {
  "aria-label"?: string;
  title?: string;
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
      aria-label={ariaLabel}
      title={title}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl font-medium transition disabled:opacity-40",
        size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-9 px-3.5 text-[13px]",
        variant === "primary" && "btn-primary",
        variant === "glass" && "btn-glass",
        variant === "ghost" && "text-muted hover:bg-[var(--glass)] hover:text-[var(--fg)]",
        variant === "danger" && "btn-danger",
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
          className="absolute top-[3px] h-4 w-4 rounded-full bg-[#fff] shadow"
          style={{ left: checked ? 19 : 3 }}
        />
      </button>
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  // full width unless the caller sets one: `w-full w-56` would let w-full win (it sorts later in the CSS)
  const sized = /(^|\s)w-/.test(props.className ?? "");
  return (
    <input
      {...props}
      className={clsx(
        !sized && "w-full",
        "h-9 rounded-xl border border-[var(--border)] bg-[var(--glass)] px-3 text-[13.5px] outline-none transition placeholder:text-[var(--fg-faint)] focus:border-brand-400/60 focus:ring-2 focus:ring-brand-500/20",
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
      className="h-9 rounded-xl border border-[var(--border)] bg-[var(--glass)] px-2.5 text-[13.5px] outline-none focus:border-brand-400/60"
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
        source === "attention" ? "bg-brand-500/12 text-brand-600 dark:text-brand-300" : "bg-[var(--glass-strong)] text-muted",
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
