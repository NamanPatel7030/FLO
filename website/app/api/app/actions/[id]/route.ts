import { cleanText, desktopCaller, finishAction, unauthorized } from "@/lib/mobile";

export const runtime = "nodejs";

/** Desktop: {ok, message?} finishes a phone action (taken through GET /api/app/requests?actions=1). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const c = await desktopCaller(req);
  if (!c) return unauthorized();
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Not found." }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { ok?: unknown; message?: unknown };
  const action = await finishAction(c.user.id, id, b.ok !== false, cleanText(b.message, 300));
  if (!action) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ action });
}
