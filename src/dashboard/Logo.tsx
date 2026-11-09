import { useId } from "react";

// Flo mark: Notchling (Classic · Lucid), the notch as a friendly intelligence. Same art as
// brand/notchling-lucid.svg, drawn inline so it scales crisply at every size.
export function LogoMark({ size = 36, className = "", style }: { size?: number; className?: string; style?: React.CSSProperties }) {
  const uid = useId().replace(/:/g, "");
  const id = (n: string) => `flo-${n}-${uid}`;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} fill="none" className={className} style={style} role="img" aria-label="Flo">
      <defs>
        <linearGradient id={id("p")} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="100">
          <stop offset="0" stopColor="#a9dcff" />
          <stop offset=".5" stopColor="#c7b6ff" />
          <stop offset="1" stopColor="#ffc2d6" />
        </linearGradient>
        <linearGradient id={id("gl")} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">
          <stop offset="0" stopColor="#fff" stopOpacity=".3" />
          <stop offset=".45" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={id("eye")} gradientUnits="userSpaceOnUse" x1="0" y1="18" x2="0" y2="34">
          <stop offset="0" stopColor="#c9fbff" />
          <stop offset=".5" stopColor="#7fd2ff" />
          <stop offset="1" stopColor="#b48cff" />
        </linearGradient>
        <linearGradient id={id("body")} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="56">
          <stop offset="0" stopColor="#151827" />
          <stop offset="1" stopColor="#08090f" />
        </linearGradient>
        <filter id={id("eg")} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={id("bl")} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
        <clipPath id={id("c")}>
          <rect width="100" height="100" rx="23" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id("c")})`}>
        <rect width="100" height="100" fill={`url(#${id("p")})`} />
        <path d="M18 -1 H82 V31 A25 25 0 0 1 57 56 H43 A25 25 0 0 1 18 31 Z" fill={`url(#${id("body")})`} />
        <g filter={`url(#${id("eg")})`}>
          <rect x="35.5" y="19.8" width="7" height="12.4" rx="3.5" fill={`url(#${id("eye")})`} />
          <rect x="57.5" y="19.8" width="7" height="12.4" rx="3.5" fill={`url(#${id("eye")})`} />
        </g>
        <circle cx="30.5" cy="41" r="3.3" fill="#ff8fb8" opacity=".6" filter={`url(#${id("bl")})`} />
        <circle cx="69.5" cy="41" r="3.3" fill="#ff8fb8" opacity=".6" filter={`url(#${id("bl")})`} />
        <path d="M43.5 42 C46 45 48.4 45 50 42 S54 39 56.5 42" stroke="#5fb8ff" strokeWidth="2.6" strokeLinecap="round" />
        <rect width="100" height="100" fill={`url(#${id("gl")})`} opacity=".45" />
      </g>
      <rect x=".5" y=".5" width="99" height="99" rx="22.5" stroke="#fff" strokeOpacity=".3" />
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
        filter: glow ? "drop-shadow(0 6px 16px rgb(122 108 255 / 0.35))" : undefined,
      }}
    />
  );
}
