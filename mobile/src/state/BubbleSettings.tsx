// The voice bubble's settings: saved on this phone (AsyncStorage, like the other phone prefs) and
// handed to the bubble service the moment they change, so the bubble over other apps updates live.
// Nothing here goes to the server or your computer.
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { bubble } from '../lib/bubble';
import { BUBBLE_KEY, DEFAULT_BUBBLE, parseBubbleSettings, toNative, type BubbleSettings } from '../lib/bubbleSettings';
import { usePrefs } from './Prefs';

interface Ctx {
  settings: BubbleSettings;
  update(p: Partial<BubbleSettings>): void;
  /** replace everything (presets, resets) */
  set(next: BubbleSettings): void;
  /** the colour the bubble really uses (its own, or the app's accent) */
  accent: string;
}

const C = createContext<Ctx | null>(null);

export function useBubbleSettings(): Ctx {
  const v = useContext(C);
  if (!v) throw new Error('useBubbleSettings outside BubbleSettingsProvider');
  return v;
}

export function BubbleSettingsProvider({ children }: { children: React.ReactNode }) {
  const { prefs } = usePrefs();
  const [settings, setSettings] = useState<BubbleSettings | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(BUBBLE_KEY)
      .then((raw) => setSettings(parseBubbleSettings(raw)))
      .catch(() => setSettings(DEFAULT_BUBBLE));
    // Flo was opened: a bubble that waited since a restart ("Start on boot" off) may come back
    bubble.clearBootPause();
  }, []);

  // the service reads this on every change (it listens to its own preferences)
  const native = useMemo(() => (settings ? toNative(settings, prefs.accent) : null), [settings, prefs.accent]);
  useEffect(() => {
    if (native) bubble.setConfig(JSON.stringify(native));
  }, [native]);

  const set = useCallback((next: BubbleSettings) => {
    setSettings(next);
    void AsyncStorage.setItem(BUBBLE_KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);

  const update = useCallback((p: Partial<BubbleSettings>) => {
    setSettings((cur) => {
      const next = { ...(cur ?? DEFAULT_BUBBLE), ...p };
      void AsyncStorage.setItem(BUBBLE_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  const value = useMemo(
    () => (settings && native ? { settings, update, set, accent: native.accent } : null),
    [settings, native, update, set],
  );
  // render the app while loading with defaults (the bubble screens are never the first screen)
  return <C.Provider value={value ?? { settings: DEFAULT_BUBBLE, update, set, accent: toNative(DEFAULT_BUBBLE, prefs.accent).accent }}>{children}</C.Provider>;
}
