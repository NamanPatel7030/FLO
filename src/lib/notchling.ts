// Notchling: Flo's mascot, the MacBook notch as a friendly intelligence (Classic · Lucid).
// Pure SVG markup builders (no React) so the same drawing serves the notch, Settings previews,
// tests and any static export. Animations are CSS classes (nl-*) defined in styles.css; nothing
// runs per frame in JS.

export type NotchlingMood =
  | "happy" | "excited" | "celebrate" | "fire" | "listen" | "talk" | "think" | "proud"
  | "love" | "surprised" | "sleepy" | "sad" | "cry" | "grumpy" | "worried" | "cool";

export const MOODS: NotchlingMood[] = ["happy", "excited", "celebrate", "fire", "listen", "talk", "think", "proud", "love", "surprised", "sleepy", "sad", "cry", "grumpy", "worried", "cool"];

export type AvatarEyes = "pill" | "round" | "happy" | "anime" | "visor";
export type AvatarGlow = "lucid" | "aurora" | "mint" | "sunset" | "accent";
export type AvatarMouth = "wave" | "smile" | "cat";
export type AvatarAccessory = "none" | "headphones" | "halo" | "sparkle";

export interface AvatarSettings {
  /** show the face in the notch */
  enabled: boolean;
  eyes: AvatarEyes;
  glow: AvatarGlow;
  mouth: AvatarMouth;
  blush: boolean;
  accessory: AvatarAccessory;
}

/** Classic · Lucid, exactly as chosen */
export const DEFAULT_AVATAR: AvatarSettings = { enabled: true, eyes: "pill", glow: "lucid", mouth: "wave", blush: true, accessory: "none" };

export function normalizeAvatar(a?: Partial<AvatarSettings> | null): AvatarSettings {
  const d = DEFAULT_AVATAR;
  const pick = <T extends string>(v: unknown, ok: readonly T[], def: T): T => (ok.includes(v as T) ? (v as T) : def);
  return {
    enabled: typeof a?.enabled === "boolean" ? a.enabled : d.enabled,
    eyes: pick(a?.eyes, ["pill", "round", "happy", "anime", "visor"] as const, d.eyes),
    glow: pick(a?.glow, ["lucid", "aurora", "mint", "sunset", "accent"] as const, d.glow),
    mouth: pick(a?.mouth, ["wave", "smile", "cat"] as const, d.mouth),
    blush: typeof a?.blush === "boolean" ? a.blush : d.blush,
    accessory: pick(a?.accessory, ["none", "headphones", "halo", "sparkle"] as const, d.accessory),
  };
}

/** eye-glow gradients (top → bottom) */
export const GLOWS: Record<AvatarGlow, { label: string; stops: [string, string, string] }> = {
  lucid: { label: "Lucid", stops: ["#c9fbff", "#7fd2ff", "#b48cff"] },
  aurora: { label: "Aurora", stops: ["#b8f7ff", "#a99bff", "#ff8fd0"] },
  mint: { label: "Mint", stops: ["#d8fff1", "#6ff2c4", "#3fb6ff"] },
  sunset: { label: "Sunset", stops: ["#fff1b8", "#ffb36b", "#ff6f9a"] },
  accent: { label: "Accent", stops: ["#ffffff", "#3dbbff", "#1a9be0"] },
};

type MoodSpec = { eyes: string; mouth: string; blush?: boolean; move?: string; extra?: string; tint?: "fire" | "red" | "gray" };
const SPEC: Record<NotchlingMood, MoodSpec> = {
  happy: { eyes: "user", mouth: "user", blush: true },
  excited: { eyes: "star", mouth: "grin", blush: true, move: "nl-bounce", extra: "sparkle" },
  celebrate: { eyes: "happy", mouth: "grin", blush: true, move: "nl-jump", extra: "confetti" },
  fire: { eyes: "determined", mouth: "smirk", move: "nl-bounce", extra: "flames", tint: "fire" },
  listen: { eyes: "listen", mouth: "o", extra: "rings" },
  talk: { eyes: "user", mouth: "eq" },
  think: { eyes: "look", mouth: "flat", move: "nl-tilt", extra: "dots" },
  proud: { eyes: "happy", mouth: "smirk", blush: true, move: "nl-tilt", extra: "sparkle" },
  love: { eyes: "heart", mouth: "smile", blush: true, move: "nl-sway", extra: "hearts" },
  surprised: { eyes: "big", mouth: "bigO", move: "nl-jump", extra: "bang" },
  sleepy: { eyes: "sleepy", mouth: "smile", blush: true, move: "nl-droop", extra: "zzz" },
  sad: { eyes: "sad", mouth: "frown", move: "nl-droop", extra: "tear", tint: "gray" },
  cry: { eyes: "sad", mouth: "wobble", move: "nl-shake", extra: "streams", tint: "gray" },
  grumpy: { eyes: "angry", mouth: "zigzag", move: "nl-shake", extra: "steam", tint: "red" },
  worried: { eyes: "worried", mouth: "wavy", extra: "sweat" },
  cool: { eyes: "visor", mouth: "smirk", move: "nl-sway", extra: "sparkle" },
};

export const MOOD_LABEL: Record<NotchlingMood, string> = {
  happy: "Happy", excited: "Excited", celebrate: "Celebrating", fire: "On fire", listen: "Listening", talk: "Talking",
  think: "Thinking", proud: "Proud", love: "In love", surprised: "Surprised", sleepy: "Sleepy", sad: "Missing you",
  cry: "Crying", grumpy: "Grumpy", worried: "Worried", cool: "Cool",
};

const INK = "#0b0d16";
const notchD = (x: number, w: number, h: number, r: number) => `M${x} -1 H${x + w} V${h - r} A${r} ${r} 0 0 1 ${x + w - r} ${h} H${x + r} A${r} ${r} 0 0 1 ${x} ${h - r} Z`;
const rr = (x: number, y: number, w: number, h: number, r: number) => `M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r} V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} H${x + r} A${r} ${r} 0 0 1 ${x} ${y + h - r} V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`;
const star4 = (cx: number, cy: number, r: number) => { const k = r * 0.14; return `M${cx} ${cy - r} C${cx + k} ${cy - k} ${cx + k} ${cy - k} ${cx + r} ${cy} C${cx + k} ${cy + k} ${cx + k} ${cy + k} ${cx} ${cy + r} C${cx - k} ${cy + k} ${cx - k} ${cy + k} ${cx - r} ${cy} C${cx - k} ${cy - k} ${cx - k} ${cy - k} ${cx} ${cy - r} Z`; };
const heart = (cx: number, cy: number, s: number) => `M${cx} ${cy + s * 0.9} C${cx - s * 1.6} ${cy - s * 0.2} ${cx - s * 0.8} ${cy - s * 1.4} ${cx} ${cy - s * 0.5} C${cx + s * 0.8} ${cy - s * 1.4} ${cx + s * 1.6} ${cy - s * 0.2} ${cx} ${cy + s * 0.9} Z`;
const drop = (cx: number, cy: number, s: number) => `M${cx} ${cy - s} C${cx + s * 0.9} ${cy + s * 0.1} ${cx + s * 0.75} ${cy + s} ${cx} ${cy + s} C${cx - s * 0.75} ${cy + s} ${cx - s * 0.9} ${cy + s * 0.1} ${cx} ${cy - s} Z`;

function eyes(kind: string, c: string, u: string): string {
  const ey = 26, L = 39, R = 61;
  const pupil = c === INK ? "#fff" : INK;
  const pill = (x: number) => `<rect class="nl-blink" x="${x - 3.5}" y="${ey - 6.2}" width="7" height="12.4" rx="3.5" fill="${c}"/>`;
  const arc = (x: number, up: boolean, w = 3) => `<path d="M${x - 4.4} ${ey + (up ? 2 : -0.5)} Q${x} ${ey + (up ? -4.5 : 3.8)} ${x + 4.4} ${ey + (up ? 2 : -0.5)}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
  const dot = (x: number, r: number, dx = 0, dy = 0) => `<g class="nl-blink"><circle cx="${x}" cy="${ey}" r="${r}" fill="${c}"/><circle cx="${x + dx}" cy="${ey + dy}" r="${r * 0.45}" fill="${pupil}"/></g>`;
  const anime = (x: number) => `<g class="nl-blink"><ellipse cx="${x}" cy="${ey}" rx="5.6" ry="6.8" fill="${c}"/><ellipse cx="${x + 0.6}" cy="${ey + 0.8}" rx="3.4" ry="4.4" fill="${pupil}"/><circle cx="${x + 2}" cy="${ey - 2.6}" r="1.6" fill="#fff"/></g>`;
  const brow = (d: string) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>`;
  switch (kind) {
    case "pill": return pill(L) + pill(R);
    case "happy": return arc(L, true) + arc(R, true);
    case "sleepy": return arc(L, false, 2.6) + arc(R, false, 2.6);
    case "round": return dot(L, 4.6, 1, -1) + dot(R, 4.6, 1, -1);
    case "anime": return anime(L) + anime(R);
    case "big": return dot(L, 6) + dot(R, 6);
    case "look": return dot(L, 4.6, 2, -2) + dot(R, 4.6, 2, -2);
    case "star": return `<path class="nl-twinkle" d="${star4(L, ey, 6.2)}" fill="#ffd36b"/><path class="nl-twinkle" d="${star4(R, ey, 6.2)}" fill="#ffd36b" style="animation-delay:-.9s"/>`;
    case "heart": return `<path class="nl-twinkle" d="${heart(L, ey, 4.4)}" fill="#ff4f8b"/><path class="nl-twinkle" d="${heart(R, ey, 4.4)}" fill="#ff4f8b" style="animation-delay:-.9s"/>`;
    case "determined": return `<path d="M${L - 3.5} ${ey - 3} L${L + 3.5} ${ey - 1} V${ey + 5} A3.5 3.5 0 0 1 ${L - 3.5} ${ey + 5} Z" fill="${c}"/><path d="M${R + 3.5} ${ey - 3} L${R - 3.5} ${ey - 1} V${ey + 5} A3.5 3.5 0 0 0 ${R + 3.5} ${ey + 5} Z" fill="${c}"/>`;
    case "sad": return `${brow(`M${L - 5} ${ey - 9} L${L + 4} ${ey - 12}`)}${brow(`M${R + 5} ${ey - 9} L${R - 4} ${ey - 12}`)}<path d="M${L - 4} ${ey} Q${L} ${ey + 4.5} ${L + 4} ${ey}" fill="${c}"/><path d="M${R - 4} ${ey} Q${R} ${ey + 4.5} ${R + 4} ${ey}" fill="${c}"/>`;
    case "angry": return `${brow(`M${L - 5} ${ey - 11} L${L + 4} ${ey - 7}`)}${brow(`M${R + 5} ${ey - 11} L${R - 4} ${ey - 7}`)}<rect x="${L - 3.5}" y="${ey - 3.5}" width="7" height="9" rx="3.5" fill="${c}"/><rect x="${R - 3.5}" y="${ey - 3.5}" width="7" height="9" rx="3.5" fill="${c}"/>`;
    case "worried": return `${brow(`M${L - 5} ${ey - 8} L${L + 4} ${ey - 11}`)}${brow(`M${R + 5} ${ey - 8} L${R - 4} ${ey - 11}`)}${dot(L, 4.2, 0, 1)}${dot(R, 4.2, 0, 1)}`;
    case "visor": return `<path d="${rr(28, ey - 6, 44, 12, 6)}" fill="url(#${u}v)"/><path d="M32 ${ey - 3} H54" stroke="#fff" stroke-width="1.7" stroke-linecap="round" opacity=".65"/>`;
  }
  return "";
}

function mouth(kind: string, c: string): string {
  const my = 42;
  switch (kind) {
    case "wave": return `<path class="nl-talk" style="animation-duration:2.4s" d="M43.5 ${my} C46 ${my + 3} 48.4 ${my + 3} 50 ${my} S54 ${my - 3} 56.5 ${my}" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`;
    case "smile": return `<path d="M45 ${my - 1} Q50 ${my + 4.5} 55 ${my - 1}" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`;
    case "cat": return `<path d="M44 ${my - 1} Q47 ${my + 2.6} 50 ${my - 1} Q53 ${my + 2.6} 56 ${my - 1}" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>`;
    case "grin": return `<path d="M43.5 ${my - 2} Q50 ${my - 2.5} 56.5 ${my - 2} Q55 ${my + 7} 50 ${my + 7} Q45 ${my + 7} 43.5 ${my - 2} Z" fill="${c}"/><path d="M46.5 ${my + 4.6} Q50 ${my + 2.4} 53.5 ${my + 4.6} Q50 ${my + 6.8} 46.5 ${my + 4.6} Z" fill="#ff5c8a" opacity=".9"/>`;
    case "smirk": return `<path d="M45 ${my + 1} Q51 ${my + 3.8} 56 ${my - 2}" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`;
    case "o": return `<ellipse class="nl-talk" cx="50" cy="${my}" rx="2.8" ry="3.6" fill="${c}"/>`;
    case "bigO": return `<ellipse cx="50" cy="${my + 1}" rx="3.8" ry="5" fill="${c}"/>`;
    case "eq": return `<g class="nl-eq">${[3, 6, 9, 6, 3].map((h, i) => `<rect x="${44.2 + i * 2.6}" y="${my - h / 2}" width="1.8" height="${h}" rx=".9" fill="${c}"/>`).join("")}</g>`;
    case "flat": return `<path d="M46 ${my} H54" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`;
    case "frown": return `<path d="M45 ${my + 2.5} Q50 ${my - 2.5} 55 ${my + 2.5}" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`;
    case "wobble": return `<path d="M44 ${my + 3} Q46 ${my - 1} 48 ${my + 1} Q50 ${my - 2} 52 ${my + 1} Q54 ${my - 1} 56 ${my + 3}" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "zigzag": return `<path d="M44 ${my + 1} L47 ${my - 1.5} L50 ${my + 1} L53 ${my - 1.5} L56 ${my + 1}" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "wavy": return `<path d="M44 ${my} q1.5 -2 3 0 t3 0 t3 0 t3 0" fill="none" stroke="${c}" stroke-width="2.3" stroke-linecap="round"/>`;
  }
  return "";
}

/** extras that move with the face */
function faceExtra(kind: string | undefined): string {
  switch (kind) {
    case "tear": return `<path class="nl-fall" d="${drop(36, 34, 2.6)}" fill="#7cc4ff"/>`;
    case "streams": return `<path d="M36.5 29 V50" stroke="#7cc4ff" stroke-width="3" stroke-linecap="round" opacity=".85"/><path d="M63.5 29 V50" stroke="#7cc4ff" stroke-width="3" stroke-linecap="round" opacity=".85"/><path class="nl-fall" d="${drop(36.5, 52, 2.4)}" fill="#7cc4ff"/><path class="nl-fall" d="${drop(63.5, 52, 2.4)}" fill="#7cc4ff" style="animation-delay:-.9s"/>`;
    case "sweat": return `<path class="nl-fall" style="animation-duration:2.4s" d="${drop(73, 14, 2.8)}" fill="#8fd6ff"/>`;
  }
  return "";
}

/** extras around the character; `near` = only the ones that fit beside the notch (bare mode) */
function sceneExtra(kind: string | undefined, acc: string, near: boolean): string {
  switch (kind) {
    case "rings": return [0, 1].map((k) => `<path class="nl-ring" style="animation-delay:${-k * 0.8}s" d="M${11 - k * 3} 16 Q${5 - k * 3} 26 ${11 - k * 3} 36" fill="none" stroke="${acc}" stroke-width="2.4" stroke-linecap="round"/><path class="nl-ring" style="animation-delay:${-k * 0.8}s" d="M${89 + k * 3} 16 Q${95 + k * 3} 26 ${89 + k * 3} 36" fill="none" stroke="${acc}" stroke-width="2.4" stroke-linecap="round"/>`).join("");
    case "sparkle": return near ? `<path class="nl-twinkle" d="${star4(88, 44, 5)}" fill="#fff"/>` : `<path class="nl-twinkle" d="${star4(81, 70, 6)}" fill="#fff"/><path class="nl-twinkle" d="${star4(20, 76, 3.8)}" fill="#fff" style="animation-delay:-.8s"/><path class="nl-twinkle" d="${star4(70, 86, 2.6)}" fill="#fff" style="animation-delay:-1.4s"/>`;
    case "zzz": return near ? `<g class="nl-rise" fill="${acc}" font-family="Inter, sans-serif" font-weight="800"><text x="84" y="46" font-size="10">z</text><text x="90" y="36" font-size="7">z</text></g>` : `<g class="nl-rise" fill="${acc}" font-family="Inter, sans-serif" font-weight="800"><text x="72" y="80" font-size="11">z</text><text x="80" y="71" font-size="8">z</text><text x="86" y="64" font-size="6">z</text></g>`;
    case "hearts": return near ? `<path class="nl-rise" d="${heart(88, 44, 4)}" fill="#ff4f8b"/>` : [[78, 74, 5, 0], [24, 80, 3.6, -1.1], [64, 88, 3, -1.8]].map(([x, y, s, d]) => `<path class="nl-rise" style="animation-delay:${d}s" d="${heart(x, y, s)}" fill="#ff4f8b"/>`).join("");
    case "dots": return near ? [0, 1, 2].map((k) => `<circle class="nl-twinkle" style="animation-delay:${-k * 0.3}s" cx="${84 + k * 4.5}" cy="50" r="1.8" fill="${acc}"/>`).join("") : `<g><path d="${rr(60, 64, 26, 15, 7.5)}" fill="#fff"/><path d="M66 78 L63 84 L71 78 Z" fill="#fff"/>${[0, 1, 2].map((k) => `<circle class="nl-twinkle" style="animation-delay:${-k * 0.3}s" cx="${67 + k * 6}" cy="71.5" r="1.9" fill="${acc}"/>`).join("")}</g>`;
    case "bang": return near ? `<g class="nl-twinkle"><path d="M88 34 L89 46" stroke="#ff5c5c" stroke-width="3.4" stroke-linecap="round"/><circle cx="89.4" cy="51" r="2" fill="#ff5c5c"/></g>` : `<g class="nl-twinkle"><path d="M80 62 L82 76" stroke="#ff5c5c" stroke-width="4" stroke-linecap="round"/><circle cx="82.6" cy="82" r="2.3" fill="#ff5c5c"/></g>`;
    case "steam": return near ? "" : [[16, 0], [84, -0.7]].map(([x, d]) => `<path class="nl-rise" style="animation-delay:${d}s" d="M${x} 70 q-3 -4 0 -8 t0 -8" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" opacity=".85"/>`).join("");
    case "confetti": return near ? "" : ["#ff5c8a", "#ffd36b", "#5fd3b0", "#7cc4ff", "#b38cff", "#ff9a5c"].map((col, i) => `<rect class="nl-confetti" x="${16 + i * 13}" y="${58 + (i % 2) * 6}" width="3.4" height="6" rx="1" fill="${col}" style="animation-delay:${-i * 0.35}s"/>`).join("");
    case "flames": return near ? [[12, 0], [88, -0.35]].map(([x, d]) => `<path class="nl-flame" style="animation-delay:${d}s" d="M${x} 50 C${x - 6} 44 ${x - 3} 34 ${x} 26 C${x + 1} 34 ${x + 6} 38 ${x + 4} 44 C${x + 3} 48 ${x + 2} 50 ${x} 50 Z" fill="#ff8a3d"/>`).join("") : [[14, 0], [86, -0.35]].map(([x, d]) => `<path class="nl-flame" style="animation-delay:${d}s" d="M${x} 64 C${x - 7} 56 ${x - 4} 46 ${x} 38 C${x + 1} 46 ${x + 7} 50 ${x + 5} 58 C${x + 4} 62 ${x + 2} 64 ${x} 64 Z" fill="#ff8a3d"/>`).join("");
  }
  return "";
}

function accessory(kind: AvatarAccessory, acc: string, u: string): string {
  switch (kind) {
    case "headphones": return `<path d="M13.5 12 V2 M86.5 12 V2" stroke="${acc}" stroke-width="2.2" stroke-linecap="round" opacity=".8"/><path d="${rr(9, 14, 9, 20, 4.5)}" fill="url(#${u}v)"/><path d="${rr(82, 14, 9, 20, 4.5)}" fill="url(#${u}v)"/>`;
    case "halo": return `<ellipse cx="50" cy="60" rx="30" ry="4.4" fill="none" stroke="${acc}" stroke-width="2" opacity=".9"/>`;
    case "sparkle": return `<path class="nl-twinkle" d="${star4(87, 50, 4.4)}" fill="#ffe27a"/><path class="nl-twinkle" style="animation-delay:-1s" d="${star4(12, 52, 3)}" fill="#fff"/>`;
  }
  return "";
}

export interface NotchlingOptions {
  mood?: NotchlingMood;
  avatar?: AvatarSettings;
  /** "icon" = on the pastel app-icon plate; "bare" = just the character (for the black notch) */
  variant?: "icon" | "bare";
  /** a unique id prefix for gradients/filters */
  uid: string;
  /** the user's accent hex, used when the eye glow is "accent" */
  accent?: string;
}

/** viewBox for each variant */
export const VIEWBOX = { icon: "0 0 100 100", bare: "13 -1 74 60" } as const;

/** Inner SVG markup (no <svg> wrapper). */
export function notchlingMarkup({ mood = "happy", avatar = DEFAULT_AVATAR, variant = "icon", uid: u, accent }: NotchlingOptions): string {
  const a = normalizeAvatar(avatar);
  const s = SPEC[mood];
  const bare = variant === "bare";
  const hex = /^#[0-9a-f]{6}$/i.test(accent ?? "") ? (accent as string) : "#3dbbff";
  const g = a.glow === "accent" ? ["#ffffff", hex, hex] : GLOWS[a.glow].stops;
  const acc = g[1];
  const eyeFill = `url(#${u}e)`;
  const eyeKind = s.eyes === "user" ? a.eyes : s.eyes === "listen" ? (a.eyes === "pill" ? "round" : a.eyes) : s.eyes;
  const mouthKind = s.mouth === "user" ? a.mouth : s.mouth;
  const blush = a.blush && s.blush !== false && (s.blush || mood === "happy");
  const d = notchD(18, 64, 56, 25);

  const defs = `<defs>
    <linearGradient id="${u}e" gradientUnits="userSpaceOnUse" x1="0" y1="18" x2="0" y2="34"><stop offset="0" stop-color="${g[0]}"/><stop offset=".5" stop-color="${g[1]}"/><stop offset="1" stop-color="${g[2]}"/></linearGradient>
    <linearGradient id="${u}v" gradientUnits="userSpaceOnUse" x1="28" y1="0" x2="72" y2="0"><stop offset="0" stop-color="${g[1]}"/><stop offset="1" stop-color="${g[2]}"/></linearGradient>
    <linearGradient id="${u}b" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="56"><stop offset="0" stop-color="#1c2033"/><stop offset="1" stop-color="#0b0d16"/></linearGradient>
    <linearGradient id="${u}r" gradientUnits="userSpaceOnUse" x1="18" y1="0" x2="82" y2="56"><stop offset="0" stop-color="${g[1]}"/><stop offset="1" stop-color="${g[2]}"/></linearGradient>
    <linearGradient id="${u}p" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="100"><stop offset="0" stop-color="#a9dcff"/><stop offset=".5" stop-color="#c7b6ff"/><stop offset="1" stop-color="#ffc2d6"/></linearGradient>
    <linearGradient id="${u}gl" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <filter id="${u}g" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="1.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="${u}s" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2"/></filter>
    <filter id="${u}k" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="8"/></filter>
    <filter id="${u}gray"><feColorMatrix type="saturate" values=".3"/></filter>
    <clipPath id="${u}c"><rect width="100" height="100" rx="23"/></clipPath>
  </defs>`;

  const tint =
    s.tint === "fire" ? `<ellipse cx="50" cy="${bare ? 40 : 60}" rx="34" ry="20" fill="#ff7a2f" opacity="${bare ? 0.35 : 0.55}" filter="url(#${u}k)"/>` :
    s.tint === "red" ? `<ellipse cx="50" cy="40" rx="34" ry="22" fill="#ff3b3b" opacity=".35" filter="url(#${u}k)"/>` : "";
  // body: on the icon plate a soft dark notch; in the (already black) notch, a lit rim makes it read
  const body = bare
    ? `<path d="${d}" fill="url(#${u}b)"/><path d="${d}" fill="none" stroke="url(#${u}r)" stroke-width="1.6" opacity=".9"/>`
    : `<ellipse cx="50" cy="60" rx="30" ry="6" fill="#4b3a8c" opacity=".18" filter="url(#${u}s)"/><path d="${d}" fill="url(#${u}b)"/>`;
  const blushSvg = blush ? `<circle cx="30.5" cy="41" r="3.3" fill="#ff8fb8" opacity=".6" filter="url(#${u}s)"/><circle cx="69.5" cy="41" r="3.3" fill="#ff8fb8" opacity=".6" filter="url(#${u}s)"/>` : "";
  const face = `<g filter="url(#${u}g)">${eyes(eyeKind, eyeFill, u)}</g>${blushSvg}${mouth(mouthKind, acc)}${faceExtra(s.extra)}`;
  const character = `<g class="${s.move ?? ""}">${body}${face}</g>${accessory(a.accessory, acc, u)}${sceneExtra(s.extra, acc, bare)}`;
  const gray = s.tint === "gray" ? ` filter="url(#${u}gray)"` : "";

  if (bare) return `${defs}<g${gray}>${tint}${character}</g>`;
  const plate = `<rect width="100" height="100" fill="url(#${u}p)"/>${s.tint === "red" ? `<rect width="100" height="100" fill="#ff3b3b" opacity=".16"/>` : ""}`;
  return `${defs}<g clip-path="url(#${u}c)"><g${gray}>${plate}${tint}${character}</g><rect width="100" height="100" fill="url(#${u}gl)" opacity=".7"/></g><rect x=".5" y=".5" width="99" height="99" rx="22.5" fill="none" stroke="#ffffff" stroke-opacity=".3"/>`;
}

/** Which mood the notch should show for a given live state. */
export function moodForState(opts: { phase: string; mode?: string; hour?: number }): NotchlingMood {
  const { phase, mode, hour = new Date().getHours() } = opts;
  if (phase === "listening") return "listen";
  if (phase === "transcribing") return "talk";
  if (phase === "thinking") return "think";
  if (phase === "done") return mode === "meeting" ? "proud" : "happy";
  if (phase === "error") return "worried";
  if (hour >= 0 && hour < 5) return "sleepy";
  return "happy";
}
