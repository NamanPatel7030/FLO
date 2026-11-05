import { describe, expect, it } from "vitest";
import { buildPracticeWords, computeWpm, initialTyping, minutesSavedPer1000, PASSAGES, typeKey, wordLetters, type TypingState } from "./typing";

const typeAll = (words: string[], text: string, st: TypingState = initialTyping()) => {
  for (const ch of text) st = typeKey(st, words, ch);
  return st;
};

describe("word-based typing engine", () => {
  const words = ["the", "quick", "brown", "fox"];

  it("one wrong letter only marks that word", () => {
    const st = typeAll(words, "the quack brown ");
    expect(st.typed).toEqual(["the", "quack", "brown"]);
    expect(wordLetters("quick", st.typed[1], true).map((l) => l.state)).toEqual(["correct", "correct", "wrong", "correct", "correct"]);
    expect(wordLetters("brown", st.typed[2], true).every((l) => l.state === "correct")).toBe(true);
  });

  it("marks extra and missing letters inside the word only", () => {
    expect(wordLetters("fox", "foxes", true).map((l) => l.state)).toEqual(["correct", "correct", "correct", "extra", "extra"]);
    expect(wordLetters("brown", "bro", true).map((l) => l.state)).toEqual(["correct", "correct", "correct", "missing", "missing"]);
    expect(wordLetters("brown", "bro", false).map((l) => l.state)).toEqual(["correct", "correct", "correct", "pending", "pending"]);
  });

  it("backspace returns to the previous word only if it had errors", () => {
    let st = typeAll(words, "the ");
    st = typeKey(st, words, "Backspace");
    expect(st.typed).toEqual(["the"]); // correct word is locked
    st = typeAll(words, "quack ", st);
    st = typeKey(st, words, "Backspace");
    expect(st.typed).toEqual(["the"]);
    expect(st.current).toBe("quack");
  });

  it("ignores leading/double spaces and tracks the streak", () => {
    let st = typeAll(words, "  the  quick ");
    expect(st.typed).toEqual(["the", "quick"]);
    expect(st.streak).toBe(2);
    st = typeAll(words, "brwn ", st);
    expect(st.streak).toBe(0);
  });
});

describe("computeWpm", () => {
  it("net counts correct words (+ spaces), raw counts everything, accuracy = correct / total keystrokes", () => {
    const words = Array.from({ length: 20 }, () => "abcd");
    // 10 correct words in 1 minute = 10 × 5 chars = 50 chars → 10 wpm
    const st = typeAll(words, "abcd ".repeat(10));
    const r = computeWpm(words, st, 60000);
    expect(r).toMatchObject({ net: 10, raw: 10, accuracy: 100, correctWords: 10, wrongWords: 0 });
    // one wrong word: net drops by that word only, raw unchanged
    const st2 = typeAll(words, "abcd ".repeat(9) + "abce ");
    const r2 = computeWpm(words, st2, 60000);
    expect(r2.net).toBe(9);
    expect(r2.raw).toBe(10);
    expect(r2.accuracy).toBe(96); // wrong letter + the space that committed a wrong word: 48 / 50
    expect(r2.wrongWords).toBe(1);
  });
  it("is safe at the very start", () => {
    expect(computeWpm(["a"], initialTyping(), 0)).toMatchObject({ net: 0, raw: 0, accuracy: 100 });
  });
});

describe("helpers", () => {
  it("time saved per 1,000 words vs ~150 wpm speech", () => {
    expect(minutesSavedPer1000(40)).toBe(18.3);
    expect(minutesSavedPer1000(200)).toBe(0);
    expect(minutesSavedPer1000(0)).toBe(0);
  });
  it("passages are natural text without em dashes, long enough for 5 minutes", () => {
    for (const p of PASSAGES) expect(p).not.toMatch(/[—–]/);
    expect(buildPracticeWords(1).length).toBeGreaterThan(500);
  });
});
