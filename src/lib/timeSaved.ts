// The "Time saved" notch widget: Flo's tagline plus how much time dictation saved the user,
// from their own local analytics (Analytics.minutesSaved, typing speed from Settings).
import { isMac } from "./os";

export const TAGLINE = "Say it. Save hours.";

/** 0 → "0 min", 0.4 → "< 1 min", 18.4 → "18 min", 130 → "2 h 10 min". */
export function savedLabel(minutes: number): string {
  const m = Math.max(0, minutes);
  if (m === 0) return "0 min";
  if (m < 1) return "< 1 min";
  const total = Math.round(m);
  const h = Math.floor(total / 60);
  const rest = total % 60;
  if (h === 0) return `${rest} min`;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** One line under the tagline. `key` is the dictation key's label (⌃ on a Mac, Ctrl elsewhere). */
export function savedSummary(today: number, week: number, key: string = isMac() ? "⌃" : "Ctrl"): string {
  if (week <= 0 && today <= 0) return `Hold ${key} and speak to start saving time.`;
  if (today <= 0) return `${savedLabel(week)} saved this week.`;
  return `${savedLabel(today)} today · ${savedLabel(week)} this week`;
}
