// Notchling avatar options (shared by the mascot, Customize and saved prefs).
export type EyeStyle = 'classic' | 'round' | 'smiley' | 'sparkly' | 'visor';
export type GlowStyle = 'lucid' | 'aurora' | 'mint' | 'sunset' | 'accent';
export type MouthStyle = 'wave' | 'smile' | 'cat';
export type Extra = 'none' | 'headphones' | 'halo' | 'sparkle';
export interface AvatarStyle {
  eyes: EyeStyle;
  glow: GlowStyle;
  mouth: MouthStyle;
  extra: Extra;
  cheeks: boolean;
}
export const DEFAULT_AVATAR: AvatarStyle = { eyes: 'classic', glow: 'lucid', mouth: 'wave', extra: 'none', cheeks: true };

export const GLOWS: Record<GlowStyle, [string, string, string]> = {
  lucid: ['#c9fbff', '#7fd2ff', '#b48cff'],
  aurora: ['#d9c8ff', '#b48cff', '#ff8fc4'],
  mint: ['#d4fff0', '#6ff0c4', '#3fbfe8'],
  sunset: ['#ffe6b8', '#ffb36b', '#ff6f9a'],
  accent: ['#e3f0ff', '#2f8cff', '#7a6cff'],
};

