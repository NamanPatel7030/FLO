// Tiny, safe markdown for assistant replies. Parses to a small AST that React renders, so text
// is always escaped (no innerHTML anywhere). Supports: # / ## / ### headings, - / * / 1. lists,
// **bold**, `code`, ``` fences and [links](https://…). Link targets: http(s) and mailto only.

export type Inline = { t: "text"; v: string } | { t: "bold"; v: string } | { t: "code"; v: string } | { t: "link"; v: string; href: string };

export type Block =
  | { type: "h1" | "h2" | "h3"; inline: Inline[] }
  | { type: "p"; inline: Inline[] }
  | { type: "ul" | "ol"; items: Inline[][] }
  | { type: "code"; lang: string; text: string };

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const push = (n: Inline) => {
    const last = out[out.length - 1];
    if (n.t === "text" && last?.t === "text") last.v += n.v;
    else if (n.t !== "text" || n.v) out.push(n);
  };
  let i = 0;
  let buf = "";
  const flush = () => {
    if (buf) push({ t: "text", v: buf });
    buf = "";
  };
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^\*\*([^*\s][^*]*?)\*\*/))) {
      flush();
      push({ t: "bold", v: m[1] });
      i += m[0].length;
    } else if ((m = rest.match(/^`([^`]+)`/))) {
      flush();
      push({ t: "code", v: m[1] });
      i += m[0].length;
    } else if ((m = rest.match(/^\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/))) {
      flush();
      if (SAFE_HREF.test(m[2])) push({ t: "link", v: m[1], href: m[2] });
      else push({ t: "text", v: m[1] });
      i += m[0].length;
    } else {
      buf += src[i];
      i++;
    }
  }
  flush();
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: Inline[][] } | null = null;
  const endPara = () => {
    if (para.length) blocks.push({ type: "p", inline: parseInline(para.join(" ")) });
    para = [];
  };
  const endList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      endPara();
      endList();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      blocks.push({ type: "code", lang: fence[1], text: body.join("\n") });
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      endPara();
      endList();
      blocks.push({ type: (["h1", "h2", "h3"] as const)[h[1].length - 1], inline: parseInline(h[2].trim()) });
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      endPara();
      const type = ul ? "ul" : "ol";
      if (!list || list.type !== type) {
        endList();
        list = { type, items: [] };
      }
      list.items.push(parseInline((ul ?? ol)![1].trim()));
      continue;
    }
    if (!line.trim()) {
      endPara();
      endList();
      continue;
    }
    endList();
    para.push(line.trim());
  }
  endPara();
  endList();
  return blocks;
}

/** More than the notch card shows (~4 lines): fade + "Open full answer". */
export function isLongReply(src: string): boolean {
  const plain = toPlainText(src);
  return plain.length > 210 || plain.split("\n").length > 4;
}

const inlineText = (xs: Inline[]) => xs.map((x) => x.v).join("");

/** Plain text (one line per block / list item) for compact surfaces like the notch card. */
export function toPlainText(src: string): string {
  return parseMarkdown(src)
    .flatMap((b) => (b.type === "code" ? [b.text] : "items" in b ? b.items.map(inlineText) : [inlineText(b.inline)]))
    .join("\n");
}
