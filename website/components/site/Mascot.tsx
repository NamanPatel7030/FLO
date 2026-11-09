"use client";

import { useId } from "react";

/**
 * Notchling (Classic · Lucid), Flo's mascot: the notch as a friendly intelligence. One SVG, a few
 * moods. Animations are CSS (blink, talk, bounce…) defined in globals.css under `.nl-*`, and stop
 * under prefers-reduced-motion.
 */
export type Mood = "happy" | "excited" | "listen" | "think" | "celebrate" | "love" | "sleepy" | "sad" | "fire" | "cool";

const notch = "M18 -1 H82 V31 A25 25 0 0 1 57 56 H43 A25 25 0 0 1 18 31 Z";
const star4 = (cx: number, cy: number, r: number) => {
  const k = r * 0.14;
  return `M${cx} ${cy - r} C${cx + k} ${cy - k} ${cx + k} ${cy - k} ${cx + r} ${cy} C${cx + k} ${cy + k} ${cx + k} ${cy + k} ${cx} ${cy + r} C${cx - k} ${cy + k} ${cx - k} ${cy + k} ${cx - r} ${cy} C${cx - k} ${cy - k} ${cx - k} ${cy - k} ${cx} ${cy - r} Z`;
};
const heart = (cx: number, cy: number, s: number) =>
  `M${cx} ${cy + s * 0.9} C${cx - s * 1.6} ${cy - s * 0.2} ${cx - s * 0.8} ${cy - s * 1.4} ${cx} ${cy - s * 0.5} C${cx + s * 0.8} ${cy - s * 1.4} ${cx + s * 1.6} ${cy - s * 0.2} ${cx} ${cy + s * 0.9} Z`;
const drop = (cx: number, cy: number, s: number) => `M${cx} ${cy - s} C${cx + s * 0.9} ${cy + s * 0.1} ${cx + s * 0.75} ${cy + s} ${cx} ${cy + s} C${cx - s * 0.75} ${cy + s} ${cx - s * 0.9} ${cy + s * 0.1} ${cx} ${cy - s} Z`;

function face(mood: Mood, u: string) {
  const eye = `url(#${u}e)`;
  const pill = (x: number) => `<rect class="nl-blink" x="${x - 3.5}" y="19.8" width="7" height="12.4" rx="3.5" fill="${eye}"/>`;
  const arc = (x: number, up: boolean) => `<path d="M${x - 4.4} ${up ? 28 : 25.5} Q${x} ${up ? 21.5 : 29.8} ${x + 4.4} ${up ? 28 : 25.5}" fill="none" stroke="${eye}" stroke-width="3" stroke-linecap="round"/>`;
  const dot = (x: number) => `<g class="nl-blink"><circle cx="${x}" cy="26" r="4.8" fill="${eye}"/><circle cx="${x + 1}" cy="25" r="2" fill="#0b0d16"/></g>`;
  const brow = (d: string) => `<path d="${d}" fill="none" stroke="${eye}" stroke-width="2.4" stroke-linecap="round"/>`;
  let eyes = pill(39) + pill(61);
  let mouth = `<path class="nl-talk" d="M43.5 42 C46 45 48.4 45 50 42 S54 39 56.5 42" fill="none" stroke="#5fb8ff" stroke-width="2.6" stroke-linecap="round"/>`;
  let extra = "";
  let blush = true;
  switch (mood) {
    case "excited":
      eyes = `<path class="nl-twinkle" d="${star4(39, 26, 6.2)}" fill="#ffd36b"/><path class="nl-twinkle" d="${star4(61, 26, 6.2)}" fill="#ffd36b" style="animation-delay:-.9s"/>`;
      mouth = `<path d="M43.5 40 Q50 39.5 56.5 40 Q55 49 50 49 Q45 49 43.5 40 Z" fill="#5fb8ff"/><path d="M46.5 46.6 Q50 44.4 53.5 46.6 Q50 48.8 46.5 46.6 Z" fill="#ff5c8a"/>`;
      extra = `<path class="nl-twinkle" d="${star4(82, 70, 6)}" fill="#fff"/><path class="nl-twinkle" d="${star4(20, 76, 3.8)}" fill="#fff" style="animation-delay:-.8s"/>`;
      break;
    case "listen":
      eyes = dot(39) + dot(61);
      mouth = `<ellipse class="nl-talk" cx="50" cy="42" rx="2.8" ry="3.6" fill="#5fb8ff"/>`;
      blush = false;
      extra = [0, 1].map((k) => `<path class="nl-ring" style="animation-delay:${-k * 0.8}s" d="M${10 - k * 3} 18 Q${4 - k * 3} 28 ${10 - k * 3} 38" fill="none" stroke="#5fb8ff" stroke-width="2.2" stroke-linecap="round"/><path class="nl-ring" style="animation-delay:${-k * 0.8}s" d="M${90 + k * 3} 18 Q${96 + k * 3} 28 ${90 + k * 3} 38" fill="none" stroke="#5fb8ff" stroke-width="2.2" stroke-linecap="round"/>`).join("");
      break;
    case "think":
      eyes = `<g class="nl-blink"><circle cx="39" cy="26" r="4.6" fill="${eye}"/><circle cx="41" cy="24" r="2" fill="#0b0d16"/></g><g class="nl-blink"><circle cx="61" cy="26" r="4.6" fill="${eye}"/><circle cx="63" cy="24" r="2" fill="#0b0d16"/></g>`;
      mouth = `<path d="M46 42 H54" stroke="#5fb8ff" stroke-width="2.6" stroke-linecap="round"/>`;
      blush = false;
      extra = `<g class="nl-bounce" style="animation-duration:1.6s"><rect x="60" y="64" width="26" height="15" rx="7.5" fill="#fff"/><path d="M66 78 L63 84 L71 78 Z" fill="#fff"/>${[0, 1, 2].map((k) => `<circle class="nl-twinkle" style="animation-delay:${-k * 0.3}s" cx="${67 + k * 6}" cy="71.5" r="1.9" fill="#7a6cff"/>`).join("")}</g>`;
      break;
    case "celebrate":
      eyes = arc(39, true) + arc(61, true);
      mouth = `<path d="M43.5 40 Q50 39.5 56.5 40 Q55 49 50 49 Q45 49 43.5 40 Z" fill="#5fb8ff"/><path d="M46.5 46.6 Q50 44.4 53.5 46.6 Q50 48.8 46.5 46.6 Z" fill="#ff5c8a"/>`;
      extra = ["#ff5c8a", "#ffd36b", "#5fd3b0", "#7cc4ff", "#b38cff", "#ff9a5c"].map((c, i) => `<rect class="nl-confetti" x="${16 + i * 13}" y="${58 + (i % 2) * 6}" width="3.4" height="6" rx="1" fill="${c}" style="animation-delay:${-i * 0.35}s"/>`).join("");
      break;
    case "love":
      eyes = `<path class="nl-twinkle" d="${heart(39, 26, 4.4)}" fill="#ff4f8b"/><path class="nl-twinkle" d="${heart(61, 26, 4.4)}" fill="#ff4f8b" style="animation-delay:-.9s"/>`;
      mouth = `<path d="M45 41 Q50 45.5 55 41" fill="none" stroke="#5fb8ff" stroke-width="2.6" stroke-linecap="round"/>`;
      extra = [[78, 74, 5, 0], [24, 80, 3.6, -1.1], [64, 88, 3, -1.8]].map(([x, y, s, d]) => `<path class="nl-rise" style="animation-delay:${d}s" d="${heart(x, y, s)}" fill="#ff4f8b"/>`).join("");
      break;
    case "sleepy":
      eyes = arc(39, false) + arc(61, false);
      mouth = `<path d="M45 41 Q50 45.5 55 41" fill="none" stroke="#5fb8ff" stroke-width="2.6" stroke-linecap="round"/>`;
      extra = `<g class="nl-rise" fill="#7a6cff" font-family="Inter, sans-serif" font-weight="800"><text x="72" y="80" font-size="11">z</text><text x="80" y="71" font-size="8">z</text><text x="86" y="64" font-size="6">z</text></g>`;
      break;
    case "sad":
      eyes = `${brow("M34 17 L43 14")}${brow("M66 17 L57 14")}<path d="M35 26 Q39 30.5 43 26" fill="${eye}"/><path d="M57 26 Q61 30.5 65 26" fill="${eye}"/>`;
      mouth = `<path d="M45 44.5 Q50 39.5 55 44.5" fill="none" stroke="#5fb8ff" stroke-width="2.6" stroke-linecap="round"/>`;
      blush = false;
      extra = `<path class="nl-fall" d="${drop(36, 34, 2.6)}" fill="#7cc4ff"/>`;
      break;
    case "fire":
      eyes = `<path d="M35.5 23 L42.5 25 V31 A3.5 3.5 0 0 1 35.5 31 Z" fill="${eye}"/><path d="M64.5 23 L57.5 25 V31 A3.5 3.5 0 0 0 64.5 31 Z" fill="${eye}"/>`;
      mouth = `<path d="M45 43 Q51 45.8 56 40" fill="none" stroke="#5fb8ff" stroke-width="2.6" stroke-linecap="round"/>`;
      blush = false;
      extra = [[14, 0], [86, -0.35]].map(([x, d]) => `<path class="nl-flame" style="animation-delay:${d}s" d="M${x} 64 C${x - 7} 56 ${x - 4} 46 ${x} 38 C${x + 1} 46 ${x + 7} 50 ${x + 5} 58 C${x + 4} 62 ${x + 2} 64 ${x} 64 Z" fill="url(#${u}f)"/>`).join("");
      break;
    case "cool":
      eyes = `<rect x="28" y="20" width="44" height="12" rx="6" fill="url(#${u}v)"/><path d="M32 23 H54" stroke="#fff" stroke-width="1.7" stroke-linecap="round" opacity=".65"/>`;
      mouth = `<path d="M45 43 Q51 45.8 56 40" fill="none" stroke="#5fb8ff" stroke-width="2.6" stroke-linecap="round"/>`;
      blush = false;
      break;
  }
  const cheeks = blush ? `<circle cx="30.5" cy="41" r="3.3" fill="#ff8fb8" opacity=".6" filter="url(#${u}b)"/><circle cx="69.5" cy="41" r="3.3" fill="#ff8fb8" opacity=".6" filter="url(#${u}b)"/>` : "";
  return { eyes, mouth, cheeks, extra };
}

const MOVE: Partial<Record<Mood, string>> = { excited: "nl-bounce", celebrate: "nl-jump", love: "nl-sway", sleepy: "nl-droop", sad: "nl-droop", fire: "nl-bounce", think: "nl-tilt", cool: "nl-sway" };

export function Mascot({ mood = "happy", size = 120, plate = true, className = "", title = "Notchling, Flo's mascot" }: { mood?: Mood; size?: number; plate?: boolean; className?: string; title?: string }) {
  const u = "nl" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const f = face(mood, u);
  const gray = mood === "sad" ? `filter="url(#${u}g)"` : "";
  const fireGlow = mood === "fire" ? `<ellipse cx="50" cy="60" rx="34" ry="20" fill="#ff7a2f" opacity=".5" filter="url(#${u}big)"/>` : "";
  const svg = `<svg viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${title}">
    <defs>
      <linearGradient id="${u}p" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="100"><stop offset="0" stop-color="#a9dcff"/><stop offset=".5" stop-color="#c7b6ff"/><stop offset="1" stop-color="#ffc2d6"/></linearGradient>
      <linearGradient id="${u}gl" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <linearGradient id="${u}e" gradientUnits="userSpaceOnUse" x1="0" y1="18" x2="0" y2="34"><stop offset="0" stop-color="#c9fbff"/><stop offset=".5" stop-color="#7fd2ff"/><stop offset="1" stop-color="#b48cff"/></linearGradient>
      <linearGradient id="${u}body" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="56"><stop offset="0" stop-color="#151827"/><stop offset="1" stop-color="#08090f"/></linearGradient>
      <linearGradient id="${u}v" gradientUnits="userSpaceOnUse" x1="28" y1="0" x2="72" y2="0"><stop offset="0" stop-color="#5fb8ff"/><stop offset="1" stop-color="#ff7eb0"/></linearGradient>
      <linearGradient id="${u}f" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff4f3b"/><stop offset=".55" stop-color="#ff9a2f"/><stop offset="1" stop-color="#ffe36b"/></linearGradient>
      <filter id="${u}eg" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="${u}b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2"/></filter>
      <filter id="${u}big" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="9"/></filter>
      <filter id="${u}g"><feColorMatrix type="saturate" values=".25"/></filter>
      <clipPath id="${u}c"><rect width="100" height="100" rx="23"/></clipPath>
    </defs>
    <g clip-path="url(#${u}c)"><g ${gray}>
      ${plate ? `<rect width="100" height="100" fill="url(#${u}p)"/>` : ""}${fireGlow}
      <g class="${MOVE[mood] ?? ""}"><path d="${notch}" fill="url(#${u}body)"/><g filter="url(#${u}eg)">${f.eyes}</g>${f.cheeks}${f.mouth}</g>
      ${f.extra}
    </g>${plate ? `<rect width="100" height="100" fill="url(#${u}gl)" opacity=".45"/>` : ""}</g>
    ${plate ? `<rect x=".5" y=".5" width="99" height="99" rx="22.5" fill="none" stroke="#fff" stroke-opacity=".3"/>` : ""}
  </svg>`;
  return <span className={`inline-block leading-none ${className}`} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Just the glowing eyes, for places that are already a black notch (the site's top notch). */
export function NotchEyes({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-[7px] ${className}`} aria-hidden>
      {[0, 1].map((k) => (
        <i key={k} className="nl-blink block h-[13px] w-[7px] rounded-full" style={{ background: "linear-gradient(#c9fbff, #7fd2ff 50%, #b48cff)", boxShadow: "0 0 8px rgba(127,210,255,.85)" }} />
      ))}
    </span>
  );
}
