// To-dos from your computer: check one off here and it's done there too. Done ones can be undone.
import React, { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TodoDone, TodoOpen } from '../api/types';
import { dueLabel } from '../lib/computer';
import { relativeTime } from '../lib/time';
import { useComputer } from '../state/Computer';
import { tap } from '../ui/Buttons';
import { ActionNotice, EmptyState, NoComputer, ScreenHeader, Segmented } from '../ui/ComputerBits';
import { GlassCard } from '../ui/Glass';
import { Icon } from '../ui/Icons';
import { TAB_BAR_SPACE } from '../ui/TabBar';
import { colors, fonts, themed, type } from '../ui/theme';
import { layoutNext } from '../ui/motion';

const SOURCE: Record<string, string> = {
  voice: 'Said to Flo',
  phone: 'From your phone',
  meeting: 'From a meeting',
  slack: 'From Slack',
  attention: 'Spotted on screen',
  manual: 'Added by you',
};

type Row = { kind: 'open'; t: TodoOpen } | { kind: 'done'; t: TodoDone };

function Check({ done, onPress, label, testID }: { done: boolean; onPress: () => void; label: string; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={label}
      hitSlop={12}
      onPress={() => {
        tap();
        onPress();
      }}
      style={[styles.check, done && { backgroundColor: colors.green, borderColor: colors.green }]}
    >
      {done && <Icon name="check" size={15} color="#fff" strokeWidth={2.8} />}
    </Pressable>
  );
}

export function TodosScreen({ onAdd }: { onAdd: () => void }) {
  const insets = useSafeAreaInsets();
  const c = useComputer();
  const [view, setView] = useState<'open' | 'done'>('open');
  const open = c.state?.todos.open ?? [];
  const done = c.state?.todos.done ?? [];
  const rows: Row[] = view === 'open' ? open.map((t) => ({ kind: 'open', t })) : done.map((t) => ({ kind: 'done', t }));

  const toggle = (r: Row) => {
    layoutNext(220);
    void c.act(r.kind === 'open' ? 'todo_done' : 'todo_reopen', r.t.id);
  };

  return (
    <FlatList
      testID="todos"
      data={c.state ? rows : []}
      keyExtractor={(r) => r.t.id}
      contentContainerStyle={{ paddingTop: insets.top + 14, paddingBottom: insets.bottom + TAB_BAR_SPACE, paddingHorizontal: 18 }}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={() => void c.refresh()}
          tintColor={colors.sky}
          colors={[colors.sky, colors.ocean]}
          progressBackgroundColor={colors.bgElevated}
        />
      }
      ListHeaderComponent={
        <View>
          <ScreenHeader
            title="To-dos"
            right={
              <Pressable testID="add-todo" accessibilityRole="button" accessibilityLabel="Add a to-do" onPress={onAdd} style={styles.add}>
                <Icon name="plus" size={18} color={colors.onPrimary} strokeWidth={2.2} />
                <Text style={styles.addText}>Add</Text>
              </Pressable>
            }
          />
          <ActionNotice />
          {c.state && (
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { id: 'open', label: `To do${open.length ? ` · ${open.length}` : ''}` },
                { id: 'done', label: `Done${done.length ? ` · ${done.length}` : ''}` },
              ]}
            />
          )}
        </View>
      }
      ListEmptyComponent={
        !c.state ? (
          <NoComputer />
        ) : view === 'open' ? (
          <EmptyState mood="celebrate" title="All clear" body="Nothing left on your list. Tap Add, or hold the mic and say what you need to do." />
        ) : (
          <EmptyState icon="todos" title="Nothing done this week yet" body="Check something off and it shows up here for a week." />
        )
      }
      ListFooterComponent={
        view === 'done' && done.length > 0 ? <Text style={styles.footnote}>Showing the last 7 days. Tap a check to put it back on your list.</Text> : undefined
      }
      renderItem={({ item: r }) => {
        const isDone = r.kind === 'done';
        const due = r.kind === 'open' ? dueLabel(r.t.due) : '';
        const overdue = due.startsWith('Overdue');
        const meta =
          r.kind === 'open'
            ? [r.t.person ? `With ${r.t.person}` : '', r.t.source ? SOURCE[r.t.source] ?? '' : ''].filter(Boolean).join(' · ')
            : r.t.completedAt
              ? `Done ${relativeTime(r.t.completedAt).toLowerCase()}`
              : 'Done';
        return (
          <GlassCard style={styles.row} radius={20}>
            <Check testID={`check-${r.t.id}`} done={isDone} onPress={() => toggle(r)} label={isDone ? `Put back: ${r.t.title}` : `Done: ${r.t.title}`} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, isDone && styles.titleDone]}>{r.t.title}</Text>
              {(!!due || !!meta) && (
                <View style={styles.metaRow}>
                  {!!due && (
                    <View style={[styles.due, overdue && { backgroundColor: colors.errorBg }]}>
                      <Text style={[styles.dueText, overdue && { color: colors.danger }]}>{due}</Text>
                    </View>
                  )}
                  {!!meta && (
                    <Text style={[type.small, { flexShrink: 1 }]} numberOfLines={2}>
                      {meta}
                    </Text>
                  )}
                </View>
              )}
            </View>
          </GlassCard>
        );
      }}
    />
  );
}

const styles = themed(() =>
  StyleSheet.create({
    add: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 38,
      paddingHorizontal: 14,
      borderRadius: 19,
      backgroundColor: colors.primary,
    },
    addText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.onPrimary },
    // a to-do title is shown in full; 1.45x line height keeps Hindi / Gujarati matras from clipping
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingHorizontal: 16, paddingVertical: 15 },
    check: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 2,
      borderColor: colors.dark ? 'rgba(200,216,230,0.35)' : 'rgba(20,30,60,0.22)',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 1,
    },
    title: { fontFamily: fonts.medium, fontSize: 15.5, lineHeight: 23, color: colors.ink, letterSpacing: -0.15 },
    titleDone: { color: colors.inkMuted, textDecorationLine: 'line-through' },
    metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 6 },
    due: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 8,
      backgroundColor: colors.dark ? 'rgba(102,206,255,0.12)' : 'rgba(47,140,255,0.1)',
    },
    dueText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.sky },
    footnote: { ...type.small, textAlign: 'center', marginTop: 16, color: colors.inkFaint },
  }),
);
