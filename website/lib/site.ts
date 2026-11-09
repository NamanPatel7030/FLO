/** Public site URL from SITE_URL (no trailing slash), or "" to let the browser use its own origin. */
export function siteUrl(): string {
  return (process.env.SITE_URL ?? "").trim().replace(/\/+$/, "");
}

/** Messages for `?error=` codes that /auth/callback sends people back with. */
export function authNotice(code: unknown): string | null {
  switch (code) {
    case "link":
      return "That link is invalid or has expired. If you just confirmed your email, sign in below; otherwise ask for a new link.";
    case "google":
      return "Google sign-in didn't finish. Try again, or use your email below.";
    case "provider":
      return "Google sign-in isn't turned on for Flo yet. Use your email below for now.";
    case "config":
      return "Sign-in isn't set up on this server yet. Try again later.";
    default:
      return null;
  }
}
