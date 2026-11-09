import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { metaForKind } from '../lib/kinds';
import { Icon } from './Icons';
import { themed } from './theme';

export function KindIcon({ kind, size = 40 }: { kind: string; size?: number }) {
  const m = metaForKind(kind);
  return (
    <View
      style={[
        styles.wrap,
        { width: size, height: size, borderRadius: size * 0.34, borderColor: `${m.color}40` },
      ]}
    >
      <LinearGradient
        colors={[`${m.color}38`, `${m.colorDeep}22`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderRadius: size * 0.34 }]}
      />
      <Icon name={m.icon} size={size * 0.52} color={m.color} strokeWidth={kind === 'claude_done' || kind === 'claude_needs_you' ? 2.2 : 1.9} />
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, overflow: 'hidden' },
}));
