// "Next meeting · Design sync · in 25 min" for the Home screen, from the computer's calendar snapshot.
// Pure (unit-tested in __tests__/meetings.test.ts).
import type { Meeting } from '../api/types';

export interface NextMeeting {
  meeting: Meeting;
  /** "now" once it has started, else "in 25 min" / "in 1 h 5 min" / "in 3 h" */
  when: string;
  label: string;
}

/** "in 25 min", "in 1 h 5 min", "in 3 h"; "now" once started. */
export function startsIn(startMs: number, now: number): string {
  const min = Math.ceil((startMs - now) / 60_000);
  if (min <= 0) return 'now';
  if (min < 60) return `in ${min} min`;
  if (min >= 180) return `in ${Math.round(min / 60)} h`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}

/**
 * The first meeting that hasn't ended yet (the snapshot can be a few minutes old), or null.
 * Meetings more than 24 hours away aren't shown.
 */
export function nextMeeting(meetings: readonly Meeting[] | undefined, now: number = Date.now()): NextMeeting | null {
  const upcoming = (meetings ?? [])
    .map((m) => ({ m, start: Date.parse(m.start), end: Date.parse(m.end) }))
    .filter((x) => !Number.isNaN(x.start) && !Number.isNaN(x.end) && x.end > now && x.start - now <= 24 * 3_600_000)
    .sort((a, b) => a.start - b.start)[0];
  if (!upcoming) return null;
  const when = startsIn(upcoming.start, now);
  return { meeting: upcoming.m, when, label: `Next meeting · ${upcoming.m.title} · ${when}` };
}

export function nextMeetingLabel(meetings: readonly Meeting[] | undefined, now: number = Date.now()): string | null {
  return nextMeeting(meetings, now)?.label ?? null;
}
