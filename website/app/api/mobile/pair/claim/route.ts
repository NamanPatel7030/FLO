import { claimPairing, cleanText, normalizeCode, serverUrl } from "@/lib/mobile";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

/** Phone: {code, deviceName, platform: "android", pushToken?} → {deviceToken, user: {name, email}, server}. */
export async function POST(req: Request) {
  // per-IP and global caps: 10^6 codes, each alive 5 minutes, so guessing is hopeless
  if (!rateLimit(`pair-claim:${clientIp(req)}`, 10) || !rateLimit("pair-claim:all", 300)) {
    return Response.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as { code?: unknown; deviceName?: unknown; platform?: unknown; pushToken?: unknown };
  const code = normalizeCode(body.code);
  if (!code) return Response.json({ error: "Enter the 6-digit code shown in Flo." }, { status: 400 });
  const platform = body.platform === undefined ? "android" : body.platform;
  if (platform !== "android") return Response.json({ error: 'platform must be "android".' }, { status: 400 });
  const deviceName = cleanText(body.deviceName, 60) ?? "Android phone";
  const pushToken = typeof body.pushToken === "string" && body.pushToken.trim() && body.pushToken.length <= 4096 ? body.pushToken.trim() : null;
  const r = await claimPairing(code, deviceName, platform, pushToken);
  if (!r) return Response.json({ error: "That code is invalid, used or expired. Make a new one in Flo." }, { status: 401 });
  return Response.json({ deviceToken: r.deviceToken, user: { name: r.user.name, email: r.user.email }, server: serverUrl(req) });
}
