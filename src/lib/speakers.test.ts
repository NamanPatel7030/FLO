import { describe, expect, it } from "vitest";
import { shownName, speakerColor, speakerPalette, speakerStats, splitOwner } from "./speakers";

describe("speaker helpers", () => {
  it("shows your own name for You, everyone else as labelled", () => {
    expect(shownName("You", "Parth")).toBe("Parth");
    expect(shownName("You", "  ")).toBe("You");
    expect(shownName("You")).toBe("You");
    expect(shownName("Speaker 2", "Parth")).toBe("Speaker 2");
  });

  it("splits owners off action items like the backend", () => {
    expect(splitOwner("Rahul: send the deck")).toEqual({ owner: "Rahul", task: "send the deck" });
    expect(splitOwner("Speaker 2: book the venue")).toEqual({ owner: "Speaker 2", task: "book the venue" });
    expect(splitOwner("You: review the PR")).toEqual({ owner: "You", task: "review the PR" });
    expect(splitOwner("राहुल: डेक भेजना")).toEqual({ owner: "राहुल", task: "डेक भेजना" });
    expect(splitOwner("Call at 10:30 tomorrow")).toEqual({ task: "Call at 10:30 tomorrow" });
    expect(splitOwner("review the PR")).toEqual({ task: "review the PR" });
    expect(splitOwner("We agreed on the following plan: ship")).toEqual({ task: "We agreed on the following plan: ship" });
  });

  it("gives stable, distinct colours", () => {
    expect(speakerColor("Speaker 1")).not.toBe(speakerColor("Speaker 2"));
    expect(speakerColor("You")).not.toBe(speakerColor("Speaker 1"));
    expect(speakerColor("Riya")).toBe(speakerColor("Riya"));
  });

  it("never gives two speakers of one note the same colour", () => {
    const labels = ["You", "Rahul", "Speaker 1", "Speaker 2", "Ana", "Meera", "Speaker 1"];
    const col = speakerPalette(labels);
    const colours = [...new Set(labels)].map((l) => col(l));
    expect(new Set(colours).size).toBe(colours.length);
    expect(col("Speaker 1")).toBe(speakerColor("Speaker 1"));
    expect(col("You")).toBe(speakerColor("You"));
    expect(col("Unknown")).toBe(speakerColor("Unknown"));
  });

  it("measures each speaker's share of the talking in order of appearance", () => {
    const s = speakerStats([
      { t: 0, text: "one two three", speaker: "You" },
      { t: 1, text: "a b c d e f", speaker: "Speaker 1" },
      { t: 2, text: "x", speaker: "You" },
      { t: 3, text: "no speaker" },
    ]);
    expect(s).toEqual([
      { who: "You", share: 40 },
      { who: "Speaker 1", share: 60 },
    ]);
    expect(speakerStats([])).toEqual([]);
  });
});
