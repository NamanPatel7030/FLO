// Hero: a MacBook-notch-shaped glowing pill with Flo's wave and live bars.
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { FloMark } from './Icons';
import { colors, fonts } from './theme';

const native = Platform.OS !== 'web';

function Bar({ delay, color }: { delay: number; color: string }) {
  const v = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
        Animated.timing(v, { toValue: 0.3, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, delay]);
  return <Animated.View style={[styles.bar, { backgroundColor: color, transform: [{ scaleY: v }] }]} />;
}

export function NotchPill({ label = 'Listening for your Mac', width = 268 }: { label?: string; width?: number }) {
  const glow = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
        Animated.timing(glow, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
      ]),
    );
    const b = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
        Animated.timing(float, { toValue: 0, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
      ]),
    );
    a.start();
    b.start();
    return () => {
      a.stop();
      b.stop();
    };
  }, [glow, float]);

  const haloOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  const haloScale = glow.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.06] });
  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });

  return (
    <View style={[styles.wrap, { width: width + 140 }]}>
      <Animated.View
        pointerEvents="none"
        style={[styles.halo, { width: width + 140, opacity: haloOpacity, transform: [{ scale: haloScale }] }]}
      >
        <Svg width="100%" height="100%" viewBox="0 0 400 200">
          <Defs>
            <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={colors.sky} stopOpacity={0.55} />
              <Stop offset="0.45" stopColor={colors.ocean} stopOpacity={0.22} />
              <Stop offset="1" stopColor={colors.ocean} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx="200" cy="100" rx="200" ry="100" fill="url(#halo)" />
        </Svg>
      </Animated.View>

      <Animated.View style={{ transform: [{ translateY }] }}>
        <LinearGradient
          colors={['#bfeaff', colors.sky, colors.ocean, '#0b4f7a']}
          locations={[0, 0.3, 0.7, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.rim, { width }]}
        >
          <View style={styles.pill}>
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(102,206,255,0.16)', 'rgba(102,206,255,0)']}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <FloMark size={34} />
            <Text style={styles.label} numberOfLines={1}>
              {label}
            </Text>
            <View style={styles.bars}>
              {[0, 140, 280, 90, 200].map((d, i) => (
                <Bar key={i} delay={d} color={i % 2 ? colors.ocean : colors.sky} />
              ))}
            </View>
          </View>
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 170, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', height: 170 },
  rim: {
    height: 62,
    borderRadius: 31,
    padding: 1.5,
    shadowColor: colors.sky,
    shadowOpacity: 0.7,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
    elevation: 18,
  },
  pill: {
    flex: 1,
    borderRadius: 30,
    backgroundColor: '#020407',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    gap: 12,
    overflow: 'hidden',
  },
  label: { flex: 1, fontFamily: fonts.medium, fontSize: 13.5, color: colors.ice, letterSpacing: -0.1 },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 22 },
  bar: { width: 3, height: 20, borderRadius: 2 },
});
