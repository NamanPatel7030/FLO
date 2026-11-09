// Who said what: pure helpers for speaker-labelled meeting transcripts (colours, names, stats).
import type { MeetingSegment } from "./types";

/** One colour per speaker, stable across notes: You, then Speaker N by number, names by hash. */
export const SPEAKER_COLORS = ["#8b5cf6", "#f59e0b", "#10b981", "#ec4899", "#84cc16", "#ef4444", "#14b8a6", "#a855f7"];
export function speakerColor(who?: string): string {
  if (!who || who === "You") return "#0ea5e9";
  if (who === "Others") return "#94a3b8";
  const n = /^Speaker (\d+)$/.exec(who);
  if (n) return SPEAKER_COLORS[(Number(n[1]) - 1) % SPEAKER_COLORS.length];
  let h = 0;
  for (const c of who) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SPEAKER_COLORS[h % SPEAKER_COLORS.length];
}

/** Colours for one note: no two speakers share one (named people would otherwise hash onto a
 * "Speaker N" colour). Speaker N keeps its usual colour when free; names take the next free one. */
export function speakerPalette(labels: (string | undefined)[]): (who?: string) => string {
  const map = new Map<string, string>();
  const used = new Set<string>();
  const uniq = [...new Set(labels.filter((l): l is string => !!l))];
  // fixed ones first so names don't take them
  for (const who of uniq) {
    if (who === "You" || who === "Others" || /^Speaker \d+$/.test(who)) {
      const c = speakerColor(who);
      if (!used.has(c)) {
        map.set(who, c);
        used.add(c);
      }
    }
  }
  for (const who of uniq) {
    if (map.has(who)) continue;
    const pref = speakerColor(who);
    const c = !used.has(pref) ? pref : (SPEAKER_COLORS.find((x) => !used.has(x)) ?? pref);
    map.set(who, c);
    used.add(c);
  }
  return (who?: string) => (who && map.get(who)) || speakerColor(who);
}

/** Transcripts store the stable label "You"; people see their own name. */
export function shownName(who: string, me?: string): string {
  return who === "You" && me?.trim() ? me.trim() : who;
}

/** "Rahul: send the deck" → owner + task (same rule as the backend's split_owner). */
export function splitOwner(item: string): { owner?: string; task: string } {
  const m = /^\s*([A-Za-z\u00C0-\u024F\u0900-\u0AFF][\w\u00C0-\u024F\u0900-\u0AFF .'-]{0,29}?)\s*:\s*(\D.*)$/.exec(item);
  if (!m || m[1].trim().split(/\s+/).length > 3) return { task: item.trim() };
  return { owner: m[1].trim(), task: m[2].trim() };
}

/** Who spoke and roughly how much (share of words), in order of first appearance. */
export function speakerStats(segs: MeetingSegment[]): { who: string; share: number }[] {
  const words = new Map<string, number>();
  for (const s of segs) {
    if (!s.speaker) continue;
    words.set(s.speaker, (words.get(s.speaker) ?? 0) + Math.max(1, s.text.trim().split(/\s+/).length));
  }
  const total = [...words.values()].reduce((a, b) => a + b, 0) || 1;
  return [...words.entries()].map(([who, n]) => ({ who, share: Math.round((n / total) * 100) }));
}
