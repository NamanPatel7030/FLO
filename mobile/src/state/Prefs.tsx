// The phone's own look: theme (Light / Dark / System), accent colour and the Notchling avatar.
// Saved on the phone (AsyncStorage). Changing the theme swaps the palette and remounts the
// screens (`themeKey`), so every themed style picks the new colours up at once.
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, type ColorSchemeName } from 'react-native';
import { DARK, LIGHT, paletteVersion, setPalette } from '../ui/theme';

export { ACCENTS, DEFAULT_PREFS, parsePrefs, resolveDark } from '../lib/prefs';
export type { Prefs, ThemeMode } from '../lib/prefs';
import { DEFAULT_PREFS, PREFS_KEY as KEY, parsePrefs, resolveDark, type Prefs } from '../lib/prefs';

interface PrefsCtx {
  prefs: Prefs;
  dark: boolean;
  /** changes whenever the palette changes; key screens on it */
  themeKey: number;
  update(p: Partial<Prefs>): void;
}

const Ctx = createContext<PrefsCtx | null>(null);

export function usePrefs() {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePrefs outside PrefsProvider');
  return v;
}

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [system, setSystem] = useState<ColorSchemeName>(Appearance.getColorScheme() ?? 'light');
  const [themeKey, setThemeKey] = useState(0);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => setPrefs(parsePrefs(raw)))
      .catch(() => setPrefs(DEFAULT_PREFS));
    const sub = Appearance.addChangeListener(({ colorScheme }) => setSystem(colorScheme ?? 'light'));
    return () => sub.remove();
  }, []);

  const dark = prefs ? resolveDark(prefs.theme, system) : false;
  const accent = prefs?.accent ?? null;

  // Swap the palette before children render with it.
  useMemo(() => {
    setPalette(dark ? DARK : LIGHT, accent);
  }, [dark, accent]);
  useEffect(() => {
    setThemeKey(paletteVersion());
  }, [dark, accent]);

  const update = useCallback((p: Partial<Prefs>) => {
    setPrefs((cur) => {
      const next = { ...(cur ?? DEFAULT_PREFS), ...p };
      void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  if (!prefs) return null;
  return <Ctx.Provider value={{ prefs, dark, themeKey, update }}>{children}</Ctx.Provider>;
}
