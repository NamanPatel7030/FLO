// This phone's own settings: theme (Light / Dark / System), accent, the Notchling avatar,
// animations and haptics. Saved on the phone (AsyncStorage) and applied the moment they change;
// nothing here goes to your computer (that's Settings > Your computer).
//
// Changing the theme swaps the palette and remounts the screens (`themeKey`), so every themed
// style picks the new colours up at once. Animations follow both the phone's switch and Android's
// "Remove animations" (reduce motion); see ui/motion.ts.
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Appearance, type ColorSchemeName } from 'react-native';
import { DARK, LIGHT, paletteVersion, setPalette } from '../ui/theme';
import { setHaptics, setMotion } from '../ui/motion';

export { ACCENTS, DEFAULT_PREFS, parsePrefs, resolveDark, resolveMotion, themeLabel } from '../lib/prefs';
export type { Prefs, ThemeMode } from '../lib/prefs';
import { DEFAULT_PREFS, PREFS_KEY as KEY, parsePrefs, resolveDark, resolveMotion, type Prefs } from '../lib/prefs';

interface PrefsCtx {
  prefs: Prefs;
  dark: boolean;
  /** animations actually play (the phone's switch is on and Android isn't removing animations) */
  motion: boolean;
  /** Android's "Remove animations" is on, so Flo stays still whatever its own switch says */
  osReduceMotion: boolean;
  /** changes whenever the palette or motion changes; key screens on it */
  themeKey: string;
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
  const [osReduceMotion, setOsReduceMotion] = useState(false);
  const [palette, setPaletteKey] = useState(0);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => setPrefs(parsePrefs(raw)))
      .catch(() => setPrefs(DEFAULT_PREFS));
    const sub = Appearance.addChangeListener(({ colorScheme }) => setSystem(colorScheme ?? 'light'));
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => setOsReduceMotion(!!on))
      .catch(() => undefined);
    const rm = AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => setOsReduceMotion(!!on));
    return () => {
      sub.remove();
      rm?.remove();
    };
  }, []);

  const dark = prefs ? resolveDark(prefs.theme, system) : false;
  const accent = prefs?.accent ?? null;
  const motion = resolveMotion(prefs?.animations ?? true, osReduceMotion);
  const haptics = prefs?.haptics ?? true;

  // Apply before children render with them.
  useMemo(() => {
    setPalette(dark ? DARK : LIGHT, accent);
  }, [dark, accent]);
  useMemo(() => setMotion(motion), [motion]);
  useMemo(() => setHaptics(haptics), [haptics]);
  useEffect(() => {
    setPaletteKey(paletteVersion());
  }, [dark, accent]);

  const update = useCallback((p: Partial<Prefs>) => {
    setPrefs((cur) => {
      const next = { ...(cur ?? DEFAULT_PREFS), ...p };
      void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  const value = useMemo(
    () => (prefs ? { prefs, dark, motion, osReduceMotion, themeKey: `${palette}-${motion ? 'm' : 's'}`, update } : null),
    [prefs, dark, motion, osReduceMotion, palette, update],
  );
  if (!value) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
