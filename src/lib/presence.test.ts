import { describe, expect, it } from "vitest";
import { countdown, presenceHint, qrMatrix, qrPath } from "./presence";

describe("presence helpers", () => {
  it("builds a square QR matrix with finder patterns", () => {
    const m = qrMatrix("flo-pair://flo.app/483920");
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((r) => r.length === m.length)).toBe(true);
    // top-left finder: a 7x7 dark ring
    expect(m[0].slice(0, 7).every(Boolean)).toBe(true);
    expect(m[6].slice(0, 7).every(Boolean)).toBe(true);
    expect(m[1][1]).toBe(false);
    expect(qrPath([[true, false]], 2)).toBe("M2 2h1v1h-1z");
  });

  it("formats the countdown", () => {
    expect(countdown(300_000)).toBe("5:00");
    expect(countdown(61_500)).toBe("1:02");
    expect(countdown(-5)).toBe("0:00");
  });

  it("explains the state", () => {
    expect(presenceHint({ status: "active", signedIn: true, auto: false })).toMatch(/Nothing goes to your phone/);
    expect(presenceHint({ status: "away", signedIn: true, auto: false })).toMatch(/go to your phone/);
    expect(presenceHint({ status: "away", signedIn: false, auto: false })).toMatch(/Sign in/);
    expect(presenceHint({ status: "away", signedIn: true, auto: true })).toMatch(/locked or idle/);
  });
});
