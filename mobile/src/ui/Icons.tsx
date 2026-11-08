// Hand-drawn stroke icons (24px grid) so the app has no icon-font dependency.
import React from 'react';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

export type IconName =
  | 'qr'
  | 'keypad'
  | 'gear'
  | 'back'
  | 'moon'
  | 'laptop'
  | 'claude'
  | 'todos'
  | 'reminders'
  | 'skills'
  | 'meetings'
  | 'general'
  | 'chevron'
  | 'bell'
  | 'bellOff'
  | 'server'
  | 'unlink'
  | 'check'
  | 'close';

const P: Record<IconName, string[]> = {
  qr: [
    'M4 4h6v6H4z',
    'M14 4h6v6h-6z',
    'M4 14h6v6H4z',
    'M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 19h1.5M19 14h1',
  ],
  keypad: ['M6 5h.01M12 5h.01M18 5h.01M6 11h.01M12 11h.01M18 11h.01M6 17h.01M12 17h.01M18 17h.01M12 21h.01'],
  gear: [
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z',
    'M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4z',
  ],
  back: ['M15 5l-7 7 7 7'],
  chevron: ['M9 5l7 7-7 7'],
  moon: ['M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z'],
  laptop: ['M5 6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5V15H5z', 'M2.5 18.5h19'],
  claude: [
    'M12 3v5.2M12 15.8V21M3 12h5.2M15.8 12H21M5.6 5.6l3.7 3.7M14.7 14.7l3.7 3.7M18.4 5.6l-3.7 3.7M9.3 14.7l-3.7 3.7',
  ],
  todos: ['M4 7l2 2 3.5-3.5', 'M4 15.5l2 2 3.5-3.5', 'M13 7.5h7M13 16h7'],
  reminders: ['M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'M12 9v4l2.5 2', 'M4.5 4.5l2.5-2M19.5 4.5l-2.5-2'],
  skills: ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z', 'M18.5 16l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z'],
  meetings: [
    'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    'M3.5 19.5c.6-3 2.8-5 5.5-5s4.9 2 5.5 5',
    'M16 5.3a3 3 0 0 1 0 5.4M17.5 14.7c1.6.7 2.7 2.5 3 4.8',
  ],
  general: ['M4 14c2.5-7 6-7 9-3.5s6.5 3.5 9-3.5'],
  bell: ['M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z', 'M10 20.5a2 2 0 0 0 4 0'],
  bellOff: ['M6 16V11a6 6 0 0 1 9.5-4.9M18 11v5l1.5 2H8', 'M10 20.5a2 2 0 0 0 4 0', 'M3 3l18 18'],
  server: ['M4 5.5h16v5H4zM4 13.5h16v5H4z', 'M7.5 8h.01M7.5 16h.01'],
  unlink: [
    'M9.5 14.5l-1.8 1.8a3.3 3.3 0 0 1-4.7-4.7l2.6-2.6a3.3 3.3 0 0 1 4.3-.3',
    'M14.5 9.5l1.8-1.8a3.3 3.3 0 0 1 4.7 4.7l-2.6 2.6a3.3 3.3 0 0 1-4.3.3',
    'M4 4l2 2M18 18l2 2',
  ],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  close: ['M6 6l12 12M18 6L6 18'],
};

export function Icon({
  name,
  size = 22,
  color = '#fff',
  strokeWidth = 1.8,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const isKeypad = name === 'keypad';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {P[name].map((d, i) => (
        <Path
          key={i}
          d={d}
          stroke={color}
          strokeWidth={isKeypad ? 3.4 : strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}

/** The Flo wave mark (from the desktop app icon). */
export function FloMark({ size = 40, glow = true }: { size?: number; glow?: boolean }) {
  return (
    <Svg width={size} height={size * 0.62} viewBox="10 14 44 27" fill="none">
      <Defs>
        <LinearGradient id="wave" x1="13" y1="20" x2="51" y2="44" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#e3f6ff" />
          <Stop offset="0.5" stopColor="#66ceff" />
          <Stop offset="1" stopColor="#1a9be0" />
        </LinearGradient>
      </Defs>
      {glow && (
        <Path
          d="M14 39c5-14 12-14 18-7s13 7 18-7"
          stroke="#66ceff"
          strokeOpacity={0.28}
          strokeWidth={3.5}
          strokeLinecap="round"
          transform="translate(0 3)"
        />
      )}
      <Path d="M14 37c5-14 12-14 18-7s13 7 18-7" stroke="url(#wave)" strokeWidth={6.5} strokeLinecap="round" />
      <Circle cx="50" cy="23" r="3.3" fill="#e3f6ff" />
    </Svg>
  );
}

/** Small rounded-square badge used as a QR glyph for the hero. */
export function QrGlyph({ size = 18, color = '#03263d' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3.5" y="3.5" width="7" height="7" rx="2" stroke={color} strokeWidth={2} />
      <Rect x="13.5" y="3.5" width="7" height="7" rx="2" stroke={color} strokeWidth={2} />
      <Rect x="3.5" y="13.5" width="7" height="7" rx="2" stroke={color} strokeWidth={2} />
      <Path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 19.5h1M19.5 14h1" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}
