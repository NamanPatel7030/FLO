import { describe, it, expect, beforeEach } from "vitest";
import {
  CITIES,
  MAX_ZONES,
  dayOffset,
  dayOffsetLabel,
  formatZoneTime,
  hourDiffLabel,
  isDaytime,
  isValidZone,
  loadZones,
  sanitizeZones,
  saveZones,
  searchCities,
  utcOffsetMinutes,
  zoneParts,
} from "./timezones";
import { widgetHeight, widgetSpan, widgetsBodyHeight, packWidgetRows } from "./widgets";

// 2026-01-15 23:30 UTC — late evening in London, next morning across Asia, afternoon in the US.
const T = new Date(Date.UTC(2026, 0, 15, 23, 30));

describe("zone maths", () => {
  it("reads wall-clock parts in a zone", () => {
    expect(zoneParts(T, "UTC")).toMatchObject({ year: 2026, month: 1, day: 15, hour: 23, minute: 30 });
    expect(zoneParts(T, "Asia/Tokyo")).toMatchObject({ day: 16, hour: 8, minute: 30 });
  });
  it("computes UTC offsets, including half-hour and DST zones", () => {
    expect(utcOffsetMinutes(T, "UTC")).toBe(0);
    expect(utcOffsetMinutes(T, "Asia/Kolkata")).toBe(330);
    expect(utcOffsetMinutes(T, "America/New_York")).toBe(-300); // EST in January
    expect(utcOffsetMinutes(new Date(Date.UTC(2026, 6, 1, 12)), "America/New_York")).toBe(-240); // EDT
    expect(utcOffsetMinutes(T, "Asia/Kathmandu")).toBe(345);
  });
  it("gives the calendar-day offset relative to a base zone", () => {
    expect(dayOffset(T, "Asia/Tokyo", "UTC")).toBe(1);
    expect(dayOffset(T, "Europe/London", "UTC")).toBe(0);
    expect(dayOffset(T, "UTC", "Asia/Tokyo")).toBe(-1);
    expect(dayOffset(new Date(Date.UTC(2026, 0, 16, 2)), "America/Los_Angeles", "UTC")).toBe(-1);
  });
  it("labels day offsets with a true minus sign", () => {
    expect(dayOffsetLabel(0)).toBe("");
    expect(dayOffsetLabel(1)).toBe("+1");
    expect(dayOffsetLabel(-1)).toBe("−1");
  });
  it("labels hour differences", () => {
    expect(hourDiffLabel(T, "Asia/Kolkata", "UTC")).toBe("+5:30h");
    expect(hourDiffLabel(T, "America/New_York", "UTC")).toBe("−5h");
    expect(hourDiffLabel(T, "Europe/London", "UTC")).toBe("same");
    expect(hourDiffLabel(T, "Asia/Tokyo", "America/New_York")).toBe("+14h");
  });
  it("formats the time and knows day from night", () => {
    expect(formatZoneTime(T, "UTC")).toMatch(/11:30|23:30/);
    expect(isDaytime(T, "UTC")).toBe(false);
    expect(isDaytime(T, "Asia/Tokyo")).toBe(true); // 08:30
  });
});

describe("city list + search", () => {
  it("has ~60 cities, all with valid IANA zones", () => {
    expect(CITIES.length).toBeGreaterThanOrEqual(55);
    for (const c of CITIES) expect(isValidZone(c.tz), c.tz).toBe(true);
  });
  it("ranks prefix matches first and searches country / zone id", () => {
    expect(searchCities("lon")[0].city).toBe("London");
    expect(searchCities("new")[0].city).toBe("New York");
    expect(searchCities("japan").map((c) => c.city)).toContain("Tokyo");
    expect(searchCities("kolkata").map((c) => c.city)).toContain("Mumbai");
    expect(searchCities("zzzz")).toEqual([]);
  });
  it("hides zones that are already added", () => {
    expect(searchCities("london", [{ city: "London", tz: "Europe/London" }])).toEqual([]);
  });
});

describe("persistence", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const g = globalThis as unknown as { localStorage?: unknown; window?: unknown };
    g.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    };
    g.window = { dispatchEvent: () => true };
  });
  it("drops invalid / duplicate zones and caps the list", () => {
    expect(sanitizeZones([{ city: "Mars", tz: "Mars/Olympus" }, { city: "London", tz: "Europe/London" }, { city: "London", tz: "Europe/London" }, "x"])).toEqual([
      { city: "London", tz: "Europe/London" },
    ]);
    expect(sanitizeZones(CITIES.slice(0, 20))).toHaveLength(MAX_ZONES);
  });
  it("round-trips through storage", () => {
    expect(loadZones()).toEqual([]);
    saveZones([{ city: "Tokyo", tz: "Asia/Tokyo" }]);
    expect(loadZones()).toEqual([{ city: "Tokyo", tz: "Asia/Tokyo" }]);
  });
  it("widens and grows the clock tile with zones, so the notch panel sizes to fit", () => {
    expect(widgetSpan("clock", 0)).toBe(1);
    expect(widgetSpan("clock", 2)).toBe(2);
    expect(widgetHeight("clock", 0)).toBe(96);
    expect(widgetHeight("clock", 5)).toBeGreaterThan(widgetHeight("clock", 2));
    const before = widgetsBodyHeight(["timer", "clock"]);
    saveZones([{ city: "Tokyo", tz: "Asia/Tokyo" }, { city: "London", tz: "Europe/London" }, { city: "New York", tz: "America/New_York" }, { city: "Sydney", tz: "Australia/Sydney" }]);
    // the clock now takes its own row below the stopwatch
    expect(packWidgetRows(["timer", "clock"])).toEqual([["timer"], ["clock"]]);
    expect(widgetsBodyHeight(["timer", "clock"])).toBeGreaterThan(before);
  });
});
