// Persistence: the device session (token) lives in the OS keystore via
// expo-secure-store; non-secret prefs + inbox cache in AsyncStorage.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { ComputerState, InboxItem, Session } from '../api/types';
import type { KindGroup } from './kinds';

const SESSION_KEY = 'flo.session.v1';
const PUSH_TOKEN_KEY = 'flo.pushToken.v1';
const MUTES_KEY = 'flo.mutes.v1';
const INBOX_KEY = 'flo.inbox.v1';
const COMPUTER_KEY = 'flo.computer.v1';
/** questions kept offline (lib/offlineQueue.ts QUEUE_KEY): this account's, gone when unpaired */
const ASK_QUEUE_KEY = 'flo.askQueue.v1';

export type Mutes = Partial<Record<KindGroup, boolean>>;

// Web has no keystore; only used for the visual preview build.
const secure = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch {
        /* ignore */
      }
      return;
    }
    await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
  },
  async del(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        globalThis.localStorage?.removeItem(key);
      } catch {
        /* ignore */
      }
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function loadSession(): Promise<Session | null> {
  try {
    const raw = await secure.get(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return s && typeof s.deviceToken === 'string' && typeof s.server === 'string' ? s : null;
  } catch {
    return null;
  }
}

export const saveSession = (s: Session) => secure.set(SESSION_KEY, JSON.stringify(s));

export async function clearAll(): Promise<void> {
  await secure.del(SESSION_KEY);
  await AsyncStorage.multiRemove([PUSH_TOKEN_KEY, INBOX_KEY, COMPUTER_KEY, ASK_QUEUE_KEY]).catch(() => undefined);
}

/** The last computer snapshot, so to-dos and computer settings open offline. */
export async function loadComputerCache(): Promise<{ state: ComputerState; updatedAt: string | null } | null> {
  const c = await readJson<{ state?: ComputerState; updatedAt?: string | null } | null>(COMPUTER_KEY, null);
  if (!c || !c.state || typeof c.state !== 'object' || !Array.isArray((c.state as ComputerState).sessions)) return null;
  return { state: c.state, updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : null };
}
export const saveComputerCache = (c: { state: ComputerState; updatedAt: string | null }) =>
  AsyncStorage.setItem(COMPUTER_KEY, JSON.stringify(c)).catch(() => undefined);

export const loadLastPushToken = () => AsyncStorage.getItem(PUSH_TOKEN_KEY).catch(() => null);
export const saveLastPushToken = (t: string) => AsyncStorage.setItem(PUSH_TOKEN_KEY, t).catch(() => undefined);

export const loadMutes = () => readJson<Mutes>(MUTES_KEY, {});
export const saveMutes = (m: Mutes) => AsyncStorage.setItem(MUTES_KEY, JSON.stringify(m)).catch(() => undefined);

export const loadInboxCache = () => readJson<InboxItem[]>(INBOX_KEY, []);
export const saveInboxCache = (items: InboxItem[]) =>
  AsyncStorage.setItem(INBOX_KEY, JSON.stringify(items)).catch(() => undefined);
