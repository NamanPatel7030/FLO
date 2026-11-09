import "server-only";
import { dbConfigured, isUuid } from "./db";
import { rateLimit } from "./ratelimit";
import { bearer, verifyAppToken } from "./tokens";

/** The desktop app's account token → user id, or a ready error response. Never logs bodies. */
export async function syncUser(req: Request, bucket: string, max: number): Promise<{ userId: string } | { res: Response }> {
  if (!dbConfigured()) return { res: Response.json({ error: "Sync isn't available on this server." }, { status: 503 }) };
  const t = bearer(req);
  const claims = t ? await verifyAppToken(t) : null;
  if (!claims || !isUuid(claims.sub)) return { res: Response.json({ error: "Not signed in." }, { status: 401 }) };
  if (!rateLimit(`sync:${bucket}:${claims.sub}`, max, 60_000)) return { res: Response.json({ error: "Too many sync requests. Try again in a minute." }, { status: 429 }) };
  return { userId: claims.sub };
}

export const failed = (what: string) => {
  // the message only: never the request body (it holds ciphertext)
  return Response.json({ error: `Sync ${what} failed. Try again.` }, { status: 500 });
};
