// The voice bubble's own settings: which modes are on, what each gesture does, how it looks and how
// it listens. Pure and unit-tested. Saved on the phone (AsyncStorage, see state/BubbleSettings.tsx)
// and handed to the bubble service as one JSON blob (toNative), so the service never re-implements
// the rules below: it gets the effective gesture map, the resolved colour and the language tag.

export type BubbleAction = 'dictate' | 'ask' | 'none';
export type Gesture = 'tap' | 'longPress' | 'doubleTap';
export type BubbleSize = 's' | 'm' | 'l';
export type BubbleSide = 'left' | 'right' | 'auto';
export type ShowWhen = 'typing' | 'always';
export type SpeechLanguage = 'auto' | 'en-IN' | 'en-US' | 'hi-IN' | 'gu-IN' | 'hinglish';
export type InsertMode = 'type' | 'paste';
/** auto: Google's best recognizer while online, on-device when offline. device: always on-device. */
export type SpeechEngine = 'auto' | 'device';

export interface BubbleSettings {
  /** Dictation mode: speak and Flo types into the field */
  dictation: boolean;
  /** Assistant mode: speak a question, Flo answers (your computer or the cloud) */
  assistant: boolean;
  tap: BubbleAction;
  longPress: BubbleAction;
  doubleTap: BubbleAction;
  size: BubbleSize;
  /** 0.3..1: how see-through the bubble rests when idle */
  idleOpacity: number;
  /** null = follow the app's accent */
  accent: string | null;
  side: BubbleSide;
  /** after a few idle seconds, slide half off the screen edge */
  tuck: boolean;
  showWhen: ShowWhen;
  /** package names where the bubble never shows */
  hiddenApps: string[];
  haptics: boolean;
  sounds: boolean;
  language: SpeechLanguage;
  engine: SpeechEngine;
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
  size: 'm',
  idleOpacity: 0.8,
  accent: null,
  side: 'auto',
  tuck: true,
  showWhen: 'typing',
  hiddenApps: [],
  haptics: true,
  sounds: false,
  language: 'auto',
  engine: 'auto',
  insert: 'type',
  preview: true,
  startOnBoot: true,
};

export const BUBBLE_KEY = 'flo.bubble.v1';

/** Resting diameter in dp (the old dock buttons were 56dp each). */
export const BUBBLE_SIZES: Record<BubbleSize, number> = { s: 40, m: 46, l: 52 };
export const OPACITIES = [0.4, 0.6, 0.8, 1] as const;
export const FLO_BLUE = '#2f8cff';
const DOUBLE_TAP_MS = 280;
const GESTURES: readonly Gesture[] = ['tap', 'longPress', 'doubleTap'];

export const LANGUAGES: { id: SpeechLanguage; label: string; native?: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'en-IN', label: 'English (India)' },
  { id: 'en-US', label: 'English (US)' },
  { id: 'hi-IN', label: 'Hindi', native: 'हिन्दी' },
  { id: 'gu-IN', label: 'Gujarati', native: 'ગુજરાતી' },
  { id: 'hinglish', label: 'Hinglish' },
];

const ACTIONS: readonly BubbleAction[] = ['dictate', 'ask', 'none'];
const PKG = /^[A-Za-z][\w]*(\.[A-Za-z_][\w]*)+$/;

function pick<T extends string>(v: unknown, ok: readonly T[], d: T): T {
  return ok.includes(v as T) ? (v as T) : d;
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
  const op = typeof p.idleOpacity === 'number' && Number.isFinite(p.idleOpacity) ? Math.min(1, Math.max(0.3, p.idleOpacity)) : d.idleOpacity;
  const apps = Array.isArray(p.hiddenApps)
    ? [...new Set(p.hiddenApps.filter((a): a is string => typeof a === 'string' && PKG.test(a)))].sort()
    : [];
  return {
    dictation: bool(p.dictation, d.dictation),
    assistant: bool(p.assistant, d.assistant),
    tap: pick(p.tap, ACTIONS, d.tap),
    longPress: pick(p.longPress, ACTIONS, d.longPress),
    doubleTap: pick(p.doubleTap, ACTIONS, d.doubleTap),
    size: pick(p.size, ['s', 'm', 'l'] as const, d.size),
    idleOpacity: op,
    accent: typeof p.accent === 'string' && /^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent.toLowerCase() : null,
    side: pick(p.side, ['left', 'right', 'auto'] as const, d.side),
    tuck: bool(p.tuck, d.tuck),
    showWhen: pick(p.showWhen, ['typing', 'always'] as const, d.showWhen),
    hiddenApps: apps,
    haptics: bool(p.haptics, d.haptics),
    sounds: bool(p.sounds, d.sounds),
    language: pick(p.language, LANGUAGES.map((l) => l.id), d.language),
    engine: pick(p.engine, ['auto', 'device'] as const, d.engine),
    insert: pick(p.insert, ['type', 'paste'] as const, d.insert),
    preview: bool(p.preview, d.preview),
    startOnBoot: bool(p.startOnBoot, d.startOnBoot),
  };
}

const modeOn = (s: BubbleSettings, a: BubbleAction) => (a === 'dictate' ? s.dictation : a === 'ask' ? s.assistant : false);

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
  const m: Record<Gesture, BubbleAction> = { tap: gestureAction(s, 'tap'), longPress: gestureAction(s, 'longPress'), doubleTap: gestureAction(s, 'doubleTap') };
  for (const mode of ['dictate', 'ask'] as const) {
    if (!modeOn(s, mode) || GESTURES.some((g) => m[g] === mode)) continue;
    const free = GESTURES.find((g) => m[g] === 'none');
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
  const set = new Set(s.hiddenApps);
  if (set.has(pkg)) set.delete(pkg);
  else set.add(pkg);
  return { ...s, hiddenApps: [...set].sort() };
}

/** What the bubble service reads (modules/flo-bubble BubbleConfig.kt). */
export interface NativeBubbleConfig {
  visible: boolean;
  dictation: boolean;
  assistant: boolean;
  tap: BubbleAction;
  longPress: BubbleAction;
  doubleTap: BubbleAction;
  tapDelayMs: number;
  sizeDp: number;
  idleOpacity: number;
  accent: string;
  side: BubbleSide;
  tuck: boolean;
  showWhen: ShowWhen;
  hiddenApps: string[];
  haptics: boolean;
  sounds: boolean;
  langTag: string | null;
  langDetect: string[];
  engine: SpeechEngine;
  insert: InsertMode;
  preview: boolean;
  startOnBoot: boolean;
}

/** [appAccent]: the app's accent (Prefs), used when the bubble follows it. */
export function toNative(s: BubbleSettings, appAccent: string | null): NativeBubbleConfig {
  const g = effectiveGestures(s);
  const lang = speechLang(s.language);
  return {
    visible: bubbleVisible(s),
    dictation: s.dictation,
    assistant: s.assistant,
    ...g,
    tapDelayMs: tapDelayMs(s),
    sizeDp: BUBBLE_SIZES[s.size],
    idleOpacity: s.idleOpacity,
    accent: s.accent ?? appAccent ?? FLO_BLUE,
    side: s.side,
    tuck: s.tuck,
    showWhen: s.showWhen,
    hiddenApps: s.hiddenApps,
    haptics: s.haptics,
    sounds: s.sounds,
    langTag: lang.tag,
    langDetect: lang.detect,
    engine: s.engine,
    insert: s.insert,
    preview: s.preview,
    startOnBoot: s.startOnBoot,
  };
}

export const ACTION_LABEL: Record<BubbleAction, string> = { dictate: 'Dictate', ask: 'Ask Flo', none: 'Nothing' };
export const GESTURE_LABEL: Record<Gesture, string> = { tap: 'Tap', longPress: 'Hold', doubleTap: 'Double-tap' };
