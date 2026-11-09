import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { parsePairPayload, type PairTarget } from '../lib/pairing';
import { GlassButton, IconButton, PrimaryButton } from '../ui/Buttons';
import { GlassCard } from '../ui/Glass';
import { Icon } from '../ui/Icons';
import { absFill, colors, fonts, type, themed } from '../ui/theme';

const FRAME = 248;
const native = Platform.OS !== 'web';

function Corners() {
  const c = { position: 'absolute' as const, width: 42, height: 42, borderColor: colors.sky };
  const w = 4;
  const r = 26;
  return (
    <>
      <View style={[c, { top: 0, left: 0, borderTopWidth: w, borderLeftWidth: w, borderTopLeftRadius: r }]} />
      <View style={[c, { top: 0, right: 0, borderTopWidth: w, borderRightWidth: w, borderTopRightRadius: r }]} />
      <View style={[c, { bottom: 0, left: 0, borderBottomWidth: w, borderLeftWidth: w, borderBottomLeftRadius: r }]} />
      <View style={[c, { bottom: 0, right: 0, borderBottomWidth: w, borderRightWidth: w, borderBottomRightRadius: r }]} />
    </>
  );
}

export function ScanScreen({
  onBack,
  onEnterCode,
  onPair,
  simulate,
}: {
  onBack: () => void;
  onEnterCode: () => void;
  onPair: (t: PairTarget) => Promise<void>;
  /** Web/mock: no camera, render a simulated viewfinder. */
  simulate: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const line = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(line, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
        Animated.timing(line, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [line]);

  useEffect(() => {
    if (!simulate && permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission, simulate]);

  async function handleScan(result: BarcodeScanningResult) {
    if (lock.current) return;
    const target = parsePairPayload(result.data);
    if (!target) {
      setError("That QR code isn't a Flo pairing code.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await onPair(target);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pairing failed.');
      setTimeout(() => (lock.current = false), 1500);
    } finally {
      setBusy(false);
    }
  }

  const granted = simulate || permission?.granted;
  const translateY = line.interpolate({ inputRange: [0, 1], outputRange: [14, FRAME - 16] });

  return (
    <View style={styles.root}>
      {granted && !simulate ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={busy ? undefined : handleScan}
        />
      ) : (
        <LinearGradient colors={['#0b1622', '#05070b', '#081420']} style={StyleSheet.absoluteFill} />
      )}

      {/* dimmed surround */}
      <View style={styles.dim} pointerEvents="none" />

      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <IconButton label="Back" onPress={onBack}>
          <Icon name="back" color={colors.ink} />
        </IconButton>
        <Text style={styles.headerTitle}>Scan to pair</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.center}>
        {granted ? (
          <>
            <View style={styles.frame}>
              <View style={styles.frameInner} />
              <Corners />
              <Animated.View style={[styles.scanLine, { transform: [{ translateY }] }]}>
                <LinearGradient
                  colors={['rgba(102,206,255,0)', colors.sky, 'rgba(102,206,255,0)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={{ flex: 1 }}
                />
              </Animated.View>
              {busy && (
                <View style={styles.busy}>
                  <ActivityIndicator color={colors.sky} size="large" />
                  <Text style={styles.busyText}>Pairing…</Text>
                </View>
              )}
            </View>
            <Text style={styles.caption}>Point your camera at the QR code on your computer</Text>
          </>
        ) : (
          <GlassCard style={styles.permCard}>
            <Icon name="qr" size={36} color={colors.sky} />
            <Text style={[type.title, { textAlign: 'center' }]}>Camera access</Text>
            <Text style={[type.body, { textAlign: 'center' }]}>
              Flo uses the camera only to read the pairing QR code. Nothing is recorded.
            </Text>
            <PrimaryButton label="Allow camera" onPress={() => void requestPermission()} style={{ alignSelf: 'stretch' }} />
          </GlassCard>
        )}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
        {!!error && (
          <View style={styles.error}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
        {simulate && (
          <PrimaryButton
            label="Simulate scan (demo)"
            onPress={() => void handleScan({ data: 'flo-pair://flo.app/483920' } as BarcodeScanningResult)}
          />
        )}
        <GlassButton
          label="Enter code instead"
          icon={<Icon name="keypad" size={18} color={colors.inkSoft} />}
          onPress={onEnterCode}
        />
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  dim: { ...absFill, backgroundColor: 'rgba(2,4,7,0.45)' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  headerTitle: { fontFamily: fonts.semibold, fontSize: 17, color: colors.ink },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  frame: { width: FRAME, height: FRAME },
  frameInner: {
    ...absFill,
    margin: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(102,206,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(102,206,255,0.18)',
  },
  scanLine: { position: 'absolute', left: 18, right: 18, height: 2, shadowColor: colors.sky, shadowOpacity: 1, shadowRadius: 10 },
  busy: {
    ...absFill,
    margin: 10,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: 'rgba(2,6,10,0.72)',
  },
  busyText: { fontFamily: fonts.semibold, color: colors.ink, fontSize: 15 },
  caption: { ...type.body, textAlign: 'center', marginTop: 28, color: colors.inkSoft, maxWidth: 260 },
  permCard: { padding: 24, alignItems: 'center', gap: 14, alignSelf: 'stretch' },
  footer: { paddingHorizontal: 24, gap: 12 },
  error: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,107,107,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.28)',
  },
  errorText: { ...type.small, color: colors.errorText, textAlign: 'center' },
}));
