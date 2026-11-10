// Settings card for the voice bubble: turn it on in as few taps as Android allows, pause it, see its state.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { bubble, enableStep, type BubbleState, type EnableStep } from '../lib/bubble';
import { GlassButton, PrimaryButton } from './Buttons';
import { GlassCard } from './Glass';
import { Icon, type IconName } from './Icons';
import { Toggle } from './Toggle';
import { colors, themed, type } from './theme';

async function microphone(ask: boolean): Promise<boolean> {
  try {
    const m = await import('expo-speech-recognition');
    const r = ask
      ? await m.ExpoSpeechRecognitionModule.requestPermissionsAsync()
      : await m.ExpoSpeechRecognitionModule.getPermissionsAsync();
    return r.granted;
  } catch {
    return false;
  }
}

const GUIDE: { icon: IconName; title: string; detail: string }[] = [
  { icon: 'info', title: 'Open App info', detail: 'Flo opens its App info page for you.' },
  { icon: 'more', title: 'Tap the menu, then Allow restricted settings', detail: 'The menu is the three dots at the top right. Android asks this once for apps installed outside the Play Store.' },
  { icon: 'mic', title: 'Come back and turn on Flo voice bubble', detail: 'Flo takes you to its switch in Accessibility.' },
];

export function BubbleCard() {
  const [state, setState] = useState<BubbleState>(() => bubble.state());
  const [step, setStep] = useState<EnableStep | null>(null); // null until "Turn on" is tapped
  const [micDenied, setMicDenied] = useState(false);
  const [sawBlock, setSawBlock] = useState(false); // Android's restricted-setting block applied at some point
  const tried = useRef(false);

  /** Re-read everything and work out what's left. */
  const refresh = useCallback(async (askMic = false) => {
    setState(bubble.state());
    const mic = await microphone(askMic);
    const next = enableStep({
      serviceOn: bubble.serviceOn(),
      mic,
      restricted: bubble.restricted(),
      sdk: bubble.sdk(),
      triedAccessibility: tried.current,
    });
    setStep(next);
    if (next === 'unblock') setSawBlock(true);
    return next;
  }, []);

  // coming back from App info or Accessibility: advance on its own
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      if (step === null) setState(bubble.state());
      else void refresh();
    });
    return () => sub.remove();
  }, [refresh, step]);

  if (state === 'unavailable') return null;

  /** One button that does the next thing. */
  const go = async () => {
    const next = await refresh(true);
    setMicDenied(next === 'mic');
    if (next === 'mic' || next === 'done') return;
    bubble.setEnabled(true);
    if (next === 'unblock') {
      bubble.openAppInfo();
    } else {
      tried.current = true;
      bubble.openSettings();
    }
  };

  // the 3-step guide, once Android's block shows up; App info rows are done when it lifts
  const guiding = state === 'off' && (step === 'unblock' || (step === 'accessibility' && sawBlock));
  const at = step === 'unblock' ? 0 : 2; // first current row

  return (
    <View testID="bubble-card"><GlassCard style={styles.card}>
      <View style={styles.head}>
        <View style={styles.icon}>
          <Icon name="mic" size={18} color={colors.sky} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={type.heading}>Voice bubble</Text>
          <Text style={[type.small, { marginTop: 2 }]}>
            {state === 'on' ? 'Bubble is on. Tap a text field in any app.' : state === 'paused' ? 'Paused.' : 'Off.'}
          </Text>
        </View>
        {state !== 'off' && (
          <Toggle
            label="Voice bubble"
            value={state === 'on'}
            onChange={(v) => {
              bubble.setEnabled(v);
              setState(bubble.state());
            }}
          />
        )}
      </View>
      <Text style={[type.body, { marginTop: 10 }]}>
        Tap any text field and the Flo dock appears near your thumb. Drag it anywhere. Hold Dictate and speak to type, or hold Ask and speak to ask Flo. While Flo listens or answers, a small island shows at the top of the screen.
      </Text>
      {state === 'off' && (
        <>
          {guiding ? (
            <View style={{ marginTop: 14, gap: 12 }} testID="bubble-guide">
              <Text style={type.small}>Android keeps this switch locked for apps installed outside the Play Store. Three quick steps:</Text>
              {GUIDE.map((g, i) => {
                const done = i < at;
                const current = at === 0 ? i < 2 : i === 2;
                return (
                  <View key={g.title} style={[styles.row, current && styles.rowCurrent]}>
                    <View style={[styles.num, done && styles.numDone]}>
                      {done ? <Icon name="check" size={14} color={colors.onPrimary} /> : <Text style={styles.numText}>{i + 1}</Text>}
                    </View>
                    <Icon name={g.icon} size={20} color={current ? colors.sky : colors.inkMuted} />
                    <View style={{ flex: 1 }}>
                      <Text style={[type.body, styles.rowTitle]}>{g.title}</Text>
                      <Text style={type.small}>{g.detail}</Text>
                    </View>
                  </View>
                );
              })}
              <PrimaryButton
                label={at === 0 ? 'Open App info' : 'Open Accessibility'}
                onPress={() => {
                  if (at === 0) bubble.openAppInfo();
                  else {
                    tried.current = true;
                    bubble.openSettings();
                  }
                }}
                testID="bubble-guide-next"
              />
            </View>
          ) : (
            <Text style={[type.small, { marginTop: 10 }]}>
              Flo only reads the field you are typing in, never passwords, and only listens while you hold a button.
            </Text>
          )}
          {micDenied && <Text style={[type.small, { marginTop: 8, color: colors.amber }]}>Flo needs the microphone for this. Allow it in Android settings, then try again.</Text>}
          {!guiding && <GlassButton label="Turn on the bubble" onPress={() => void go()} style={{ marginTop: 14 }} testID="bubble-on" />}
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
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: colors.glass },
    rowCurrent: { borderWidth: 1, borderColor: colors.sky },
    rowTitle: { fontWeight: '600' },
    num: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.glassStrong },
    numDone: { backgroundColor: colors.green },
    numText: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  }),
);
