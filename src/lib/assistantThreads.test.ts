import { describe, expect, it } from "vitest";
import type { AssistantResponse, AssistantThread } from "./types";
import { followThread, isNearBottom, mergeExchanges, shows, sourceLabel, upsertThread } from "./assistantThreads";

const ex = (id: string, createdAt: string, threadId = "t1", extra: Partial<AssistantResponse> = {}): AssistantResponse => ({
  id,
  query: `q ${id}`,
  reply: `a ${id}`,
  actions: [],
  results: [],
  createdAt,
  mode: "quick",
  threadId,
  ...extra,
});

describe("mergeExchanges", () => {
  it("keeps the latest at the bottom whatever order pages and events arrive in", () => {
    const page = [ex("b", "2026-11-10T10:05:00.000+05:30"), ex("c", "2026-11-10T10:09:00.000+05:30")];
    const older = [ex("a", "2026-11-06T09:00:00.000+05:30")];
    const live = ex("d", "2026-11-10T04:50:00.000Z"); // 10:20 IST, other offset
    expect(mergeExchanges(mergeExchanges(page, [live]), older).map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("dedupes by id, the newer copy wins", () => {
    const a = ex("a", "2026-11-10T10:00:00.000Z");
    const merged = mergeExchanges([a], [{ ...a, reply: "updated" }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].reply).toBe("updated");
  });
});

describe("shows", () => {
  it("a thread view shows only its exchanges; all shows everything; a new thread nothing old", () => {
    const r = ex("a", "2026-11-10T10:00:00.000Z", "t2");
    expect(shows({ kind: "thread", id: "t2" }, r)).toBe(true);
    expect(shows({ kind: "thread", id: "t1" }, r)).toBe(false);
    expect(shows({ kind: "all" }, r)).toBe(true);
    expect(shows({ kind: "new" }, r)).toBe(false);
  });
});

describe("followThread", () => {
  const r = ex("n", "2026-11-10T10:00:00.000Z", "t9");
  it("follows a new notch thread when the user was on the latest thread", () => {
    expect(followThread({ kind: "thread", id: "t1" }, "t1", r)).toEqual({ kind: "thread", id: "t9" });
  });
  it("stays on an older thread the user picked", () => {
    expect(followThread({ kind: "thread", id: "t0" }, "t1", r)).toEqual({ kind: "thread", id: "t0" });
  });
  it("leaves All alone and fills a pending New thread with its first answer", () => {
    expect(followThread({ kind: "all" }, "t1", r)).toEqual({ kind: "all" });
    expect(followThread({ kind: "new" }, "t1", r)).toEqual({ kind: "new" });
    expect(followThread({ kind: "new" }, "t1", r, true)).toEqual({ kind: "thread", id: "t9" });
  });
});

describe("upsertThread", () => {
  const t = (id: string, updatedAt: string, count = 1): AssistantThread => ({ id, title: id, createdAt: updatedAt, updatedAt, count });
  it("bumps the thread an answer lands in to the top and counts it once", () => {
    const list = [t("t2", "2026-11-10T09:00:00.000Z", 3), t("t1", "2026-11-09T09:00:00.000Z", 2)];
    const r = ex("x", "2026-11-10T10:00:00.000Z", "t1");
    const out = upsertThread(list, r, false);
    expect(out.map((x) => [x.id, x.count])).toEqual([["t1", 3], ["t2", 3]]);
    expect(upsertThread(out, r, true).map((x) => [x.id, x.count])).toEqual([["t1", 3], ["t2", 3]]);
  });
  it("adds a thread it hasn't seen, titled by the question", () => {
    const out = upsertThread([], ex("x", "2026-11-10T10:00:00.000Z", "x"), false);
    expect(out).toEqual([{ id: "x", title: "q x", createdAt: "2026-11-10T10:00:00.000Z", updatedAt: "2026-11-10T10:00:00.000Z", count: 1 }]);
  });
});

describe("sourceLabel / isNearBottom", () => {
  it("labels where a request came from", () => {
    expect(sourceLabel("notch")).toBe("Notch");
    expect(sourceLabel("typed")).toBe("Typed");
    expect(sourceLabel("phone")).toBe("Phone");
    expect(sourceLabel("agent")).toBe("Flo Agent");
    expect(sourceLabel(undefined)).toBeNull();
  });
  it("is near the bottom within the threshold", () => {
    expect(isNearBottom({ scrollTop: 900, scrollHeight: 1500, clientHeight: 560 })).toBe(true);
    expect(isNearBottom({ scrollTop: 200, scrollHeight: 1500, clientHeight: 560 })).toBe(false);
  });
});
