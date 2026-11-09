// Themes. Light (frosted pastel glass, the Flo look) is the default; Dark is the deep-ocean look.
//
// `colors`, `type` and every `themed(...)` style read the *current* palette at access time, so
// existing `colors.ink` / `styles.card` code follows the theme. App.tsx remounts screens when the
// theme changes (see Prefs), so nothing keeps a stale value.
import { Platform, StyleSheet, type TextStyle } from 'react-native';

export type Palette = {
  dark: boolean;
  bg: string;
  bgElevated: string;
  ink: string;
  inkSoft: string;
  inkMuted: string;
  inkFaint: string;
  sky: string;
  ocean: string;
  deep: string;
  ice: string;
  glass: string;
  glassStrong: string;
  glassBorder: string;
  glassHighlight: string;
  hairline: string;
  green: string;
  danger: string;
  amber: string;
  /** solid primary button (dark pill on light, bright pill on dark) */
  primary: string;
  onPrimary: string;
  /** backdrop blobs */
  blobA: string;
  blobB: string;
  blobC: string;
  blobD: string;
  errorBg: string;
  errorBorder: string;
  errorText: string;
};

export const LIGHT: Palette = {
  dark: false,
  bg: '#f4f5fb',
  bgElevated: '#ffffff',
  ink: '#0b1220',
  inkSoft: '#3b4457',
  inkMuted: '#6b7486',
  inkFaint: '#9aa2b2',
  sky: '#2f8cff',
  ocean: '#1a73e0',
  deep: '#dfe9ff',
  ice: '#eef5ff',
  glass: 'rgba(255, 255, 255, 0.62)',
  glassStrong: 'rgba(255, 255, 255, 0.82)',
  glassBorder: 'rgba(255, 255, 255, 0.95)',
  glassHighlight: 'rgba(255, 255, 255, 1)',
  hairline: 'rgba(20, 30, 60, 0.08)',
  green: '#1f9d6b',
  danger: '#e0405a',
  amber: '#c47a00',
  primary: '#0b1220',
  onPrimary: '#ffffff',
  blobA: '#a9dcff',
  blobB: '#d8ccff',
  blobC: '#ffd6c4',
  blobD: '#c4f0e2',
  errorBg: 'rgba(224, 64, 90, 0.08)',
  errorBorder: 'rgba(224, 64, 90, 0.25)',
  errorText: '#b3243d',
};

export const DARK: Palette = {
  dark: true,
  bg: '#05070b',
  bgElevated: '#0a0f16',
  ink: '#f2f7fb',
  inkSoft: 'rgba(226, 238, 248, 0.72)',
  inkMuted: 'rgba(200, 216, 230, 0.48)',
  inkFaint: 'rgba(200, 216, 230, 0.28)',
  sky: '#66ceff',
  ocean: '#1a9be0',
  deep: '#0b3a5c',
  ice: '#e3f6ff',
  glass: 'rgba(255, 255, 255, 0.045)',
  glassStrong: 'rgba(255, 255, 255, 0.075)',
  glassBorder: 'rgba(255, 255, 255, 0.085)',
  glassHighlight: 'rgba(255, 255, 255, 0.16)',
  hairline: 'rgba(255, 255, 255, 0.06)',
  green: '#4ade80',
  danger: '#ff6b6b',
  amber: '#f5b544',
  primary: '#e9f6ff',
  onPrimary: '#05101a',
  blobA: '#1a5fb0',
  blobB: '#3b2a7a',
  blobC: '#5a2a4a',
  blobD: '#0f4a46',
  errorBg: 'rgba(255, 107, 107, 0.08)',
  errorBorder: 'rgba(255, 107, 107, 0.25)',
  errorText: '#ffb4b4',
};

let current: Palette = LIGHT;
let version = 0;
let accent: string | null = null;

/** Switch palettes (Prefs calls this before remounting the screens). */
export function setPalette(p: Palette, accentColor?: string | null) {
  current = p;
  accent = accentColor ?? null;
  version += 1;
}
export const paletteVersion = () => version;
export const currentPalette = () => current;

function live<T extends object>(get: () => T): T {
  return new Proxy({} as T, {
    get: (_t, k) => (get() as Record<string | symbol, unknown>)[k],
    has: (_t, k) => k in get(),
    ownKeys: () => Reflect.ownKeys(get()),
    getOwnPropertyDescriptor: (_t, k) => {
      const d = Reflect.getOwnPropertyDescriptor(get(), k);
      return d ? { ...d, configurable: true } : undefined;
    },
  });
}

/** The current palette (plus the user's accent, which recolours `sky`). */
export const colors: Palette = live(() => (accent ? { ...current, sky: accent } : current));

/** Styles that follow the theme: `const styles = themed(() => StyleSheet.create({...}))`. */
export function themed<T extends object>(make: () => T): T {
  let cache: { v: number; s: T } | null = null;
  return live(() => {
    if (!cache || cache.v !== version) cache = { v: version, s: make() };
    return cache.s;
  });
}

export const radius = { sm: 14, md: 20, lg: 24, xl: 28, pill: 999 };

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  serif: 'InstrumentSerif_400Regular_Italic',
};

export const fontsLoadedFallback = Platform.select({ android: 'sans-serif', default: 'System' });

export const type = themed(
  () =>
    ({
      display: { fontFamily: fonts.bold, fontSize: 34, lineHeight: 40, letterSpacing: -1, color: colors.ink },
      title: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, letterSpacing: -0.4, color: colors.ink },
      heading: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, letterSpacing: -0.2, color: colors.ink },
      body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.inkSoft },
      small: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.inkMuted },
      micro: {
        fontFamily: fonts.semibold,
        fontSize: 11,
        lineHeight: 14,
        letterSpacing: 1.1,
        textTransform: 'uppercase',
        color: colors.inkMuted,
      },
      serif: { fontFamily: fonts.serif, fontSize: 40, lineHeight: 46, color: colors.ink },
    }) satisfies Record<string, TextStyle>,
);

/** StyleSheet.absoluteFillObject was removed from RN's public types; same thing. */
export const absFill = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

export { StyleSheet };
