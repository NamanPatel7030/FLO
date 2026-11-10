// Saved phone preferences: parsing and theme resolution (pure, unit-tested).
import type { ColorSchemeName } from 'react-native';
import { DEFAULT_AVATAR, type AvatarStyle } from './avatar';

export type ThemeMode = 'light' | 'dark' | 'system';
export const ACCENTS = ['#2f8cff', '#7a6cff', '#ff5c8a', '#1f9d6b', '#f08a24', '#0bb5c9'] as const;

export interface Prefs {
  theme: ThemeMode;
  /** null = the theme's own blue */
  accent: string | null;
  avatar: AvatarStyle;
  /** finished the intro once (it still shows until a phone is paired) */
  onboarded: boolean;
  /** keep the Ask / Dictate shortcut in the notification shade */
  quickActions: boolean;
  /** screen transitions, springs and the drifting backdrop (off = everything jumps into place) */
  animations: boolean;
  /** a light tap when you press buttons and toggles */
  haptics: boolean;
}

export const DEFAULT_PREFS: Prefs = { theme: 'light', accent: null, avatar: DEFAULT_AVATAR, onboarded: false, quickActions: true, animations: true, haptics: true };
export const PREFS_KEY = 'flo.prefs.v1';

/** Merge stored JSON over the defaults, dropping anything malformed (unit-tested). */
export function parsePrefs(raw: string | null): Prefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const p = JSON.parse(raw) as Partial<Prefs>;
    const theme: ThemeMode = p.theme === 'dark' || p.theme === 'system' || p.theme === 'light' ? p.theme : DEFAULT_PREFS.theme;
    const accent = typeof p.accent === 'string' && /^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent : null;
    const a = (p.avatar ?? {}) as Partial<AvatarStyle>;
    const pick = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);
    const avatar: AvatarStyle = {
      eyes: pick(a.eyes, ['classic', 'round', 'smiley', 'sparkly', 'visor'] as const, DEFAULT_AVATAR.eyes),
      glow: pick(a.glow, ['lucid', 'aurora', 'mint', 'sunset', 'accent'] as const, DEFAULT_AVATAR.glow),
      mouth: pick(a.mouth, ['wave', 'smile', 'cat'] as const, DEFAULT_AVATAR.mouth),
      extra: pick(a.extra, ['none', 'headphones', 'halo', 'sparkle'] as const, DEFAULT_AVATAR.extra),
      cheeks: typeof a.cheeks === 'boolean' ? a.cheeks : DEFAULT_AVATAR.cheeks,
    };
    return {
      theme,
      accent,
      avatar,
      onboarded: p.onboarded === true,
      quickActions: p.quickActions !== false,
      animations: p.animations !== false,
      haptics: p.haptics !== false,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function resolveDark(mode: ThemeMode, system: ColorSchemeName): boolean {
  return mode === 'dark' || (mode === 'system' && system === 'dark');
}


/** Animations play only if they're on in Flo *and* Android isn't set to remove animations. */
export function resolveMotion(animations: boolean, osReduceMotion: boolean): boolean {
  return animations && !osReduceMotion;
}

export function themeLabel(mode: ThemeMode): string {
  return mode === 'system' ? 'System' : mode === 'dark' ? 'Dark' : 'Light';
}
