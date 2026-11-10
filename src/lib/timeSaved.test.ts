import { describe, expect, it } from "vitest";
import { TAGLINE, savedLabel, savedSummary } from "./timeSaved";

describe("time saved widget", () => {
  it("has the tagline", () => {
    expect(TAGLINE).toBe("Say it. Save hours.");
  });
  it("formats minutes as a short human label", () => {
    expect(savedLabel(0)).toBe("0 min");
    expect(savedLabel(0.4)).toBe("< 1 min");
    expect(savedLabel(18.4)).toBe("18 min");
    expect(savedLabel(60)).toBe("1 h");
    expect(savedLabel(130)).toBe("2 h 10 min");
  });
  it("nudges when nothing was dictated yet", () => {
    expect(savedSummary(0, 0)).toBe("Hold ⌃ and speak to start saving time.");
    expect(savedSummary(0, 0, "Ctrl")).toBe("Hold Ctrl and speak to start saving time.");
    expect(savedSummary(0, 45)).toBe("45 min saved this week.");
    expect(savedSummary(12, 45)).toBe("12 min today · 45 min this week");
  });
});
