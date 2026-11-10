// Floating glass tab bar: Home, To-dos, Ask Flo (the raised mic in the middle), Needs you, Settings.
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tap } from './Buttons';
import { Icon, type IconName } from './Icons';
import { colors, fonts, themed } from './theme';
import { spring } from './motion';

export type Tab = 'home' | 'todos' | 'needs' | 'settings';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'todos', label: 'To-dos', icon: 'todos' },
  { id: 'needs', label: 'Needs you', icon: 'hand' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
];

/** Space screens leave at the bottom so their last row clears the bar. */
export const TAB_BAR_SPACE = 104;

function TabButton({ tab, active, badge, onPress }: { tab: (typeof TABS)[number]; active: boolean; badge?: number; onPress: () => void }) {
  const v = useRef(new Animated.Value(active ? 1 : 0)).current;
  useEffect(() => {
    spring(v, { toValue: active ? 1 : 0, useNativeDriver: Platform.OS !== 'web', speed: 20, bounciness: 8 }).start();
  }, [active, v]);
  const color = active ? colors.sky : colors.inkMuted;
  return (
    <Pressable
      testID={`tab-${tab.id}`}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={badge ? `${tab.label}, ${badge} waiting` : tab.label}
      onPress={() => {
        tap();
        onPress();
      }}
      style={styles.tab}
    >
      <Animated.View style={{ alignItems: 'center', transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -1.5] }) }] }}>
        <View>
          <Icon name={tab.icon} size={22} color={color} strokeWidth={active ? 2.1 : 1.8} />
          {!!badge && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
            </View>
          )}
        </View>
        <Text style={[styles.label, { color, fontFamily: active ? fonts.semibold : fonts.medium }]} numberOfLines={1}>
          {tab.label}
        </Text>
        <Animated.View style={[styles.dot, { opacity: v, backgroundColor: colors.sky }]} />
      </Animated.View>
    </Pressable>
  );
}

export function TabBar({ tab, onTab, onAsk, badges }: { tab: Tab; onTab: (t: Tab) => void; onAsk: () => void; badges?: Partial<Record<Tab, number>> }) {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.bar}>
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(255,255,255,0)', colors.glassHighlight, 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.specular}
        />
        {TABS.slice(0, 2).map((t) => (
          <TabButton key={t.id} tab={t} active={tab === t.id} badge={badges?.[t.id]} onPress={() => onTab(t.id)} />
        ))}
        <View style={styles.askSlot} />
        {TABS.slice(2).map((t) => (
          <TabButton key={t.id} tab={t} active={tab === t.id} badge={badges?.[t.id]} onPress={() => onTab(t.id)} />
        ))}
      </View>
      <Pressable
        testID="tab-ask"
        accessibilityRole="button"
        accessibilityLabel="Ask Flo"
        onPress={() => {
          tap();
          onAsk();
        }}
        style={[styles.ask, { bottom: Math.max(insets.bottom, 10) + 22 }]}
      >
        <LinearGradient
          colors={colors.dark ? ['#8fdcff', colors.sky, colors.ocean] : ['#2a3550', colors.primary, '#05080f']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.askInner}
        >
          <Icon name="mic" size={25} color={colors.onPrimary} strokeWidth={2} />
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, alignItems: 'center' },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      width: '100%',
      maxWidth: 520,
      height: 66,
      borderRadius: 26,
      paddingHorizontal: 6,
      backgroundColor: colors.dark ? 'rgba(14,20,30,0.86)' : 'rgba(255,255,255,0.88)',
      borderWidth: StyleSheet.hairlineWidth * 2,
      borderColor: colors.glassBorder,
      shadowColor: '#2b2370',
      shadowOpacity: colors.dark ? 0.4 : 0.14,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 10 },
      elevation: 12,
      overflow: 'hidden',
      ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(18px)' } as object) : {}),
    },
    specular: { position: 'absolute', top: 0, left: 26, right: 26, height: 1 },
    tab: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center' },
    label: { fontSize: 10.5, marginTop: 3, letterSpacing: 0.1 },
    dot: { width: 4, height: 4, borderRadius: 2, marginTop: 3 },
    askSlot: { width: 72 },
    ask: {
      position: 'absolute',
      alignSelf: 'center',
      width: 62,
      height: 62,
      borderRadius: 31,
      shadowColor: colors.dark ? colors.sky : '#2b2370',
      shadowOpacity: colors.dark ? 0.45 : 0.3,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 14,
    },
    askInner: {
      flex: 1,
      borderRadius: 31,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 3,
      borderColor: colors.dark ? 'rgba(5,7,11,0.9)' : 'rgba(244,245,251,0.95)',
    },
    badge: {
      position: 'absolute',
      top: -5,
      right: -10,
      minWidth: 18,
      height: 18,
      paddingHorizontal: 4,
      borderRadius: 9,
      backgroundColor: colors.danger,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.dark ? '#0e141e' : '#ffffff',
    },
    badgeText: { fontFamily: fonts.bold, fontSize: 10, color: '#fff' },
  }),
);
