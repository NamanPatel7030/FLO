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
};
