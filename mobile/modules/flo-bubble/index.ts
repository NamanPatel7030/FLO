// JS side of the Flo voice bubble (android/…/FloBubbleService.kt). Absent on web and in Expo Go.
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
}

export default requireOptionalNativeModule<FloBubbleNative>('FloBubble');
