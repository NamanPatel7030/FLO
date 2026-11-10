import { googleConfig, refreshAccessToken } from "@/lib/google";
import { parseRefreshBody } from "@/lib/google-logic";
import { desktopCaller } from "@/lib/mobile";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" };
const fail = (status: number, error: string, message: string) => Response.json({ error, message }, { status, headers: NO_STORE });

/**
 * Desktop app (signed in to Flo): {refresh_token} → {access_token, expires_in, scope?}. Google needs the
 * client secret to refresh, and only this server has it. The refresh token is used for this one call and
 * is never stored or logged.
 */
export async function POST(req: Request) {
  if (!rateLimit(`google-refresh-ip:${clientIp(req)}`, 120, 60 * 60_000)) return fail(429, "rate_limited", "Too many requests. Try again later.");
  const c = await desktopCaller(req);
  if (!c) return fail(401, "unauthorized", "Sign in to Flo to keep Google connected.");
  if (!rateLimit(`google-refresh:${c.user.id}`, 60, 60 * 60_000)) return fail(429, "rate_limited", "Too many requests. Try again later.");
  const body = parseRefreshBody(await req.json().catch(() => null));
  if ("error" in body) return fail(400, "bad_request", body.error);
  const cfg = googleConfig();
  if (!cfg) return fail(503, "setup", "Google isn't set up on this Flo server yet.");
  const r = await refreshAccessToken(cfg, body.refreshToken);
  if (!r.ok) {
    if (r.error === "invalid_grant") return fail(400, "invalid_grant", "Google access was revoked. Reconnect Google in Flo.");
    return fail(502, "google", "Google didn't answer. Try again in a minute.");
  }
  const out: { access_token: string; expires_in: number; scope?: string } = { access_token: r.accessToken, expires_in: r.expiresIn };
  if (r.scope) out.scope = r.scope;
  return Response.json(out, { headers: NO_STORE });
}
