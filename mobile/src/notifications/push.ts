// Android notification channels, permission, FCM device token and listeners.
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import { androidChannels } from '../lib/kinds';

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export interface PermissionInfo {
  state: PermissionState;
  /** False when Android won't show the dialog again — we must deep-link to Settings. */
  canAskAgain: boolean;
}

const isNativeAndroid = Platform.OS === 'android';

/** Create one channel per notification kind group. Safe to call repeatedly. */
export async function ensureChannels(): Promise<void> {
  if (!isNativeAndroid) return;
  for (const c of androidChannels()) {
    await Notifications.setNotificationChannelAsync(c.channelId, {
      name: c.channelName,
      description: c.channelDescription,
      importance: c.importance as Notifications.AndroidImportance,
      lightColor: c.color,
      enableLights: true,
      enableVibrate: true,
      vibrationPattern: c.importance >= 4 ? [0, 180, 120, 180] : [0, 120],
      showBadge: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }
}

export async function getPermission(): Promise<PermissionInfo> {
  if (Platform.OS === 'web') return { state: 'unsupported', canAskAgain: false };
  const p = await Notifications.getPermissionsAsync();
  return { state: p.granted ? 'granted' : (p.status as PermissionState), canAskAgain: p.canAskAgain };
}

/**
 * Ask for POST_NOTIFICATIONS (Android 13+). Channels must exist first or the
 * system dialog won't show. If the user permanently denied, open app settings.
 */
export async function requestPermission(): Promise<PermissionInfo> {
  if (Platform.OS === 'web') return { state: 'unsupported', canAskAgain: false };
  await ensureChannels();
  const current = await getPermission();
  if (current.state === 'granted') return current;
  if (!current.canAskAgain) {
    await Linking.openSettings();
    return current;
  }
  const p = await Notifications.requestPermissionsAsync();
  return { state: p.granted ? 'granted' : (p.status as PermissionState), canAskAgain: p.canAskAgain };
}

/**
 * Native FCM registration token (not an Expo push token — the server sends
 * through FCM HTTP v1 directly). Null on web/emulators without Play services
 * or when google-services.json was not bundled.
 */
export async function getPushToken(): Promise<string | null> {
  if (!isNativeAndroid || !Device.isDevice) return null;
  try {
    const t = await Notifications.getDevicePushTokenAsync();
    return typeof t.data === 'string' ? t.data : null;
  } catch (e) {
    console.warn('[flo] push token unavailable', e);
    return null;
  }
}

/** FCM rotated the token. */
export function onPushTokenChange(cb: (token: string) => void): () => void {
  if (!isNativeAndroid) return () => undefined;
  const sub = Notifications.addPushTokenListener((t) => {
    if (typeof t.data === 'string') cb(t.data);
  });
  return () => sub.remove();
}

export interface IncomingPush {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

function toIncoming(n: Notifications.Notification): IncomingPush {
  const c = n.request.content;
  const data = (c.data ?? {}) as Record<string, unknown>;
  return {
    id: typeof data.id === 'string' || typeof data.id === 'number' ? String(data.id) : n.request.identifier,
    kind: typeof data.kind === 'string' ? data.kind : 'unknown',
    title: c.title ?? '',
    body: c.body ?? '',
    data,
  };
}

/**
 * Foreground policy: never show the system heads-up while the app is open —
 * the app shows its own in-app banner instead (or nothing, if the kind is muted).
 */
export function installForegroundHandler(): void {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      // the Ask / Dictate shortcut lives in the shade even while the app is open
      const quick = (n.request.content.data as { kind?: unknown } | undefined)?.kind === QUICK_KIND;
      return { shouldShowBanner: false, shouldShowList: quick, shouldPlaySound: false, shouldSetBadge: false };
    },
  });
}

export function onForegroundPush(cb: (p: IncomingPush) => void): () => void {
  if (Platform.OS === 'web') return () => undefined;
  const sub = Notifications.addNotificationReceivedListener((n) => cb(toIncoming(n)));
  return () => sub.remove();
}

/** User tapped a notification in the tray. */
export function onPushTapped(cb: (p: IncomingPush) => void): () => void {
  if (Platform.OS === 'web') return () => undefined;
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    if ((r.notification.request.content.data as { kind?: unknown } | undefined)?.kind === QUICK_KIND) return;
    cb(toIncoming(r.notification));
  });
  return () => sub.remove();
}

export function deviceName(): string {
  const parts = [Device.manufacturer, Device.modelName].filter(Boolean) as string[];
  if (Device.deviceName) return Device.deviceName;
  if (parts.length) {
    // "Google Pixel 9" rather than "Google Google Pixel 9"
    const [maker, model] = parts;
    return model && maker && model.toLowerCase().startsWith(maker.toLowerCase()) ? model : parts.join(' ');
  }
  return 'Android phone';
}

// ── Ask Flo / Dictate shortcut ───────────────────────────────────────────────
// A quiet, ongoing notification with two buttons. Tapping one opens Flo straight into the voice
// sheet, ready to listen. (Android only lets the microphone run while Flo is on screen or in a
// foreground service, so listening starts once the sheet is open.)

export const QUICK_KIND = 'flo_quick';
const QUICK_ID = 'flo-quick-actions';
const QUICK_CHANNEL = 'flo-quick';
const QUICK_CATEGORY = 'flo-quick';
export type QuickAction = 'ask' | 'dictate';

export async function showQuickActions(): Promise<void> {
  if (!isNativeAndroid) return;
  await Notifications.setNotificationChannelAsync(QUICK_CHANNEL, {
    name: 'Ask Flo shortcut',
    description: 'A quiet shortcut in your notification shade to ask Flo or dictate.',
    importance: Notifications.AndroidImportance.LOW,
    showBadge: false,
    enableVibrate: false,
    sound: null,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  await Notifications.setNotificationCategoryAsync(QUICK_CATEGORY, [
    { identifier: 'ask', buttonTitle: 'Ask Flo', options: { opensAppToForeground: true } },
    { identifier: 'dictate', buttonTitle: 'Dictate', options: { opensAppToForeground: true } },
  ]);
  await Notifications.scheduleNotificationAsync({
    identifier: QUICK_ID,
    content: {
      title: 'Flo is ready',
      body: 'Ask your Mac anything, or dictate a note or to-do.',
      categoryIdentifier: QUICK_CATEGORY,
      data: { kind: QUICK_KIND },
      sticky: true,
      autoDismiss: false,
      priority: Notifications.AndroidNotificationPriority.LOW,
    },
    trigger: { channelId: QUICK_CHANNEL },
  });
}

export async function hideQuickActions(): Promise<void> {
  if (!isNativeAndroid) return;
  await Notifications.dismissNotificationAsync(QUICK_ID).catch(() => undefined);
  await Notifications.cancelScheduledNotificationAsync(QUICK_ID).catch(() => undefined);
}

/** Which shortcut the user tapped (null for any other notification). */
export function quickActionOf(r: Notifications.NotificationResponse): QuickAction | null {
  const data = (r.notification.request.content.data ?? {}) as { kind?: unknown };
  if (data.kind !== QUICK_KIND) return null;
  return r.actionIdentifier === 'dictate' ? 'dictate' : 'ask';
}

export function onQuickAction(cb: (a: QuickAction) => void): () => void {
  if (!isNativeAndroid) return () => undefined;
  const handle = (r: Notifications.NotificationResponse | null) => {
    const a = r ? quickActionOf(r) : null;
    if (a) cb(a);
  };
  void Notifications.getLastNotificationResponseAsync().then(handle).catch(() => undefined);
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
