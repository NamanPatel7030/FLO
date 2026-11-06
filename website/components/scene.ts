"use client";

import { useEffect, useRef } from "react";

// The notch "spine" performs one scene at a time. Docked sections report which scene is on screen.
export type Scene = "idle" | "dictation" | "assistant" | "meeting" | "agent" | "todos";

export const SCENES: { id: Scene; label: string }[] = [
  { id: "idle", label: "Flo" },
  { id: "dictation", label: "Dictation" },
  { id: "assistant", label: "Assistant" },
  { id: "meeting", label: "Meetings" },
  { id: "agent", label: "Agents" },
  { id: "todos", label: "To-dos" },
];

const EVT = "flo-scene";

export function emitScene(s: Scene, live?: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVT, { detail: { scene: s, live } }));
}

export function onScene(cb: (s: Scene, live?: string) => void) {
  const h = (e: Event) => {
    const d = (e as CustomEvent).detail as { scene: Scene; live?: string };
    cb(d.scene, d.live);
  };
  window.addEventListener(EVT, h);
  return () => window.removeEventListener(EVT, h);
}

/** Attach to a section; when it crosses the middle of the viewport, the notch switches to `scene`. */
export function useSceneDock<T extends HTMLElement>(scene: Scene, live?: string) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) emitScene(scene, live);
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [scene, live]);
  return ref;
}
