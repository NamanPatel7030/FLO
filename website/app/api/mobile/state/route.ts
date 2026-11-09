import { getDesktopState, mobileCaller, recentActions, unauthorized } from "@/lib/mobile";

export const runtime = "nodejs";

/**
 * Phone: the computer's latest snapshot → {state | null, updatedAt | null, actions}. `actions` are this
 * account's phone actions from the last 10 minutes (pending / taken / done / failed), so the phone can
 * show what's still on its way. The phone polls this only while the app is open.
 */
export async function GET(req: Request) {
  const c = await mobileCaller(req);
  if (!c) return unauthorized();
  const [s, actions] = await Promise.all([getDesktopState(c.user.id), recentActions(c.user.id)]);
  return Response.json(
    { state: s?.state ?? null, updatedAt: s?.updatedAt ?? null, actions },
    { headers: { "Cache-Control": "no-store" } },
  );
}
