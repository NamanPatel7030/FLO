import { DEFAULT_PREFS, parsePrefs, resolveDark } from '../src/lib/prefs';

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
