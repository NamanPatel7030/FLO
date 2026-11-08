// Maker credit: a handwritten "Naman" that draws itself once, and again on hover.
import { useState } from "react";
import { isTauri } from "../lib/api";
import naman from "../assets/naman.png";

export const MAKER_SITE = "https://hellonaman.com";

export async function openExternal(url: string) {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

// One continuous cursive stroke: N · a · m · a · n (plus an underline flourish).
const PATH =
  "M6 30 C8 22 10 12 12 6 C13 3 14 4 14 8 C15 16 18 26 21 30 C22 32 23 31 23 27 C24 18 25 10 26 5 " +
  "C27 14 28 22 31 25 C34 28 38 22 37 19 C36 16 32 17 31 21 C30 26 34 28 37 24 C38 22 39 20 40 19 " +
  "C40 23 40 26 41 28 C42 22 44 18 46 18 C48 18 48 23 48 28 C49 22 51 18 53 18 C55 18 55 23 55 28 " +
  "C57 25 59 20 62 19 C60 16 56 18 56 22 C56 27 61 27 63 23 C64 21 64 20 65 19 C65 23 65 26 67 27 " +
  "C68 22 70 18 73 18 C76 18 75 24 76 28 C78 29 82 26 85 22 " +
  "M10 36 C30 33 55 33 86 31";

/** The handwritten "Naman" mark (draws itself; remount with a new key to redraw). */
export function SignatureMark({ className = "h-[22px] w-[52px]", id = "sig" }: { className?: string; id?: string }) {
  return (
    <svg viewBox="0 0 92 40" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}-grad`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" style={{ stopColor: "var(--color-brand-100)" }} />
          <stop offset="0.55" style={{ stopColor: "var(--color-brand-400)" }} />
          <stop offset="1" style={{ stopColor: "var(--color-brand-600)" }} />
        </linearGradient>
      </defs>
      <path
        d={PATH}
        pathLength={1}
        fill="none"
        stroke={`url(#${id}-grad)`}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="flo-sig"
        style={{ filter: "drop-shadow(0 0 3px rgb(var(--accent-rgb) / 0.45))" }}
      />
    </svg>
  );
}

/** Round cut-out portrait over a light-blue → deep-navy glow, thin ring, subtle shine. */
export function Portrait({ size }: { size: number }) {
  return (
    <span
      className="relative inline-flex shrink-0 overflow-hidden rounded-full"
      style={{
        width: size,
        height: size,
        background: "radial-gradient(circle at 50% 35%, var(--color-brand-400) 0%, var(--color-brand-600) 38%, color-mix(in oklab, var(--accent) 22%, black) 78%, #020b14 100%)",
        boxShadow: "0 0 0 1px rgb(var(--accent-2-rgb) / 0.55), 0 0 18px -4px rgb(var(--accent-rgb) / 0.6)",
      }}
    >
      <img src={naman} alt="Naman Gundaniya" className="absolute inset-x-0 bottom-0 h-[112%] w-full object-cover object-top" draggable={false} />
      <span className="pointer-events-none absolute inset-0 rounded-full" style={{ background: "linear-gradient(160deg, rgba(255,255,255,0.28), transparent 42%)" }} />
    </span>
  );
}

export function Signature() {
  const [k, setK] = useState(0);
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={() => openExternal(MAKER_SITE)}
      onMouseEnter={() => {
        setK((x) => x + 1);
        setHover(true);
      }}
      onMouseLeave={() => setHover(false)}
      title="Crafted by Naman Gundaniya · hellonaman.com"
      aria-label="Crafted by Naman Gundaniya"
      className="group flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition hover:bg-[var(--glass)]"
    >
      <span className="text-[9.5px] font-medium uppercase tracking-[0.14em] text-faint group-hover:text-muted">crafted by</span>
      <span
        className="overflow-hidden transition-all duration-300"
        style={{ width: hover ? 24 : 0, opacity: hover ? 1 : 0 }}
        aria-hidden
      >
        <Portrait size={24} />
      </span>
      <SignatureMark key={k} />
    </button>
  );
}
