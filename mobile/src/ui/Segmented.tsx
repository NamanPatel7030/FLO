// A row of mutually exclusive options (like Settings' theme picker), and wrapping chips.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tap } from './Buttons';
import { colors, fonts, radius, themed } from './theme';

export interface Option<T extends string> {
  id: T;
  label: string;
  disabled?: boolean;
}

export function Segmented<T extends string>({ value, options, onChange, testID, label }: { value: T; options: Option<T>[]; onChange: (v: T) => void; testID: string; label: string }) {
  return (
    <View style={styles.seg} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            testID={`${testID}-${o.id}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: !!o.disabled }}
            disabled={o.disabled}
            onPress={() => {
              tap();
              if (!on) onChange(o.id);
            }}
            style={[styles.segItem, on && styles.segOn, o.disabled && { opacity: 0.38 }]}
          >
            <Text style={[styles.segText, on && styles.segTextOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chips<T extends string>({ value, options, onChange, testID }: { value: T; options: Option<T>[]; onChange: (v: T) => void; testID: string }) {
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            testID={`${testID}-${o.id}`}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: !!o.disabled }}
            disabled={o.disabled}
            onPress={() => {
              tap();
              onChange(o.id);
            }}
            style={[styles.chip, on && styles.chipOn, o.disabled && { opacity: 0.38 }]}
          >
            <Text style={[styles.chipText, on && { color: colors.onPrimary }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    seg: { flexDirection: 'row', padding: 3, borderRadius: 14, backgroundColor: colors.dark ? 'rgba(255,255,255,0.06)' : 'rgba(20,30,60,0.06)' },
    segItem: { flex: 1, minHeight: 34, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
    segOn: {
      backgroundColor: colors.dark ? 'rgba(255,255,255,0.12)' : '#ffffff',
      shadowColor: '#2b2370',
      shadowOpacity: 0.08,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    segText: { fontFamily: fonts.medium, fontSize: 13.5, color: colors.inkMuted },
    segTextOn: { fontFamily: fonts.semibold, color: colors.ink },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 13, minHeight: 36, paddingVertical: 6, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder },
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.inkSoft },
  }),
);
