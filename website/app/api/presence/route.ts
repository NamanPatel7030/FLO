import { anyCaller, getPresence, setPresence, unauthorized } from "@/lib/mobile";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

/** Desktop or phone: current presence → {status, since}. */
export async function GET(req: Request) {
  const c = await anyCaller(req);
  if (!c) return unauthorized();
  return Response.json(await getPresence(c.user.id));
}

/** Desktop or phone: {status: "active" | "away"} → {status, since}. */
export async function POST(req: Request) {
  const c = await anyCaller(req);
  if (!c) return unauthorized();
  if (!rateLimit(`presence:${c.user.id}`, 120, 60_000)) return Response.json({ error: "Too many requests." }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { status?: unknown };
  if (body.status !== "active" && body.status !== "away") {
    return Response.json({ error: 'status must be "active" or "away".' }, { status: 400 });
  }
  return Response.json(await setPresence(c.user.id, body.status));
}
