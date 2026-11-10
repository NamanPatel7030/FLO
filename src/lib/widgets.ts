// Notch widgets: which widgets appear in the notch panel and in what order.
// The choice is persisted to localStorage so the Settings window and the island window agree.
// Writes broadcast two ways: the native `storage` event (fires in OTHER windows — e.g. the
// island reacts when Settings changes it) plus a same-window `flo:widgets` CustomEvent (the
// `storage` event never fires in the window that wrote it). Both the island and Settings
// subscribe via onWidgetsChange so the panel reflects edits live.
import { loadZones, ZONES_EVENT, ZONES_KEY } from "./timezones";

export type WidgetId = "nowPlaying" | "today" | "timer" | "pomodoro" | "clock" | "weather" | "agents" | "note" | "agenda";

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
  { id: "nowPlaying", label: "Now Playing", hint: "Artwork, progress, transport controls and volume", span: 2, h: 148 },
  { id: "agents", label: "Claude sessions", hint: "Live Claude Code sessions — scroll, hover to expand", span: 2, h: 132 },
  { id: "note", label: "Quick note", hint: "A scratch note, saved on this device", span: 2, h: 92 },
  { id: "agenda", label: "Today's agenda", hint: "Your next Google Calendar meetings, with a Join link", span: 2, h: 132 },
  { id: "today", label: "Today's to-dos", hint: "Check off tasks, see why each is here — scroll, hover to expand", span: 2, h: 148 },
  { id: "timer", label: "Stopwatch", hint: "A simple count-up timer", span: 1, h: 96 },
  { id: "pomodoro", label: "Pomodoro", hint: "A 25-minute focus countdown", span: 1, h: 96 },
  { id: "clock", label: "Clock & date", hint: "The time, today's date and other time zones", span: 1, h: 96 },
  { id: "weather", label: "Weather", hint: "Local conditions (coming soon)", span: 1, h: 96 },
];

export const WIDGET_META: Record<WidgetId, WidgetMeta> = Object.fromEntries(WIDGETS.map((w) => [w.id, w])) as Record<WidgetId, WidgetMeta>;

/** Height of one extra time-zone row in the clock tile, and the tile's padding around them. */
export const ZONE_ROW_H = 20;
const ZONE_PAD = 22;

/** Columns a widget takes right now. The clock widens to a full row once world-clock zones are added. */
export function widgetSpan(id: WidgetId, zoneCount = id === "clock" ? loadZones().length : 0): 1 | 2 {
  if (id === "clock" && zoneCount > 0) return 2;
  return WIDGET_META[id]?.span ?? 1;
}

/** Tile height right now (the clock grows with its zone list). */
export function widgetHeight(id: WidgetId, zoneCount = id === "clock" ? loadZones().length : 0): number {
  const base = WIDGET_META[id]?.h ?? 96;
  if (id === "clock" && zoneCount > 0) return Math.max(base, ZONE_PAD + zoneCount * ZONE_ROW_H);
  return base;
}

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
// Clock zone edits fire it too (with a fresh array): they change the clock tile's size, and the
// island re-measures the panel from the list it receives.
export function onWidgetsChange(cb: (ids: WidgetId[]) => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === ZONES_KEY) cb(loadWidgets());
  };
  const onCustom = () => cb(loadWidgets());
  window.addEventListener("storage", onStorage);
  window.addEventListener("flo:widgets", onCustom as EventListener);
  window.addEventListener(ZONES_EVENT, onCustom as EventListener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("flo:widgets", onCustom as EventListener);
    window.removeEventListener(ZONES_EVENT, onCustom as EventListener);
  };
}

// ── panel layout ────────────────────────────────────────────────────────────
// The hover panel (one hover on the notch opens it): quick actions on top, the widget grid below.
// Laid out at base size (PANEL_W wide) and zoomed by Settings → Notch → Size.
/** Base width of the hover panel's black shape (logical px, before the notch-size scale). */
export const PANEL_W = 680;
/** Columns of the panel's widget grid: span-2 widgets take half a row, span-1 a quarter. */
export const PANEL_COLS = 4;
/** Side padding inside the panel. */
export const PANEL_PAD_X = 12;
export const GAP = 8; // grid gap (matches gap-2)
const PAD_TOP = 4; // pt-1
const PAD_BOTTOM = 12; // pb-3
/** The quick-actions row at the top of the panel (tile height). */
export const QUICK_H = 54;
/** "Add widgets" tile when the user turned every widget off. */
export const EMPTY_WIDGETS_H = 64;
/** Max body height (base px) before the widget grid scrolls (keeps the panel on screen). */
export const PANEL_BODY_MAX = 600;

export interface PanelCell {
  id: WidgetId;
  /** columns taken in the PANEL_COLS grid (a row's leftover columns are shared evenly) */
  span: number;
}
export interface PanelRow {
  cells: PanelCell[];
  h: number;
}

/** Pack widgets into rows of the panel's 4-column grid (in order). A row's free columns are shared
 *  evenly between its tiles, so every row is full width and no tile is stretched. */
export function packPanelRows(ids: WidgetId[], cols: number = PANEL_COLS): PanelRow[] {
  const rows: PanelRow[] = [];
  let cur: PanelCell[] = [];
  let used = 0;
  const flush = () => {
    if (!cur.length) return;
    // share the free columns evenly (smallest tiles first) so no single tile is stretched wide
    let free = cols - used;
    while (free > 0) {
      let k = 0;
      for (let j = 1; j < cur.length; j++) if (cur[j].span < cur[k].span) k = j;
      cur[k] = { ...cur[k], span: cur[k].span + 1 };
      free--;
    }
    rows.push({ cells: cur, h: Math.max(...cur.map((c) => widgetHeight(c.id))) });
    cur = [];
    used = 0;
  };
  for (const id of ids) {
    const span = Math.min(cols, widgetSpan(id));
    if (used + span > cols) flush();
    cur.push({ id, span });
    used += span;
    if (used === cols) flush();
  }
  flush();
  return rows;
}

/** Height of the widget grid alone (no quick row / padding). */
export function panelGridHeight(ids: WidgetId[]): number {
  const rows = packPanelRows(ids);
  if (!rows.length) return EMPTY_WIDGETS_H;
  return rows.reduce((h, r, i) => h + r.h + (i > 0 ? GAP : 0), 0);
}

/** Pack widgets into rows of a 2-column grid: span-2 widgets take their own row, span-1 pair up. */
export function packWidgetRows(ids: WidgetId[]): WidgetId[][] {
  const rows: WidgetId[][] = [];
  let cur: WidgetId[] = [];
  for (const id of ids) {
    const span = widgetSpan(id);
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

/** Exact height of the hover panel body (below the notch row): quick actions + widget grid,
 *  capped at PANEL_BODY_MAX (the grid scrolls beyond that). */
export function widgetsBodyHeight(ids: WidgetId[]): number {
  const h = PAD_TOP + QUICK_H + GAP + panelGridHeight(ids) + PAD_BOTTOM;
  return Math.round(Math.min(PANEL_BODY_MAX, h));
}

/** Max height of the scrollable widget grid inside the panel body. */
export const panelGridMax = () => PANEL_BODY_MAX - PAD_TOP - QUICK_H - GAP - PAD_BOTTOM;
