// Pure helpers for Home's "Today's meetings" (calendar_agenda) and the meeting notes view:
// row status, time range, and [mm:ss] timestamps in a summary. Unit-tested (agenda.test.ts).
import type { AgendaItem } from "./types";

export type AgendaStatus = "recording" | "now" | "soon" | "later" | "done";

const MIN = 60_000;

/** recording > happening now > starts within 15 min > later today > ended. */
export function agendaStatus(item: Pick<AgendaItem, "start" | "end" | "recording">, now: number): AgendaStatus {
  if (item.recording) return "recording";
  const s = Date.parse(item.start);
  const e = Date.parse(item.end);
  if (!Number.isNaN(e) && e <= now) return "done";
  if (!Number.isNaN(s) && s <= now) return "now";
  if (!Number.isNaN(s) && s - now <= 15 * MIN) return "soon";
  return "later";
}

/** "10:00 – 10:30" in the user's locale. */
export function timeRange(item: Pick<AgendaItem, "start" | "end">): string {
  const f = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${f(item.start)} – ${f(item.end)}`;
}

/** Guests other than the user who didn't decline. */
export function guests(item: Pick<AgendaItem, "attendees">): string[] {
  return item.attendees.filter((a) => !a.self && a.response !== "declined").map((a) => a.name || a.email);
}

/** "2 of 4 with notes on" style count for the header. */
export function notesOnCount(items: Pick<AgendaItem, "takeNotes" | "end">[], now: number): number {
  return items.filter((i) => i.takeNotes && Date.parse(i.end) > now).length;
}

export type NotesPiece = { t: "text"; v: string } | { t: "ts"; v: string; sec: number };

/** "said it [02:14] and [1:02:03]" → text and timestamp pieces (seconds into the meeting). */
export function splitTimestamps(text: string): NotesPiece[] {
  const out: NotesPiece[] = [];
  const re = /\[(?:(\d{1,2}):)?(\d{1,3}):(\d{2})\]/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
    const sec = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    out.push({ t: "ts", v: m[0].slice(1, -1), sec });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

/** The transcript row a timestamp points at: the last line that starts at or before it. */
export function rowForTime(times: number[], sec: number): number {
  let best = 0;
  for (let i = 0; i < times.length; i++) {
    if (times[i] <= sec + 1) best = i;
    else break;
  }
  return best;
}

/** Is this summary the structured meeting notes (## sections) rather than plain bullets? */
export function isStructuredNotes(summary: string): boolean {
  return /^##\s+\S/m.test(summary);
}

/** Gmail's compose window, filled in (the user reviews and sends it; Flo never sends). */
export function gmailComposeUrl(to: string[], subject: string, body: string): string {
  const q = new URLSearchParams({ view: "cm", fs: "1", to: to.join(","), su: subject, body });
  return `https://mail.google.com/mail/?${q.toString()}`;
}
