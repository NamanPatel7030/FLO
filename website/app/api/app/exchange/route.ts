import { redeemHandoff, touchAppUsage } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { issueAppToken } from "@/lib/tokens";

export const runtime = "nodejs";

/** Desktop app: one-time handoff code → {token, user}. Each code works once. */
export async function POST(req: Request) {
  if (!rateLimit(`exchange:${clientIp(req)}`, 30)) return Response.json({ error: "Too many attempts." }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { code?: unknown; state?: unknown };
  if (typeof body.code !== "string" || !body.code.trim()) return Response.json({ error: "Missing code." }, { status: 400 });
  const user = await redeemHandoff(body.code.trim(), typeof body.state === "string" && body.state ? body.state : undefined);
  if (!user) return Response.json({ error: "That code is invalid, used or expired. Start sign-in again from Flo." }, { status: 401 });
  await touchAppUsage(user.id);
  return Response.json({ token: await issueAppToken(user), user });
}
