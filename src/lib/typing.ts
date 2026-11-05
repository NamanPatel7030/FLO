// Typing speed test engine (pure, word-based like Monkeytype).
//
// Each word is compared on its own: Space commits the current word and moves on, so one missed
// character only marks THAT word. Backspace may return into the previous word only if it has errors.

export interface TypingState {
  /** committed words as the user typed them */
  typed: string[];
  /** the word being typed */
  current: string;
  /** keystroke accounting (for accuracy) */
  correctKeys: number;
  totalKeys: number;
  /** consecutive correctly committed words */
  streak: number;
}

export const initialTyping = (): TypingState => ({ typed: [], current: "", correctKeys: 0, totalKeys: 0, streak: 0 });

/** Apply one key ("Backspace", " " or a single character) to the state. */
export function typeKey(st: TypingState, words: string[], key: string): TypingState {
  const i = st.typed.length;
  const target = words[i] ?? "";
  if (key === "Backspace") {
    if (st.current.length) return { ...st, current: st.current.slice(0, -1) };
    // step back into the previous word only if it was wrong
    if (i > 0 && st.typed[i - 1] !== words[i - 1]) {
      return { ...st, typed: st.typed.slice(0, -1), current: st.typed[i - 1], streak: 0 };
    }
    return st;
  }
  if (key === " ") {
    if (!st.current.length) return st; // ignore leading / double spaces
    const ok = st.current === target;
    return {
      typed: [...st.typed, st.current],
      current: "",
      correctKeys: st.correctKeys + (ok ? 1 : 0),
      totalKeys: st.totalKeys + 1,
      streak: ok ? st.streak + 1 : 0,
    };
  }
  if (key.length !== 1) return st;
  const pos = st.current.length;
  const ok = pos < target.length && target[pos] === key;
  return { ...st, current: st.current + key, correctKeys: st.correctKeys + (ok ? 1 : 0), totalKeys: st.totalKeys + 1 };
}

export type LetterState = "correct" | "wrong" | "extra" | "missing" | "pending";

/** Per-letter states for word `i` (committed, current or upcoming). */
export function wordLetters(word: string, typed: string | undefined, committed: boolean): { ch: string; state: LetterState }[] {
  const out: { ch: string; state: LetterState }[] = [];
  const t = typed ?? "";
  for (let j = 0; j < word.length; j++) {
    if (j < t.length) out.push({ ch: word[j], state: t[j] === word[j] ? "correct" : "wrong" });
    else out.push({ ch: word[j], state: committed ? "missing" : "pending" });
  }
  for (let j = word.length; j < t.length; j++) out.push({ ch: t[j], state: "extra" });
  return out;
}

export interface WpmResult {
  /** chars of correctly typed words (+ their spaces) / 5 per minute */
  net: number;
  /** everything typed (incl. spaces) / 5 per minute */
  raw: number;
  /** correct keystrokes / total keystrokes, 0–100 */
  accuracy: number;
  correctWords: number;
  wrongWords: number;
}

export function computeWpm(words: string[], st: Pick<TypingState, "typed" | "current" | "correctKeys" | "totalKeys">, elapsedMs: number): WpmResult {
  const minutes = Math.max(elapsedMs, 1000) / 60000;
  let correctChars = 0;
  let rawChars = 0;
  let correctWords = 0;
  st.typed.forEach((t, i) => {
    rawChars += t.length + 1;
    if (t === words[i]) {
      correctChars += t.length + 1;
      correctWords++;
    }
  });
  rawChars += st.current.length;
  if (st.current && st.current === words[st.typed.length]) correctChars += st.current.length;
  return {
    net: Math.round(correctChars / 5 / minutes),
    raw: Math.round(rawChars / 5 / minutes),
    accuracy: st.totalKeys ? Math.round((st.correctKeys / st.totalKeys) * 1000) / 10 : 100,
    correctWords,
    wrongWords: st.typed.length - correctWords,
  };
}

/** Minutes saved per 1,000 words by speaking (~150 wpm) instead of typing at `wpm`. */
export function minutesSavedPer1000(wpm: number, speakingWpm = 150): number {
  if (wpm <= 0) return 0;
  return Math.max(0, Math.round((1000 / wpm - 1000 / speakingWpm) * 10) / 10);
}

export const PASSAGES = [
  "The best tools fade into the background. You open your laptop, say what you mean, and the words land exactly where you need them. No hunting for keys, no breaking your train of thought.",
  "Every morning starts with a short list. Reply to the client, review the pull request, and send the deck before lunch. Small wins early in the day make the hard problems feel lighter.",
  "Good writing is mostly rewriting. Say the idea out loud, read it back, and cut every word that does not earn its place. Clear sentences are kind to the reader and to your future self.",
  "The team met on a rainy Tuesday to plan the launch. They agreed on the checklist, picked owners for each item, and promised to share progress every Friday afternoon.",
  "A quiet desk, a warm cup of tea, and a single task on the screen. Focus is not about doing more things at once. It is about giving one thing your full attention until it is done.",
  "Travel light and keep notes. The details you think you will remember fade within a week, but a few honest lines written on the train will bring the whole journey back years later.",
];

/** Words for a test: passages in a shuffled order, repeated (enough for 5 minutes). */
export function buildPracticeWords(seed = Date.now()): string[] {
  const order = PASSAGES.map((p, i) => ({ p, k: Math.sin(seed + i * 7.13) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.p);
  return [...order, ...order, ...order].join(" ").split(" ");
}
