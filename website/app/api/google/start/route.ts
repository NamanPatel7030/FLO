import { createGoogleState } from "@/lib/db";
import { STATE_TTL_MS } from "@/lib/google";
import { parseScopeKeys, storeScopeKeys } from "@/lib/google-logic";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { isChallenge, randomCode, siteBase } from "@/lib/slack";
import { bearer, verifyAppToken } from "@/lib/tokens";

export const runtime = "nodejs";

/**
 * Desktop app: begin Connect Google. {challenge: base64url(sha256(verifier)), scopes: ["calendar" | "gmail", ...]}
 * → {url} to open in the browser. When the app is signed in to a Flo account (Bearer), the flow is bound to it too.
 */
export async function POST(req: Request) {
  if (!rateLimit(`google-start:${clientIp(req)}`, 20)) return Response.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { challenge?: unknown; scopes?: unknown };
  if (!isChallenge(body.challenge)) return Response.json({ error: "Missing challenge." }, { status: 400 });
  const keys = parseScopeKeys(body.scopes);
  if (!keys) return Response.json({ error: "scopes must list calendar and/or gmail." }, { status: 400 });
  const t = bearer(req);
  const claims = t ? await verifyAppToken(t).catch(() => null) : null;
  const state = randomCode();
  await createGoogleState(state, body.challenge, storeScopeKeys(keys), claims?.sub ?? null, STATE_TTL_MS);
  return Response.json({ url: `${siteBase(req)}/api/google/install?state=${encodeURIComponent(state)}`, expiresIn: STATE_TTL_MS / 1000 });
}
