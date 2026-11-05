import { describe, expect, it } from "vitest";
import { buildPracticeText, computeWpm, minutesSavedPer1000, PASSAGES } from "./typing";

describe("computeWpm", () => {
  it("net WPM = ((correct/5) − uncorrected errors) / minutes", () => {
    const target = "a".repeat(300);
    // 250 correct chars in 1 minute → 50 wpm, no errors
    expect(computeWpm("a".repeat(250), target, 60000)).toMatchObject({ net: 50, gross: 50, accuracy: 100, errors: 0 });
    // 200 correct + 50 wrong in 1 minute → gross 50, net (40 − 50) clamps to 0
    const typed = "a".repeat(200) + "b".repeat(50);
    const r = computeWpm(typed, target, 60000);
    expect(r.gross).toBe(50);
    expect(r.net).toBe(0);
    expect(r.accuracy).toBe(80);
  });
  it("scales with time and counts each uncorrected error once", () => {
    const target = "the quick brown fox ".repeat(40);
    const typed = target.slice(0, 200).replace("quick", "quack"); // 1 wrong char
    const r = computeWpm(typed, target, 30000); // 0.5 min
    expect(r.errors).toBe(1);
    expect(r.net).toBe(Math.round((199 / 5 - 1) / 0.5));
  });
  it("is safe at the very start", () => {
    expect(computeWpm("", "abc", 0)).toMatchObject({ net: 0, gross: 0, accuracy: 100 });
  });
});

describe("helpers", () => {
  it("time saved per 1,000 words vs ~150 wpm speech", () => {
    expect(minutesSavedPer1000(40)).toBe(18.3); // 25 − 6.7
    expect(minutesSavedPer1000(200)).toBe(0);
    expect(minutesSavedPer1000(0)).toBe(0);
  });
  it("passages are natural text without em dashes, long enough for 5 minutes", () => {
    for (const p of PASSAGES) expect(p).not.toMatch(/[—–]/);
    expect(buildPracticeText(1).split(" ").length).toBeGreaterThan(300);
  });
});
