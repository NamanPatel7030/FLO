import { Animated } from 'react-native';
import { forever, hapticsOn, instant, motionOn, setHaptics, setMotion, spring, timing } from '../src/ui/motion';
import { colors, DARK, LIGHT, setPalette, themed } from '../src/ui/theme';

describe('motion switch', () => {
  afterEach(() => setMotion(true));

  it('lands immediately with motion off', () => {
    const t = jest.spyOn(Animated, 'timing');
    const v = new Animated.Value(0);
    setMotion(false);
    expect(motionOn()).toBe(false);
    timing(v, { toValue: 1, duration: 400, delay: 100, useNativeDriver: false });
    expect(t.mock.calls[0][1]).toMatchObject({ toValue: 1, duration: 0, delay: 0 });
    spring(v, { toValue: 0, useNativeDriver: false });
    expect(t.mock.calls[1][1]).toMatchObject({ toValue: 0, duration: 0 });
    t.mockRestore();
  });

  it('passes configs through with motion on', () => {
    const t = jest.spyOn(Animated, 'timing');
    const s = jest.spyOn(Animated, 'spring');
    const v = new Animated.Value(0);
    timing(v, { toValue: 1, duration: 400, useNativeDriver: false });
    spring(v, { toValue: 1, useNativeDriver: false });
    expect(t.mock.calls[0][1]).toMatchObject({ duration: 400 });
    expect(s).toHaveBeenCalledTimes(1);
    t.mockRestore();
    s.mockRestore();
  });

  it('never starts endless loops with motion off', () => {
    const l = jest.spyOn(Animated, 'loop');
    const make = jest.fn(() => Animated.timing(new Animated.Value(0), { toValue: 1, duration: 10, useNativeDriver: false }));
    setMotion(false);
    const a = forever(make);
    const done = jest.fn();
    a.start(done);
    a.stop();
    expect(make).not.toHaveBeenCalled();
    expect(l).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith({ finished: true });
    l.mockRestore();
  });

  it('instant() keeps the target but drops timing', () => {
    expect(instant({ toValue: 2, duration: 300, delay: 50 })).toEqual({ toValue: 2, duration: 0, delay: 0 });
  });

  it('haptics switch', () => {
    setHaptics(false);
    expect(hapticsOn()).toBe(false);
    setHaptics(true);
    expect(hapticsOn()).toBe(true);
  });
});

describe('live theme', () => {
  afterAll(() => setPalette(LIGHT, null));

  it('re-themes colors and themed styles the moment the palette changes', () => {
    const styles = themed(() => ({ card: { backgroundColor: colors.bg, color: colors.sky } }));
    setPalette(LIGHT, null);
    expect(styles.card.backgroundColor).toBe(LIGHT.bg);
    setPalette(DARK, null);
    expect(colors.bg).toBe(DARK.bg);
    expect(styles.card.backgroundColor).toBe(DARK.bg);
    setPalette(DARK, '#ff5c8a');
    expect(styles.card.color).toBe('#ff5c8a');
  });
});
