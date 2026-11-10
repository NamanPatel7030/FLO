import { desktopCaller, takeActions, takeRequests, unauthorized } from "@/lib/mobile";

export const runtime = "nodejs";

/**
 * Desktop: take pending phone requests (each is handed out once) → {requests: [...]}. With
 * `?actions=1` (desktop apps that understand them) it also hands out pending phone actions →
 * {requests, actions}, so one poll covers both. An ask may carry `context`: the phone's visible screen
 * text (bubble Ask only), which the desktop adds to the prompt.
 */
export async function GET(req: Request) {
  const c = await desktopCaller(req);
  if (!c) return unauthorized();
  const withActions = new URL(req.url).searchParams.get("actions") === "1";
  const [requests, actions] = await Promise.all([takeRequests(c.user.id), withActions ? takeActions(c.user.id) : Promise.resolve(null)]);
  return Response.json(actions ? { requests, actions } : { requests }, { headers: { "Cache-Control": "no-store" } });
}
