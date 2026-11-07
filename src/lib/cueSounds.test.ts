import { describe, expect, it } from "vitest";
import { cueSetting } from "./cueSounds";

describe("cueSetting: start, stop and notification sounds are separate", () => {
  it("uses each sound's own style, falling back to the shared one", () => {
    const s = { soundPack: "chime", soundStart: "pop", soundStop: "", soundNotify: "glass" };
    expect(cueSetting("ready", s).pack).toBe("pop");
    expect(cueSetting("done", s).pack).toBe("chime"); // empty → shared style
    expect(cueSetting("error", s).pack).toBe("chime");
    expect(cueSetting("notify", s).pack).toBe("glass");
  });
  it("each switch only silences its own sound; the master switch silences all", () => {
    const s = { playSounds: true, startSoundOn: false, stopSoundOn: true, notifySound: true };
    expect(cueSetting("ready", s).on).toBe(false);
    expect(cueSetting("done", s).on).toBe(true);
    expect(cueSetting("notify", s).on).toBe(true);
    const off = { ...s, playSounds: false };
    expect(["ready", "working", "done", "error", "notify"].some((c) => cueSetting(c as any, off).on)).toBe(false);
  });
  it("ignores unknown styles and maps volume to 0–1", () => {
    expect(cueSetting("ready", { soundStart: "kazoo" }).pack).toBe("chime");
    expect(cueSetting("ready", { soundVolume: 35 }).volume).toBeCloseTo(0.35);
    expect(cueSetting("ready", null).on).toBe(true);
  });
});
