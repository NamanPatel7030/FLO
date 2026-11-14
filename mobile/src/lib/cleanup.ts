// Dictation cleanup on the phone: the free, always-on pass the desktop app runs before (or instead
// of) its AI cleanup (src-tauri/src/text.rs tidy_transcript + basic_cleanup), plus the spoken
// commands its AI handles ("new line", "comma", "scratch that") and the user's own words.
//
// The bubble runs the same rules in Kotlin (modules/flo-bubble FloCleanup.kt). Both are checked
// against one list of cases (modules/flo-bubble/cleanup-cases.json): change one, change the other.
//
// Never translates and never changes the script: Hindi stays in Devanagari, Gujarati in Gujarati,
// Hinglish in English letters.

export interface CleanupOptions {
  /** the recognizer's BCP-47 tag (null = the phone's language) */
  lang: string | null;
  /** add a full stop at the end of longer dictations */
  punctuation: boolean;
  /** the user's words and names, spelled their way */
  words: string[];
}

const FILLERS = ['um', 'uh', 'erm', 'uhm', 'hmm', 'mm'];

/** Everyday words (text.rs COMMON_WORDS): safe to lower-case mid-sentence. */
const COMMON = new Set(
  (
    'a about after again all also am an and any are as ask asked at back be because been before being but by call came can ' +
    "can't come could day did do does done don't down each even for from get give go going gone good got great had has have he " +
    "her here him his how i if in into is it it's its just know let like look made make many may me might more most much must my " +
    'need new no not now of off ok okay old on one only or our out over put said saw say see send sent set she should so some take ' +
    "tell than that the their them then there these they they're think this those three time to today told too took two up us use " +
    "used very want was way we we're well went were what when where which who why will with won't work would yes yesterday " +
    "tomorrow you you're your four five week really still right"
  ).split(' '),
);

const L = '\\p{L}\\p{M}';
const SPACE = /[\s ]+/gu;

/** Spoken punctuation: what you say → what's typed. Hindi phrases as Google writes them. */
const PUNCT: [string, string][] = [
  ['full stop', '.'],
  ['question mark', '?'],
  ['exclamation mark', '!'],
  ['exclamation point', '!'],
  ['comma', ','],
  ['पूर्ण विराम', '।'],
  ['प्रश्नवाचक चिह्न', '?'],
  ['अल्पविराम', ','],
];
const BREAKS: [string, string][] = [
  ['new paragraph', '\n\n'],
  ['new line', '\n'],
  ['नया पैराग्राफ', '\n\n'],
  ['नई लाइन', '\n'],
];
const SCRATCH = /(?<![\p{L}\p{M}])scratch that(?![\p{L}\p{M}])/iu;

const isWordy = (w: string) => w.length > 0 && /^[\p{L}\p{M}]+$/u.test(w);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const englishish = (lang: string | null) => !lang || lang.toLowerCase().startsWith('en');

function phrase(p: string): RegExp {
  return new RegExp(`(?<![${L}])${p.split(' ').map(escape).join('\\s+')}(?![${L}])`, 'giu');
}

/** "let's meet Monday scratch that Tuesday" → "Tuesday": drops the sentence before each "scratch that". */
function scratch(s: string): string {
  for (let guard = 0; guard < 20; guard++) {
    const m = SCRATCH.exec(s);
    if (!m) break;
    let start = m.index;
    while (start > 0 && !'.!?\n।'.includes(s[start - 1])) start--;
    let end = m.index + m[0].length;
    while (end < s.length && /[\s,.;:!?।]/u.test(s[end])) end++;
    s = s.slice(0, start) + (start > 0 && s[start - 1] !== '\n' ? ' ' : '') + s.slice(end);
  }
  return s;
}

/** "colors.Like" → "colors. Like", "want,Light" → "want, Light" (text.rs space_after_punctuation). */
export function spaceAfterPunctuation(t: string): string {
  return t
    .split(' ')
    .map((token) => {
      if (token.includes('://') || token.includes('@') || token.startsWith('www.')) return token;
      const cs = [...token];
      let out = '';
      for (let k = 0; k < cs.length; k++) {
        const c = cs[k];
        out += c;
        if (k === 0 || k + 1 >= cs.length) continue;
        const prev = cs[k - 1];
        const next = cs[k + 1];
        const alpha = (x: string) => /\p{L}/u.test(x);
        if (!alpha(prev) || !alpha(next)) continue;
        const upper = (x: string) => x !== x.toLowerCase() && x === x.toUpperCase();
        const lower = (x: string | undefined) => !!x && x !== x.toUpperCase() && x === x.toLowerCase();
        let run = 0;
        for (let j = k - 1; j >= 0 && alpha(cs[j]); j--) run++;
        const add = c === ',' ? true : c === '?' || c === '!' ? upper(next) : c === '.' ? upper(next) && lower(cs[k + 2]) && run >= 2 : false;
        if (add) out += ' ';
      }
      return out;
    })
    .join(' ');
}

/** Spaces, stray punctuation and line breaks put right. */
function tidy(s: string): string {
  return s
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ +([,.;:!?।])/gu, '$1')
    .replace(/([,;:])[,;:]+/g, '$1')
    .replace(/[,;:]+([.!?।])/gu, '$1')
    .replace(/^[\s,.;:।]+/u, '')
    .replace(/[ \t]+$/g, '')
    .trim();
}

function capitalise(s: string): string {
  return s.replace(/(^|[.!?]\s+|\n)(\p{Ll})/gu, (_, pre: string, c: string) => pre + c.toUpperCase());
}

/** Clean one dictation. */
export function cleanDictation(raw: string, o: CleanupOptions): string {
  let s = raw.replace(SPACE, ' ').trim();
  if (!s) return '';
  if (o.lang?.toLowerCase().startsWith('gu')) s = s.replace(/[।॥]/g, '.');

  for (const [p, nl] of BREAKS) s = s.replace(new RegExp(`[ ,;:]*${phrase(p).source}[,.;:]*[ ]*`, 'giu'), ` ${nl} `);
  for (const [p, mark] of PUNCT) s = s.replace(new RegExp(`[ ,.;:।]*${phrase(p).source}[,.;:।]*`, 'giu'), `${mark} `);
  s = scratch(s);

  // fillers and stutters, word by word (line breaks stay their own tokens)
  const out: string[] = [];
  for (const tok of s.split(/ +/)) {
    if (!tok) continue;
    const bare = tok.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    if (FILLERS.includes(bare)) continue;
    const prev = out[out.length - 1];
    if (prev !== undefined && isWordy(tok) && prev.toLowerCase() === tok.toLowerCase()) continue;
    out.push(tok);
  }
  s = spaceAfterPunctuation(out.join(' '));

  for (const w of o.words) {
    if (w.length < 2) continue;
    s = s.replace(new RegExp(`(?<![${L}\\p{N}])${escape(w)}(?![${L}\\p{N}])`, 'giu'), w);
  }
  s = tidy(s);
  if (!s) return '';
  if (englishish(o.lang)) s = s.replace(/(?<![\p{L}\p{M}'’])i(?![\p{L}\p{M}])/gu, 'I');
  s = capitalise(s);

  if (o.punctuation) {
    const last = s[s.length - 1];
    const words = s.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
    if (/[\p{L}\p{M}\p{N}]/u.test(last) && (words >= 6 || /[.!?।]/u.test(s))) {
      s += o.lang?.toLowerCase().startsWith('hi') ? '।' : '.';
    }
  }
  return s;
}

/**
 * Fit a cleaned dictation to where it goes: a capital after a full stop (or at the start), a small
 * letter for an everyday word mid-sentence, a space before it after a word and after it before a
 * word, and no full stop when the sentence carries on after the cursor.
 */
export function fitToContext(text: string, before: string, after: string): string {
  let t = text.trim();
  if (!t) return '';
  const b = before.replace(/[ \t]+$/, '');
  const sentenceStart = b === '' || /[.!?।\n]$/u.test(b);
  if (sentenceStart) {
    t = t.replace(/^(\p{Ll})/u, (c) => c.toUpperCase());
  } else {
    const m = /^(\p{Lu})(\p{Ll}*)(?![\p{L}\p{M}])/u.exec(t);
    if (m && m[0] !== 'I' && COMMON.has(m[0].toLowerCase())) t = m[1].toLowerCase() + t.slice(1);
  }
  const next = after[0];
  if (next !== undefined && /[\p{L}\p{N}]/u.test(next)) {
    if (/\p{Ll}/u.test(next) && t.endsWith('.') && !t.endsWith('..')) t = t.slice(0, -1);
    t += ' ';
  }
  const prev = before[before.length - 1];
  if (prev !== undefined && !/\s/u.test(prev) && !/^[,.;:!?।]/u.test(t)) t = ' ' + t;
  return t;
}
