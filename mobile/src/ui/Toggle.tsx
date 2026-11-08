import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { tap } from './Buttons';
import { colors } from './theme';

export function Toggle({
  value,
  onChange,
  color = colors.sky,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  color?: string;
  label: string;
}) {
  const v = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(v, { toValue: value ? 1 : 0, useNativeDriver: false, speed: 22, bounciness: 7 }).start();
  }, [value, v]);
  const x = v.interpolate({ inputRange: [0, 1], outputRange: [3, 23] });
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        tap();
        onChange(!value);
      }}
    >
      <View style={styles.track}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: v }]}>
          <LinearGradient colors={[color, `${color}aa`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill} />
        </Animated.View>
        <Animated.View style={[styles.knob, { transform: [{ translateX: x }] }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 50,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: colors.glassBorder,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fill: { flex: 1, borderRadius: 15 },
  knob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
    ...(Platform.OS === 'web' ? {} : {}),
  },
});
