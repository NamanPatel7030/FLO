// Naman's 52 avatar designs (served from /public/naman). Every page shows its own design; the
// maker card cycles through all of them on click.
export const AVATARS = [
  "ocean-01-swimming", "ocean-02-underwater-rays", "ocean-03-japanese-waves", "ocean-04-big-curl-wave",
  "ocean-05-tropical-beach", "ocean-06-fishy-friends", "ocean-07-starfish-shore", "ocean-08-whale-tail",
  "ocean-09-life-ring", "ocean-10-porthole", "ocean-11-caustics", "ocean-12-sunset-sea",
  "ocean-13-nautical-stripes", "ocean-14-paper-boat", "ocean-15-anchor-navy", "ocean-16-jellyfish",
  "ocean-17-coral-reef", "ocean-18-wave-ring", "ocean-19-splash", "ocean-20-seagulls",
  "ocean-21-moonlit-sea", "ocean-22-ocean-circle", "ocean-23-bubble-frame", "ocean-24-wave-pattern",
  "ocean-25-turquoise-foam", "ocean-26-surf-sun", "ocean-27-octopus-hi", "ocean-28-deep-blue-bubbles",
  "playful-01-sunny-sparkles", "playful-02-confetti-pink", "playful-03-sky-squiggles", "playful-04-bubblegum-blobs",
  "playful-05-sunburst", "playful-06-rainbow-arc", "playful-07-cute-clouds", "playful-08-mint-polka",
  "playful-09-hi-bubble", "playful-10-candy-sparkle", "playful-11-shine-lines", "playful-12-retro-rainbow",
  "playful-13-daisies", "playful-14-sticker-icons", "playful-15-star-badge", "playful-16-pastel-waves",
  "playful-17-soap-bubbles", "playful-18-lime-pink-blob", "playful-19-squiggle-ring", "playful-20-paper-plane",
  "playful-21-pink-circle-pop", "playful-22-fruit-split", "playful-23-smiley-doodles", "playful-24-orange-swirls",
] as const;

/** The design each page opens with — all different. */
export const PAGE_AVATAR: Record<string, string> = {
  "/": "ocean-26-surf-sun",
  "/login": "ocean-27-octopus-hi",
  "/signup": "playful-09-hi-bubble",
  "/download": "ocean-14-paper-boat",
  "/privacy": "ocean-10-porthole",
  "/terms": "ocean-15-anchor-navy",
  "/slack/setup": "playful-14-sticker-icons",
  "/slack/connected": "playful-06-rainbow-arc",
  maker: "playful-05-sunburst",
};

export const avatarUrl = (slug: string) => `/naman/${slug}.webp`;

export function avatarIndexFor(key: string): number {
  const slug = PAGE_AVATAR[key];
  const i = slug ? (AVATARS as readonly string[]).indexOf(slug) : -1;
  if (i >= 0) return i;
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % AVATARS.length;
}

/** "ocean-08-whale-tail" → "Whale tail" */
export function avatarName(slug: string): string {
  const s = slug.replace(/^(ocean|playful)-\d+-/, "").replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
