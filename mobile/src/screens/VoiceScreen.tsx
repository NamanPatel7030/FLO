// Ask Flo / Dictate: talk on the phone; the paired Mac answers (or saves the to-do / note).
import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describeError } from '../api/client';
import type { AskMode, AskRequest } from '../api/types';
import { useVoice } from '../lib/voice';
import { usePrefs } from '../state/Prefs';
import { useFlo } from '../state/FloContext';
import { GlassButton, IconButton, PrimaryButton, tap } from '../ui/Buttons';
import { GlassCard } from '../ui/Glass';
import { Icon, type IconName } from '../ui/Icons';
import { Notchling, type Mood } from '../ui/Notchling';
import { colors, fonts, radius, themed, type } from '../ui/theme';

const MODES: { id: AskMode; label: string; icon: IconName; hint: string }[] = [
  { id: 'ask', label: 'Ask Flo', icon: 'sparkle', hint: 'Your computer answers with your own assistant.' },
  { id: 'todo', label: 'To-do', icon: 'todos', hint: 'Added to your to-dos on your computer.' },
  { id: 'note', label: 'Note', icon: 'note', hint: 'Saved to Notes on your computer.' },
];

/** Poll the request until the Mac answers (or give up after ~90 s). */
async function waitForAnswer(get: (id: string) => Promise<AskRequest>, id: string, cancelled: () => boolean): Promise<AskRequest> {
  const started = Date.now();
  let last: AskRequest | null = null;
  while (!cancelled() && Date.now() - started < 90_000) {
    await new Promise((r) => setTimeout(r, last?.status === 'taken' ? 1200 : 1800));
    last = await get(id);
    if (last.status === 'done' || last.status === 'failed') return last;
  }
  if (last) return last;
  throw new Error('Your computer did not answer.');
}

export function VoiceScreen({ initialMode = 'ask', autoStart, onClose }: { initialMode?: AskMode; autoStart?: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const flo = useFlo();
  const { prefs } = usePrefs();
  const voice = useVoice(flo.mock);
  const [mode, setMode] = useState<AskMode>(initialMode);
  const [phase, setPhase] = useState<'idle' | 'sending' | 'waiting' | 'answered' | 'failed'>('idle');
  const [answer, setAnswer] = useState<string>('');
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    if (autoStart) void voice.start();
    return () => {
      cancelled.current = true;
      voice.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = phase === 'sending' || phase === 'waiting';
  const mood: Mood = voice.listening
    ? 'listen'
    : busy
      ? 'think'
      : phase === 'answered'
        ? mode === 'ask'
          ? 'talk'
          : 'celebrate'
        : phase === 'failed' || err || voice.error
          ? 'worried'
          : voice.text
            ? 'happy'
            : 'excited';

  async function send() {
    const text = voice.text.trim();
    if (!text) return;
    tap();
    setErr(null);
    setAnswer('');
    setPhase('sending');
    try {
      const api = flo.api;
      if (!api) throw new Error('Pair with your computer first.');
      const r = await api.ask(mode, text);
      setPhase('waiting');
      const done = await waitForAnswer((id) => api.getAsk(id), r.id, () => cancelled.current);
      setAnswer(done.answer ?? '');
      setPhase(done.status === 'done' ? 'answered' : 'failed');
      if (done.status !== 'done' && !done.answer) setErr("Your computer couldn't do that.");
      void flo.refresh();
    } catch (e) {
      setErr(
        e instanceof Error && e.message === 'Your computer did not answer.'
          ? "Your computer didn't answer. Make sure Flo is open on it and signed in."
          : describeError(e),
      );
      setPhase('failed');
    }
  }

  async function copy(text: string) {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const status = voice.listening
    ? 'Listening…'
    : phase === 'sending'
      ? 'Sending to your computer…'
      : phase === 'waiting'
        ? 'Your computer is on it…'
        : phase === 'answered'
          ? mode === 'ask'
            ? 'Flo says'
            : 'Done'
          : voice.text
            ? 'Tap send, or edit first'
            : 'Tap the mic and talk';

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.root, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24 }]}
      testID="voice"
    >
      <View style={styles.header}>
        <IconButton label="Close" onPress={onClose}>
          <Icon name="close" color={colors.ink} />
        </IconButton>
      </View>

      <View style={styles.hero}>
        <Notchling mood={mood} size={150} avatar={prefs.avatar} accent={colors.sky} />
        <Text style={[type.micro, { marginTop: 16 }]}>{status}</Text>
      </View>

      <View style={styles.modes} accessibilityRole="tablist">
        {MODES.map((m) => {
          const on = m.id === mode;
          return (
            <Pressable
              key={m.id}
              testID={`mode-${m.id}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              disabled={busy}
              onPress={() => {
                tap();
                setMode(m.id);
                setPhase('idle');
              }}
              style={[styles.mode, on && styles.modeOn]}
            >
              <Icon name={m.icon} size={16} color={on ? colors.onPrimary : colors.inkSoft} />
              <Text style={[styles.modeText, on && { color: colors.onPrimary }]}>{m.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[type.small, { textAlign: 'center', marginTop: 10 }]}>{MODES.find((m) => m.id === mode)?.hint}</Text>

      <GlassCard strong radius={radius.lg} style={styles.textCard}>
        <TextInput
          testID="voice-text"
          value={voice.text}
          onChangeText={voice.setText}
          placeholder="Your words appear here"
          placeholderTextColor={colors.inkFaint}
          multiline
          style={styles.text}
          editable={!voice.listening && !busy}
        />
      </GlassCard>

      {!!(voice.error || err) && (
        <View style={styles.error}>
          <Text style={styles.errorText}>{voice.error || err}</Text>
        </View>
      )}

      {phase === 'answered' && !!answer && (
        <GlassCard radius={radius.lg} style={styles.answer} tint={colors.sky}>
          <Text style={type.micro}>{mode === 'ask' ? 'Answer from your computer' : 'Your computer'}</Text>
          <Text style={styles.answerText} testID="voice-answer">
            {answer}
          </Text>
          <View style={styles.row}>
            <GlassButton compact label={copied ? 'Copied' : 'Copy'} icon={<Icon name="copy" size={16} color={colors.ink} />} onPress={() => void copy(answer)} />
            <GlassButton compact label="Share" icon={<Icon name="share" size={16} color={colors.ink} />} onPress={() => void Share.share({ message: answer })} />
          </View>
        </GlassCard>
      )}

      <View style={{ flex: 1, minHeight: 20 }} />

      <View style={styles.controls}>
        <Pressable
          testID="mic"
          accessibilityRole="button"
          accessibilityLabel={voice.listening ? 'Stop listening' : 'Start listening'}
          disabled={busy || !voice.supported}
          onPress={() => {
            tap();
            if (voice.listening) voice.stop();
            else {
              setPhase('idle');
              void voice.start();
            }
          }}
          style={[styles.mic, voice.listening && styles.micOn, !voice.supported && { opacity: 0.4 }]}
        >
          <Icon name={voice.listening ? 'close' : 'mic'} size={30} color={voice.listening ? '#fff' : colors.onPrimary} strokeWidth={2.2} />
        </Pressable>
      </View>

      <View style={[styles.row, { marginTop: 18 }]}>
        <GlassButton
          style={{ flex: 1 }}
          compact
          label={copied ? 'Copied' : 'Copy text'}
          disabled={!voice.text}
          icon={<Icon name="copy" size={16} color={colors.ink} />}
          onPress={() => void copy(voice.text)}
        />
        <PrimaryButton
          testID="send"
          style={{ flex: 1.4 }}
          label={mode === 'ask' ? 'Ask your computer' : mode === 'todo' ? 'Add to-do' : 'Save note'}
          loading={busy}
          disabled={!voice.text.trim() || voice.listening || !flo.session}
          onPress={() => void send()}
        />
      </View>
      {!flo.session && <Text style={[type.small, { textAlign: 'center', marginTop: 10 }]}>Pair with your computer to send. You can still copy the text.</Text>}
    </ScrollView>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    root: { flexGrow: 1, paddingHorizontal: 22 },
    header: { flexDirection: 'row' },
    hero: { alignItems: 'center', marginTop: 4 },
    modes: { flexDirection: 'row', gap: 8, marginTop: 22, justifyContent: 'center' },
    mode: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingHorizontal: 14,
      height: 40,
      borderRadius: radius.pill,
      backgroundColor: colors.glass,
      borderWidth: 1,
      borderColor: colors.glassBorder,
    },
    modeOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    modeText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.inkSoft },
    textCard: { marginTop: 18, padding: 16, minHeight: 110 },
    text: { fontFamily: fonts.medium, fontSize: 18, lineHeight: 26, color: colors.ink, minHeight: 78, textAlignVertical: 'top' },
    answer: { marginTop: 14, padding: 16, gap: 8 },
    answerText: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: colors.ink },
    row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
    controls: { alignItems: 'center', marginTop: 8 },
    mic: {
      width: 84,
      height: 84,
      borderRadius: 42,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
      shadowColor: '#4b3aa8',
      shadowOpacity: 0.35,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 10 },
      elevation: 10,
    },
    micOn: { backgroundColor: '#ff5c8a' },
    error: { marginTop: 14, padding: 14, borderRadius: 16, backgroundColor: colors.errorBg, borderWidth: 1, borderColor: colors.errorBorder },
    errorText: { ...type.small, color: colors.errorText },
  }),
);
