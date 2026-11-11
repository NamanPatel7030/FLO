// App state: session, presence, inbox, mutes, permission, in-app banner.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { bubble } from '../lib/bubble';
import { ApiError, claimPairing, createHttpApi, type FloApi } from '../api/client';
import { createMockApi, isMockMode, MOCK_SESSION, mockOffline, mockStartScreen } from '../api/mock';
import type { InboxItem, Presence, PresenceStatus, Session } from '../api/types';
import { latestId, mergeInbox } from '../lib/inbox';
import { isMuted, type KindGroup } from '../lib/kinds';
import type { PairTarget } from '../lib/pairing';
import * as storage from '../lib/storage';
import {
  deviceName,
  ensureChannels,
  getPermission,
  getPushToken,
  installForegroundHandler,
  onForegroundPush,
  onPushTapped,
  onPushTokenChange,
  requestPermission as askPermission,
  type IncomingPush,
  type PermissionInfo,
} from '../notifications/push';

export interface Banner {
  key: string;
  kind: string;
  title: string;
  body: string;
}

interface FloState {
  booting: boolean;
  /** the signed-in API client (null until paired) */
  api: FloApi | null;
  mock: boolean;
  session: Session | null;
  presence: Presence | null;
  presenceBusy: boolean;
  inbox: InboxItem[];
  refreshing: boolean;
  mutes: storage.Mutes;
  permission: PermissionInfo;
  banner: Banner | null;
  focusId: string | null;
  error: string | null;
  /** the last try to reach Flo's server failed for lack of a connection (saved data is showing) */
  offline: boolean;
  pairedNotice: string | null;
}

interface FloActions {
  pair(target: PairTarget): Promise<void>;
  refresh(): Promise<void>;
  setPresence(status: PresenceStatus): Promise<void>;
  setMuted(group: KindGroup, muted: boolean): void;
  requestPermission(): Promise<void>;
  unpair(): Promise<void>;
  dismissBanner(): void;
  clearError(): void;
  clearFocus(): void;
}

const Ctx = createContext<(FloState & FloActions) | null>(null);

export function useFlo() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFlo outside FloProvider');
  return v;
}

const POLL_MS = 30_000;

export function FloProvider({ children }: { children: React.ReactNode }) {
  const mock = useMemo(isMockMode, []);
  const mockApi = useMemo(() => (mock ? createMockApi() : null), [mock]);

  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [presence, setPresenceState] = useState<Presence | null>(null);
  const [presenceBusy, setPresenceBusy] = useState(false);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [mutes, setMutes] = useState<storage.Mutes>({});
  const [permission, setPermission] = useState<PermissionInfo>({ state: 'undetermined', canAskAgain: true });
  const [banner, setBanner] = useState<Banner | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(() => mockOffline());
  const [pairedNotice, setPairedNotice] = useState<string | null>(null);

  const inboxRef = useRef(inbox);
  inboxRef.current = inbox;
  const mutesRef = useRef(mutes);
  mutesRef.current = mutes;

  const api: FloApi | null = useMemo(() => {
    if (mockApi) return session ? mockApi : null;
    return session ? createHttpApi(session.server, session.deviceToken) : null;
  }, [session, mockApi]);

  // the voice bubble (other apps) asks questions with this phone's pairing
  useEffect(() => {
    if (!booting && !mockApi) bubble.setSession(session?.server ?? null, session?.deviceToken ?? null);
  }, [session, booting, mockApi]);

  // ---- boot -------------------------------------------------------------
  useEffect(() => {
    installForegroundHandler();
    (async () => {
      const [s, m, cached] = await Promise.all([storage.loadSession(), storage.loadMutes(), storage.loadInboxCache()]);
      setMutes(m);
      if (mock) {
        const screen = mockStartScreen();
        const wantsPaired = screen === 'home' || screen === 'settings' || screen === 'bubble' || screen === 'speech' || (screen === 'voice' && mockOffline()) || screen === null;
        setSession(wantsPaired ? MOCK_SESSION : null);
        setPermission({ state: 'granted', canAskAgain: true });
      } else {
        setSession(s);
        setInbox(cached);
        setPermission(await getPermission().catch(() => ({ state: 'undetermined' as const, canAskAgain: true })));
      }
      setBooting(false);
    })();
  }, [mock]);

  const signOutLocally = useCallback(async (message?: string) => {
    await storage.clearAll();
    setSession(null);
    setInbox([]);
    setPresenceState(null);
    if (message) setError(message);
  }, []);

  const handleError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.isUnauthorized) {
        void signOutLocally('This phone was unpaired from your computer. Pair again to keep getting updates.');
        return;
      }
      // no connection: a calm offline state (the app shows what it saved), not an error
      if (e instanceof ApiError && e.status === 0) {
        setOffline(true);
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    },
    [signOutLocally],
  );

  // ---- data -------------------------------------------------------------
  const fetchInbox = useCallback(
    async (full: boolean) => {
      if (!api) return;
      const after = full ? undefined : latestId(inboxRef.current);
      const fresh = await api.inbox(after);
      const merged = mergeInbox(inboxRef.current, fresh);
      setInbox(merged);
      if (!mock) void storage.saveInboxCache(merged);
    },
    [api, mock],
  );

  const fetchPresence = useCallback(async () => {
    if (!api) return;
    setPresenceState(await api.getPresence());
  }, [api]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchPresence(), fetchInbox(true)]);
      setError(null);
      if (!mock) setOffline(false);
    } catch (e) {
      handleError(e);
    } finally {
      setRefreshing(false);
    }
  }, [fetchInbox, fetchPresence, handleError]);

  // Initial load + polling while in the foreground.
  useEffect(() => {
    if (!api) return;
    void refresh();
    // Only while Flo is on screen: in the background the app does no network work at all
    // (push notifications and the voice bubble don't need it).
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = () =>
      void Promise.all([fetchPresence(), fetchInbox(false)])
        .then(() => {
          if (!mock) setOffline(false);
        })
        .catch(handleError);
    const start = () => {
      if (!timer) timer = setInterval(poll, POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState !== 'background') start();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        poll();
        start();
        if (!mock) void getPermission().then(setPermission).catch(() => undefined);
      } else if (st === 'background') {
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [api, refresh, fetchPresence, fetchInbox, handleError, mock]);

  // ---- push token: register + keep fresh ---------------------------------
  useEffect(() => {
    if (!api || mock) return;
    let cancelled = false;
    const sync = async (token: string | null) => {
      if (!token || cancelled) return;
      const last = await storage.loadLastPushToken();
      if (last === token) return;
      try {
        await api.updatePushToken(token);
        await storage.saveLastPushToken(token);
      } catch (e) {
        handleError(e);
      }
    };
    void (async () => {
      await ensureChannels();
      const p = await getPermission();
      setPermission(p);
      await sync(await getPushToken());
    })();
    const off = onPushTokenChange((t) => void sync(t));
    return () => {
      cancelled = true;
      off();
    };
  }, [api, mock, handleError]);

  // ---- incoming pushes ----------------------------------------------------
  useEffect(() => {
    const showBanner = (p: IncomingPush) => {
      if (isMuted(p.kind, mutesRef.current)) return;
      setBanner({ key: `${p.id}-${Date.now()}`, kind: p.kind, title: p.title, body: p.body });
    };
    const offFg = onForegroundPush((p) => {
      showBanner(p);
      void fetchInbox(false).catch(handleError);
    });
    const offTap = onPushTapped((p) => {
      setFocusId(p.id);
      void fetchInbox(false).catch(handleError);
    });
    return () => {
      offFg();
      offTap();
    };
  }, [fetchInbox, handleError]);

  // Mock: simulate a foreground push a moment after landing on Home (for the banner screenshot).
  useEffect(() => {
    if (!mock || !session || Platform.OS !== 'web') return;
    if (!globalThis.location?.search.includes('banner')) return;
    const t = setTimeout(
      () =>
        setBanner({
          key: 'demo',
          kind: 'claude_done',
          title: 'Claude finished in api',
          body: '3 files changed · tests pass',
        }),
      600,
    );
    return () => clearTimeout(t);
  }, [mock, session]);

  // ---- actions ------------------------------------------------------------
  const pair = useCallback(
    async (target: PairTarget) => {
      setError(null);
      let res;
      if (mockApi) {
        res = await mockApi.claim();
      } else {
        await ensureChannels();
        const pushToken = (await getPushToken()) ?? undefined;
        res = await claimPairing(target.server, {
          code: target.code,
          deviceName: deviceName(),
          platform: 'android',
          pushToken,
        });
        if (pushToken) await storage.saveLastPushToken(pushToken);
      }
      const s: Session = { server: res.server, deviceToken: res.deviceToken, user: res.user };
      if (!mockApi) await storage.saveSession(s);
      setSession(s);
      setPairedNotice(res.user.name ? `Paired with ${res.user.name.split(' ')[0]}'s computer` : 'Paired with your computer');
      // Ask for notification permission right after a successful pair.
      if (!mockApi) setPermission(await askPermission().catch(() => permission));
    },
    [mockApi, permission],
  );

  const setPresence = useCallback(
    async (status: PresenceStatus) => {
      if (!api) return;
      const prev = presence;
      setPresenceBusy(true);
      setPresenceState({ status, since: new Date().toISOString() }); // optimistic
      try {
        setPresenceState(await api.setPresence(status));
      } catch (e) {
        setPresenceState(prev);
        handleError(e);
      } finally {
        setPresenceBusy(false);
      }
    },
    [api, presence, handleError],
  );

  const setMuted = useCallback((group: KindGroup, muted: boolean) => {
    setMutes((m) => {
      const next = { ...m, [group]: muted };
      void storage.saveMutes(next);
      return next;
    });
  }, []);

  const requestPermission = useCallback(async () => {
    if (mock) return;
    setPermission(await askPermission());
  }, [mock]);

  const unpair = useCallback(async () => {
    try {
      await api?.unpair();
    } catch (e) {
      // Already revoked server-side is fine; anything else we still sign out locally.
      if (!(e instanceof ApiError)) console.warn('[flo] unpair', e);
    }
    await signOutLocally();
  }, [api, signOutLocally]);

  useEffect(() => {
    if (!pairedNotice) return;
    const t = setTimeout(() => setPairedNotice(null), 3500);
    return () => clearTimeout(t);
  }, [pairedNotice]);

  const value = {
    booting,
    api,
    mock,
    session,
    presence,
    presenceBusy,
    inbox,
    refreshing,
    mutes,
    permission,
    banner,
    focusId,
    error,
    offline,
    pairedNotice,
    pair,
    refresh,
    setPresence,
    setMuted,
    requestPermission,
    unpair,
    dismissBanner: () => setBanner(null),
    clearError: () => setError(null),
    clearFocus: () => setFocusId(null),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
