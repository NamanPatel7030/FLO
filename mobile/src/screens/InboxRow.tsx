import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { InboxItem } from '../api/types';
import { kindLabel, metaForKind } from '../lib/kinds';
import { relativeTime } from '../lib/time';
import { tap } from '../ui/Buttons';
import { GlassCard } from '../ui/Glass';
import { Icon } from '../ui/Icons';
import { KindIcon } from '../ui/KindIcon';
import { colors, fonts, type, themed } from '../ui/theme';
import { timing } from '../ui/motion';

const native = Platform.OS !== 'web';

function detailEntries(data: InboxItem['data']): [string, string][] {
  if (!data) return [];
  return Object.entries(data)
    .filter(([k, v]) => k !== 'kind' && k !== 'id' && (typeof v === 'string' || typeof v === 'number'))
    .slice(0, 4)
    .map(([k, v]) => [k, String(v)]);
}

export function InboxRow({
  item,
  index,
  expanded,
  onToggle,
}: {
  item: InboxItem;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const m = metaForKind(item.kind);
  const enter = useRef(new Animated.Value(0)).current;
  const rot = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  useEffect(() => {
    timing(enter, {
      toValue: 1,
      duration: 480,
      delay: Math.min(index, 8) * 55,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: native,
    }).start();
  }, [enter, index]);

  useEffect(() => {
    timing(rot, { toValue: expanded ? 1 : 0, duration: 220, useNativeDriver: native }).start();
  }, [expanded, rot]);

  const details = expanded ? detailEntries(item.data) : [];
  const urgent = item.kind === 'claude_needs_you';

  return (
    <Animated.View
      style={{
        opacity: enter,
        transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
      }}
    >
      <Pressable
        testID={`inbox-${item.id}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => {
          tap();
          onToggle();
        }}
      >
        {({ pressed }) => (
          <GlassCard tint={expanded || urgent ? m.color : undefined} radius={22} style={[styles.card, pressed && { opacity: 0.85 }]}>
            <View style={styles.row}>
              <KindIcon kind={item.kind} />
              <View style={{ flex: 1 }}>
                <View style={styles.meta}>
                  <Text style={[styles.kind, { color: m.color }]} numberOfLines={1}>
                    {kindLabel(item.kind)}
                  </Text>
                  <Text style={styles.time}>{relativeTime(item.createdAt)}</Text>
                </View>
                <Text style={styles.title} numberOfLines={expanded ? undefined : 2}>
                  {item.title}
                </Text>
                {!!item.body && (
                  <Text style={styles.body} numberOfLines={expanded ? undefined : 2}>
                    {item.body}
                  </Text>
                )}
                {details.length > 0 && (
                  <View style={styles.details}>
                    {details.map(([k, v]) => (
                      <View key={k} style={[styles.detail, { borderColor: `${m.color}33` }]}>
                        <Text style={styles.detailKey}>{k}</Text>
                        <Text style={styles.detailVal} numberOfLines={1}>
                          {v}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
                {expanded && (
                  <Text style={styles.stamp}>{new Date(item.createdAt).toLocaleString()}</Text>
                )}
              </View>
              <Animated.View
                style={{
                  marginTop: 2,
                  transform: [{ rotate: rot.interpolate({ inputRange: [0, 1], outputRange: ['90deg', '270deg'] }) }],
                }}
              >
                <Icon name="chevron" size={16} color={colors.inkFaint} strokeWidth={2.2} />
              </Animated.View>
            </View>
          </GlassCard>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = themed(() => StyleSheet.create({
  card: { padding: 14, paddingRight: 12 },
  row: { flexDirection: 'row', gap: 13, alignItems: 'flex-start' },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  kind: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.2, flexShrink: 1 },
  time: { fontFamily: fonts.medium, fontSize: 12, color: colors.inkFaint },
  // ~1.45x line heights: Hindi / Gujarati matras are clipped on Android below that
  title: { fontFamily: fonts.semibold, fontSize: 15.5, lineHeight: 23, color: colors.ink, marginTop: 3, letterSpacing: -0.2 },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.inkSoft, marginTop: 3 },
  details: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  detail: {
    flexDirection: 'row',
    maxWidth: '100%',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: colors.dark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.5)',
  },
  detailKey: { ...type.small, fontSize: 12, color: colors.inkFaint },
  detailVal: { ...type.small, fontSize: 12, color: colors.inkSoft, maxWidth: 160, flexShrink: 1 },
  stamp: { ...type.small, fontSize: 12, marginTop: 10, color: colors.inkFaint },
}));
