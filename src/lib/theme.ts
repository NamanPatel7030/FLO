// Theme + accent engine. Sets `data-theme` (dark/light) and accent CSS vars on :root, so the whole
// app (buttons, toggles, focus rings, waveform, notch) recolors from one place. Shared by the
// dashboard and island windows; changes sync across windows via a `storage` ping.
import type { Settings, ThemeMode } from "./types";

export const DEFAULT_ACCENT = "#3dbbff";

export function normalizeHex(hex: string): string {
  let h = (hex || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return DEFAULT_ACCENT;
  return "#" + h.toLowerCase();
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex).slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + toHex(r) + toHex(g) + toHex(b);
}

/** Mix a hex toward white (amount > 0) or black (amount < 0), amount in [-1, 1]. */
export function mix(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = amount >= 0 ? 255 : 0;
  const k = Math.abs(amount);
  return rgbToHex(r + (t - r) * k, g + (t - g) * k, b + (t - b) * k);
}

export const lighten = (hex: string, amt: number) => mix(hex, Math.abs(amt));
export const darken = (hex: string, amt: number) => mix(hex, -Math.abs(amt));

/** Two-stop gradient for the notch: explicit notchGradient, else derived from the accent. */
export function deriveGradient(settings: Pick<Settings, "accent" | "notchGradient">): [string, string] {
  const g = settings.notchGradient;
  if (Array.isArray(g) && g.length === 2 && g[0] && g[1]) return [normalizeHex(g[0]), normalizeHex(g[1])];
  const a = normalizeHex(settings.accent || DEFAULT_ACCENT);
  return [darken(a, 0.18), lighten(a, 0.3)];
}

export function resolveTheme(mode: ThemeMode): "dark" | "light" {
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  // system
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return "dark";
}

/** Apply theme + accent vars to :root. Safe to call repeatedly. */
export function applyTheme(settings: Pick<Settings, "theme" | "accent" | "notchGradient">): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(settings.theme ?? "dark");

  const accent = normalizeHex(settings.accent || DEFAULT_ACCENT);
  const [gf, gt] = deriveGradient(settings);
  const set = (k: string, v: string) => root.style.setProperty(k, v);
  const rgb = (hex: string) => hexToRgb(hex).join(" ");
  set("--accent", accent);
  set("--accent-rgb", rgb(accent));
  set("--accent-2", lighten(accent, 0.32));
  set("--accent-2-rgb", rgb(lighten(accent, 0.32)));
  set("--accent-soft", lighten(accent, 0.6));
  set("--accent-soft-rgb", rgb(lighten(accent, 0.6)));
  set("--accent-deep", darken(accent, 0.22));
  set("--accent-grad-from", gf);
  set("--accent-grad-to", gt);
}

/** Call cb when the OS light/dark preference changes (only matters while theme = system). */
export function watchSystemTheme(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const h = () => cb();
  mq.addEventListener?.("change", h);
  return () => mq.removeEventListener?.("change", h);
}

const SYNC_KEY = "flo:settings-rev";

/** Ping other windows (island ↔ dashboard share localStorage origin in Tauri) that settings changed. */
export function broadcastSettings(): void {
  try {
    localStorage.setItem(SYNC_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/** Listen for settings changes made in another window. */
export function onSettingsBroadcast(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const h = (e: StorageEvent) => {
    if (e.key === SYNC_KEY) cb();
  };
  window.addEventListener("storage", h);
  return () => window.removeEventListener("storage", h);
}
