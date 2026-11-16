import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, LANGUAGE_CHOICES, advancedModels, demoReady, languageActive, modelHears, nextSpeed, pickLanguage, progressText, routingNote, setupTarget, suggestSarvamForGujarati, switchToSarvam, unusedModelMb, speaksHindi, offerHinglishModel, meetingModels } from "./models";
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

describe("per-language routing", () => {
  const parakeet: LocalModel = { ...m("parakeet-tdt-0.6b-v3", 671, true), label: "NVIDIA Parakeet v3", engine: "onnx", bestFor: "English" };
  const apex: LocalModel = { ...m("hinglish-apex", 1618, true), label: "Whisper Hinglish", engine: "whisper", bestFor: "Hinglish" };
  it("the Hinglish model is used for Hinglish only", () => {
    expect(modelHears(apex, "hi-en")).toBe(true);
    expect(modelHears(apex, "en")).toBe(false);
    expect(modelHears(apex, "auto", ["en", "hi"])).toBe(false);
    const turboOnly: LocalModel = { ...m("large-v3-turbo-q5_0", 574, true), label: "Whisper Large v3 Turbo" };
    expect(routingNote([apex, turboOnly], { sttModel: "large-v3-turbo-q5_0", language: "hi-en", autoLanguages: ["en", "hi"] })).toBe("Hinglish goes to Whisper Hinglish, made for it.");
    expect(routingNote([apex, turboOnly], { sttModel: "hinglish-apex", language: "auto", autoLanguages: ["en", "hi"] })).toBe("Whisper Hinglish types your Hinglish. Other languages go to Whisper Large v3 Turbo.");
    expect(routingNote([apex, turboOnly], { sttModel: "hinglish-apex", language: "hi-en", autoLanguages: ["en", "hi"] })).toBeNull();
    expect(routingNote([{ ...apex, installed: false }, turboOnly], { sttModel: "large-v3-turbo-q5_0", language: "hi-en", autoLanguages: ["en", "hi"] })).toBeNull();
  });
  const turbo: LocalModel = { ...m("large-v3-turbo-q5_0", 574, true), label: "Whisper Large v3 Turbo", engine: "whisper" };
  const small: LocalModel = { ...m("small-q5_1", 190, true, "starter"), label: "Whisper Small", engine: "whisper" };
  it("Parakeet hears English only; Whisper hears everything", () => {
    expect(modelHears(parakeet, "en")).toBe(true);
    expect(modelHears(parakeet, "hi")).toBe(false);
    expect(modelHears(parakeet, "hi-en")).toBe(false);
    expect(modelHears(parakeet, "auto", ["en", "hi"])).toBe(false);
    expect(modelHears(parakeet, "auto", ["en"])).toBe(true);
    expect(modelHears(turbo, "gu")).toBe(true);
    expect(modelHears(m("base.en", 148, true, "light"), "hi")).toBe(false);
  });
  it("says where Hindi goes when Parakeet is in use", () => {
    expect(routingNote([parakeet, turbo, small], { sttModel: "parakeet-tdt-0.6b-v3", language: "auto", autoLanguages: ["en", "hi"] })).toBe(
      "NVIDIA Parakeet v3 types your English. Hindi, Hinglish and Gujarati go to Whisper Large v3 Turbo.",
    );
    expect(routingNote([parakeet, { ...turbo, installed: false }, small], { sttModel: "parakeet-tdt-0.6b-v3", language: "hi", autoLanguages: ["en", "hi"] })).toContain("Whisper Small");
    expect(routingNote([parakeet], { sttModel: "parakeet-tdt-0.6b-v3", language: "hi", autoLanguages: ["en", "hi"] })).toContain("Download Whisper Large v3 Turbo");
    expect(routingNote([parakeet, turbo], { sttModel: "parakeet-tdt-0.6b-v3", language: "en", autoLanguages: ["en", "hi"] })).toBeNull();
    expect(routingNote([parakeet, turbo], { sttModel: "large-v3-turbo-q5_0", language: "hi", autoLanguages: ["en", "hi"] })).toBeNull();
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
  it("leaves out the models meeting notes use", () => {
    const list = [m("large-v3-turbo-q5_0", 574, true), m("hinglish-apex", 1618, true), m("small", 488, true)];
    expect(unusedModelMb(list, "large-v3-turbo-q5_0", ["hinglish-apex"])).toBe(488);
  });
});

describe("meeting notes in Hindi", () => {
  const base = { sttProvider: "local" as const, language: "auto", autoLanguages: ["en", "hi", "gu"], meetingHindi: "hinglish" as const };
  const apex = (installed: boolean) => [m("large-v3-turbo-q5_0", 574, true), m("hinglish-apex", 1618, installed)];
  it("knows who speaks Hindi", () => {
    expect(speaksHindi(base)).toBe(true);
    expect(speaksHindi({ language: "hi-en", autoLanguages: ["en"] })).toBe(true);
    expect(speaksHindi({ language: "auto", autoLanguages: ["en"] })).toBe(false);
    expect(speaksHindi({ language: "en", autoLanguages: ["en", "hi"] })).toBe(false);
  });
  it("offers the Hinglish model only while it's missing and Hinglish transcripts are wanted", () => {
    expect(offerHinglishModel(apex(false), base)).toBe(true);
    expect(offerHinglishModel(apex(true), base)).toBe(false);
    expect(offerHinglishModel(apex(false), { ...base, meetingHindi: "devanagari" })).toBe(false);
    expect(offerHinglishModel(apex(false), { ...base, sttProvider: "sarvam" })).toBe(false);
    expect(offerHinglishModel(apex(false), { ...base, autoLanguages: ["en"] })).toBe(false);
    expect(offerHinglishModel(null, base)).toBe(false);
  });
  it("keeps the Hinglish model out of Free up space while meetings use it", () => {
    expect(meetingModels(base)).toEqual(["hinglish-apex"]);
    expect(meetingModels({ ...base, meetingHindi: "english" })).toEqual([]);
    expect(meetingModels({ ...base, autoLanguages: ["en"] })).toEqual([]);
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
