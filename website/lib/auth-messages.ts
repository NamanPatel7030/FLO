/**
 * Supabase Auth errors → friendly copy (shared by the browser forms and /api/app/login).
 * Pure: no imports, unit-tested in tests/auth-messages.test.mjs.
 */
export type AuthErrorLike = { code?: string | null; message?: string | null; status?: number | null } | null | undefined;

export type AuthProblem =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "user_already_exists"
  | "weak_password"
  | "same_password"
  | "rate_limited"
  | "provider_disabled"
  | "signup_disabled"
  | "session_missing"
  | "network"
  | "unknown";

/** Classify by error code first (supabase-js ≥2.6x), then by message for older servers. */
export function classifyAuthError(e: AuthErrorLike): AuthProblem {
  if (!e) return "unknown";
  const code = (e.code ?? "").toLowerCase();
  const msg = (e.message ?? "").toLowerCase();
  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) return "invalid_credentials";
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) return "email_not_confirmed";
  if (code === "user_already_exists" || code === "email_exists" || msg.includes("already registered")) return "user_already_exists";
  if (code === "weak_password" || msg.includes("password should")) return "weak_password";
  if (code === "same_password" || msg.includes("different from the old password")) return "same_password";
  if (code.startsWith("over_") || e.status === 429 || msg.includes("rate limit")) return "rate_limited";
  if (code === "provider_disabled" || msg.includes("provider is not enabled") || msg.includes("unsupported provider")) return "provider_disabled";
  if (code === "signup_disabled" || msg.includes("signups not allowed")) return "signup_disabled";
  if (code === "session_not_found" || code === "session_expired" || msg.includes("auth session missing")) return "session_missing";
  if (msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("fetch failed")) return "network";
  return "unknown";
}

export function authMessage(p: AuthProblem, ctx: "login" | "signup" | "reset" | "forgot" | "google" = "login"): string {
  switch (p) {
    case "invalid_credentials":
      return "That email and password don't match. Check for typos, or use Continue with Google if that's how you joined.";
    case "email_not_confirmed":
      return "Confirm your email first. We sent you a link when you signed up.";
    case "user_already_exists":
      return "You already have a Flo account with this email.";
    case "weak_password":
      return "That password is too easy to guess. Use at least 8 characters, ideally a short phrase.";
    case "same_password":
      return "Choose a password different from your old one.";
    case "rate_limited":
      return ctx === "signup" || ctx === "forgot"
        ? "We've sent a few emails already. Wait a minute, then try again."
        : "Too many attempts. Wait a minute, then try again.";
    case "provider_disabled":
      return "Google sign-in isn't turned on for Flo yet. Use your email below for now.";
    case "signup_disabled":
      return "New accounts are paused right now. Try again later.";
    case "session_missing":
      return "This link has expired. Ask for a new one.";
    case "network":
      return "Can't reach Flo right now. Check your connection and try again.";
    default:
      return ctx === "signup"
        ? "We couldn't create your account just now. Please try again."
        : ctx === "reset"
          ? "We couldn't update your password. Please try again."
          : ctx === "forgot"
            ? "We couldn't send the email just now. Please try again."
            : ctx === "google"
              ? "We couldn't start Google sign-in. Please try again."
              : "We couldn't sign you in just now. Please try again.";
  }
}

/**
 * Supabase hides whether an email is registered when confirmations are on: signUp "succeeds" but the
 * returned user has no identities. That means the account already exists.
 */
export function isExistingAccountSignup(user: { identities?: unknown[] | null } | null | undefined): boolean {
  return !!user && Array.isArray(user.identities) && user.identities.length === 0;
}
