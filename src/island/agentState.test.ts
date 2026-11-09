import { describe, expect, it } from "vitest";
import { AGENT_STALE_MS, HANDSFREE_STALE_MS, expireAgent, expireHandsfree, isActive, reduceAgent, stopLocally, type AgentState } from "./agentState";

const run = (events: { kind: string; text?: string; voice?: boolean }[], start: AgentState | null = null, now = 1000) =>
  events.reduce<AgentState | null>((s, e) => reduceAgent(s, e, now), start);

describe("screen-control card state", () => {
  it("a run goes start → steps → done and stops spinning", () => {
    const s = run([{ kind: "start", text: "Open YouTube" }, { kind: "step", text: "Opening youtube.com" }, { kind: "done", text: "Playing." }]);
    expect(s?.status).toBe("done");
    expect(s?.steps).toEqual(["Opening youtube.com"]);
    expect(isActive(s)).toBe(false);
  });

  it("an error with no prior start still ends in a visible error, never a spinner", () => {
    const s = run([{ kind: "error", text: "Flo can't click or type for you yet." }]);
    expect(s?.status).toBe("error");
    expect(s?.text).toContain("can't click");
    expect(isActive(s)).toBe(false);
    // an error without text still says something
    expect(run([{ kind: "start", text: "x" }, { kind: "error" }])?.text).toBeTruthy();
  });

  it("confirm keeps it active until answered", () => {
    const s = run([{ kind: "start", text: "Email Rahul" }, { kind: "confirm", text: "Send it?", voice: true }]);
    expect(s?.status).toBe("confirm");
    expect(s?.voice).toBe(true);
    expect(isActive(s)).toBe(true);
    expect(run([{ kind: "aborted", text: "Cancelled, you said no." }], s)?.status).toBe("aborted");
  });

  it("Stop clears the spinner at once and ignores late steps from that run", () => {
    const running = run([{ kind: "start", text: "Open Slack" }, { kind: "step", text: "Opening Slack" }]);
    const stopped = stopLocally(running, 2000);
    expect(stopped?.status).toBe("aborted");
    expect(isActive(stopped)).toBe(false);
    // a step that was already in flight must not bring the spinner back
    expect(reduceAgent(stopped, { kind: "step", text: "Clicking Search" })?.status).toBe("aborted");
    // the backend's own final event is still shown
    expect(reduceAgent(stopped, { kind: "aborted", text: "Stopped." })?.status).toBe("aborted");
    // a new run starts fresh
    expect(reduceAgent(stopped, { kind: "start", text: "Next" })?.status).toBe("running");
    // Stop on a finished card changes nothing
    const done = run([{ kind: "start" }, { kind: "done", text: "ok" }]);
    expect(stopLocally(done)).toBe(done);
  });

  it("a silent run is closed with an error after the stale window", () => {
    const s = run([{ kind: "start", text: "Open Chrome" }], null, 0);
    expect(expireAgent(s, AGENT_STALE_MS - 1)).toBe(s);
    const expired = expireAgent(s, AGENT_STALE_MS + 1);
    expect(expired?.status).toBe("error");
    expect(expired?.text).not.toMatch(/—/);
    // finished cards are left alone
    const done = run([{ kind: "start" }, { kind: "done", text: "ok" }], null, 0);
    expect(expireAgent(done, AGENT_STALE_MS * 2)).toBe(done);
  });

  it("unknown or empty events don't change anything", () => {
    const s = run([{ kind: "start", text: "x" }]);
    expect(reduceAgent(s, { kind: "mystery" })).toBe(s);
    expect(reduceAgent(s, null)).toBe(s);
  });
});

describe("agent mode working spinner", () => {
  it("falls back to listening when the backend goes quiet", () => {
    const hf = { active: true, phase: "thinking" as const, heard: "open chrome" };
    expect(expireHandsfree(hf, 0, HANDSFREE_STALE_MS - 1)).toBe(hf);
    expect(expireHandsfree(hf, 0, HANDSFREE_STALE_MS + 1)?.phase).toBe("listening");
    const listening = { active: true, phase: "listening" as const };
    expect(expireHandsfree(listening, 0, HANDSFREE_STALE_MS * 5)).toBe(listening);
    expect(expireHandsfree(null, 0, 1)).toBeNull();
  });
});
