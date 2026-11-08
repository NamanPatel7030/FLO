import { Platform, type TextStyle } from 'react-native';

export const colors = {
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
};

export const radius = { sm: 14, md: 20, lg: 24, xl: 28, pill: 999 };

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
};

export const fontsLoadedFallback = Platform.select({ android: 'sans-serif', default: 'System' });

export const type = {
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
} satisfies Record<string, TextStyle>;

/** StyleSheet.absoluteFillObject was removed from RN's public types; same thing. */
export const absFill = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;
