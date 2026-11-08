import { describe, expect, it } from "vitest";
import { acHeadline, countdown, resetLabel, visibleEntries, type AutoContinue } from "./autoContinue";

// local-time dates
const d = (y: number, mo: number, day: number, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, day, h, mi, s);
const now = d(2026, 11, 8, 10, 0).getTime(); // a Sunday

const entry = (o: Partial<AutoContinue> = {}): AutoContinue => ({
  sessionId: "s1",
  project: "api",
  cwd: "/x/api",
  limitedAt: d(2026, 11, 8, 9, 50).toISOString(),
  resetsAt: d(2026, 11, 8, 15, 0).toISOString(),
  nextCheckAt: d(2026, 11, 8, 15, 1).toISOString(),
  reason: "5-hour limit reached ∙ resets 3pm",
  status: "waiting",
  enabled: null,
  cycles: 0,
  cycleDay: "2026-11-08",
  detail: null,
  tzNote: null,
  updatedAt: d(2026, 11, 8, 9, 50).toISOString(),
  auto: true,
  ...o,
});

describe("auto-continue formatting", () => {
  it("labels the reset time relative to today", () => {
    expect(resetLabel(d(2026, 11, 8, 15, 0).toISOString(), now)).toBe("3:00 PM");
    expect(resetLabel(d(2026, 11, 9, 9, 0).toISOString(), now)).toBe("tomorrow 9:00 AM");
    expect(resetLabel(d(2026, 11, 12, 18, 30).toISOString(), now)).toBe("Thu 6:30 PM");
    expect(resetLabel(d(2026, 12, 24, 17, 0).toISOString(), now)).toBe("Dec 24, 5:00 PM");
    expect(resetLabel(null, now)).toBe("");
  });

  it("counts down", () => {
    expect(countdown(d(2026, 11, 8, 11, 12).toISOString(), now)).toBe("1h 12m");
    expect(countdown(d(2026, 11, 8, 10, 4, 5).toISOString(), now)).toBe("4m 05s");
    expect(countdown(d(2026, 11, 9, 13, 0).toISOString(), now)).toBe("1d 3h");
    expect(countdown(d(2026, 11, 8, 9, 0).toISOString(), now)).toBe("now");
  });

  it("headlines follow the status and the switch", () => {
    expect(acHeadline(entry(), now)).toBe("Resumes 3:00 PM");
    expect(acHeadline(entry({ auto: false }), now)).toBe("Resets 3:00 PM");
    expect(acHeadline(entry({ resetsAt: null, nextCheckAt: d(2026, 11, 8, 10, 15).toISOString() }), now)).toBe("Retrying 10:15 AM");
    expect(acHeadline(entry({ status: "resuming" }), now)).toBe("Resumed — continuing");
    expect(acHeadline(entry({ status: "cancelled" }), now)).toBe("Auto-continue cancelled");
  });

  it("shows active entries and recently finished ones", () => {
    const old = entry({ sessionId: "o", status: "resumed", updatedAt: d(2026, 11, 8, 1, 0).toISOString() });
    const recent = entry({ sessionId: "r", status: "failed", updatedAt: d(2026, 11, 8, 9, 0).toISOString() });
    const waitingOld = entry({ sessionId: "w", updatedAt: d(2026, 11, 7, 1, 0).toISOString() });
    expect(visibleEntries([old, recent, waitingOld], now).map((a) => a.sessionId)).toEqual(["r", "w"]);
  });
});
