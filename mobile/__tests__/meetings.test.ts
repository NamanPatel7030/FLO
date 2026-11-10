import { nextMeeting, nextMeetingLabel, startsIn } from '../src/lib/meetings';
import { parseComputer } from '../src/lib/computer';
import type { Meeting } from '../src/api/types';

const NOW = Date.parse('2026-11-10T09:05:00Z');
const at = (min: number) => new Date(NOW + min * 60_000).toISOString();
const m = (id: string, startMin: number, endMin: number, title = 'Design sync'): Meeting => ({ id, title, start: at(startMin), end: at(endMin), attendees: 3, join: true });

describe('nextMeetingLabel', () => {
  it('counts down to the next meeting', () => {
    expect(nextMeetingLabel([m('a', 25, 55)], NOW)).toBe('Next meeting · Design sync · in 25 min');
    expect(nextMeetingLabel([m('a', 0.5, 30)], NOW)).toBe('Next meeting · Design sync · in 1 min');
  });

  it('says now once it has started, until it ends', () => {
    expect(nextMeetingLabel([m('a', -10, 20)], NOW)).toBe('Next meeting · Design sync · now');
    expect(nextMeetingLabel([m('a', 0, 20)], NOW)).toBe('Next meeting · Design sync · now');
  });

  it('skips meetings that already ended and picks the soonest', () => {
    const list = [m('old', -60, -1, 'Standup'), m('later', 120, 150, 'Review'), m('soon', 40, 70, '1:1 with Riya')];
    expect(nextMeeting(list, NOW)?.meeting.id).toBe('soon');
    expect(nextMeetingLabel(list, NOW)).toBe('Next meeting · 1:1 with Riya · in 40 min');
  });

  it('is hidden when there is nothing (or only things more than a day away)', () => {
    expect(nextMeetingLabel([], NOW)).toBeNull();
    expect(nextMeetingLabel(undefined, NOW)).toBeNull();
    expect(nextMeetingLabel([m('a', -60, -5)], NOW)).toBeNull();
    expect(nextMeetingLabel([m('a', 25 * 60, 26 * 60)], NOW)).toBeNull();
    expect(nextMeetingLabel([{ ...m('a', 5, 10), start: 'soon' }], NOW)).toBeNull();
  });

  it('formats hours', () => {
    expect(startsIn(NOW + 60 * 60_000, NOW)).toBe('in 1 h');
    expect(startsIn(NOW + 85 * 60_000, NOW)).toBe('in 1 h 25 min');
    expect(startsIn(NOW + 200 * 60_000, NOW)).toBe('in 3 h');
    expect(startsIn(NOW + 59.2 * 60_000, NOW)).toBe('in 1 h');
  });
});

describe('parseComputer meetings', () => {
  it('keeps valid meetings (max 3) and defaults to []', () => {
    expect(parseComputer({ state: { v: 1 } }).state?.meetings).toEqual([]);
    const meetings = [
      { id: 'e1', title: 'Design sync', start: at(25), end: at(55), attendees: 4, join: true, location: 'Room 4' },
      { id: 'e2', title: '', start: at(30), end: at(60) },
      { id: 'e3', title: 'Bad time', start: 'later', end: at(60) },
      { id: 'e4', title: 'Review', start: at(90), end: at(120), attendees: -3, join: 'yes' },
      { id: 'e5', title: 'C', start: at(100), end: at(120) },
      { id: 'e6', title: 'D', start: at(110), end: at(120) },
    ];
    const got = parseComputer({ state: { v: 1, meetings } }).state?.meetings ?? [];
    expect(got.map((x) => x.id)).toEqual(['e1', 'e4', 'e5']);
    expect(got[0]).toEqual({ id: 'e1', title: 'Design sync', start: at(25), end: at(55), attendees: 4, join: true });
    expect(got[1]).toMatchObject({ attendees: 0, join: false });
  });
});
