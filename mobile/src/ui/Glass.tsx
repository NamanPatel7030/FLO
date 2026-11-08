// "Liquid glass" surfaces: translucent fill, specular top edge, soft inner sheen.
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius } from './theme';

export function GlassCard({
  children,
  style,
  radius: r = radius.lg,
  strong,
  tint,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  strong?: boolean;
  /** Optional colour wash, e.g. a kind colour. */
  tint?: string;
}) {
  return (
    <View
      style={[
        styles.card,
        { borderRadius: r, backgroundColor: strong ? colors.glassStrong : colors.glass },
        style,
      ]}
    >
      <LinearGradient
        pointerEvents="none"
        colors={[tint ? `${tint}22` : 'rgba(255,255,255,0.07)', 'rgba(255,255,255,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.6, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderRadius: r }]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,255,255,0)', colors.glassHighlight, 'rgba(255,255,255,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.specular, { left: r, right: r }]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
  },
  specular: { position: 'absolute', top: 0, height: 1 },
});
