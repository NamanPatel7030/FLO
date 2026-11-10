import { claimGoogleHandoff } from "@/lib/db";
import { unseal } from "@/lib/google";
import { claimResponse } from "@/lib/google-logic";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { challengeOf, isVerifier } from "@/lib/slack";
import { bearer, verifyAppToken } from "@/lib/tokens";

export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" };
const nope = () => Response.json({ error: "That Google link is invalid, used or expired. Click Connect Google in Flo again." }, { status: 401, headers: NO_STORE });

/**
 * Desktop app: {code, verifier} (+ Bearer when signed in) → {refreshToken, accessToken, expiresIn, scope, email}.
 * Works once; the row is deleted. Tokens are never logged and never kept here.
 */
export async function POST(req: Request) {
  if (!rateLimit(`google-claim:${clientIp(req)}`, 30)) return Response.json({ error: "Too many attempts." }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { code?: unknown; verifier?: unknown };
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code || code.length > 100 || !isVerifier(body.verifier)) return Response.json({ error: "Missing code." }, { status: 400 });
  const t = bearer(req);
  const claims = t ? await verifyAppToken(t).catch(() => null) : null;
  const row = await claimGoogleHandoff(code, challengeOf(body.verifier), claims?.sub ?? null);
  if (!row) return nope();
  const plain = unseal(row.sealed, code);
  const out = plain ? claimResponse(plain, Date.now()) : null;
  if (!out) return nope();
  return Response.json({ ...out, email: out.email || row.email }, { headers: NO_STORE });
}
