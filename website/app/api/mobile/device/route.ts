import { mobileCaller, removeDevice, setPushToken, unauthorized } from "@/lib/mobile";

export const runtime = "nodejs";

/** Phone: {pushToken} → {ok}. Call when the FCM token rotates (null/"" clears it). */
export async function POST(req: Request) {
  const c = await mobileCaller(req);
  if (!c?.deviceId) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { pushToken?: unknown };
  if (body.pushToken !== null && body.pushToken !== undefined && (typeof body.pushToken !== "string" || body.pushToken.length > 4096)) {
    return Response.json({ error: "pushToken must be a string." }, { status: 400 });
  }
  const token = typeof body.pushToken === "string" && body.pushToken.trim() ? body.pushToken.trim() : null;
  await setPushToken(c.deviceId, token);
  return Response.json({ ok: true });
}

/** Phone: sign out (unpair this device) → {ok}. */
export async function DELETE(req: Request) {
  const c = await mobileCaller(req);
  if (!c?.deviceId) return unauthorized();
  await removeDevice(c.user.id, c.deviceId);
  return Response.json({ ok: true });
}
