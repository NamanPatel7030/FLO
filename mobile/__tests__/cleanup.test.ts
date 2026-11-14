import cases from '../modules/flo-bubble/cleanup-cases.json';
import { cleanDictation, fitToContext } from '../src/lib/cleanup';

interface CleanCase {
  in: string;
  out: string;
  lang?: string;
  words?: string[];
  punctuation?: boolean;
}

describe('cleanDictation (shared cases with FloCleanup.kt)', () => {
  for (const c of cases.clean as CleanCase[]) {
    it(JSON.stringify(c.in), () => {
      expect(cleanDictation(c.in, { lang: c.lang ?? null, punctuation: c.punctuation ?? true, words: c.words ?? [] })).toBe(c.out);
    });
  }
});

describe('fitToContext (shared cases with FloCleanup.kt)', () => {
  for (const c of cases.fit) {
    it(`${JSON.stringify(c.before)} + ${JSON.stringify(c.text)} + ${JSON.stringify(c.after)}`, () => {
      expect(fitToContext(c.text, c.before, c.after)).toBe(c.out);
    });
  }
});

describe('cleanup never changes the script', () => {
  it('keeps Devanagari and Gujarati letters as they are', () => {
    const hi = 'मुझे कल फ़ोन करना';
    expect(cleanDictation(hi, { lang: 'hi-IN', punctuation: false, words: [] })).toBe(hi);
    const gu = 'મને કાલે ફોન કરજો';
    expect(cleanDictation(gu, { lang: 'gu-IN', punctuation: false, words: [] })).toBe(gu);
  });
});
