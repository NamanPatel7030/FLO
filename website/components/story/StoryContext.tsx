"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { CHAPTERS, WIDGETS, type ChapterId } from "./chapters";

/** What the visitor has done in the live demo. Only read while that chapter is under manual control, unless noted. */
export type Demo = {
  /** custom chapter; `color` is kept everywhere in the notch once chosen */
  custom: { style: number; size: number; sound: number; color: number };
  lang: number;
  prompt: number;
  learned: "pending" | "undone" | "kept";
  todos: boolean[];
  deadline: number;
  reminder: "ring" | "snoozed" | "done";
  claude: "ask" | "allowed" | "denied";
  opened: boolean;
  /** kept across the loop */
  widgets: boolean[];
  /** kept across the loop */
  playing: boolean;
};

export const DEFAULT_DEMO: Demo = {
  custom: { style: 0, size: 1, sound: 0, color: 0 },
  lang: 0,
  prompt: 0,
  learned: "pending",
  todos: [false, false, false],
  deadline: 0,
  reminder: "ring",
  claude: "ask",
  opened: false,
  widgets: WIDGETS.map((_, i) => i < 4),
  playing: true,
};

/** Resolved values for drawing a chapter at a phase: the loop's when auto-playing, the visitor's when they are driving. */
export type Derived = Omit<Demo, "custom" | "widgets"> & { style: number; size: number; sound: number; color: number; widgets: boolean[] };

export function derive(id: ChapterId | "idle", phase: number, cycle: number, d: Demo, manual: boolean): Derived {
  const auto = !manual;
  return {
    ...d,
    lang: auto ? cycle % 3 : d.lang,
    prompt: auto ? 0 : d.prompt,
    learned: auto ? "pending" : d.learned,
    todos: auto ? [id === "todos" && phase === 2, false, false] : d.todos,
    deadline: auto ? 0 : d.deadline,
    reminder: auto ? "ring" : d.reminder,
    claude: auto ? "ask" : d.claude,
    opened: auto ? false : d.opened,
    style: auto && id === "custom" ? phase : d.custom.style,
    size: auto && id === "custom" ? ([0, 1, 2, 3, 1][phase] ?? 1) : d.custom.size,
    sound: auto && id === "custom" ? phase % 4 : d.custom.sound,
    color: d.custom.color,
    widgets: d.widgets,
  };
}

type Step = [phase: number, ms?: number];

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
  /** chapter the visitor is driving (auto-loop paused), or -1 */
  manual: number;
  demo: Demo;
  setDemo: (patch: Partial<Demo> | ((d: Demo) => Partial<Demo>)) => void;
  /** take over chapter `i` (pauses its loop; resumes ~8 s after the last interaction) */
  interact: (i: number, extraMs?: number) => void;
  /** jump chapter `i` to `phase`; `bump` restarts typing animations */
  setPhase: (i: number, phase: number, bump?: boolean) => void;
  /** play a short scripted sequence of phases on chapter `i` */
  play: (i: number, steps: Step[]) => void;
};

const Ctx = createContext<Story | null>(null);

export function useStory() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStory outside StoryProvider");
  return s;
}

/** Everything needed to draw chapter `i`: phase (live loop, visitor-driven, or still frame) and resolved demo values. */
export function usePhase(i: number) {
  const { active, loop, reduce, manual, demo } = useStory();
  const mine = loop.ch === i;
  const driven = active === i && mine && (manual === i || !reduce);
  const phase = driven ? loop.phase : active === i && !reduce ? 0 : CHAPTERS[i].still;
  const cycle = driven ? loop.cycle : 0;
  const isManual = manual === i && active === i;
  return { phase, cycle, live: driven, isActive: active === i, manual: isManual, d: derive(CHAPTERS[i].id, phase, cycle, demo, isManual) };
}

const MQ = "(min-width: 768px)";
const IDLE_MS = 8000;

export function StoryProvider({ children }: { children: ReactNode }) {
  // read after mount so server and first client render agree (no hydration mismatch)
  const prefersReduced = !!useReducedMotion();
  const [reduce, setReduce] = useState(false);
  useEffect(() => setReduce(prefersReduced), [prefersReduced]);
  const storyRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const [loop, setLoop] = useState({ ch: 0, phase: 0, cycle: 0 });
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const [manual, setManualState] = useState(-1);
  const manualRef = useRef(-1);
  const setManual = useCallback((i: number) => {
    manualRef.current = i;
    setManualState(i);
  }, []);
  const [demo, setDemoState] = useState<Demo>(DEFAULT_DEMO);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = useRef<ReturnType<typeof setTimeout>[]>([]);
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

  const clearSeq = () => {
    seq.current.forEach(clearTimeout);
    seq.current = [];
  };
  // forget transient demo state when the loop takes back over
  const release = useCallback(() => {
    clearSeq();
    setManual(-1);
    setDemoState((d) => ({ ...d, learned: "pending", reminder: "ring", claude: "ask", opened: false, todos: [false, false, false] }));
  }, [setManual]);

  // New chapter: restart its loop, drop any visitor control.
  useEffect(() => {
    // (on mobile, touching a chapter's demo makes it the active one: keep that visitor's control)
    if (manualRef.current === active) return;
    setLoop({ ch: active, phase: 0, cycle: 0 });
    clearTimeout(idle.current);
    release();
  }, [active, release]);

  // Phase loop for the active chapter (paused while the visitor drives it).
  useEffect(() => {
    if (active < 0 || reduce || manual === active) return;
    const durations = CHAPTERS[active].phases;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const cur = loopRef.current.ch === active ? loopRef.current.phase : 0;
      t = setTimeout(() => {
        setLoop((l) => {
          if (l.ch !== active) return { ch: active, phase: 0, cycle: 0 };
          const p = (l.phase + 1) % durations.length;
          return { ch: active, phase: p, cycle: l.cycle + (p === 0 ? 1 : 0) };
        });
        tick();
      }, durations[cur] ?? durations[0]);
    };
    tick();
    return () => clearTimeout(t);
  }, [active, reduce, manual]);

  useEffect(() => () => clearTimeout(idle.current), []);

  const interact = useCallback(
    (i: number, extraMs = 0) => {
      setManual(i);
      if (!pinned) setActive(i);
      clearTimeout(idle.current);
      // under reduced motion there is no loop to hand back to: the visitor's state simply stays
      if (!reduce) idle.current = setTimeout(release, IDLE_MS + extraMs);
    },
    [reduce, release, pinned, setManual],
  );

  const setPhase = useCallback((i: number, phase: number, bump = false) => {
    setLoop((l) => ({ ch: i, phase, cycle: l.ch === i ? l.cycle + (bump ? 1 : 0) : 0 }));
  }, []);

  const play = useCallback(
    (i: number, steps: Step[]) => {
      clearSeq();
      const total = steps.reduce((a, [, ms]) => a + (ms ?? 0), 0);
      interact(i, total);
      let at = 0;
      steps.forEach(([p, ms], k) => {
        const run = () => setPhase(i, p, k === 0);
        if (k === 0) run();
        else seq.current.push(setTimeout(run, at));
        at += ms ?? 0;
      });
    },
    [interact, setPhase],
  );

  const setDemo = useCallback((patch: Partial<Demo> | ((d: Demo) => Partial<Demo>)) => {
    setDemoState((d) => ({ ...d, ...(typeof patch === "function" ? patch(d) : patch) }));
  }, []);

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

  const value = useMemo(
    () => ({ active, loop, reduce, pinned, storyRef, goTo, manual, demo, setDemo, interact, setPhase, play }),
    [active, loop, reduce, pinned, goTo, manual, demo, setDemo, interact, setPhase, play],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
