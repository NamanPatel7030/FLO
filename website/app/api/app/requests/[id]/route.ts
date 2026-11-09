import { cleanText, desktopCaller, dropPushToken, finishRequest, pushTargets, storeNotification, unauthorized } from "@/lib/mobile";
import { pushConfigured, sendPush } from "@/lib/push";

export const runtime = "nodejs";

const TITLE = { ask: "Flo answered", todo: "Added to your to-dos", note: "Saved to your notes" } as const;

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
  const answer = cleanText(b.answer, 4000) ?? (ok ? "Done." : "Flo couldn't do that.");
  const r = await finishRequest(c.user.id, id, ok, answer);
  if (!r) return Response.json({ error: "Not found." }, { status: 404 });
  const title = ok ? TITLE[r.mode] : "Flo couldn't do that";
  const body = answer.length > 400 ? `${answer.slice(0, 397)}...` : answer;
  const item = await storeNotification(c.user.id, "flo_answer", title, body, { requestId: String(r.id), mode: r.mode });
  if (pushConfigured()) {
    const targets = await pushTargets(c.user.id);
    if (targets.length) {
      const res = await sendPush(
        targets.map((t) => t.pushToken),
        { title, body, data: { kind: "flo_answer", id: String(item.id), requestId: String(r.id) } },
      );
      await Promise.all(res.unregistered.map(dropPushToken));
    }
  }
  return Response.json({ request: r });
}
