// The live preview (OrbPreview.tsx) must draw what the bubble (FloOrb.kt) draws, and the service
// (BubbleConfig.kt) must read every option the app sends (toNative). Both sides are plain source
// files, so read the Kotlin and compare.
import { DEFAULT_BUBBLE, DOT_K, ORB_PAD, PILL_H, PILL_W, STYLES, toNative } from '../src/lib/bubbleSettings';
import { GLASS_ALPHA, ORB_COLORS, PILL_MARK, SPIKES } from '../src/ui/OrbPreview';

declare const __dirname: string;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as { readFileSync(path: string, encoding: 'utf8'): string };
const dir = `${__dirname}/../modules/flo-bubble/android/src/main/java/expo/modules/flobubble`;
const kt = (f: string) => fs.readFileSync(`${dir}/${f}`, 'utf8');
const orb = kt('FloOrb.kt');
const cfg = kt('BubbleConfig.kt');

function constant(src: string, name: string): string {
  const m = new RegExp(`(?:const )?val ${name}(?::\\s*\\w+)?\\s*=\\s*([^\\n]+)`).exec(src);
  if (!m) throw new Error(`${name} not found`);
  return m[1].trim();
}

describe('OrbPreview matches FloOrb', () => {
  it('uses the same colours', () => {
    for (const [name, hex] of Object.entries(ORB_COLORS)) {
      expect(constant(orb, name).toLowerCase()).toBe(`color.parsecolor("${hex}")`);
    }
  });

  it('uses the same geometry', () => {
    expect(Number(constant(orb, 'SPIKES'))).toBe(SPIKES);
    expect(Number(constant(orb, 'GLASS_ALPHA'))).toBe(GLASS_ALPHA);
    expect(parseFloat(constant(orb, 'PILL_MARK'))).toBe(PILL_MARK);
    expect(parseFloat(constant(orb, 'PILL_W'))).toBe(PILL_W);
    expect(parseFloat(constant(orb, 'PILL_H'))).toBe(PILL_H);
    expect(parseFloat(constant(orb, 'DOT_K'))).toBe(DOT_K);
    expect(Number(constant(kt('FloBubble.kt'), 'PAD_DP'))).toBe(ORB_PAD);
  });

  it('draws every look the app offers', () => {
    const native = /STYLES = setOf\(([^)]*)\)/.exec(cfg)?.[1] ?? '';
    for (const s of STYLES) expect(native).toContain(`"${s.id}"`);
  });
});

describe('BubbleConfig reads everything toNative sends', () => {
  it('has a parser entry for every key', () => {
    const keys = Object.keys(toNative(DEFAULT_BUBBLE, null));
    const missing = keys.filter((k) => !new RegExp(`\\b${k}\\s*=`).test(cfg) || !cfg.includes(`"${k}"`));
    expect(missing).toEqual([]);
  });
});
