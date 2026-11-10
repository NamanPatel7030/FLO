import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { adminGate, demoMode, type AdminGate } from "./admin-access";
import { createClient } from "./supabase/server";

/**
 * The admin gate for pages and /api/admin routes: the signed-in Supabase user (verified with the Auth
 * server, not just the cookie) must have a confirmed email listed in ADMIN_EMAILS. Anyone else sees a
 * 404. Cached per request.
 */
export const adminAccess = cache(async (): Promise<AdminGate> => {
  if (demoMode(process.env)) return adminGate(null, process.env);
  const supabase = await createClient();
  if (!supabase) return { status: 404 };
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return { status: 404 };
    return adminGate({ email: data.user.email, confirmed: Boolean(data.user.email_confirmed_at) }, process.env);
  } catch {
    return { status: 404 };
  }
});

/** Pages: the admin, or Next's 404 page. */
export async function requireAdmin(): Promise<{ email: string; demo: boolean }> {
  const g = await adminAccess();
  if (g.status !== 200) notFound();
  return { email: g.email, demo: g.demo };
}
