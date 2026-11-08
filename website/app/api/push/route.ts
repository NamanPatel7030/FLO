import {
  cleanData,
  cleanText,
  desktopCaller,
  deviceCount,
  dropPushToken,
  getPresence,
  PUSH_KINDS,
  pushTargets,
  storeNotification,
  unauthorized,
} from "@/lib/mobile";
import { pushConfigured, sendPush } from "@/lib/push";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

/**
 * Desktop: {kind, title, body, data?} → {stored: true, pushed, reason?}.
 * Always stored in the inbox (last 100); pushed to every paired phone only while presence is "away".
 */
export async function POST(req: Request) {
  const c = await desktopCaller(req);
  if (!c) return unauthorized();
  if (!rateLimit(`push:${c.user.id}`, 30, 60_000)) return Response.json({ error: "Too many notifications. Slow down." }, { status: 429 });
  const b = (await req.json().catch(() => ({}))) as { kind?: unknown; title?: unknown; body?: unknown; data?: unknown };
  if (typeof b.kind !== "string" || !(PUSH_KINDS as readonly string[]).includes(b.kind)) {
    return Response.json({ error: `kind must be one of: ${PUSH_KINDS.join(", ")}.` }, { status: 400 });
  }
  const title = cleanText(b.title, 120);
  const body = cleanText(b.body, 400) ?? "";
  if (!title) return Response.json({ error: "title is required." }, { status: 400 });
  const data = cleanData(b.data);
  if (data === "invalid") return Response.json({ error: "data must be a small object of string/number/boolean values." }, { status: 400 });

  const item = await storeNotification(c.user.id, b.kind, title, body, data);
  const presence = await getPresence(c.user.id);
  if (presence.status !== "away") return Response.json({ stored: true, pushed: 0, reason: "user is active" });
  if (!pushConfigured()) return Response.json({ stored: true, pushed: 0, reason: "push not configured" });
  const targets = await pushTargets(c.user.id);
  if (!targets.length) {
    const reason = (await deviceCount(c.user.id)) ? "no device has a push token yet" : "no paired devices";
    return Response.json({ stored: true, pushed: 0, reason });
  }
  const res = await sendPush(
    targets.map((t) => t.pushToken),
    { title, body, data: { ...(data ?? {}), kind: b.kind, id: String(item.id) } },
  );
  await Promise.all(res.unregistered.map(dropPushToken));
  return Response.json(res.error ? { stored: true, pushed: res.sent, reason: res.error } : { stored: true, pushed: res.sent });
}
