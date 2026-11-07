"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CircleHelp, Columns3, LogIn, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { DownloadCTA } from "../DownloadCTA";
import { CHAPTER_INDEX } from "./chapters";
import { useStory } from "./StoryContext";

type Item = { key: string; label: string; icon: React.ReactNode; tint: string; go?: () => void; href?: string };

const BASE = 44; // icon tile size (px) at rest
const MAX_SCALE = 1.55;
const REACH = 150; // px from the pointer where magnification fades out

/**
 * A macOS-style floating dock at the bottom of the page. On desktop the tiles magnify under the
 * pointer (transforms only, written straight to the DOM each frame); on phones it is a compact bar.
 */
export function Dock({ signedIn = false }: { signedIn?: boolean }) {
  const { goTo, active, reduce } = useStory();
  const [section, setSection] = useState<string | null>(null);
  const [magnify, setMagnify] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const bg = useRef<HTMLDivElement>(null);
  const slots = useRef<(HTMLDivElement | null)[]>([]);
  const tiles = useRef<(HTMLSpanElement | null)[]>([]);
  const tips = useRef<(HTMLSpanElement | null)[]>([]);
  const tail = useRef<HTMLDivElement>(null);
  const mouse = useRef<number | null>(null);
  const centers = useRef<number[]>([]);
  const scales = useRef<number[]>([]);
  const raf = useRef(0);

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  const items: Item[] = [
    { key: "features", label: "Features", icon: <Sparkles size={20} />, tint: "from-[#66ceff] to-[#1a9be0]", go: () => goTo(CHAPTER_INDEX.dictation) },
    { key: "privacy", label: "Privacy", icon: <ShieldCheck size={20} />, tint: "from-[#5eead4] to-[#0e7490]", go: () => goTo(CHAPTER_INDEX.privacy) },
    { key: "compare", label: "Compare", icon: <Columns3 size={20} />, tint: "from-[#a5b4fc] to-[#4338ca]", go: () => scrollTo("compare") },
    { key: "faq", label: "FAQ", icon: <CircleHelp size={20} />, tint: "from-[#93c5fd] to-[#1e40af]", go: () => scrollTo("faq") },
    signedIn
      ? { key: "account", label: "Your downloads", icon: <UserRound size={20} />, tint: "from-[#cbd5e1] to-[#475569]", href: "/download" }
      : { key: "signin", label: "Sign in", icon: <LogIn size={20} />, tint: "from-[#cbd5e1] to-[#475569]", href: "/login" },
  ];
  const n = items.length;

  // which section is on screen: the story chapter, else whichever outro section crosses the middle
  useEffect(() => {
    const ids = ["app", "compare", "maker", "faq"];
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
  const current = active === CHAPTER_INDEX.privacy ? "privacy" : active >= 1 ? "features" : active === 0 ? null : section === "compare" ? "compare" : section === "faq" ? "faq" : null;

  // magnification only for a fine pointer on a wide screen, and never under reduced motion
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 768px)");
    const on = () => setMagnify(mq.matches && !reduce);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [reduce]);

  const measure = () => {
    centers.current = slots.current.map((el) => {
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      // undo the current offset so we measure the resting position
      const t = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return r.left - t.m41 + r.width / 2;
    });
  };

  const frame = () => {
    raf.current = 0;
    const m = mouse.current;
    let moving = false;
    const target = centers.current.map((c) => {
      if (m === null) return 1;
      const dist = Math.abs(m - c);
      const f = Math.max(0, 1 - (dist / REACH) ** 2);
      return 1 + (MAX_SCALE - 1) * f;
    });
    const next = target.map((t, i) => {
      const cur = scales.current[i] ?? 1;
      const v = cur + (t - cur) * 0.22;
      if (Math.abs(t - v) > 0.002) moving = true;
      return Math.abs(t - v) < 0.002 ? t : v;
    });
    scales.current = next;
    const extra = next.map((s) => (s - 1) * BASE);
    const total = extra.reduce((a, b) => a + b, 0);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const shift = acc + extra[i] / 2 - total / 2;
      acc += extra[i];
      const slot = slots.current[i];
      if (slot) slot.style.transform = `translate3d(${shift.toFixed(2)}px,0,0)`;
      const tile = tiles.current[i];
      if (tile) tile.style.transform = `scale(${next[i].toFixed(3)})`;
      const tip = tips.current[i];
      if (tip) tip.style.transform = `translate3d(-50%, ${(-(next[i] - 1) * BASE).toFixed(1)}px, 0)`;
    }
    if (tail.current) tail.current.style.transform = `translate3d(${(total / 2).toFixed(2)}px,0,0)`;
    const w = bar.current?.offsetWidth ?? 1;
    if (bg.current) bg.current.style.transform = `scaleX(${((w + total) / w).toFixed(4)})`;
    if (moving) raf.current = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!raf.current) raf.current = requestAnimationFrame(frame);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <nav aria-label="Site" className="dock-wrap pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3" data-testid="dock">
      <div
        ref={bar}
        className="pointer-events-auto relative flex items-end gap-1.5 px-2.5 py-2 md:gap-2 md:px-3 md:py-2.5"
        onPointerEnter={(e) => {
          if (!magnify || e.pointerType !== "mouse") return;
          measure();
          mouse.current = e.clientX;
          kick();
        }}
        onPointerMove={(e) => {
          if (!magnify || e.pointerType !== "mouse") return;
          mouse.current = e.clientX;
          kick();
        }}
        onPointerLeave={() => {
          mouse.current = null;
          kick();
        }}
      >
        <div ref={bg} aria-hidden className="dock-glass absolute inset-0 origin-center rounded-[22px] md:rounded-[24px]" />
        {items.map((it, i) => {
          const on = current === it.key;
          const tile = (
            <>
              <span
                ref={(el) => {
                  tips.current[i] = el;
                }}
                className="dock-tip"
                role="tooltip"
              >
                {it.label}
              </span>
              <span
                ref={(el) => {
                  tiles.current[i] = el;
                }}
                className={`dock-tile bg-gradient-to-b ${it.tint}`}
              >
                {it.icon}
              </span>
              <span className={`dock-dot ${on ? "opacity-100" : "opacity-0"}`} aria-hidden />
            </>
          );
          return (
            <div
              key={it.key}
              ref={(el) => {
                slots.current[i] = el;
              }}
              className="dock-slot relative"
              data-active={on || undefined}
            >
              {it.href ? (
                <Link href={it.href} className="dock-btn group" aria-label={it.label} aria-current={on ? "page" : undefined} data-testid={`dock-${it.key}`}>
                  {tile}
                </Link>
              ) : (
                <button type="button" onClick={it.go} className="dock-btn group" aria-label={it.label} aria-current={on ? "true" : undefined} data-testid={`dock-${it.key}`}>
                  {tile}
                </button>
              )}
            </div>
          );
        })}
        <div ref={tail} className="relative flex items-end gap-1.5 md:gap-2">
          <span aria-hidden className="mx-0.5 mb-1.5 h-9 w-px self-end bg-white/20 md:mx-1 md:h-10" />
          <div className="mb-0.5 hidden md:block">
            <DownloadCTA size="sm" menu="up" testId="dock-download" />
          </div>
          <div className="mb-0.5 md:hidden">
            <DownloadCTA size="sm" menu="up" compact testId="dock-download-m" />
          </div>
        </div>
      </div>
    </nav>
  );
}
