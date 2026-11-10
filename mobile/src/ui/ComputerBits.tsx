// Shared pieces for the screens that show your computer (To-dos, Needs you, computer settings).
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { freshness } from '../lib/computer';
import { relativeTime } from '../lib/time';
import { useComputer } from '../state/Computer';
import { usePrefs } from '../state/Prefs';
import { tap } from './Buttons';
import { GlassCard } from './Glass';
import { Icon, type IconName } from './Icons';
import { Notchling, type Mood } from './Notchling';
import { colors, fonts, themed, type } from './theme';

/** "On your computer · updated just now" / "Your computer looks offline · last seen 2h ago". */
export function ComputerLine() {
  const c = useComputer();
  if (!c.state) return null;
  const f = freshness(c.updatedAt);
  const when = c.updatedAt ? relativeTime(c.updatedAt) : '';
  return (
    <View style={styles.line}>
      <View style={[styles.dot, { backgroundColor: f.offline ? colors.amber : colors.green }]} />
      <Text style={[type.small, { flexShrink: 1 }]} numberOfLines={2}>
        {f.offline ? `Your computer looks offline${when ? ` · last seen ${when}` : ''}` : `On your computer · updated ${when}`}
      </Text>
    </View>
  );
}

export function ScreenHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        <ComputerLine />
      </View>
      {right}
    </View>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={styles.seg}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            testID={`seg-${o.id}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => {
              tap();
              onChange(o.id);
            }}
            style={[styles.segItem, on && styles.segOn]}
          >
            <Text style={[styles.segText, on && { color: colors.ink, fontFamily: fonts.semibold }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function EmptyState({ icon, mood = 'happy', title, body }: { icon?: IconName; mood?: Mood; title: string; body: string }) {
  const { prefs } = usePrefs();
  return (
    <GlassCard style={styles.empty} radius={26}>
      {icon ? (
        <View style={styles.emptyIcon}>
          <Icon name={icon} size={26} color={colors.sky} />
        </View>
      ) : (
        <Notchling size={64} mood={mood} avatar={prefs.avatar} accent={colors.sky} />
      )}
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={[type.small, { textAlign: 'center' }]}>{body}</Text>
    </GlassCard>
  );
}

/** Nothing published yet: Flo isn't signed in on the computer, or it's an older version. */
export function NoComputer() {
  const c = useComputer();
  if (!c.loaded) return <EmptyState mood="think" title="Looking for your computer" body="One moment." />;
  return (
    <EmptyState
      mood="sleepy"
      title="Your computer hasn't checked in yet"
      body="Open Flo on your computer and sign in. Your to-dos, Claude Code questions and settings show up here a few seconds later."
    />
  );
}

/** A failed action ("That question already closed on your computer."), dismissed after a while. */
export function ActionNotice() {
  const c = useComputer();
  useEffect(() => {
    if (!c.notice) return;
    const t = setTimeout(c.clearNotice, 6000);
    return () => clearTimeout(t);
  }, [c.notice, c.clearNotice]);
  if (!c.notice && !c.error) return null;
  return (
    <Pressable onPress={c.clearNotice} style={styles.notice} accessibilityRole="alert">
      <Text style={styles.noticeText}>{c.notice ?? c.error}</Text>
    </Pressable>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', marginBottom: 18, paddingHorizontal: 4, gap: 12 },
    title: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 34, letterSpacing: -0.8, color: colors.ink },
    line: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 3, minWidth: 0 },
    dot: { width: 7, height: 7, borderRadius: 4 },
    seg: {
      flexDirection: 'row',
      padding: 4,
      borderRadius: 16,
      backgroundColor: colors.dark ? 'rgba(255,255,255,0.05)' : 'rgba(20,30,60,0.06)',
      marginBottom: 14,
    },
    segItem: { flex: 1, minHeight: 36, paddingVertical: 6, paddingHorizontal: 6, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    segOn: {
      backgroundColor: colors.dark ? 'rgba(255,255,255,0.1)' : '#ffffff',
      shadowColor: '#2b2370',
      shadowOpacity: 0.08,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
    },
    segText: { fontFamily: fonts.medium, fontSize: 14, color: colors.inkMuted, textAlign: 'center' },
    empty: { alignItems: 'center', gap: 8, paddingVertical: 30, paddingHorizontal: 26 },
    emptyIcon: {
      width: 56,
      height: 56,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.dark ? 'rgba(102,206,255,0.1)' : 'rgba(47,140,255,0.1)',
    },
    emptyTitle: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 23, color: colors.ink, textAlign: 'center', marginTop: 4 },
    notice: {
      marginBottom: 14,
      padding: 14,
      borderRadius: 16,
      backgroundColor: colors.errorBg,
      borderWidth: 1,
      borderColor: colors.errorBorder,
    },
    noticeText: { ...type.small, color: colors.errorText },
  }),
);
