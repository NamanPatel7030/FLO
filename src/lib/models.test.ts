import { describe, expect, it } from "vitest";
import { unusedModelMb } from "./models";
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
