import { describe, expect, it } from "vitest";
import { buildProfile, languageSetting, type Answers } from "./profile";

const base: Answers = { name: "Naman", role: "developer", uses: [], languages: ["english"], apps: [] };

describe("buildProfile", () => {
  it("speaks to the person by name and role", () => {
    const p = buildProfile({ ...base, uses: ["coding"] });
    expect(p.systemPrompt).toMatch(/Naman/);
    expect(p.systemPrompt).toMatch(/software developer/i);
    expect(p.systemPrompt).toMatch(/prompts for coding agents/i);
  });

  it("use cases shape the instructions", () => {
    const p = buildProfile({ ...base, role: "sales", uses: ["emails", "chat"] });
    expect(p.systemPrompt).toMatch(/email/i);
    expect(p.systemPrompt).toMatch(/Slack and WhatsApp/);
    expect(p.systemPrompt).not.toMatch(/coding agents/);
  });

  it("languages: Hinglish / Hindi keep the user's mix, never translate", () => {
    const p = buildProfile({ ...base, languages: ["english", "hinglish"] });
    expect(p.systemPrompt).toMatch(/Hinglish/);
    expect(p.systemPrompt).toMatch(/don't translate/i);
  });

  it("dictionary seeds: apps + tech terms for developers, no duplicates", () => {
    const p = buildProfile({ ...base, apps: ["vscode", "cursor", "slack"], uses: ["coding"] });
    expect(p.dictionary).toEqual(expect.arrayContaining(["VS Code", "Cursor", "Slack", "Claude Code", "TypeScript", "GitHub"]));
    expect(new Set(p.dictionary).size).toBe(p.dictionary.length);
    const s = buildProfile({ ...base, role: "student", uses: ["notes"], apps: [] });
    expect(s.dictionary).not.toContain("TypeScript");
  });

  it("works with nothing chosen and contains no em dashes", () => {
    const p = buildProfile({ name: "", role: "", uses: [], languages: [], apps: [] });
    expect(p.systemPrompt.length).toBeGreaterThan(40);
    expect(p.systemPrompt).not.toMatch(/[—–]/);
  });

  it("other language text is included", () => {
    expect(buildProfile({ ...base, languages: ["english", "other"], otherLanguage: "Marathi" }).systemPrompt).toMatch(/Marathi/);
  });
});

describe("languageSetting", () => {
  it("one language → its code; a mix → auto", () => {
    expect(languageSetting(["english"])).toBe("en");
    expect(languageSetting(["hindi"])).toBe("hi");
    expect(languageSetting(["gujarati"])).toBe("gu");
    expect(languageSetting(["english", "hindi"])).toBe("auto");
    expect(languageSetting(["hinglish"])).toBe("auto");
    expect(languageSetting([])).toBe("auto");
  });
});
