import { DEFAULT_PREFS, parsePrefs, resolveDark, resolveMotion, themeLabel } from '../src/lib/prefs';

describe('parsePrefs', () => {
  it('defaults to light with the Classic Lucid avatar', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS.theme).toBe('light');
    expect(DEFAULT_PREFS.avatar).toEqual({ eyes: 'classic', glow: 'lucid', mouth: 'wave', extra: 'none', cheeks: true });
  });

  it('keeps valid choices and drops junk', () => {
    const p = parsePrefs(
      JSON.stringify({ theme: 'dark', accent: '#7a6cff', avatar: { eyes: 'visor', glow: 'nope', mouth: 'cat', extra: 'halo', cheeks: false }, onboarded: true, quickActions: false }),
    );
    expect(p.theme).toBe('dark');
    expect(p.accent).toBe('#7a6cff');
    expect(p.avatar).toEqual({ eyes: 'visor', glow: 'lucid', mouth: 'cat', extra: 'halo', cheeks: false });
    expect(p.onboarded).toBe(true);
    expect(p.quickActions).toBe(false);
  });

  it('survives broken JSON and bad values', () => {
    expect(parsePrefs('{nope')).toEqual(DEFAULT_PREFS);
    const p = parsePrefs(JSON.stringify({ theme: 'purple', accent: 'red', avatar: 5 }));
    expect(p.theme).toBe('light');
    expect(p.accent).toBeNull();
    expect(p.avatar).toEqual(DEFAULT_PREFS.avatar);
  });
});

describe('resolveDark', () => {
  it('follows the choice, or the system when set to System', () => {
    expect(resolveDark('light', 'dark')).toBe(false);
    expect(resolveDark('dark', 'light')).toBe(true);
    expect(resolveDark('system', 'dark')).toBe(true);
    expect(resolveDark('system', 'light')).toBe(false);
  });
});

describe('phone motion and haptics', () => {
  it('defaults to animations and haptics on, and keeps them through old saved prefs', () => {
    expect(DEFAULT_PREFS.animations).toBe(true);
    expect(DEFAULT_PREFS.haptics).toBe(true);
    const old = parsePrefs(JSON.stringify({ theme: 'dark' })); // saved before these switches existed
    expect(old.animations).toBe(true);
    expect(old.haptics).toBe(true);
  });

  it('remembers them turned off', () => {
    const p = parsePrefs(JSON.stringify({ animations: false, haptics: false }));
    expect(p.animations).toBe(false);
    expect(p.haptics).toBe(false);
  });

  it("plays animations only if Flo's switch is on and Android isn't removing them", () => {
    expect(resolveMotion(true, false)).toBe(true);
    expect(resolveMotion(false, false)).toBe(false);
    expect(resolveMotion(true, true)).toBe(false);
    expect(resolveMotion(false, true)).toBe(false);
  });

  it('labels the theme', () => {
    expect(themeLabel('light')).toBe('Light');
    expect(themeLabel('dark')).toBe('Dark');
    expect(themeLabel('system')).toBe('System');
  });
});
