import type { ClaudeSession, ClaudeStatus, HotkeyCombo, IslandGeometry, Todo } from "./types";

const URGENCY: Record<ClaudeStatus, number> = { needs_approval: 0, waiting_reply: 1, done: 2, working: 3 };
/** Most urgent first: needs_approval > waiting_reply > done > working; newest first within a status. */
export function sessionsByUrgency(list: ClaudeSession[]): ClaudeSession[] {
  return [...list].sort((a, b) => (URGENCY[a.status] ?? 9) - (URGENCY[b.status] ?? 9) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

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

/** Parse backend timestamps safely: WebKit can misread >3 fractional-second digits. */
export function parseTime(iso: string): number {
  return new Date(iso.replace(/(\.\d{3})\d+/, "$1")).getTime();
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = Math.max(0, (now - parseTime(iso)) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function timeOfDay(iso: string): string {
  return new Date(parseTime(iso)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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

export type IslandVariant =
  | "collapsed"
  | "peek"
  | "widgets"
  | "agent"
  | "listening"
  | "working"
  | "done"
  | "result"
  | "error"
  | "history"
  | "meeting"
  | "meetingExpanded"
  | "card"
  | "claude"
  | "reminder"
  | "tray"
  | "trayTooltip"
  | "correction"
  | "meetingPrompt"
  | "confirm";

// ── hotkeys + statuses ───────────────────────────────────────────────────────
export const HOTKEY_OPTIONS: HotkeyCombo[] = ["fn", "ctrl", "alt", "fn+ctrl", "ctrl+alt", "cmd+alt", "fn+shift"];
const KEY_SYM: Record<string, string> = { fn: "fn", ctrl: "⌃", alt: "⌥", cmd: "⌘", shift: "⇧" };
const KEY_WORD: Record<string, string> = { fn: "fn", ctrl: "control", alt: "option", cmd: "command", shift: "shift" };
/** "fn+ctrl" → "fn + ⌃" (keycap symbols) */
export const formatHotkey = (c: string) => c.split("+").map((k) => KEY_SYM[k] ?? k).join(" + ");
/** "fn+ctrl" → "fn + control" (spoken / hint copy) */
export const hotkeyWords = (c: string) => c.split("+").map((k) => KEY_WORD[k] ?? k).join(" + ");

export function claudeStatusLabel(s: ClaudeStatus): string {
  switch (s) {
    case "working":
      return "Working";
    case "done":
      return "Done, ready for review";
    case "waiting_reply":
      return "Waiting for your reply";
    case "needs_approval":
      return "Needs approval";
  }
}

// ── notch tray geometry ──────────────────────────────────────────────────────
/** Spacing per tray item (20px avatar + 4px gap). */
export const TRAY_SLOT = 24;
const TRAY_PAD_IN = 8; // gap between camera notch and first item
const TRAY_PAD_OUT = 10; // gap between last item and wing edge
const TRAY_MIN_WING = 30;
/** Hover swell: grow each side by this much. */
export const SWELL_X = 6;
export const SWELL_Y = 3;
/** Extra transparent room below a swollen island so the glow isn't clipped. */
const GLOW_ROOM = 8;
export const TRAY_TIP_W = 340;
export const TRAY_TIP_H = 118;
const TRAY_TIP_GAP = 8;
/** Row height in the all-sessions list tooltip. */
export const TRAY_LIST_ROW = 36;
/** Tooltip height: single item card, or a list of `rows` sessions (max 6 visible). */
/** session list: header 38 + rows (max 6, then scroll) + footer 32 ("Clear done") */
export const trayTipHeight = (rows?: number) => (rows ? 38 + Math.min(rows, 6) * TRAY_LIST_ROW + 38 : TRAY_TIP_H);

export interface TraySlot {
  side: "left" | "right";
  /** index within its side, 0 = nearest the notch */
  index: number;
  /** horizontal centre relative to the window centre (logical px) */
  cx: number;
}

const wingFor = (n: number) => (n > 0 ? TRAY_PAD_IN + n * TRAY_SLOT - 4 + TRAY_PAD_OUT : 0);

/** Layout of tray items in the wings beside the notch. Window is centred on the notch. */
export function trayLayout(geo: IslandGeometry, nLeft: number, nRight: number): { width: number; height: number; wing: number; slots: TraySlot[] } {
  const nw = geo.notchWidth;
  const wing = Math.max(TRAY_MIN_WING, wingFor(nLeft), wingFor(nRight));
  const slots: TraySlot[] = [];
  for (let i = 0; i < nLeft; i++) slots.push({ side: "left", index: i, cx: -(nw / 2 + TRAY_PAD_IN + 10 + i * TRAY_SLOT) });
  for (let i = 0; i < nRight; i++) slots.push({ side: "right", index: i, cx: nw / 2 + TRAY_PAD_IN + 10 + i * TRAY_SLOT });
  return { width: nw + 2 * (wing + ISLAND_EAR), height: geo.notchHeight, wing, slots };
}

/**
 * Which tray slot is under the cursor? `cx` = offset from the window's horizontal centre, which
 * stays stable while the window resizes (the island is always centred on the notch). -1 = none.
 */
export function hitTestTrayC(slots: TraySlot[], cx: number, y: number, nh: number, tol: number = TRAY_SLOT / 2): number {
  if (y < 0 || y > nh + 2) return -1;
  return slots.findIndex((s) => Math.abs(cx - s.cx) <= tol);
}

/** Window-relative variant (x from the left edge). */
export function hitTestTray(slots: TraySlot[], winW: number, x: number, y: number, nh: number): number {
  return hitTestTrayC(slots, x - winW / 2, y, nh);
}

/** Tooltip rect in centre-relative coordinates (left/right are offsets from the window centre). */
export function tipRectC(slotCx: number, nh: number, h: number = TRAY_TIP_H) {
  return { left: slotCx - TRAY_TIP_W / 2, right: slotCx + TRAY_TIP_W / 2, top: nh + TRAY_TIP_GAP, bottom: nh + TRAY_TIP_GAP + h };
}

/**
 * Tooltip hysteresis. Once item `prev` is open it stays open while the cursor is on it, on its
 * tooltip, or in the corridor between them; we only switch when another item is clearly hit
 * (inner tolerance), and only close when the cursor is elsewhere. Prevents open/close flicker.
 */
export function pickTip(prev: number, slots: TraySlot[], cx: number, y: number, nh: number, tipH: number = TRAY_TIP_H): number {
  const clear = hitTestTrayC(slots, cx, y, nh, TRAY_SLOT / 2 - 3);
  if (clear >= 0) return clear;
  if (prev >= 0 && slots[prev]) {
    const s = slots[prev];
    const r = tipRectC(s.cx, nh, tipH);
    const left = Math.min(r.left, s.cx - TRAY_SLOT / 2) - 6;
    const right = Math.max(r.right, s.cx + TRAY_SLOT / 2) + 6;
    if (cx >= left && cx <= right && y >= -2 && y <= r.bottom + 6) return prev;
    return -1;
  }
  return hitTestTrayC(slots, cx, y, nh);
}

/** Tooltip card under a tray item (window-relative). The window is sized to fit it centred. */
export function tooltipRect(winW: number, cx: number, nh: number, h: number = TRAY_TIP_H): { x: number; y: number; w: number; h: number } {
  const x = Math.min(Math.max(winW / 2 + cx - TRAY_TIP_W / 2, 8), Math.max(8, winW - TRAY_TIP_W - 8));
  return { x, y: nh + TRAY_TIP_GAP, w: TRAY_TIP_W, h };
}

/** Peek quick-action tile under (x, y)? Tiles share the pill width below the notch. */
export function peekTileAt(winW: number, pillW: number, x: number, y: number, nh: number, count: number): number {
  if (y < nh + 4) return -1;
  const left = (winW - pillW) / 2 + 12;
  const w = (pillW - 24) / count;
  const i = Math.floor((x - left) / w);
  return i >= 0 && i < count ? i : -1;
}

/** Does an error message point the user at Settings? → show a "Fix in Settings" button. */
export const wantsFix = (msg?: string) => !!msg && /settings|api key|model|permission|grant/i.test(msg);

/** Width of each live-activity wing beside the notch (logical px). */
export const ISLAND_WING = 46;
/** Concave "ear" that flares the island into the menu bar. */
export const ISLAND_EAR = 8;
/** Height of the status row that drops below the notch (listening / working). */
export const ISLAND_ROW = 30;
/** Line height of 13px text inside island dropdowns. */
export const ISLAND_LINE = 18;
/** Gap between notch bottom and first dropdown content. */
export const ISLAND_GAP = 6;

/** Content hints used to size cards so nothing is ever clipped. */
export interface CardContent {
  replyChars?: number;
  results?: number;
  /** characters of the error / result text */
  textChars?: number;
  /** history rows */
  rows?: number;
  /** error has a "Fix" action button */
  action?: boolean;
  /** tray items per wing */
  trayLeft?: number;
  trayRight?: number;
  /** tooltip anchor (slot cx) for trayTooltip */
  tipCx?: number;
  /** trayTooltip shows a list of this many sessions */
  tipRows?: number;
  /** hover swell (collapsed / tray) */
  swell?: boolean;
  /** exact body height for the widgets panel (depends on which widgets are enabled) */
  widgetBody?: number;
  /** number of streamed steps shown on the agent card */
  agentSteps?: number;
  /** agent card status (confirm/done/error/aborted change the body height) */
  agentDone?: boolean;
}

/** Height of the assistant card body (below the notch) for given content. */
function cardBody(c: CardContent | undefined, charsPerLine: number): number {
  // header + up to 4 reply lines + results + action row (Go deeper / Web / Open full answer)
  if (!c || c.replyChars === undefined) return 250;
  const lines = Math.min(4, Math.max(1, Math.ceil(c.replyChars / charsPerLine)));
  return Math.min(250, 62 + lines * 19 + ((c.results ?? 0) > 0 ? 34 : 0) + 34);
}

const lines = (chars: number | undefined, perLine: number, max: number) =>
  Math.min(max, Math.max(1, Math.ceil((chars ?? 0) / perLine)));

const HISTORY_ROW = 54;
const historyRows = (c?: CardContent) => Math.min(6, Math.max(1, c?.rows ?? 6));

export function islandSize(variant: IslandVariant, geo: IslandGeometry, content?: CardContent): { width: number; height: number } {
  const notch = geo.platform === "macos" && geo.hasNotch;
  const nw = notch ? geo.notchWidth : 0;
  const nh = notch ? geo.notchHeight : 0;
  if (notch) {
    const compact = nw + 2 * (ISLAND_WING + ISLAND_EAR);
    const tray = trayLayout(geo, content?.trayLeft ?? 0, content?.trayRight ?? 0);
    const hasTray = (content?.trayLeft ?? 0) + (content?.trayRight ?? 0) > 0;
    switch (variant) {
      case "collapsed":
        return content?.swell
          ? { width: nw + 2 * (SWELL_X + ISLAND_EAR), height: nh + SWELL_Y + GLOW_ROOM }
          : { width: nw, height: nh };
      case "tray":
        return content?.swell ? { width: tray.width + 2 * SWELL_X, height: nh + SWELL_Y + GLOW_ROOM } : { width: tray.width, height: nh };
      case "trayTooltip": {
        const cx = Math.abs(content?.tipCx ?? 0);
        const w = Math.max(tray.width, 2 * cx + TRAY_TIP_W + 16);
        return { width: w + (w % 2), height: nh + TRAY_TIP_GAP + trayTipHeight(content?.tipRows) + 8 };
      }
      // content cards: notch row empty, then ONE row (icon + text + actions)
      case "correction":
        return { width: 420, height: nh + ISLAND_GAP + 54 };
      case "meetingPrompt":
        return { width: 400, height: nh + ISLAND_GAP + 52 };
      case "confirm":
        return { width: 460, height: nh + ISLAND_GAP + 98 };
      case "peek":
        return { width: Math.max(nw + 2 * 160, hasTray ? tray.width : 0), height: nh + 54 };
      case "widgets":
        return { width: 380, height: nh + ISLAND_GAP + (content?.widgetBody ?? 232) };
      case "agent":
        // top gap + header row + bottom padding, then a taller body while running vs a one-line result
        return { width: 468, height: nh + 54 + (content?.agentDone ? 28 : 58) };
      // live states: icons only, flush with the notch (no text row)
      case "listening":
      case "working":
      case "done":
        return { width: compact, height: nh };
      case "result":
        // one line of pasted text + copy icon
        return { width: 440, height: nh + ISLAND_GAP + ISLAND_LINE + 20 };
      case "error":
        return {
          width: 420,
          height: nh + ISLAND_GAP + Math.max(28, lines(content?.textChars, 46, 3) * ISLAND_LINE) + 18,
        };
      case "history":
        // header 30 + rows + footer 34
        return { width: 460, height: nh + ISLAND_GAP + 30 + historyRows(content) * HISTORY_ROW + 34 };
      case "meeting":
        return { width: nw + 260, height: nh + 34 };
      case "meetingExpanded":
        return { width: 520, height: nh + 160 };
      case "card":
        return { width: 520, height: nh + cardBody(content, 62) };
      case "claude":
      case "reminder":
        return { width: 460, height: nh + ISLAND_GAP + 64 };
    }
  }
  // floating capsule (Windows / no notch). Padding 24 for shadow.
  const pad = 24;
  const items = (content?.trayLeft ?? 0) + (content?.trayRight ?? 0);
  switch (variant) {
    case "collapsed":
      return { width: 64 + pad + (content?.swell ? 8 : 0), height: 40 + pad + (content?.swell ? 4 : 0) };
    case "tray":
      return { width: Math.max(64, 28 + items * TRAY_SLOT) + pad + (content?.swell ? 8 : 0), height: 40 + pad };
    case "trayTooltip":
      return { width: Math.max(TRAY_TIP_W + 16, 28 + items * TRAY_SLOT) + pad, height: 40 + TRAY_TIP_GAP + trayTipHeight(content?.tipRows) + pad };
    case "correction":
      return { width: 400 + pad, height: 66 + pad };
    case "meetingPrompt":
      return { width: 380 + pad, height: 64 + pad };
    case "confirm":
      return { width: 440 + pad, height: 108 + pad };
    case "peek":
      return { width: 260 + pad, height: 52 + pad };
    case "widgets":
      return { width: 360 + pad, height: (content?.widgetBody ?? 232) + pad };
    case "agent":
      return { width: 420 + pad, height: (content?.agentDone ? 82 : 112) + pad };
    case "listening":
    case "working":
    case "done":
      return { width: 150 + pad, height: 40 + pad };
    case "result":
      return { width: 360 + pad, height: 26 + ISLAND_LINE + pad };
    case "error":
      return { width: 380 + pad, height: 24 + Math.max(28, lines(content?.textChars, 34, 4) * ISLAND_LINE) + pad };
    case "history":
      return { width: 400 + pad, height: 30 + historyRows(content) * HISTORY_ROW + 34 + 12 + pad };
    case "meeting":
      return { width: 340 + pad, height: 64 + pad };
    case "meetingExpanded":
      return { width: 440 + pad, height: 240 + pad };
    case "card":
      return { width: 440 + pad, height: Math.min(240, cardBody(content, 52) + 12) + pad };
    case "claude":
    case "reminder":
      return { width: 380 + pad, height: 74 + pad };
  }
}

/** Per-bar smoothed waveform. `t` is a phase offset (time) for organic variation. */
/** Group items by calendar day (local time): "Today", "Yesterday", then "Mon, 3 Nov". Newest first. */
export function groupByDay<T extends { createdAt: string }>(items: T[], now: Date = new Date()): { label: string; items: T[] }[] {
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const today = dayKey(now);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const yesterday = dayKey(y);
  const sorted = [...items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const groups: { key: string; label: string; items: T[] }[] = [];
  for (const it of sorted) {
    const d = new Date(it.createdAt);
    const k = dayKey(d);
    let g = groups[groups.length - 1];
    if (!g || g.key !== k) {
      const label = k === today ? "Today" : k === yesterday ? "Yesterday" : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
      g = { key: k, label, items: [] };
      groups.push(g);
    }
    g.items.push(it);
  }
  return groups.map(({ label, items }) => ({ label, items }));
}

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


/**
 * Island watchdog. True when the UI shows activity the backend no longer confirms:
 *  - "listening" (push-to-talk) but no mic level events for 6 s
 *  - transcribing / thinking with no state update for 45 s
 * Meetings are exempt (they're long and quiet by design).
 */
export function isStuck(
  phase: string,
  mode: string,
  msSinceState: number,
  msSinceLevel: number,
): boolean {
  if (mode === "meeting") return false;
  if (phase === "listening") return msSinceLevel > 6000 && msSinceState > 6000;
  if (phase === "transcribing" || phase === "thinking") return msSinceState > 45000;
  return false;
}
