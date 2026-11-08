// Near-black canvas with soft blue aurora glows.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { colors } from './theme';

export function Backdrop({ intensity = 1, children }: { intensity?: number; children?: React.ReactNode }) {
  return (
    <View style={styles.root}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 400 900">
        <Defs>
          <RadialGradient id="g1" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={colors.sky} stopOpacity={0.26 * intensity} />
            <Stop offset="0.55" stopColor={colors.ocean} stopOpacity={0.08 * intensity} />
            <Stop offset="1" stopColor={colors.ocean} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="g2" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#1a5fb0" stopOpacity={0.22 * intensity} />
            <Stop offset="1" stopColor="#1a5fb0" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx="200" cy="40" rx="330" ry="260" fill="url(#g1)" />
        <Ellipse cx="380" cy="820" rx="260" ry="220" fill="url(#g2)" />
        <Ellipse cx="0" cy="560" rx="180" ry="160" fill="url(#g2)" opacity={0.6} />
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, overflow: 'hidden' },
});
