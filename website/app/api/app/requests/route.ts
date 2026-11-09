import { desktopCaller, takeRequests, unauthorized } from "@/lib/mobile";

export const runtime = "nodejs";

/** Desktop: take pending phone requests (each is handed out once) → {requests: [...]}. */
export async function GET(req: Request) {
  const c = await desktopCaller(req);
  if (!c) return unauthorized();
  return Response.json({ requests: await takeRequests(c.user.id) }, { headers: { "Cache-Control": "no-store" } });
}
