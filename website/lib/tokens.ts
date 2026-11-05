import "server-only";
import { jwtVerify, SignJWT } from "jose";
import type { User } from "./db";

/** App tokens: JWT HS256 signed with AUTH_SECRET, 30 days (see docs/03-accounts-contract.md). */
const key = () => {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(s);
};

export async function issueAppToken(u: User): Promise<string> {
  return new SignJWT({ email: u.email, name: u.name })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(u.id)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(key());
}

export async function verifyAppToken(token: string): Promise<{ sub: string } | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return payload.sub ? { sub: payload.sub } : null;
  } catch {
    return null;
  }
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}
