"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useSpring } from "motion/react";
import { CircleHelp, Columns3, LayoutGrid, LogIn, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { DownloadCTA } from "../DownloadCTA";
import { Logo } from "../Logo";
import { CHAPTER_INDEX } from "./chapters";
import { useStory } from "./StoryContext";

type Item = { key: string; label: string; icon: React.ReactNode; go?: () => void; href?: string; wide?: boolean };

/** Bottom ear: the concave curve where the chin flows into the bottom edge (mirror of the notch's top ears). */
function Ear({ side }: { side: "l" | "r" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden
      className={`absolute bottom-0 ${side === "l" ? "-left-[15.5px]" : "-right-[15.5px] -scale-x-100"}`}
    >
      <path d="M16 0 V16 H0 C9 16 16 9 16 0 Z" fill="#05090f" />
    </svg>
  );
}

/** Live mini waveform inside the orb — it "listens" while you scroll. */
function Wave({ on }: { on: boolean }) {
  return (
    <span className="chin-wave" data-on={on || undefined} aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} style={{ animationDelay: `${i * 0.11}s` }} />
      ))}
    </span>
  );
}

/**
 * The site dock is the notch's twin: a black "chin" rising from the bottom edge, with concave ears,
 * text labels, a liquid highlight that slides to whatever you point at (or the section you're in),
 * a glowing Flo orb in the middle that scrolls you home, and a scroll-progress hairline on its rim.
 */
export function Dock({ signedIn = false }: { signedIn?: boolean }) {
  const { goTo, active, reduce } = useStory();
  const [section, setSection] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [scrolling, setScrolling] = useState(false);
  const idle = useRef<number | undefined>(undefined);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.4 });

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  const left: Item[] = [
    { key: "features", label: "Features", icon: <Sparkles size={15} />, go: () => goTo(CHAPTER_INDEX.dictation) },
    { key: "privacy", label: "Privacy", icon: <ShieldCheck size={15} />, go: () => goTo(CHAPTER_INDEX.privacy) },
    { key: "compare", label: "Compare", icon: <Columns3 size={15} />, go: () => scrollTo("compare") },
  ];
  const right: Item[] = [
    { key: "everything", label: "All features", icon: <LayoutGrid size={15} />, go: () => scrollTo("everything"), wide: true },
    { key: "faq", label: "FAQ", icon: <CircleHelp size={15} />, go: () => scrollTo("faq") },
  ];
  const account: Item = signedIn
    ? { key: "account", label: "Downloads", icon: <UserRound size={15} />, href: "/download" }
    : { key: "signin", label: "Sign in", icon: <LogIn size={15} />, href: "/login" };

  // which section is on screen: the story chapter, else whichever outro section crosses the middle
  useEffect(() => {
    const ids = ["everything", "app", "compare", "maker", "faq"];
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setSection(e.target.id);
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // the orb's waveform dances while the page is moving
  useEffect(() => {
    if (reduce) return;
    const on = () => {
      setScrolling(true);
      window.clearTimeout(idle.current);
      idle.current = window.setTimeout(() => setScrolling(false), 420);
    };
    window.addEventListener("scroll", on, { passive: true });
    return () => {
      window.removeEventListener("scroll", on);
      window.clearTimeout(idle.current);
    };
  }, [reduce]);

  const current = active === CHAPTER_INDEX.privacy ? "privacy" : active >= 1 ? "features" : active === 0 ? null : section === "compare" ? "compare" : section === "faq" ? "faq" : section === "everything" ? "everything" : null;
  const lit = hover ?? current;

  const renderItem = (it: Item) => {
    const on = current === it.key;
    const body = (
      <>
        {lit === it.key && (
          <motion.span
            layoutId="chin-pill"
            className="chin-pill"
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 38, mass: 0.7 }}
            aria-hidden
          />
        )}
        <span className="relative z-[1] flex items-center gap-1.5">
          <span className="chin-ico">{it.icon}</span>
          <span className="hidden lg:inline">{it.label}</span>
        </span>
      </>
    );
    const common = {
      className: it.wide ? "chin-item chin-md" : "chin-item",
      "aria-label": it.label,
      title: it.label,
      "data-testid": `dock-${it.key}`,
      "data-on": on || undefined,
      onMouseEnter: () => setHover(it.key),
      onFocus: () => setHover(it.key),
      onBlur: () => setHover(null),
    };
    return it.href ? (
      <Link key={it.key} href={it.href} {...common} aria-current={on ? "page" : undefined}>
        {body}
      </Link>
    ) : (
      <button key={it.key} type="button" onClick={it.go} {...common} aria-current={on ? "true" : undefined}>
        {body}
      </button>
    );
  };

  return (
    <nav aria-label="Site" className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center" data-testid="dock">
      <motion.div
        className="chin pointer-events-auto relative"
        initial={reduce ? false : { y: 80 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 28, delay: 0.4 }}
        onMouseLeave={() => setHover(null)}
      >
        <Ear side="l" />
        <Ear side="r" />
        {/* scroll progress along the top rim */}
        <span className="chin-rim" aria-hidden>
          <motion.span className="chin-rim-fill" style={{ scaleX: progress }} />
        </span>
        {/* three columns so the orb sits dead-centre, right under the notch */}
        <div className="relative grid grid-cols-[1fr_auto_1fr] items-center px-2 pb-[max(10px,env(safe-area-inset-bottom))] pt-2.5 md:px-3">
          <div className="flex items-center justify-end gap-0.5 md:gap-1">
            <span className="mr-auto hidden items-center gap-2 pl-1 pr-3 font-display text-[15px] font-bold tracking-tight text-white xl:flex" aria-hidden>
              <Logo size={22} /> Flo
            </span>
            {left.map(renderItem)}
          </div>

          {/* the Flo orb: home */}
          <button
            type="button"
            className="chin-orb mx-1.5 md:mx-2.5"
            aria-label="Back to top"
            title="Back to top"
            data-testid="dock-home"
            onMouseEnter={() => setHover(null)}
            onClick={() => window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" })}
          >
            <Wave on={scrolling} />
          </button>

          <div className="flex items-center gap-0.5 md:gap-1">
            {right.map(renderItem)}
            {renderItem(account)}
            <span aria-hidden className="mx-1.5 h-6 w-px bg-white/12 md:mx-2" />
            <div className="hidden md:block">
              <DownloadCTA size="sm" menu="up" testId="dock-download" />
            </div>
            <div className="md:hidden">
              <DownloadCTA size="sm" menu="up" compact testId="dock-download-m" />
            </div>
          </div>
        </div>
      </motion.div>
    </nav>
  );
}
