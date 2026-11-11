// "Offline" at the top of a screen: calm, amber, and says what still works.
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useOffline } from '../state/Offline';
import { colors, fonts, themed } from './theme';

export function OfflinePill({ style, text }: { style?: StyleProp<ViewStyle>; text?: string }) {
  const off = useOffline();
  if (off.online) return null;
  const waiting = off.pending ? ` · ${off.pending} waiting to send` : '';
  return (
    <View style={[styles.pill, style]} testID="offline-pill" accessibilityRole="text" accessibilityLabel="You're offline">
      <View style={styles.dot} />
      <Text style={styles.text} numberOfLines={2}>
        {text ?? `Offline. Dictation still works${waiting}.`}
      </Text>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      alignSelf: 'flex-start',
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: colors.dark ? 'rgba(251,191,36,0.14)' : 'rgba(196,122,0,0.1)',
      borderWidth: 1,
      borderColor: colors.dark ? 'rgba(251,191,36,0.3)' : 'rgba(196,122,0,0.22)',
    },
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.dark ? '#fbbf24' : colors.amber },
    text: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.dark ? '#fcd34d' : colors.amber, flexShrink: 1 },
  }),
);
