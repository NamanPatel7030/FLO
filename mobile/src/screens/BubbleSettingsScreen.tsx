// Settings > Voice bubble: modes, gestures, look, speech, typing, feedback, hide-in-apps, plus a live
// preview of the bubble and its Recent list. Saved on this phone and applied to the bubble at once.
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mockOrbState } from '../api/mock';
import { HISTORY_LABEL, bubble } from '../lib/bubble';
import {
  ACTION_LABEL,
  BUBBLE_SIZES,
  FLO_BLUE,
  GESTURE_LABEL,
  LANGUAGES,
  OPACITIES,
  bubbleVisible,
  dictationOnly,
  effectiveGestures,
  isDictationOnly,
  setMode,
  toggleHiddenApp,
  type BubbleAction,
  type Gesture,
} from '../lib/bubbleSettings';
import { packStatus, packTag, parseSupport, PACK_LABEL, type PackStatus } from '../lib/offlineSpeech';
import { statusLine } from '../lib/offlineQueue';
import { relativeTime } from '../lib/time';
import { useBubbleSettings } from '../state/BubbleSettings';
import { useOffline } from '../state/Offline';
import { ACCENTS, usePrefs } from '../state/Prefs';
import { GlassButton, IconButton, tap } from '../ui/Buttons';
import { GlassCard } from '../ui/Glass';
import { Icon } from '../ui/Icons';
import { OfflinePill } from '../ui/OfflinePill';
import { OrbPreview, type OrbState } from '../ui/OrbPreview';
import { Chips, Segmented } from '../ui/Segmented';
import { Toggle } from '../ui/Toggle';
import { colors, fonts, themed, type } from '../ui/theme';

type PreviewState = OrbState | 'offline' | 'tucked';

const STATES: { id: PreviewState; label: string }[] = [
  { id: 'idle', label: 'Resting' },
  { id: 'tucked', label: 'Tucked' },
  { id: 'listening', label: 'Listening' },
  { id: 'thinking', label: 'Thinking' },
  { id: 'done', label: 'Done' },
  { id: 'error', label: 'Error' },
  { id: 'offline', label: 'Offline' },
];

const SAMPLE: Partial<Record<PreviewState, string>> = {
  listening: 'Running ten minutes late, start without me',
  done: 'Typed',
  error: "Didn't catch that. Try again.",
  offline: 'Listening on this phone (offline)',
};

function Row({ title, detail, children, first }: { title: string; detail?: string; children?: React.ReactNode; first?: boolean }) {
  return (
    <View style={[styles.row, !first && styles.divider]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {!!detail && <Text style={[type.small, { marginTop: 2 }]}>{detail}</Text>}
      </View>
      {children}
    </View>
  );
}

function Stack({ title, detail, children, first }: { title: string; detail?: string; children: React.ReactNode; first?: boolean }) {
  return (
    <View style={[styles.stack, !first && styles.divider]}>
      <Text style={styles.rowTitle}>{title}</Text>
      {!!detail && <Text style={[type.small, { marginTop: 2 }]}>{detail}</Text>}
      <View style={{ marginTop: 10 }}>{children}</View>
    </View>
  );
}

/** A small phone screen with the bubble on its edge, in the chosen look and state. */
function Preview({ state, onState }: { state: PreviewState; onState: (s: PreviewState) => void }) {
  const { settings: s, accent } = useBubbleSettings();
  const g = effectiveGestures(s);
  const orbState: OrbState = state === 'offline' || state === 'tucked' ? 'idle' : state;
  const mode = state === 'thinking' && g.tap !== 'ask' && g.longPress === 'ask' ? 'ask' : 'dictate';
  const right = s.side !== 'left';
  const tucked = state === 'tucked';
  const d = colors.dark;
  const size = BUBBLE_SIZES[s.size];
  const W = size + 26;
  const caption = state === 'listening' && !s.preview ? undefined : SAMPLE[state];
  const how = (['tap', 'longPress', 'doubleTap'] as Gesture[])
    .filter((x) => g[x] !== 'none')
    .map((x) => `${GESTURE_LABEL[x]}: ${ACTION_LABEL[g[x]]}`)
    .join('   ·   ');
  return (
    <GlassCard strong radius={28} style={styles.previewCard}>
      <LinearGradient colors={d ? ['#101a3a', '#1c2650', '#2a2350'] : ['#ffffff', '#f3f6fc', '#eaeff9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.phone} testID="bubble-preview">
        <View style={styles.fakeTop}>
          <View style={[styles.fakeAvatar, !d && { backgroundColor: '#dde5f3' }]} />
          <View style={[styles.fakeLine, { width: 92 }, !d && { backgroundColor: '#d3dcec' }]} />
        </View>
        <View style={[styles.fakeMsg, { width: '62%' }, !d && styles.fakeMsgLight]} />
        <View style={[styles.fakeMsg, { width: '44%', alignSelf: 'flex-end', backgroundColor: d ? 'rgba(102,206,255,0.22)' : '#d6e8ff' }]} />
        <View style={[styles.fakeMsg, { width: '54%' }, !d && styles.fakeMsgLight]} />
        <View style={[styles.fakeField, !d && { backgroundColor: '#ffffff', borderColor: '#d9e0ee' }]}>
          <Text style={[styles.fakeFieldText, !d && { color: '#9aa2b2' }]}>Message</Text>
        </View>
        {bubbleVisible(s) ? (
          <View
            style={[
              styles.orbSpot,
              right ? { right: tucked ? -(size / 2 + 13 - 5) : -13 + 5 } : { left: tucked ? -(size / 2 + 13 - 5) : -13 + 5 },
              { opacity: orbState === 'idle' ? s.idleOpacity : 1, width: W, height: W },
            ]}
          >
            <OrbPreview size={size} accent={accent} state={orbState} mode={mode} offline={state === 'offline'} testID="bubble-orb" />
          </View>
        ) : (
          <Text style={styles.hiddenNote}>Both modes are off, so the bubble is hidden.</Text>
        )}
        {!!caption && bubbleVisible(s) && (
          <View style={[styles.caption, right ? { right: W - 13 + 6 } : { left: W - 13 + 6 }, state === 'error' && { backgroundColor: 'rgba(80,16,24,0.92)' }]}>
            <Text style={styles.captionText} numberOfLines={2}>
              {caption}
            </Text>
          </View>
        )}
      </LinearGradient>
      <View style={styles.stateRow}>
        {STATES.map((x) => (
          <Pressable
            key={x.id}
            testID={`orb-${x.id}`}
            onPress={() => {
              tap();
              onState(x.id);
            }}
            style={[styles.stateChip, state === x.id && styles.stateChipOn]}
          >
            <Text style={[styles.stateText, state === x.id && { color: colors.ink }]}>{x.label}</Text>
          </Pressable>
        ))}
      </View>
      {!!how && <Text style={[type.small, { textAlign: 'center', marginTop: 10 }]}>{how}</Text>}
    </GlassCard>
  );
}

function AppPicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { settings, set } = useBubbleSettings();
  const [apps, setApps] = useState<{ pkg: string; label: string }[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (visible && !apps) void bubble.launchableApps().then(setApps);
  }, [visible, apps]);
  const shown = useMemo(() => (apps ?? []).filter((a) => !q.trim() || a.label.toLowerCase().includes(q.trim().toLowerCase())), [apps, q]);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.sheetBack}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]} testID="app-picker">
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Hide the bubble in</Text>
            <GlassButton compact label="Done" onPress={onClose} testID="app-picker-done" />
          </View>
          <TextInput value={q} onChangeText={setQ} placeholder="Search apps" placeholderTextColor={colors.inkFaint} style={styles.search} />
          <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
            {apps === null && <Text style={[type.small, { padding: 16 }]}>Loading your apps…</Text>}
            {apps?.length === 0 && <Text style={[type.small, { padding: 16 }]}>No apps found.</Text>}
            {shown.map((a) => {
              const on = settings.hiddenApps.includes(a.pkg);
              return (
                <Pressable
                  key={a.pkg}
                  testID={`app-${a.pkg}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => {
                    tap();
                    set(toggleHiddenApp(settings, a.pkg));
                  }}
                  style={styles.appRow}
                >
                  <View style={styles.appBadge}>
                    <Text style={styles.appLetter}>{a.label.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {a.label}
                    </Text>
                    <Text style={type.small} numberOfLines={1}>
                      {a.pkg}
                    </Text>
                  </View>
                  <View style={[styles.check, on && styles.checkOn]}>{on && <Icon name="check" size={14} color={colors.onPrimary} />}</View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function BubbleSettingsScreen({ onBack, onSpeech }: { onBack: () => void; onSpeech: () => void }) {
  const insets = useSafeAreaInsets();
  const { settings: s, update, set } = useBubbleSettings();
  const { prefs } = usePrefs();
  const off = useOffline();
  const start = mockOrbState();
  const [state, setState] = useState<PreviewState>(() => (STATES.some((x) => x.id === start) ? (start as PreviewState) : 'idle'));
  const [picker, setPicker] = useState(false);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [pack, setPack] = useState<PackStatus | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const g = effectiveGestures(s);

  useEffect(() => {
    if (!s.hiddenApps.length) return;
    void bubble.launchableApps().then((a) => setLabels(Object.fromEntries(a.map((x) => [x.pkg, x.label]))));
  }, [s.hiddenApps.length]);

  useEffect(() => {
    let live = true;
    void bubble.speechSupport(packTag(s.language)).then((raw) => {
      if (live) setPack(raw ? packStatus(packTag(s.language), parseSupport(raw)) : null);
    });
    return () => {
      live = false;
    };
  }, [s.language]);

  useEffect(() => off.refreshHistory(), [off.refreshHistory]);

  const gestureOptions = () =>
    (['dictate', 'ask', 'none'] as BubbleAction[]).map((a) => ({
      id: a,
      label: ACTION_LABEL[a],
      disabled: (a === 'dictate' && !s.dictation) || (a === 'ask' && !s.assistant),
    }));

  const waitingBubble = (() => {
    try {
      const v = JSON.parse(bubble.queued()) as { text: string }[];
      return Array.isArray(v) ? v.length : 0;
    } catch {
      return 0;
    }
  })();
  const waiting = off.queue.filter((x) => x.status === 'queued' || x.status === 'waiting');

  return (
    <ScrollView testID="bubble-settings" contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 40, paddingHorizontal: 18 }}>
      <View style={styles.header}>
        <IconButton label="Back" onPress={onBack} testID="bubble-back">
          <Icon name="back" color={colors.ink} />
        </IconButton>
        <Text style={styles.headerTitle}>Voice bubble</Text>
        <View style={{ width: 44 }} />
      </View>
      <OfflinePill style={{ marginBottom: 12 }} />

      <Preview state={state} onState={setState} />

      <Text style={styles.section}>Modes</Text>
      <GlassCard style={{ paddingVertical: 4 }}>
        <Row first title="Dictation" detail="Speak and Flo types into the field you're in. Works without internet.">
          <Toggle label="Dictation mode" value={s.dictation} onChange={(v) => set(setMode(s, 'dictation', v))} />
        </Row>
        <Row title="Assistant" detail="Ask Flo anything. Your computer answers, or the cloud when it's off.">
          <Toggle label="Assistant mode" value={s.assistant} onChange={(v) => set(setMode(s, 'assistant', v))} />
        </Row>
        <View style={[styles.stack, styles.divider, { flexDirection: 'row', gap: 10, alignItems: 'center' }]}>
          <Pressable
            testID="preset-dictation-only"
            accessibilityRole="button"
            accessibilityState={{ selected: isDictationOnly(s) }}
            onPress={() => {
              tap();
              set(dictationOnly(s));
            }}
            style={[styles.preset, isDictationOnly(s) && styles.presetOn]}
          >
            <Icon name="mic" size={16} color={isDictationOnly(s) ? colors.onPrimary : colors.ink} />
            <Text style={[styles.presetText, isDictationOnly(s) && { color: colors.onPrimary }]}>Dictation only</Text>
          </Pressable>
          <Pressable
            testID="preset-both"
            accessibilityRole="button"
            onPress={() => {
              tap();
              set({ ...s, dictation: true, assistant: true, tap: 'dictate', longPress: 'ask', doubleTap: 'none' });
            }}
            style={[styles.preset, s.dictation && s.assistant && styles.presetOn]}
          >
            <Icon name="sparkle" size={16} color={s.dictation && s.assistant ? colors.onPrimary : colors.ink} />
            <Text style={[styles.presetText, s.dictation && s.assistant && { color: colors.onPrimary }]}>Dictate + Ask</Text>
          </Pressable>
        </View>
        {!bubbleVisible(s) && <Text style={[type.small, styles.warn]}>Both modes are off, so the bubble is hidden. Turn one on to bring it back.</Text>}
      </GlassCard>

      <Text style={styles.section}>Gestures</Text>
      <GlassCard style={{ paddingVertical: 4 }}>
        {(['tap', 'longPress', 'doubleTap'] as Gesture[]).map((x, i) => (
          <Stack key={x} first={i === 0} title={GESTURE_LABEL[x]} detail={x === 'longPress' ? 'Talk while you hold, let go to finish.' : x === 'tap' ? 'Tap to start, tap again (or pause) to finish.' : undefined}>
            <Segmented testID={`gesture-${x}`} label={GESTURE_LABEL[x]} value={g[x]} options={gestureOptions()} onChange={(v) => update({ [x]: v })} />
          </Stack>
        ))}
      </GlassCard>
      <Text style={styles.footnote}>With double-tap on, a single tap waits a moment to tell them apart.</Text>

      <Text style={styles.section}>Look</Text>
      <GlassCard style={{ paddingVertical: 4 }}>
        <Stack first title="Size">
          <Segmented testID="bubble-size" label="Size" value={s.size} onChange={(size) => update({ size })} options={[{ id: 's', label: 'Small' }, { id: 'm', label: 'Medium' }, { id: 'l', label: 'Large' }]} />
        </Stack>
        <Stack title="See-through when resting">
          <Segmented
            testID="bubble-opacity"
            label="Opacity when idle"
            value={String(OPACITIES.reduce((a, b) => (Math.abs(b - s.idleOpacity) < Math.abs(a - s.idleOpacity) ? b : a)))}
            onChange={(v) => update({ idleOpacity: Number(v) })}
            options={OPACITIES.map((o) => ({ id: String(o), label: `${Math.round(o * 100)}%` }))}
          />
        </Stack>
        <Stack title="Colour">
          <View style={styles.swatches}>
            <Pressable
              testID="bubble-accent-app"
              accessibilityLabel="Same as the app"
              onPress={() => update({ accent: null })}
              style={[styles.swatch, { backgroundColor: prefs.accent ?? FLO_BLUE }, s.accent === null && styles.swatchOn]}
            >
              <Text style={styles.swatchText}>App</Text>
            </Pressable>
            {ACCENTS.map((c) => (
              <Pressable key={c} testID={`bubble-accent-${c}`} accessibilityLabel={`Colour ${c}`} onPress={() => update({ accent: c })} style={[styles.swatch, { backgroundColor: c }, s.accent === c && styles.swatchOn]} />
            ))}
          </View>
        </Stack>
        <Stack title="Side">
          <Segmented testID="bubble-side" label="Side" value={s.side} onChange={(side) => update({ side })} options={[{ id: 'left', label: 'Left' }, { id: 'auto', label: 'Where I drop it' }, { id: 'right', label: 'Right' }]} />
        </Stack>
        <Row title="Tuck into the edge" detail="After a few seconds, it slides half off the screen. Touch to bring it back.">
          <Toggle label="Tuck into the edge" value={s.tuck} onChange={(tuck) => update({ tuck })} />
        </Row>
        <Stack title="Show the bubble">
          <Segmented testID="bubble-show" label="Show the bubble" value={s.showWhen} onChange={(showWhen) => update({ showWhen })} options={[{ id: 'typing', label: 'When I type' }, { id: 'always', label: 'Always' }]} />
        </Stack>
      </GlassCard>

      <Text style={styles.section}>Speech</Text>
      <GlassCard style={{ paddingVertical: 4 }}>
        <Stack first title="Language">
          <Chips testID="bubble-lang" value={s.language} onChange={(language) => update({ language })} options={LANGUAGES.map((l) => ({ id: l.id, label: l.native ? `${l.label} · ${l.native}` : l.label }))} />
          <Text style={[type.small, { marginTop: 8 }]}>
            {s.language === 'auto'
              ? 'Your phone language. Android 14 and later also switch between English, Hindi and Gujarati as you speak.'
              : s.language === 'hinglish'
                ? 'Hindi and English mixed, typed in English letters.'
                : ' '}
          </Text>
        </Stack>
        <Stack title="Recognizer">
          <Segmented testID="bubble-engine" label="Recognizer" value={s.engine} onChange={(engine) => update({ engine })} options={[{ id: 'auto', label: 'Best (online when I can)' }, { id: 'device', label: 'Always on this phone' }]} />
          <Text style={[type.small, { marginTop: 8 }]}>{s.engine === 'device' ? 'Your voice never leaves the phone. Needs the offline pack for your language.' : 'Uses the most accurate recognizer online, and the one on your phone when you are offline.'}</Text>
        </Stack>
        <Pressable testID="open-offline-speech" accessibilityRole="button" onPress={onSpeech} style={[styles.row, styles.divider]}>
          <View style={[styles.packDot, { backgroundColor: pack === 'installed' ? colors.green : pack === 'unknown' || pack === null ? colors.inkFaint : colors.amber }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Offline speech</Text>
            <Text style={type.small}>{pack ? `${PACK_LABEL[pack]} for ${LANGUAGES.find((l) => l.id === s.language)?.label ?? 'your language'}` : 'See which languages work without internet'}</Text>
          </View>
          <Icon name="chevron" size={18} color={colors.inkMuted} />
        </Pressable>
        <Row title="Show words as you speak" detail="A small caption next to the bubble.">
          <Toggle label="Live transcript preview" value={s.preview} onChange={(preview) => update({ preview })} />
        </Row>
      </GlassCard>

      <Text style={styles.section}>Typing</Text>
      <GlassCard style={{ paddingVertical: 4 }}>
        <Stack first title="Put the words in by" detail={s.insert === 'type' ? 'Typing them at the cursor. Falls back to paste in apps that need it.' : 'Pasting them (copies to your clipboard first).'}>
          <Segmented testID="bubble-insert" label="Insert behaviour" value={s.insert} onChange={(insert) => update({ insert })} options={[{ id: 'type', label: 'Typing' }, { id: 'paste', label: 'Pasting' }]} />
        </Stack>
      </GlassCard>

      <Text style={styles.section}>Feedback</Text>
      <GlassCard style={{ paddingVertical: 4 }}>
        <Row first title="Haptics" detail="A light tap when it starts, finishes or snaps to the edge.">
          <Toggle label="Bubble haptics" value={s.haptics} onChange={(haptics) => update({ haptics })} />
        </Row>
        <Row title="Sounds" detail="A soft tone when it starts and finishes listening.">
          <Toggle label="Bubble sounds" value={s.sounds} onChange={(sounds) => update({ sounds })} />
        </Row>
      </GlassCard>

      <Text style={styles.section}>Hide in apps</Text>
      <GlassCard style={{ padding: 16 }}>
        {s.hiddenApps.length ? (
          <View style={styles.appChips}>
            {s.hiddenApps.map((pkg) => (
              <Pressable key={pkg} accessibilityRole="button" accessibilityLabel={`Show in ${labels[pkg] ?? pkg}`} onPress={() => set(toggleHiddenApp(s, pkg))} style={styles.appChip}>
                <Text style={styles.appChipText} numberOfLines={1}>
                  {labels[pkg] ?? pkg}
                </Text>
                <Icon name="close" size={14} color={colors.inkMuted} />
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={type.small}>The bubble shows in every app. Pick apps where you'd rather not see it, like games or banking.</Text>
        )}
        <GlassButton compact label="Choose apps" icon={<Icon name="plus" size={16} color={colors.ink} />} onPress={() => setPicker(true)} style={{ marginTop: 12, alignSelf: 'flex-start' }} testID="choose-apps" />
      </GlassCard>

      <Text style={styles.section}>After a restart</Text>
      <GlassCard style={{ paddingVertical: 4 }}>
        <Row first title="Start on boot" detail={s.startOnBoot ? 'The bubble is back as soon as your phone restarts.' : 'After a restart, the bubble waits until you open Flo once.'}>
          <Toggle label="Start on boot" value={s.startOnBoot} onChange={(startOnBoot) => update({ startOnBoot })} />
        </Row>
      </GlassCard>

      {(waiting.length > 0 || waitingBubble > 0) && (
        <>
          <Text style={styles.section}>Waiting to send</Text>
          <GlassCard style={{ paddingVertical: 4 }}>
            {waiting.map((x, i) => (
              <View key={x.id} style={[styles.histRow, i > 0 && styles.divider]}>
                <Icon name="refresh" size={17} color={colors.amber} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.histText}>{x.text}</Text>
                  <Text style={type.small}>{statusLine(x)}</Text>
                </View>
              </View>
            ))}
            {waitingBubble > 0 && (
              <View style={[styles.histRow, waiting.length > 0 && styles.divider]}>
                <Icon name="refresh" size={17} color={colors.amber} />
                <Text style={[type.small, { flex: 1 }]}>
                  {waitingBubble === 1 ? '1 question' : `${waitingBubble} questions`} from the bubble. It sends them as soon as you're back online and the answer comes as a notification.
                </Text>
              </View>
            )}
          </GlassCard>
        </>
      )}

      <Text style={styles.section}>Recent from the bubble</Text>
      <GlassCard style={{ paddingVertical: 4 }}>
        {off.history.length === 0 ? (
          <Text style={[type.small, { padding: 16 }]}>Your last dictations and answers show here, so nothing you say is lost. Saved only on this phone.</Text>
        ) : (
          off.history.slice(0, 12).map((h, i) => (
            <View key={`${h.at}-${i}`} style={[styles.histRow, i > 0 && styles.divider]}>
              <Icon name={h.kind === 'ask' ? 'sparkle' : h.kind === 'queued' ? 'refresh' : h.kind === 'error' ? 'info' : 'mic'} size={17} color={h.kind === 'error' ? colors.danger : h.kind === 'queued' ? colors.amber : colors.sky} />
              <View style={{ flex: 1 }}>
                <Text style={styles.histText}>{h.text}</Text>
                {!!h.answer && <Text style={[type.small, { color: colors.inkSoft, marginTop: 3 }]}>{h.answer}</Text>}
                <Text style={[type.small, { marginTop: 3 }]}>
                  {HISTORY_LABEL[h.kind]}
                  {h.cloud ? ' in the cloud' : ''} · {relativeTime(new Date(h.at).toISOString())}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Copy"
                hitSlop={8}
                onPress={() => {
                  tap();
                  void Clipboard.setStringAsync(h.answer ?? h.text);
                  setCopied(i);
                  setTimeout(() => setCopied(null), 1400);
                }}
                style={styles.copy}
              >
                <Icon name={copied === i ? 'check' : 'copy'} size={16} color={copied === i ? colors.green : colors.inkMuted} />
              </Pressable>
            </View>
          ))
        )}
      </GlassCard>
      {off.history.length > 0 && <GlassButton compact label="Clear recent" onPress={off.clearHistory} style={{ marginTop: 10, alignSelf: 'flex-start' }} />}

      <Text style={styles.footnote}>Saved on this phone and applied to the bubble right away. Nothing here is sent to your computer.</Text>
      <AppPicker visible={picker} onClose={() => setPicker(false)} />
    </ScrollView>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    headerTitle: { fontFamily: fonts.semibold, fontSize: 18, color: colors.ink },
    section: { ...type.micro, marginTop: 26, marginBottom: 10, marginLeft: 6 },
    footnote: { ...type.small, marginTop: 10, marginHorizontal: 6, color: colors.inkFaint },
    row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 13 },
    stack: { paddingHorizontal: 16, paddingVertical: 13 },
    divider: { borderTopWidth: 1, borderTopColor: colors.hairline },
    rowTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: colors.ink, letterSpacing: -0.2 },
    warn: { color: colors.amber, paddingHorizontal: 16, paddingBottom: 12 },
    previewCard: { padding: 12 },
    phone: { height: 214, borderRadius: 20, overflow: 'hidden', padding: 14, gap: 9 },
    fakeTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    fakeAvatar: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.18)' },
    fakeLine: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.22)' },
    fakeMsg: { height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.1)' },
    fakeMsgLight: { backgroundColor: '#e6ebf5' },
    fakeField: { position: 'absolute', left: 14, right: 14, bottom: 12, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', justifyContent: 'center', paddingHorizontal: 14 },
    fakeFieldText: { fontFamily: fonts.medium, fontSize: 13, color: 'rgba(255,255,255,0.38)' },
    orbSpot: { position: 'absolute', top: 88 },
    hiddenNote: { position: 'absolute', top: 100, alignSelf: 'center', left: 20, right: 20, textAlign: 'center', fontFamily: fonts.medium, fontSize: 13, color: 'rgba(255,255,255,0.7)' },
    caption: { position: 'absolute', top: 92, maxWidth: '62%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: 'rgba(11,18,32,0.92)' },
    captionText: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 17, color: '#fff' },
    stateRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 12 },
    stateChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999 },
    stateChipOn: { backgroundColor: colors.glassStrong, borderWidth: 1, borderColor: colors.glassBorder },
    stateText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.inkMuted },
    preset: { flex: 1, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', minHeight: 40, borderRadius: 999, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder, paddingHorizontal: 10 },
    presetOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    presetText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
    swatchOn: { borderColor: colors.ink, transform: [{ scale: 1.08 }] },
    swatchText: { fontFamily: fonts.bold, fontSize: 10, color: '#fff' },
    packDot: { width: 10, height: 10, borderRadius: 5, marginHorizontal: 4 },
    appChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    appChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 9, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.glassStrong, borderWidth: 1, borderColor: colors.glassBorder, maxWidth: '100%' },
    appChipText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink, flexShrink: 1 },
    histRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
    histText: { fontFamily: fonts.medium, fontSize: 14.5, lineHeight: 20, color: colors.ink },
    copy: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    sheetBack: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,10,25,0.45)' },
    sheet: { backgroundColor: colors.bgElevated, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 16, paddingTop: 16 },
    sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    sheetTitle: { fontFamily: fonts.semibold, fontSize: 17, color: colors.ink },
    search: { fontFamily: fonts.medium, fontSize: 15, color: colors.ink, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.dark ? 'rgba(255,255,255,0.06)' : 'rgba(20,30,60,0.05)', marginBottom: 8 },
    appRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    appBadge: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.glassStrong, borderWidth: 1, borderColor: colors.hairline },
    appLetter: { fontFamily: fonts.bold, fontSize: 15, color: colors.inkSoft },
    check: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: colors.inkFaint, alignItems: 'center', justifyContent: 'center' },
    checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  }),
);
