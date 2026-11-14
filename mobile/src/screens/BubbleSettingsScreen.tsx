// Settings > Voice bubble: a live preview, then how it looks (style, size, colour, see-through),
// where it sits and how it moves, modes and gestures, speech (language, recognizer, cleanup, your
// words), typing, feedback, the apps it shows in, plus its Recent list. Saved on this phone and
// applied to the bubble over other apps the moment anything changes.
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useState } from 'react';
import { AppState, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mockOrbState } from '../api/mock';
import { HISTORY_LABEL, bubble } from '../lib/bubble';
import {
  ACTION_LABEL,
  AUTO_HIDE,
  BUBBLE_SIZES,
  DEFAULT_BUBBLE,
  FLO_BLUE,
  GESTURE_LABEL,
  GESTURES,
  LANGUAGES,
  OPACITY_MIN,
  ORB_PAD,
  PALETTES,
  SIZE_MAX,
  SIZE_MIN,
  STYLES,
  TUCK_DELAYS,
  WORDS_MAX,
  appList,
  bodySize,
  bubbleVisible,
  cleanWords,
  companion,
  dictationOnly,
  effectiveGestures,
  gestureSummary,
  isDictationOnly,
  resolveColors,
  setMode,
  sizeDp,
  toggleApp,
  type BubbleAction,
  type BubbleSettings,
  type BubbleSize,
  type ColorTheme,
  type Gesture,
} from '../lib/bubbleSettings';
import { cleanDictation } from '../lib/cleanup';
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
import { Slider } from '../ui/Slider';
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

const GESTURE_HELP: Record<Gesture, string> = {
  tap: 'Tap to start. It stops when you pause, or when you tap again.',
  longPress: 'Talk while you hold, let go to finish.',
  doubleTap: 'Two quick taps. A single tap then waits a moment to tell them apart.',
  swipe: 'A quick flick away from the edge. A slow drag still moves it.',
};

const THEME_ORDER: ColorTheme[] = ['app', 'desktop', 'flo', 'aurora', 'sunset', 'mint', 'ember', 'graphite'];

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

function Stack({ title, detail, children, first, right }: { title: string; detail?: string; children: React.ReactNode; first?: boolean; right?: React.ReactNode }) {
  return (
    <View style={[styles.stack, !first && styles.divider]}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={[styles.rowTitle, { flex: 1 }]}>{title}</Text>
        {right}
      </View>
      {!!detail && <Text style={[type.small, { marginTop: 2 }]}>{detail}</Text>}
      <View style={{ marginTop: 10 }}>{children}</View>
    </View>
  );
}

/** A small phone screen with the bubble on its edge, in the chosen look, colour, size and state. */
function Preview({ state, onState }: { state: PreviewState; onState: (s: PreviewState) => void }) {
  const { settings: s, accent, accent2 } = useBubbleSettings();
  const g = effectiveGestures(s);
  const orbState: OrbState = state === 'offline' || state === 'tucked' ? 'idle' : state;
  const mode = state === 'thinking' && g.tap !== 'ask' && g.longPress === 'ask' ? 'ask' : 'dictate';
  const right = s.side !== 'left';
  const tucked = state === 'tucked' && s.tuck && s.snap === 'edge';
  const d = colors.dark;
  const size = sizeDp(s);
  const { w: bw, h: bh } = bodySize(s.style, size);
  const W = bw + 2 * ORB_PAD;
  const H = bh + 2 * ORB_PAD;
  // as FloBubble: the window overhangs the edge so the body rests 5dp from it; tucked slides half off
  const rest = -(ORB_PAD - 5);
  const edge = tucked ? rest - (bw / 2 + 5) : rest;
  const free = s.snap === 'free';
  const side = free ? 28 : edge;
  const caption = state === 'listening' && !s.preview ? undefined : SAMPLE[state];
  const capSide = (free ? 28 + ORB_PAD : 5) + bw + 10;
  const top = 108 - H / 2;
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
          <View style={[styles.orbSpot, { top, width: W, height: H, opacity: orbState === 'idle' ? s.idleOpacity : 1 }, right ? { right: side } : { left: side }]}>
            <OrbPreview look={s.style} size={size} accent={accent} accent2={accent2} state={orbState} mode={mode} offline={state === 'offline'} testID="bubble-orb" />
          </View>
        ) : (
          <Text style={styles.hiddenNote}>Both modes are off, so the bubble is hidden.</Text>
        )}
        {!!caption && bubbleVisible(s) && (
          <View style={[styles.captionSpot, { top, height: H }, right ? { right: capSide } : { left: capSide }]} pointerEvents="none">
            <View style={[styles.caption, state === 'error' && { backgroundColor: 'rgba(80,16,24,0.92)' }]}>
              <Text style={styles.captionText} numberOfLines={3}>
                {caption}
              </Text>
            </View>
          </View>
        )}
      </LinearGradient>
      <View style={styles.stateRow}>
        {STATES.map((x) => (
          <Pressable
            key={x.id}
            testID={`orb-${x.id}`}
            accessibilityRole="button"
            accessibilityState={{ selected: state === x.id }}
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
      {bubbleVisible(s) && <Text style={[type.small, { textAlign: 'center', marginTop: 10 }]}>{gestureSummary(s, '   ·   ')}</Text>}
    </GlassCard>
  );
}

/** Five looks, each drawn by the same renderer as the preview. */
function StylePicker({ s, accent, accent2, onPick }: { s: BubbleSettings; accent: string; accent2: string; onPick: (id: BubbleSettings['style']) => void }) {
  const { width } = useWindowDimensions();
  // three across on small phones, five across from ~400dp
  const perRow = width >= 400 ? 5 : 3;
  return (
    <View style={styles.tiles}>
      {STYLES.map((x) => {
        const on = s.style === x.id;
        return (
          <Pressable
            key={x.id}
            testID={`bubble-style-${x.id}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${x.label}: ${x.detail}`}
            onPress={() => {
              tap();
              onPick(x.id);
            }}
            style={[styles.tile, { width: `${100 / perRow - 3}%` }, on && styles.tileOn]}
          >
            <View style={styles.tileArt}>
              <OrbPreview look={x.id} size={34} pad={6} accent={accent} accent2={accent2} animate={false} />
            </View>
            <Text style={[styles.tileText, on && { color: colors.ink }]}>{x.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ThemeSwatch({ id, label, from, to, on, disabled, onPress }: { id: string; label: string; from: string; to: string; on: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      testID={`bubble-theme-${id}`}
      accessibilityRole="radio"
      accessibilityState={{ selected: on, disabled: !!disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        tap();
        onPress();
      }}
      style={[styles.themeItem, disabled && { opacity: 0.4 }]}
    >
      <View style={[styles.themeRing, on && { borderColor: colors.ink }]}>
        <LinearGradient colors={[from, to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.themeDot} />
      </View>
      <Text style={[styles.themeLabel, on && { color: colors.ink }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
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
  const list = appList(settings);
  const only = settings.appsMode === 'only';
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.sheetBack}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]} testID="app-picker">
          <View style={styles.grabber} />
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{only ? 'Show the bubble only in' : 'Hide the bubble in'}</Text>
            <GlassButton compact label="Done" onPress={onClose} testID="app-picker-done" />
          </View>
          <TextInput value={q} onChangeText={setQ} placeholder="Search apps" placeholderTextColor={colors.inkFaint} style={styles.search} />
          <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
            {apps === null && <Text style={[type.small, { padding: 16 }]}>Loading your apps…</Text>}
            {apps?.length === 0 && <Text style={[type.small, { padding: 16 }]}>No apps found.</Text>}
            {shown.map((a) => {
              const on = list.includes(a.pkg);
              return (
                <Pressable
                  key={a.pkg}
                  testID={`app-${a.pkg}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => {
                    tap();
                    set(toggleApp(settings, a.pkg));
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

/** Names and words the recognizer should lean toward, and how to spell them. */
function WordsEditor({ words, onChange }: { words: string[]; onChange: (w: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const next = cleanWords([...words, ...draft.split(',')]);
    if (next.length !== words.length) tap();
    onChange(next);
    setDraft('');
  };
  return (
    <View>
      {words.length > 0 && (
        <View style={[styles.appChips, { marginBottom: 10 }]}>
          {words.map((w) => (
            <Pressable key={w} accessibilityRole="button" accessibilityLabel={`Remove ${w}`} onPress={() => onChange(words.filter((x) => x !== w))} style={styles.appChip}>
              <Text style={styles.appChipText} numberOfLines={1}>
                {w}
              </Text>
              <Icon name="close" size={14} color={colors.inkMuted} />
            </Pressable>
          ))}
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput
          testID="bubble-word-input"
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          placeholder={words.length >= WORDS_MAX ? 'That’s the most Flo can take' : 'Priya, Figma, Ahmedabad…'}
          editable={words.length < WORDS_MAX}
          placeholderTextColor={colors.inkFaint}
          returnKeyType="done"
          autoCorrect={false}
          style={[styles.search, { flex: 1, marginBottom: 0 }]}
        />
        <GlassButton compact label="Add" onPress={add} disabled={!draft.trim()} testID="bubble-word-add" />
      </View>
    </View>
  );
}

export function BubbleSettingsScreen({ onBack, onSpeech }: { onBack: () => void; onSpeech: () => void }) {
  const insets = useSafeAreaInsets();
  const { settings: s, update, set, accent, accent2 } = useBubbleSettings();
  const { prefs } = usePrefs();
  const off = useOffline();
  const start = mockOrbState();
  const [state, setState] = useState<PreviewState>(() => (STATES.some((x) => x.id === start) ? (start as PreviewState) : 'idle'));
  const [picker, setPicker] = useState(false);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [pack, setPack] = useState<PackStatus | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [moved, setMoved] = useState(false);
  const [trial, setTrial] = useState('um so the the deck is ready comma can you check it question mark');
  const [battery, setBattery] = useState<boolean | null>(() => bubble.batteryUnrestricted());
  const g = effectiveGestures(s);
  const list = appList(s);
  const size = sizeDp(s);
  const appAccent = prefs.accent ?? FLO_BLUE;

  useEffect(() => {
    if (!list.length) return;
    void bubble.launchableApps().then((a) => setLabels(Object.fromEntries(a.map((x) => [x.pkg, x.label]))));
  }, [list.length]);

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

  // back from the phone's battery settings: check again
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') setBattery(bubble.batteryUnrestricted());
    });
    return () => sub.remove();
  }, []);

  const gestureOptions = () =>
    (['dictate', 'ask', 'openFlo', 'hide', 'none'] as BubbleAction[]).map((a) => ({
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

  const themeColors = (id: ColorTheme) => {
    const c = resolveColors({ ...s, theme: id }, prefs.accent);
    return { from: c.accent, to: c.accent2 };
  };
  const themeLabel = (id: ColorTheme) => (id === 'app' ? 'App' : id === 'desktop' ? 'Computer' : id === 'custom' ? 'Custom' : PALETTES[id].label);

  const sizePreset: BubbleSize | null = s.customSize === null ? s.size : (Object.keys(BUBBLE_SIZES) as BubbleSize[]).find((k) => BUBBLE_SIZES[k] === s.customSize) ?? null;
  const trialOut = cleanDictation(trial, { lang: null, punctuation: s.punctuation, words: s.words });

  return (
    <ScrollView testID="bubble-settings" keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 40 }]}>
      <View style={styles.header}>
        <IconButton label="Back" onPress={onBack} testID="bubble-back">
          <Icon name="back" color={colors.ink} />
        </IconButton>
        <Text style={styles.headerTitle}>Voice bubble</Text>
        <View style={{ width: 44 }} />
      </View>
      <OfflinePill style={{ marginBottom: 12 }} />

      <Preview state={state} onState={setState} />

      {/* ── look ── */}
      <Text style={styles.section}>Look</Text>
      <GlassCard style={{ paddingVertical: 4 }}>
        <Stack first title="Style">
          <StylePicker s={s} accent={accent} accent2={accent2} onPick={(style) => update({ style })} />
        </Stack>
        <Stack title="Size" right={<Text style={styles.value}>{size} dp</Text>}>
          <Segmented
            testID="bubble-size"
            label="Size"
            value={sizePreset ?? ('custom' as BubbleSize)}
            onChange={(v) => update({ size: v, customSize: null })}
            options={[
              { id: 's', label: 'Small' },
              { id: 'm', label: 'Medium' },
              { id: 'l', label: 'Large' },
            ]}
          />
          <View style={{ marginTop: 8 }}>
            <Slider
              testID="bubble-size-slider"
              label="Bubble size"
              value={size}
              min={SIZE_MIN}
              max={SIZE_MAX}
              step={2}
              format={(v) => `${v} dp`}
              onChange={(v) => {
                const preset = (Object.keys(BUBBLE_SIZES) as BubbleSize[]).find((k) => BUBBLE_SIZES[k] === v);
                update(preset ? { size: preset, customSize: null } : { customSize: v });
              }}
              color={accent}
            />
          </View>
        </Stack>
        <Stack title="Colour" detail={s.theme === 'desktop' && !s.desktopAccent ? 'Your computer hasn’t shared its colour yet, so this uses the app’s for now.' : undefined}>
          <View style={styles.themes}>
            {THEME_ORDER.map((id) => {
              const c = themeColors(id);
              return <ThemeSwatch key={id} id={id} label={themeLabel(id)} from={c.from} to={c.to} on={s.theme === id} onPress={() => update({ theme: id })} />;
            })}
          </View>
          <Text style={[type.small, { marginTop: 12, marginBottom: 8 }]}>Or one colour</Text>
          <View style={styles.swatches}>
            {ACCENTS.map((c) => {
              const on = s.theme === 'custom' && (s.accent ?? FLO_BLUE) === c;
              return (
                <Pressable
                  key={c}
                  testID={`bubble-accent-${c}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Colour ${c}`}
                  onPress={() => {
                    tap();
                    update({ theme: 'custom', accent: c });
                  }}
                  style={[styles.swatch, on && styles.swatchOn]}
                >
                  <LinearGradient colors={[c, companion(c)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.swatchFill} />
                </Pressable>
              );
            })}
          </View>
          {s.theme === 'app' && <Text style={[type.small, { marginTop: 8 }]}>Follows the app’s accent ({appAccent}). Change it in Settings, Customize.</Text>}
        </Stack>
        <Stack title="See-through when resting" right={<Text style={styles.value}>{Math.round(s.idleOpacity * 100)}%</Text>}>
          <Slider
            testID="bubble-opacity"
            label="Opacity when idle"
            value={Math.round(s.idleOpacity * 100)}
            min={Math.round(OPACITY_MIN * 100)}
            max={100}
            step={5}
            format={(v) => `${v}%`}
            onChange={(v) => update({ idleOpacity: v / 100 })}
            color={accent}
          />
        </Stack>
      </GlassCard>

      {/* ── place and motion ── */}
      <Text style={styles.section}>Position and motion</Text>
      <GlassCard style={{ paddingVertical: 4 }}>
        <Stack first title="When you let go">
          <Segmented testID="bubble-snap" label="Snapping" value={s.snap} onChange={(snap) => update({ snap })} options={[{ id: 'edge', label: 'Snap to edge' }, { id: 'free', label: 'Stay put' }]} />
        </Stack>
        {s.snap === 'edge' && (
          <Stack title="Side">
            <Segmented testID="bubble-side" label="Side" value={s.side} onChange={(side) => update({ side })} options={[{ id: 'left', label: 'Left' }, { id: 'auto', label: 'Nearest' }, { id: 'right', label: 'Right' }]} />
          </Stack>
        )}
        {s.snap === 'edge' && (
          <Row title="Tuck into the edge" detail="When idle it slides half off the screen. Touch to bring it back.">
            <Toggle label="Tuck into the edge" value={s.tuck} onChange={(tuck) => update({ tuck })} />
          </Row>
        )}
        {s.snap === 'edge' && s.tuck && (
          <Stack title="Tuck after">
            <Chips testID="bubble-tuck-delay" value={String(s.tuckDelay)} onChange={(v) => update({ tuckDelay: Number(v) })} options={TUCK_DELAYS.map((x) => ({ id: String(x), label: `${x} s` }))} />
          </Stack>
        )}
        <Stack title="Hide when idle" detail={s.autoHide ? 'It comes back the next time you tap a text field.' : 'It stays until you leave the text field.'}>
          <Chips testID="bubble-autohide" value={String(s.autoHide)} onChange={(v) => update({ autoHide: Number(v) })} options={AUTO_HIDE.map((x) => ({ id: String(x), label: x === 0 ? 'Never' : x < 60 ? `After ${x} s` : 'After 1 min' }))} />
        </Stack>
        <Stack title="Show the bubble">
          <Segmented testID="bubble-show" label="Show the bubble" value={s.showWhen} onChange={(showWhen) => update({ showWhen })} options={[{ id: 'typing', label: 'When I type' }, { id: 'always', label: 'Always' }]} />
        </Stack>
        <Row title="Remember where I put it" detail={s.rememberPosition ? 'It comes back to the same spot, even after you rotate the phone.' : 'It always starts at the same spot on the right.'}>
          <Toggle label="Remember position" value={s.rememberPosition} onChange={(rememberPosition) => update({ rememberPosition })} />
        </Row>
        <View style={[styles.stack, styles.divider, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
          <Text style={[type.small, { flex: 1 }]}>{moved ? 'Moved back to the starting spot.' : 'Lost it off-screen, or want a fresh start?'}</Text>
          <GlassButton
            compact
            label="Reset position"
            icon={<Icon name={moved ? 'check' : 'refresh'} size={15} color={moved ? colors.green : colors.ink} />}
            onPress={() => {
              tap();
              bubble.resetPosition();
              setMoved(true);
              setTimeout(() => setMoved(false), 2200);
            }}
            testID="bubble-reset-position"
          />
        </View>
      </GlassCard>

      {/* ── modes ── */}
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
            <Text style={[styles.presetText, isDictationOnly(s) && { color: colors.onPrimary }]} numberOfLines={1}>
              Dictation only
            </Text>
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
            <Text style={[styles.presetText, s.dictation && s.assistant && { color: colors.onPrimary }]} numberOfLines={1}>
              Dictate + Ask
            </Text>
          </Pressable>
        </View>
        {!bubbleVisible(s) && <Text style={[type.small, styles.warn]}>Both modes are off, so the bubble is hidden. Turn one on to bring it back.</Text>}
      </GlassCard>

      <Text style={styles.section}>Gestures</Text>
      <GlassCard style={{ paddingVertical: 4 }}>
        {GESTURES.map((x, i) => (
          <Stack key={x} first={i === 0} title={GESTURE_LABEL[x]} detail={GESTURE_HELP[x]}>
            <Chips testID={`gesture-${x}`} value={g[x]} options={gestureOptions()} onChange={(v) => update({ [x]: v })} />
          </Stack>
        ))}
      </GlassCard>
      <Text style={styles.footnote}>Hide puts the bubble away in the app you're in until you switch apps. A mode that's on always keeps a gesture.</Text>

      {/* ── speech ── */}
      <Text style={styles.section}>Speech</Text>
      <GlassCard style={{ paddingVertical: 4 }}>
        <Stack first title="Language">
          <Chips testID="bubble-lang" value={s.language} onChange={(language) => update({ language })} options={LANGUAGES.map((l) => ({ id: l.id, label: l.native ? `${l.label} · ${l.native}` : l.label }))} />
          <Text style={[type.small, { marginTop: 8 }]}>
            {s.language === 'auto'
              ? 'Your phone language. Android 14 and later also switch between English, Hindi and Gujarati as you speak.'
              : s.language === 'hinglish'
                ? 'Hindi and English mixed, typed in English letters.'
                : s.language === 'hi-IN'
                  ? 'Typed in Devanagari, ending sentences with ।'
                  : s.language === 'gu-IN'
                    ? 'Typed in Gujarati script.'
                    : 'Spelling and punctuation for this English.'}
          </Text>
        </Stack>
        <Stack title="Recognizer">
          <Segmented testID="bubble-engine" label="Recognizer" value={s.engine} onChange={(engine) => update({ engine })} options={[{ id: 'auto', label: 'Most accurate' }, { id: 'device', label: 'Only on this phone' }]} />
          <Text style={[type.small, { marginTop: 8 }]}>
            {s.engine === 'device' ? 'Your voice never leaves the phone. Needs the offline pack for your language.' : 'Google’s best recognizer while you’re online, the one on your phone when you’re not.'}
          </Text>
        </Stack>
        <Stack title="Stop listening">
          <Segmented testID="bubble-stop" label="Stop listening" value={s.stopOn} onChange={(stopOn) => update({ stopOn })} options={[{ id: 'pause', label: 'When I pause' }, { id: 'tap', label: 'When I tap again' }]} />
          <Text style={[type.small, { marginTop: 8 }]}>
            {s.stopOn === 'tap' ? 'Long messages: pauses to think never cut you off. Holding always works this way.' : 'Quick messages: it finishes a moment after you stop talking.'}
          </Text>
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

      <Text style={styles.section}>Clean up what I say</Text>
      <GlassCard style={{ paddingVertical: 4 }}>
        <Row first title="Smart cleanup" detail="Drops um and uh, stutters and anything before “scratch that”. Say “comma”, “full stop”, “question mark” or “new line”. Capitals where they belong.">
          <Toggle label="Smart cleanup" value={s.cleanup} onChange={(cleanup) => update({ cleanup })} />
        </Row>
        <Row title="Punctuation" detail="Commas and full stops from the recognizer, and a full stop at the end of longer messages.">
          <Toggle label="Automatic punctuation" value={s.punctuation} onChange={(punctuation) => update({ punctuation })} />
        </Row>
        {s.cleanup && (
          <Stack title="Try it">
            <TextInput testID="bubble-cleanup-try" value={trial} onChangeText={setTrial} multiline placeholderTextColor={colors.inkFaint} style={[styles.search, { marginBottom: 8, minHeight: 44 }]} />
            <View style={styles.trialOut}>
              <Icon name="check" size={15} color={colors.green} />
              <Text style={[styles.histText, { flex: 1 }]} testID="bubble-cleanup-result">
                {trialOut || ' '}
              </Text>
            </View>
          </Stack>
        )}
        <Stack title="Your words" detail="Names, places and terms. Flo listens for them and spells them your way.">
          <WordsEditor words={s.words} onChange={(words) => update({ words })} />
        </Stack>
      </GlassCard>

      <Text style={styles.section}>Typing</Text>
      <GlassCard style={{ paddingVertical: 4 }}>
        <Stack first title="Put the words in by" detail={s.insert === 'type' ? 'Typing them at the cursor, with a capital or a space where the text around needs one. Falls back to paste in apps that need it.' : 'Pasting them (copies to your clipboard first).'}>
          <Segmented testID="bubble-insert" label="Insert behaviour" value={s.insert} onChange={(insert) => update({ insert })} options={[{ id: 'type', label: 'Typing' }, { id: 'paste', label: 'Pasting' }]} />
        </Stack>
      </GlassCard>

      <Text style={styles.section}>Feedback</Text>
      <GlassCard style={{ paddingVertical: 4 }}>
        <Row first title="Haptics" detail="A tap when it starts, finishes or snaps to the edge.">
          <Toggle label="Bubble haptics" value={s.haptics} onChange={(haptics) => update({ haptics })} />
        </Row>
        {s.haptics && (
          <Stack title="Strength">
            <Segmented testID="bubble-haptic-strength" label="Haptic strength" value={s.hapticStrength} onChange={(hapticStrength) => update({ hapticStrength })} options={[{ id: 'light', label: 'Light' }, { id: 'strong', label: 'Strong' }]} />
          </Stack>
        )}
        <Row title="Sounds" detail="A soft tone when it starts and finishes listening.">
          <Toggle label="Bubble sounds" value={s.sounds} onChange={(sounds) => update({ sounds })} />
        </Row>
      </GlassCard>

      <Text style={styles.section}>Apps</Text>
      <GlassCard style={{ padding: 16 }}>
        <Segmented testID="bubble-apps-mode" label="Which apps" value={s.appsMode} onChange={(appsMode) => update({ appsMode })} options={[{ id: 'except', label: 'All apps except…' }, { id: 'only', label: 'Only in…' }]} />
        <View style={{ marginTop: 12 }}>
          {list.length ? (
            <View style={styles.appChips}>
              {list.map((pkg) => (
                <Pressable key={pkg} accessibilityRole="button" accessibilityLabel={`Remove ${labels[pkg] ?? pkg}`} onPress={() => set(toggleApp(s, pkg))} style={styles.appChip}>
                  <Text style={styles.appChipText} numberOfLines={1}>
                    {labels[pkg] ?? pkg}
                  </Text>
                  <Icon name="close" size={14} color={colors.inkMuted} />
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={type.small}>
              {s.appsMode === 'only' ? 'Pick the apps where the bubble should show. Until you do, it shows nowhere.' : "The bubble shows in every app. Pick apps where you'd rather not see it, like games or banking."}
            </Text>
          )}
        </View>
        <GlassButton compact label="Choose apps" icon={<Icon name="plus" size={16} color={colors.ink} />} onPress={() => setPicker(true)} style={{ marginTop: 12, alignSelf: 'flex-start' }} testID="choose-apps" />
      </GlassCard>

      <Text style={styles.section}>Keep it running</Text>
      <GlassCard style={{ paddingVertical: 4 }}>
        <Row first title="Start on boot" detail={s.startOnBoot ? 'The bubble is back as soon as your phone restarts.' : 'After a restart, the bubble waits until you open Flo once.'}>
          <Toggle label="Start on boot" value={s.startOnBoot} onChange={(startOnBoot) => update({ startOnBoot })} />
        </Row>
        {battery === false && (
          <View style={[styles.stack, styles.divider]} testID="bubble-battery">
            <Text style={styles.rowTitle}>Battery saving may stop the bubble</Text>
            <Text style={[type.small, { marginTop: 2 }]}>Some phones switch off helpers like the bubble to save power. Set Flo's battery use to Unrestricted (or Don't optimise) so it stays on.</Text>
            <GlassButton compact label="Open battery settings" onPress={() => bubble.openBatterySettings()} style={{ marginTop: 10, alignSelf: 'flex-start' }} testID="bubble-battery-open" />
          </View>
        )}
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
                <Text style={styles.histText} selectable>
                  {h.text}
                </Text>
                {!!h.answer && (
                  <Text style={[type.small, { color: colors.inkSoft, marginTop: 3 }]} selectable>
                    {h.answer}
                  </Text>
                )}
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

      <GlassButton
        compact
        label="Reset look and behaviour"
        icon={<Icon name="refresh" size={15} color={colors.ink} />}
        onPress={() => {
          tap();
          // keep what you typed in: your apps lists, your words and your computer's colour
          set({ ...DEFAULT_BUBBLE, hiddenApps: s.hiddenApps, onlyApps: s.onlyApps, words: s.words, desktopAccent: s.desktopAccent });
        }}
        style={{ marginTop: 26, alignSelf: 'center' }}
        testID="bubble-reset-all"
      />
      <Text style={styles.footnote}>Saved on this phone and applied to the bubble right away. Nothing here is sent to your computer.</Text>
      <AppPicker visible={picker} onClose={() => setPicker(false)} />
    </ScrollView>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    // phones use the full width; tablets and unfolded foldables get a readable column
    content: { paddingHorizontal: 18, width: '100%', maxWidth: 720, alignSelf: 'center' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    headerTitle: { fontFamily: fonts.semibold, fontSize: 18, color: colors.ink },
    section: { ...type.micro, marginTop: 26, marginBottom: 10, marginLeft: 6 },
    footnote: { ...type.small, marginTop: 10, marginHorizontal: 6, color: colors.inkFaint, textAlign: 'left' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 13 },
    stack: { paddingHorizontal: 16, paddingVertical: 13 },
    divider: { borderTopWidth: 1, borderTopColor: colors.hairline },
    rowTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: colors.ink, letterSpacing: -0.2 },
    value: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.inkMuted, fontVariant: ['tabular-nums'] },
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
    orbSpot: { position: 'absolute' },
    hiddenNote: { position: 'absolute', top: 100, alignSelf: 'center', left: 20, right: 20, textAlign: 'center', fontFamily: fonts.medium, fontSize: 13, color: colors.dark ? 'rgba(255,255,255,0.7)' : colors.inkMuted },
    captionSpot: { position: 'absolute', maxWidth: '62%', justifyContent: 'center' },
    caption: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: 'rgba(11,18,32,0.92)' },
    captionText: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 17, color: '#fff' },
    stateRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 12 },
    stateChip: { paddingHorizontal: 11, paddingVertical: 6, minHeight: 32, justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: 'transparent' },
    stateChipOn: { backgroundColor: colors.glassStrong, borderColor: colors.glassBorder },
    stateText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.inkMuted },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' },
    tile: { alignItems: 'center', paddingVertical: 8, borderRadius: 16, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.dark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.5)' },
    tileOn: { borderColor: colors.sky, backgroundColor: colors.dark ? 'rgba(47,140,255,0.12)' : 'rgba(47,140,255,0.08)' },
    tileArt: { height: 66, alignItems: 'center', justifyContent: 'center' },
    tileText: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.inkMuted, marginTop: 2 },
    themes: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12, columnGap: 6 },
    themeItem: { width: 64, alignItems: 'center' },
    themeRing: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: 'transparent', padding: 3 },
    themeDot: { flex: 1, borderRadius: 18 },
    themeLabel: { fontFamily: fonts.medium, fontSize: 11.5, color: colors.inkMuted, marginTop: 4 },
    preset: { flex: 1, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', minHeight: 40, borderRadius: 999, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder, paddingHorizontal: 10 },
    presetOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    presetText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink, flexShrink: 1 },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: 'transparent', padding: 2 },
    swatchFill: { flex: 1, borderRadius: 16 },
    swatchOn: { borderColor: colors.ink, transform: [{ scale: 1.08 }] },
    packDot: { width: 10, height: 10, borderRadius: 5, marginHorizontal: 4 },
    appChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    appChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 9, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.glassStrong, borderWidth: 1, borderColor: colors.glassBorder, maxWidth: '100%' },
    appChipText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink, flexShrink: 1 },
    trialOut: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: 14, backgroundColor: colors.dark ? 'rgba(74,222,128,0.08)' : 'rgba(31,157,107,0.07)' },
    histRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
    histText: { fontFamily: fonts.medium, fontSize: 14.5, lineHeight: 20, color: colors.ink },
    copy: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    sheetBack: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,10,25,0.45)' },
    sheet: { backgroundColor: colors.bgElevated, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 16, paddingTop: 10 },
    grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.hairline, marginBottom: 10 },
    sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    sheetTitle: { fontFamily: fonts.semibold, fontSize: 17, color: colors.ink, flexShrink: 1 },
    search: { fontFamily: fonts.medium, fontSize: 15, color: colors.ink, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.dark ? 'rgba(255,255,255,0.06)' : 'rgba(20,30,60,0.05)', marginBottom: 8 },
    appRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    appBadge: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.glassStrong, borderWidth: 1, borderColor: colors.hairline },
    appLetter: { fontFamily: fonts.bold, fontSize: 15, color: colors.inkSoft },
    check: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: colors.inkFaint, alignItems: 'center', justifyContent: 'center' },
    checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  }),
);
