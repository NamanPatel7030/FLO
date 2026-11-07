"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { CHAPTERS } from "./chapters";

type Story = {
  /** index of the chapter in view; -1 once the visitor has scrolled past the story */
  active: number;
  /** phase loop of the active chapter (cycle = how many times it restarted) */
  loop: { ch: number; phase: number; cycle: number };
  reduce: boolean;
  /** desktop: one pinned stage; mobile: chapters flow */
  pinned: boolean;
  storyRef: React.RefObject<HTMLDivElement | null>;
  goTo: (i: number) => void;
};

const Ctx = createContext<Story | null>(null);

export function useStory() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStory outside StoryProvider");
  return s;
}

/** Phase to draw for chapter `i`: the live one when active, otherwise its still frame. */
export function usePhase(i: number) {
  const { active, loop, reduce } = useStory();
  const live = active === i && !reduce;
  const mine = loop.ch === i;
  return { phase: live ? (mine ? loop.phase : 0) : CHAPTERS[i].still, cycle: live && mine ? loop.cycle : 0, live, isActive: active === i };
}

const MQ = "(min-width: 768px)";

export function StoryProvider({ children }: { children: ReactNode }) {
  // read after mount so server and first client render agree (no hydration mismatch)
  const prefersReduced = !!useReducedMotion();
  const [reduce, setReduce] = useState(false);
  useEffect(() => setReduce(prefersReduced), [prefersReduced]);
  const storyRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const [loop, setLoop] = useState({ ch: 0, phase: 0, cycle: 0 });
  // SSR + first paint assume desktop; corrected after mount (no window read during render)
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia(MQ);
    const on = () => setPinned(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Desktop: scroll position inside the tall story track picks the chapter (one per viewport height).
  useEffect(() => {
    if (!pinned) return;
    let raf = 0;
    const compute = () => {
      raf = 0;
      const el = storyRef.current;
      if (!el) return;
      const vh = window.innerHeight;
      const s = -el.getBoundingClientRect().top;
      const n = CHAPTERS.length;
      const next = s > (n - 1) * vh + vh * 0.55 ? -1 : Math.min(n - 1, Math.max(0, Math.round(s / vh)));
      setActive(next);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [pinned]);

  // Mobile: chapters flow; the one crossing the middle of the screen is active.
  useEffect(() => {
    if (pinned) return;
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-chapter]"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.chapter));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pinned]);

  // Phase loop for the active chapter.
  useEffect(() => {
    setLoop({ ch: active, phase: 0, cycle: 0 });
    if (active < 0 || reduce) return;
    const durations = CHAPTERS[active].phases;
    let p = 0;
    let c = 0;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      t = setTimeout(() => {
        p = (p + 1) % durations.length;
        if (p === 0) c += 1;
        setLoop({ ch: active, phase: p, cycle: c });
        tick();
      }, durations[p]);
    };
    tick();
    return () => clearTimeout(t);
  }, [active, reduce]);

  const goTo = useCallback(
    (i: number) => {
      const el = storyRef.current;
      if (!el) return;
      if (pinned) {
        const top = el.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: top + i * window.innerHeight, behavior: reduce ? "auto" : "smooth" });
      } else {
        document.querySelector(`[data-chapter="${i}"]`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      }
    },
    [pinned, reduce],
  );

  const value = useMemo(() => ({ active, loop, reduce, pinned, storyRef, goTo }), [active, loop, reduce, pinned, goTo]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
