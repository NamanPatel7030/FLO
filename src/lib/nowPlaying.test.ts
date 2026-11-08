import { describe, expect, it } from "vitest";
import { elapsedNow, mediaVisible, PAUSE_HIDE_MS, sameMedia, vividTint } from "./nowPlaying";
import type { NowPlaying } from "./types";

const np = (o: Partial<NowPlaying> = {}): NowPlaying => ({ app: "Spotify", title: "Night Owl", artist: "Galimatias", album: "", playing: true, elapsed: 40, elapsedAt: 1_000_000, duration: 214, ...o });

describe("elapsedNow", () => {
  it("interpolates from elapsedAt while playing", () => {
    expect(elapsedNow(np(), 1_005_000)).toBeCloseTo(45);
  });
  it("freezes while paused", () => {
    expect(elapsedNow(np({ playing: false }), 1_005_000)).toBe(40);
  });
  it("clamps to the duration and handles missing data", () => {
    expect(elapsedNow(np(), 1_000_000 + 999_000)).toBe(214);
    expect(elapsedNow(np({ elapsed: undefined }))).toBeUndefined();
    expect(elapsedNow(null)).toBeUndefined();
  });
});

describe("mediaVisible", () => {
  it("shows while playing, hides when nothing plays", () => {
    expect(mediaVisible({ np: np(), pausedSince: 0 })).toBe(true);
    expect(mediaVisible({ np: null, pausedSince: 0 })).toBe(false);
  });
  it("keeps paused media for ~30 s, then lets go", () => {
    const now = 5_000_000;
    expect(mediaVisible({ np: np({ playing: false }), pausedSince: now - 1000 }, now)).toBe(true);
    expect(mediaVisible({ np: np({ playing: false }), pausedSince: now - PAUSE_HIDE_MS - 1 }, now)).toBe(false);
  });
});

describe("sameMedia", () => {
  it("ignores samples that only differ by the interpolated clock", () => {
    expect(sameMedia(np(), np({ elapsed: 41, elapsedAt: 1_001_000 }))).toBe(true);
    expect(sameMedia(np(), np({ playing: false }))).toBe(false);
    expect(sameMedia(np(), np({ title: "Weightless" }))).toBe(false);
  });
});

describe("vividTint", () => {
  it("lifts dark colours so they read on black", () => {
    const m = vividTint(20, 10, 60).match(/hsl\((\d+) (\d+)% (\d+)%\)/)!;
    expect(Number(m[3])).toBeGreaterThanOrEqual(62);
  });
});
