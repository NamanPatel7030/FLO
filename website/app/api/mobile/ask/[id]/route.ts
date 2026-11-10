import { waitingHint } from "@/lib/desktop-state";
import { getDesktopState, getRequest, mobileCaller, unauthorized } from "@/lib/mobile";

export const runtime = "nodejs";

/** Questions still pending after this long get a `hint` saying why (computer offline, other account…). */
const HINT_AFTER_MS = 10_000;

/** Phone: the status (pending | taken | done | failed) and answer of one of its requests. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const c = await mobileCaller(req);
  if (!c) return unauthorized();
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Not found." }, { status: 404 });
  const request = await getRequest(c.user.id, id);
  if (!request) return Response.json({ error: "Not found." }, { status: 404 });
  let hint: ReturnType<typeof waitingHint> | undefined;
  if (request.status === "pending" && Date.now() - new Date(request.createdAt).getTime() > HINT_AFTER_MS) {
    const pc = await getDesktopState(c.user.id);
    hint = waitingHint(c.user.email, pc?.updatedAt ?? null);
  }
  return Response.json(hint ? { request, hint } : { request }, { headers: { "Cache-Control": "no-store" } });
}
