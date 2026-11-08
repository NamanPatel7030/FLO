import { claimSlackHandoff } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { challengeOf, isVerifier, unseal } from "@/lib/slack";
import { bearer, verifyAppToken } from "@/lib/tokens";

export const runtime = "nodejs";

const nope = () => Response.json({ error: "That Slack link is invalid, used or expired. Click Connect Slack in Flo again." }, { status: 401 });

/**
 * Desktop app: {code, verifier} (+ Bearer when signed in) → {token, team, slackUser}. Works once; the row
 * is deleted. The token is never logged and never kept here.
 */
export async function POST(req: Request) {
  if (!rateLimit(`slack-claim:${clientIp(req)}`, 30)) return Response.json({ error: "Too many attempts." }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { code?: unknown; verifier?: unknown };
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code || code.length > 100 || !isVerifier(body.verifier)) return Response.json({ error: "Missing code." }, { status: 400 });
  const t = bearer(req);
  const claims = t ? await verifyAppToken(t).catch(() => null) : null;
  const row = await claimSlackHandoff(code, challengeOf(body.verifier), claims?.sub ?? null);
  if (!row) return nope();
  const token = unseal(row.sealed, code);
  if (!token) return nope();
  return Response.json({ token, team: row.team, slackUser: row.slackUser }, { headers: { "cache-control": "no-store" } });
}
