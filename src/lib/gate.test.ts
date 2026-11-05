import { describe, expect, it } from "vitest";
import { gateLevel, initialGate } from "./gate";

/** feed `rms(t)` at 30 Hz for `sec` seconds, return the last level */
function run(st = initialGate(), sec: number, rms: (t: number) => number) {
  const dt = 1 / 30;
  let level = 0;
  for (let t = 0; t < sec; t += dt) level = gateLevel(st, rms(t), dt);
  return { st, level };
}

describe("gateLevel (adaptive noise gate)", () => {
  it("silence stays at ~0", () => {
    expect(run(undefined, 3, () => 0.002).level).toBeLessThan(0.02);
  });

  it("speech after silence rises clearly", () => {
    const { st } = run(undefined, 2, () => 0.004);
    const { level } = run(st, 0.4, (t) => 0.18 + 0.06 * Math.sin(t * 30));
    expect(level).toBeGreaterThan(0.6);
  });

  it("a steady hum adapts back to ~0", () => {
    const { level } = run(undefined, 10, () => 0.06);
    expect(level).toBeLessThan(0.05);
  });

  it("speech over a hum still reads as speech", () => {
    const { st } = run(undefined, 8, () => 0.05);
    const { level } = run(st, 0.4, () => 0.22);
    expect(level).toBeGreaterThan(0.5);
  });

  it("stays within 0..1 and ignores bad input", () => {
    const st = initialGate();
    expect(gateLevel(st, 5, 1 / 30)).toBeLessThanOrEqual(1);
    expect(gateLevel(st, Number.NaN, 1 / 30)).toBeGreaterThanOrEqual(0);
    expect(gateLevel(st, -1, 1 / 30)).toBeGreaterThanOrEqual(0);
  });
});
