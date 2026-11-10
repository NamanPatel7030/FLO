// Every setting of Flo on your computer that's safe to show (never API keys or tokens). Simple ones
// (toggles, choices, numbers) can be changed here; privacy settings and the rest are read-only.
//
// These are the computer's settings, not the phone's: the phone's own theme, animations and
// haptics live in Settings > This phone. A change here goes through the server to the computer, so
// each row says where it is (sending, applied, waiting for an offline computer, refused) and never
// spins for more than a few seconds (lib/settingSync.ts).
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ComputerSetting } from '../api/types';
import { computerName, freshness, groupSettings, settingText } from '../lib/computer';
import { spins, statusLine, type SettingChange } from '../lib/settingSync';
import { useSettingSync } from '../state/SettingSync';
import { useComputer } from '../state/Computer';
import { IconButton, tap } from '../ui/Buttons';
import { ActionNotice, ComputerLine, NoComputer } from '../ui/ComputerBits';
import { GlassCard } from '../ui/Glass';
import { Icon } from '../ui/Icons';
import { Toggle } from '../ui/Toggle';
import { colors, fonts, themed, type } from '../ui/theme';

function Stepper({ s, onChange }: { s: ComputerSetting; onChange: (n: number) => void }) {
  const v = typeof s.value === 'number' ? s.value : 0;
  const step = (s.max ?? 100) - (s.min ?? 0) > 50 ? 5 : 1;
  const clamp = (n: number) => Math.min(s.max ?? Infinity, Math.max(s.min ?? -Infinity, n));
  const btn = (icon: 'minus' | 'plus', n: number, label: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${s.label}`}
      hitSlop={6}
      disabled={n === v}
      onPress={() => {
        tap();
        onChange(n);
      }}
      style={[styles.stepBtn, n === v && { opacity: 0.35 }]}
    >
      <Icon name={icon} size={16} color={colors.ink} strokeWidth={2.2} />
    </Pressable>
  );
  return (
    <View style={styles.stepper}>
      {btn('minus', clamp(v - step), 'Lower')}
      <Text style={styles.stepValue}>{v}</Text>
      {btn('plus', clamp(v + step), 'Raise')}
    </View>
  );
}

const valueText = (s: ComputerSetting) => (v: ComputerSetting['value']) => settingText({ ...s, value: v });

function SettingRow({
  s,
  first,
  change,
  onSet,
}: {
  s: ComputerSetting;
  first: boolean;
  change?: SettingChange;
  onSet: (v: boolean | number | string) => void;
}) {
  const [open, setOpen] = useState(false);
  const editable = s.editable;
  const right = !editable ? (
    <View style={styles.readOnly}>
      <Text style={styles.value} numberOfLines={2}>
        {settingText(s)}
      </Text>
      <Icon name="lock" size={14} color={colors.inkFaint} />
    </View>
  ) : s.kind === 'toggle' ? (
    <Toggle value={s.value === true} label={s.label} onChange={(v) => onSet(v)} />
  ) : s.kind === 'number' ? (
    <Stepper s={s} onChange={(n) => onSet(n)} />
  ) : s.kind === 'select' ? (
    <Pressable
      testID={`select-${s.key}`}
      accessibilityRole="button"
      accessibilityLabel={`${s.label}: ${settingText(s)}`}
      onPress={() => {
        tap();
        setOpen((o) => !o);
      }}
      style={styles.selectBtn}
    >
      <Text style={styles.selectText} numberOfLines={1}>
        {settingText(s)}
      </Text>
      <View style={{ transform: [{ rotate: open ? '-90deg' : '90deg' }] }}>
        <Icon name="chevron" size={14} color={colors.inkMuted} strokeWidth={2.2} />
      </View>
    </Pressable>
  ) : null;

  const status = statusLine(change, valueText(s));
  const statusColor =
    change?.phase === 'applied'
      ? colors.green
      : change?.phase === 'failed'
        ? colors.errorText
        : change?.phase === 'sending'
          ? colors.inkMuted
          : colors.amber;

  return (
    <View testID={`setting-${s.key}`} style={[styles.row, !first && styles.divider]}>
      <View style={styles.rowTop}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.label, !editable && { color: colors.inkSoft }]}>{s.label}</Text>
          {!editable && !!s.hint && <Text style={styles.hint}>{s.hint}</Text>}
          {!!status && (
            <View style={styles.statusRow} testID={`setting-status-${s.key}`}>
              {change?.phase === 'applied' && <Icon name="check" size={13} color={colors.green} strokeWidth={2.6} />}
              <Text style={[styles.status, { color: statusColor }]}>{status}</Text>
            </View>
          )}
        </View>
        {spins(change) && <ActivityIndicator size="small" color={colors.sky} style={{ marginRight: 6 }} />}
        {right}
      </View>
      {open && s.kind === 'select' && (
        <View style={styles.chips}>
          {(s.options ?? []).map((o) => {
            const on = o.value === s.value;
            return (
              <Pressable
                key={o.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  tap();
                  setOpen(false);
                  if (!on) onSet(o.value);
                }}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={[styles.chipText, on && { color: colors.sky, fontFamily: fonts.semibold }]}>{o.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

export function ComputerSettingsScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const c = useComputer();
  const sync = useSettingSync();
  const groups = c.state ? groupSettings(c.state.settings) : [];
  const name = c.state ? computerName(c.state.computer.platform) : 'computer';
  const offline = freshness(c.updatedAt).offline;
  return (
    <ScrollView
      testID="computer-settings"
      contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 40, paddingHorizontal: 18 }}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={() => void c.refresh()} tintColor={colors.sky} colors={[colors.sky, colors.ocean]} progressBackgroundColor={colors.bgElevated} />
      }
    >
      <View style={styles.header}>
        <IconButton testID="computer-settings-back" label="Back" onPress={onBack}>
          <Icon name="back" color={colors.ink} />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={[styles.headerTitle, { textAlign: 'center' }]}>Flo on your {name}</Text>
          <ComputerLine />
        </View>
        <View style={{ width: 44 }} />
      </View>
      <ActionNotice />
      {!c.state ? (
        <NoComputer />
      ) : (
        <>
          <GlassCard style={styles.scope}>
            <Icon name="laptop" size={18} color={colors.sky} />
            <Text style={styles.scopeText}>
              These are Flo's settings on your {name}. They don't change this phone: its theme, animations and haptics are in Settings, This phone.
            </Text>
          </GlassCard>
          {offline && (
            <View style={styles.offline} testID="computer-offline">
              <Text style={styles.offlineText}>
                Your {name} looks offline. Changes you make wait on Flo's server and apply when Flo is open there again (within 10 minutes).
              </Text>
            </View>
          )}
          <Text style={styles.intro}>
            Changes reach your {name} in about 10 to 20 seconds. Settings with a lock change only there. API keys and passwords never leave your computer.
          </Text>
          {groups.map((g) => (
            <View key={g.section}>
              <Text style={styles.section}>{g.section}</Text>
              <GlassCard style={{ paddingVertical: 2 }}>
                {g.items.map((s, i) => (
                  <SettingRow key={s.key} s={s} first={i === 0} change={sync.changes[s.key]} onSet={(v) => sync.send(s, v)} />
                ))}
              </GlassCard>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
    headerTitle: { fontFamily: fonts.semibold, fontSize: 17, color: colors.ink },
    intro: { ...type.small, marginHorizontal: 6, marginBottom: 4, marginTop: 12 },
    scope: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14 },
    scopeText: { ...type.small, flex: 1, color: colors.inkSoft },
    offline: {
      marginTop: 12,
      padding: 14,
      borderRadius: 16,
      backgroundColor: colors.dark ? 'rgba(245,181,68,0.08)' : 'rgba(196,122,0,0.07)',
      borderWidth: 1,
      borderColor: colors.dark ? 'rgba(245,181,68,0.25)' : 'rgba(196,122,0,0.22)',
    },
    offlineText: { ...type.small, color: colors.amber },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
    status: { fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 17, flexShrink: 1 },
    section: { ...type.micro, marginTop: 24, marginBottom: 10, marginLeft: 6 },
    row: { paddingHorizontal: 16, paddingVertical: 13 },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 32 },
    divider: { borderTopWidth: 1, borderTopColor: colors.hairline },
    label: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21, color: colors.ink, letterSpacing: -0.15 },
    hint: { ...type.small, fontSize: 12, color: colors.inkFaint, marginTop: 2 },
    readOnly: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '48%' },
    value: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 19, color: colors.inkMuted, flexShrink: 1, textAlign: 'right' },
    selectBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      maxWidth: '48%',
      minHeight: 34,
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 12,
      backgroundColor: colors.dark ? 'rgba(255,255,255,0.07)' : 'rgba(20,30,60,0.05)',
    },
    selectText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink, flexShrink: 1 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    chip: {
      maxWidth: '100%',
      paddingHorizontal: 14,
      minHeight: 34,
      paddingVertical: 6,
      borderRadius: 17,
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.hairline,
      backgroundColor: colors.dark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.7)',
    },
    chipOn: { borderColor: colors.sky, backgroundColor: colors.dark ? 'rgba(102,206,255,0.12)' : 'rgba(47,140,255,0.08)' },
    chipText: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkSoft },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    stepBtn: {
      width: 32,
      height: 32,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.dark ? 'rgba(255,255,255,0.07)' : 'rgba(20,30,60,0.06)',
    },
    stepValue: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink, minWidth: 34, textAlign: 'center', fontVariant: ['tabular-nums'] },
  }),
);
