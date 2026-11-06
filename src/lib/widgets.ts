// Notch widgets: which widgets appear in the notch panel and in what order.
// The choice is persisted to localStorage so the Settings window and the island window agree.
// Writes broadcast two ways: the native `storage` event (fires in OTHER windows — e.g. the
// island reacts when Settings changes it) plus a same-window `flo:widgets` CustomEvent (the
// `storage` event never fires in the window that wrote it). Both the island and Settings
// subscribe via onWidgetsChange so the panel reflects edits live.

export type WidgetId = "nowPlaying" | "today" | "timer" | "pomodoro" | "clock" | "weather" | "agents" | "note";

export interface WidgetMeta {
  id: WidgetId;
  label: string;
  hint: string;
  /** columns taken in the 2-column grid */
  span: 1 | 2;
  /** tile height in px (used to size the notch window exactly) */
  h: number;
}

/** Every widget Flo offers, in the order they appear in the Settings picker. */
export const WIDGETS: WidgetMeta[] = [
  { id: "nowPlaying", label: "Now Playing", hint: "Track, transport controls and volume", span: 2, h: 78 },
  { id: "agents", label: "Claude sessions", hint: "Live Claude Code sessions — scroll, hover to expand", span: 2, h: 132 },
  { id: "note", label: "Quick note", hint: "A scratch note, saved on this device", span: 2, h: 92 },
  { id: "today", label: "Today's to-dos", hint: "Check off tasks, see why each is here — scroll, hover to expand", span: 2, h: 148 },
  { id: "timer", label: "Stopwatch", hint: "A simple count-up timer", span: 1, h: 96 },
  { id: "pomodoro", label: "Pomodoro", hint: "A 25-minute focus countdown", span: 1, h: 96 },
  { id: "clock", label: "Clock & date", hint: "The time and today's date", span: 1, h: 96 },
  { id: "weather", label: "Weather", hint: "Local conditions (coming soon)", span: 1, h: 96 },
];

export const WIDGET_META: Record<WidgetId, WidgetMeta> = Object.fromEntries(WIDGETS.map((w) => [w.id, w])) as Record<WidgetId, WidgetMeta>;

/** What a fresh install shows until the user customises it. */
export const DEFAULT_WIDGETS: WidgetId[] = ["nowPlaying", "today", "timer", "clock"];

const KEY = "flo.widgets";

function sanitize(ids: unknown): WidgetId[] | null {
  if (!Array.isArray(ids)) return null;
  const seen = new Set<string>();
  const out: WidgetId[] = [];
  for (const x of ids) {
    if (typeof x === "string" && x in WIDGET_META && !seen.has(x)) {
      seen.add(x);
      out.push(x as WidgetId);
    }
  }
  return out;
}

export function loadWidgets(): WidgetId[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [...DEFAULT_WIDGETS];
    const ids = sanitize(JSON.parse(raw));
    // an empty list is a valid choice (user turned everything off)
    return ids ?? [...DEFAULT_WIDGETS];
  } catch {
    return [...DEFAULT_WIDGETS];
  }
}

export function saveWidgets(ids: WidgetId[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable — keep going, the custom event still notifies this window */
  }
  try {
    window.dispatchEvent(new CustomEvent("flo:widgets", { detail: ids }));
  } catch {
    /* no window (tests) */
  }
}

/** Subscribe to widget-list changes from this window or any other. Returns an unsubscribe fn. */
export function onWidgetsChange(cb: (ids: WidgetId[]) => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb(loadWidgets());
  };
  const onCustom = () => cb(loadWidgets());
  window.addEventListener("storage", onStorage);
  window.addEventListener("flo:widgets", onCustom as EventListener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("flo:widgets", onCustom as EventListener);
  };
}

// ── panel layout ────────────────────────────────────────────────────────────
const GAP = 8; // grid gap (matches gap-2)
const PAD_TOP = 4; // pt-1
const PAD_BOTTOM = 12; // pb-3
const QUICK_H = 46; // the quick-actions row pinned at the bottom

/** Pack widgets into rows of a 2-column grid: span-2 widgets take their own row, span-1 pair up. */
export function packWidgetRows(ids: WidgetId[]): WidgetId[][] {
  const rows: WidgetId[][] = [];
  let cur: WidgetId[] = [];
  for (const id of ids) {
    const span = WIDGET_META[id]?.span ?? 1;
    if (span === 2) {
      if (cur.length) {
        rows.push(cur);
        cur = [];
      }
      rows.push([id]);
    } else {
      cur.push(id);
      if (cur.length === 2) {
        rows.push(cur);
        cur = [];
      }
    }
  }
  if (cur.length) rows.push(cur);
  return rows;
}

/** Exact height of the panel body (below the notch spacer) for a given widget list. */
export function widgetsBodyHeight(ids: WidgetId[]): number {
  const rows = packWidgetRows(ids);
  let h = PAD_TOP + PAD_BOTTOM;
  rows.forEach((row, i) => {
    const rowH = Math.max(...row.map((id) => WIDGET_META[id]?.h ?? 96));
    h += rowH + (i > 0 ? GAP : 0);
  });
  // the quick-actions row is always present
  h += (rows.length ? GAP : 0) + QUICK_H;
  return Math.round(h);
}
