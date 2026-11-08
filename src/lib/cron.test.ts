import { describe, expect, it } from "vitest";
import { cronError, cronFromForm, describeCron, formatRun, formFromCron, nextRun } from "./cron";

// local-time dates (the cron runs in local time)
const d = (y: number, mo: number, day: number, h = 0, mi = 0) => new Date(y, mo - 1, day, h, mi);
const fmt = (x: Date | null) => (x ? `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()} ${x.getHours()}:${String(x.getMinutes()).padStart(2, "0")}` : "never");

describe("cron", () => {
  it("computes the next run", () => {
    // Sun 8 Nov 2026 → Mon 9 Nov 09:00
    expect(fmt(nextRun("0 9 * * 1-5", d(2026, 11, 8, 10)))).toBe("2026-11-9 9:00");
    expect(fmt(nextRun("*/15 * * * *", d(2026, 11, 8, 10, 15)))).toBe("2026-11-8 10:30");
    expect(fmt(nextRun("30 8,17 * * *", d(2026, 11, 8, 9)))).toBe("2026-11-8 17:30");
    expect(fmt(nextRun("0 0 1 jan *", d(2026, 11, 8)))).toBe("2027-1-1 0:00");
    expect(fmt(nextRun("0 0 13 * 5", d(2026, 11, 8)))).toBe("2026-11-13 0:00");
    expect(fmt(nextRun("0 12 * * 7", d(2026, 11, 9)))).toBe("2026-11-15 12:00");
    expect(fmt(nextRun("0 0 31 2 *", d(2026, 11, 8)))).toBe("never");
  });

  it("rejects bad expressions with a readable reason", () => {
    for (const bad of ["", "* * * *", "60 * * * *", "* 24 * * *", "*/0 * * * *", "5-1 * * * *", "a * * * *", "* * * * 8"]) expect(cronError(bad)).not.toBeNull();
    expect(cronError("0 9 * * mon-fri")).toBeNull();
    expect(cronError("61 * * * *")).toContain("minute");
  });

  it("describes schedules in plain words", () => {
    expect(describeCron("0 9 * * 1-5")).toBe("every weekday at 09:00");
    expect(describeCron("* * * * *")).toBe("every minute");
    expect(describeCron("*/15 * * * *")).toBe("every 15 minutes");
    expect(describeCron("0 * * * *")).toBe("every hour");
    expect(describeCron("30 * * * *")).toBe("every hour at :30");
    expect(describeCron("30 8 * * 1")).toBe("every Monday at 08:30");
    expect(describeCron("0 18 * * *")).toBe("every day at 18:00");
    expect(describeCron("0 9,17 * * 1,3,5")).toBe("every Mon, Wed and Fri at 09:00 and 17:00");
    expect(describeCron("0 8 1 * *")).toBe("on the 1st of every month at 08:00");
    expect(describeCron("0 10 * * 0,6")).toBe("every weekend at 10:00");
    expect(describeCron("@daily")).toBe("every day at 00:00");
    expect(describeCron("nope")).toBe("Not a valid schedule");
  });

  it("round-trips the friendly presets", () => {
    for (const f of [
      { preset: "hourly", time: "09:00", day: 1, every: 15 },
      { preset: "weekdays", time: "09:00", day: 1, every: 15 },
      { preset: "daily", time: "18:30", day: 1, every: 15 },
      { preset: "weekly", time: "08:05", day: 3, every: 15 },
      { preset: "minutes", time: "09:00", day: 1, every: 20 },
    ] as const) {
      expect(formFromCron(cronFromForm(f))).toEqual(f);
    }
    expect(cronFromForm({ preset: "weekdays", time: "09:00", day: 1, every: 15 })).toBe("0 9 * * 1-5");
    expect(formFromCron("0 9 1 * *").preset).toBe("custom");
  });

  it("formats run times", () => {
    const now = d(2026, 11, 8, 10);
    expect(formatRun(d(2026, 11, 8, 17, 30), now)).toBe("today 17:30");
    expect(formatRun(d(2026, 11, 9, 9), now)).toBe("tomorrow 09:00");
    expect(formatRun(d(2026, 11, 10, 9), now)).toBe("Tue 10 Nov 09:00");
  });
});
