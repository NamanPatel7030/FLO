// Soft pastel blobs behind the glass (light), deep-ocean glows (dark). The blobs drift slowly.
import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { colors, themed } from './theme';

const native = Platform.OS !== 'web';

export function Backdrop({ intensity = 1, children }: { intensity?: number; children?: React.ReactNode }) {
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (reduce) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(drift, { toValue: 1, duration: 14000, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
            Animated.timing(drift, { toValue: 0, duration: 14000, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
          ]),
        );
        loop.start();
      });
    return () => loop?.stop();
  }, [drift]);
  const o = (colors.dark ? 0.55 : 0.85) * intensity;
  const blob = (id: string, c: string) => (
    <RadialGradient id={id} cx="50%" cy="50%" r="50%">
      <Stop offset="0" stopColor={c} stopOpacity={o} />
      <Stop offset="0.6" stopColor={c} stopOpacity={o * 0.35} />
      <Stop offset="1" stopColor={c} stopOpacity={0} />
    </RadialGradient>
  );
  const tx = drift.interpolate({ inputRange: [0, 1], outputRange: [-18, 18] });
  const ty = drift.interpolate({ inputRange: [0, 1], outputRange: [10, -14] });
  return (
    <View style={styles.root}>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: tx }, { translateY: ty }, { scale: 1.08 }] }]}>
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 400 900">
          <Defs>
            {blob('a', colors.blobA)}
            {blob('b', colors.blobB)}
            {blob('c', colors.blobC)}
            {blob('d', colors.blobD)}
          </Defs>
          <Ellipse cx="40" cy="60" rx="260" ry="240" fill="url(#a)" />
          <Ellipse cx="380" cy="150" rx="240" ry="230" fill="url(#b)" />
          <Ellipse cx="90" cy="820" rx="260" ry="220" fill="url(#c)" />
          <Ellipse cx="390" cy="700" rx="220" ry="200" fill="url(#d)" />
        </Svg>
      </Animated.View>
      {children}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg, overflow: 'hidden' },
  }),
);
