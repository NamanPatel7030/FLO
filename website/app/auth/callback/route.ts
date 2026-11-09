import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OTP_TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Supabase Auth sends people here after: confirming their email, Google sign-in, and password-reset
 * links. PKCE `?code=` (default) or `?token_hash=&type=` (custom email templates) → cookie session →
 * redirect to `next` (same-site relative paths only; anything else falls back to /download).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams;
  const type = q.get("type") as EmailOtpType | null;
  const next = safeNext(q.get("next"), type === "recovery" ? "/auth/reset" : "/download");
  const back = (path: string) => {
    const r = NextResponse.redirect(new URL(path, url.origin), 303);
    r.headers.set("cache-control", "no-store");
    return r;
  };
  const fail = (error: string) => back(`${next.startsWith("/auth/reset") ? "/auth/forgot" : "/login"}?error=${error}&next=${encodeURIComponent(next.startsWith("/auth/reset") ? "/download" : next)}`);

  // provider-side failure (e.g. the user cancelled on Google, or the provider is disabled)
  const err = q.get("error_code") ?? q.get("error");
  if (err) {
    const desc = (q.get("error_description") ?? "").toLowerCase();
    if (desc.includes("provider is not enabled") || desc.includes("unsupported provider")) return fail("provider");
    return fail(/otp|expired|invalid/.test(`${err} ${desc}`) ? "link" : "google");
  }

  const supabase = await createClient();
  if (!supabase) return fail("config");

  const code = q.get("code");
  const tokenHash = q.get("token_hash");
  try {
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return back(next);
    } else if (tokenHash && type && OTP_TYPES.includes(type)) {
      const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      if (!error) return back(next);
    }
  } catch {
    // fall through
  }
  return fail("link");
}
