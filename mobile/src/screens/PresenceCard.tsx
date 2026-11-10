import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import type { Presence, PresenceStatus } from '../api/types';
import { sinceLabel } from '../lib/time';
import { tap } from '../ui/Buttons';
import { Icon } from '../ui/Icons';
import { Notchling } from '../ui/Notchling';
import { usePrefs } from '../state/Prefs';
import { colors, fonts, radius, type, themed } from '../ui/theme';
import { forever, spring, timing } from '../ui/motion';

const native = Platform.OS !== 'web';

function Segmented({
  value,
  onChange,
  disabled,
}: {
  value: PresenceStatus;
  onChange: (s: PresenceStatus) => void;
  disabled?: boolean;
}) {
  const [w, setW] = useState(0);
  const x = useRef(new Animated.Value(value === 'away' ? 1 : 0)).current;
  useEffect(() => {
    spring(x, { toValue: value === 'away' ? 1 : 0, useNativeDriver: native, speed: 16, bounciness: 6 }).start();
  }, [value, x]);
  const half = Math.max(0, (w - 8) / 2);
  const tx = x.interpolate({ inputRange: [0, 1], outputRange: [0, half] });
  const opts: { s: PresenceStatus; label: string; icon: 'laptop' | 'moon' }[] = [
    { s: 'active', label: "I'm back", icon: 'laptop' },
    { s: 'away', label: "I'm away", icon: 'moon' },
  ];
  return (
    <View style={styles.seg} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <Animated.View style={[styles.segThumb, { width: half, transform: [{ translateX: tx }] }]}>
          <LinearGradient
            colors={colors.dark ? (value === 'away' ? ['#8fdcff', colors.sky, colors.ocean] : ['#ffffff', '#dfe9f2']) : ['#2a3550', colors.primary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.segThumbFill}
          />
        </Animated.View>
      )}
      {opts.map((o) => {
        const on = value === o.s;
        return (
          <Pressable
            key={o.s}
            testID={`presence-${o.s}`}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled }}
            disabled={disabled || on}
            onPress={() => {
              tap();
              onChange(o.s);
            }}
            style={styles.segBtn}
          >
            <Icon name={o.icon} size={17} color={on ? (colors.dark ? '#03263d' : '#ffffff') : colors.inkSoft} strokeWidth={2} />
            <Text style={[styles.segText, on && { color: colors.dark ? '#03263d' : '#ffffff' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function PresenceCard({
  presence,
  busy,
  onChange,
}: {
  presence: Presence | null;
  busy: boolean;
  onChange: (s: PresenceStatus) => void;
}) {
  const away = presence?.status === 'away';
  const { prefs } = usePrefs();
  const onAway = colors.dark ? colors.ice : colors.ink;
  const onAwaySoft = colors.dark ? 'rgba(227,246,255,0.8)' : colors.inkSoft;
  const fade = useRef(new Animated.Value(away ? 1 : 0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const [, force] = useState(0);

  useEffect(() => {
    timing(fade, { toValue: away ? 1 : 0, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, [away, fade]);

  useEffect(() => {
    const loop = forever(() =>
      Animated.sequence([
        timing(pulse, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: native }),
        timing(pulse, { toValue: 0, duration: 0, useNativeDriver: native }),
      ]),
    );
    loop.start();
    const t = setInterval(() => force((n) => n + 1), 30_000); // keep "for 12m" fresh
    return () => {
      loop.stop();
      clearInterval(t);
    };
  }, [pulse]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });
  const accent = away ? colors.sky : colors.green;

  return (
    <View style={styles.card}>
      {/* Active background */}
      <View style={[StyleSheet.absoluteFill, styles.activeBg]} />
      {/* Away background crossfades in */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
        <LinearGradient
          colors={colors.dark ? ['#11679c', '#0b3b5e', '#06172a'] : ['#cfe6ff', '#ddd2ff', '#ffd9e6']}
          locations={[0, 0.5, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Svg style={StyleSheet.absoluteFill} viewBox="0 0 360 300" preserveAspectRatio="none">
          <Defs>
            <RadialGradient id="pg" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={colors.sky} stopOpacity={0.55} />
              <Stop offset="1" stopColor={colors.sky} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx="320" cy="20" rx="170" ry="130" fill="url(#pg)" />
        </Svg>
      </Animated.View>
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.35)', 'rgba(255,255,255,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.specular}
      />

      <View style={styles.top}>
        <View style={styles.statusRow}>
          <View style={styles.dotWrap}>
            <Animated.View
              style={[styles.dotRing, { backgroundColor: accent, opacity: ringOpacity, transform: [{ scale: ringScale }] }]}
            />
            <View style={[styles.dot, { backgroundColor: accent }]} />
          </View>
          <Text style={[type.micro, { color: away ? onAway : colors.inkMuted }]}>
            {presence ? (away ? 'Away from your computer' : 'At your computer') : 'Checking…'}
          </Text>
        </View>
        {busy ? (
          <ActivityIndicator size="small" color={onAway} />
        ) : (
          <Notchling mood={away ? 'sleepy' : 'happy'} size={58} plate={false} avatar={prefs.avatar} accent={colors.sky} testID="presence-mascot" />
        )}
      </View>

      <Text style={styles.big} testID="presence-status">
        {presence ? (away ? 'Away' : 'Active') : '—'}
      </Text>
      <Text style={[styles.since, away && { color: onAwaySoft }]}>
        {presence ? sinceLabel(presence.since) : ' '}
      </Text>

      <Text style={[type.body, styles.explain, away && { color: onAwaySoft }]}>
        {away
          ? "While you're Away, Flo sends your computer's updates here."
          : "You're at your computer, so updates stay there. Switch to Away when you step out. Your computer does it by itself when you go idle."}
      </Text>

      <Segmented value={presence?.status ?? 'active'} onChange={onChange} disabled={!presence || busy} />
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    padding: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  activeBg: { backgroundColor: colors.glass },
  specular: { position: 'absolute', top: 0, left: 28, right: 28, height: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dotWrap: { width: 10, height: 10, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotRing: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },
  badge: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  big: { fontFamily: fonts.bold, fontSize: 52, lineHeight: 58, letterSpacing: -2, color: colors.ink, marginTop: 6 },
  since: { ...type.small, marginTop: 0 },
  explain: { marginTop: 14, marginBottom: 20 },
  seg: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 18,
    backgroundColor: colors.dark ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: colors.dark ? 'rgba(255,255,255,0.08)' : 'rgba(20,30,60,0.06)',
  },
  segThumb: { position: 'absolute', top: 4, left: 4, bottom: 4, borderRadius: 14, overflow: 'hidden' },
  segThumbFill: { flex: 1 },
  segBtn: { flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  segText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.inkSoft },
}));
