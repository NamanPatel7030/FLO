import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, BackHandler, Easing, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { mockStartScreen } from './src/api/mock';
import { parsePairPayload, type PairTarget } from './src/lib/pairing';
import { EnterCodeScreen } from './src/screens/EnterCodeScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { ScanScreen } from './src/screens/ScanScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { FloProvider, useFlo } from './src/state/FloContext';
import { Backdrop } from './src/ui/Backdrop';
import { InAppBanner } from './src/ui/Banner';
import { Icon } from './src/ui/Icons';
import { colors, fonts } from './src/ui/theme';

type Route = 'welcome' | 'scan' | 'code' | 'home' | 'settings';
const native = Platform.OS !== 'web';

/** Fades + slides the new screen in whenever the route changes. */
function Transition({ routeKey, children }: { routeKey: string; children: React.ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, [routeKey, v]);
  return (
    <Animated.View
      style={{
        flex: 1,
        opacity: v,
        transform: [
          { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
          { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

function Toast({ text }: { text: string | null }) {
  const insets = useSafeAreaInsets();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(v, { toValue: text ? 1 : 0, useNativeDriver: native, speed: 14, bounciness: 6 }).start();
  }, [text, v]);
  if (!text) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.toast,
        {
          bottom: insets.bottom + 24,
          opacity: v,
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) }],
        },
      ]}
    >
      <Icon name="check" size={18} color={colors.green} strokeWidth={2.4} />
      <Text style={styles.toastText}>{text}</Text>
    </Animated.View>
  );
}

function Root() {
  const flo = useFlo();
  const [route, setRoute] = useState<Route>('welcome');
  const [prefill, setPrefill] = useState<Partial<PairTarget>>({});

  // Initial route (and mock deep-links for screenshots).
  useEffect(() => {
    if (flo.booting) return;
    if (flo.session) {
      setRoute((r) => (r === 'settings' ? r : flo.mock && mockStartScreen() === 'settings' ? 'settings' : 'home'));
    } else {
      const s = flo.mock ? mockStartScreen() : null;
      setRoute(s === 'scan' || s === 'code' ? s : 'welcome');
    }
  }, [flo.booting, flo.session, flo.mock]);

  // Opening a flo-pair:// link (e.g. scanned with the system camera) prefills pairing.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const handle = (url: string | null | undefined) => {
      const t = url ? parsePairPayload(url) : null;
      if (t && !flo.session) {
        setPrefill(t);
        setRoute('code');
      }
    };
    void Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    return () => sub.remove();
  }, [flo.session]);

  // Android back button.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route === 'settings') return setRoute('home'), true;
      if (route === 'scan' || route === 'code') return setRoute('welcome'), true;
      return false;
    });
    return () => sub.remove();
  }, [route]);

  const pair = async (t: PairTarget) => {
    await flo.pair(t);
    setRoute('home');
  };

  if (flo.booting) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.sky} />
      </View>
    );
  }

  let screen: React.ReactNode;
  switch (route) {
    case 'scan':
      screen = (
        <ScanScreen simulate={!native} onBack={() => setRoute('welcome')} onEnterCode={() => setRoute('code')} onPair={pair} />
      );
      break;
    case 'code':
      screen = (
        <EnterCodeScreen
          onBack={() => setRoute('welcome')}
          onPair={pair}
          initialServer={prefill.server ?? (flo.mock ? 'flo.app' : '')}
          initialCode={prefill.code ?? (flo.mock ? '483920' : '')}
        />
      );
      break;
    case 'home':
      screen = <HomeScreen onSettings={() => setRoute('settings')} />;
      break;
    case 'settings':
      screen = <SettingsScreen onBack={() => setRoute('home')} />;
      break;
    default:
      screen = (
        <WelcomeScreen error={flo.error} onScan={() => setRoute('scan')} onEnterCode={() => setRoute('code')} />
      );
  }

  return (
    <Backdrop intensity={route === 'home' || route === 'settings' ? 0.8 : 1}>
      <Transition routeKey={route}>{screen}</Transition>
      <InAppBanner banner={flo.banner} onDismiss={flo.dismissBanner} />
      <Toast text={flo.pairedNotice} />
    </Backdrop>
  );
}

export default function App() {
  const [loaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  return (
    <SafeAreaProvider style={{ backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      {loaded || fontError ? (
        <FloProvider>
          <View style={styles.app}>
            <Root />
          </View>
        </FloProvider>
      ) : (
        <View style={styles.center} />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(16,24,34,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.3)',
  },
  toastText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
});
