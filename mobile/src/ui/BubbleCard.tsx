// Settings card for the voice bubble: turn it on (microphone + Accessibility), pause it, see its state.
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { bubble, type BubbleState } from '../lib/bubble';
import { GlassButton } from './Buttons';
import { GlassCard } from './Glass';
import { Icon } from './Icons';
import { Toggle } from './Toggle';
import { colors, themed, type } from './theme';

async function askMicrophone(): Promise<boolean> {
  try {
    const m = await import('expo-speech-recognition');
    const r = await m.ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return r.granted;
  } catch {
    return false;
  }
}

export function BubbleCard() {
  const [state, setState] = useState<BubbleState>(() => bubble.state());
  const [micDenied, setMicDenied] = useState(false);
  const refresh = useCallback(() => setState(bubble.state()), []);

  // coming back from Android's Accessibility screen
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  if (state === 'unavailable') return null;

  const turnOn = async () => {
    const mic = await askMicrophone();
    setMicDenied(!mic);
    if (!mic) return;
    bubble.setEnabled(true);
    bubble.openSettings();
  };

  return (
    <View testID="bubble-card"><GlassCard style={styles.card}>
      <View style={styles.head}>
        <View style={styles.icon}>
          <Icon name="mic" size={18} color={colors.sky} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={type.heading}>Voice bubble</Text>
          <Text style={[type.small, { marginTop: 2 }]}>
            {state === 'on' ? 'On. Tap a text field in any app.' : state === 'paused' ? 'Paused.' : 'Off.'}
          </Text>
        </View>
        {state !== 'off' && (
          <Toggle
            label="Voice bubble"
            value={state === 'on'}
            onChange={(v) => {
              bubble.setEnabled(v);
              refresh();
            }}
          />
        )}
      </View>
      <Text style={[type.body, { marginTop: 10 }]}>
        Tap any text field and Flo appears at the edge of the screen. Hold Dictate and speak to type, or hold Ask and speak to ask Flo.
      </Text>
      {state === 'off' && (
        <>
          <Text style={[type.small, { marginTop: 10 }]}>
            Android asks you to turn Flo on under Accessibility, then Installed apps, then Flo voice bubble. Flo only reads the field you are typing in, never passwords, and only listens while you hold a button.
          </Text>
          {micDenied && <Text style={[type.small, { marginTop: 8, color: colors.amber }]}>Flo needs the microphone for this. Allow it in Android settings, then try again.</Text>}
          <GlassButton label="Turn on the bubble" onPress={() => void turnOn()} style={{ marginTop: 14 }} testID="bubble-on" />
        </>
      )}
    </GlassCard></View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    card: { padding: 18 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.glassStrong },
  }),
);
