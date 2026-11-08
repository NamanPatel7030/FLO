// Now Playing: one shared store for the notch's live music activity and the Now Playing widget.
// The backend pushes EV.nowPlaying whenever media starts / changes / pauses / stops; polling
// api.nowPlaying() stays as a fallback (fast until the first event arrives, slow after).
// Progress is interpolated locally from `elapsed` + `elapsedAt`, so nothing re-polls per second.
import { useEffect, useState, useSyncExternalStore } from "react";
import { api, on } from "./api";
import { EV, type NowPlaying } from "./types";

/** Poll interval before the backend has ever pushed an event. */
export const POLL_FAST_MS = 3000;
/** Poll interval once events are flowing (just a safety net). */
export const POLL_SLOW_MS = 15000;
/** Paused media keeps its (dimmed) live activity this long, then the notch lets go. */
export const PAUSE_HIDE_MS = 30_000;

export interface MediaSnapshot {
  np: NowPlaying | null;
  /** local ms when playback was first seen paused (0 while playing / nothing) */
  pausedSince: number;
}

/** Seconds into the track right now (interpolated while playing, clamped to the duration). */
export function elapsedNow(np: NowPlaying | null | undefined, now: number = Date.now()): number | undefined {
  if (!np || typeof np.elapsed !== "number" || !Number.isFinite(np.elapsed)) return undefined;
  let s = np.elapsed;
  if (np.playing && typeof np.elapsedAt === "number" && np.elapsedAt > 0) s += Math.max(0, now - np.elapsedAt) / 1000;
  if (typeof np.duration === "number" && np.duration > 0) s = Math.min(s, np.duration);
  return Math.max(0, s);
}

/** Should the collapsed notch show the music live activity? Playing → yes; paused → for 30 s. */
export function mediaVisible(s: MediaSnapshot, now: number = Date.now()): boolean {
  const np = s.np;
  if (!np || !(np.title || np.artist)) return false;
  if (np.playing) return true;
  return s.pausedSince > 0 && now - s.pausedSince < PAUSE_HIDE_MS;
}

/** True when two samples describe the same visible state (skips no-op re-renders). */
export function sameMedia(a: NowPlaying | null, b: NowPlaying | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.title === b.title &&
    a.artist === b.artist &&
    a.album === b.album &&
    a.app === b.app &&
    a.playing === b.playing &&
    a.duration === b.duration &&
    a.artwork === b.artwork &&
    a.appIcon === b.appIcon &&
    a.bundleId === b.bundleId &&
    // progress: same if the interpolated position agrees within a second
    Math.abs((elapsedNow(a) ?? 0) - (elapsedNow(b) ?? 0)) < 1
  );
}

// ── store ───────────────────────────────────────────────────────────────────
let snap: MediaSnapshot = { np: null, pausedSince: 0 };
const subs = new Set<() => void>();
let eventsSeen = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let offEvent: (() => void) | null = null;

function normalise(np: NowPlaying | null | undefined): NowPlaying | null {
  if (!np || typeof np !== "object" || !(np.title || np.artist)) return null;
  // stamp samples that carry no timestamp so local interpolation still works
  if (typeof np.elapsed === "number" && !(typeof np.elapsedAt === "number" && np.elapsedAt > 0)) return { ...np, elapsedAt: Date.now() };
  return np;
}

/** Feed a sample (event, poll or optimistic update) into the store. */
export function setNowPlaying(raw: NowPlaying | null | undefined) {
  const np = normalise(raw);
  const pausedSince = np && !np.playing ? snap.pausedSince || Date.now() : 0;
  if (sameMedia(snap.np, np) && pausedSince === snap.pausedSince) return;
  snap = { np, pausedSince };
  subs.forEach((f) => f());
}

/** fast polls before settling on the slow safety-net rate even if no event ever arrives
 *  (nothing playing → the backend never emits; polling every 3 s forever cost an IPC + an
 *  AppleScript round trip on the idle notch) */
const FAST_POLLS = 3;
let fastPolls = 0;
function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer);
  const fast = !eventsSeen && fastPolls < FAST_POLLS;
  if (fast) fastPolls++;
  pollTimer = setTimeout(poll, fast ? POLL_FAST_MS : POLL_SLOW_MS);
}
function poll() {
  // a hidden page (dashboard minimised) skips the round trip; events still arrive
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    if (subs.size) schedulePoll();
    return;
  }
  api
    .nowPlaying()
    .then((v) => setNowPlaying(v))
    .catch(() => {})
    .finally(() => subs.size && schedulePoll());
}

/** Ask the backend right now (after a transport control, say). */
export function refreshNowPlaying(delay = 0) {
  setTimeout(() => api.nowPlaying().then((v) => setNowPlaying(v)).catch(() => {}), delay);
}

function subscribe(cb: () => void): () => void {
  subs.add(cb);
  if (subs.size === 1) {
    offEvent = on<NowPlaying | null>(EV.nowPlaying, (v) => {
      const first = !eventsSeen;
      eventsSeen = true;
      setNowPlaying(v);
      if (first) schedulePoll(); // drop to the slow safety-net rate
    });
    poll();
  }
  return () => {
    subs.delete(cb);
    if (subs.size === 0) {
      offEvent?.();
      offEvent = null;
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = null;
    }
  };
}
const getSnap = () => snap;

/** The current media sample (shared, event-driven). */
export function useNowPlaying(): MediaSnapshot {
  return useSyncExternalStore(subscribe, getSnap, getSnap);
}

/** The media to show as a live activity (null when nothing / paused for > 30 s). Re-renders at the hide time. */
export function useMediaActivity(): NowPlaying | null {
  const s = useNowPlaying();
  const [, tick] = useState(0);
  const visible = mediaVisible(s);
  useEffect(() => {
    if (!s.np || s.np.playing || !visible) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.max(0, PAUSE_HIDE_MS - (Date.now() - s.pausedSince)) + 20);
    return () => clearTimeout(t);
  }, [s, visible]);
  return visible ? s.np : null;
}

/** Interpolated elapsed seconds, re-rendering ~4×/s while playing (only where it's mounted). */
export function useElapsed(np: NowPlaying | null): number | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!np?.playing) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [np]);
  return elapsedNow(np, now);
}

/** Transport control with an optimistic play/pause flip, then a confirming refresh. */
export async function mediaControl(action: "playpause" | "next" | "previous") {
  const cur = snap.np;
  if (cur && action === "playpause") {
    const e = elapsedNow(cur);
    setNowPlaying({ ...cur, playing: !cur.playing, elapsed: e, elapsedAt: Date.now() });
  } else if (cur && action === "previous") {
    setNowPlaying({ ...cur, elapsed: 0, elapsedAt: Date.now() });
  }
  await api.mediaControl(action).catch(() => {});
  refreshNowPlaying(action === "playpause" ? 250 : 400);
}

// ── artwork tint ────────────────────────────────────────────────────────────
const tintCache = new Map<string, string | null>();

/** Make a colour vivid enough to read as a tint on black (lift lightness, keep some saturation). */
export function vividTint(r: number, g: number, b: number): string {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const S = Math.round(Math.min(0.95, Math.max(s, s > 0.08 ? 0.55 : 0)) * 100);
  const L = Math.round(Math.min(0.78, Math.max(l, 0.62)) * 100);
  return `hsl(${Math.round(h)} ${S}% ${L}%)`;
}

/** Average colour of an image (data: URL), made vivid. Cached; null when unreadable. */
export function artworkTint(src: string): Promise<string | null> {
  if (tintCache.has(src)) return Promise.resolve(tintCache.get(src) ?? null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let out: string | null = null;
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 12;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(img, 0, 0, 12, 12);
          const d = ctx.getImageData(0, 0, 12, 12).data;
          let r = 0;
          let g = 0;
          let b = 0;
          let w = 0;
          for (let i = 0; i < d.length; i += 4) {
            // weight saturated pixels more so a colourful cover doesn't average to grey
            const mx = Math.max(d[i], d[i + 1], d[i + 2]);
            const mn = Math.min(d[i], d[i + 1], d[i + 2]);
            const k = 1 + (mx - mn) / 32;
            r += d[i] * k;
            g += d[i + 1] * k;
            b += d[i + 2] * k;
            w += k;
          }
          if (w > 0) out = vividTint(r / w, g / w, b / w);
        }
      } catch {
        out = null; // tainted / unsupported
      }
      tintCache.set(src, out);
      resolve(out);
    };
    img.onerror = () => {
      tintCache.set(src, null);
      resolve(null);
    };
    img.src = src;
  });
}

/** Tint for a sample's artwork (or app icon); null → use the accent. */
export function useMediaTint(np: NowPlaying | null): string | null {
  const src = np?.artwork || np?.appIcon || null;
  const [tint, setTint] = useState<string | null>(() => (src ? (tintCache.get(src) ?? null) : null));
  useEffect(() => {
    if (!src) {
      setTint(null);
      return;
    }
    let alive = true;
    artworkTint(src).then((t) => alive && setTint(t));
    return () => {
      alive = false;
    };
  }, [src]);
  return tint;
}
