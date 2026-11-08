// Browser-preview simulation of the backend's now-playing source (src-tauri/src/media.rs):
// a Spotify queue with album art, and a video playing in Chrome (no artwork → app icon).
// mock.ts routes now_playing / media_control here and emits EV.nowPlaying on every change.
// `?media=youtube|paused|none` picks the starting state for demos and tests.
import type { NowPlaying } from "./types";

const svg = (body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${body}</svg>`)}`;

/** album art: a moonlit gradient */
const ART_NIGHT_OWL = svg(
  `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b2a8f"/><stop offset="0.55" stop-color="#7b3fa8"/><stop offset="1" stop-color="#ef7aa1"/></linearGradient>` +
    `<radialGradient id="m" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff6d8"/><stop offset="1" stop-color="#ffd27a"/></radialGradient></defs>` +
    `<rect width="120" height="120" fill="url(#g)"/><circle cx="78" cy="40" r="18" fill="url(#m)"/>` +
    `<path d="M0 92 Q30 70 60 88 T120 80 V120 H0Z" fill="#241a5c" opacity="0.85"/><path d="M0 104 Q40 88 80 102 T120 98 V120 H0Z" fill="#150f3a"/>`,
);
/** album art: soft teal / coral blobs */
const ART_WEIGHTLESS = svg(
  `<defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#0f766e"/><stop offset="1" stop-color="#5eead4"/></linearGradient></defs>` +
    `<rect width="120" height="120" fill="url(#g)"/><circle cx="36" cy="44" r="30" fill="#fb7185" opacity="0.75"/><circle cx="84" cy="80" r="34" fill="#fde68a" opacity="0.55"/>`,
);
/** generic music-app icon (green disc + sound arcs) */
const ICON_MUSIC = svg(
  `<circle cx="60" cy="60" r="56" fill="#1ed760"/><g fill="none" stroke="#06140b" stroke-width="9" stroke-linecap="round">` +
    `<path d="M30 46 Q60 36 92 50"/><path d="M34 64 Q60 56 86 67"/><path d="M38 80 Q60 74 80 83"/></g>`,
);
/** generic browser icon (ringed globe) */
const ICON_BROWSER = svg(
  `<circle cx="60" cy="60" r="56" fill="#ea4335"/><path d="M60 4 A56 56 0 0 1 108.5 88 L60 60Z" fill="#fbbc04"/><path d="M108.5 88 A56 56 0 0 1 11.5 88 L60 60Z" fill="#34a853"/>` +
    `<circle cx="60" cy="60" r="24" fill="#fff"/><circle cx="60" cy="60" r="18" fill="#4285f4"/>`,
);

type Track = Omit<NowPlaying, "playing" | "elapsed" | "elapsedAt">;
const SPOTIFY: Track[] = [
  { app: "Spotify", bundleId: "com.spotify.client", title: "Night Owl", artist: "Galimatias", album: "Urban Flora", duration: 214, artwork: ART_NIGHT_OWL, appIcon: ICON_MUSIC },
  { app: "Spotify", bundleId: "com.spotify.client", title: "Weightless", artist: "Marconi Union", album: "Weightless (Ambient Transmissions Vol. 2)", duration: 485, artwork: ART_WEIGHTLESS, appIcon: ICON_MUSIC },
];
const YOUTUBE: Track[] = [
  {
    app: "Google Chrome",
    bundleId: "com.google.Chrome",
    title: "Deep focus: 2 hours of ambient music for studying and coding",
    artist: "YouTube",
    album: "",
    duration: 7200,
    artwork: null,
    appIcon: ICON_BROWSER,
  },
];

interface State {
  queue: Track[];
  i: number;
  playing: boolean;
  /** seconds into the track at `at` */
  pos: number;
  at: number;
  active: boolean;
}

function initial(): State {
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("media") : null;
  const now = Date.now();
  if (q === "none") return { queue: SPOTIFY, i: 0, playing: false, pos: 0, at: now, active: false };
  if (q === "youtube") return { queue: YOUTUBE, i: 0, playing: true, pos: 1312, at: now, active: true };
  return { queue: SPOTIFY, i: 0, playing: q !== "paused", pos: 42, at: now, active: true };
}
let st: State = initial();
/** a sample injected by a test (wins until the next control / set) */
let custom: NowPlaying | null = null;

function position(now: number): number {
  const t = st.queue[st.i];
  let pos = st.pos + (st.playing ? (now - st.at) / 1000 : 0);
  // roll over into the next track like a real queue
  while (t.duration && pos >= t.duration && st.playing) {
    pos -= t.duration;
    st.i = (st.i + 1) % st.queue.length;
    st.pos = 0;
    st.at = now - pos * 1000;
  }
  return pos;
}

/** What now_playing returns right now. */
export function mediaSample(): NowPlaying | null {
  if (custom) return { ...custom };
  if (!st.active) return null;
  const now = Date.now();
  const pos = position(now);
  return { ...st.queue[st.i], playing: st.playing, elapsed: Math.round(pos * 10) / 10, elapsedAt: now };
}

/** media_control: play/pause, next, previous. Returns the new sample (to emit). */
export function mediaControl(action: string): NowPlaying | null {
  const now = Date.now();
  if (custom) {
    if (action === "playpause") custom = { ...custom, playing: !custom.playing, elapsedAt: now };
    return mediaSample();
  }
  if (!st.active) return null;
  const pos = position(now);
  if (action === "playpause") st = { ...st, playing: !st.playing, pos, at: now };
  else if (action === "next") st = { ...st, i: (st.i + 1) % st.queue.length, pos: 0, at: now, playing: true };
  else if (action === "previous") st = pos < 3 ? { ...st, i: (st.i - 1 + st.queue.length) % st.queue.length, pos: 0, at: now } : { ...st, pos: 0, at: now };
  return mediaSample();
}

/** Test / demo hook: "spotify" | "youtube" | "paused" | "none" | a NowPlaying | null. */
export function mediaSet(v: string | NowPlaying | null): NowPlaying | null {
  const now = Date.now();
  custom = null;
  if (v === null || v === "none") st = { ...st, active: false, playing: false };
  else if (v === "spotify") st = { queue: SPOTIFY, i: 0, playing: true, pos: 42, at: now, active: true };
  else if (v === "youtube") st = { queue: YOUTUBE, i: 0, playing: true, pos: 1312, at: now, active: true };
  else if (v === "paused") st = { ...st, active: true, pos: position(now), at: now, playing: false };
  else if (typeof v === "object") custom = { ...v };
  return mediaSample();
}
