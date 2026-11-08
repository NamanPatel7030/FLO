// Naman's 52 avatar designs (ocean + playful). Every screen shows its own design, so the maker's
// face is never the same twice; clicking a portrait cycles through all of them.
const files = import.meta.glob("../assets/naman/*.webp", { eager: true, import: "default" }) as Record<string, string>;

export interface Avatar {
  slug: string;
  url: string;
}

export const AVATARS: Avatar[] = Object.keys(files)
  .sort()
  .map((k) => ({ slug: k.split("/").pop()!.replace(/\.webp$/, ""), url: files[k] }));

/** The design each screen opens with (all different). */
export const SCREEN_AVATAR: Record<string, string> = {
  sidebar: "ocean-04-big-curl-wave",
  about: "playful-09-hi-bubble",
  signin: "ocean-27-octopus-hi",
  onboarding: "playful-05-sunburst",
  settings: "ocean-14-paper-boat",
};

/** Index into AVATARS for a screen (falls back to a stable pick from the screen name). */
export function avatarIndex(screen: string): number {
  const slug = SCREEN_AVATAR[screen];
  const i = slug ? AVATARS.findIndex((a) => a.slug === slug) : -1;
  if (i >= 0) return i;
  let h = 0;
  for (const c of screen) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATARS.length ? h % AVATARS.length : 0;
}

/** "ocean-08-whale-tail" → "Whale tail" */
export function avatarName(slug: string): string {
  const s = slug.replace(/^(ocean|playful)-\d+-/, "").replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
