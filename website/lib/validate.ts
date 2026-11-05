/** Shared input validation (client + server). */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(e: unknown): string | null {
  if (typeof e !== "string" || !EMAIL_RE.test(e.trim()) || e.length > 254) return "Enter a valid email address.";
  return null;
}

export function validatePassword(p: unknown): string | null {
  if (typeof p !== "string" || p.length < 8) return "Use at least 8 characters.";
  if (p.length > 200) return "That password is too long.";
  return null;
}

export function validateName(n: unknown): string | null {
  if (typeof n !== "string" || !n.trim()) return "Tell us your name.";
  if (n.length > 80) return "That name is too long.";
  return null;
}

/** Only allow same-site relative redirects (no open redirects). */
export function safeNext(next: unknown, fallback = "/download"): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
}
