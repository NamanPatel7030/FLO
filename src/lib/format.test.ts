import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatClock,
  formatNumber,
  relativeTime,
  greeting,
  countWords,
  groupTodos,
  groupByDay,
  islandSize,
  ISLAND_EAR,
  ISLAND_ROW,
  ISLAND_WING,
  smoothLevels,
} from "./format";
import type { Todo } from "./types";

describe("formatDuration", () => {
  it("formats seconds/minutes/hours", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(90)).toBe("1m 30s");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(3720)).toBe("1h 2m");
  });
});

describe("formatClock", () => {
  it("formats mm:ss and h:mm:ss", () => {
    expect(formatClock(5)).toBe("0:05");
    expect(formatClock(125)).toBe("2:05");
    expect(formatClock(3725)).toBe("1:02:05");
  });
});

describe("formatNumber", () => {
  it("compacts large numbers", () => {
    expect(formatNumber(950)).toBe("950");
    expect(formatNumber(1234)).toBe("1.2k");
    expect(formatNumber(12000)).toBe("12k");
    expect(formatNumber(2_500_000)).toBe("2.5M");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-11-05T12:00:00Z").getTime();
  it("handles recent and older times", () => {
    expect(relativeTime("2026-11-05T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-11-05T11:55:00Z", now)).toBe("5m ago");
    expect(relativeTime("2026-11-05T09:00:00Z", now)).toBe("3h ago");
    expect(relativeTime("2026-11-03T12:00:00Z", now)).toBe("2d ago");
  });
});

describe("greeting", () => {
  it("depends on hour", () => {
    expect(greeting(8)).toBe("Good morning");
    expect(greeting(14)).toBe("Good afternoon");
    expect(greeting(20)).toBe("Good evening");
    expect(greeting(2)).toBe("Working late");
  });
});

describe("countWords", () => {
  it("counts words", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  hello   world ")).toBe(2);
  });
});

describe("groupTodos", () => {
  const base: Omit<Todo, "id" | "status" | "source"> = {
    title: "x",
    createdAt: "2026-11-05T08:00:00Z",
  };
  const today = new Date("2026-11-05T12:00:00");
  it("splits into today/upcoming/screen/done", () => {
    const todos: Todo[] = [
      { ...base, id: "1", status: "open", source: "voice" },
      { ...base, id: "2", status: "open", source: "manual", due: "2026-11-09" },
      { ...base, id: "3", status: "open", source: "attention" },
      { ...base, id: "4", status: "done", source: "voice" },
      { ...base, id: "5", status: "dismissed", source: "attention" },
      { ...base, id: "6", status: "open", source: "manual", due: "2026-11-05" },
    ];
    const g = groupTodos(todos, today);
    expect(g.today.map((t) => t.id)).toEqual(["1", "6"]);
    expect(g.upcoming.map((t) => t.id)).toEqual(["2"]);
    expect(g.screen.map((t) => t.id)).toEqual(["3"]);
    expect(g.done.map((t) => t.id)).toEqual(["4"]);
  });
});

describe("islandSize", () => {
  const geo = { platform: "macos" as const, hasNotch: true, notchWidth: 200, notchHeight: 32, screenWidth: 1512 };
  it("collapsed equals notch", () => {
    expect(islandSize("collapsed", geo)).toEqual({ width: 200, height: 32 });
  });
  it("grows for other variants and is never narrower than notch", () => {
    const l = islandSize("listening", geo);
    expect(l.width).toBeGreaterThan(200);
    expect(islandSize("card", geo).width).toBeLessThanOrEqual(520 + 40);
  });
  it("assistant card height fits content: short reply is shorter than long reply with results", () => {
    const short = islandSize("card", geo, { replyChars: 60, results: 0 });
    const long = islandSize("card", geo, { replyChars: 400, results: 2 });
    expect(short.height).toBeLessThan(long.height);
    expect(long.height).toBeLessThanOrEqual(32 + 228);
  });
  it("claude reminder card is wider than the notch but smaller than the assistant card", () => {
    const c = islandSize("claude", geo);
    expect(c.width).toBeGreaterThan(200);
    expect(c.height).toBeLessThan(islandSize("card", geo).height);
  });
  for (const nh of [32, 38]) {
    const g = { ...geo, notchHeight: nh, notchWidth: nh === 32 ? 185 : 200 };
    it(`done stays flush with the notch (nh=${nh}) with symmetric wings`, () => {
      const s = islandSize("done", g);
      expect(s.height).toBe(nh);
      expect((s.width - g.notchWidth) / 2).toBe(ISLAND_WING + ISLAND_EAR);
    });
    it(`listening/working drop a status row below the notch (nh=${nh})`, () => {
      for (const v of ["listening", "working"] as const) {
        const s = islandSize(v, g);
        expect(s.height).toBe(nh + ISLAND_ROW);
        // wings must still fit beside the notch, symmetric
        expect((s.width - g.notchWidth) / 2).toBeGreaterThanOrEqual(ISLAND_WING + ISLAND_EAR);
        expect(Number.isInteger(s.width - g.notchWidth)).toBe(true);
        expect((s.width - g.notchWidth) % 2).toBe(0);
      }
    });
    it(`error height fits the message: longer message → taller, capped at 3 lines (nh=${nh})`, () => {
      const short = islandSize("error", g, { textChars: 20 });
      const mid = islandSize("error", g, { textChars: 90 });
      const huge = islandSize("error", g, { textChars: 2000 });
      const fix = islandSize("error", g, { textChars: 90, action: true });
      expect(short.height).toBeGreaterThan(nh);
      expect(mid.height).toBeGreaterThan(short.height);
      expect(huge.height).toBeGreaterThan(mid.height);
      expect(huge.height).toBe(islandSize("error", g, { textChars: 5000 }).height);
      expect(fix.height).toBeGreaterThan(mid.height);
    });
    it(`result shows up to 2 lines of pasted text (nh=${nh})`, () => {
      const one = islandSize("result", g, { textChars: 10 });
      const two = islandSize("result", g, { textChars: 400 });
      expect(one.height).toBeGreaterThan(nh);
      expect(two.height).toBeGreaterThan(one.height);
      expect(islandSize("result", g, { textChars: 4000 }).height).toBe(two.height);
    });
    it(`history grows with rows, capped at 6 (nh=${nh})`, () => {
      const a = islandSize("history", g, { rows: 1 });
      const b = islandSize("history", g, { rows: 6 });
      expect(b.height).toBeGreaterThan(a.height);
      expect(islandSize("history", g, { rows: 20 }).height).toBe(b.height);
      expect(b.width).toBeGreaterThan(g.notchWidth);
    });
  }
  it("windows capsule sizes error/result/history from content too", () => {
    const w = { ...geo, platform: "windows" as const, hasNotch: false };
    expect(islandSize("error", w, { textChars: 200 }).height).toBeGreaterThan(islandSize("error", w, { textChars: 10 }).height);
    expect(islandSize("history", w, { rows: 6 }).height).toBeGreaterThan(islandSize("history", w, { rows: 1 }).height);
    expect(islandSize("result", w, { textChars: 10 }).height).toBeGreaterThan(30);
  });
  it("windows collapsed is a capsule, not zero", () => {
    const w = islandSize("collapsed", { ...geo, platform: "windows", hasNotch: false });
    expect(w.width).toBeGreaterThan(40);
    expect(w.height).toBeGreaterThan(30);
  });
});

describe("smoothLevels", () => {
  it("returns n bars between 0 and 1 and moves toward target", () => {
    const prev = new Array(24).fill(0);
    const next = smoothLevels(prev, 0.8, 0);
    expect(next).toHaveLength(24);
    next.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
    expect(Math.max(...next)).toBeGreaterThan(0);
    const silent = smoothLevels(next, 0, 1);
    expect(Math.max(...silent)).toBeLessThan(Math.max(...next));
  });
});

describe("groupByDay", () => {
  const now = new Date(2026, 10, 5, 15, 0);
  const at = (d: number, h: number) => new Date(2026, 10, d, h, 0).toISOString();
  it("buckets into Today / Yesterday / dated groups, newest first", () => {
    const items = [{ createdAt: at(3, 9) }, { createdAt: at(5, 10) }, { createdAt: at(4, 22) }, { createdAt: at(5, 14) }];
    const g = groupByDay(items, now);
    expect(g.map((x) => x.label)).toEqual(["Today", "Yesterday", expect.stringMatching(/Nov/)]);
    expect(g[0].items.map((i) => i.createdAt)).toEqual([at(5, 14), at(5, 10)]);
  });
  it("returns [] for no items", () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});
