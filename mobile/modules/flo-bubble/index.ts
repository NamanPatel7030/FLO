// JS side of the Flo voice bubble (android/…/FloBubbleService.kt). Absent on web and in Expo Go.
// Optional members (`?`) arrived in later builds: an older installed APK running a newer JS bundle
// (an over-the-air update) may not have them, so callers must check.
import { requireOptionalNativeModule } from 'expo';

export interface FloBubbleNative {
  setSession(server: string | null, token: string | null): void;
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  isServiceOn(): boolean;
  openSettings(): void;
  /** Flo's App info page (Android 13+: its menu holds "Allow restricted settings"). */
  openAppInfo?(): void;
  /** Whether Android 13+ blocks turning on the service until "Allow restricted settings". */
  restrictedSettings?(): 'restricted' | 'allowed' | 'unknown';
  sdkInt?(): number;

  /** The bubble's settings (bubbleSettings.ts toNative), as JSON. */
  setConfig?(json: string): void;
  /** Flo was opened: a bubble waiting since a restart may come back. */
  clearBootPause?(): void;
  isOnline?(): boolean;
  /** JSON [{id, text, at}]: questions the bubble kept while offline. */
  queued?(): string;
  /** The same, removed from the bubble (the app sends them). */
  takeQueued?(): string;
  /** JSON [{requestId, text, at}]: bubble questions whose answer came late. */
  takeLate?(): string;
  /** JSON, newest first: [{kind, text, answer?, cloud?, at}] */
  history?(): string;
  clearHistory?(): void;
  onDeviceSpeech?(): boolean;
  /** JSON SpeechSupport (src/lib/offlineSpeech.ts). */
  speechSupport?(lang: string | null): Promise<string>;
  downloadSpeech?(lang: string): Promise<boolean>;
  openSpeechSettings?(): string;
  /** JSON [{pkg, label}] */
  launchableApps?(): Promise<string>;
}

export default requireOptionalNativeModule<FloBubbleNative>('FloBubble');
