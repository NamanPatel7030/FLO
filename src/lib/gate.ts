// Adaptive noise gate for the voice ribbon: the wave should follow the VOICE, not the room.
// - smooth: short EMA of mic rms (~60 ms) so single spikes don't flash
// - floor: slow-rising (~2 s) / fast-falling (~0.15 s) minimum of `smooth` = room noise / hum
// - level = clamp(sqrt((smooth - floor - margin) * gain), 0, 1)
// Pure: callers keep the state object and feed it every frame.

export interface GateState {
  smooth: number;
  floor: number;
  primed: boolean;
}

export const initialGate = (): GateState => ({ smooth: 0, floor: 0, primed: false });

const SMOOTH_TAU = 0.06;
const RISE_TAU = 2;
const FALL_TAU = 0.15;
const MARGIN = 0.012;
const GAIN = 4;

const k = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);

export function gateLevel(st: GateState, rms: number, dt: number): number {
  const x = Number.isFinite(rms) ? Math.max(0, Math.min(1, rms)) : 0;
  const d = Math.max(0, Math.min(0.25, dt));
  if (!st.primed) {
    st.smooth = x;
    st.floor = x;
    st.primed = true;
  } else st.smooth += (x - st.smooth) * k(d, SMOOTH_TAU);
  st.floor += (st.smooth - st.floor) * k(d, st.smooth > st.floor ? RISE_TAU : FALL_TAU);
  // sqrt: quiet speech still rises clearly; below the margin it's exactly 0
  const excess = Math.max(0, st.smooth - st.floor - MARGIN);
  return Math.min(1, Math.sqrt(excess * GAIN));
}
