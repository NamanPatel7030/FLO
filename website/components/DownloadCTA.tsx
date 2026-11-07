"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Download } from "lucide-react";
import { OS_LABEL, OS_ORDER, downloadHref, useOS, type OS } from "@/lib/os";

/* Small inline OS marks (lucide 1.x ships no brand icons). */
export function OsIcon({ os, size = 16, className = "" }: { os: OS | null; size?: number; className?: string }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", className, "aria-hidden": true } as const;
  if (os === "mac")
    return (
      <svg {...common}>
        <path
          fill="currentColor"
          d="M16.4 12.7c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1zM13.9 5c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.5-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.4z"
        />
      </svg>
    );
  if (os === "windows")
    return (
      <svg {...common}>
        <path fill="currentColor" d="M2 4.6 10 3.5v7.8H2zm9.2-1.3L22 1.8v9.5H11.2zM2 12.6h8v7.9l-8-1.1zm9.2 0H22v9.6l-10.8-1.5z" />
      </svg>
    );
  if (os === "linux")
    return (
      <svg {...common}>
        <path
          fill="currentColor"
          d="M12 1.8c-2.3 0-3.7 1.9-3.7 4.5 0 1.3.3 2.2-.4 3.4-1.1 1.9-3.1 4.2-3.1 7 0 1 .3 1.8.8 2.4-.6.4-1.7.7-1.7 1.6 0 1.1 1.8 1.2 3.3 1.4 1.1.1 2 .9 3 .9.8 0 1.2-.5 1.8-.5s1 .5 1.8.5c1 0 1.9-.8 3-.9 1.5-.2 3.3-.3 3.3-1.4 0-.9-1.1-1.2-1.7-1.6.5-.6.8-1.4.8-2.4 0-2.8-2-5.1-3.1-7-.7-1.2-.4-2.1-.4-3.4 0-2.6-1.4-4.5-3.7-4.5z"
        />
        <ellipse cx="12" cy="15.6" rx="3.3" ry="4.4" fill="#05070a" opacity=".55" />
        <circle cx="10.6" cy="6.4" r=".9" fill="#05070a" />
        <circle cx="13.4" cy="6.4" r=".9" fill="#05070a" />
        <path d="M10.9 8.2h2.2l-1.1 1.3z" fill="#f5c542" />
      </svg>
    );
  return <Download size={size} className={className} aria-hidden />;
}

type Size = "sm" | "md" | "lg";
const PAD: Record<Size, string> = {
  sm: "h-10 pl-4 pr-3 text-[13.5px]",
  md: "h-12 pl-6 pr-4 text-[15px]",
  lg: "h-14 pl-7 pr-5 text-[16px]",
};
const CHEV: Record<Size, string> = { sm: "h-10 w-9", md: "h-12 w-11", lg: "h-14 w-12" };

/**
 * The primary download button: names the visitor's OS, with a "More" chevron listing the other
 * platforms. Renders a neutral label on the server and first paint, then the detected OS.
 */
export function DownloadCTA({
  size = "md",
  menu = "down",
  compact = false,
  testId,
  className = "",
}: {
  size?: Size;
  /** which way the More menu opens */
  menu?: "up" | "down";
  /** short label for tight spaces (mobile dock) */
  compact?: boolean;
  testId?: string;
  className?: string;
}) {
  const detected = useOS();
  const mobile = detected === "ios" || detected === "android";
  const os: OS | null = detected === null ? null : mobile ? "mac" : (detected as OS);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menuId = useId();

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

  const label =
    os === null ? (compact ? "Get Flo" : "Download Flo") : mobile ? (compact ? "Get Flo" : "Get Flo for Mac") : compact ? OS_LABEL[os] : `Download for ${OS_LABEL[os]}`;

  return (
    <div ref={wrap} className={`relative inline-flex ${className}`} data-os={detected ?? "unknown"}>
      <div className="btn-primary btn inline-flex items-stretch overflow-hidden p-0">
        <Link href={downloadHref(os ?? "mac")} className={`inline-flex items-center gap-2 ${PAD[size]}`} data-testid={testId}>
          <OsIcon os={os} size={size === "lg" ? 19 : size === "md" ? 17 : 15} />
          <span suppressHydrationWarning>{label}</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label="More platforms"
          className={`flex items-center justify-center border-l border-[#001522]/20 transition-colors hover:bg-white/20 ${CHEV[size]}`}
          data-testid={testId ? `${testId}-more` : undefined}
        >
          <motion.span animate={{ rotate: open !== (menu === "up") ? 180 : 0 }} transition={{ duration: 0.2 }} className="flex">
            <ChevronDown size={16} strokeWidth={2.6} />
          </motion.span>
        </button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            id={menuId}
            role="menu"
            initial={{ opacity: 0, y: menu === "up" ? 8 : -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: menu === "up" ? 6 : -6, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className={`glass-strong absolute right-0 z-[80] w-[250px] rounded-2xl p-1.5 text-left ${menu === "up" ? "bottom-[calc(100%+10px)] origin-bottom-right" : "top-[calc(100%+10px)] origin-top-right"}`}
            data-testid={testId ? `${testId}-menu` : undefined}
          >
            <p className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand-200/80">{mobile ? "Flo runs on" : "All platforms"}</p>
            {OS_ORDER.map((o) => {
              const current = !mobile && o === os;
              return (
                <Link
                  key={o}
                  role="menuitem"
                  href={downloadHref(o)}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition-colors hover:bg-white/10 ${current ? "text-ink" : "text-ink/85"}`}
                  data-os={o}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.08] ring-1 ring-white/15">
                    <OsIcon os={o} size={15} />
                  </span>
                  <span className="flex-1">
                    {OS_LABEL[o]}
                    <span className="block text-[11.5px] text-muted">{o === "mac" ? "Apple silicon & Intel" : o === "windows" ? "Windows 10 & 11 · beta" : ".deb & AppImage · beta"}</span>
                  </span>
                  {current && <Check size={15} className="text-brand-300" aria-label="Your computer" />}
                </Link>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
