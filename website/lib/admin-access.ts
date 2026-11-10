// Who may open /admin. Pure, no imports, so node --test runs it directly (tests/admin-logic.test.mjs).
//
// Access: a signed-in Supabase user whose email is confirmed and listed in ADMIN_EMAILS (comma separated,
// case-insensitive). Everyone else gets a 404, never a 403, so the panel's existence isn't revealed.
// ADMIN_DEMO=1 renders built-in sample data with no sign-in and no database, for local checks only:
// it is ignored on Vercel.

type Env = Record<string, string | undefined>;

export function adminEmails(env: Env): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdmin(email: string | null | undefined, env: Env): boolean {
  const e = (email ?? "").trim().toLowerCase();
  return e.length > 0 && adminEmails(env).has(e);
}

export const demoMode = (env: Env) => env.ADMIN_DEMO === "1" && !env.VERCEL;

export type AdminGate = { status: 200; email: string; demo: boolean } | { status: 404 };

/** The one decision every admin page and /api/admin route makes. */
export function adminGate(user: { email: string | null | undefined; confirmed: boolean } | null, env: Env): AdminGate {
  if (demoMode(env)) return { status: 200, email: "demo@flo.local", demo: true };
  if (!user || !user.confirmed || !isAdmin(user.email, env)) return { status: 404 };
  return { status: 200, email: (user.email ?? "").trim().toLowerCase(), demo: false };
}
