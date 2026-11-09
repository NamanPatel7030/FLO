import { describe, expect, it } from "vitest";
import { CHAPTERS, EMPTY_ANSWERS, STEPS, STEP_NAME, clampStep, deriveRole, headline, profileFor, toggle } from "./flow";

describe("onboarding flow", () => {
  it("every step belongs to exactly one chapter, in order", () => {
    const flat = CHAPTERS.flatMap((c) => c.steps);
    expect(flat).toEqual([...STEPS]);
  });

  it("keeps every functional step", () => {
    for (const s of ["try", "personalise", "permissions", "setup", "typing", "done"]) expect(STEPS).toContain(s);
    expect(STEPS[0]).toBe("welcome");
    expect(STEPS[STEPS.length - 1]).toBe("done");
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
});
