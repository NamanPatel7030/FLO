// The voice bubble that appears next to text fields in other apps (Android accessibility service).
import { Platform } from 'react-native';
import Native, { type FloBubbleNative } from '../../modules/flo-bubble';

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

export const bubble = {
  state: () => bubbleState(Native),
  /** Give the bubble the paired server + device token (null when unpaired). */
  setSession(server: string | null, token: string | null) {
    try {
      Native?.setSession(server, token);
    } catch {
      /* not on Android */
    }
  },
  setEnabled(on: boolean) {
    try {
      Native?.setEnabled(on);
    } catch {
      /* ignore */
    }
  },
  openSettings() {
    Native?.openSettings();
  },
  openAppInfo() {
    try {
      Native?.openAppInfo?.();
    } catch {
      /* older build */
    }
  },
  serviceOn(): boolean {
    try {
      return !!Native?.isServiceOn();
    } catch {
      return false;
    }
  },
  restricted(): EnableFacts['restricted'] {
    try {
      return Native?.restrictedSettings?.() ?? 'unknown';
    } catch {
      return 'unknown';
    }
  },
  sdk(): number {
    try {
      return Native?.sdkInt?.() ?? (typeof Platform.Version === 'number' ? Platform.Version : 0);
    } catch {
      return 0;
    }
  },
};
