import { findUserById } from "@/lib/db";
import { bearer, verifyAppToken } from "@/lib/tokens";

export const runtime = "nodejs";

/** Desktop app: who am I? `Authorization: Bearer <token>` → {user}. */
export async function GET(req: Request) {
  const t = bearer(req);
  const claims = t ? await verifyAppToken(t) : null;
  const user = claims ? await findUserById(claims.sub) : null;
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  return Response.json({ user });
}
