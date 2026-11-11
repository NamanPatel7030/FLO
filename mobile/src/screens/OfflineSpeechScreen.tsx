// Settings > Voice bubble > Offline speech: which languages this phone can turn into text with no
// internet, a Download button where Android allows it (13+), and the manual steps otherwise.
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bubble } from '../lib/bubble';
import { LANGUAGES } from '../lib/bubbleSettings';
import { manualSteps, packStatus, packTag, parseSupport, PACK_LABEL, PACK_LANGS, worksOffline, type PackStatus, type SpeechSupport } from '../lib/offlineSpeech';
import { useBubbleSettings } from '../state/BubbleSettings';
import { GlassButton, IconButton, PrimaryButton } from '../ui/Buttons';
import { GlassCard } from '../ui/Glass';
import { Icon } from '../ui/Icons';
import { OfflinePill } from '../ui/OfflinePill';
import { colors, fonts, themed, type } from '../ui/theme';

function tone(s: PackStatus): string {
  return s === 'installed' ? colors.green : s === 'downloading' ? colors.sky : s === 'available' ? colors.amber : colors.inkMuted;
}

export function OfflineSpeechScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const { settings } = useBubbleSettings();
  const [support, setSupport] = useState<SpeechSupport | null>(null);
  const [asked, setAsked] = useState<Record<string, 'ok' | 'no'>>({});
  const sdk = bubble.sdk();

  const check = useCallback(async () => {
    setSupport(parseSupport(await bubble.speechSupport(packTag(settings.language))));
  }, [settings.language]);

  useEffect(() => {
    void check();
    // back from Android settings: look again
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void check());
    return () => sub.remove();
  }, [check]);

  // Auto and Hinglish ride on the Indian English pack: name the pack, not the setting
  const tag = packTag(settings.language);
  const lang = PACK_LANGS.find((l) => l.tag === tag)?.label ?? LANGUAGES.find((l) => l.id === settings.language)?.label ?? 'your language';
  const ready = support ? worksOffline(settings.language, support) : null;

  const download = async (tag: string) => {
    const ok = await bubble.downloadSpeech(tag);
    setAsked((a) => ({ ...a, [tag]: ok ? 'ok' : 'no' }));
    if (!ok) bubble.openSpeechSettings();
    setTimeout(() => void check(), 4000);
  };

  return (
    <ScrollView testID="offline-speech" contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 40, paddingHorizontal: 18 }}>
      <View style={styles.header}>
        <IconButton label="Back" onPress={onBack} testID="speech-back">
          <Icon name="back" color={colors.ink} />
        </IconButton>
        <Text style={styles.headerTitle}>Offline speech</Text>
        <View style={{ width: 44 }} />
      </View>
      <OfflinePill style={{ marginBottom: 12 }} />

      <GlassCard strong radius={26} style={styles.hero}>
        <View style={[styles.heroIcon, { backgroundColor: ready ? 'rgba(31,157,107,0.14)' : 'rgba(196,122,0,0.12)' }]}>
          <Icon name={ready ? 'check' : 'download'} size={26} color={ready ? colors.green : colors.amber} strokeWidth={2.2} />
        </View>
        <Text style={styles.heroTitle} testID="speech-status">
          {ready === true ? 'Dictation works offline' : ready === null ? 'Checking this phone' : 'One download to go offline'}
        </Text>
        <Text style={[type.body, { textAlign: 'center', marginTop: 6 }]}>
          {ready === true
            ? `${lang} is on this phone. The bubble types what you say with no internet, and your voice stays on the phone.`
            : ready === null
              ? support?.api === 'basic'
                ? 'This phone has on-device speech, but Android 12 cannot say which languages are downloaded. Check below.'
                : 'Looking at the speech packs on this phone…'
              : `Download ${lang} once and the bubble types what you say even with no connection.`}
        </Text>
      </GlassCard>

      <Text style={styles.section}>Languages on this phone</Text>
      <GlassCard style={{ paddingVertical: 4 }}>
        {PACK_LANGS.map((l, i) => {
          const st = support ? packStatus(l.tag, support) : 'unknown';
          const canDownload = st === 'available' && sdk >= 33 && support?.api === 'full';
          return (
            <View key={l.tag} style={[styles.row, i > 0 && styles.divider]} testID={`pack-${l.tag}`}>
              <View style={[styles.dot, { backgroundColor: tone(st) }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{l.label}</Text>
                <Text style={[type.small, { color: tone(st) }]}>
                  {asked[l.tag] === 'ok' && st !== 'installed' ? 'Download started' : PACK_LABEL[st]}
                </Text>
              </View>
              {canDownload && asked[l.tag] !== 'ok' && <GlassButton compact label="Download" onPress={() => void download(l.tag)} testID={`download-${l.tag}`} />}
            </View>
          );
        })}
      </GlassCard>
      <Text style={styles.footnote}>Packs come from Android (Speech Services by Google), not from Flo. Each is about 30 to 80 MB.</Text>

      <Text style={styles.section}>Do it in Android settings</Text>
      <GlassCard style={{ padding: 16, gap: 12 }}>
        {manualSteps(sdk).map((s, i) => (
          <View key={s} style={styles.step}>
            <View style={styles.num}>
              <Text style={styles.numText}>{i + 1}</Text>
            </View>
            <Text style={[type.body, { flex: 1 }]}>{s}</Text>
          </View>
        ))}
        <PrimaryButton label="Open speech settings" onPress={() => bubble.openSpeechSettings()} testID="open-speech-settings" />
      </GlassCard>

      <Text style={styles.section}>What works offline</Text>
      <GlassCard style={{ padding: 16, gap: 10 }}>
        <Text style={type.body}>
          <Text style={styles.bold}>Dictation:</Text> fully, once your language is downloaded.
        </Text>
        <Text style={type.body}>
          <Text style={styles.bold}>Ask Flo:</Text> questions are kept on the phone and answered as soon as you're back online. You get the answer as a notification.
        </Text>
        <Text style={type.body}>
          <Text style={styles.bold}>The app:</Text> settings, your Recent list and the last inbox all open without a connection.
        </Text>
      </GlassCard>
    </ScrollView>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    headerTitle: { fontFamily: fonts.semibold, fontSize: 18, color: colors.ink },
    hero: { alignItems: 'center', padding: 22 },
    heroIcon: { width: 56, height: 56, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
    heroTitle: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26, letterSpacing: -0.4, color: colors.ink, textAlign: 'center' },
    section: { ...type.micro, marginTop: 26, marginBottom: 10, marginLeft: 6 },
    footnote: { ...type.small, marginTop: 10, marginHorizontal: 6, color: colors.inkFaint },
    row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 13 },
    divider: { borderTopWidth: 1, borderTopColor: colors.hairline },
    rowTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: colors.ink },
    dot: { width: 10, height: 10, borderRadius: 5 },
    step: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
    num: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.glassStrong, marginTop: 1 },
    numText: { color: colors.ink, fontSize: 12, fontWeight: '700' },
    bold: { fontFamily: fonts.semibold, color: colors.ink },
  }),
);
