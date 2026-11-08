import { consumeSlackState, createSlackHandoff } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { exchangeCode, HANDOFF_TTL_MS, randomCode, seal, siteBase, slackConfig, STATE_COOKIE } from "@/lib/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cookieState(req: Request): string {
  const m = new RegExp(`(?:^|;\\s*)${STATE_COOKIE}=([^;]+)`).exec(req.headers.get("cookie") ?? "");
  return m ? m[1] : "";
}

/** Slack → here. Check state (single use + same browser), swap the code for a user token, seal it, hand off to Flo. */
export async function GET(req: Request) {
  const base = siteBase(req);
  const secure = base.startsWith("https://") ? "; Secure" : "";
  const done = (q: string) =>
    new Response(null, {
      status: 302,
      headers: {
        location: `${base}/slack/connected?${q}`,
        "cache-control": "no-store",
        "set-cookie": `${STATE_COOKIE}=; Path=/api/slack; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
      },
    });
  if (!rateLimit(`slack-callback:${clientIp(req)}`, 30)) return done("error=rate");

  const q = new URL(req.url).searchParams;
  const state = q.get("state") ?? "";
  if (!state || state.length > 100 || cookieState(req) !== state) return done("error=state");
  const st = await consumeSlackState(state); // burns the state whatever happens next
  if (!st) return done("error=expired");
  if (q.get("error")) return done(q.get("error") === "access_denied" ? "error=denied" : "error=slack");
  const code = q.get("code") ?? "";
  if (!code || code.length > 500) return done("error=slack");

  const cfg = slackConfig();
  if (!cfg || !process.env.AUTH_SECRET) return done("error=setup");
  const r = await exchangeCode(req, cfg, code);
  if (!r.ok) return done("error=slack");

  const handoff = randomCode();
  await createSlackHandoff({
    code: handoff,
    sealed: seal(r.token, handoff),
    challenge: st.challenge,
    userId: st.userId,
    team: r.team,
    slackUser: r.slackUser,
    ttlMs: HANDOFF_TTL_MS,
  });
  const team = r.team ? `&team=${encodeURIComponent(r.team)}` : "";
  return done(`code=${encodeURIComponent(handoff)}${team}`);
}
