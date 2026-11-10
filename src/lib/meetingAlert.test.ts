import { describe, expect, it } from "vitest";
import {
  alertExpired,
  attendeeSummary,
  countdownLabel,
  eventTimeLabel,
  firstName,
  joinLabel,
  nextEvent,
  nextHeadline,
  tickMs,
  todaysAgenda,
  untilLabel,
  upsertAlert,
} from "./meetingAlert";
import type { CalendarEvent, MeetingAlert } from "./types";

const MIN = 60_000;
// a fixed local "now": 10 Nov 2026, 10:00 local time
const NOW = new Date(2026, 10, 10, 10, 0, 0).getTime();
const at = (mins: number) => new Date(NOW + mins * MIN).toISOString();

const ev = (o: Partial<CalendarEvent>): CalendarEvent => ({
  id: "e1",
  calendarId: "primary",
  title: "Design sync",
  start: at(25),
  end: at(55),
  allDay: false,
  attendees: [],
  declined: false,
  ...o,
});

describe("countdownLabel", () => {
  it("counts down in minutes, rounding up", () => {
    expect(countdownLabel(at(5), NOW)).toBe("in 5 min");
    expect(countdownLabel(NOW + 4 * MIN + 10_000, NOW)).toBe("in 5 min");
    expect(countdownLabel(at(1), NOW)).toBe("in 1 min");
  });
  it("counts seconds in the last minute", () => {
    expect(countdownLabel(NOW + 40_000, NOW)).toBe("in 40 sec");
  });
  it("says Starting now at the start time or when the backend says phase now", () => {
    expect(countdownLabel(NOW, NOW)).toBe("Starting now");
    expect(countdownLabel(NOW - 30_000, NOW)).toBe("Starting now");
    expect(countdownLabel(at(3), NOW, "now")).toBe("Starting now");
  });
  it("says how long ago once it is well under way", () => {
    expect(countdownLabel(at(-4), NOW)).toBe("Started 4 min ago");
  });
  it("handles hours", () => {
    expect(untilLabel(65 * MIN)).toBe("1 h 5 min");
    expect(untilLabel(120 * MIN)).toBe("2 h");
  });
  it("ticks every second near the start", () => {
    expect(tickMs(NOW + 30_000, NOW)).toBe(1000);
    expect(tickMs(at(20), NOW)).toBe(15_000);
  });
});

describe("attendeeSummary", () => {
  it("lists first names", () => {
    expect(attendeeSummary(["Priya Shah", "Rahul Mehta", "Sam Lee"], 3)).toBe("Priya, Rahul and Sam");
    expect(attendeeSummary(["Priya Shah"], 1)).toBe("Priya");
    expect(attendeeSummary(["Priya Shah", "rahul.mehta"], 2)).toBe("Priya and Rahul");
  });
  it("summarises long lists", () => {
    expect(attendeeSummary(["Priya", "Rahul", "Sam", "Meera"], 9)).toBe("Priya, Rahul and 7 others");
    expect(attendeeSummary(["Priya", "Rahul"], 3)).toBe("Priya, Rahul and 1 other");
  });
  it("says so when nobody else is invited", () => {
    expect(attendeeSummary([], 0)).toBe("No other guests");
    expect(attendeeSummary([], 4)).toBe("4 guests");
  });
  it("firstName", () => {
    expect(firstName("dhruv@example.com")).toBe("Dhruv");
  });
});

describe("joinLabel", () => {
  it("names the app", () => {
    expect(joinLabel("meet")).toBe("Join Meet");
    expect(joinLabel("zoom")).toBe("Join Zoom");
    expect(joinLabel("teams")).toBe("Join Teams");
    expect(joinLabel("other")).toBe("Join");
    expect(joinLabel()).toBe("Join");
  });
});

describe("alert queue", () => {
  const a = (o: Partial<MeetingAlert> = {}): MeetingAlert => ({
    id: "e1@t",
    eventId: "e1",
    title: "Design sync",
    start: at(5),
    end: at(35),
    attendees: [],
    attendeeCount: 0,
    phase: "soon",
    ...o,
  });
  it("same id updates in place, a new id queues", () => {
    const q = upsertAlert([a(), a({ id: "e2@t" })], a({ phase: "now" }));
    expect(q.map((x) => [x.id, x.phase])).toEqual([
      ["e1@t", "now"],
      ["e2@t", "soon"],
    ]);
    expect(upsertAlert(q, a({ id: "e3@t" }))).toHaveLength(3);
  });
  it("expires 10 minutes after the start", () => {
    expect(alertExpired(a({ start: at(-9) }), NOW)).toBe(false);
    expect(alertExpired(a({ start: at(-10) }), NOW)).toBe(true);
  });
});

describe("agenda", () => {
  const events = [
    ev({ id: "later", title: "1:1 with Priya", start: at(180), end: at(210) }),
    ev({ id: "next", title: "Design sync", start: at(25), end: at(55) }),
    ev({ id: "past", title: "Standup", start: at(-60), end: at(-45) }),
    ev({ id: "declined", title: "Vendor pitch", start: at(60), end: at(90), declined: true }),
    ev({ id: "allday", title: "Offsite prep", start: "2026-11-10", end: "2026-11-11", allDay: true }),
    ev({ id: "tomorrow", title: "Retro", start: at(26 * 60), end: at(27 * 60) }),
  ];
  it("lists today's remaining events, all-day first, without declined ones", () => {
    expect(todaysAgenda(events, NOW).map((e) => e.id)).toEqual(["allday", "next", "later"]);
  });
  it("finds the next timed meeting and words the headline", () => {
    expect(nextEvent(events, NOW)?.id).toBe("next");
    expect(nextHeadline(events, NOW)).toBe("Next: Design sync in 25 min");
    expect(nextHeadline([], NOW)).toBeNull();
    expect(nextHeadline([events[4]], NOW)).toBeNull();
  });
  it("labels times", () => {
    expect(eventTimeLabel(events[4])).toBe("All day");
    expect(eventTimeLabel(events[1])).toMatch(/10:25/);
  });
});
