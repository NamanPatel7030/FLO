"use client";

import { Fragment, useRef } from "react";
import { useInView } from "motion/react";

type Token = { text: string; accent: boolean };

/** Split `text` into words; the `accent` phrase (if found) stays together as one gradient token. */
function tokenize(text: string, accent?: string): Token[] {
  const words = (s: string) => s.split(/\s+/).filter(Boolean).map((w) => ({ text: w, accent: false }));
  if (!accent) return words(text);
  const at = text.indexOf(accent);
  if (at < 0) return words(text);
  return [...words(text.slice(0, at)), { text: accent, accent: true }, ...words(text.slice(at + accent.length))];
}

/**
 * Text that lands word by word, like Flo writing it: each word rises out of a soft blur ("heading")
 * or simply inks in ("draft", for paragraphs). Pure CSS transitions on opacity/transform (plus a
 * one-shot blur on small inline boxes), driven by a `data-show` flag.
 *
 * `show` controls it directly (e.g. the active chapter); leave it undefined to reveal on scroll.
 */
export function Words({
  text,
  accent,
  show,
  draft = false,
  step,
  base = 0,
  className = "",
  accentClass = "accent-shimmer",
  children,
}: {
  text: string;
  accent?: string;
  show?: boolean;
  draft?: boolean;
  /** ms between words */
  step?: number;
  /** ms before the first word */
  base?: number;
  className?: string;
  accentClass?: string;
  /** rendered after the last word (e.g. a caret) */
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const on = show ?? inView;
  const tokens = tokenize(text, accent);
  const gap = step ?? (draft ? 14 : 70);
  return (
    <span
      ref={ref}
      className={`words ${draft ? "words-draft" : ""} ${className}`}
      data-show={on ? "" : undefined}
      style={{ ["--step" as string]: `${gap}ms`, ["--base" as string]: `${base}ms` }}
    >
      {tokens.map((t, i) => (
        <Fragment key={i}>
          <span className={t.accent ? `w wa ${accentClass}` : "w"} style={{ ["--i" as string]: i }}>
            {t.text}
          </span>
          {i < tokens.length - 1 ? " " : null}
        </Fragment>
      ))}
      {children}
    </span>
  );
}
