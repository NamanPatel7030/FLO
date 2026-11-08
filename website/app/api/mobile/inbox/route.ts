import { inbox, mobileCaller, unauthorized } from "@/lib/mobile";

export const runtime = "nodejs";

/** Phone: notifications newer than `after` (oldest first, at most 100) → [{id, kind, title, body, data, createdAt}]. */
export async function GET(req: Request) {
  const c = await mobileCaller(req);
  if (!c) return unauthorized();
  const after = Number(new URL(req.url).searchParams.get("after") ?? 0);
  return Response.json(await inbox(c.user.id, Number.isFinite(after) && after > 0 ? Math.floor(after) : 0));
}
