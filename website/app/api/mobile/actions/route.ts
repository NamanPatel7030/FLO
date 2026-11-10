import { parseAction } from "@/lib/desktop-state";
import { mobileCaller, queueAction, unauthorized } from "@/lib/mobile";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

/**
 * Phone: {kind, target, value?} → 202 {action}. kind is todo_done | todo_reopen | approve | reject |
 * setting | reply (target = Claude Code session id, value = text) | choose (target = session id,
 * value = {id?, answers: [[label]]}). The computer picks it up on its next poll, checks it again
 * (only the settings it marks editable can change; a reply only ever reaches Claude as a prompt)
 * and applies it, then finishes it with a message ("Sent to api-server", or why not).
 */
export async function POST(req: Request) {
  const c = await mobileCaller(req);
  if (!c) return unauthorized();
  if (!rateLimit(`action:${c.user.id}`, 60, 60_000)) return Response.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  const a = parseAction(await req.json().catch(() => null));
  if ("error" in a) return Response.json({ error: a.error }, { status: 400 });
  const action = await queueAction(c.user.id, c.deviceId, a);
  return Response.json({ action }, { status: 202 });
}
