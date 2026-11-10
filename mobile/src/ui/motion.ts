// This phone's motion and haptics switches, applied everywhere.
//
// Like the palette in theme.ts, the switches live at module level so plain helpers (tap(), every
// Animated call) can read them without a hook. PrefsProvider sets them from Settings > This phone
// (Animations, Haptics) and Android's "Remove animations". Screens use these wrappers instead of
// Animated.timing / spring / loop directly: with motion off, values jump straight to their end and
// loops never start (no battery spent on drifting blobs or breathing avatars).
import { Animated, LayoutAnimation } from 'react-native';

let motion = true;
let haptics = true;

export function setMotion(on: boolean) {
  motion = on;
}
export const motionOn = () => motion;

export function setHaptics(on: boolean) {
  haptics = on;
}
export const hapticsOn = () => haptics;

type TimingCfg = Animated.TimingAnimationConfig;
type SpringCfg = Animated.SpringAnimationConfig;
type Value = Animated.Value | Animated.ValueXY;

/** A config that lands immediately (duration 0, no delay). */
export function instant<T extends { delay?: number }>(cfg: T): T & { duration: number; delay: number } {
  return { ...cfg, duration: 0, delay: 0 };
}

export function timing(v: Value, cfg: TimingCfg): Animated.CompositeAnimation {
  return Animated.timing(v, motion ? cfg : instant(cfg));
}

export function spring(v: Value, cfg: SpringCfg): Animated.CompositeAnimation {
  if (motion) return Animated.spring(v, cfg);
  return Animated.timing(v, {
    toValue: cfg.toValue as TimingCfg['toValue'],
    duration: 0,
    useNativeDriver: cfg.useNativeDriver,
  });
}

const NOOP: Animated.CompositeAnimation = { start: (cb) => cb?.({ finished: true }), stop: () => undefined, reset: () => undefined };

/** Endless decorative motion: never runs with motion off. */
export function forever(make: () => Animated.CompositeAnimation, cfg?: Parameters<typeof Animated.loop>[1]): Animated.CompositeAnimation {
  return motion ? Animated.loop(make(), cfg) : NOOP;
}

/** LayoutAnimation for the next layout change, only with motion on. */
export function layoutNext(ms: number) {
  if (motion) LayoutAnimation.configureNext(LayoutAnimation.create(ms, 'easeInEaseOut', 'opacity'));
}
