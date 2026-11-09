// Needs you: Claude Code asking for permission on your computer. Allow or Deny from here; the
// answer reaches the waiting session within a few seconds. Sessions waiting for a typed reply are
// listed too (answer those on the computer).
import React from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Approval } from '../api/types';
import { liveApprovals } from '../lib/computer';
import { relativeTime } from '../lib/time';
import { useComputer } from '../state/Computer';
import { GlassButton, PrimaryButton } from '../ui/Buttons';
import { ActionNotice, EmptyState, NoComputer, ScreenHeader } from '../ui/ComputerBits';
import { GlassCard } from '../ui/Glass';
import { Icon } from '../ui/Icons';
import { TAB_BAR_SPACE } from '../ui/TabBar';
import { colors, fonts, themed, type } from '../ui/theme';

function left(expiresAt: string, now: number): string {
  const ms = Date.parse(expiresAt) - now;
  if (Number.isNaN(ms)) return '';
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ApprovalCard({ a, onAnswer }: { a: Approval; onAnswer: (allow: boolean) => void }) {
  const command = a.summary.startsWith('Run: ') ? a.summary.slice(5) : null;
  const remaining = left(a.expiresAt, Date.now());
  return (
    <GlassCard style={styles.card} radius={24} tint={colors.amber} strong>
      <View style={styles.cardTop}>
        <View style={styles.cardIcon}>
          <Icon name="claude" size={20} color={colors.amber} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.project} numberOfLines={1}>
            Claude Code · {a.project}
          </Text>
          <Text style={type.small}>{a.tool ? `Wants to use ${a.tool}` : 'Wants permission'}</Text>
        </View>
        {!!remaining && !a.sending && (
          <View style={styles.timer}>
            <Text style={styles.timerText}>{remaining}</Text>
          </View>
        )}
      </View>
      {command ? (
        <View style={styles.code}>
          <Text style={styles.codeText} selectable>
            {command}
          </Text>
        </View>
      ) : (
        <Text style={styles.summary}>{a.summary}</Text>
      )}
      {a.sending ? (
        <View style={styles.sending}>
          <ActivityIndicator size="small" color={colors.sky} />
          <Text style={type.small}>{a.sending === 'approve' ? 'Allowing' : 'Denying'} on your computer…</Text>
        </View>
      ) : (
        <View style={styles.buttons}>
          <GlassButton testID={`deny-${a.id}`} label="Deny" style={{ flex: 1 }} danger onPress={() => onAnswer(false)} icon={<Icon name="close" size={17} color={colors.danger} strokeWidth={2.2} />} />
          <PrimaryButton testID={`allow-${a.id}`} label="Allow" style={{ flex: 1.4 }} onPress={() => onAnswer(true)} icon={<Icon name="check" size={18} color={colors.onPrimary} strokeWidth={2.4} />} />
        </View>
      )}
    </GlassCard>
  );
}

export function NeedsYouScreen() {
  const insets = useSafeAreaInsets();
  const c = useComputer();
  const st = c.state;
  const approvals = st ? liveApprovals(st) : [];
  const approvalsOff = st?.settings.find((s) => s.key === 'claudeApprovals')?.value === false;

  return (
    <ScrollView
      testID="needs-you"
      contentContainerStyle={{ paddingTop: insets.top + 14, paddingBottom: insets.bottom + TAB_BAR_SPACE, paddingHorizontal: 18 }}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={() => void c.refresh()} tintColor={colors.sky} colors={[colors.sky, colors.ocean]} progressBackgroundColor={colors.bgElevated} />
      }
    >
      <ScreenHeader title="Needs you" />
      <ActionNotice />
      {!st ? (
        <NoComputer />
      ) : (
        <>
          {approvals.length > 0 ? (
            <View style={{ gap: 12 }}>
              {approvals.map((a) => (
                <ApprovalCard key={a.id} a={a} onAnswer={(allow) => void c.act(allow ? 'approve' : 'reject', a.id)} />
              ))}
              <Text style={styles.footnote}>
                Claude waits about two minutes. After that the question goes back to the terminal on your computer.
              </Text>
            </View>
          ) : (
            <EmptyState
              mood="proud"
              title="Nothing needs you"
              body={
                approvalsOff
                  ? `"Allow or deny from Flo" is off on your computer, so Claude Code asks in the terminal. Turn it on in Settings to answer here.`
                  : `When Claude Code asks for permission on your computer, you can Allow or Deny it here.`
              }
            />
          )}

          {st.waiting.length > 0 && (
            <>
              <Text style={styles.section}>Waiting for your reply</Text>
              <GlassCard style={{ paddingVertical: 4 }}>
                {st.waiting.map((w, i) => (
                  <View key={w.id} style={[styles.waitRow, i > 0 && styles.divider]}>
                    <View style={styles.waitIcon}>
                      <Icon name="terminal" size={18} color={colors.sky} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.waitTitle} numberOfLines={1}>
                        {w.project}
                      </Text>
                      <Text style={type.small} numberOfLines={2}>
                        {w.message || 'Claude is waiting for your input'}
                        {w.at ? ` · ${relativeTime(w.at).toLowerCase()}` : ''}
                      </Text>
                    </View>
                  </View>
                ))}
              </GlassCard>
              <Text style={styles.footnote}>Reply to these in the terminal on your computer, or with Ask Flo.</Text>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    card: { padding: 18, gap: 14 },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    cardIcon: {
      width: 40,
      height: 40,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.dark ? 'rgba(245,181,68,0.14)' : 'rgba(196,122,0,0.1)',
    },
    project: { fontFamily: fonts.semibold, fontSize: 15.5, color: colors.ink, letterSpacing: -0.2 },
    timer: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, backgroundColor: colors.dark ? 'rgba(255,255,255,0.07)' : 'rgba(20,30,60,0.06)' },
    timerText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.inkSoft, fontVariant: ['tabular-nums'] },
    code: {
      padding: 12,
      borderRadius: 14,
      backgroundColor: colors.dark ? 'rgba(0,0,0,0.35)' : 'rgba(11,18,32,0.9)',
    },
    codeText: { fontFamily: 'monospace', fontSize: 13.5, lineHeight: 19, color: '#e8f3ff' },
    summary: { fontFamily: fonts.medium, fontSize: 15.5, lineHeight: 21, color: colors.ink },
    buttons: { flexDirection: 'row', gap: 10 },
    sending: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 44 },
    section: { ...type.micro, marginTop: 26, marginBottom: 10, marginLeft: 6 },
    waitRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
    waitIcon: {
      width: 36,
      height: 36,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.dark ? 'rgba(102,206,255,0.1)' : 'rgba(47,140,255,0.08)',
    },
    waitTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
    divider: { borderTopWidth: 1, borderTopColor: colors.hairline },
    footnote: { ...type.small, marginTop: 4, marginHorizontal: 6, color: colors.inkFaint },
  }),
);
