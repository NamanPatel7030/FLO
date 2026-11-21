import { useLayoutEffect, useRef, useState } from "react";

/** A one-line live text that keeps its newest words in view: when it's longer than the line, the
 *  start slides out to the left under a soft fade (never "…" hiding what was just said). For a
 *  right-to-left line the newest words are already at the left edge, so it only fades the far end. */
export function LiveTail({ children, lead, className = "", testId }: { children: React.ReactNode; lead?: React.ReactNode; className?: string; testId?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState<{ shift: number; rtl: boolean; pad: number }>({ shift: 0, rtl: false, pad: 0 });
  // measure after every render (the text grows word by word); same numbers → React skips the update
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const cs = getComputedStyle(o);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const over = Math.max(0, Math.ceil(i.scrollWidth - (o.clientWidth - padL - padR)));
    const rtl = getComputedStyle(i).direction === "rtl";
    const pad = rtl ? padR : padL;
    setFit((f) => (f.shift === over && f.rtl === rtl && f.pad === pad ? f : { shift: over, rtl, pad }));
  });
  // the fade sits on the text's edge, inside the padding
  const fade = fit.shift > 0 ? `linear-gradient(to ${fit.rtl ? "left" : "right"}, transparent ${fit.pad}px, #000 ${fit.pad + 28}px)` : undefined;
  const line = (
    <div
      ref={outer}
      data-testid={lead ? undefined : testId}
      data-overflow={fit.shift > 0 ? (fit.rtl ? "end" : "start") : undefined}
      className={"min-w-0 overflow-hidden whitespace-nowrap " + (lead ? "flex-1" : className)}
      style={fade ? { maskImage: fade, WebkitMaskImage: fade } : undefined}
    >
      <span
        ref={inner}
        dir="auto"
        className="inline-block whitespace-nowrap"
        style={{ transform: fit.shift > 0 && !fit.rtl ? `translateX(${-fit.shift}px)` : undefined, transition: "transform 160ms ease-out" }}
      >
        {children}
      </span>
    </div>
  );
  // a lead (the speaker's name) stays put; only the words after it slide
  if (!lead) return line;
  return (
    <div data-testid={testId} data-overflow={fit.shift > 0 ? (fit.rtl ? "end" : "start") : undefined} className={"flex min-w-0 items-baseline whitespace-nowrap " + className}>
      <span className="shrink-0">{lead}</span>
      {line}
    </div>
  );
}
