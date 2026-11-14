// A faithful SVG twin of the native bubble (modules/flo-bubble FloOrb.kt) for the live preview in
// Settings and the web screenshots: same five looks, geometry, gradients, ring states and offline
// pip. __tests__/orbParity.test.ts reads FloOrb.kt to keep the shared constants in step.
import React, { useEffect, useState } from 'react';
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { ORB_PAD, bodySize, companion, mixHex, type BubbleStyle } from '../lib/bubbleSettings';
import { motionOn } from './motion';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'done' | 'error';

export const ORB_COLORS = {
  ORB_LIGHT: '#3d5bd9',
  ORB_MID: '#16237a',
  ORB_DEEP: '#070c2c',
  MARK_LIGHT: '#e9f7ff',
  GREEN: '#34d399',
  RED: '#f87171',
  WARN: '#fbbf24',
  INK: '#0b1220',
} as const;
const { ORB_LIGHT, ORB_MID, ORB_DEEP, MARK_LIGHT, GREEN, RED, WARN, INK } = ORB_COLORS;
const ASK = '#7a6cff';
export const SPIKES = 44;
/** the glass look's dark fill, out of 255 (FloOrb.GLASS_ALPHA) */
export const GLASS_ALPHA = 107;
/** the pill's half-width × this = the mark's radius (FloOrb.PILL_MARK) */
export const PILL_MARK = 1.25;
export { ORB_PAD };

/** @deprecated use mixHex */
export const mix = mixHex;

/** The ring colour for a mode, like FloBubbleService.modeColor. */
export function orbColor(state: OrbState, mode: 'dictate' | 'ask', accent: string): string {
  if (state === 'done') return GREEN;
  if (state === 'error') return RED;
  if (mode === 'ask') return accent.toLowerCase() === ASK ? '#b9b3ff' : ASK;
  return accent;
}

/** An SVG rounded-rect path starting at (x + r, y), clockwise: the same path FloOrb.roundRectPath builds. */
function roundRectD(x: number, y: number, w: number, h: number, r: number): string {
  const R = x + w;
  const B = y + h;
  return `M${x + r} ${y}H${R - r}A${r} ${r} 0 0 1 ${R} ${y + r}V${B - r}A${r} ${r} 0 0 1 ${R - r} ${B}H${x + r}A${r} ${r} 0 0 1 ${x} ${B - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

function roundRectLength(w: number, h: number, r: number): number {
  return 2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r;
}

export function OrbPreview({
  look = 'orb',
  size = 46,
  accent,
  accent2,
  state = 'idle',
  mode = 'dictate',
  offline = false,
  level = 0.7,
  animate = true,
  testID,
  pad = ORB_PAD,
}: {
  look?: BubbleStyle;
  /** room around the body (dp); smaller for an icon-sized bubble */
  pad?: number;
  /** diameter (dp) */
  size?: number;
  accent: string;
  /** far end of the gradient (defaults to a lighter shade of [accent]) */
  accent2?: string;
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

  const a2 = accent2 ?? companion(accent);
  const { w: bw, h: bh } = bodySize(look, size);
  const W = bw + 2 * pad;
  const H = bh + 2 * pad;
  const cx = W / 2;
  const cy = H / 2;
  const hw = bw / 2;
  const hh = bh / 2;
  const r = Math.min(bw, bh) / 2;
  const round = look !== 'pill';
  const ringR = r + 3;
  const ring = orbColor(state, mode, accent);
  const mr = look === 'pill' ? hw * PILL_MARK : r;
  const k = (mr * 1.04) / 44;
  const shown = state === 'listening' ? level : 0;
  const scale = state === 'listening' ? 1 + 0.05 * shown : 1;
  const phase = (t / 1.1) % 1;
  const gid = `${look}${Math.round(size)}${accent.replace('#', '')}${a2.replace('#', '')}`;
  const rimW = look === 'glass' ? 1.5 : 1;
  const bodyD = round ? undefined : roundRectD(cx - hw, cy - hh, bw, bh, hw);
  const gap = 3;
  const ringD = roundRectD(cx - hw - gap, cy - hh - gap, bw + 2 * gap, bh + 2 * gap, hw + gap);
  const ringLen = roundRectLength(bw + 2 * gap, bh + 2 * gap, hw + gap);

  const fill = (id: string) => `url(#${id}${gid})`;
  const shapeEl = (paint: string, extra: object = {}) =>
    round ? <Circle cx={cx} cy={cy} r={r} fill={paint} {...extra} /> : <Path d={bodyD} fill={paint} {...extra} />;

  const markEl = (
    <G transform={`translate(${cx} ${cy + mr * 0.04}) scale(${k}) translate(-32 -27.5)`}>
      <Path d="M14 37C19 23 26 23 32 30C38 37 45 37 50 23" stroke={look === 'orb' ? fill('mark') : MARK_LIGHT} strokeWidth={6.2} strokeLinecap="round" fill="none" />
      <Circle cx={50} cy={23} r={3.1} fill={MARK_LIGHT} />
    </G>
  );
  const checkEl = (
    <Path
      d={`M${cx - r * 0.36} ${cy + r * 0.02}L${cx - r * 0.1} ${cy + r * 0.28}L${cx + r * 0.38} ${cy - r * 0.26}`}
      stroke="#fff"
      strokeWidth={r * 0.16}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  );

  const ey = cy - r * 0.08;
  const faceEl = (
    <G>
      {[-1, 1].map((side) => {
        const ex = cx + side * r * 0.3;
        if (state === 'done') {
          return (
            <Path
              key={side}
              d={`M${ex - r * 0.15} ${ey + r * 0.04}Q${ex} ${ey - r * 0.16} ${ex + r * 0.15} ${ey + r * 0.04}`}
              stroke={MARK_LIGHT}
              strokeWidth={r * 0.085}
              strokeLinecap="round"
              fill="none"
            />
          );
        }
        const lookX = state === 'thinking' ? r * 0.05 : r * 0.02;
        const lookY = state === 'thinking' ? -r * 0.07 : r * 0.03;
        return (
          <G key={side}>
            <Ellipse cx={ex} cy={ey} rx={r * 0.15} ry={r * 0.2} fill={MARK_LIGHT} />
            <Circle cx={ex + lookX} cy={ey + lookY} r={r * 0.085} fill={INK} />
          </G>
        );
      })}
      {state === 'listening' ? (
        <Ellipse cx={cx} cy={cy + r * 0.34} rx={r * 0.12} ry={r * (0.06 + 0.12 * shown)} fill={INK} />
      ) : (
        <Path d={`M${cx - r * 0.22} ${cy + r * 0.28}Q${cx} ${cy + r * 0.46} ${cx + r * 0.22} ${cy + r * 0.28}`} stroke={INK} strokeWidth={r * 0.085} strokeLinecap="round" fill="none" />
      )}
    </G>
  );

  const barsEl = (
    <G>
      {[0, 1, 2].map((i) => {
        const n = moving ? 0.5 + 0.5 * Math.sin(t * 7.3 + i * 2.1) : 0.6;
        const h = bh * (0.14 + 0.4 * shown * (0.35 + 0.65 * n));
        const w = bw * 0.12;
        const x = cx + (i - 1) * bw * 0.22;
        return <Rect key={i} x={x - w / 2} y={cy - h / 2} width={w} height={h} rx={w / 2} fill={MARK_LIGHT} />;
      })}
    </G>
  );

  const content =
    look === 'mascot'
      ? faceEl
      : look === 'dot'
        ? null
        : look === 'pill' && state === 'listening'
          ? barsEl
          : state === 'done'
            ? checkEl
            : markEl;

  const shadowOpacity = look === 'glass' ? 0.12 : 0.22;

  return (
    <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} testID={testID}>
      <Defs>
        <RadialGradient id={`orb${gid}`} cx={cx - r * 0.35} cy={cy - r * 0.45} r={r * 1.45} fx={cx - r * 0.35} fy={cy - r * 0.45} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={mixHex(ORB_LIGHT, accent, 0.3)} />
          <Stop offset="0.55" stopColor={mixHex(ORB_MID, accent, 0.12)} />
          <Stop offset="1" stopColor={ORB_DEEP} />
        </RadialGradient>
        <RadialGradient id={`dot${gid}`} cx={cx - r * 0.3} cy={cy - r * 0.35} r={r * 1.3} fx={cx - r * 0.3} fy={cy - r * 0.35} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={mixHex(accent, '#ffffff', 0.35)} />
          <Stop offset="0.6" stopColor={accent} />
          <Stop offset="1" stopColor={a2} />
        </RadialGradient>
        <LinearGradient id={`diag${gid}`} x1={cx - hw} y1={cy - hh} x2={cx + hw} y2={cy + hh} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={accent} />
          <Stop offset="1" stopColor={a2} />
        </LinearGradient>
        <LinearGradient id={`tint${gid}`} x1={cx - hw} y1={cy - hh} x2={cx + hw} y2={cy + hh} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={accent} stopOpacity={46 / 255} />
          <Stop offset="1" stopColor={a2} stopOpacity={46 / 255} />
        </LinearGradient>
        <LinearGradient id={`vert${gid}`} x1={0} y1={cy - hh} x2={0} y2={cy + hh} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={accent} />
          <Stop offset="1" stopColor={a2} />
        </LinearGradient>
        <RadialGradient id={`glow${gid}`} cx={cx} cy={cy + r * 0.75} r={r * 0.95} fx={cx} fy={cy + r * 0.75} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={a2} stopOpacity={150 / 255} />
          <Stop offset="1" stopColor={a2} stopOpacity={0} />
        </RadialGradient>
        <LinearGradient id={`gloss${gid}`} x1={0} y1={cy - hh * 0.92} x2={0} y2={cy - hh * 0.05} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#ffffff" stopOpacity={110 / 255} />
          <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </LinearGradient>
        <LinearGradient id={`mark${gid}`} x1={14} y1={37} x2={50} y2={23} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={MARK_LIGHT} />
          <Stop offset="1" stopColor={mixHex(MARK_LIGHT, accent, 0.55)} />
        </LinearGradient>
      </Defs>

      {/* soft shadow (Android draws it from the view's elevation) */}
      {round ? (
        <Circle cx={cx} cy={cy + 2.5} r={r + 1} fill="#000" opacity={shadowOpacity} />
      ) : (
        <Path d={roundRectD(cx - hw - 1, cy - hh + 1.5, bw + 2, bh + 2, hw + 1)} fill="#000" opacity={shadowOpacity} />
      )}
      <G transform={`translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`}>
        {look === 'orb' && shapeEl(fill('orb'))}
        {look === 'orb' && shapeEl(fill('glow'))}
        {look === 'glass' && shapeEl(INK, { fillOpacity: GLASS_ALPHA / 255 })}
        {look === 'glass' && shapeEl(fill('tint'))}
        {look === 'pill' && shapeEl(fill('vert'))}
        {look === 'dot' && shapeEl(fill('dot'))}
        {look === 'mascot' && shapeEl(fill('diag'))}
        {state === 'done' && shapeEl(GREEN, { fillOpacity: 60 / 255 })}
        {look !== 'dot' && <Ellipse cx={cx} cy={cy - hh * 0.46} rx={hw * 0.66} ry={hh * 0.44} fill={fill('gloss')} />}
        {round ? (
          <Circle cx={cx} cy={cy} r={r - rimW / 2} stroke={look === 'glass' ? fill('diag') : '#ffffff'} strokeOpacity={look === 'glass' ? 1 : 56 / 255} strokeWidth={rimW} fill="none" />
        ) : (
          <Path d={roundRectD(cx - hw + rimW / 2, cy - hh + rimW / 2, bw - rimW, bh - rimW, hw - rimW / 2)} stroke="#ffffff" strokeOpacity={56 / 255} strokeWidth={rimW} fill="none" />
        )}
        {content}
      </G>

      {round ? (
        <>
          {state === 'idle' && <Circle cx={cx} cy={cy} r={ringR} stroke={ring} strokeOpacity={150 / 255} strokeWidth={1.5} fill="none" />}
          {state === 'listening' && (
            <G>
              <Circle cx={cx} cy={cy} r={r + 2.5} stroke={ring} strokeOpacity={70 / 255} strokeWidth={1.5} fill="none" />
              {Array.from({ length: SPIKES }, (_, i) => {
                const a = (i / SPIKES) * Math.PI * 2 - Math.PI / 2;
                const n = moving ? 0.6 * (0.5 + 0.5 * Math.sin(t * 5.6 + i * 0.71)) + 0.4 * (0.5 + 0.5 * Math.sin(t * 10.7 - i * 1.33)) : 0.6;
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
              <Circle cx={cx} cy={cy} r={ringR} stroke={ring} strokeOpacity={48 / 255} strokeWidth={1.5} fill="none" />
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
        </>
      ) : (
        <>
          {state === 'idle' && <Path d={ringD} stroke={ring} strokeOpacity={150 / 255} strokeWidth={1.5} fill="none" />}
          {state === 'listening' && <Path d={ringD} stroke={ring} strokeOpacity={(120 + 135 * shown) / 255} strokeWidth={1.5 + 2.5 * shown} fill="none" />}
          {state === 'thinking' && (
            <G>
              <Path d={ringD} stroke={ring} strokeOpacity={48 / 255} strokeWidth={1.5} fill="none" />
              <Path
                d={ringD}
                stroke={ring}
                strokeWidth={2.2}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={[ringLen * 0.35, ringLen * 0.65]}
                strokeDashoffset={-((moving ? phase : 0.15) * ringLen)}
              />
            </G>
          )}
          {state === 'done' && <Path d={ringD} stroke={GREEN} strokeWidth={1.5} fill="none" />}
          {state === 'error' && <Path d={ringD} stroke={RED} strokeWidth={1.5} fill="none" />}
        </>
      )}

      {offline && (
        <Circle
          cx={round ? cx + Math.cos(-Math.PI / 4) * r * 0.8 : cx + bw * 0.32}
          cy={round ? cy + Math.sin(-Math.PI / 4) * r * 0.8 : cy - bh / 2 + bw * 0.32}
          r={r * 0.19}
          fill={WARN}
          stroke={INK}
          strokeWidth={1.5}
        />
      )}
    </Svg>
  );
}
