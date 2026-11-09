import { describe, expect, it } from "vitest";
import { SwrCache } from "./swr";

describe("SwrCache", () => {
  it("returns a value with its age", () => {
    let t = 1000;
    const c = new SwrCache(10, () => t);
    c.set("a", 1);
    t = 1600;
    expect(c.get<number>("a")).toEqual({ value: 1, age: 600 });
    expect(c.get("missing")).toBeUndefined();
  });

  it("evicts the least recently used entry when full", () => {
    let t = 0;
    const c = new SwrCache(2, () => t);
    c.set("a", 1);
    t = 1;
    c.set("b", 2);
    t = 2;
    c.get("a"); // a is now the most recently used
    t = 3;
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get<number>("a")?.value).toBe(1);
    expect(c.get<number>("c")?.value).toBe(3);
  });

  it("overwriting a key keeps the others", () => {
    const c = new SwrCache(2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("a", 9);
    expect(c.size).toBe(2);
    expect(c.get<number>("a")?.value).toBe(9);
  });

  it("invalidates by prefix, so a change never shows stale data", () => {
    const c = new SwrCache();
    c.set("analytics:7", 1);
    c.set("analytics:30", 2);
    c.set("history:500", 3);
    c.invalidate("analytics:");
    expect(c.get("analytics:7")).toBeUndefined();
    expect(c.get("analytics:30")).toBeUndefined();
    expect(c.get<number>("history:500")?.value).toBe(3);
    c.invalidate();
    expect(c.size).toBe(0);
  });
});
