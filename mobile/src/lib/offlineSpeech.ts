// Offline (on-device) speech: which language packs this phone has, and what to tell the user.
// The facts come from Android (FloBubble.speechSupport, SpeechRecognizer.checkRecognitionSupport on
// Android 13+); the rules here are pure and unit-tested.
import type { SpeechLanguage } from './bubbleSettings';

/** What Android reports (JSON from the native module). */
export interface SpeechSupport {
  /** 'full': Android 13+ told us per language. 'basic': Android 12 (on-device exists, no list). 'none': older or no recognizer. */
  api: 'full' | 'basic' | 'none';
  onDevice: boolean;
  installed: string[];
  pending: string[];
  supported: string[];
  online: string[];
  error?: string;
}

export type PackStatus = 'installed' | 'downloading' | 'available' | 'unsupported' | 'unknown';

export const EMPTY_SUPPORT: SpeechSupport = { api: 'none', onDevice: false, installed: [], pending: [], supported: [], online: [] };

export function parseSupport(raw: string | null | undefined): SpeechSupport {
  if (!raw) return EMPTY_SUPPORT;
  try {
    const v = JSON.parse(raw) as Partial<SpeechSupport>;
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
    return {
      api: v.api === 'full' || v.api === 'basic' ? v.api : 'none',
      onDevice: v.onDevice === true,
      installed: list(v.installed),
      pending: list(v.pending),
      supported: list(v.supported),
      online: list(v.online),
      ...(typeof v.error === 'string' ? { error: v.error } : {}),
    };
  } catch {
    return EMPTY_SUPPORT;
  }
}

const norm = (t: string) => t.trim().replace(/_/g, '-').toLowerCase();

/** Exact tag first ("en-IN"), then the same language in any region ("en-US" counts for English). */
function has(list: string[], tag: string, loose: boolean): boolean {
  const t = norm(tag);
  const all = list.map(norm);
  if (all.includes(t)) return true;
  if (!loose) return false;
  const base = t.split('-')[0];
  return all.some((x) => x.split('-')[0] === base);
}

/** The pack a language setting needs (Auto and Hinglish ride on Indian English). */
export function packTag(lang: SpeechLanguage): string {
  return lang === 'auto' || lang === 'hinglish' ? 'en-IN' : lang;
}

export function packStatus(tag: string, s: SpeechSupport): PackStatus {
  if (s.api === 'none') return 'unsupported';
  if (s.api === 'basic') return s.onDevice ? 'unknown' : 'unsupported';
  if (has(s.installed, tag, false)) return 'installed';
  if (has(s.pending, tag, false)) return 'downloading';
  if (has(s.supported, tag, false)) return 'available';
  // a pack for the same language in another region still works offline (e.g. en-US for en-IN)
  if (has(s.installed, tag, true)) return 'installed';
  if (has(s.supported, tag, true)) return 'available';
  return 'unsupported';
}

/** Can dictation work right now without internet, for this language? */
export function worksOffline(lang: SpeechLanguage, s: SpeechSupport): boolean | null {
  const st = packStatus(packTag(lang), s);
  if (st === 'installed') return true;
  if (st === 'unknown') return null;
  return false;
}

export const PACK_LABEL: Record<PackStatus, string> = {
  installed: 'Ready offline',
  downloading: 'Downloading',
  available: 'Not downloaded',
  unsupported: 'Needs internet',
  unknown: 'Check in Android settings',
};

/** The languages the offline screen lists. */
export const PACK_LANGS: { tag: string; label: string }[] = [
  { tag: 'en-IN', label: 'English (India)' },
  { tag: 'en-US', label: 'English (US)' },
  { tag: 'hi-IN', label: 'Hindi' },
  { tag: 'gu-IN', label: 'Gujarati' },
];

/** Where Android keeps the packs, for the manual steps. */
export function manualSteps(sdk: number): string[] {
  if (sdk >= 33)
    return [
      'Open Android Settings, then System, then Languages.',
      'Tap On-device speech (on some phones: Speech, then On-device recognition).',
      'Download English (India), Hindi or Gujarati.',
    ];
  return [
    'Open the Google app, then tap your picture, then Settings.',
    'Tap Voice, then Offline speech recognition.',
    'Download the languages you speak.',
  ];
}
