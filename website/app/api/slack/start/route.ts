import { createSlackState } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { isChallenge, randomCode, siteBase, STATE_TTL_MS } from "@/lib/slack";
import { bearer, verifyAppToken } from "@/lib/tokens";

export const runtime = "nodejs";

/**
 * Desktop app: begin Connect Slack. {challenge: base64url(sha256(verifier))} → {url} to open in the browser.
 * When the app is signed in to a Flo account (Bearer), the flow is bound to that account too.
 */
export async function POST(req: Request) {
  if (!rateLimit(`slack-start:${clientIp(req)}`, 20)) return Response.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { challenge?: unknown };
  if (!isChallenge(body.challenge)) return Response.json({ error: "Missing challenge." }, { status: 400 });
  const t = bearer(req);
  const claims = t ? await verifyAppToken(t).catch(() => null) : null;
  const state = randomCode();
  await createSlackState(state, body.challenge, claims?.sub ?? null, STATE_TTL_MS);
  return Response.json({ url: `${siteBase(req)}/api/slack/install?state=${encodeURIComponent(state)}`, expiresIn: STATE_TTL_MS / 1000 });
}
