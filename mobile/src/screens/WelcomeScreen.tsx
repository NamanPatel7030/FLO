import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GROUPS, MUTABLE_GROUPS } from '../lib/kinds';
import { GlassButton, PrimaryButton } from '../ui/Buttons';
import { Icon, QrGlyph } from '../ui/Icons';
import { NotchPill } from '../ui/NotchPill';
import { colors, fonts, type } from '../ui/theme';

const native = Platform.OS !== 'web';

function useStagger(count: number) {
  const vals = useRef(Array.from({ length: count }, () => new Animated.Value(0))).current;
  useEffect(() => {
    Animated.stagger(
      90,
      vals.map((v) =>
        Animated.timing(v, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
      ),
    ).start();
  }, [vals]);
  return vals.map((v) => ({
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
  }));
}

export function WelcomeScreen({ onScan, onEnterCode, error }: { onScan: () => void; onEnterCode: () => void; error?: string | null }) {
  const insets = useSafeAreaInsets();
  const a = useStagger(5);
  return (
    <ScrollView
      contentContainerStyle={[styles.root, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 24 }]}
      bounces={false}
    >
      <Animated.View style={[styles.hero, a[0]]}>
        <NotchPill label="Claude finished in api" />
      </Animated.View>

      <View style={{ flex: 0.6 }} />

      <Animated.View style={a[1]}>
        <Text style={type.micro}>Flo for Android</Text>
        <Text style={[type.display, styles.headline]}>
          Your Mac,{'\n'}
          <Text style={{ color: colors.sky }}>in your pocket.</Text>
        </Text>
        <Text style={[type.body, styles.sub]}>
          When you step away, Flo sends your Mac's updates here — Claude finishing a task, today's to-dos, reminders,
          skills and meeting summaries.
        </Text>
      </Animated.View>

      <Animated.View style={[styles.chips, a[2]]}>
        {MUTABLE_GROUPS.map((g) => (
          <View key={g} style={[styles.chip, { borderColor: `${GROUPS[g].color}40`, backgroundColor: `${GROUPS[g].color}14` }]}>
            <Icon name={GROUPS[g].icon} size={14} color={GROUPS[g].color} strokeWidth={2.2} />
            <Text style={[styles.chipText, { color: GROUPS[g].color }]}>{GROUPS[g].channelName}</Text>
          </View>
        ))}
      </Animated.View>

      <View style={{ flex: 1, minHeight: 24 }} />

      {!!error && (
        <View style={styles.error}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <Animated.View style={[styles.actions, a[3]]}>
        <PrimaryButton testID="scan" label="Pair with your Mac" icon={<QrGlyph />} onPress={onScan} />
        <GlassButton
          testID="enter-code"
          label="Enter code instead"
          icon={<Icon name="keypad" size={18} color={colors.inkSoft} />}
          onPress={onEnterCode}
        />
      </Animated.View>

      <Animated.Text style={[styles.hint, a[4]]}>
        On your Mac, open Flo and choose “Pair a phone” in Settings.
      </Animated.Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, paddingHorizontal: 24 },
  hero: { alignItems: 'center', marginBottom: 18, marginHorizontal: -24 },
  headline: { marginTop: 10, fontSize: 38, lineHeight: 44 },
  sub: { marginTop: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 22 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontFamily: fonts.semibold, fontSize: 12.5 },
  actions: { gap: 12 },
  hint: { ...type.small, textAlign: 'center', marginTop: 18, color: colors.inkFaint },
  error: {
    marginBottom: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,107,107,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.25)',
  },
  errorText: { ...type.small, color: '#ffb4b4' },
});
