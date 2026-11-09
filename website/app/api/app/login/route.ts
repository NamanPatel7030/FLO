import { authMessage, classifyAuthError } from "@/lib/auth-messages";
import { dbConfigured, findUserById } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { statelessClient, toFloUser } from "@/lib/supabase/server";
import { issueAppToken } from "@/lib/tokens";
import { validateEmail } from "@/lib/validate";

export const runtime = "nodejs";

const WRONG = "Wrong email or password.";

/**
 * Desktop app sign-in: {email, password} → {token, user}. The password is checked by Supabase Auth
 * (server to server, no cookies); the app then gets Flo's own app token (lib/tokens.ts) for the Supabase user id.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!rateLimit(`app-login:${clientIp(req)}:${email}`, 10)) {
    return Response.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }
  if (validateEmail(email) || typeof body.password !== "string" || !body.password || body.password.length > 200) {
    return Response.json({ error: WRONG }, { status: 401 });
  }
  const supabase = statelessClient();
  if (!supabase || !process.env.AUTH_SECRET) {
    return Response.json({ error: "Flo accounts aren't set up on this server yet." }, { status: 503 });
  }

  let data, error;
  try {
    ({ data, error } = await supabase.auth.signInWithPassword({ email, password: body.password }));
  } catch {
    return Response.json({ error: "Can't reach the account service right now. Try again." }, { status: 503 });
  }
  if (error || !data.user) {
    const p = classifyAuthError(error);
    // Supabase unreachable / erroring: not the user's fault, so don't say "wrong password"
    if (p === "network" || error?.name === "AuthRetryableFetchError" || (error?.status ?? 0) >= 500) {
      return Response.json({ error: "Can't reach the account service right now. Try again." }, { status: 503 });
    }
    if (p === "email_not_confirmed") {
      return Response.json({ error: "Confirm your email first: open the link we sent you, then sign in again." }, { status: 401 });
    }
    if (p === "rate_limited") return Response.json({ error: authMessage(p) }, { status: 429 });
    return Response.json({ error: WRONG }, { status: 401 });
  }

  // the app keeps its own token; this short-lived Supabase session isn't needed past this point
  const authUser = data.user;
  void supabase.auth.signOut({ scope: "local" }).catch(() => {});

  const user = (dbConfigured() ? await findUserById(authUser.id).catch(() => null) : null) ?? toFloUser(authUser);
  return Response.json({ token: await issueAppToken(user), user });
}
