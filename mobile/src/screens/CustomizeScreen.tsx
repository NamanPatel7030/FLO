// Make Flo yours: theme, accent colour and the Notchling avatar (same options as the Mac app).
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ACCENTS, usePrefs, type ThemeMode } from '../state/Prefs';
import { IconButton, tap } from '../ui/Buttons';
import { GlassCard } from '../ui/Glass';
import { Icon } from '../ui/Icons';
import { GLOWS, Notchling, type AvatarStyle, type Mood } from '../ui/Notchling';
import { Toggle } from '../ui/Toggle';
import { colors, fonts, radius, themed, type } from '../ui/theme';

const PREVIEW: { mood: Mood; label: string }[] = [
  { mood: 'happy', label: 'Ready' },
  { mood: 'listen', label: 'Listening' },
  { mood: 'think', label: 'Thinking' },
  { mood: 'celebrate', label: 'Goal hit' },
];

function Chips<T extends string>({ value, options, onChange, testID }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; testID: string }) {
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            testID={`${testID}-${o.id}`}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => {
              tap();
              onChange(o.id);
            }}
            style={[styles.chip, on && styles.chipOn]}
          >
            <Text style={[styles.chipText, on && { color: colors.onPrimary }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function CustomizeScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const { prefs, update } = usePrefs();
  const [mood, setMood] = useState<Mood>('happy');
  const a = prefs.avatar;
  const setA = (p: Partial<AvatarStyle>) => update({ avatar: { ...a, ...p } });

  return (
    <ScrollView testID="customize" contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 40, paddingHorizontal: 18 }}>
      <View style={styles.header}>
        <IconButton label="Back" onPress={onBack}>
          <Icon name="back" color={colors.ink} />
        </IconButton>
        <Text style={styles.headerTitle}>Make it yours</Text>
        <View style={{ width: 44 }} />
      </View>

      <GlassCard strong radius={28} style={styles.preview}>
        <Notchling mood={mood} size={150} avatar={a} accent={colors.sky} testID="customize-preview" />
        <View style={styles.previewRow}>
          {PREVIEW.map((p) => (
            <Pressable key={p.mood} onPress={() => setMood(p.mood)} style={[styles.mini, mood === p.mood && styles.miniOn]} accessibilityLabel={p.label}>
              <Notchling mood={p.mood} size={46} avatar={a} accent={colors.sky} />
              <Text style={styles.miniText}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
      </GlassCard>

      <Text style={styles.section}>Theme</Text>
      <Chips<ThemeMode>
        testID="theme"
        value={prefs.theme}
        onChange={(theme) => update({ theme })}
        options={[
          { id: 'light', label: 'Light' },
          { id: 'dark', label: 'Dark' },
          { id: 'system', label: 'System' },
        ]}
      />

      <Text style={styles.section}>Accent</Text>
      <View style={styles.swatches}>
        <Pressable
          accessibilityLabel="Default accent"
          onPress={() => update({ accent: null })}
          style={[styles.swatch, { backgroundColor: colors.dark ? '#66ceff' : '#2f8cff' }, !prefs.accent && styles.swatchOn]}
        />
        {ACCENTS.slice(1).map((c) => (
          <Pressable key={c} testID={`accent-${c}`} accessibilityLabel={`Accent ${c}`} onPress={() => update({ accent: c })} style={[styles.swatch, { backgroundColor: c }, prefs.accent === c && styles.swatchOn]} />
        ))}
      </View>

      <Text style={styles.section}>Your Notchling</Text>
      <GlassCard style={styles.card}>
        <Text style={styles.label}>Eyes</Text>
        <Chips
          testID="eyes"
          value={a.eyes}
          onChange={(eyes) => setA({ eyes })}
          options={[
            { id: 'classic', label: 'Classic' },
            { id: 'round', label: 'Round' },
            { id: 'smiley', label: 'Smiley' },
            { id: 'sparkly', label: 'Sparkly' },
            { id: 'visor', label: 'Visor' },
          ]}
        />
        <Text style={styles.label}>Glow</Text>
        <View style={styles.swatches}>
          {(Object.keys(GLOWS) as AvatarStyle['glow'][]).map((g) => (
            <Pressable
              key={g}
              testID={`glow-${g}`}
              accessibilityLabel={`${g} glow`}
              onPress={() => setA({ glow: g })}
              style={[styles.swatch, { backgroundColor: g === 'accent' ? colors.sky : GLOWS[g][1] }, a.glow === g && styles.swatchOn]}
            />
          ))}
        </View>
        <Text style={styles.label}>Mouth</Text>
        <Chips
          testID="mouth"
          value={a.mouth}
          onChange={(mouth) => setA({ mouth })}
          options={[
            { id: 'wave', label: 'Voice wave' },
            { id: 'smile', label: 'Smile' },
            { id: 'cat', label: 'Cat' },
          ]}
        />
        <Text style={styles.label}>Extra</Text>
        <Chips
          testID="extra"
          value={a.extra}
          onChange={(extra) => setA({ extra })}
          options={[
            { id: 'none', label: 'None' },
            { id: 'headphones', label: 'Headphones' },
            { id: 'halo', label: 'Halo' },
            { id: 'sparkle', label: 'Sparkle' },
          ]}
        />
        <View style={styles.toggleRow}>
          <Text style={styles.rowTitle}>Rosy cheeks</Text>
          <Toggle value={a.cheeks} label="Rosy cheeks" onChange={(cheeks) => setA({ cheeks })} />
        </View>
      </GlassCard>
      <Text style={styles.footnote}>Saved on this phone. Your computer has its own avatar in Settings, Appearance.</Text>
    </ScrollView>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
    headerTitle: { fontFamily: fonts.semibold, fontSize: 18, color: colors.ink },
    preview: { alignItems: 'center', paddingVertical: 22, paddingHorizontal: 10 },
    previewRow: { flexDirection: 'row', gap: 8, marginTop: 18 },
    mini: { alignItems: 'center', padding: 6, borderRadius: 16, gap: 4 },
    miniOn: { backgroundColor: colors.glassStrong },
    miniText: { fontFamily: fonts.medium, fontSize: 11.5, color: colors.inkMuted },
    section: { ...type.micro, marginTop: 26, marginBottom: 10, marginLeft: 4 },
    card: { padding: 16 },
    label: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.inkSoft, marginTop: 12, marginBottom: 8 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 14, height: 38, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder },
    chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.inkSoft },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    swatch: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: 'transparent' },
    swatchOn: { borderColor: colors.ink, transform: [{ scale: 1.08 }] },
    toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
    rowTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
    footnote: { ...type.small, marginTop: 10, marginLeft: 4 },
  }),
);
