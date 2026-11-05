import { verifyPassword } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { issueAppToken } from "@/lib/tokens";
import { validateEmail } from "@/lib/validate";

export const runtime = "nodejs";

/** Desktop app sign-in: {email, password} → {token, user}. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!rateLimit(`app-login:${clientIp(req)}:${email}`, 10)) {
    return Response.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }
  if (validateEmail(email) || typeof body.password !== "string" || !body.password) {
    return Response.json({ error: "Wrong email or password." }, { status: 401 });
  }
  const user = await verifyPassword(email, body.password);
  if (!user) return Response.json({ error: "Wrong email or password." }, { status: 401 });
  return Response.json({ token: await issueAppToken(user), user });
}
