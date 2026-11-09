import { cleanText, mobileCaller, queueRequest, REQUEST_MODES, unauthorized, type RequestMode } from "@/lib/mobile";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

/**
 * Phone: {mode: "ask" | "todo" | "note", text} → 202 {request}. The text was transcribed on the phone;
 * the paired Mac picks it up, answers it (or saves the to-do / note) and the answer comes back through
 * GET /api/mobile/ask/{id} and the inbox.
 */
export async function POST(req: Request) {
  const c = await mobileCaller(req);
  if (!c) return unauthorized();
  if (!rateLimit(`ask:${c.user.id}`, 20, 60_000)) return Response.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as { mode?: unknown; text?: unknown };
  const mode = (typeof b.mode === "string" ? b.mode : "ask") as RequestMode;
  if (!REQUEST_MODES.includes(mode)) return Response.json({ error: "mode must be ask, todo or note." }, { status: 400 });
  const text = cleanText(b.text, 2000);
  if (!text) return Response.json({ error: "Say something first." }, { status: 400 });
  const request = await queueRequest(c.user.id, c.deviceId, mode, text);
  return Response.json({ request }, { status: 202 });
}
