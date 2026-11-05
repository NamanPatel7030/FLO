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
