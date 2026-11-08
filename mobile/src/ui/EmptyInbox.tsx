// Empty-state illustration: a glass tray under a glowing notch, with drifting sparkles.
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { colors, type } from './theme';

const native = Platform.OS !== 'web';

export function EmptyInbox({ away }: { away: boolean }) {
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
        Animated.timing(float, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [float]);
  const y = float.interpolate({ inputRange: [0, 1], outputRange: [0, -6] });

  return (
    <View style={styles.wrap}>
      <Animated.View style={{ transform: [{ translateY: y }] }}>
        <Svg width={220} height={150} viewBox="0 0 220 150">
          <Defs>
            <RadialGradient id="eg" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={colors.sky} stopOpacity={0.35} />
              <Stop offset="1" stopColor={colors.sky} stopOpacity={0} />
            </RadialGradient>
            <LinearGradient id="tray" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#ffffff" stopOpacity={0.13} />
              <Stop offset="1" stopColor="#ffffff" stopOpacity={0.03} />
            </LinearGradient>
            <LinearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#bfeaff" />
              <Stop offset="1" stopColor={colors.ocean} />
            </LinearGradient>
          </Defs>
          <Ellipse cx="110" cy="70" rx="105" ry="62" fill="url(#eg)" />
          {/* back card */}
          <Rect x="52" y="44" width="116" height="62" rx="16" fill="url(#tray)" stroke="rgba(255,255,255,0.12)" />
          {/* front card */}
          <Rect x="38" y="62" width="144" height="70" rx="20" fill="url(#tray)" stroke="rgba(255,255,255,0.16)" />
          <Rect x="56" y="84" width="58" height="7" rx="3.5" fill="rgba(255,255,255,0.22)" />
          <Rect x="56" y="99" width="92" height="6" rx="3" fill="rgba(255,255,255,0.1)" />
          <Rect x="56" y="111" width="70" height="6" rx="3" fill="rgba(255,255,255,0.07)" />
          <Circle cx="160" cy="88" r="9" fill="rgba(74,222,128,0.18)" stroke="#4ade80" strokeWidth="1.5" />
          <Path d="M155.8 88.3l2.8 2.7 5.4-5.6" stroke="#4ade80" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          {/* notch */}
          <Rect x="74" y="14" width="72" height="20" rx="10" fill="#020407" stroke="url(#rim)" strokeWidth="1.5" />
          <Path d="M86 26c2-5 4.5-5 6.5-2.5s4.5 2.5 6.5-2.5" stroke={colors.sky} strokeWidth="2.2" strokeLinecap="round" fill="none" />
          <Circle cx="132" cy="24" r="2.2" fill={colors.sky} />
          {/* sparkles */}
          <Path d="M28 40l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" fill="#a78bfa" opacity={0.8} />
          <Path d="M192 30l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z" fill="#f5b544" opacity={0.85} />
          <Circle cx="196" cy="120" r="2.5" fill="#d97757" opacity={0.8} />
          <Circle cx="22" cy="112" r="2" fill="#2dd4bf" opacity={0.8} />
        </Svg>
      </Animated.View>
      <Text style={[type.title, styles.title]}>You're all caught up</Text>
      <Text style={[type.body, styles.text]}>
        {away
          ? 'Nothing new from your Mac yet. Claude results, to-dos, reminders and summaries will land here.'
          : "When you're Away, Claude results, to-dos, reminders and meeting summaries from your Mac land here."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 20 },
  title: { marginTop: 14, textAlign: 'center' },
  text: { textAlign: 'center', marginTop: 8, maxWidth: 300, color: colors.inkMuted },
});
