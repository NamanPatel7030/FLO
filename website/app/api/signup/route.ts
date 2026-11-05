import { createUser, EmailTakenError } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { validateEmail, validateName, validatePassword } from "@/lib/validate";

export const runtime = "nodejs";

/** Create an email + password account. The client then signs in with Auth.js credentials. */
export async function POST(req: Request) {
  if (!rateLimit(`signup:${clientIp(req)}`, 20)) return Response.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; email?: unknown; password?: unknown };
  const err = validateName(body.name) || validateEmail(body.email) || validatePassword(body.password);
  if (err) return Response.json({ error: err }, { status: 400 });
  try {
    const user = await createUser(String(body.name), String(body.email), String(body.password));
    return Response.json({ user });
  } catch (e) {
    if (e instanceof EmailTakenError) return Response.json({ error: e.message }, { status: 409 });
    console.error("signup failed", e);
    return Response.json({ error: "Couldn't create your account. Try again." }, { status: 500 });
  }
}
