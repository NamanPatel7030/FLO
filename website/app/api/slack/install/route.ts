import { slackStateLive } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { authorizeUrl, siteBase, slackConfig, STATE_COOKIE, STATE_TTL_MS } from "@/lib/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const go = (url: string, extra?: Record<string, string>) =>
  new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store", ...extra } });

/** Browser (opened by Flo): validate the one-time state, pin it to this browser, send the user to Slack. */
export async function GET(req: Request) {
  const base = siteBase(req);
  if (!rateLimit(`slack-install:${clientIp(req)}`, 30)) return go(`${base}/slack/connected?error=rate`);
  const cfg = slackConfig();
  if (!cfg || !process.env.AUTH_SECRET) return go(`${base}/slack/setup`);
  const state = new URL(req.url).searchParams.get("state") ?? "";
  if (!state || state.length > 100 || !(await slackStateLive(state))) return go(`${base}/slack/connected?error=expired`);
  // CSRF: the callback must land in the same browser that started here
  const secure = base.startsWith("https://") ? "; Secure" : "";
  const cookie = `${STATE_COOKIE}=${state}; Path=/api/slack; HttpOnly; SameSite=Lax; Max-Age=${STATE_TTL_MS / 1000}${secure}`;
  return go(authorizeUrl(req, cfg.clientId, state), { "set-cookie": cookie });
}
