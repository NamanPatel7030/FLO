import { googleStateLive } from "@/lib/db";
import { authorizeUrl, googleConfig, STATE_COOKIE, STATE_TTL_MS } from "@/lib/google";
import { loadScopeKeys } from "@/lib/google-logic";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { siteBase } from "@/lib/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const go = (url: string, extra?: Record<string, string>) =>
  new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store", ...extra } });

/** Browser (opened by Flo): validate the one-time state, pin it to this browser, send the user to Google. */
export async function GET(req: Request) {
  const base = siteBase(req);
  if (!rateLimit(`google-install:${clientIp(req)}`, 30)) return go(`${base}/google/connected?error=rate`);
  const cfg = googleConfig();
  if (!cfg || !process.env.AUTH_SECRET) return go(`${base}/google/setup`);
  const state = new URL(req.url).searchParams.get("state") ?? "";
  const live = state && state.length <= 100 ? await googleStateLive(state) : null;
  const keys = live ? loadScopeKeys(live.scopes) : [];
  if (!keys.length) return go(`${base}/google/connected?error=expired`);
  // CSRF: the callback must land in the same browser that started here
  const secure = base.startsWith("https://") ? "; Secure" : "";
  const cookie = `${STATE_COOKIE}=${state}; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=${STATE_TTL_MS / 1000}${secure}`;
  return go(authorizeUrl(req, cfg.clientId, state, keys), { "set-cookie": cookie });
}
