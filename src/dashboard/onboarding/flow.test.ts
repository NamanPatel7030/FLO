import { describe, expect, it } from "vitest";
import { CHAPTERS, EMPTY_ANSWERS, STEPS, STEP_NAME, clampStep, deriveRole, friendlyError, headline, profileFor, stepIndex, toggle } from "./flow";

describe("onboarding flow", () => {
  it("every step belongs to exactly one chapter, in order", () => {
    const flat = CHAPTERS.flatMap((c) => c.steps);
    expect(flat).toEqual([...STEPS]);
  });

  it("is short and focused: hello, the speech model, permissions, try, voice and AI, two questions, ready", () => {
    expect([...STEPS]).toEqual(["welcome", "model", "permissions", "try", "setup", "role", "uses", "done"]);
    expect(STEPS.length).toBeLessThanOrEqual(8);
  });

  it("downloads the speech model first, before the try-out", () => {
    expect(stepIndex("model")).toBe(1);
    expect(stepIndex("model")).toBeLessThan(stepIndex("try"));
    expect(headline("model", "").title).toBeTruthy();
    expect(headline("model", "").sub).not.toMatch(/[—–]/);
  });

  it("asks for permissions before the first dictation (the mic and the Flo key must work)", () => {
    expect(stepIndex("permissions")).toBeLessThan(stepIndex("try"));
  });

  it("clamps navigation to the step range", () => {
    expect(clampStep(-3)).toBe(0);
    expect(clampStep(99)).toBe(STEPS.length - 1);
  });

  it("derives a role from uses only when none was picked", () => {
    expect(deriveRole(["coding", "emails"])).toBe("developer");
    expect(deriveRole([])).toBe("");
    const p = profileFor({ ...EMPTY_ANSWERS, name: "Priya", uses: ["coding"] });
    expect(p.systemPrompt).toMatch(/software developer/);
    const q = profileFor({ ...EMPTY_ANSWERS, name: "Priya", role: "designer", uses: ["coding"] });
    expect(q.systemPrompt).toMatch(/product designer/);
  });

  it("languages, apps and tone shape the profile", () => {
    const p = profileFor({ ...EMPTY_ANSWERS, name: "Priya", languages: ["hindi"], apps: ["slack", "notion"], tone: "crisp" });
    expect(p.language).toBe("hi");
    expect(p.dictionary).toEqual(expect.arrayContaining(["Slack", "Notion", "Priya"]));
    expect(p.systemPrompt).toMatch(/Overall tone: crisp and direct/);
    expect(profileFor({ ...EMPTY_ANSWERS }).systemPrompt).not.toMatch(/Overall tone/);
  });

  it("toggle adds and removes", () => {
    expect(toggle(["a"], "b")).toEqual(["a", "b"]);
    expect(toggle(["a", "b"], "a")).toEqual(["b"]);
  });

  it("copy is warm and has no em or en dashes", () => {
    for (const s of STEPS) {
      const h = headline(s, "Priya", 10);
      expect(h.title + h.sub + STEP_NAME[s]).not.toMatch(/[—–]/);
    }
    expect(headline("role", "Priya").title).toContain("Priya");
  });

  it("turns backend mic errors into a clear next step", () => {
    const silent = friendlyError("I didn't hear anything. Check the microphone in System Settings → Sound.");
    expect(silent.fixMic).toBe(true);
    expect(silent.text).toMatch(/couldn't hear you/);
    const denied = friendlyError("Microphone unavailable (no device). Allow Flo in System Settings → Privacy → Microphone.");
    expect(denied).toEqual({ text: "Allow the microphone first, then try again.", fixMic: true });
    expect(friendlyError("Didn't catch that. Try speaking a bit longer.").fixMic).toBeUndefined();
    for (const m of ["x — y", "a – b"]) expect(friendlyError(m).text).not.toMatch(/[—–]/);
  });
});
