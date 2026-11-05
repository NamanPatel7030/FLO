// Typing speed test helpers (pure).

export interface WpmResult {
  /** chars typed that match the passage */
  correctChars: number;
  /** wrong chars still present in the typed text (uncorrected errors) */
  errors: number;
  typedChars: number;
  /** (all typed chars / 5) / minutes */
  gross: number;
  /** ((correctChars / 5) − uncorrected errors) / minutes, never below 0 */
  net: number;
  /** correctChars / typedChars, 0–100 */
  accuracy: number;
}

/** Standard net WPM: ((correctChars / 5) − uncorrectedErrors) / minutes. */
export function computeWpm(typed: string, target: string, elapsedMs: number): WpmResult {
  let correct = 0;
  let errors = 0;
  for (let i = 0; i < typed.length; i++) {
    if (typed[i] === target[i]) correct++;
    else errors++;
  }
  const minutes = Math.max(elapsedMs, 1000) / 60000;
  const gross = typed.length / 5 / minutes;
  const net = Math.max(0, (correct / 5 - errors) / minutes);
  return {
    correctChars: correct,
    errors,
    typedChars: typed.length,
    gross: Math.round(gross),
    net: Math.round(net),
    accuracy: typed.length ? Math.round((correct / typed.length) * 1000) / 10 : 100,
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

/** A long practice text: passages in a shuffled order (enough for a 5 minute test). */
export function buildPracticeText(seed = Date.now()): string {
  const order = PASSAGES.map((p, i) => ({ p, k: Math.sin(seed + i * 7.13) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.p);
  return [...order, ...order].join(" ");
}
