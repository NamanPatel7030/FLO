import { bubbleState } from '../src/lib/bubble';

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
