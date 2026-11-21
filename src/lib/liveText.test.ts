import { describe, expect, it } from "vitest";
import { splitLive, tailText } from "./liveText";

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

describe("tailText", () => {
  it("keeps a short line whole", () => {
    expect(tailText("Morning everyone", 40)).toBe("Morning everyone");
  });
  it("keeps the newest words of a long live line, starting at a word, with a leading ellipsis", () => {
    const t = "We still need the Windows bottom-right positioning tested before Friday, and somebody has to own the release notes";
    const out = tailText(t, 40);
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("own the release notes")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(out[1]).not.toBe(" ");
    expect(t).toContain(out.slice(1));
  });
  it("cuts mid-word only when one word is longer than the room", () => {
    expect(tailText("a supercalifragilisticexpialidocious", 10)).toBe("…alidocious");
  });
});
