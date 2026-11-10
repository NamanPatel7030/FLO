import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, fonts, radius, themed } from './theme';
import { hapticsOn, spring } from './motion';

/** A light haptic tap, unless this phone's Haptics switch is off. */
export function tap(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) {
  if (Platform.OS !== 'web' && hapticsOn()) void Haptics.impactAsync(style).catch(() => undefined);
}

function usePressScale() {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) =>
    spring(scale, { toValue: v, useNativeDriver: Platform.OS !== 'web', speed: 40, bounciness: 6 }).start();
  return { scale, onPressIn: () => to(0.97), onPressOut: () => to(1) };
}

interface BtnProps {
  label: string;
  onPress?: () => void;
  icon?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function PrimaryButton({ label, onPress, icon, loading, disabled, style, testID }: BtnProps) {
  const { scale, onPressIn, onPressOut } = usePressScale();
  const off = disabled || loading;
  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={off}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onPress={() => {
          tap(Haptics.ImpactFeedbackStyle.Medium);
          onPress?.();
        }}
        style={[styles.primaryShadow, off && { opacity: 0.55 }]}
      >
        <LinearGradient
          colors={colors.dark ? ['#8fdcff', colors.sky, colors.ocean] : ['#2a3550', colors.primary, '#05080f']}
          locations={[0, 0.45, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.primary}
        >
          <LinearGradient
            pointerEvents="none"
            colors={[colors.dark ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.18)', 'rgba(255,255,255,0)']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 0.6 }}
            style={[StyleSheet.absoluteFill, { borderRadius: radius.md }]}
          />
          {loading ? (
            <ActivityIndicator color={colors.dark ? "#03263d" : "#ffffff"} />
          ) : (
            <View style={styles.row}>
              {icon}
              <Text style={styles.primaryLabel} numberOfLines={2}>
                {label}
              </Text>
            </View>
          )}
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

export function GlassButton({
  label,
  onPress,
  icon,
  disabled,
  style,
  danger,
  compact,
  testID,
}: BtnProps & { danger?: boolean; compact?: boolean }) {
  const { scale, onPressIn, onPressOut } = usePressScale();
  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onPress={() => {
          tap();
          onPress?.();
        }}
        style={({ pressed }) => [
          styles.glass,
          compact && styles.compact,
          danger && styles.danger,
          pressed && { backgroundColor: colors.glassStrong },
          disabled && { opacity: 0.5 },
        ]}
      >
        <View style={styles.row}>
          {icon}
          <Text style={[styles.glassLabel, compact && { fontSize: 14 }, danger && { color: colors.danger }]} numberOfLines={2}>
            {label}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export function IconButton({
  onPress,
  children,
  label,
  testID,
}: {
  onPress: () => void;
  children: React.ReactNode;
  label: string;
  testID?: string;
}) {
  const { scale, onPressIn, onPressOut } = usePressScale();
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={10}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onPress={() => {
          tap();
          onPress();
        }}
        style={styles.icon}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

const styles = themed(() => StyleSheet.create({
  // the label shrinks and wraps (2 lines max) inside a button that grows, instead of spilling out of it
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, maxWidth: '100%' },
  primaryShadow: {
    borderRadius: radius.md,
    shadowColor: colors.dark ? colors.sky : '#2b2370',
    shadowOpacity: colors.dark ? 0.45 : 0.28,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  primary: {
    minHeight: 58,
    paddingVertical: 10,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    overflow: 'hidden',
  },
  primaryLabel: { fontFamily: fonts.semibold, fontSize: 16.5, lineHeight: 22, color: colors.dark ? '#03263d' : '#ffffff', letterSpacing: -0.2, flexShrink: 1, textAlign: 'center' },
  glass: {
    minHeight: 56,
    paddingVertical: 8,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  compact: { minHeight: 40, paddingVertical: 6, borderRadius: radius.sm, paddingHorizontal: 14 },
  danger: { borderColor: colors.errorBorder, backgroundColor: colors.errorBg },
  glassLabel: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21, color: colors.ink, letterSpacing: -0.2, flexShrink: 1, textAlign: 'center' },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
}));
