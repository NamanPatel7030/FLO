"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { THEME_EVENT, readPref, setThemePref, type ThemePref } from "@/lib/theme";

const OPTIONS: { v: ThemePref; label: string; Icon: typeof Sun }[] = [
  { v: "system", label: "System", Icon: Monitor },
  { v: "light", label: "Light", Icon: Sun },
  { v: "dark", label: "Dark", Icon: Moon },
];

function subscribe(cb: () => void) {
  window.addEventListener(THEME_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(THEME_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, readPref, () => "system");
}

/**
 * Theme switch, three ways: System / Light / Dark.
 * - `pill`: a small segmented control (auth pages, footer).
 * - `dock`: one icon button in the dock that opens a tiny menu upward.
 */
export function ThemeToggle({ variant = "pill", className = "" }: { variant?: "pill" | "dock"; className?: string }) {
  const pref = useThemePref();
  if (variant === "dock") return <DockToggle pref={pref} className={className} />;
  return (
    <div role="radiogroup" aria-label="Theme" className={`theme-pill ${className}`} data-testid="theme-toggle">
      {OPTIONS.map(({ v, label, Icon }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={pref === v}
          aria-label={label}
          title={label}
          onClick={() => setThemePref(v)}
          className="theme-pill-opt"
          data-testid={`theme-${v}`}
        >
          <Icon size={14} strokeWidth={2.2} />
        </button>
      ))}
    </div>
  );
}

function DockToggle({ pref, className }: { pref: ThemePref; className: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const Cur = OPTIONS.find((o) => o.v === pref)?.Icon ?? Monitor;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className={`relative ${className}`}>
      <button
        type="button"
        className="chin-item chin-theme"
        aria-label="Theme"
        title="Theme"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        data-testid="dock-theme"
      >
        <span className="chin-ico" suppressHydrationWarning>
          <Cur size={15} />
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={menuId}
            role="menu"
            aria-label="Theme"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="theme-menu absolute bottom-[calc(100%+14px)] left-1/2 z-[80] w-[168px] -translate-x-1/2 origin-bottom p-1.5"
            data-testid="theme-menu"
          >
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">Appearance</p>
            {OPTIONS.map(({ v, label, Icon }) => (
              <button
                key={v}
                type="button"
                role="menuitemradio"
                aria-checked={pref === v}
                onClick={() => {
                  setThemePref(v);
                  setOpen(false);
                }}
                className="theme-menu-item"
                data-testid={`theme-${v}`}
              >
                <Icon size={14} />
                <span className="flex-1 text-left">{label}</span>
                {pref === v && <Check size={13} className="text-brand-300" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
