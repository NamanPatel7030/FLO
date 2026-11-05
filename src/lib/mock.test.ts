import { describe, expect, it } from "vitest";
import { buildAnalytics, mockInvoke, mockListen } from "./mock";
import type { Analytics, Todo, Project, StateEvent } from "./types";

describe("buildAnalytics", () => {
  it("has a full daily series and 24 hourly buckets", () => {
    const a: Analytics = buildAnalytics(60, new Date("2026-11-05T12:00:00"));
    expect(a.daily).toHaveLength(60);
    expect(a.daily[59].day).toBe("2026-11-05");
    expect(a.hourly).toHaveLength(24);
    expect(a.totalWords).toBe(a.daily.reduce((s, d) => s + d.words, 0));
    expect(a.minutesSaved).toBeGreaterThan(0);
    expect(a.topApps.length).toBeGreaterThan(2);
  });
  it("respects the days window", () => {
    expect(buildAnalytics(7).daily).toHaveLength(7);
  });
});

describe("mockInvoke", () => {
  it("adds and completes todos, updating project counts", async () => {
    const projects = (await mockInvoke("list_projects")) as Project[];
    const p = projects[0];
    const t = (await mockInvoke("add_todo", { title: "Ship it", projectId: p.id })) as Todo;
    expect(t.status).toBe("open");
    const before = ((await mockInvoke("list_projects")) as Project[]).find((x) => x.id === p.id)!;
    await mockInvoke("update_todo", { id: t.id, status: "done" });
    const after = ((await mockInvoke("list_projects")) as Project[]).find((x) => x.id === p.id)!;
    expect(after.doneTodos).toBe(before.doneTodos + 1);
    expect(after.openTodos).toBe(before.openTodos - 1);
  });

  it("refuses sessions while signed out (friendly sign-in error)", async () => {
    const msgs: string[] = [];
    const un = mockListen<StateEvent>("flo://state", (e) => e.phase === "error" && msgs.push(e.message ?? ""));
    await expect(mockInvoke("start_session", { mode: "dictation" })).rejects.toThrow(/sign in/i);
    un();
    expect(msgs[0]).toMatch(/Sign in to Flo/);
  });

  it("emits a dictation cycle on start/stop_session", async () => {
    await mockInvoke("account_login", { email: "t@example.com", password: "secret" });
    const phases: string[] = [];
    const un = mockListen<StateEvent>("flo://state", (e) => phases.push(e.phase));
    await mockInvoke("start_session", { mode: "dictation" });
    await mockInvoke("stop_session");
    await new Promise((r) => setTimeout(r, 1600));
    un();
    expect(phases[0]).toBe("listening");
    expect(phases).toContain("transcribing");
    expect(phases).toContain("done");
  });
});
