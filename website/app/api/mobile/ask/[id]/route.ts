import { getRequest, mobileCaller, unauthorized } from "@/lib/mobile";

export const runtime = "nodejs";

/** Phone: the status (pending | taken | done | failed) and answer of one of its requests. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const c = await mobileCaller(req);
  if (!c) return unauthorized();
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Not found." }, { status: 404 });
  const request = await getRequest(c.user.id, id);
  if (!request) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ request }, { headers: { "Cache-Control": "no-store" } });
}
