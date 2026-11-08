import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, LayoutAnimation, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isMuted } from '../lib/kinds';
import { useFlo } from '../state/FloContext';
import { IconButton } from '../ui/Buttons';
import { EmptyInbox } from '../ui/EmptyInbox';
import { FloMark, Icon } from '../ui/Icons';
import { colors, fonts, type } from '../ui/theme';
import { InboxRow } from './InboxRow';
import { PresenceCard } from './PresenceCard';

function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function HomeScreen({ onSettings }: { onSettings: () => void }) {
  const insets = useSafeAreaInsets();
  const flo = useFlo();
  const [expanded, setExpanded] = useState<string | null>(null);

  const visible = useMemo(() => flo.inbox.filter((i) => !isMuted(i.kind, flo.mutes)), [flo.inbox, flo.mutes]);
  const hidden = flo.inbox.length - visible.length;

  useEffect(() => {
    if (flo.focusId) {
      setExpanded(flo.focusId);
      flo.clearFocus();
    }
  }, [flo.focusId, flo]);

  const toggle = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.create(240, 'easeInEaseOut', 'opacity'));
    setExpanded((cur) => (cur === id ? null : id));
  };

  const first = flo.session?.user.name?.split(' ')[0];

  return (
    <FlatList
      testID="home"
      data={visible}
      keyExtractor={(i) => i.id}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32, paddingHorizontal: 18 }}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      refreshControl={
        <RefreshControl
          refreshing={flo.refreshing}
          onRefresh={() => void flo.refresh()}
          tintColor={colors.sky}
          colors={[colors.sky, colors.ocean]}
          progressBackgroundColor="#0d1620"
        />
      }
      ListHeaderComponent={
        <View>
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
              <View style={styles.logo}>
                <FloMark size={26} glow={false} />
              </View>
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

          <PresenceCard presence={flo.presence} busy={flo.presenceBusy} onChange={(s) => void flo.setPresence(s)} />

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

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 18, paddingHorizontal: 2 },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: '#071521',
    borderWidth: 1,
    borderColor: 'rgba(102,206,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontFamily: fonts.semibold, fontSize: 21, color: colors.ink, letterSpacing: -0.4 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 28, marginBottom: 12, paddingHorizontal: 4 },
  section: { fontFamily: fonts.semibold, fontSize: 19, color: colors.ink, letterSpacing: -0.3 },
  count: {
    minWidth: 24,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: 11,
    backgroundColor: 'rgba(102,206,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.sky },
  hidden: { ...type.small, textAlign: 'center', marginTop: 18, color: colors.inkFaint },
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
