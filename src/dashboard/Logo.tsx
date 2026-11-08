import { useId } from "react";

// Flo mark — a deep glass tile with a flowing wave. Drawn inline (not an <img>) so every colour comes
// from the live accent CSS vars and the logo recolours the instant the Accent changes in Settings.
// Gradient stops use `style` (CSS) rather than the stop-color attribute so var()/color-mix() resolve.
const c = (pct: number, to: "white" | "black") => `color-mix(in oklab, var(--accent) ${pct}%, ${to})`;

export function LogoMark({ size = 36, className = "", style }: { size?: number; className?: string; style?: React.CSSProperties }) {
  const uid = useId().replace(/:/g, "");
  const id = (n: string) => `flo-${n}-${uid}`;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} fill="none" className={className} style={style} role="img" aria-label="Flo">
      <defs>
        <linearGradient id={id("bg")} x1="6" y1="4" x2="58" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: c(30, "black") }} />
          <stop offset="0.55" style={{ stopColor: c(12, "black") }} />
          <stop offset="1" style={{ stopColor: "#010306" }} />
        </linearGradient>
        <radialGradient id={id("glow")} cx="18" cy="12" r="34" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: c(80, "white"), stopOpacity: 0.38 }} />
          <stop offset="1" style={{ stopColor: c(80, "white"), stopOpacity: 0 }} />
        </radialGradient>
        <linearGradient id={id("wave")} x1="13" y1="20" x2="51" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: c(13, "white") }} />
          <stop offset="0.5" style={{ stopColor: c(80, "white") }} />
          <stop offset="1" style={{ stopColor: c(84, "black") }} />
        </linearGradient>
        <linearGradient id={id("rim")} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: c(32, "white"), stopOpacity: 0.55 }} />
          <stop offset="1" style={{ stopColor: "var(--accent)", stopOpacity: 0.12 }} />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="62" height="62" rx="16" fill={`url(#${id("bg")})`} />
      <rect x="1" y="1" width="62" height="62" rx="16" fill={`url(#${id("glow")})`} />
      <rect x="1.5" y="1.5" width="61" height="61" rx="15.5" stroke={`url(#${id("rim")})`} />
      <path d="M14 39c5-14 12-14 18-7s13 7 18-7" style={{ stroke: c(80, "white") }} strokeOpacity="0.28" strokeWidth="3.5" strokeLinecap="round" transform="translate(0 6)" />
      <path d="M14 37c5-14 12-14 18-7s13 7 18-7" stroke={`url(#${id("wave")})`} strokeWidth="6.5" strokeLinecap="round" />
      <circle cx="50" cy="23" r="3.3" style={{ fill: c(13, "white") }} />
    </svg>
  );
}

export function Logo({ size = 36, glow = true, className = "" }: { size?: number; glow?: boolean; className?: string }) {
  return (
    <LogoMark
      size={size}
      className={className}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: size * 0.25,
        filter: glow ? "drop-shadow(0 6px 18px rgb(var(--accent-rgb) / 0.35))" : undefined,
      }}
    />
  );
}
