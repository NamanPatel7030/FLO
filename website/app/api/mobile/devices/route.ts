import { desktopCaller, listDevices, unauthorized } from "@/lib/mobile";

export const runtime = "nodejs";

/** Desktop: paired phones → [{id, name, platform, lastSeen}]. */
export async function GET(req: Request) {
  const c = await desktopCaller(req);
  if (!c) return unauthorized();
  return Response.json(await listDevices(c.user.id));
}
