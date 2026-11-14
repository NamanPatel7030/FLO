// The voice bubble's own settings: which modes are on, what each gesture does, how it looks and how
// it listens. Pure and unit-tested. Saved on the phone (AsyncStorage, see state/BubbleSettings.tsx)
// and handed to the bubble service as one JSON blob (toNative), so the service never re-implements
// the rules below: it gets the effective gesture map, the resolved colours and the language tag.

export type BubbleAction = 'dictate' | 'ask' | 'openFlo' | 'hide' | 'none';
export type Gesture = 'tap' | 'longPress' | 'doubleTap' | 'swipe';
export type BubbleSize = 's' | 'm' | 'l';
export type BubbleSide = 'left' | 'right' | 'auto';
export type ShowWhen = 'typing' | 'always';
export type SpeechLanguage = 'auto' | 'en-IN' | 'en-US' | 'hi-IN' | 'gu-IN' | 'hinglish';
export type InsertMode = 'type' | 'paste';
/** auto: Google's best recognizer while online, on-device when offline. device: always on-device. */
export type SpeechEngine = 'auto' | 'device';
/** What the bubble looks like (FloOrb.kt draws each one; OrbPreview.tsx is its twin). */
export type BubbleStyle = 'orb' | 'glass' | 'pill' | 'dot' | 'mascot';
/** app: the phone app's accent. desktop: your computer's accent. custom: one colour you pick. Others: gradient presets. */
export type ColorTheme = 'app' | 'desktop' | 'custom' | 'flo' | 'aurora' | 'sunset' | 'mint' | 'ember' | 'graphite';
/** edge: glides to the nearest side when you let go. free: stays where you drop it. */
export type SnapMode = 'edge' | 'free';
export type HapticStrength = 'light' | 'strong';
/** except: everywhere but the listed apps. only: just the listed apps. */
export type AppsMode = 'except' | 'only';
/** pause: stops when you stop talking. tap: keeps listening (through pauses) until you tap again. */
export type StopOn = 'pause' | 'tap';

export interface BubbleSettings {
  /** Dictation mode: speak and Flo types into the field */
  dictation: boolean;
  /** Assistant mode: speak a question, Flo answers (your computer or the cloud) */
  assistant: boolean;
  tap: BubbleAction;
  longPress: BubbleAction;
  doubleTap: BubbleAction;
  /** a quick flick away from the edge */
  swipe: BubbleAction;
  style: BubbleStyle;
  size: BubbleSize;
  /** a size picked on the slider (dp); null = the S / M / L preset */
  customSize: number | null;
  /** 0.3..1: how see-through the bubble rests when idle */
  idleOpacity: number;
  theme: ColorTheme;
  /** the colour for theme 'custom' (null = Flo blue) */
  accent: string | null;
  /** your computer's accent as it last published it (for theme 'desktop') */
  desktopAccent: string | null;
  side: BubbleSide;
  snap: SnapMode;
  /** come back to the last spot (off: always starts at the default spot) */
  rememberPosition: boolean;
  /** after a few idle seconds, slide half off the screen edge */
  tuck: boolean;
  /** idle seconds before it tucks */
  tuckDelay: number;
  /** idle seconds before it hides completely until the next text field (0 = never) */
  autoHide: number;
  showWhen: ShowWhen;
  appsMode: AppsMode;
  /** package names where the bubble never shows (appsMode 'except') */
  hiddenApps: string[];
  /** the only package names where it shows (appsMode 'only') */
  onlyApps: string[];
  haptics: boolean;
  hapticStrength: HapticStrength;
  sounds: boolean;
  language: SpeechLanguage;
  engine: SpeechEngine;
  stopOn: StopOn;
  /** tidy what you said: fillers, repeats, spoken punctuation, "scratch that", capitals */
  cleanup: boolean;
  /** recognizer punctuation and a full stop at the end of longer dictations */
  punctuation: boolean;
  /** names and words Flo should hear (and spell) your way */
  words: string[];
  insert: InsertMode;
  /** show the words as you speak, next to the bubble */
  preview: boolean;
  /** come back by itself after the phone restarts (off: waits until you open Flo) */
  startOnBoot: boolean;
}

export const DEFAULT_BUBBLE: BubbleSettings = {
  dictation: true,
  assistant: true,
  tap: 'dictate',
  longPress: 'ask',
  doubleTap: 'none',
  swipe: 'none',
  style: 'orb',
  size: 'm',
  customSize: null,
  idleOpacity: 0.8,
  theme: 'app',
  accent: null,
  desktopAccent: null,
  side: 'auto',
  snap: 'edge',
  rememberPosition: true,
  tuck: true,
  tuckDelay: 3,
  autoHide: 0,
  showWhen: 'typing',
  appsMode: 'except',
  hiddenApps: [],
  onlyApps: [],
  haptics: true,
  hapticStrength: 'light',
  sounds: false,
  language: 'auto',
  engine: 'auto',
  stopOn: 'pause',
  cleanup: true,
  punctuation: true,
  words: [],
  insert: 'type',
  preview: true,
  startOnBoot: true,
};

export const BUBBLE_KEY = 'flo.bubble.v1';

/** Resting diameter in dp (the old dock buttons were 56dp each). */
export const BUBBLE_SIZES: Record<BubbleSize, number> = { s: 40, m: 46, l: 52 };
export const SIZE_MIN = 32;
export const SIZE_MAX = 72;
export const OPACITY_MIN = 0.3;
export const TUCK_DELAYS = [2, 3, 5, 8] as const;
export const AUTO_HIDE = [0, 10, 30, 60] as const;
export const WORDS_MAX = 60;
export const FLO_BLUE = '#2f8cff';
const DOUBLE_TAP_MS = 280;
export const GESTURES: readonly Gesture[] = ['tap', 'longPress', 'doubleTap', 'swipe'];
/** where a mode that has no gesture lands (swipe is never picked for you: it's the least discoverable) */
const FALLBACK: readonly Gesture[] = ['tap', 'longPress', 'doubleTap'];

export const LANGUAGES: { id: SpeechLanguage; label: string; native?: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'en-IN', label: 'English (India)' },
  { id: 'en-US', label: 'English (US)' },
  { id: 'hi-IN', label: 'Hindi', native: 'हिन्दी' },
  { id: 'gu-IN', label: 'Gujarati', native: 'ગુજરાતી' },
  { id: 'hinglish', label: 'Hinglish' },
];

export const STYLES: { id: BubbleStyle; label: string; detail: string }[] = [
  { id: 'orb', label: 'Orb', detail: 'Deep glass with the Flo wave' },
  { id: 'glass', label: 'Glass', detail: 'See-through, a coloured rim' },
  { id: 'pill', label: 'Pill', detail: 'Slim, hugs the edge' },
  { id: 'dot', label: 'Dot', detail: 'Tiny and quiet' },
  { id: 'mascot', label: 'Mascot', detail: 'A friendly face that listens' },
];

/** Gradient presets: [from, to]. */
export const PALETTES: Record<'flo' | 'aurora' | 'sunset' | 'mint' | 'ember' | 'graphite', { label: string; from: string; to: string }> = {
  flo: { label: 'Flo', from: '#2f8cff', to: '#7a6cff' },
  aurora: { label: 'Aurora', from: '#22d3ee', to: '#8b5cf6' },
  sunset: { label: 'Sunset', from: '#fb7185', to: '#f59e0b' },
  mint: { label: 'Mint', from: '#10b981', to: '#22d3ee' },
  ember: { label: 'Ember', from: '#f43f5e', to: '#f97316' },
  graphite: { label: 'Graphite', from: '#64748b', to: '#cbd5e1' },
};

/** The desktop app's accent presets (src/lib/types.ts ACCENT_PRESETS): its accent → its gradient. */
export const DESKTOP_PRESETS: { name: string; accent: string; gradient: [string, string] }[] = [
  { name: 'Sky', accent: '#3dbbff', gradient: ['#1a9be0', '#66ceff'] },
  { name: 'Aqua', accent: '#22d3ee', gradient: ['#0891b2', '#67e8f9'] },
  { name: 'Violet', accent: '#8b5cf6', gradient: ['#6d28d9', '#a78bfa'] },
  { name: 'Emerald', accent: '#10b981', gradient: ['#059669', '#34d399'] },
  { name: 'Sunset', accent: '#fb7185', gradient: ['#f43f5e', '#fda4af'] },
  { name: 'Amber', accent: '#f59e0b', gradient: ['#d97706', '#fbbf24'] },
];

const ACTIONS: readonly BubbleAction[] = ['dictate', 'ask', 'openFlo', 'hide', 'none'];
const PKG = /^[A-Za-z][\w]*(\.[A-Za-z_][\w]*)+$/;
const HEX = /^#[0-9a-f]{6}$/i;
const THEMES: readonly ColorTheme[] = ['app', 'desktop', 'custom', 'flo', 'aurora', 'sunset', 'mint', 'ember', 'graphite'];

function pick<T extends string>(v: unknown, ok: readonly T[], d: T): T {
  return ok.includes(v as T) ? (v as T) : d;
}

function nearest<T extends number>(v: unknown, ok: readonly T[], d: T): T {
  if (typeof v !== 'number' || !Number.isFinite(v)) return d;
  return ok.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
}

const hex = (v: unknown): string | null => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : null);

const packages = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((a): a is string => typeof a === 'string' && PKG.test(a)))].sort() : [];

/** One word or short name per entry: trimmed, no duplicates (case-insensitive), at most WORDS_MAX. */
export function cleanWords(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of v) {
    if (typeof w !== 'string') continue;
    const t = w.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= WORDS_MAX) break;
  }
  return out;
}

/** Merge stored JSON over the defaults, dropping anything malformed. */
export function parseBubbleSettings(raw: string | null): BubbleSettings {
  if (!raw) return DEFAULT_BUBBLE;
  let p: Partial<Record<keyof BubbleSettings, unknown>>;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return DEFAULT_BUBBLE;
    p = v as typeof p;
  } catch {
    return DEFAULT_BUBBLE;
  }
  const d = DEFAULT_BUBBLE;
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  const op = typeof p.idleOpacity === 'number' && Number.isFinite(p.idleOpacity) ? Math.min(1, Math.max(OPACITY_MIN, p.idleOpacity)) : d.idleOpacity;
  const accent = hex(p.accent);
  // 0.7 and earlier had no theme: a picked colour meant "custom"
  const theme = pick(p.theme, THEMES, accent ? 'custom' : d.theme);
  const custom = typeof p.customSize === 'number' && Number.isFinite(p.customSize) ? Math.round(Math.min(SIZE_MAX, Math.max(SIZE_MIN, p.customSize))) : null;
  return {
    dictation: bool(p.dictation, d.dictation),
    assistant: bool(p.assistant, d.assistant),
    tap: pick(p.tap, ACTIONS, d.tap),
    longPress: pick(p.longPress, ACTIONS, d.longPress),
    doubleTap: pick(p.doubleTap, ACTIONS, d.doubleTap),
    swipe: pick(p.swipe, ACTIONS, d.swipe),
    style: pick(p.style, STYLES.map((x) => x.id), d.style),
    size: pick(p.size, ['s', 'm', 'l'] as const, d.size),
    customSize: custom,
    idleOpacity: op,
    theme,
    accent,
    desktopAccent: hex(p.desktopAccent),
    side: pick(p.side, ['left', 'right', 'auto'] as const, d.side),
    snap: pick(p.snap, ['edge', 'free'] as const, d.snap),
    rememberPosition: bool(p.rememberPosition, d.rememberPosition),
    tuck: bool(p.tuck, d.tuck),
    tuckDelay: nearest(p.tuckDelay, TUCK_DELAYS, d.tuckDelay as (typeof TUCK_DELAYS)[number]),
    autoHide: nearest(p.autoHide, AUTO_HIDE, d.autoHide as (typeof AUTO_HIDE)[number]),
    showWhen: pick(p.showWhen, ['typing', 'always'] as const, d.showWhen),
    appsMode: pick(p.appsMode, ['except', 'only'] as const, d.appsMode),
    hiddenApps: packages(p.hiddenApps),
    onlyApps: packages(p.onlyApps),
    haptics: bool(p.haptics, d.haptics),
    hapticStrength: pick(p.hapticStrength, ['light', 'strong'] as const, d.hapticStrength),
    sounds: bool(p.sounds, d.sounds),
    language: pick(p.language, LANGUAGES.map((l) => l.id), d.language),
    engine: pick(p.engine, ['auto', 'device'] as const, d.engine),
    stopOn: pick(p.stopOn, ['pause', 'tap'] as const, d.stopOn),
    cleanup: bool(p.cleanup, d.cleanup),
    punctuation: bool(p.punctuation, d.punctuation),
    words: cleanWords(p.words),
    insert: pick(p.insert, ['type', 'paste'] as const, d.insert),
    preview: bool(p.preview, d.preview),
    startOnBoot: bool(p.startOnBoot, d.startOnBoot),
  };
}

/** Does [a] work right now? Dictate and Ask need their mode on; Open Flo and Hide always work. */
const modeOn = (s: BubbleSettings, a: BubbleAction) =>
  a === 'dictate' ? s.dictation : a === 'ask' ? s.assistant : a === 'openFlo' || a === 'hide';

/** What a gesture does as stored, or 'none' while its mode is off. */
export function gestureAction(s: BubbleSettings, g: Gesture): BubbleAction {
  const a = s[g];
  return modeOn(s, a) ? a : 'none';
}

/**
 * The gesture map the bubble really uses: gestures of a mode that's off do nothing, and a mode that's
 * on but has no gesture takes the first free one (tap, then long-press, then double-tap), so turning
 * a mode on never leaves it unreachable.
 */
export function effectiveGestures(s: BubbleSettings): Record<Gesture, BubbleAction> {
  const m: Record<Gesture, BubbleAction> = {
    tap: gestureAction(s, 'tap'),
    longPress: gestureAction(s, 'longPress'),
    doubleTap: gestureAction(s, 'doubleTap'),
    swipe: gestureAction(s, 'swipe'),
  };
  if (!bubbleVisible(s)) return { tap: 'none', longPress: 'none', doubleTap: 'none', swipe: 'none' };
  for (const mode of ['dictate', 'ask'] as const) {
    if (!modeOn(s, mode) || GESTURES.some((g) => m[g] === mode)) continue;
    const free = FALLBACK.find((g) => m[g] === 'none');
    if (free) m[free] = mode;
  }
  return m;
}

export const bubbleVisible = (s: BubbleSettings) => s.dictation || s.assistant;

/** A single tap waits this long for a second one, only when double-tap does something. */
export const tapDelayMs = (s: BubbleSettings) => (effectiveGestures(s).doubleTap === 'none' ? 0 : DOUBLE_TAP_MS);

/** The "Dictation only" preset: no Ask; tap to talk, or hold to talk. */
export function dictationOnly(s: BubbleSettings): BubbleSettings {
  return { ...s, dictation: true, assistant: false, tap: 'dictate', longPress: 'dictate', doubleTap: 'none' };
}

export const isDictationOnly = (s: BubbleSettings) => s.dictation && !s.assistant;

/** Turn a mode on or off; turning one on gives it its usual gesture if nothing else has it. */
export function setMode(s: BubbleSettings, mode: 'dictation' | 'assistant', on: boolean): BubbleSettings {
  const next = { ...s, [mode]: on };
  if (!on) return next;
  const action: BubbleAction = mode === 'dictation' ? 'dictate' : 'ask';
  if (GESTURES.some((g) => next[g] === action)) return next;
  const home: Gesture = mode === 'dictation' ? 'tap' : 'longPress';
  return { ...next, [home]: action };
}

/** The recognizer language: a BCP-47 tag (null = the phone's own), plus languages Android 14+ may detect. */
export function speechLang(l: SpeechLanguage): { tag: string | null; detect: string[] } {
  if (l === 'auto') return { tag: null, detect: ['en-IN', 'hi-IN', 'gu-IN'] };
  if (l === 'hinglish') return { tag: 'en-IN', detect: [] };
  return { tag: l, detect: [] };
}

export function toggleHiddenApp(s: BubbleSettings, pkg: string): BubbleSettings {
  return { ...s, hiddenApps: toggle(s.hiddenApps, pkg) };
}

/** Add or remove [pkg] from the list the current apps mode uses. */
export function toggleApp(s: BubbleSettings, pkg: string): BubbleSettings {
  return s.appsMode === 'only' ? { ...s, onlyApps: toggle(s.onlyApps, pkg) } : toggleHiddenApp(s, pkg);
}

export const appList = (s: BubbleSettings) => (s.appsMode === 'only' ? s.onlyApps : s.hiddenApps);

function toggle(list: string[], pkg: string): string[] {
  const set = new Set(list);
  if (set.has(pkg)) set.delete(pkg);
  else set.add(pkg);
  return [...set].sort();
}

/** The bubble's diameter in dp: the slider's size, else the preset. */
export const sizeDp = (s: BubbleSettings) => s.customSize ?? BUBBLE_SIZES[s.size];

// ── colour ───────────────────────────────────────────────────────────────────

function rgb(c: string): [number, number, number] {
  const n = parseInt(c.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Linear mix of two #rrggbb colours (t = 0 → a, 1 → b), as FloOrb.mix. */
export function mixHex(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return `#${x.map((v, i) => Math.trunc(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** A second gradient colour for a single accent: a lighter, slightly cooler shade. */
export const companion = (accent: string) => mixHex(mixHex(accent, '#ffffff', 0.38), '#7a6cff', 0.12);

/**
 * The two colours the bubble draws with: [accent] for the ring, glow and listening wave, and [accent2]
 * for the far end of its gradient. [appAccent] is the phone app's accent (null = Flo blue).
 */
export function resolveColors(s: BubbleSettings, appAccent: string | null): { accent: string; accent2: string } {
  const single = (c: string) => ({ accent: c, accent2: companion(c) });
  switch (s.theme) {
    case 'app':
      return single((appAccent ?? FLO_BLUE).toLowerCase());
    case 'custom':
      return single(s.accent ?? FLO_BLUE);
    case 'desktop': {
      const d = s.desktopAccent;
      if (!d) return single((appAccent ?? FLO_BLUE).toLowerCase());
      const preset = DESKTOP_PRESETS.find((p) => p.accent === d);
      return preset ? { accent: d, accent2: preset.gradient[1] } : single(d);
    }
    default: {
      const p = PALETTES[s.theme];
      return { accent: p.from, accent2: p.to };
    }
  }
}

/** Your computer's accent, from the settings it published (ComputerState.settings, key "accent"). */
export function desktopAccentOf(settings: { key: string; value: unknown }[] | null | undefined): string | null {
  const v = settings?.find((x) => x.key === 'accent')?.value;
  return hex(v);
}

// ── geometry (FloOrb.bodySize) ─────────────────────────────────────────────────

/** Room around the body, in dp, for the ring, the waveform and the shadow (FloBubble.pad). */
export const ORB_PAD = 13;
export const PILL_W = 0.68;
export const PILL_H = 1.32;
export const DOT_K = 0.56;

/** The drawn body's width and height (dp) for a style at diameter [d]. */
export function bodySize(style: BubbleStyle, d: number): { w: number; h: number } {
  if (style === 'pill') return { w: Math.round(d * PILL_W), h: Math.round(d * PILL_H) };
  if (style === 'dot') {
    const k = Math.round(d * DOT_K);
    return { w: k, h: k };
  }
  return { w: d, h: d };
}

// ── the service ────────────────────────────────────────────────────────────────

/** What the bubble service reads (modules/flo-bubble BubbleConfig.kt). */
export interface NativeBubbleConfig {
  visible: boolean;
  dictation: boolean;
  assistant: boolean;
  tap: BubbleAction;
  longPress: BubbleAction;
  doubleTap: BubbleAction;
  swipe: BubbleAction;
  tapDelayMs: number;
  style: BubbleStyle;
  sizeDp: number;
  idleOpacity: number;
  accent: string;
  accent2: string;
  side: BubbleSide;
  snap: SnapMode;
  rememberPosition: boolean;
  tuck: boolean;
  tuckDelayMs: number;
  autoHideMs: number;
  showWhen: ShowWhen;
  appsMode: AppsMode;
  hiddenApps: string[];
  onlyApps: string[];
  haptics: boolean;
  hapticStrength: HapticStrength;
  sounds: boolean;
  langTag: string | null;
  langDetect: string[];
  engine: SpeechEngine;
  stopOn: StopOn;
  cleanup: boolean;
  punctuation: boolean;
  words: string[];
  insert: InsertMode;
  preview: boolean;
  startOnBoot: boolean;
}

/** [appAccent]: the app's accent (Prefs), used when the bubble follows it. */
export function toNative(s: BubbleSettings, appAccent: string | null): NativeBubbleConfig {
  const g = effectiveGestures(s);
  const lang = speechLang(s.language);
  const c = resolveColors(s, appAccent);
  return {
    visible: bubbleVisible(s),
    dictation: s.dictation,
    assistant: s.assistant,
    ...g,
    tapDelayMs: tapDelayMs(s),
    style: s.style,
    sizeDp: sizeDp(s),
    idleOpacity: s.idleOpacity,
    accent: c.accent,
    accent2: c.accent2,
    side: s.side,
    snap: s.snap,
    rememberPosition: s.rememberPosition,
    tuck: s.tuck && s.snap === 'edge',
    tuckDelayMs: s.tuckDelay * 1000,
    autoHideMs: s.autoHide * 1000,
    showWhen: s.showWhen,
    appsMode: s.appsMode,
    hiddenApps: s.hiddenApps,
    onlyApps: s.onlyApps,
    haptics: s.haptics,
    hapticStrength: s.hapticStrength,
    sounds: s.sounds,
    langTag: lang.tag,
    langDetect: lang.detect,
    engine: s.engine,
    stopOn: s.stopOn,
    cleanup: s.cleanup,
    punctuation: s.punctuation,
    words: s.words,
    insert: s.insert,
    preview: s.preview,
    startOnBoot: s.startOnBoot,
  };
}

export const ACTION_LABEL: Record<BubbleAction, string> = { dictate: 'Dictate', ask: 'Ask Flo', openFlo: 'Open Flo', hide: 'Hide', none: 'Nothing' };
export const GESTURE_LABEL: Record<Gesture, string> = { tap: 'Tap', longPress: 'Hold', doubleTap: 'Double-tap', swipe: 'Swipe' };

/** "Tap: Dictate · Hold: Ask Flo" for the gestures that do something. */
export function gestureSummary(s: BubbleSettings, sep = '  ·  '): string {
  const g = effectiveGestures(s);
  return GESTURES.filter((x) => g[x] !== 'none')
    .map((x) => `${GESTURE_LABEL[x]}: ${ACTION_LABEL[g[x]]}`)
    .join(sep);
}
