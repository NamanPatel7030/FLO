// Small building blocks for the setup screens: the animated heading, choice cards, chips, keys
// and buttons. All light, all glass.
import { motion, type Variants } from "motion/react";
import clsx from "clsx";
import { Check } from "lucide-react";

export const EASE = [0.22, 1, 0.36, 1] as const;

/** Parent of staggered children: each `<Rise>` (or motion child with `rise` variants) follows. */
export const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.045, delayChildren: 0.12 } } };
export const rise: Variants = {
  hidden: { opacity: 0, y: 14, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { type: "spring", stiffness: 260, damping: 26 } },
};

export function Stagger({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className={className}>
      {children}
    </motion.div>
  );
}
export function Rise({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div variants={rise} className={className}>
      {children}
    </motion.div>
  );
}

/** Notchling's line for the step: words blur in one after another. */
export function Heading({ title, sub, big }: { title: string; sub?: string; big?: boolean }) {
  const words = title.split(" ");
  return (
    <div className="flex flex-col items-center text-center">
      <h1 className="onb-title" style={big ? { fontSize: 46, letterSpacing: "-0.035em" } : undefined} aria-label={title}>
        {words.map((w, k) => (
          <motion.span
            key={k + w}
            aria-hidden
            className={clsx("inline-block whitespace-pre", w.startsWith("Flo") && "onb-grad-text")}
            initial={{ opacity: 0, y: 10, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ delay: 0.06 + k * 0.05, duration: 0.5, ease: EASE }}
          >
            {w}
            {k < words.length - 1 ? " " : ""}
          </motion.span>
        ))}
      </h1>
      {sub ? (
        <motion.p
          className="onb-sub mt-2.5 max-w-[520px]"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 + words.length * 0.05, duration: 0.45, ease: EASE }}
        >
          {sub}
        </motion.p>
      ) : null}
    </div>
  );
}

/** A big selectable card (single or multi select, via role checkbox / radio). */
export function ChoiceCard({
  on,
  onClick,
  icon,
  label,
  hint,
  role = "checkbox",
  className,
  children,
}: {
  on: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  hint?: string;
  role?: "checkbox" | "radio";
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      variants={rise}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.97 }}
      role={role}
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={clsx("onb-choice flex flex-col items-center justify-center gap-2.5 rounded-[22px] px-3 text-center", className)}
    >
      {icon && <span className="onb-icon h-12 w-12">{icon}</span>}
      <span className="text-[14px] font-semibold leading-tight">{label}</span>
      {hint && <span className="onb-faint -mt-1.5 text-[11.5px] leading-snug">{hint}</span>}
      {children}
      {on && (
        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 600, damping: 20 }} className="onb-tick absolute right-2.5 top-2.5">
          <Check size={12} strokeWidth={3.5} />
        </motion.span>
      )}
    </motion.button>
  );
}

export function Chip({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <motion.button
      type="button"
      variants={rise}
      whileTap={{ scale: 0.95 }}
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className="onb-choice onb-chip"
    >
      {on && (
        <motion.span initial={{ width: 0, opacity: 0 }} animate={{ width: 14, opacity: 1 }} className="inline-flex overflow-hidden text-[#2f8cff]">
          <Check size={14} strokeWidth={3} />
        </motion.span>
      )}
      {children}
    </motion.button>
  );
}

export function Key({ children, big, down }: { children: React.ReactNode; big?: boolean; down?: boolean }) {
  return (
    <kbd className={clsx("onb-key", big && "onb-key-big")} data-down={down ? "true" : "false"}>
      {children}
    </kbd>
  );
}

export function Btn({
  kind = "primary",
  children,
  onClick,
  disabled,
  icon,
  className,
  "aria-label": ariaLabel,
}: {
  kind?: "primary" | "soft";
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <motion.button
      type="button"
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      className={clsx("onb-btn", kind === "primary" ? "onb-btn-primary" : "onb-btn-soft", className)}
    >
      {children}
      {icon}
    </motion.button>
  );
}
