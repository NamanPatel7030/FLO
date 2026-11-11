import { appLink, bubbleState, enableStep, parseHistory, type EnableFacts } from '../src/lib/bubble';

jest.mock('../modules/flo-bubble', () => ({ __esModule: true, default: null }));

const native = (serviceOn: boolean, enabled: boolean) => ({ isServiceOn: () => serviceOn, isEnabled: () => enabled });

describe('bubbleState', () => {
  it('is unavailable off Android or without the native module', () => {
    expect(bubbleState(native(true, true), 'web')).toBe('unavailable');
    expect(bubbleState(null, 'android')).toBe('unavailable');
  });
  it('needs the accessibility service switched on', () => {
    expect(bubbleState(native(false, true), 'android')).toBe('off');
  });
  it('respects the in-app switch', () => {
    expect(bubbleState(native(true, true), 'android')).toBe('on');
    expect(bubbleState(native(true, false), 'android')).toBe('paused');
  });
  it('treats a throwing module as unavailable', () => {
    const broken = { isServiceOn: () => { throw new Error('x'); }, isEnabled: () => true };
    expect(bubbleState(broken, 'android')).toBe('unavailable');
  });
});

describe('enableStep', () => {
  const base: EnableFacts = { serviceOn: false, mic: true, restricted: 'allowed', sdk: 34, triedAccessibility: false };
  it('is done once the service is on, whatever else', () => {
    expect(enableStep({ ...base, serviceOn: true, mic: false, restricted: 'restricted' })).toBe('done');
  });
  it('asks for the microphone first', () => {
    expect(enableStep({ ...base, mic: false, restricted: 'restricted' })).toBe('mic');
  });
  it('goes straight to Accessibility when nothing blocks it', () => {
    expect(enableStep(base)).toBe('accessibility');
    expect(enableStep({ ...base, sdk: 30, restricted: 'restricted' })).toBe('accessibility');
  });
  it('shows the unblock guide when Android 13+ restricts the setting', () => {
    expect(enableStep({ ...base, restricted: 'restricted' })).toBe('unblock');
    expect(enableStep({ ...base, sdk: 33, restricted: 'restricted' })).toBe('unblock');
  });
  it('tries Accessibility first when unsure, then shows the guide if that did not take', () => {
    expect(enableStep({ ...base, restricted: 'unknown' })).toBe('accessibility');
    expect(enableStep({ ...base, restricted: 'unknown', triedAccessibility: true })).toBe('unblock');
  });
  it('moves on to Accessibility once restricted settings are allowed', () => {
    expect(enableStep({ ...base, restricted: 'allowed', triedAccessibility: true })).toBe('accessibility');
  });
});

describe('appLink', () => {
  it('opens the bubble and offline speech screens from the bubble notifications', () => {
    expect(appLink('flo-pair://bubble')).toBe('bubble');
    expect(appLink('flo-pair://speech?from=notif')).toBe('speech');
    expect(appLink('FLO-PAIR://Bubble/')).toBe('bubble');
  });
  it('leaves pairing links alone', () => {
    expect(appLink('flo-pair://flo.hellonaman.com/483920')).toBeNull();
    expect(appLink('flo-pair://bubbles.example.com/123456')).toBeNull();
  });
});

describe('parseHistory', () => {
  it('reads the bubble Recent list and drops junk', () => {
    const raw = JSON.stringify([
      { kind: 'ask', text: 'q', answer: 'a', cloud: true, at: 5 },
      { kind: 'dictate', text: 'hello', at: 4 },
      { kind: 'weird', text: 'x', at: 3 },
      { kind: 'copied' },
    ]);
    expect(parseHistory(raw)).toEqual([
      { kind: 'ask', text: 'q', answer: 'a', cloud: true, at: 5 },
      { kind: 'dictate', text: 'hello', at: 4 },
    ]);
    expect(parseHistory('nope')).toEqual([]);
    expect(parseHistory(null)).toEqual([]);
  });
});
