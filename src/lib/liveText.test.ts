import { describe, expect, it } from "vitest";
import { splitLive } from "./liveText";

describe("splitLive", () => {
  it("animates only appended words", () => {
    expect(splitLive("let's kick", "let's kick off the")).toEqual({ stable: "let's kick", added: " off the" });
  });
  it("never splits a word that was still growing", () => {
    expect(splitLive("let's ki", "let's kick off")).toEqual({ stable: "let's ", added: "kick off" });
  });
  it("revisions re-animate from the changed word", () => {
    expect(splitLive("the launch check", "the lunch checklist")).toEqual({ stable: "the ", added: "lunch checklist" });
  });
  it("starts fresh", () => {
    expect(splitLive("", "hello")).toEqual({ stable: "", added: "hello" });
  });
});
