import React, { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isValidCode, normalizeCode, normalizeServerUrl, type PairTarget } from '../lib/pairing';
import { IconButton, PrimaryButton } from '../ui/Buttons';
import { GlassCard } from '../ui/Glass';
import { Icon } from '../ui/Icons';
import { absFill, colors, fonts, radius, type } from '../ui/theme';

export function EnterCodeScreen({
  onBack,
  onPair,
  initialServer,
  initialCode,
}: {
  onBack: () => void;
  onPair: (t: PairTarget) => Promise<void>;
  initialServer?: string;
  initialCode?: string;
}) {
  const insets = useSafeAreaInsets();
  const [server, setServer] = useState(initialServer ?? '');
  const [code, setCode] = useState(normalizeCode(initialCode ?? '').slice(0, 6));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeFocused, setCodeFocused] = useState(false);
  const codeRef = useRef<React.ComponentRef<typeof TextInput>>(null);

  const serverUrl = normalizeServerUrl(server);
  const canSubmit = !!serverUrl && isValidCode(code) && !busy;

  async function submit() {
    if (!serverUrl) return setError('Enter the address of your Flo server, e.g. flo.app');
    if (!isValidCode(code)) return setError('The code is 6 digits — it’s shown under the QR on your Mac.');
    setBusy(true);
    setError(null);
    try {
      await onPair({ server: serverUrl, code: normalizeCode(code) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pairing failed.');
    } finally {
      setBusy(false);
    }
  }

  const digits = code.padEnd(6, ' ').split('');
  const activeIndex = Math.min(code.length, 5);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.root, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24 }]}
      >
        <View style={styles.header}>
          <IconButton label="Back" onPress={onBack}>
            <Icon name="back" color={colors.ink} />
          </IconButton>
        </View>

        <Text style={[type.micro, { marginTop: 22 }]}>Pair manually</Text>
        <Text style={[type.display, { marginTop: 8 }]}>Enter your code</Text>
        <Text style={[type.body, { marginTop: 10 }]}>
          Find the 6-digit code under the QR on your Mac. It expires after 5 minutes.
        </Text>

        <Text style={styles.label}>Server</Text>
        <GlassCard radius={radius.md} style={styles.inputCard}>
          <Icon name="server" size={18} color={colors.inkMuted} />
          <TextInput
            testID="server-input"
            value={server}
            onChangeText={setServer}
            placeholder="flo.app or 192.168.1.20:3000"
            placeholderTextColor={colors.inkFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="next"
            onSubmitEditing={() => codeRef.current?.focus()}
            style={styles.input}
          />
          {!!serverUrl && <Icon name="check" size={18} color={colors.green} />}
        </GlassCard>
        {!!server && !!serverUrl && <Text style={styles.resolved}>Will connect to {serverUrl}</Text>}

        <Text style={styles.label}>Pairing code</Text>
        <Pressable onPress={() => codeRef.current?.focus()} style={styles.codeRow}>
          {digits.map((d, i) => {
            const active = codeFocused && i === activeIndex;
            return (
              <React.Fragment key={i}>
                {i === 3 && <View style={styles.dash} />}
                <View style={[styles.cell, d.trim() && styles.cellFilled, active && styles.cellActive]}>
                  <Text style={styles.cellText}>{d.trim()}</Text>
                </View>
              </React.Fragment>
            );
          })}
          <TextInput
            ref={codeRef}
            testID="code-input"
            value={code}
            onChangeText={(t) => setCode(normalizeCode(t).slice(0, 6))}
            onFocus={() => setCodeFocused(true)}
            onBlur={() => setCodeFocused(false)}
            keyboardType="number-pad"
            maxLength={7}
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            style={styles.hiddenInput}
            caretHidden
          />
        </Pressable>

        {!!error && (
          <View style={styles.error}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={{ flex: 1, minHeight: 28 }} />
        <PrimaryButton testID="pair" label="Pair" loading={busy} disabled={!canSubmit} onPress={submit} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, paddingHorizontal: 24 },
  header: { flexDirection: 'row' },
  label: { ...type.micro, marginTop: 28, marginBottom: 10 },
  inputCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, height: 56 },
  input: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.ink,
    height: '100%',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
  },
  resolved: { ...type.small, marginTop: 8, color: colors.inkFaint },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cell: {
    flex: 1,
    height: 62,
    borderRadius: 18,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellFilled: { backgroundColor: 'rgba(102,206,255,0.08)', borderColor: 'rgba(102,206,255,0.3)' },
  cellActive: { borderColor: colors.sky, borderWidth: 1.5 },
  cellText: { fontFamily: fonts.semibold, fontSize: 26, color: colors.ink },
  dash: { width: 10, height: 2, borderRadius: 1, backgroundColor: colors.inkFaint },
  hiddenInput: { ...absFill, opacity: 0.011, color: 'transparent', fontSize: 1 },
  error: {
    marginTop: 18,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,107,107,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.25)',
  },
  errorText: { ...type.small, color: '#ffb4b4' },
});
