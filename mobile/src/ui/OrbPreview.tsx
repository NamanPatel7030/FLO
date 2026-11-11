// A faithful SVG twin of the native bubble (modules/flo-bubble FloOrb.kt) for the live preview in
// Settings and the web screenshots: same geometry, gradients, ring states and offline pip.
import React, { useEffect, useState } from 'react';
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import { motionOn } from './motion';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'done' | 'error';

const ORB_LIGHT = '#3d5bd9';
const ORB_MID = '#16237a';
const ORB_DEEP = '#070c2c';
const MARK_LIGHT = '#e9f7ff';
const GREEN = '#34d399';
const RED = '#f87171';
const WARN = '#fbbf24';
const ASK = '#7a6cff';
const SPIKES = 44;
/** room around the orb, in dp, same as FloBubble.pad */
export const ORB_PAD = 13;

function hex(c: string): [number, number, number] {
  const n = parseInt(c.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mix(a: string, b: string, t: number): string {
  const x = hex(a);
  const y = hex(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** The ring colour for a mode, like FloBubbleService.modeColor. */
export function orbColor(state: OrbState, mode: 'dictate' | 'ask', accent: string): string {
  if (state === 'done') return GREEN;
  if (state === 'error') return RED;
  if (mode === 'ask') return accent.toLowerCase() === ASK ? '#b9b3ff' : ASK;
  return accent;
}

export function OrbPreview({
  size = 46,
  accent,
  state = 'idle',
  mode = 'dictate',
  offline = false,
  level = 0.7,
  animate = true,
  testID,
  pad = ORB_PAD,
}: {
  /** room around the orb (dp); smaller for an icon-sized orb */
  pad?: number;
  /** orb diameter (dp) */
  size?: number;
  accent: string;
  state?: OrbState;
  mode?: 'dictate' | 'ask';
  offline?: boolean;
  /** 0..1 voice level while listening */
  level?: number;
  /** run the listening / thinking motion (off for still screenshots) */
  animate?: boolean;
  testID?: string;
}) {
  const [t, setT] = useState(0.8);
  const moving = animate && motionOn() && (state === 'listening' || state === 'thinking');
  useEffect(() => {
    if (!moving) return;
    const start = Date.now();
    const id = setInterval(() => setT((Date.now() - start) / 1000), 50);
    return () => clearInterval(id);
  }, [moving]);

  const W = size + 2 * pad;
  const cx = W / 2;
  const cy = W / 2;
  const r = size / 2;
  const ringR = r + 3;
  const ring = orbColor(state, mode, accent);
  const k = (r * 1.04) / 44;
  const markEnd = mix(MARK_LIGHT, accent, 0.55);
  const shown = state === 'listening' ? level : 0;
  const scale = state === 'listening' ? 1 + 0.05 * shown : 1;
  const phase = (t / 1.1) % 1;
  const gid = `${Math.round(size)}${accent.replace('#', '')}`;

  return (
    <Svg width={W} height={W} viewBox={`0 0 ${W} ${W}`} testID={testID}>
      <Defs>
        <RadialGradient id={`body${gid}`} cx={cx - r * 0.35} cy={cy - r * 0.45} r={r * 1.45} fx={cx - r * 0.35} fy={cy - r * 0.45} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={mix(ORB_LIGHT, accent, 0.3)} />
          <Stop offset="0.55" stopColor={mix(ORB_MID, accent, 0.12)} />
          <Stop offset="1" stopColor={ORB_DEEP} />
        </RadialGradient>
        <RadialGradient id={`glow${gid}`} cx={cx} cy={cy + r * 0.75} r={r * 0.95} fx={cx} fy={cy + r * 0.75} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={accent} stopOpacity={0.59} />
          <Stop offset="1" stopColor={accent} stopOpacity={0} />
        </RadialGradient>
        <LinearGradient id={`gloss${gid}`} x1={0} y1={cy - r * 0.92} x2={0} y2={cy - r * 0.05} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#ffffff" stopOpacity={0.43} />
          <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </LinearGradient>
        <LinearGradient id={`mark${gid}`} x1={14} y1={37} x2={50} y2={23} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={MARK_LIGHT} />
          <Stop offset="1" stopColor={markEnd} />
        </LinearGradient>
      </Defs>

      {/* soft shadow */}
      <Circle cx={cx} cy={cy + 2.5} r={r + 1} fill="#000" opacity={0.22} />
      <G transform={`translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`}>
        <Circle cx={cx} cy={cy} r={r} fill={`url(#body${gid})`} />
        <Circle cx={cx} cy={cy} r={r} fill={`url(#glow${gid})`} />
        {state === 'done' && <Circle cx={cx} cy={cy} r={r} fill={GREEN} opacity={0.24} />}
        <Ellipse cx={cx} cy={cy - r * 0.46} rx={r * 0.66} ry={r * 0.44} fill={`url(#gloss${gid})`} />
        <Circle cx={cx} cy={cy} r={r - 0.5} stroke="#ffffff" strokeOpacity={0.22} strokeWidth={1} fill="none" />
        {state === 'done' ? (
          <Path
            d={`M${cx - r * 0.36} ${cy + r * 0.02}L${cx - r * 0.1} ${cy + r * 0.28}L${cx + r * 0.38} ${cy - r * 0.26}`}
            stroke="#fff"
            strokeWidth={r * 0.16}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ) : (
          <G transform={`translate(${cx} ${cy + r * 0.04}) scale(${k}) translate(-32 -27.5)`}>
            <Path d="M14 37C19 23 26 23 32 30C38 37 45 37 50 23" stroke={`url(#mark${gid})`} strokeWidth={6.2} strokeLinecap="round" fill="none" />
            <Circle cx={50} cy={23} r={3.1} fill={MARK_LIGHT} />
          </G>
        )}
      </G>

      {state === 'idle' && <Circle cx={cx} cy={cy} r={ringR} stroke={ring} strokeOpacity={0.59} strokeWidth={1.5} fill="none" />}
      {state === 'listening' && (
        <G>
          <Circle cx={cx} cy={cy} r={r + 2.5} stroke={ring} strokeOpacity={0.27} strokeWidth={1.5} fill="none" />
          {Array.from({ length: SPIKES }, (_, i) => {
            const a = (i / SPIKES) * Math.PI * 2 - Math.PI / 2;
            const n = 0.6 * (0.5 + 0.5 * Math.sin(t * 5.6 + i * 0.71)) + 0.4 * (0.5 + 0.5 * Math.sin(t * 10.7 - i * 1.33));
            const len = 1.2 + 6.5 * shown * (0.25 + 0.75 * n);
            const r0 = r + 2.5;
            const op = Math.min(1, (120 + 135 * (0.3 + 0.7 * shown * n)) / 255);
            return (
              <Line
                key={i}
                x1={cx + Math.cos(a) * r0}
                y1={cy + Math.sin(a) * r0}
                x2={cx + Math.cos(a) * (r0 + len)}
                y2={cy + Math.sin(a) * (r0 + len)}
                stroke={ring}
                strokeOpacity={op}
                strokeWidth={2}
                strokeLinecap="round"
              />
            );
          })}
        </G>
      )}
      {state === 'thinking' && (
        <G>
          <Circle cx={cx} cy={cy} r={ringR} stroke={ring} strokeOpacity={0.19} strokeWidth={1.5} fill="none" />
          <G transform={`rotate(${phase * 360} ${cx} ${cy})`}>
            {Array.from({ length: 14 }, (_, i) => {
              const a0 = ((-162 + i * 11.6) * Math.PI) / 180;
              const a1 = ((-162 + (i + 1) * 11.6) * Math.PI) / 180;
              return (
                <Path
                  key={i}
                  d={`M${cx + Math.cos(a0) * ringR} ${cy + Math.sin(a0) * ringR}A${ringR} ${ringR} 0 0 1 ${cx + Math.cos(a1) * ringR} ${cy + Math.sin(a1) * ringR}`}
                  stroke={ring}
                  strokeOpacity={(i + 1) / 14}
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  fill="none"
                />
              );
            })}
            <Circle cx={cx + ringR} cy={cy} r={2} fill={ring} />
          </G>
        </G>
      )}
      {state === 'done' && <Circle cx={cx} cy={cy} r={ringR} stroke={GREEN} strokeWidth={1.5} fill="none" />}
      {state === 'error' && <Circle cx={cx} cy={cy} r={ringR} stroke={RED} strokeWidth={1.5} fill="none" />}

      {offline && (
        <G>
          <Circle cx={cx + Math.cos(-Math.PI / 4) * r * 0.8} cy={cy + Math.sin(-Math.PI / 4) * r * 0.8} r={r * 0.19} fill={WARN} stroke="#0b1220" strokeWidth={1.5} />
        </G>
      )}
    </Svg>
  );
}
