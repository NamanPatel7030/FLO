import { describe, expect, it } from "vitest";
import { LANGUAGE_CHOICES, pickLanguage, suggestSarvamForGujarati, switchToSarvam, unusedModelMb } from "./models";
import type { LocalModel } from "./types";

const m = (id: string, sizeMb: number, installed: boolean): LocalModel => ({ id, label: id, sizeMb, languages: "", installed });

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
  it("offers Auto (English + Hindi + Gujarati), English, Hindi, Gujarati and Hinglish first", () => {
    expect(LANGUAGE_CHOICES.slice(0, 5).map((l) => l.value)).toEqual(["auto", "en", "hi", "gu", "hi-en"]);
    expect(LANGUAGE_CHOICES[0].label).toBe("Auto (English + Hindi + Gujarati)");
    expect(LANGUAGE_CHOICES.find((l) => l.value === "gu")?.native).toBe("ગુજરાતી");
  });
  it("picking Auto also resets the languages it chooses from", () => {
    expect(pickLanguage("auto")).toEqual({ language: "auto", autoLanguages: ["en", "hi", "gu"] });
    expect(pickLanguage("gu")).toEqual({ language: "gu" });
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
