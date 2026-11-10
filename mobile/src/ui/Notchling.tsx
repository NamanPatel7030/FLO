// Notchling (Classic · Lucid), Flo's mascot: the MacBook notch as a friendly intelligence.
// Same face as the Mac app and the website. Drawn with react-native-svg; motion uses Animated with
// the native driver (blink, talk, bounce, sway) and small overlay particles (hearts, confetti, zzz,
// tear, sparkles). Everything holds still under reduce-motion.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

export type Mood =
  | 'happy'
  | 'excited'
  | 'listen'
  | 'talk'
  | 'think'
  | 'celebrate'
  | 'love'
  | 'sleepy'
  | 'sad'
  | 'surprised'
  | 'proud'
  | 'worried';

import { DEFAULT_AVATAR, GLOWS, type AvatarStyle } from '../lib/avatar';
import { forever, timing } from './motion';
export { DEFAULT_AVATAR, GLOWS } from '../lib/avatar';
export type { AvatarStyle, EyeStyle, GlowStyle, MouthStyle, Extra } from '../lib/avatar';

const native = Platform.OS !== 'web';
const NOTCH = 'M18 -1 H82 V31 A25 25 0 0 1 57 56 H43 A25 25 0 0 1 18 31 Z';
const FLOAT = 'M17 24 H83 V58 A22 22 0 0 1 61 80 H39 A22 22 0 0 1 17 58 Z';

const star4 = (cx: number, cy: number, r: number) => {
  const k = r * 0.14;
  return `M${cx} ${cy - r} C${cx + k} ${cy - k} ${cx + k} ${cy - k} ${cx + r} ${cy} C${cx + k} ${cy + k} ${cx + k} ${cy + k} ${cx} ${cy + r} C${cx - k} ${cy + k} ${cx - k} ${cy + k} ${cx - r} ${cy} C${cx - k} ${cy - k} ${cx - k} ${cy - k} ${cx} ${cy - r} Z`;
};
const heart = (cx: number, cy: number, s: number) =>
  `M${cx} ${cy + s * 0.9} C${cx - s * 1.6} ${cy - s * 0.2} ${cx - s * 0.8} ${cy - s * 1.4} ${cx} ${cy - s * 0.5} C${cx + s * 0.8} ${cy - s * 1.4} ${cx + s * 1.6} ${cy - s * 0.2} ${cx} ${cy + s * 0.9} Z`;
const drop = (cx: number, cy: number, s: number) =>
  `M${cx} ${cy - s} C${cx + s * 0.9} ${cy + s * 0.1} ${cx + s * 0.75} ${cy + s} ${cx} ${cy + s} C${cx - s * 0.75} ${cy + s} ${cx - s * 0.9} ${cy + s * 0.1} ${cx} ${cy - s} Z`;

function useReduceMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => live && setR(v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setR);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return r;
}

/** Blinks every few seconds (closed for ~120 ms). */
function useBlink(on: boolean) {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (!on) return;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        setClosed(true);
        t = setTimeout(() => {
          setClosed(false);
          loop();
        }, 130);
      }, 2800 + Math.random() * 2400);
    };
    loop();
    return () => clearTimeout(t);
  }, [on]);
  return closed;
}

/** A looping 0..1 value. */
function useLoop(on: boolean, ms: number, mode: 'pingpong' | 'saw' = 'pingpong') {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) {
      v.setValue(0);
      return;
    }
    const anim =
      mode === 'saw'
        ? forever(() => timing(v, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: native }))
        : forever(() =>
            Animated.sequence([
              timing(v, { toValue: 1, duration: ms / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
              timing(v, { toValue: 0, duration: ms / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
            ]),
          );
    anim.start();
    return () => anim.stop();
  }, [on, ms, mode, v]);
  return v;
}

function Face({ mood, a, blink, talkOpen, glow }: { mood: Mood; a: AvatarStyle; blink: boolean; talkOpen: boolean; glow: string }) {
  const eye = `url(#${glow})`;
  const L = 39;
  const R = 61;
  const ey = 26;
  const pill = (x: number) =>
    blink ? (
      <Path key={x} d={`M${x - 4} ${ey} H${x + 4}`} stroke={eye} strokeWidth={2.6} strokeLinecap="round" />
    ) : (
      <Rect key={x} x={x - 3.5} y={ey - 6.2} width={7} height={12.4} rx={3.5} fill={eye} />
    );
  const round = (x: number, r = 4.8, dx = 1, dy = -1) =>
    blink ? (
      <Path key={x} d={`M${x - 4.5} ${ey} H${x + 4.5}`} stroke={eye} strokeWidth={2.6} strokeLinecap="round" />
    ) : (
      <G key={x}>
        <Circle cx={x} cy={ey} r={r} fill={eye} />
        <Circle cx={x + dx} cy={ey + dy} r={r * 0.42} fill="#0b0d16" />
      </G>
    );
  const arc = (x: number, up: boolean) => (
    <Path
      key={x}
      d={`M${x - 4.4} ${up ? ey + 2 : ey - 0.5} Q${x} ${up ? ey - 4.5 : ey + 3.8} ${x + 4.4} ${up ? ey + 2 : ey - 0.5}`}
      fill="none"
      stroke={eye}
      strokeWidth={3}
      strokeLinecap="round"
    />
  );
  const brow = (d: string) => <Path d={d} fill="none" stroke={eye} strokeWidth={2.4} strokeLinecap="round" />;

  let eyes: React.ReactNode;
  switch (mood) {
    case 'excited':
      eyes = (
        <>
          <Path d={star4(L, ey, 6.2)} fill="#ffd36b" />
          <Path d={star4(R, ey, 6.2)} fill="#ffd36b" />
        </>
      );
      break;
    case 'love':
      eyes = (
        <>
          <Path d={heart(L, ey, 4.4)} fill="#ff4f8b" />
          <Path d={heart(R, ey, 4.4)} fill="#ff4f8b" />
        </>
      );
      break;
    case 'celebrate':
    case 'proud':
      eyes = (
        <>
          {arc(L, true)}
          {arc(R, true)}
        </>
      );
      break;
    case 'sleepy':
      eyes = (
        <>
          {arc(L, false)}
          {arc(R, false)}
        </>
      );
      break;
    case 'listen':
    case 'surprised':
      eyes = (
        <>
          {round(L, mood === 'surprised' ? 5.8 : 4.8, 0, 0)}
          {round(R, mood === 'surprised' ? 5.8 : 4.8, 0, 0)}
        </>
      );
      break;
    case 'think':
      eyes = (
        <>
          {round(L, 4.6, 2, -2)}
          {round(R, 4.6, 2, -2)}
        </>
      );
      break;
    case 'sad':
      eyes = (
        <>
          {brow('M34 17 L43 14')}
          {brow('M66 17 L57 14')}
          <Path d="M35 26 Q39 30.5 43 26" fill={eye} />
          <Path d="M57 26 Q61 30.5 65 26" fill={eye} />
        </>
      );
      break;
    case 'worried':
      eyes = (
        <>
          {brow('M34 18 L43 15')}
          {brow('M66 18 L57 15')}
          {round(L, 4.2, 0, 1)}
          {round(R, 4.2, 0, 1)}
        </>
      );
      break;
    default:
      if (a.eyes === 'round') eyes = <>{round(L)}{round(R)}</>;
      else if (a.eyes === 'smiley') eyes = <>{arc(L, true)}{arc(R, true)}</>;
      else if (a.eyes === 'sparkly')
        eyes = (
          <>
            <Path d={star4(L, ey, 6)} fill={eye} />
            <Path d={star4(R, ey, 6)} fill={eye} />
          </>
        );
      else if (a.eyes === 'visor')
        eyes = (
          <>
            <Rect x={28} y={ey - 6} width={44} height={12} rx={6} fill={eye} />
            <Path d={`M32 ${ey - 3} H54`} stroke="#fff" strokeWidth={1.7} strokeLinecap="round" opacity={0.65} />
          </>
        );
      else eyes = <>{pill(L)}{pill(R)}</>;
  }

  const mouthC = '#5fb8ff';
  const my = 42;
  let mouth: React.ReactNode;
  if (mood === 'talk' || mood === 'listen' || mood === 'surprised') {
    const ry = mood === 'surprised' ? 5 : talkOpen ? 3.8 : 1.6;
    mouth = <Ellipse cx={50} cy={my} rx={mood === 'surprised' ? 3.8 : 2.8} ry={ry} fill={mouthC} />;
  } else if (mood === 'excited' || mood === 'celebrate') {
    mouth = (
      <>
        <Path d={`M43.5 ${my - 2} Q50 ${my - 2.5} 56.5 ${my - 2} Q55 ${my + 7} 50 ${my + 7} Q45 ${my + 7} 43.5 ${my - 2} Z`} fill={mouthC} />
        <Path d={`M46.5 ${my + 4.6} Q50 ${my + 2.4} 53.5 ${my + 4.6} Q50 ${my + 6.8} 46.5 ${my + 4.6} Z`} fill="#ff5c8a" />
      </>
    );
  } else if (mood === 'sad') {
    mouth = <Path d={`M45 ${my + 2.5} Q50 ${my - 2.5} 55 ${my + 2.5}`} fill="none" stroke={mouthC} strokeWidth={2.6} strokeLinecap="round" />;
  } else if (mood === 'worried') {
    mouth = <Path d={`M44 ${my} q1.5 -2 3 0 t3 0 t3 0 t3 0`} fill="none" stroke={mouthC} strokeWidth={2.3} strokeLinecap="round" />;
  } else if (mood === 'think') {
    mouth = <Path d={`M46 ${my} H54`} stroke={mouthC} strokeWidth={2.6} strokeLinecap="round" />;
  } else if (mood === 'proud') {
    mouth = <Path d={`M45 ${my + 1} Q51 ${my + 3.8} 56 ${my - 2}`} fill="none" stroke={mouthC} strokeWidth={2.6} strokeLinecap="round" />;
  } else if (a.mouth === 'smile' || mood === 'love' || mood === 'sleepy') {
    mouth = <Path d={`M45 ${my - 1} Q50 ${my + 4.5} 55 ${my - 1}`} fill="none" stroke={mouthC} strokeWidth={2.6} strokeLinecap="round" />;
  } else if (a.mouth === 'cat') {
    mouth = (
      <Path d={`M44 ${my - 1} Q47 ${my + 2.6} 50 ${my - 1} Q53 ${my + 2.6} 56 ${my - 1}`} fill="none" stroke={mouthC} strokeWidth={2.4} strokeLinecap="round" />
    );
  } else {
    mouth = (
      <Path
        d={talkOpen ? `M43.5 ${my} C46 ${my + 3} 48.4 ${my + 3} 50 ${my} S54 ${my - 3} 56.5 ${my}` : `M43.5 ${my} C46 ${my + 2} 48.4 ${my + 2} 50 ${my} S54 ${my - 2} 56.5 ${my}`}
        fill="none"
        stroke={mouthC}
        strokeWidth={2.6}
        strokeLinecap="round"
      />
    );
  }
  const cheeks =
    a.cheeks && !['sad', 'worried', 'think', 'listen'].includes(mood) ? (
      <>
        <Circle cx={30.5} cy={41} r={3.6} fill="#ff8fb8" opacity={0.42} />
        <Circle cx={69.5} cy={41} r={3.6} fill="#ff8fb8" opacity={0.42} />
      </>
    ) : null;
  return (
    <>
      {eyes}
      {cheeks}
      {mouth}
    </>
  );
}

/** Small particles that float over the character (absolutely positioned, percentage-based). */
function Particles({ mood, size, reduce }: { mood: Mood; size: number; reduce: boolean }) {
  const t = useLoop(!reduce, mood === 'celebrate' ? 2200 : 2600, 'saw');
  const kind =
    mood === 'love' ? 'hearts' : mood === 'celebrate' ? 'confetti' : mood === 'sleepy' ? 'zzz' : mood === 'sad' ? 'tear' : mood === 'excited' || mood === 'proud' ? 'sparkle' : null;
  if (!kind) return null;
  const u = size / 100;
  const rise = t.interpolate({ inputRange: [0, 1], outputRange: [6 * u, -14 * u] });
  const fall = t.interpolate({ inputRange: [0, 1], outputRange: [-4 * u, 22 * u] });
  const fade = t.interpolate({ inputRange: [0, 0.2, 0.75, 1], outputRange: [0, 1, 1, 0] });
  const spin = t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '220deg'] });
  const at = (x: number, y: number, w: number): object => ({ position: 'absolute', left: x * u - w / 2, top: y * u - w / 2, width: w, height: w });
  const svg = (w: number, children: React.ReactNode, vb = '0 0 20 20') => (
    <Svg width={w} height={w} viewBox={vb}>
      {children}
    </Svg>
  );
  if (kind === 'hearts')
    return (
      <>
        {[
          [80, 74, 12],
          [22, 80, 9],
        ].map(([x, y, w], i) => (
          <Animated.View key={i} style={[at(x, y, w * u), { opacity: fade, transform: [{ translateY: rise }] }]}>
            {svg(w * u, <Path d={heart(10, 11, 7)} fill="#ff4f8b" />)}
          </Animated.View>
        ))}
      </>
    );
  if (kind === 'confetti')
    return (
      <>
        {['#ff5c8a', '#ffd36b', '#5fd3b0', '#7cc4ff', '#b38cff', '#ff9a5c'].map((c, i) => (
          <Animated.View
            key={c}
            style={[
              at(16 + i * 13, 58 + (i % 2) * 6, 7 * u),
              { opacity: fade, transform: [{ translateY: fall }, { rotate: spin }] },
            ]}
          >
            <View style={{ width: 3.4 * u, height: 6 * u, borderRadius: u, backgroundColor: c }} />
          </Animated.View>
        ))}
      </>
    );
  if (kind === 'zzz')
    return (
      <Animated.View style={[at(80, 70, 22 * u), { opacity: fade, transform: [{ translateY: rise }] }]}>
        {svg(
          22 * u,
          <>
            <SvgText x="2" y="18" fontSize="11" fontWeight="800" fill="#7a6cff">
              z
            </SvgText>
            <SvgText x="10" y="10" fontSize="8" fontWeight="800" fill="#7a6cff">
              z
            </SvgText>
          </>,
        )}
      </Animated.View>
    );
  if (kind === 'tear')
    return (
      <Animated.View style={[at(36, 36, 8 * u), { opacity: fade, transform: [{ translateY: fall }] }]}>
        {svg(8 * u, <Path d={drop(10, 10, 7)} fill="#7cc4ff" />)}
      </Animated.View>
    );
  return (
    <>
      {[
        [82, 70, 12],
        [20, 76, 8],
      ].map(([x, y, w], i) => (
        <Animated.View key={i} style={[at(x, y, w * u), { opacity: fade, transform: [{ scale: fade }] }]}>
          {svg(w * u, <Path d={star4(10, 10, 9)} fill="#ffffff" />)}
        </Animated.View>
      ))}
    </>
  );
}

/**
 * The mascot. `plate` draws the pastel app-icon tile behind it (the logo); without it, just the
 * character. `pose="float"` is the floating capsule used in onboarding and empty states.
 */
export function Notchling({
  mood = 'happy',
  size = 120,
  plate = true,
  pose = 'hang',
  avatar = DEFAULT_AVATAR,
  accent,
  testID,
}: {
  mood?: Mood;
  size?: number;
  plate?: boolean;
  pose?: 'hang' | 'float';
  avatar?: AvatarStyle;
  accent?: string;
  testID?: string;
}) {
  const reduce = useReduceMotion();
  const blink = useBlink(!reduce && !['sleepy', 'celebrate', 'proud', 'love', 'excited', 'sad'].includes(mood));
  const talking = mood === 'talk' || mood === 'listen' || (avatar.mouth === 'wave' && mood === 'happy');
  const [talkOpen, setTalkOpen] = useState(false);
  useEffect(() => {
    if (reduce || !talking) return setTalkOpen(false);
    const id = setInterval(() => setTalkOpen((o) => !o), mood === 'talk' ? 190 : mood === 'listen' ? 350 : 1200);
    return () => clearInterval(id);
  }, [reduce, talking, mood]);
  const bounceOn = !reduce && ['excited', 'celebrate'].includes(mood);
  const swayOn = !reduce && ['love', 'proud', 'think', 'sleepy'].includes(mood);
  const floatOn = !reduce && pose === 'float';
  const bounce = useLoop(bounceOn, mood === 'celebrate' ? 1400 : 900);
  const sway = useLoop(swayOn, mood === 'sleepy' ? 3600 : 4200);
  const bob = useLoop(floatOn, 3600);
  const u = size / 100;

  const glowStops = GLOWS[avatar.glow === 'accent' && accent ? 'accent' : avatar.glow];
  const glowId = useMemo(() => `g${Math.random().toString(36).slice(2, 8)}`, []);
  const ids = useMemo(() => ({ plate: `${glowId}p`, body: `${glowId}b`, sheen: `${glowId}s`, acc: `${glowId}a` }), [glowId]);

  const bodyTransform = [
    { translateY: Animated.add(bounce.interpolate({ inputRange: [0, 1], outputRange: [0, 5 * u] }), bob.interpolate({ inputRange: [0, 1], outputRange: [0, -3 * u] })) },
    { rotate: sway.interpolate({ inputRange: [0, 1], outputRange: !swayOn ? ['0deg', '0deg'] : mood === 'sleepy' ? ['-2deg', '2deg'] : ['-5deg', '5deg'] }) },
  ];
  const d = pose === 'float' ? FLOAT : NOTCH;
  const faceDy = pose === 'float' ? 24 : 0;

  return (
    <View testID={testID} style={{ width: size, height: size }} accessibilityRole="image" accessibilityLabel={`Notchling, ${mood}`}>
      {plate && (
        <Svg style={StyleSheet.absoluteFill} width={size} height={size} viewBox="0 0 100 100">
          <Defs>
            <LinearGradient id={ids.plate} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#a9dcff" />
              <Stop offset="0.5" stopColor="#c7b6ff" />
              <Stop offset="1" stopColor="#ffc2d6" />
            </LinearGradient>
            <LinearGradient id={ids.sheen} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#ffffff" stopOpacity={0.3} />
              <Stop offset="0.45" stopColor="#ffffff" stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect width={100} height={100} rx={23} fill={`url(#${ids.plate})`} />
          <Rect width={100} height={100} rx={23} fill={`url(#${ids.sheen})`} />
          <Rect x={0.5} y={0.5} width={99} height={99} rx={22.5} fill="none" stroke="#ffffff" strokeOpacity={0.35} />
        </Svg>
      )}
      {pose === 'float' && (
        <Svg style={StyleSheet.absoluteFill} width={size} height={size} viewBox="0 0 100 100">
          <Ellipse cx={50} cy={90} rx={22} ry={3.2} fill="#3a2c7a" opacity={0.18} />
        </Svg>
      )}
      <Animated.View style={[StyleSheet.absoluteFill, { transform: bodyTransform }]}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Defs>
            <LinearGradient id={glowId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={glowStops[0]} />
              <Stop offset="0.5" stopColor={glowStops[1]} />
              <Stop offset="1" stopColor={glowStops[2]} />
            </LinearGradient>
            <LinearGradient id={ids.body} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#1a1d2e" />
              <Stop offset="1" stopColor="#08090f" />
            </LinearGradient>
            <LinearGradient id={ids.acc} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={glowStops[1]} />
              <Stop offset="1" stopColor={glowStops[2]} />
            </LinearGradient>
          </Defs>
          {mood === 'sad' && plate && <Rect width={100} height={100} rx={23} fill="#8a90a6" opacity={0.35} />}
          <Path d={d} fill={`url(#${ids.body})`} />
          <G transform={`translate(0 ${faceDy})`}>
            <Face mood={mood} a={avatar} blink={blink} talkOpen={talkOpen} glow={glowId} />
          </G>
          {avatar.extra === 'headphones' && (
            <>
              <Rect x={9} y={16 + faceDy} width={9} height={20} rx={4.5} fill={`url(#${ids.acc})`} />
              <Rect x={82} y={16 + faceDy} width={9} height={20} rx={4.5} fill={`url(#${ids.acc})`} />
            </>
          )}
          {avatar.extra === 'halo' && <Ellipse cx={50} cy={(pose === 'float' ? 84 : 66)} rx={28} ry={4.4} fill="none" stroke={glowStops[1]} strokeWidth={2} opacity={0.85} />}
          {avatar.extra === 'sparkle' && <Path d={star4(82, 70, 5.5)} fill="#ffffff" />}
        </Svg>
      </Animated.View>
      <Particles mood={mood} size={size} reduce={reduce} />
    </View>
  );
}
