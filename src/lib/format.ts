import type { IslandGeometry, Todo } from "./types";

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
}

export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function formatNumber(n: number): string {
  const trim = (x: number) => (x >= 10 ? Math.round(x).toString() : x.toFixed(1).replace(/\.0$/, ""));
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 1000) return `${trim(n / 1000)}k`;
  return String(Math.round(n));
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function greeting(hour: number): string {
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 22) return "Good evening";
  return "Working late";
}

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface TodoGroups {
  today: Todo[];
  upcoming: Todo[];
  screen: Todo[];
  done: Todo[];
}

/** Open attention items go to "screen"; open with future due → upcoming; other open → today. */
export function groupTodos(todos: Todo[], now: Date = new Date()): TodoGroups {
  const today = localDay(now);
  const g: TodoGroups = { today: [], upcoming: [], screen: [], done: [] };
  for (const t of todos) {
    if (t.status === "done") g.done.push(t);
    else if (t.status !== "open") continue;
    else if (t.source === "attention") g.screen.push(t);
    else if (t.due && t.due.slice(0, 10) > today) g.upcoming.push(t);
    else g.today.push(t);
  }
  return g;
}

export type IslandVariant = "collapsed" | "peek" | "listening" | "working" | "done" | "error" | "meeting" | "meetingExpanded" | "card" | "claude";

/** Width of each live-activity wing beside the notch (logical px). */
export const ISLAND_WING = 46;
/** Concave "ear" that flares the island into the menu bar. */
export const ISLAND_EAR = 8;

/** Window size (logical px) needed for each island variant. Includes room for the shadow. */
export interface CardContent {
  replyChars: number;
  results: number;
}

/** Height of the assistant card body (below the notch) for given content. */
function cardBody(c: CardContent | undefined, charsPerLine: number): number {
  if (!c) return 228;
  const lines = Math.min(5, Math.max(1, Math.ceil(c.replyChars / charsPerLine)));
  return Math.min(228, 62 + lines * 19 + (c.results > 0 ? 34 : 0));
}

export function islandSize(variant: IslandVariant, geo: IslandGeometry, content?: CardContent): { width: number; height: number } {
  const notch = geo.platform === "macos" && geo.hasNotch;
  const nw = notch ? geo.notchWidth : 0;
  const nh = notch ? geo.notchHeight : 0;
  if (notch) {
    switch (variant) {
      case "collapsed":
        return { width: nw, height: nh };
      case "peek":
        return { width: nw + 160, height: nh + 52 };
      case "listening":
      case "working":
      case "done":
        return { width: nw + 2 * (ISLAND_WING + ISLAND_EAR), height: nh };
      case "error":
        return { width: nw + 2 * (ISLAND_WING + ISLAND_EAR) + 120, height: nh + 30 };
      case "meeting":
        return { width: nw + 260, height: nh + 34 };
      case "meetingExpanded":
        return { width: 520, height: nh + 160 };
      case "card":
        return { width: 520, height: nh + cardBody(content, 62) };
      case "claude":
        return { width: 460, height: nh + 118 };
    }
  }
  // floating capsule (Windows / no notch). Padding 24 for shadow.
  const pad = 24;
  switch (variant) {
    case "collapsed":
      return { width: 64 + pad, height: 40 + pad };
    case "peek":
      return { width: 248 + pad, height: 48 + pad };
    case "listening":
    case "working":
    case "done":
      return { width: 248 + pad, height: 48 + pad };
    case "error":
      return { width: 320 + pad, height: 48 + pad };
    case "meeting":
      return { width: 340 + pad, height: 64 + pad };
    case "meetingExpanded":
      return { width: 440 + pad, height: 240 + pad };
    case "card":
      return { width: 440 + pad, height: Math.min(240, cardBody(content, 52) + 12) + pad };
    case "claude":
      return { width: 380 + pad, height: 128 + pad };
  }
}

/** Per-bar smoothed waveform. `t` is a phase offset (time) for organic variation. */
export function smoothLevels(prev: number[], rms: number, t: number): number[] {
  const n = prev.length;
  // sqrt curve: quiet speech (rms ~0.05–0.2) still moves the bars visibly
  const level = Math.min(1, Math.sqrt(Math.max(0, rms)) * 1.25);
  return prev.map((p, i) => {
    const center = 1 - Math.abs(i - (n - 1) / 2) / (n / 2); // taller in middle
    const wobble = 0.55 + 0.45 * Math.sin(t * 7 + i * 1.3) * Math.cos(t * 3.1 + i * 0.7);
    const target = Math.min(1, level * (0.35 + 0.65 * center) * (0.6 + 0.4 * Math.abs(wobble)));
    const k = target > p ? 0.55 : 0.18; // fast attack, slow release
    return Math.min(1, Math.max(0, p + (target - p) * k));
  });
}
