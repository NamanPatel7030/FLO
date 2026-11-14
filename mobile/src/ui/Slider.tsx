// A small slider (no native dependency): drag or tap the track, with steps, a value bubble while
// dragging, a light tick at each step and TalkBack's adjustable actions (swipe up / down).
import * as Haptics from 'expo-haptics';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { colors, fonts, themed } from './theme';
import { hapticsOn } from './motion';

/** Snap [v] to [step] inside [min, max] (unit-tested). */
export function snapValue(v: number, min: number, max: number, step: number): number {
  const c = Math.min(max, Math.max(min, v));
  const s = Math.round((c - min) / step) * step + min;
  return Math.min(max, Math.max(min, Number(s.toFixed(4))));
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  onDone,
  format = (v) => String(v),
  label,
  testID,
  color = colors.sky,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  /** every step while dragging */
  onChange: (v: number) => void;
  /** once, when the finger lifts */
  onDone?: (v: number) => void;
  format?: (v: number) => string;
  label: string;
  testID?: string;
  color?: string;
}) {
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const live = useRef({ width, value, min, max, step, onChange, onDone });
  live.current = { width, value, min, max, step, onChange, onDone };
  const last = useRef(value);

  const at = useCallback((x: number) => {
    const l = live.current;
    if (l.width <= 0) return l.value;
    return snapValue(l.min + (x / l.width) * (l.max - l.min), l.min, l.max, l.step);
  }, []);

  const set = useCallback((v: number) => {
    if (v === last.current) return;
    last.current = v;
    if (Platform.OS !== 'web' && hapticsOn()) void Haptics.selectionAsync().catch(() => undefined);
    live.current.onChange(v);
  }, []);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // a vertical scroll of the screen shouldn't steal a horizontal drag
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          setDragging(true);
          last.current = live.current.value;
          set(at(e.nativeEvent.locationX));
        },
        onPanResponderMove: (e) => set(at(e.nativeEvent.locationX)),
        onPanResponderRelease: () => {
          setDragging(false);
          live.current.onDone?.(last.current);
        },
        onPanResponderTerminate: () => setDragging(false),
      }),
    [at, set],
  );

  const frac = max > min ? (Math.min(max, Math.max(min, value)) - min) / (max - min) : 0;
  const x = frac * width;
  const nudge = (dir: 1 | -1) => {
    const v = snapValue(value + dir * step, min, max, step);
    live.current.onChange(v);
    live.current.onDone?.(v);
  };

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value, text: format(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => nudge(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      style={styles.wrap}
    >
      <View style={styles.hit} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} {...pan.panHandlers}>
        <View style={styles.track} pointerEvents="none">
          <View style={[styles.fill, { width: x, backgroundColor: color }]} />
        </View>
        <View pointerEvents="none" style={[styles.knob, { left: x - 13, transform: [{ scale: dragging ? 1.12 : 1 }] }]} />
        {dragging && (
          <View pointerEvents="none" style={[styles.bubble, { left: Math.max(0, Math.min(width - 56, x - 28)) }]}>
            <Text style={styles.bubbleText}>{format(value)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    wrap: { paddingHorizontal: 13 },
    hit: { height: 40, justifyContent: 'center' },
    track: { height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.dark ? 'rgba(255,255,255,0.12)' : 'rgba(20,30,60,0.1)' },
    fill: { height: 6, borderRadius: 3 },
    knob: {
      position: 'absolute',
      top: 7,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: '#ffffff',
      borderWidth: 1,
      borderColor: colors.dark ? 'rgba(255,255,255,0.4)' : 'rgba(20,30,60,0.12)',
      shadowColor: '#0b1220',
      shadowOpacity: 0.18,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    bubble: { position: 'absolute', top: -30, width: 56, alignItems: 'center', paddingVertical: 4, borderRadius: 10, backgroundColor: colors.primary },
    bubbleText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.onPrimary },
  }),
);
