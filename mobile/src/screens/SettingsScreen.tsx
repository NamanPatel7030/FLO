import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { Alert, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GROUPS, MUTABLE_GROUPS } from '../lib/kinds';
import { useFlo } from '../state/FloContext';
import { themeLabel, usePrefs, type ThemeMode } from '../state/Prefs';
import { useUpdates } from '../state/Updates';
import { installedBuild, installedVersion } from '../lib/updates';
import { Pressable } from 'react-native';
import { Notchling } from '../ui/Notchling';
import { GlassButton, IconButton, tap } from '../ui/Buttons';
import { GlassCard } from '../ui/Glass';
import { Icon } from '../ui/Icons';
import { KindIcon } from '../ui/KindIcon';
import { Toggle } from '../ui/Toggle';
import { BubbleCard } from '../ui/BubbleCard';
import { bubble } from '../lib/bubble';
import { TAB_BAR_SPACE } from '../ui/TabBar';
import { useComputer } from '../state/Computer';
import { computerName, freshness } from '../lib/computer';
import { relativeTime } from '../lib/time';
import { colors, fonts, type, themed } from '../ui/theme';

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

const THEMES: ThemeMode[] = ['light', 'dark', 'system'];

/** Light / Dark / System, applied the moment you tap. */
function ThemePicker({ value, onChange }: { value: ThemeMode; onChange: (t: ThemeMode) => void }) {
  return (
    <View style={styles.seg} accessibilityRole="radiogroup" accessibilityLabel="Theme">
      {THEMES.map((t) => {
        const on = t === value;
        return (
          <Pressable
            key={t}
            testID={`phone-theme-${t}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => {
              tap();
              if (!on) onChange(t);
            }}
            style={[styles.segItem, on && styles.segOn]}
          >
            <Text style={[styles.segText, on && styles.segTextOn]}>{themeLabel(t)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SettingsScreen({ onBack, onCustomize, onComputer }: { onBack?: () => void; onCustomize: () => void; onComputer: () => void }) {
  const insets = useSafeAreaInsets();
  const flo = useFlo();
  const computer = useComputer();
  const pc = computer.state;
  const pcFresh = freshness(computer.updatedAt);
  const [unpairing, setUnpairing] = useState(false);
  const user = flo.session?.user ?? { name: '', email: '' };
  const perm = flo.permission;
  const { prefs, update, osReduceMotion } = usePrefs();
  const upd = useUpdates();

  const permCopy =
    perm.state === 'granted'
      ? { label: 'Allowed', color: colors.green, text: 'Flo can alert you when your computer has something for you.' }
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
      contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + (onBack ? 40 : TAB_BAR_SPACE), paddingHorizontal: 18 }}
    >
      {onBack ? (
        <View style={styles.header}>
          <IconButton testID="settings-back" label="Back" onPress={onBack}>
            <Icon name="back" color={colors.ink} />
          </IconButton>
          <Text style={styles.headerTitle}>Settings</Text>
          <View style={{ width: 44 }} />
        </View>
      ) : (
        <Text style={styles.tabTitle}>Settings</Text>
      )}

      {/* Account */}
      <GlassCard style={styles.account} radius={26}>
        <LinearGradient colors={['#a9dcff', '#c7b6ff', '#ffc2d6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
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

      <Text style={styles.section}>This phone</Text>
      <GlassCard style={{ paddingVertical: 4 }}>
        <View style={styles.kindRow}>
          <View style={styles.rowIcon}>
            <Icon name={prefs.theme === 'dark' ? 'moon' : 'palette'} size={19} color={colors.sky} />
          </View>
          <View style={{ flex: 1, gap: 10 }}>
            <Text style={styles.rowTitle}>Theme</Text>
            <ThemePicker value={prefs.theme} onChange={(theme) => update({ theme })} />
          </View>
        </View>
        <View style={[styles.kindRow, styles.divider]}>
          <View style={styles.rowIcon}>
            <Icon name="sparkle" size={19} color={colors.sky} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Animations</Text>
            <Text style={type.small} testID="phone-animations-hint">
              {osReduceMotion
                ? "Android's Remove animations is on, so Flo stays still too."
                : prefs.animations
                  ? 'Transitions, springs and the moving background.'
                  : 'Off: screens change instantly.'}
            </Text>
          </View>
          <Toggle value={prefs.animations && !osReduceMotion} label="Animations" onChange={(animations) => update({ animations })} />
        </View>
        <View style={[styles.kindRow, styles.divider]}>
          <View style={styles.rowIcon}>
            <Icon name="hand" size={19} color={colors.sky} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Haptics</Text>
            <Text style={type.small}>A light tap when you press buttons and switches.</Text>
          </View>
          <Toggle value={prefs.haptics} label="Haptics" onChange={(haptics) => update({ haptics })} />
        </View>
        <View style={[styles.kindRow, styles.divider]}>
          <View style={styles.rowIcon}>
            <Icon name="mic" size={19} color={colors.sky} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Ask Flo shortcut</Text>
            <Text style={type.small}>Ask or Dictate from the notification shade with one tap.</Text>
          </View>
          <Toggle value={prefs.quickActions} label="Ask Flo shortcut" onChange={(v) => update({ quickActions: v })} />
        </View>
        <Pressable testID="open-customize" accessibilityRole="button" onPress={onCustomize} style={[styles.kindRow, styles.divider]}>
          <Notchling size={40} avatar={prefs.avatar} accent={colors.sky} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Accent and Notchling</Text>
            <Text style={type.small}>Make Flo yours on this phone.</Text>
          </View>
          <Icon name="chevron" size={18} color={colors.inkMuted} />
        </Pressable>
      </GlassCard>
      <Text style={styles.footnote}>Saved on this phone and applied right away. Your computer keeps its own settings.</Text>

      {bubble.state() !== 'unavailable' && <Text style={styles.section}>Voice bubble</Text>}
      <BubbleCard />

      <Text style={styles.section}>Your computer</Text>
      <Pressable testID="open-computer-settings" accessibilityRole="button" onPress={onComputer}>
        <GlassCard style={styles.rowCard}>
          <View style={styles.rowIcon}>
            <Icon name="laptop" size={19} color={colors.sky} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Flo on your computer</Text>
            <Text style={type.small} numberOfLines={2}>
              {!pc
                ? computer.loaded
                  ? 'Waiting for your computer to check in'
                  : 'Looking for your computer'
                : `${computerName(pc.computer.platform)}${pc.computer.appVersion ? ` · Flo ${pc.computer.appVersion}` : ''} · ${
                    pcFresh.offline ? 'looks offline' : `updated ${computer.updatedAt ? relativeTime(computer.updatedAt) : ''}`
                  }`}
            </Text>
            {!!pc && <Text style={[type.small, { color: colors.sky, marginTop: 2 }]}>See and change Flo's settings there</Text>}
          </View>
          <Icon name="chevron" size={18} color={colors.inkMuted} />
        </GlassCard>
      </Pressable>

      <Text style={styles.footnote}>
        {pc ? `Flo's settings on your ${computerName(pc.computer.platform)}. Changing them there doesn't change this phone.` : 'Flo on your computer has its own settings. They show up here once it checks in.'}
      </Text>

      <Text style={styles.section}>App updates</Text>
      <GlassCard style={styles.rowCard}>
        <View style={styles.rowIcon}>
          <Icon name="download" size={19} color={colors.sky} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle} testID="app-version">
            Flo {installedVersion()}
            {installedBuild() ? ` (${installedBuild()})` : ''}
          </Text>
          <Text style={type.small}>
            {upd.checking
              ? 'Checking…'
              : upd.native
                ? `Flo ${upd.native.versionName} is available`
                : upd.otaReady
                  ? 'An update is ready. Restart to use it.'
                  : upd.lastChecked
                    ? "You're up to date"
                    : 'Updates install by themselves'}
          </Text>
        </View>
        <GlassButton
          compact
          testID="check-updates"
          label={upd.native ? 'Install' : upd.otaReady ? 'Restart' : 'Check'}
          onPress={() => void (upd.native ? upd.install() : upd.otaReady ? upd.restart() : upd.check())}
        />
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
            'You will stop getting updates here until you pair again from your computer.',
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

const styles = themed(() => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  headerTitle: { fontFamily: fonts.semibold, fontSize: 17, color: colors.ink },
  tabTitle: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 34, letterSpacing: -0.8, color: colors.ink, marginTop: 4, marginBottom: 18, marginLeft: 4 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18 },
  avatar: { width: 54, height: 54, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.bold, fontSize: 19, color: '#0b1220' },
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
  seg: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 14,
    backgroundColor: colors.dark ? 'rgba(255,255,255,0.06)' : 'rgba(20,30,60,0.06)',
  },
  segItem: { flex: 1, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segOn: {
    backgroundColor: colors.dark ? 'rgba(255,255,255,0.12)' : '#ffffff',
    shadowColor: '#2b2370',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segText: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkMuted },
  segTextOn: { fontFamily: fonts.semibold, color: colors.ink },
}));
