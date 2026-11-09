// Same cases as floagent.rs `tests`, so the browser preview routes like the app.
import { describe, expect, it } from "vitest";
import { isScreenTask, planRoute } from "./agentRoute";
import { DEFAULT_AGENT_CONFIG, runDuration, upsertRun, type AgentRun } from "./floAgent";

const cfg = DEFAULT_AGENT_CONFIG;
const skills = [
  { name: "Upwork proposal", triggers: "proposal for this job, apply to this job" },
  { name: "Slack reply", triggers: "reply on slack" },
];

describe("planRoute", () => {
  it("sends on-screen tasks to the screen agent", () => {
    for (const g of ["open LinkedIn and like the first post", "Go to youtube, search lofi and play the first video", "open https://news.ycombinator.com then open the top story", "search google for flights to Goa and open the first result"]) {
      expect(planRoute(g, [], [], cfg).route, g).toBe("screen");
    }
  });
  it("keeps a bare open and questions with the assistant", () => {
    expect(planRoute("open Slack", [], [], cfg).route).toBe("answer");
    expect(planRoute("what's blocked across my projects?", [], [], cfg).route).toBe("answer");
    expect(isScreenTask("add a to-do: send the deck by Friday")).toBe(false);
  });
  it("lets skills win, unless they're switched off", () => {
    expect(planRoute("write a proposal for this job on upwork", skills, [], cfg)).toMatchObject({ route: "skill", target: "Upwork proposal" });
    expect(planRoute("write a proposal for this job on upwork", skills, [], { ...cfg, allowSkills: false }).route).not.toBe("skill");
  });
  it("uses a connected app's tools when it's named", () => {
    expect(planRoute("in Notion, find my meeting notes from Monday", [], ["Notion", "x"], cfg)).toMatchObject({ route: "tools", target: "Notion" });
    expect(planRoute("fix x", [], ["x"], cfg).route).toBe("answer");
  });
  it("hands tool and answer tasks to Hermes, never the screen", () => {
    const h = { ...cfg, engine: "hermes" as const };
    expect(planRoute("summarize my week", [], [], h).route).toBe("hermes");
    expect(planRoute("in Notion, find my notes", [], ["Notion"], h).route).toBe("hermes");
    expect(planRoute("open LinkedIn and like the first post", [], [], h).route).toBe("screen");
  });
  it("never drives the mouse when screen control is off", () => {
    expect(planRoute("open LinkedIn and like the first post", [], [], { ...cfg, allowScreen: false }).route).toBe("answer");
  });
});

describe("run helpers", () => {
  const run = (id: string, status: AgentRun["status"] = "running"): AgentRun => ({ id, goal: id, route: "answer", engine: "flo", source: "typed", status, steps: [], startedAt: "2026-11-09T10:00:00Z" });
  it("upserts newest first", () => {
    const a = upsertRun([], run("a"));
    const b = upsertRun(a, run("b"));
    expect(b.map((r) => r.id)).toEqual(["b", "a"]);
    expect(upsertRun(b, run("a", "done")).find((r) => r.id === "a")?.status).toBe("done");
  });
  it("formats durations", () => {
    expect(runDuration("2026-11-09T10:00:00Z", "2026-11-09T10:00:07Z")).toBe("7 s");
    expect(runDuration("2026-11-09T10:00:00Z", "2026-11-09T10:01:12Z")).toBe("1 min 12 s");
    expect(runDuration("2026-11-09T10:00:00Z", "2026-11-09T10:02:00Z")).toBe("2 min");
  });
});
