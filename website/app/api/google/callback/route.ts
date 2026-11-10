import { consumeGoogleState, createGoogleHandoff } from "@/lib/db";
import { exchangeCode, googleConfig, HANDOFF_TTL_MS, revokeToken, seal, STATE_COOKIE } from "@/lib/google";
import { grantedKeys, type SealedGoogle } from "@/lib/google-logic";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { randomCode, siteBase } from "@/lib/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cookieState(req: Request): string {
  const m = new RegExp(`(?:^|;\\s*)${STATE_COOKIE}=([^;]+)`).exec(req.headers.get("cookie") ?? "");
  return m ? m[1] : "";
}

/** Google → here. Check state (single use + same browser), swap the code for tokens, seal them, hand off to Flo. */
export async function GET(req: Request) {
  const base = siteBase(req);
  const secure = base.startsWith("https://") ? "; Secure" : "";
  const done = (q: string) =>
    new Response(null, {
      status: 302,
      headers: {
        location: `${base}/google/connected?${q}`,
        "cache-control": "no-store",
        "set-cookie": `${STATE_COOKIE}=; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
      },
    });
  if (!rateLimit(`google-callback:${clientIp(req)}`, 30)) return done("error=rate");

  const q = new URL(req.url).searchParams;
  const state = q.get("state") ?? "";
  if (!state || state.length > 100 || cookieState(req) !== state) return done("error=state");
  const st = await consumeGoogleState(state); // burns the state whatever happens next
  if (!st) return done("error=expired");
  if (q.get("error")) return done(q.get("error") === "access_denied" ? "error=denied" : "error=google");
  const code = q.get("code") ?? "";
  if (!code || code.length > 1000) return done("error=google");

  const cfg = googleConfig();
  if (!cfg || !process.env.AUTH_SECRET) return done("error=setup");
  const r = await exchangeCode(req, cfg, code);
  if (!r.ok) return done("error=google");
  // Google lets people untick boxes: with neither Calendar nor Gmail granted there's nothing to hand over
  if (!grantedKeys(r.tokens.scope).length) {
    await revokeToken(r.tokens.refreshToken);
    return done("error=scopes");
  }

  const handoff = randomCode();
  const payload: SealedGoogle = {
    refresh_token: r.tokens.refreshToken,
    access_token: r.tokens.accessToken,
    expires_in: r.tokens.expiresIn,
    scope: r.tokens.scope,
    email: r.tokens.email,
    obtained_at: Date.now(),
  };
  await createGoogleHandoff({
    code: handoff,
    sealed: seal(JSON.stringify(payload), handoff),
    challenge: st.challenge,
    userId: st.userId,
    email: r.tokens.email,
    ttlMs: HANDOFF_TTL_MS,
  });
  const email = r.tokens.email ? `&email=${encodeURIComponent(r.tokens.email)}` : "";
  return done(`code=${encodeURIComponent(handoff)}${email}`);
}
