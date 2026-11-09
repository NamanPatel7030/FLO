// JS side of the Flo voice bubble (android/…/FloBubbleService.kt). Absent on web and in Expo Go.
import { requireOptionalNativeModule } from 'expo';

export interface FloBubbleNative {
  setSession(server: string | null, token: string | null): void;
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  isServiceOn(): boolean;
  openSettings(): void;
}

export default requireOptionalNativeModule<FloBubbleNative>('FloBubble');
