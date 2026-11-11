// The voice bubble that floats over other apps (Android accessibility service, modules/flo-bubble).
import { Platform } from 'react-native';
import Native, { type FloBubbleNative } from '../../modules/flo-bubble';
import { MOCK_APPS, isMockMode, mockBubbleHistory, mockBubbleState, mockSpeechSupport } from '../api/mock';

export type BubbleState = 'unavailable' | 'off' | 'paused' | 'on';

/** Where the bubble stands (unit-tested): needs the native module, the service switched on, and the user's switch. */
export function bubbleState(native: Pick<FloBubbleNative, 'isServiceOn' | 'isEnabled'> | null, os: string = Platform.OS): BubbleState {
  if (os !== 'android' || !native) return 'unavailable';
  try {
    if (!native.isServiceOn()) return 'off';
    return native.isEnabled() ? 'on' : 'paused';
  } catch {
    return 'unavailable';
  }
}

/** The one step left before the bubble works (unit-tested). */
export type EnableStep = 'mic' | 'unblock' | 'accessibility' | 'done';

export interface EnableFacts {
  /** The Accessibility service is switched on. */
  serviceOn: boolean;
  /** The microphone permission is granted. */
  mic: boolean;
  /** Android 13+ "Restricted setting" block for apps installed from a downloaded file. */
  restricted: 'restricted' | 'allowed' | 'unknown';
  /** Android API level. */
  sdk: number;
  /** We already sent the user to Accessibility and they came back without it on. */
  triedAccessibility: boolean;
}

/**
 * Microphone first (asked in place), then, only on Android 13+ when Android blocks the switch,
 * "Allow restricted settings" in App info, then the Accessibility switch itself. When we can't tell
 * whether the block applies, we try Accessibility first and show the unblock guide if that didn't take.
 */
export function enableStep(f: EnableFacts): EnableStep {
  if (f.serviceOn) return 'done';
  if (!f.mic) return 'mic';
  if (f.sdk >= 33 && (f.restricted === 'restricted' || (f.restricted === 'unknown' && f.triedAccessibility))) return 'unblock';
  return 'accessibility';
}

/** flo-pair://bubble and flo-pair://speech open those screens (the bubble's notifications) (unit-tested). */
export function appLink(url: string): 'bubble' | 'speech' | null {
  const m = /^flo-pair:\/\/(bubble|speech)(?:[/?#]|$)/i.exec(url.trim());
  return m ? (m[1].toLowerCase() as 'bubble' | 'speech') : null;
}

/** One entry of the bubble's Recent list (FloBubble.history()). */
export interface BubbleHistoryItem {
  kind: 'dictate' | 'copied' | 'ask' | 'queued' | 'error';
  text: string;
  answer?: string;
  cloud?: boolean;
  at: number;
}

const KINDS: readonly BubbleHistoryItem['kind'][] = ['dictate', 'copied', 'ask', 'queued', 'error'];

/** Parse the native history JSON, dropping anything malformed (unit-tested). */
export function parseHistory(raw: string | null | undefined): BubbleHistoryItem[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter((x) => x && typeof x === 'object' && typeof x.text === 'string' && KINDS.includes(x.kind))
      .map((x) => ({
        kind: x.kind,
        text: x.text,
        at: typeof x.at === 'number' ? x.at : 0,
        ...(typeof x.answer === 'string' ? { answer: x.answer } : {}),
        ...(x.cloud === true ? { cloud: true } : {}),
      }));
  } catch {
    return [];
  }
}

export const HISTORY_LABEL: Record<BubbleHistoryItem['kind'], string> = {
  dictate: 'Typed',
  copied: 'Copied',
  ask: 'Answered',
  queued: 'Kept for when online',
  error: "Couldn't answer",
};

// the web preview (?mock) pretends to be a phone with the bubble on, for screenshots
const mock = Platform.OS === 'web' && isMockMode();
let mockOn = mockBubbleState() !== 'paused';

function call<T>(fn: () => T | undefined, fallback: T): T {
  try {
    return fn() ?? fallback;
  } catch {
    return fallback;
  }
}

export const bubble = {
  state: (): BubbleState => {
    if (mock) {
      const s = mockBubbleState();
      return s === 'off' ? 'off' : mockOn ? 'on' : 'paused';
    }
    return bubbleState(Native);
  },
  /** The native module is here (Android build with the bubble), or the web preview. */
  present: () => mock || (Platform.OS === 'android' && !!Native),
  /** Give the bubble the paired server + device token (null when unpaired). */
  setSession(server: string | null, token: string | null) {
    call(() => Native?.setSession(server, token), undefined);
  },
  setEnabled(on: boolean) {
    if (mock) mockOn = on;
    call(() => Native?.setEnabled(on), undefined);
  },
  setConfig(json: string) {
    call(() => Native?.setConfig?.(json), undefined);
  },
  clearBootPause() {
    call(() => Native?.clearBootPause?.(), undefined);
  },
  openSettings() {
    Native?.openSettings();
  },
  openAppInfo() {
    call(() => Native?.openAppInfo?.(), undefined);
  },
  serviceOn: (): boolean => (mock ? mockBubbleState() !== 'off' : call(() => Native?.isServiceOn(), false)),
  restricted: (): EnableFacts['restricted'] => call(() => Native?.restrictedSettings?.(), 'unknown'),
  sdk(): number {
    if (mock) return 34;
    return call(() => Native?.sdkInt?.(), typeof Platform.Version === 'number' ? Platform.Version : 0);
  },
  /** null when the phone can't say (web, older build). */
  isOnline: (): boolean | null => call<boolean | null>(() => Native?.isOnline?.(), null),
  history: (): BubbleHistoryItem[] => parseHistory(mock ? mockBubbleHistory() : call(() => Native?.history?.(), '[]')),
  clearHistory() {
    call(() => Native?.clearHistory?.(), undefined);
  },
  /** Questions the bubble kept offline (read only). */
  queued: (): string => call(() => Native?.queued?.(), '[]'),
  takeQueued: (): string => call(() => Native?.takeQueued?.(), '[]'),
  takeLate: (): string => call(() => Native?.takeLate?.(), '[]'),
  onDeviceSpeech: (): boolean | null => (mock ? true : call<boolean | null>(() => Native?.onDeviceSpeech?.(), null)),
  async speechSupport(lang: string | null): Promise<string | null> {
    if (mock) return mockSpeechSupport();
    try {
      return (await Native?.speechSupport?.(lang)) ?? null;
    } catch {
      return null;
    }
  },
  async downloadSpeech(lang: string): Promise<boolean> {
    try {
      return (await Native?.downloadSpeech?.(lang)) ?? false;
    } catch {
      return false;
    }
  },
  openSpeechSettings: (): string => call(() => Native?.openSpeechSettings?.(), 'none'),
  async launchableApps(): Promise<{ pkg: string; label: string }[]> {
    if (mock) return MOCK_APPS;
    try {
      const raw = await Native?.launchableApps?.();
      const v = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(v) ? v.filter((x) => x && typeof x.pkg === 'string' && typeof x.label === 'string') : [];
    } catch {
      return [];
    }
  },
};
