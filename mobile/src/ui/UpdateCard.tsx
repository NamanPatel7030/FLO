// "Update ready" (over-the-air, applies on restart) and "Update available" (new APK) cards.
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { usePrefs } from '../state/Prefs';
import { useUpdates } from '../state/Updates';
import { GlassButton, PrimaryButton } from './Buttons';
import { GlassCard } from './Glass';
import { Notchling } from './Notchling';
import { colors, fonts, radius, themed, type } from './theme';

export function UpdateCard() {
  const u = useUpdates();
  const { prefs } = usePrefs();
  if (u.dismissed || (!u.otaReady && !u.native)) return null;
  const native = !!u.native;
  return (
    <GlassCard strong radius={radius.lg} style={styles.card} tint={colors.sky}>
      <View style={styles.row}>
        <Notchling mood="excited" size={52} plate={false} avatar={prefs.avatar} accent={colors.sky} />
        <View style={{ flex: 1 }}>
          <Text style={type.heading}>{native ? `Flo ${u.native?.versionName} is available` : 'An update is ready'}</Text>
          <Text style={[type.small, { marginTop: 2 }]}>
            {native ? 'A new version of the app. It installs over this one; you stay paired.' : 'Restart Flo to use it. Takes a second.'}
          </Text>
        </View>
      </View>
      {native && !!u.native?.notes && (
        <Text style={styles.notes} numberOfLines={6}>
          {u.native.notes}
        </Text>
      )}
      {u.progress != null && (
        <View style={styles.bar}>
          <View style={[styles.fill, { width: `${Math.round(u.progress * 100)}%` }]} />
        </View>
      )}
      {!!u.error && <Text style={styles.error}>{u.error}</Text>}
      <View style={[styles.row, { marginTop: 12 }]}>
        <GlassButton compact label="Later" onPress={u.dismiss} style={{ flex: 1 }} />
        <PrimaryButton
          testID="update-now"
          style={{ flex: 1.6 }}
          label={native ? (u.progress != null ? `Downloading ${Math.round((u.progress ?? 0) * 100)}%` : 'Download and install') : 'Restart now'}
          loading={u.progress != null}
          onPress={() => void (native ? u.install() : u.restart())}
        />
      </View>
      {native && Platform.OS === 'android' && (
        <Text style={[type.small, { marginTop: 10 }]} onPress={() => void u.allowInstalls()}>
          If Android blocks it, tap here and turn on "Allow from this source".
        </Text>
      )}
    </GlassCard>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    card: { padding: 16, marginBottom: 14 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    notes: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.inkSoft, marginTop: 10 },
    bar: { height: 6, borderRadius: 3, backgroundColor: colors.hairline, marginTop: 12, overflow: 'hidden' },
    fill: { height: 6, borderRadius: 3, backgroundColor: colors.sky },
    error: { ...type.small, color: colors.errorText, marginTop: 8 },
  }),
);
