import { describe, expect, it } from "vitest";
import { FAKE_NOTCH, ISLAND_EAR, ISLAND_WING, islandSize, notchBox, notchStyle } from "./format";
import type { IslandGeometry } from "./types";

const notched: IslandGeometry = { platform: "macos", hasNotch: true, notchWidth: 185, notchHeight: 32, screenWidth: 1512 };
// what the backend reports for a Mac screen without a camera housing (menu bar height)
const notchless: IslandGeometry = { platform: "macos", hasNotch: false, notchWidth: 200, notchHeight: 24, screenWidth: 1512 };

describe("notch shape on every Mac", () => {
  it("every Mac hangs the island from the top edge; Windows / Linux keep the capsule", () => {
    expect(notchStyle(notched)).toBe(true);
    expect(notchStyle(notchless)).toBe(true);
    expect(notchStyle({ ...notchless, platform: "windows" })).toBe(false);
    expect(notchStyle(null)).toBe(false);
  });

  it("draws against the hardware notch, or a fake 200x32 one", () => {
    expect(notchBox(notched)).toEqual({ width: 185, height: 32 });
    expect(notchBox(notchless)).toEqual(FAKE_NOTCH);
    expect(notchBox({ ...notchless, notchWidth: 0, notchHeight: 0 })).toEqual(FAKE_NOTCH);
  });

  it("closed: exactly the hardware notch; a fake notch adds room for its shoulders", () => {
    expect(islandSize("collapsed", notched)).toEqual({ width: 185, height: 32 });
    expect(islandSize("collapsed", notchless)).toEqual({ width: 200 + 2 * ISLAND_EAR, height: 32 });
  });

  it("a notchless Mac opens the same live row as a notched one (not the floating capsule)", () => {
    const s = islandSize("listening", notchless);
    expect(s.height).toBe(32);
    expect((s.width - 200) / 2).toBe(ISLAND_WING + ISLAND_EAR);
  });
});
