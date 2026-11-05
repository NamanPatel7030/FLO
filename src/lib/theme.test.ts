import { describe, it, expect } from "vitest";
import { normalizeHex, hexToRgb, lighten, darken, mix, deriveGradient, resolveTheme } from "./theme";

describe("hex helpers", () => {
  it("normalizes #rgb, #rrggbb and junk", () => {
    expect(normalizeHex("#3dbbff")).toBe("#3dbbff");
    expect(normalizeHex("3DBBFF")).toBe("#3dbbff");
    expect(normalizeHex("#09f")).toBe("#0099ff");
    expect(normalizeHex("nope")).toBe("#3dbbff"); // falls back to default
  });
  it("parses to rgb", () => {
    expect(hexToRgb("#3dbbff")).toEqual([61, 187, 255]);
  });
  it("lighten moves toward white, darken toward black", () => {
    expect(lighten("#000000", 1)).toBe("#ffffff");
    expect(darken("#ffffff", 1)).toBe("#000000");
    expect(mix("#808080", 0)).toBe("#808080");
    // lighten a mid blue stays a valid lighter hex
    const l = lighten("#3dbbff", 0.3);
    expect(l).toMatch(/^#[0-9a-f]{6}$/);
    expect(hexToRgb(l)[0]).toBeGreaterThan(61);
  });
});

describe("deriveGradient", () => {
  it("uses explicit notchGradient when valid", () => {
    expect(deriveGradient({ accent: "#3dbbff", notchGradient: ["#111111", "#eeeeee"] })).toEqual(["#111111", "#eeeeee"]);
  });
  it("derives from accent when gradient empty", () => {
    const [from, to] = deriveGradient({ accent: "#3dbbff", notchGradient: [] });
    expect(from).toMatch(/^#[0-9a-f]{6}$/);
    expect(to).toMatch(/^#[0-9a-f]{6}$/);
    expect(from).not.toBe(to);
  });
});

describe("resolveTheme", () => {
  it("passes through explicit modes", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });
  it("resolves system via matchMedia (jsdom defaults to no-match → dark)", () => {
    expect(resolveTheme("system")).toBe("dark");
  });
});
