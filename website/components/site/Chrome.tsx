"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import { Bot, Briefcase, CircleHelp, LayoutGrid, LogIn, Mic, ShieldCheck } from "lucide-react";
import { Logo } from "../Logo";
import { EASE } from "./ui";
import { NotchEyes } from "./Mascot";

/** Every section on the page, in order, with the name the notch shows for it. */
const SECTIONS: [id: string, label: string, group: string][] = [
  ["notchling", "Meet Notchling", "voice"],
  ["dictation", "Dictation", "voice"],
  ["precise", "Precise, and learning", "voice"],
  ["languages", "Languages", "voice"],
  ["private", "Private by design", "privacy"],
  ["assistant", "Assistant", "assistant"],
  ["skills", "Skills & MCP", "assistant"],
  ["agent", "Hands-free agent", "assistant"],
  ["work", "To-dos & reminders", "work"],
  ["projects", "Projects", "work"],
  ["meetings", "Meeting notes", "work"],
  ["claude", "Claude Code", "work"],
  ["widgets", "Widgets", "notch"],
  ["custom", "Make it yours", "notch"],
  ["privacy", "Every request, visible", "privacy"],
  ["features", "Everything else", "faq"],
  ["compare", "Compare", "faq"],
  ["maker", "Made by Naman", "faq"],
  ["faq", "FAQ", "faq"],
];

const DOCK = [
  { group: "voice", href: "#dictation", label: "Voice", icon: Mic },
  { group: "assistant", href: "#assistant", label: "Assistant", icon: Bot },
  { group: "work", href: "#work", label: "Work", icon: Briefcase },
  { group: "notch", href: "#widgets", label: "Notch", icon: LayoutGrid },
  { group: "privacy", href: "#private", label: "Privacy", icon: ShieldCheck },
  { group: "faq", href: "#faq", label: "FAQ", icon: CircleHelp },
];

/** The section currently under the middle of the viewport (null in the hero). */
function useActiveSection() {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const els = SECTIONS.map(([id]) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const on = () => {
      const mid = window.innerHeight * 0.45;
      let cur: string | null = null;
      for (const el of els) if (el.getBoundingClientRect().top <= mid) cur = el.id;
      setActive(cur);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, []);
  return active;
}

/* ── the notch, pinned to the top edge ──────────────────────────────────────────────────── */

export function TopNotch() {
  const active = useActiveSection();
  const [hover, setHover] = useState(false);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });
  const idx = SECTIONS.findIndex(([id]) => id === active);
  const label = idx >= 0 ? SECTIONS[idx][1] : null;
  const open = hover;
  const w = open ? 460 : label ? 380 : 240;
  const h = open ? 118 : 46;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center" role="region" aria-label="Flo notch">
      <motion.div
        className="hw-notch pointer-events-auto relative overflow-hidden rounded-b-[20px]"
        onHoverStart={() => setHover(true)}
        onHoverEnd={() => setHover(false)}
        animate={{ width: w, height: h, borderBottomLeftRadius: open ? 30 : 22, borderBottomRightRadius: open ? 30 : 22 }}
        transition={{ duration: 0.45, ease: EASE }}
        data-testid="top-notch"
      >
        {/* collapsed: current section, like Flo reporting what it's doing */}
        <div className="flex h-[46px] items-center justify-center gap-3 px-5">
          <AnimatePresence mode="wait">
            {label ? (
              <motion.span key={label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }} className="flex items-center gap-2.5 whitespace-nowrap">
                <NotchEyes />
                <span className="text-[15px] font-semibold tracking-[-0.01em] text-[#fff]">{label}</span>
                <span className="rounded-full bg-[rgba(255,255,255,0.12)] px-2 py-0.5 font-mono text-[11.5px] font-semibold text-[rgba(255,255,255,0.75)]">
                  {String(idx + 1).padStart(2, "0")}/{SECTIONS.length}
                </span>
              </motion.span>
            ) : (
              <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                <NotchEyes />
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        {/* open: a short line and the page progress */}
        <AnimatePresence>
          {open && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, delay: 0.1 }} className="px-6 pb-5">
              <p className="text-[14px] text-[rgba(255,255,255,0.65)]">{label ? "Hold control and talk. This page is the tour." : "Scroll. The notch follows along."}</p>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.1)]">
                <motion.div className="h-full origin-left rounded-full bg-gradient-to-r from-[#8fd0ff] via-[#b9a8ff] to-[#ff9ec4]" style={{ scaleX: progress }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

/* ── the dock ───────────────────────────────────────────────────────────────────────────── */

function DockIcon({ mouseX, item, on }: { mouseX: MotionValue<number>; item: (typeof DOCK)[number]; on: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const reduce = useReducedMotion();
  const dist = useTransform(mouseX, (x) => {
    const r = ref.current?.getBoundingClientRect();
    return r ? x - (r.left + r.width / 2) : 999;
  });
  const sizeRaw = useTransform(dist, [-110, 0, 110], [42, 58, 42]);
  const size = useSpring(sizeRaw, { stiffness: 380, damping: 26, mass: 0.2 });
  const Icon = item.icon;
  return (
    <motion.a
      ref={ref}
      href={item.href}
      aria-label={item.label}
      aria-current={on ? "true" : undefined}
      style={reduce ? { width: 44, height: 44 } : { width: size, height: size }}
      className={`group relative grid shrink-0 place-items-center rounded-[14px] transition-colors ${on ? "bg-[#0b1220] text-[#fff] shadow-[0_8px_20px_-8px_rgba(11,18,32,0.6)]" : "bg-[rgba(255,255,255,0.7)] text-[var(--v2-ink-2)] hover:bg-[#fff]"}`}
    >
      <Icon size={19} />
      {/* label pops above on hover */}
      <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#0b1220] px-2.5 py-1 text-[11.5px] font-semibold text-[#fff] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {item.label}
      </span>
      {/* the light under the section you're in */}
      <span className={`absolute -bottom-[7px] h-1 w-1 rounded-full bg-gradient-to-r from-[#2f8cff] to-[#ff7eb0] transition-opacity ${on ? "opacity-100" : "opacity-0"}`} />
    </motion.a>
  );
}

export function Dock({ signedIn = false }: { signedIn?: boolean }) {
  const active = useActiveSection();
  const group = SECTIONS.find(([id]) => id === active)?.[2];
  const mouseX = useMotionValue(Infinity);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });
  const cta = signedIn ? { href: "/download", label: "Download" } : { href: "/signup?next=/download", label: "Get Flo" };
  return (
    <motion.nav
      aria-label="Main"
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.6, duration: 0.7, ease: EASE }}
      className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-3"
    >
      <div
        onMouseMove={(e) => mouseX.set(e.clientX)}
        onMouseLeave={() => mouseX.set(Infinity)}
        className="g relative flex h-[66px] items-end gap-2 rounded-[24px] px-2.5 pb-[11px]"
        data-testid="dock"
      >
        {/* scroll progress along the top rim */}
        <motion.span aria-hidden className="absolute inset-x-5 top-0 h-[2px] origin-left rounded-full bg-gradient-to-r from-[#2f8cff] via-[#7a6cff] to-[#ff7eb0]" style={{ scaleX: progress }} />
        <Link href="/" aria-label="Flo home" className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px]" onClick={(e) => { if (location.pathname === "/") { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); } }}>
          <Logo size={40} />
        </Link>
        <span aria-hidden className="mx-0.5 mb-1.5 h-8 w-px self-end bg-black/10" />
        <div className="hidden items-end gap-2 sm:flex">
          {DOCK.map((d) => (
            <DockIcon key={d.group} mouseX={mouseX} item={d} on={d.group === group} />
          ))}
        </div>
        <span aria-hidden className="mx-0.5 mb-1.5 hidden h-8 w-px self-end bg-black/10 sm:block" />
        {!signedIn && (
          <Link href="/login" className="grid h-11 shrink-0 place-items-center rounded-[14px] bg-[rgba(255,255,255,0.7)] px-3.5 text-[13.5px] font-semibold text-[var(--v2-ink-2)] transition hover:bg-[#fff]" aria-label="Sign in">
            <span className="hidden md:inline">Sign in</span>
            <LogIn size={18} className="md:hidden" />
          </Link>
        )}
        <Link href={cta.href} className="btn btn-primary h-11 shrink-0 !rounded-[14px] px-5 text-[14px]" data-testid="nav-get-flo">
          {cta.label}
        </Link>
      </div>
    </motion.nav>
  );
}
