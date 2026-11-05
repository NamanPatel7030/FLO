import { describe, expect, it } from "vitest";
import { isLongReply, parseInline, parseMarkdown, toPlainText } from "./markdown";

describe("parseMarkdown", () => {
  it("headings, paragraphs, bullets and numbered lists", () => {
    const b = parseMarkdown("# Title\n## Sub\nSome text\nmore text\n\n- one\n- two\n\n1. first\n2. second");
    expect(b.map((x) => x.type)).toEqual(["h1", "h2", "p", "ul", "ol"]);
    expect(b[2]).toMatchObject({ type: "p", inline: [{ t: "text", v: "Some text more text" }] });
    expect(b[3]).toMatchObject({ type: "ul", items: [[{ t: "text", v: "one" }], [{ t: "text", v: "two" }]] });
    expect(b[4]).toMatchObject({ type: "ol", items: [[{ t: "text", v: "first" }], [{ t: "text", v: "second" }]] });
  });

  it("fenced code keeps its text verbatim (no inline parsing) with the language", () => {
    const b = parseMarkdown("before\n```ts\nconst a = **b**;\n<script>x</script>\n```\nafter");
    expect(b[1]).toEqual({ type: "code", lang: "ts", text: "const a = **b**;\n<script>x</script>" });
    expect(b.map((x) => x.type)).toEqual(["p", "code", "p"]);
  });

  it("an unclosed fence runs to the end", () => {
    expect(parseMarkdown("```\nnpm i")).toEqual([{ type: "code", lang: "", text: "npm i" }]);
  });

  it("* bullets work too", () => {
    expect(parseMarkdown("* a\n* b")[0]).toMatchObject({ type: "ul" });
  });
});

describe("parseInline", () => {
  it("bold, code and links", () => {
    expect(parseInline("Use **Groq** with `whisper` via [docs](https://groq.com/docs).")).toEqual([
      { t: "text", v: "Use " },
      { t: "bold", v: "Groq" },
      { t: "text", v: " with " },
      { t: "code", v: "whisper" },
      { t: "text", v: " via " },
      { t: "link", v: "docs", href: "https://groq.com/docs" },
      { t: "text", v: "." },
    ]);
  });

  it("unsafe link targets become plain text", () => {
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ t: "text", v: "x" }]);
    expect(parseInline("[x](data:text/html,hi)")).toEqual([{ t: "text", v: "x" }]);
    expect(parseInline("[mail](mailto:a@b.co)")).toEqual([{ t: "link", v: "mail", href: "mailto:a@b.co" }]);
  });

  it("raw HTML stays text (rendered escaped by React, never as markup)", () => {
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([{ t: "text", v: "<img src=x onerror=alert(1)>" }]);
  });

  it("lone markers are literal", () => {
    expect(parseInline("2 ** 3 and a ` tick")).toEqual([{ t: "text", v: "2 ** 3 and a ` tick" }]);
  });
});

describe("toPlainText", () => {
  it("strips markup for compact surfaces (the notch)", () => {
    expect(toPlainText("## Plan\n- **Ship** it\n```\ncode\n```\nSee [docs](https://x.y)")).toBe("Plan\nShip it\ncode\nSee docs");
  });
});

describe("isLongReply", () => {
  it("short replies fit the notch; long or many-line replies get the fade + Open full answer", () => {
    expect(isLongReply("Only Hermes API is blocked.")).toBe(false);
    expect(isLongReply("x ".repeat(150))).toBe(true);
    expect(isLongReply("- a\n- b\n- c\n- d\n- e")).toBe(true);
  });
});
