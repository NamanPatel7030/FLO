import {
  BUBBLE_SIZES,
  DEFAULT_BUBBLE,
  bubbleVisible,
  dictationOnly,
  effectiveGestures,
  gestureAction,
  isDictationOnly,
  parseBubbleSettings,
  setMode,
  speechLang,
  tapDelayMs,
  toNative,
  toggleHiddenApp,
  type BubbleSettings,
} from '../src/lib/bubbleSettings';

const s = (p: Partial<BubbleSettings> = {}): BubbleSettings => ({ ...DEFAULT_BUBBLE, ...p });

describe('parseBubbleSettings', () => {
  it('defaults: both modes on, tap dictates, long-press asks, medium, auto side', () => {
    expect(parseBubbleSettings(null)).toEqual(DEFAULT_BUBBLE);
    expect(DEFAULT_BUBBLE).toMatchObject({ dictation: true, assistant: true, tap: 'dictate', longPress: 'ask', doubleTap: 'none', size: 'm', side: 'auto' });
  });

  it('keeps valid values and drops junk', () => {
    const p = parseBubbleSettings(
      JSON.stringify({
        dictation: false,
        tap: 'ask',
        longPress: 'explode',
        size: 'xl',
        idleOpacity: 0.4,
        accent: '#ff5c8a',
        side: 'left',
        hiddenApps: ['com.whatsapp', 5, '', 'com.whatsapp', 'bad pkg!'],
        language: 'gu-IN',
        insert: 'paste',
        sounds: true,
        startOnBoot: false,
      }),
    );
    expect(p.dictation).toBe(false);
    expect(p.tap).toBe('ask');
    expect(p.longPress).toBe('ask'); // junk → default
    expect(p.size).toBe('m');
    expect(p.idleOpacity).toBe(0.4);
    expect(p.accent).toBe('#ff5c8a');
    expect(p.side).toBe('left');
    expect(p.hiddenApps).toEqual(['com.whatsapp']);
    expect(p.language).toBe('gu-IN');
    expect(p.insert).toBe('paste');
    expect(p.sounds).toBe(true);
    expect(p.startOnBoot).toBe(false);
  });

  it('clamps opacity and survives broken JSON', () => {
    expect(parseBubbleSettings(JSON.stringify({ idleOpacity: 0.01 })).idleOpacity).toBe(0.3);
    expect(parseBubbleSettings(JSON.stringify({ idleOpacity: 7 })).idleOpacity).toBe(1);
    expect(parseBubbleSettings(JSON.stringify({ idleOpacity: 'x' })).idleOpacity).toBe(DEFAULT_BUBBLE.idleOpacity);
    expect(parseBubbleSettings('{oops')).toEqual(DEFAULT_BUBBLE);
    expect(parseBubbleSettings('[]')).toEqual(DEFAULT_BUBBLE);
  });
});

describe('gestures and modes', () => {
  it('maps each gesture to its action while that mode is on', () => {
    expect(gestureAction(s(), 'tap')).toBe('dictate');
    expect(gestureAction(s(), 'longPress')).toBe('ask');
    expect(gestureAction(s(), 'doubleTap')).toBe('none');
  });

  it('a gesture whose mode is off does nothing', () => {
    expect(gestureAction(s({ assistant: false }), 'longPress')).toBe('none');
    expect(gestureAction(s({ dictation: false }), 'tap')).toBe('none');
  });

  it('keeps an enabled mode reachable: falls back to the first free gesture', () => {
    // assistant only, but no gesture asks: tap takes it
    expect(effectiveGestures(s({ dictation: false, tap: 'dictate', longPress: 'dictate' }))).toEqual({ tap: 'ask', longPress: 'none', doubleTap: 'none' });
    // dictation only with long-press set to ask: tap still dictates, long-press goes quiet
    expect(effectiveGestures(s({ assistant: false }))).toEqual({ tap: 'dictate', longPress: 'none', doubleTap: 'none' });
    // both on, but everything dictates: ask lands on the first free gesture (double-tap)
    expect(effectiveGestures(s({ tap: 'dictate', longPress: 'dictate', doubleTap: 'none' }))).toEqual({ tap: 'dictate', longPress: 'dictate', doubleTap: 'ask' });
  });

  it('hides the bubble when both modes are off', () => {
    expect(bubbleVisible(s())).toBe(true);
    expect(bubbleVisible(s({ assistant: false }))).toBe(true);
    expect(bubbleVisible(s({ dictation: false, assistant: false }))).toBe(false);
    expect(effectiveGestures(s({ dictation: false, assistant: false }))).toEqual({ tap: 'none', longPress: 'none', doubleTap: 'none' });
  });

  it('waits for a possible double-tap only when double-tap does something', () => {
    expect(tapDelayMs(s())).toBe(0);
    expect(tapDelayMs(s({ doubleTap: 'ask' }))).toBeGreaterThan(200);
    expect(tapDelayMs(s({ doubleTap: 'ask', assistant: false }))).toBe(0);
  });

  it('the Dictation only preset turns Ask off and puts dictation on tap and hold', () => {
    const d = dictationOnly(s({ tap: 'ask', size: 'l' }));
    expect(d).toMatchObject({ dictation: true, assistant: false, tap: 'dictate', longPress: 'dictate', doubleTap: 'none', size: 'l' });
    expect(isDictationOnly(d)).toBe(true);
    expect(isDictationOnly(s())).toBe(false);
  });

  it('turning a mode back on gives it a gesture if none has it', () => {
    const d = dictationOnly(s());
    const back = setMode(d, 'assistant', true);
    expect(back.assistant).toBe(true);
    expect(back.longPress).toBe('ask');
    const both = setMode(setMode(s(), 'dictation', false), 'dictation', true);
    expect(both.tap).toBe('dictate');
  });
});

describe('speechLang', () => {
  it('auto lets the recognizer detect English, Hindi and Gujarati', () => {
    expect(speechLang('auto')).toEqual({ tag: null, detect: ['en-IN', 'hi-IN', 'gu-IN'] });
  });
  it('Hinglish types in Latin letters through Indian English', () => {
    expect(speechLang('hinglish')).toEqual({ tag: 'en-IN', detect: [] });
  });
  it('a fixed language passes straight through', () => {
    expect(speechLang('hi-IN')).toEqual({ tag: 'hi-IN', detect: [] });
  });
});

describe('toNative', () => {
  it('resolves the accent, size and gestures for the service', () => {
    const n = toNative(s({ accent: null, size: 'l', doubleTap: 'ask' }), '#7a6cff');
    expect(n.accent).toBe('#7a6cff');
    expect(n.sizeDp).toBe(BUBBLE_SIZES.l);
    expect(n.tap).toBe('dictate');
    expect(n.doubleTap).toBe('ask');
    expect(n.tapDelayMs).toBeGreaterThan(0);
    expect(n.visible).toBe(true);
    expect(toNative(s({ accent: '#1f9d6b' }), '#7a6cff').accent).toBe('#1f9d6b');
    expect(toNative(s({ language: 'hinglish' }), null).langTag).toBe('en-IN');
    expect(toNative(s(), null).accent).toBe('#2f8cff');
  });
  it('sizes get smaller than the old 56dp buttons', () => {
    expect(BUBBLE_SIZES.s).toBeLessThan(BUBBLE_SIZES.m);
    expect(BUBBLE_SIZES.m).toBeLessThanOrEqual(48);
    expect(BUBBLE_SIZES.l).toBeLessThan(56);
  });
});

describe('toggleHiddenApp', () => {
  it('adds and removes a package, keeping the list sorted and unique', () => {
    const a = toggleHiddenApp(s(), 'com.whatsapp');
    expect(a.hiddenApps).toEqual(['com.whatsapp']);
    const b = toggleHiddenApp(a, 'com.android.chrome');
    expect(b.hiddenApps).toEqual(['com.android.chrome', 'com.whatsapp']);
    expect(toggleHiddenApp(b, 'com.whatsapp').hiddenApps).toEqual(['com.android.chrome']);
  });
});
