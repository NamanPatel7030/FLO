import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, LANGUAGE_CHOICES, advancedModels, demoReady, languageActive, nextSpeed, pickLanguage, progressText, setupTarget, suggestSarvamForGujarati, switchToSarvam, unusedModelMb } from "./models";
import type { LocalModel } from "./types";

const m = (id: string, sizeMb: number, installed: boolean, tier: LocalModel["tier"] = "advanced"): LocalModel => ({ id, label: id, sizeMb, languages: "", installed, tier, speed: "Fast", accuracy: "Good" });

describe("model tiers", () => {
  const list = [m("small-q5_1", 190, false, "starter"), m("large-v3-turbo", 1624, false), m("large-v3-turbo-q5_0", 574, true), m("base.en", 148, false, "light")];
  it("the default is the small starter", () => {
    expect(DEFAULT_MODEL).toBe("small-q5_1");
  });
  it("advanced models are the bigger ones, smallest first", () => {
    expect(advancedModels(list).map((x) => x.id)).toEqual(["large-v3-turbo-q5_0", "large-v3-turbo"]);
  });
  it("setup keeps an installed choice, otherwise gets the starter", () => {
    expect(setupTarget(list, "large-v3-turbo-q5_0")).toBe("large-v3-turbo-q5_0");
    expect(setupTarget(list, "large-v3-turbo")).toBe("small-q5_1");
    expect(setupTarget(list, "nope")).toBe("small-q5_1");
  });
});

describe("download progress", () => {
  it("shows MB done, total and speed", () => {
    expect(progressText(42_000_000, 190_000_000, 5_200_000)).toBe("42 of 190 MB · 5.2 MB/s");
    expect(progressText(0, 190_000_000, 0)).toBe("0 of 190 MB");
  });
  it("smooths the speed between progress events", () => {
    const a = nextSpeed(null, 0, 0);
    expect(a.bps).toBe(0);
    const b = nextSpeed(a, 1000, 4_000_000);
    expect(b.bps).toBe(4_000_000);
    const c = nextSpeed(b, 2000, 6_000_000); // 2 MB/s this second, smoothed toward it
    expect(c.bps).toBeGreaterThan(2_000_000);
    expect(c.bps).toBeLessThan(4_000_000);
    // a retry restarts the byte count: never a negative speed
    expect(nextSpeed(c, 3000, 0).bps).toBeGreaterThanOrEqual(0);
  });
});

describe("demo lock", () => {
  it("on-device: needs the model downloaded and loaded", () => {
    expect(demoReady({ sttProvider: "local", installed: false, loaded: false })).toBe(false);
    expect(demoReady({ sttProvider: "local", installed: true, loaded: false })).toBe(false);
    expect(demoReady({ sttProvider: "local", installed: true, loaded: true })).toBe(true);
  });
  it("a cloud engine has nothing to download", () => {
    expect(demoReady({ sttProvider: "groq", installed: false, loaded: false })).toBe(true);
  });
});

describe("unusedModelMb", () => {
  it("counts installed models except the one in use", () => {
    const list = [m("large-v3-turbo-q5_0", 574, true), m("large-v3-turbo", 1624, true), m("base.en", 148, true), m("small", 488, false)];
    expect(unusedModelMb(list, "large-v3-turbo-q5_0")).toBe(1624 + 148);
  });
  it("is zero when only the model in use is installed", () => {
    expect(unusedModelMb([m("large-v3-turbo-q5_0", 574, true), m("small", 488, false)], "large-v3-turbo-q5_0")).toBe(0);
  });
});

describe("language choices", () => {
  it("offers Auto (English + Hindi), English, Hindi, Gujarati and Hinglish first", () => {
    expect(LANGUAGE_CHOICES.slice(0, 5).map((l) => l.value)).toEqual(["auto", "en", "hi", "gu", "hi-en"]);
    expect(LANGUAGE_CHOICES[0].label).toBe("Auto (English + Hindi)");
    expect(LANGUAGE_CHOICES.find((l) => l.value === "gu")?.native).toBe("ગુજરાતી");
    // Gujarati in Auto is opt-in, in the second row
    expect(LANGUAGE_CHOICES.find((l) => l.value === "auto-gu")).toMatchObject({ label: "Auto + Gujarati", more: true });
  });
  it("picking Auto also resets the languages it chooses from", () => {
    expect(pickLanguage("auto")).toEqual({ language: "auto", autoLanguages: ["en", "hi"] });
    expect(pickLanguage("auto-gu")).toEqual({ language: "auto", autoLanguages: ["en", "hi", "gu"] });
    expect(pickLanguage("gu")).toEqual({ language: "gu" });
  });
  it("marks exactly one chip active, telling the two Autos apart", () => {
    const on = (s: { language: string; autoLanguages?: string[] }) => LANGUAGE_CHOICES.filter((l) => languageActive(s, l.value)).map((l) => l.value);
    expect(on({ language: "auto", autoLanguages: ["en", "hi"] })).toEqual(["auto"]);
    expect(on({ language: "auto", autoLanguages: ["en", "hi", "gu"] })).toEqual(["auto-gu"]);
    expect(on({ language: "auto" })).toEqual(["auto"]);
    expect(on({ language: "hi-en", autoLanguages: ["en", "hi", "gu"] })).toEqual(["hi-en"]);
  });
  it("suggests Sarvam AI only when Gujarati is spoken on the on-device engine", () => {
    expect(suggestSarvamForGujarati({ sttProvider: "local", language: "gu" })).toBe(true);
    expect(suggestSarvamForGujarati({ sttProvider: "local", language: "auto", autoLanguages: ["en", "hi", "gu"] })).toBe(true);
    expect(suggestSarvamForGujarati({ sttProvider: "local", language: "auto", autoLanguages: ["en", "hi"] })).toBe(false);
    expect(suggestSarvamForGujarati({ sttProvider: "local", language: "en" })).toBe(false);
    expect(suggestSarvamForGujarati({ sttProvider: "sarvam", language: "gu" })).toBe(false);
  });
  it("switching to Sarvam picks its model", () => {
    expect(switchToSarvam()).toEqual({ sttProvider: "sarvam", sttModel: "saaras:v3" });
  });
});
