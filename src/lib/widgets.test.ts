import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_WIDGETS, loadWidgets, packWidgetRows, saveWidgets, widgetsBodyHeight, WIDGET_META, type WidgetId } from "./widgets";

describe("packWidgetRows", () => {
  it("gives span-2 widgets their own row and pairs span-1 widgets", () => {
    // nowPlaying(2), today(2: the scrollable to-do card), timer(1), clock(1)
    expect(packWidgetRows(["nowPlaying", "today", "timer", "clock"])).toEqual([["nowPlaying"], ["today"], ["timer", "clock"]]);
    expect(packWidgetRows(["timer", "pomodoro", "clock"])).toEqual([["timer", "pomodoro"], ["clock"]]);
  });
  it("breaks a span-1 pair when a span-2 interrupts", () => {
    expect(packWidgetRows(["today", "nowPlaying", "timer"])).toEqual([["today"], ["nowPlaying"], ["timer"]]);
  });
  it("handles an empty list", () => {
    expect(packWidgetRows([])).toEqual([]);
  });
});

describe("widgetsBodyHeight", () => {
  it("is taller with more rows", () => {
    const a = widgetsBodyHeight(["nowPlaying"]);
    const b = widgetsBodyHeight(["nowPlaying", "today", "timer", "clock"]);
    expect(b).toBeGreaterThan(a);
  });
  it("accounts for each widget's declared height", () => {
    // two paired span-1 widgets → one row of max tile height + quick-actions + padding
    const h = widgetsBodyHeight(["today", "timer"]);
    expect(h).toBeGreaterThanOrEqual(WIDGET_META.today.h);
  });
});

describe("loadWidgets / saveWidgets", () => {
  // node test env has no DOM: provide a minimal localStorage + window.dispatchEvent
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
  it("falls back to defaults when unset", () => {
    expect(loadWidgets()).toEqual(DEFAULT_WIDGETS);
  });
  it("round-trips a saved list and drops unknown / duplicate ids", () => {
    saveWidgets(["clock", "clock", "bogus" as WidgetId, "timer"]);
    expect(loadWidgets()).toEqual(["clock", "timer"]);
  });
  it("preserves an explicitly empty list", () => {
    saveWidgets([]);
    expect(loadWidgets()).toEqual([]);
  });
});
