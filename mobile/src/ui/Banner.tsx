// In-app banner for pushes that arrive while the app is open.
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { kindLabel, metaForKind } from '../lib/kinds';
import { GlassCard } from './Glass';
import { KindIcon } from './KindIcon';
import { colors, fonts, type, themed } from './theme';

const native = Platform.OS !== 'web';

export function InAppBanner({
  banner,
  onDismiss,
}: {
  banner: { key: string; kind: string; title: string; body: string } | null;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const y = useRef(new Animated.Value(-160)).current;

  useEffect(() => {
    if (!banner) return;
    y.setValue(-160);
    Animated.spring(y, { toValue: 0, useNativeDriver: native, speed: 14, bounciness: 8 }).start();
    const t = setTimeout(hide, 5000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banner?.key]);

  function hide() {
    Animated.timing(y, { toValue: -180, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: native }).start(
      () => onDismiss(),
    );
  }

  if (!banner) return null;
  const m = metaForKind(banner.kind);
  return (
    <Animated.View style={[styles.wrap, { top: insets.top + 8, transform: [{ translateY: y }] }]} pointerEvents="box-none">
      <Pressable onPress={hide} accessibilityRole="alert" style={styles.backing}>
        <GlassCard strong tint={m.color} radius={24} style={styles.card}>
          <View style={[styles.accent, { backgroundColor: m.color }]} />
          <KindIcon kind={banner.kind} size={38} />
          <View style={{ flex: 1 }}>
            <Text style={[type.micro, { color: m.color }]}>{kindLabel(banner.kind)} · now</Text>
            <Text style={styles.title} numberOfLines={1}>
              {banner.title}
            </Text>
            {!!banner.body && (
              <Text style={styles.body} numberOfLines={2}>
                {banner.body}
              </Text>
            )}
          </View>
        </GlassCard>
      </Pressable>
    </Animated.View>
  );
}

const styles = themed(() => StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 50 },
  backing: { borderRadius: 24, backgroundColor: colors.bgElevated },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: colors.dark ? 'rgba(16, 24, 34, 0.94)' : 'rgba(255, 255, 255, 0.96)',
    shadowColor: colors.dark ? '#000' : '#2b2370',
    shadowOpacity: colors.dark ? 0.5 : 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 16,
  },
  accent: { position: 'absolute', left: 0, top: 18, bottom: 18, width: 3, borderRadius: 2 },
  title: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink, marginTop: 2 },
  body: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: colors.inkSoft, marginTop: 1 },
}));
