// Due dates are shown and grouped by the user's LOCAL day. Run west of UTC (where a plain
// "2026-11-14" read as UTC midnight is the evening before) and east of it (where a UTC timestamp's
// date can be a day behind the local one).
import { afterAll, describe, expect, it } from "vitest";
import type { Todo } from "./types";

// node global, without pulling @types/node into the app tsconfig
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const saved = env.TZ;
afterAll(() => {
  env.TZ = saved;
});

for (const tz of ["America/Los_Angeles", "Asia/Kolkata"]) {
  describe(`due dates in ${tz}`, async () => {
    env.TZ = tz;
    const { dueDay, formatDue, groupTodos } = await import("./format");

    it("a plain date is that local day: Today, not Yesterday", () => {
      env.TZ = tz;
      const now = new Date(2026, 10, 14, 9, 0);
      expect(dueDay("2026-11-14")).toBe("2026-11-14");
      expect(formatDue("2026-11-14", now)).toBe("Today");
      expect(formatDue("2026-11-15", now)).toBe("Tomorrow");
    });

    it("a timestamp lands on its local day", () => {
      env.TZ = tz;
      const tomorrowEarly = new Date(2026, 10, 15, 0, 30).toISOString();
      const tonight = new Date(2026, 10, 14, 23, 0).toISOString();
      expect(dueDay(tomorrowEarly)).toBe("2026-11-15");
      expect(dueDay(tonight)).toBe("2026-11-14");
      const base = { title: "x", source: "manual", status: "open", createdAt: new Date(2026, 10, 14, 8).toISOString() } as const;
      const g = groupTodos(
        [
          { ...base, id: "tonight", due: tonight },
          { ...base, id: "tomorrow", due: tomorrowEarly },
        ] as Todo[],
        new Date(2026, 10, 14, 12, 0),
      );
      expect(g.today.map((t) => t.id)).toEqual(["tonight"]);
      expect(g.upcoming.map((t) => t.id)).toEqual(["tomorrow"]);
    });
  });
}
