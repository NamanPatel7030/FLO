/**
 * Split a live (still-changing) transcription line into the part the user has already seen and
 * the newly appended suffix, so only the new words animate in. If the recogniser revised earlier
 * words (not a pure extension), everything after the common prefix is treated as new.
 */
export function splitLive(prev: string, next: string): { stable: string; added: string } {
  let i = 0;
  const max = Math.min(prev.length, next.length);
  while (i < max && prev[i] === next[i]) i++;
  // don't cut a word in half: back up to the last space inside the common prefix
  if (i < next.length && i > 0 && next[i - 1] !== " " && next[i] !== " ") {
    const sp = next.lastIndexOf(" ", i - 1);
    i = sp >= 0 ? sp + 1 : 0;
  }
  return { stable: next.slice(0, i), added: next.slice(i) };
}

/** The newest part of a long live line ("…own the release notes"): a clamped live line would
 *  otherwise keep its first words and hide what is being said right now. Starts at a word. */
export function tailText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(t.length - max);
  const sp = cut.indexOf(" ");
  const tail = sp >= 0 && sp < cut.length - 1 ? cut.slice(sp + 1) : cut;
  return "…" + tail;
}
