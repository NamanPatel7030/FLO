// Pure helpers for Google Calendar in the UI: the notch meeting card (countdown, guests, Join
// label) and the agenda (today's events, the "Next: Design sync in 25 min" headline).
// No React here, so it is unit-tested (meetingAlert.test.ts).
import type { CalendarEvent, JoinKind, MeetingAlert } from "./types";

const MIN = 60_000;
/** an alert drops off the notch this long after the meeting started */
export const ALERT_DROP_AFTER_MS = 10 * MIN;

/** "in 5 min", "in 40 sec", "in 1 h 5 min"; "Starting now" once the start time is reached (or the
 *  backend says phase "now"); "Started 3 min ago" a little later. */
export function countdownLabel(start: string | number, now: number, phase: MeetingAlert["phase"] = "soon"): string {
  const t = typeof start === "number" ? start : Date.parse(start);
  if (Number.isNaN(t)) return phase === "now" ? "Starting now" : "Soon";
  const diff = t - now;
  if (diff <= -2 * MIN) return `Started ${Math.floor(-diff / MIN)} min ago`;
  if (phase === "now" || diff <= 0) return "Starting now";
  return `in ${untilLabel(diff)}`;
}

/** 40 s → "40 sec", 4 min 10 s → "5 min", 65 min → "1 h 5 min" (minutes round up: never late). */
export function untilLabel(ms: number): string {
  if (ms < MIN) return `${Math.max(1, Math.ceil(ms / 1000))} sec`;
  const mins = Math.ceil(ms / MIN);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** How often the countdown needs to re-render: every second in the last minute, else every 15 s. */
export function tickMs(start: string | number, now: number): number {
  const t = typeof start === "number" ? start : Date.parse(start);
  return !Number.isNaN(t) && t - now <= 2 * MIN ? 1000 : 15_000;
}

/** "Priya Shah" → "Priya"; "rahul.mehta" (email local part) → "Rahul". */
export function firstName(name: string): string {
  const n = name.trim().split("@")[0];
  const first = n.split(/[\s._-]+/).filter(Boolean)[0] ?? n;
  return first ? first[0].toUpperCase() + first.slice(1) : n;
}

/** "Priya, Rahul and Sam" · "Priya, Rahul and 3 others" · "No other guests". */
export function attendeeSummary(names: string[], count = names.length): string {
  const total = Math.max(count, names.length);
  if (total === 0) return "No other guests";
  const firsts = names.map(firstName).filter(Boolean);
  if (!firsts.length) return `${total} guest${total === 1 ? "" : "s"}`;
  const shown = firsts.slice(0, total > 3 ? 2 : 3);
  const rest = total - shown.length;
  if (rest <= 0) return shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return `${shown.join(", ")} and ${rest} other${rest === 1 ? "" : "s"}`;
}

/** "3 guests" / "1 guest" */
export const guestCount = (n: number) => `${n} guest${n === 1 ? "" : "s"}`;

export function joinLabel(kind?: JoinKind): string {
  switch (kind) {
    case "meet":
      return "Join Meet";
    case "zoom":
      return "Join Zoom";
    case "teams":
      return "Join Teams";
    default:
      return "Join";
  }
}

/** The card steps aside 10 minutes after the meeting started. */
export function alertExpired(a: Pick<MeetingAlert, "start">, now: number): boolean {
  const t = Date.parse(a.start);
  return !Number.isNaN(t) && now - t >= ALERT_DROP_AFTER_MS;
}

/** Add or update an alert in the queue (same id replaces the entry in place). */
export function upsertAlert(q: MeetingAlert[], a: MeetingAlert): MeetingAlert[] {
  const i = q.findIndex((x) => x.id === a.id);
  if (i < 0) return [...q, a];
  const next = q.slice();
  next[i] = a;
  return next;
}

// ── agenda ───────────────────────────────────────────────────────────────────
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Start time in ms. All-day dates ("YYYY-MM-DD") are local midnight, not UTC. */
export function eventStartMs(e: Pick<CalendarEvent, "start" | "allDay">): number {
  if (e.allDay || /^\d{4}-\d{2}-\d{2}$/.test(e.start)) {
    const [y, m, d] = e.start.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  return Date.parse(e.start);
}

function eventEndMs(e: Pick<CalendarEvent, "end" | "allDay">): number {
  if (e.allDay || /^\d{4}-\d{2}-\d{2}$/.test(e.end)) {
    const [y, m, d] = e.end.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  return Date.parse(e.end);
}

/** Today's events that aren't over or declined: all-day ones first, then by start time. */
export function todaysAgenda(events: CalendarEvent[], now: number, max = 4): CalendarEvent[] {
  const today = dayKey(new Date(now));
  return events
    .filter((e) => !e.declined)
    .filter((e) => (e.allDay ? e.start.slice(0, 10) <= today && eventEndMs(e) > now : dayKey(new Date(eventStartMs(e))) === today && eventEndMs(e) > now))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || eventStartMs(a) - eventStartMs(b))
    .slice(0, max);
}

/** The next timed meeting today that hasn't started yet (declined and all-day ones skipped). */
export function nextEvent(events: CalendarEvent[], now: number): CalendarEvent | null {
  const today = dayKey(new Date(now));
  return (
    events
      .filter((e) => !e.declined && !e.allDay)
      .filter((e) => eventStartMs(e) > now && dayKey(new Date(eventStartMs(e))) === today)
      .sort((a, b) => eventStartMs(a) - eventStartMs(b))[0] ?? null
  );
}

/** The meeting happening right now, if any. */
export function currentEvent(events: CalendarEvent[], now: number): CalendarEvent | null {
  return events.find((e) => !e.declined && !e.allDay && eventStartMs(e) <= now && eventEndMs(e) > now) ?? null;
}

/** "Next: Design sync in 25 min" (null when nothing else is on today). */
export function nextHeadline(events: CalendarEvent[], now: number): string | null {
  const n = nextEvent(events, now);
  return n ? `Next: ${n.title} in ${untilLabel(eventStartMs(n) - now)}` : null;
}

const HHMM = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" });
/** "10:30 AM" (locale) or "All day". */
export function eventTimeLabel(e: Pick<CalendarEvent, "start" | "allDay">): string {
  if (e.allDay) return "All day";
  const t = eventStartMs(e);
  return Number.isNaN(t) ? "" : HHMM.format(new Date(t));
}
