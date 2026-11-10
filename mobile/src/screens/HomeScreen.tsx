import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isMuted } from '../lib/kinds';
import { useFlo } from '../state/FloContext';
import { useComputer } from '../state/Computer';
import { TAB_BAR_SPACE } from '../ui/TabBar';
import { IconButton } from '../ui/Buttons';
import { EmptyInbox } from '../ui/EmptyInbox';
import { Icon } from '../ui/Icons';
import { Notchling, type Mood } from '../ui/Notchling';
import { UpdateCard } from '../ui/UpdateCard';
import { GlassCard } from '../ui/Glass';
import { usePrefs } from '../state/Prefs';
import { Pressable } from 'react-native';
import { tap } from '../ui/Buttons';
import { colors, fonts, type, themed } from '../ui/theme';
import { InboxRow } from './InboxRow';
import { PresenceCard } from './PresenceCard';
import { layoutNext } from '../ui/motion';

function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function HomeScreen({ onSettings, onVoice, onNeedsYou, onTodos }: { onSettings: () => void; onVoice: (mode: 'ask' | 'todo' | 'note') => void; onNeedsYou?: () => void; onTodos?: () => void }) {
  const insets = useSafeAreaInsets();
  const flo = useFlo();
  const computer = useComputer();
  const openTodos = computer.state?.todos.open.length ?? 0;
  const [expanded, setExpanded] = useState<string | null>(null);
  const { prefs } = usePrefs();
  // excited for a few seconds when something new lands
  const [fresh, setFresh] = useState(false);
  const newest = flo.inbox[0]?.id;
  const seen = React.useRef(newest);
  useEffect(() => {
    if (!newest || newest === seen.current) return;
    seen.current = newest;
    setFresh(true);
    const t = setTimeout(() => setFresh(false), 4500);
    return () => clearTimeout(t);
  }, [newest]);
  const mood: Mood = fresh ? 'excited' : flo.presence?.status === 'away' ? 'happy' : 'happy';

  const visible = useMemo(() => flo.inbox.filter((i) => !isMuted(i.kind, flo.mutes)), [flo.inbox, flo.mutes]);
  const hidden = flo.inbox.length - visible.length;

  useEffect(() => {
    if (flo.focusId) {
      setExpanded(flo.focusId);
      flo.clearFocus();
    }
  }, [flo.focusId, flo]);

  const toggle = (id: string) => {
    layoutNext(240);
    setExpanded((cur) => (cur === id ? null : id));
  };

  const first = flo.session?.user.name?.split(' ')[0];

  return (
    <FlatList
      testID="home"
      data={visible}
      keyExtractor={(i) => i.id}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + TAB_BAR_SPACE, paddingHorizontal: 18 }}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      refreshControl={
        <RefreshControl
          refreshing={flo.refreshing}
          onRefresh={() => void flo.refresh()}
          tintColor={colors.sky}
          colors={[colors.sky, colors.ocean]}
          progressBackgroundColor={colors.bgElevated}
        />
      }
      ListHeaderComponent={
        <View>
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
              <Notchling mood={mood} size={48} avatar={prefs.avatar} accent={colors.sky} testID="home-mascot" />
              <View style={{ flex: 1 }}>
                <Text style={type.small}>{greeting()}</Text>
                <Text style={styles.name} numberOfLines={1}>
                  {first || 'Flo'}
                </Text>
              </View>
            </View>
            <IconButton testID="open-settings" label="Settings" onPress={onSettings}>
              <Icon name="gear" size={20} color={colors.inkSoft} />
            </IconButton>
          </View>

          {!!flo.error && (
            <View style={styles.error}>
              <Text style={styles.errorText}>{flo.error}</Text>
            </View>
          )}

          <UpdateCard />

          <View style={styles.actions}>
            <Pressable
              testID="ask-flo"
              accessibilityRole="button"
              onPress={() => {
                tap();
                onVoice('ask');
              }}
              style={{ flex: 1.15 }}
            >
              <View style={styles.askBtn}>
                <Icon name="sparkle" size={20} color={colors.onPrimary} />
                <View style={styles.btnText}>
                  <Text style={styles.askTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>Ask Flo</Text>
                  <Text style={styles.askSub} numberOfLines={3}>Your computer answers</Text>
                </View>
              </View>
            </Pressable>
            <Pressable
              testID="dictate"
              accessibilityRole="button"
              onPress={() => {
                tap();
                onVoice('todo');
              }}
              style={{ flex: 1 }}
            >
              <GlassCard radius={22} style={styles.dictBtn}>
                <Icon name="mic" size={20} color={colors.sky} />
                <View style={styles.btnText}>
                  <Text style={styles.dictTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>Dictate</Text>
                  <Text style={type.small} numberOfLines={3}>To-do or note</Text>
                </View>
              </GlassCard>
            </Pressable>
          </View>

          {computer.needsYouCount > 0 && onNeedsYou && (
            <Pressable testID="home-needs-you" accessibilityRole="button" onPress={onNeedsYou} style={{ marginBottom: 14 }}>
              <GlassCard radius={22} tint={colors.amber} strong style={styles.needs}>
                <View style={styles.needsIcon}>
                  <Icon name="hand" size={20} color={colors.amber} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.needsTitle}>Claude needs you</Text>
                  <Text style={type.small}>
                    {computer.needsYouCount === 1 ? '1 question' : `${computer.needsYouCount} questions`} waiting on your computer. Tap to answer.
                  </Text>
                </View>
                <Icon name="chevron" size={18} color={colors.inkMuted} />
              </GlassCard>
            </Pressable>
          )}

          <PresenceCard presence={flo.presence} busy={flo.presenceBusy} onChange={(s) => void flo.setPresence(s)} />

          {openTodos > 0 && onTodos && (
            <Pressable testID="home-todos" accessibilityRole="button" onPress={onTodos} style={{ marginTop: 10 }}>
              <GlassCard radius={22} style={styles.needs}>
                <View style={[styles.needsIcon, { backgroundColor: colors.dark ? 'rgba(102,206,255,0.1)' : 'rgba(47,140,255,0.08)' }]}>
                  <Icon name="todos" size={20} color={colors.sky} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.needsTitle}>{openTodos === 1 ? '1 to-do' : `${openTodos} to-dos`}</Text>
                  <Text style={type.small} numberOfLines={1}>
                    {computer.state?.todos.open[0]?.title}
                  </Text>
                </View>
                <Icon name="chevron" size={18} color={colors.inkMuted} />
              </GlassCard>
            </Pressable>
          )}

          <View style={styles.sectionRow}>
            <Text style={styles.section}>Inbox</Text>
            {visible.length > 0 && (
              <View style={styles.count}>
                <Text style={styles.countText}>{visible.length}</Text>
              </View>
            )}
            <View style={{ flex: 1 }} />
            <Text style={type.small}>Pull to refresh</Text>
          </View>
        </View>
      }
      ListEmptyComponent={<EmptyInbox away={flo.presence?.status === 'away'} />}
      ListFooterComponent={
        hidden > 0 ? (
          <Text style={styles.hidden}>
            {hidden} muted {hidden === 1 ? 'update' : 'updates'} hidden · change in Settings
          </Text>
        ) : undefined
      }
      renderItem={({ item, index }) => (
        <InboxRow item={item} index={index} expanded={expanded === item.id} onToggle={() => toggle(item.id)} />
      )}
    />
  );
}

const styles = themed(() => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 18, paddingHorizontal: 2 },
  actions: { flexDirection: 'row', alignItems: 'stretch', gap: 10, marginBottom: 14 },
  askBtn: {
    flex: 1,
    minHeight: 74,
    paddingVertical: 12,
    borderRadius: 22,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    shadowColor: '#2b2370',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  askTitle: { fontFamily: fonts.semibold, fontSize: 17, color: colors.onPrimary },
  askSub: { fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 17, color: colors.onPrimary, opacity: 0.7 },
  /** the label beside the icon shrinks and wraps instead of pushing the icon out of the button */
  btnText: { flex: 1, minWidth: 0 },
  needs: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  needsIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dark ? 'rgba(245,181,68,0.14)' : 'rgba(196,122,0,0.1)',
  },
  needsTitle: { fontFamily: fonts.semibold, fontSize: 15.5, color: colors.ink, letterSpacing: -0.2 },
  dictBtn: { flex: 1, minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  dictTitle: { fontFamily: fonts.semibold, fontSize: 17, color: colors.ink },
  name: { fontFamily: fonts.semibold, fontSize: 21, color: colors.ink, letterSpacing: -0.4 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 28, marginBottom: 12, paddingHorizontal: 4 },
  section: { fontFamily: fonts.semibold, fontSize: 19, color: colors.ink, letterSpacing: -0.3 },
  count: {
    minWidth: 24,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 11,
    backgroundColor: colors.dark ? 'rgba(102,206,255,0.14)' : 'rgba(47,140,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.sky },
  hidden: { ...type.small, textAlign: 'center', marginTop: 18, color: colors.inkFaint },
  error: {
    marginBottom: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.errorBg,
    borderWidth: 1,
    borderColor: colors.errorBorder,
  },
  errorText: { ...type.small, color: colors.errorText },
}));
