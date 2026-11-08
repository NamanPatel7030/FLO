import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { Alert, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GROUPS, MUTABLE_GROUPS } from '../lib/kinds';
import { useFlo } from '../state/FloContext';
import { GlassButton, IconButton } from '../ui/Buttons';
import { GlassCard } from '../ui/Glass';
import { Icon } from '../ui/Icons';
import { KindIcon } from '../ui/KindIcon';
import { Toggle } from '../ui/Toggle';
import { colors, fonts, type } from '../ui/theme';

const SAMPLE_KIND: Record<(typeof MUTABLE_GROUPS)[number], string> = {
  claude: 'claude_done',
  todos: 'todos_digest',
  reminders: 'reminder',
  skills: 'skill_ran',
  meetings: 'meeting_summary',
};

function initials(name: string, email: string) {
  const src = name.trim() || email;
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? 'F') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function confirm(title: string, message: string, cta: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm?.(`${title}\n\n${message}`) ?? true);
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: cta, style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const flo = useFlo();
  const [unpairing, setUnpairing] = useState(false);
  const user = flo.session?.user ?? { name: '', email: '' };
  const perm = flo.permission;

  const permCopy =
    perm.state === 'granted'
      ? { label: 'Allowed', color: colors.green, text: 'Flo can alert you when your Mac has something for you.' }
      : perm.state === 'unsupported'
        ? { label: 'Unavailable', color: colors.inkMuted, text: 'Notifications are only available on Android.' }
        : {
            label: perm.state === 'denied' ? 'Blocked' : 'Not allowed yet',
            color: colors.amber,
            text: 'Without this permission you will only see updates when you open the app.',
          };

  return (
    <ScrollView
      testID="settings"
      contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 40, paddingHorizontal: 18 }}
    >
      <View style={styles.header}>
        <IconButton testID="settings-back" label="Back" onPress={onBack}>
          <Icon name="back" color={colors.ink} />
        </IconButton>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 44 }} />
      </View>

      {/* Account */}
      <GlassCard style={styles.account} radius={26}>
        <LinearGradient colors={[colors.sky, colors.ocean, '#0b4f7a']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(user.name, user.email)}</Text>
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={styles.accName} numberOfLines={1}>
            {user.name || 'Flo account'}
          </Text>
          <Text style={type.small} numberOfLines={1}>
            {user.email}
          </Text>
        </View>
        <View style={styles.pairedPill}>
          <View style={styles.pairedDot} />
          <Text style={styles.pairedText}>Paired</Text>
        </View>
      </GlassCard>

      <Text style={styles.section}>Server</Text>
      <GlassCard style={styles.rowCard}>
        <View style={styles.rowIcon}>
          <Icon name="server" size={19} color={colors.sky} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {flo.session?.server.replace(/^https?:\/\//, '')}
          </Text>
          <Text style={type.small}>{flo.session?.server.startsWith('https') ? 'Secure connection' : 'Local network (http)'}</Text>
        </View>
      </GlassCard>

      <Text style={styles.section}>Notifications</Text>
      <GlassCard style={styles.permCard}>
        <View style={styles.permTop}>
          <View style={[styles.rowIcon, { backgroundColor: `${permCopy.color}1f` }]}>
            <Icon name={perm.state === 'granted' ? 'bell' : 'bellOff'} size={19} color={permCopy.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Push notifications</Text>
            <Text style={[type.small, { color: permCopy.color }]}>{permCopy.label}</Text>
          </View>
          {perm.state !== 'granted' && perm.state !== 'unsupported' && (
            <GlassButton
              compact
              testID="fix-permission"
              label={perm.canAskAgain ? 'Allow' : 'Open settings'}
              onPress={() => void flo.requestPermission()}
            />
          )}
        </View>
        <Text style={[type.small, { marginTop: 12 }]}>{permCopy.text}</Text>
      </GlassCard>

      <Text style={styles.section}>Show in Flo</Text>
      <GlassCard style={{ paddingVertical: 4 }}>
        {MUTABLE_GROUPS.map((g, i) => {
          const meta = GROUPS[g];
          const on = !flo.mutes[g];
          return (
            <View key={g} style={[styles.kindRow, i > 0 && styles.divider]}>
              <KindIcon kind={SAMPLE_KIND[g]} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{meta.channelName}</Text>
                <Text style={type.small} numberOfLines={2}>
                  {meta.channelDescription}
                </Text>
              </View>
              <Toggle value={on} color={meta.color} label={`Show ${meta.channelName}`} onChange={(v) => flo.setMuted(g, !v)} />
            </View>
          );
        })}
      </GlassCard>
      <Text style={styles.footnote}>
        Muting hides a kind in the inbox and silences it while Flo is open. To silence it on the lock screen too, turn
        off its channel in Android settings.
      </Text>
      {Platform.OS === 'android' && (
        <GlassButton
          compact
          style={{ alignSelf: 'flex-start', marginTop: 10 }}
          label="Android notification settings"
          onPress={() => void Linking.openSettings()}
        />
      )}

      <GlassButton
        testID="unpair"
        danger
        style={{ marginTop: 32 }}
        label={unpairing ? 'Unpairing…' : 'Unpair this phone'}
        icon={<Icon name="unlink" size={18} color={colors.danger} />}
        disabled={unpairing}
        onPress={async () => {
          const ok = await confirm(
            'Unpair this phone?',
            'You will stop getting updates here until you pair again from your Mac.',
            'Unpair',
          );
          if (!ok) return;
          setUnpairing(true);
          await flo.unpair();
        }}
      />

      <Text style={styles.version}>
        Flo for Android {Constants.expoConfig?.version ?? ''}
        {flo.mock ? ' · demo data' : ''}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  headerTitle: { fontFamily: fonts.semibold, fontSize: 17, color: colors.ink },
  account: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18 },
  avatar: { width: 54, height: 54, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.bold, fontSize: 19, color: '#03263d' },
  accName: { fontFamily: fonts.semibold, fontSize: 17.5, color: colors.ink, letterSpacing: -0.3 },
  pairedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(74,222,128,0.1)',
  },
  pairedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green },
  pairedText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.green },
  section: { ...type.micro, marginTop: 28, marginBottom: 10, marginLeft: 6 },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(102,206,255,0.1)',
  },
  rowTitle: { fontFamily: fonts.semibold, fontSize: 15.5, color: colors.ink, letterSpacing: -0.2 },
  permCard: { padding: 16 },
  permTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 13 },
  divider: { borderTopWidth: 1, borderTopColor: colors.hairline },
  footnote: { ...type.small, marginTop: 12, marginHorizontal: 6, color: colors.inkFaint },
  version: { ...type.small, textAlign: 'center', marginTop: 28, color: colors.inkFaint },
});
