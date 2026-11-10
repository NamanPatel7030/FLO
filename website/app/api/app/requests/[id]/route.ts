import { desktopCaller, finishRequest, unauthorized } from "@/lib/mobile";
import { notifyAnswer } from "@/lib/phone-answer";
import { cleanAnswer } from "@/lib/phone-ask";

export const runtime = "nodejs";

/**
 * Desktop: {ok, answer} finishes a phone request. The answer is stored on the request, added to the
 * phone inbox and pushed to the phones right away (the user is waiting on the phone, so presence
 * doesn't matter here).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const c = await desktopCaller(req);
  if (!c) return unauthorized();
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Not found." }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { ok?: unknown; answer?: unknown };
  const ok = b.ok !== false;
  // line breaks kept: a drafted email or list must arrive as written
  const answer = cleanAnswer(b.answer, 4000) ?? (ok ? "Done." : "Flo couldn't do that.");
  const r = await finishRequest(c.user.id, id, ok, answer);
  if (!r) return Response.json({ error: "Not found." }, { status: 404 });
  await notifyAnswer(c.user.id, r, ok, answer);
  return Response.json({ request: r });
}
