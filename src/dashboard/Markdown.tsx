// Renders assistant markdown (see lib/markdown.ts). All text goes through React, so it's escaped.
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { parseMarkdown, type Inline } from "../lib/markdown";
import { copyText } from "../lib/clipboard";
import { openExternal } from "./Signature";

function Inlines({ xs }: { xs: Inline[] }) {
  return (
    <>
      {xs.map((x, i) =>
        x.t === "bold" ? (
          <strong key={i} className="font-semibold">
            {x.v}
          </strong>
        ) : x.t === "code" ? (
          <code key={i} className="rounded-md bg-[var(--glass-strong)] px-1 py-px font-mono text-[0.9em]">
            {x.v}
          </code>
        ) : x.t === "link" ? (
          <a
            key={i}
            href={x.href}
            className="text-brand-500 underline decoration-brand-400/40 underline-offset-2 hover:decoration-brand-400 dark:text-brand-300"
            onClick={(e) => {
              e.preventDefault();
              openExternal(x.href);
            }}
          >
            {x.v}
          </a>
        ) : (
          <span key={i}>{x.v}</span>
        ),
      )}
    </>
  );
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="group relative my-1 overflow-hidden rounded-xl border border-[var(--border)] bg-black/40" data-testid="md-code">
      <div className="flex h-7 items-center justify-between border-b border-[var(--border)] px-3 text-[11px] text-faint">
        <span>{lang || "code"}</span>
        <button
          aria-label="Copy code"
          title="Copy"
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-[var(--glass-strong)] hover:text-[var(--fg)]"
          onClick={async () => {
            if (await copyText(text)) {
              setDone(true);
              setTimeout(() => setDone(false), 1300);
            }
          }}
        >
          {done ? <Check size={12} /> : <Copy size={12} />} {done ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="selectable overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-white/90">
        <code>{text}</code>
      </pre>
    </div>
  );
}

export function Markdown({ src }: { src: string }) {
  const blocks = parseMarkdown(src);
  return (
    <div className="selectable flex flex-col gap-2 text-[13.5px] leading-relaxed" data-testid="markdown">
      {blocks.map((b, i) => {
        switch (b.type) {
          case "h1":
            return (
              <h3 key={i} className="mt-1 text-[16px] font-semibold tracking-tight">
                <Inlines xs={b.inline} />
              </h3>
            );
          case "h2":
            return (
              <h4 key={i} className="mt-1 text-[14.5px] font-semibold">
                <Inlines xs={b.inline} />
              </h4>
            );
          case "h3":
            return (
              <h5 key={i} className="text-[13.5px] font-semibold text-muted">
                <Inlines xs={b.inline} />
              </h5>
            );
          case "ul":
          case "ol": {
            const L = b.type;
            return (
              <L key={i} className={(L === "ul" ? "list-disc" : "list-decimal") + " flex flex-col gap-0.5 pl-5 marker:text-brand-400"}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inlines xs={it} />
                  </li>
                ))}
              </L>
            );
          }
          case "code":
            return <CodeBlock key={i} lang={b.lang} text={b.text} />;
          default:
            return (
              <p key={i}>
                <Inlines xs={b.inline} />
              </p>
            );
        }
      })}
    </div>
  );
}
