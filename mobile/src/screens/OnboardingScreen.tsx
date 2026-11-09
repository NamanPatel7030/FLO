// First run: four short screens led by Notchling, ending at pairing.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePrefs } from '../state/Prefs';
import { useFlo } from '../state/FloContext';
import { GlassButton, PrimaryButton, tap } from '../ui/Buttons';
import { GlassCard } from '../ui/Glass';
import { Icon, QrGlyph, type IconName } from '../ui/Icons';
import { Notchling, type Mood } from '../ui/Notchling';
import { colors, fonts, radius, themed, type } from '../ui/theme';

const native = Platform.OS !== 'web';
const PAGES = 4;

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 5 ? 'Up late?' : h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.';
}

/** The notch drops in from the top edge of the screen, then settles (no bounce). */
function NotchDrop({ mood, avatar }: { mood: Mood; avatar: ReturnType<typeof usePrefs>['prefs']['avatar'] }) {
  const y = useRef(new Animated.Value(-260)).current;
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(y, { toValue: 0, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
      Animated.timing(fade, { toValue: 1, duration: 500, useNativeDriver: native }),
    ]).start();
  }, [y, fade]);
  return (
    <Animated.View style={{ alignItems: 'center', opacity: fade, transform: [{ translateY: y }] }}>
      <Notchling mood={mood} size={190} plate={false} avatar={avatar} accent={colors.sky} />
    </Animated.View>
  );
}

function Feature({ icon, title, body, delay }: { icon: IconName; title: string; body: string; delay: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 520, delay, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, [v, delay]);
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
      <GlassCard radius={radius.md} style={styles.feature}>
        <View style={styles.featureIcon}>
          <Icon name={icon} size={19} color={colors.sky} strokeWidth={2.1} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={type.heading}>{title}</Text>
          <Text style={[type.small, { marginTop: 2 }]}>{body}</Text>
        </View>
      </GlassCard>
    </Animated.View>
  );
}

type Perm = 'unknown' | 'granted' | 'denied';

function PermRow({ icon, title, body, state, onPress, testID }: { icon: IconName; title: string; body: string; state: Perm; onPress: () => void; testID: string }) {
  return (
    <GlassCard radius={radius.md} style={styles.feature}>
      <View style={styles.featureIcon}>
        <Icon name={icon} size={19} color={colors.sky} strokeWidth={2.1} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={type.heading}>{title}</Text>
        <Text style={[type.small, { marginTop: 2 }]}>{body}</Text>
      </View>
      {state === 'granted' ? (
        <View style={styles.okBadge}>
          <Icon name="check" size={16} color="#fff" strokeWidth={2.8} />
        </View>
      ) : (
        <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={styles.allow}>
          <Text style={styles.allowText}>{state === 'denied' ? 'Settings' : 'Allow'}</Text>
        </Pressable>
      )}
    </GlassCard>
  );
}

export function OnboardingScreen({ onScan, onEnterCode, error }: { onScan: () => void; onEnterCode: () => void; error?: string | null }) {
  const insets = useSafeAreaInsets();
  const flo = useFlo();
  const { prefs, update } = usePrefs();
  const [page, setPage] = useState(prefs.onboarded ? PAGES - 1 : 0);
  const [cam, setCam] = useState<Perm>('unknown');
  const [mic, setMic] = useState<Perm>('unknown');
  const notif: Perm = flo.permission.state === 'granted' ? 'granted' : flo.permission.state === 'denied' ? 'denied' : 'unknown';
  const slide = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    slide.setValue(0);
    Animated.timing(slide, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, [page, slide]);

  const go = (p: number) => {
    tap();
    setPage(Math.max(0, Math.min(PAGES - 1, p)));
    if (p >= PAGES - 1 && !prefs.onboarded) update({ onboarded: true });
  };

  async function askCamera() {
    if (Platform.OS === 'web') return setCam('granted');
    const { Camera } = await import('expo-camera');
    const r = await Camera.requestCameraPermissionsAsync();
    setCam(r.granted ? 'granted' : 'denied');
  }
  async function askMic() {
    if (Platform.OS !== 'android') return setMic('granted');
    const { ExpoSpeechRecognitionModule } = await import('expo-speech-recognition');
    const r = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    setMic(r.granted ? 'granted' : 'denied');
  }

  const allGranted = cam === 'granted' && mic === 'granted' && notif === 'granted';
  const anyDenied = cam === 'denied' || mic === 'denied' || notif === 'denied';
  const mood: Mood = page === 0 ? 'excited' : page === 1 ? 'happy' : page === 2 ? (allGranted ? 'celebrate' : anyDenied ? 'worried' : 'listen') : 'love';

  const pageStyle = {
    opacity: slide,
    transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }],
  };

  return (
    <ScrollView contentContainerStyle={[styles.root, { paddingBottom: insets.bottom + 22 }]} bounces={false} testID="onboarding">
      <View style={{ height: insets.top }} />
      {page === 0 ? <NotchDrop mood={mood} avatar={prefs.avatar} /> : (
        <View style={{ alignItems: 'center', marginTop: 18 }}>
          <Notchling mood={mood} size={page === 3 ? 130 : 112} pose="float" plate={false} avatar={prefs.avatar} accent={colors.sky} />
        </View>
      )}

      <Animated.View style={[{ flex: 1 }, pageStyle]}>
        {page === 0 && (
          <View style={{ marginTop: 18 }}>
            <Text style={type.micro}>{greeting()}</Text>
            <Text style={[type.display, styles.headline]}>
              Hi, I'm <Text style={styles.serif}>Flo.</Text>
            </Text>
            <Text style={[type.body, { marginTop: 12 }]}>
              I live on your computer. On your phone, I keep you posted while you're away, answer questions and take your notes by voice.
            </Text>
          </View>
        )}

        {page === 1 && (
          <View style={{ marginTop: 14 }}>
            <Text style={[type.display, styles.headline]}>
              Your computer, <Text style={styles.serif}>in your pocket.</Text>
            </Text>
            <View style={{ gap: 10, marginTop: 18 }}>
              <Feature delay={80} icon="claude" title="Know when work is done" body="Claude finished, to-dos due, reminders and meeting notes, while you're Away." />
              <Feature delay={160} icon="sparkle" title="Ask Flo by voice" body="Your computer answers with your own assistant and your own data." />
              <Feature delay={240} icon="mic" title="Dictate on the go" body="Speak a to-do or a note and it lands on your computer." />
              <Feature delay={320} icon="moon" title="Away mode" body="Lock your computer and updates follow you here. Come back and they stop." />
            </View>
          </View>
        )}

        {page === 2 && (
          <View style={{ marginTop: 14 }}>
            <Text style={[type.display, styles.headline]}>
              A few <Text style={styles.serif}>quick yeses.</Text>
            </Text>
            <Text style={[type.body, { marginTop: 10 }]}>
              {allGranted ? 'All set. Thank you!' : anyDenied ? 'No problem. You can turn these on later in Settings.' : 'Each one has a single job. Nothing is recorded or shared without you.'}
            </Text>
            <View style={{ gap: 10, marginTop: 16 }}>
              <PermRow testID="allow-camera" icon="qr" title="Camera" body="Only to scan the pairing code on your computer." state={cam} onPress={() => void askCamera()} />
              <PermRow testID="allow-mic" icon="mic" title="Microphone" body="Only while you hold Ask or Dictate." state={mic} onPress={() => void askMic()} />
              <PermRow testID="allow-notifications" icon="bell" title="Notifications" body="Updates from your computer while you're Away." state={notif} onPress={() => void flo.requestPermission()} />
            </View>
          </View>
        )}

        {page === 3 && (
          <View style={{ marginTop: 14 }}>
            <Text style={[type.display, styles.headline]}>
              Let's meet <Text style={styles.serif}>your computer.</Text>
            </Text>
            <Text style={[type.body, { marginTop: 10 }]}>On your computer, open Flo, then Settings, General, Your phones, and click Pair your Android phone.</Text>
            {!!error && (
              <View style={styles.error}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </View>
        )}
      </Animated.View>

      <View style={{ flex: 1, minHeight: 18 }} />

      <View style={styles.dots}>
        {Array.from({ length: PAGES }, (_, i) => (
          <Pressable key={i} accessibilityLabel={`Page ${i + 1}`} onPress={() => go(i)} hitSlop={8}>
            <View style={[styles.dot, i === page && styles.dotOn]} />
          </Pressable>
        ))}
      </View>

      {page < PAGES - 1 ? (
        <View style={{ gap: 10 }}>
          <PrimaryButton testID="next" label={page === 0 ? "Let's go" : page === 2 && !allGranted ? 'Continue' : 'Next'} onPress={() => go(page + 1)} />
          {page === 0 && <GlassButton testID="skip" label="I've done this before" onPress={() => go(PAGES - 1)} />}
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <PrimaryButton testID="scan" label="Pair with your computer" icon={<QrGlyph color={colors.onPrimary} />} onPress={onScan} />
          <GlassButton testID="enter-code" label="Enter code instead" icon={<Icon name="keypad" size={18} color={colors.inkSoft} />} onPress={onEnterCode} />
        </View>
      )}
    </ScrollView>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    root: { flexGrow: 1, paddingHorizontal: 24 },
    headline: { fontSize: 36, lineHeight: 42, marginTop: 6 },
    serif: { fontFamily: fonts.serif, fontSize: 42, color: colors.sky, letterSpacing: -0.5 },
    feature: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
    featureIcon: {
      width: 40,
      height: 40,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.dark ? 'rgba(102,206,255,0.12)' : 'rgba(47,140,255,0.1)',
    },
    allow: { paddingHorizontal: 14, height: 34, borderRadius: radius.pill, backgroundColor: colors.primary, justifyContent: 'center' },
    allowText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.onPrimary },
    okBadge: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
    dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 18 },
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.inkFaint },
    dotOn: { width: 22, backgroundColor: colors.ink },
    error: { marginTop: 14, padding: 14, borderRadius: 16, backgroundColor: colors.errorBg, borderWidth: 1, borderColor: colors.errorBorder },
    errorText: { ...type.small, color: colors.errorText },
  }),
);
