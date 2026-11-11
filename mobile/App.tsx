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
import { mockStartScreen, mockStartTab } from './src/api/mock';
import { parsePairPayload, type PairTarget } from './src/lib/pairing';
import { appLink } from './src/lib/bubble';
import { BubbleSettingsScreen } from './src/screens/BubbleSettingsScreen';
import { OfflineSpeechScreen } from './src/screens/OfflineSpeechScreen';
import { BubbleSettingsProvider } from './src/state/BubbleSettings';
import { OfflineProvider } from './src/state/Offline';
import { EnterCodeScreen } from './src/screens/EnterCodeScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { ScanScreen } from './src/screens/ScanScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { CustomizeScreen } from './src/screens/CustomizeScreen';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { VoiceScreen } from './src/screens/VoiceScreen';
import { TodosScreen } from './src/screens/TodosScreen';
import { NeedsYouScreen } from './src/screens/NeedsYouScreen';
import { ComputerSettingsScreen } from './src/screens/ComputerSettingsScreen';
import { ComputerProvider, useComputer } from './src/state/Computer';
import { TabBar, type Tab } from './src/ui/TabBar';
import { PrefsProvider, usePrefs } from './src/state/Prefs';
import { UpdatesProvider } from './src/state/Updates';
import { hideQuickActions, onQuickAction, showQuickActions } from './src/notifications/push';
import type { AskMode } from './src/api/types';
import { FloProvider, useFlo } from './src/state/FloContext';
import { Backdrop } from './src/ui/Backdrop';
import { InAppBanner } from './src/ui/Banner';
import { Icon } from './src/ui/Icons';
import { colors, fonts, themed } from './src/ui/theme';
import { spring, timing } from './src/ui/motion';

type Route = 'welcome' | 'scan' | 'code' | Tab | 'computer' | 'customize' | 'voice' | 'bubble' | 'speech';
const TABS: readonly Route[] = ['home', 'todos', 'needs', 'settings'];
const isTab = (r: Route): r is Tab => TABS.includes(r);
const native = Platform.OS !== 'web';

/** Fades + slides the new screen in whenever the route changes. */
function Transition({ routeKey, children }: { routeKey: string; children: React.ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    timing(v, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
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

function Toast({ text, raised }: { text: string | null; raised?: boolean }) {
  const insets = useSafeAreaInsets();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    spring(v, { toValue: text ? 1 : 0, useNativeDriver: native, speed: 14, bounciness: 6 }).start();
  }, [text, v]);
  if (!text) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.toast,
        {
          bottom: insets.bottom + (raised ? 104 : 24),
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
  const computer = useComputer();
  const { prefs, themeKey } = usePrefs();
  const [route, setRouteState] = useState<Route>('welcome');
  // the tab Voice / sub-screens go back to
  const lastTab = useRef<Tab>('home');
  const setRoute = (r: Route | ((cur: Route) => Route)) =>
    setRouteState((cur) => {
      const next = typeof r === 'function' ? r(cur) : r;
      if (isTab(next)) lastTab.current = next;
      return next;
    });
  const [prefill, setPrefill] = useState<Partial<PairTarget>>({});
  const [voice, setVoice] = useState<{ mode: AskMode; auto: boolean }>({ mode: 'ask', auto: false });
  const openVoice = (mode: AskMode, auto = false) => {
    setVoice({ mode, auto });
    setRoute('voice');
  };

  // The Ask / Dictate shortcut in the notification shade.
  useEffect(() => {
    if (flo.mock || Platform.OS !== 'android') return;
    if (flo.session && prefs.quickActions && flo.permission.state === 'granted') void showQuickActions().catch(() => undefined);
    else void hideQuickActions();
  }, [flo.session, flo.mock, prefs.quickActions, flo.permission.state]);
  useEffect(() => onQuickAction((a) => openVoice(a === 'dictate' ? 'todo' : 'ask', true)), []);

  // Initial route (and mock deep-links for screenshots).
  useEffect(() => {
    if (flo.booting) return;
    if (flo.session) {
      const m = flo.mock ? mockStartScreen() : null;
      const t = flo.mock ? mockStartTab() : null;
      setRoute((r) =>
        r !== 'welcome' && r !== 'scan' && r !== 'code'
          ? r
          : t === 'todos' || t === 'needs' || t === 'settings' || t === 'computer'
            ? t
            : m === 'settings' || m === 'customize' || m === 'voice' || m === 'bubble' || m === 'speech'
              ? m
              : 'home',
      );
    } else {
      const s = flo.mock ? mockStartScreen() : null;
      setRoute(s === 'scan' || s === 'code' || s === 'customize' || s === 'voice' || s === 'bubble' || s === 'speech' ? s : 'welcome');
    }
  }, [flo.booting, flo.session, flo.mock]);

  // Opening a flo-pair:// link (e.g. scanned with the system camera) prefills pairing.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const handle = (url: string | null | undefined) => {
      // the bubble's own notifications: flo-pair://bubble (answers) and flo-pair://speech (offline packs)
      const inApp = url ? appLink(url) : null;
      if (inApp) {
        setRoute(inApp);
        return;
      }
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
      if (route === 'speech') return setRoute('bubble'), true;
      if (route === 'customize' || route === 'computer' || route === 'bubble') return setRoute(flo.session ? 'settings' : 'welcome'), true;
      if (route === 'voice') return setRoute(flo.session ? lastTab.current : 'welcome'), true;
      if (route === 'settings' || route === 'todos' || route === 'needs') return setRoute(flo.session ? 'home' : 'welcome'), true;
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
          initialServer={prefill.server ?? ''}
          initialCode={prefill.code ?? (flo.mock ? '483920' : '')}
        />
      );
      break;
    case 'home':
      screen = (
        <HomeScreen
          onSettings={() => setRoute('settings')}
          onVoice={(m) => openVoice(m)}
          onNeedsYou={() => setRoute('needs')}
          onTodos={() => setRoute('todos')}
        />
      );
      break;
    case 'todos':
      screen = <TodosScreen onAdd={() => openVoice('todo')} />;
      break;
    case 'needs':
      screen = <NeedsYouScreen />;
      break;
    case 'settings':
      screen = <SettingsScreen onCustomize={() => setRoute('customize')} onComputer={() => setRoute('computer')} onBubble={() => setRoute('bubble')} />;
      break;
    case 'bubble':
      screen = <BubbleSettingsScreen onBack={() => setRoute(flo.session ? 'settings' : 'welcome')} onSpeech={() => setRoute('speech')} />;
      break;
    case 'speech':
      screen = <OfflineSpeechScreen onBack={() => setRoute('bubble')} />;
      break;
    case 'computer':
      screen = <ComputerSettingsScreen onBack={() => setRoute('settings')} />;
      break;
    case 'customize':
      screen = <CustomizeScreen onBack={() => setRoute(flo.session ? 'settings' : 'welcome')} />;
      break;
    case 'voice':
      screen = <VoiceScreen initialMode={voice.mode} autoStart={voice.auto} onClose={() => setRoute(flo.session ? lastTab.current : 'welcome')} />;
      break;
    default:
      screen = <OnboardingScreen error={flo.error} onScan={() => setRoute('scan')} onEnterCode={() => setRoute('code')} />;
  }

  return (
    <Backdrop intensity={isTab(route) || route === 'computer' ? 0.8 : 1}>
      <Transition key={themeKey} routeKey={route}>
        {screen}
      </Transition>
      {flo.session && isTab(route) && (
        <TabBar tab={route} onTab={setRoute} onAsk={() => openVoice('ask')} badges={{ needs: computer.needsYouCount }} />
      )}
      <InAppBanner banner={flo.banner} onDismiss={flo.dismissBanner} />
      <Toast text={flo.pairedNotice} raised={!!flo.session && isTab(route)} />
    </Backdrop>
  );
}

export default function App() {
  const [loaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    InstrumentSerif_400Regular_Italic: require('./assets/fonts/InstrumentSerif-Italic.ttf'),
  });
  return (
    <SafeAreaProvider>
      {loaded || fontError ? (
        <PrefsProvider>
          <Themed />
        </PrefsProvider>
      ) : (
        <View style={styles.center} />
      )}
    </SafeAreaProvider>
  );
}

function Themed() {
  const { dark } = usePrefs();
  return (
    <UpdatesProvider disabled={Platform.OS === 'web'}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <FloProvider>
        <OfflineProvider>
          <BubbleSettingsProvider>
            <ComputerProvider>
              <View style={[styles.app, { backgroundColor: colors.bg }]}>
                <Root />
              </View>
            </ComputerProvider>
          </BubbleSettingsProvider>
        </OfflineProvider>
      </FloProvider>
    </UpdatesProvider>
  );
}

const styles = themed(() => StyleSheet.create({
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
    backgroundColor: colors.dark ? 'rgba(16,24,34,0.95)' : 'rgba(255,255,255,0.97)',
    borderWidth: 1,
    borderColor: colors.dark ? 'rgba(74,222,128,0.3)' : 'rgba(31,157,107,0.3)',
    shadowColor: '#2b2370',
    shadowOpacity: 0.15,
    shadowRadius: 18,
    elevation: 8,
  },
  toastText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
}));
