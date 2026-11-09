"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";

let client: SupabaseClient | null | undefined;

/** Browser Supabase client (cookie session shared with the server). Null when Supabase isn't configured. */
export function createClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const env = supabaseEnv();
  client = env ? createBrowserClient(env.url, env.anonKey) : null;
  return client;
}

/**
 * Is an OAuth provider switched on in the Supabase project? Reads the public Auth settings
 * (`/auth/v1/settings`). Null when that can't be determined (then just try the redirect).
 */
export async function providerEnabled(provider: "google"): Promise<boolean | null> {
  const env = supabaseEnv();
  if (!env) return false;
  try {
    const r = await fetch(`${env.url}/auth/v1/settings`, { headers: { apikey: env.anonKey }, signal: AbortSignal.timeout(4000), cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { external?: Record<string, unknown> };
    const v = j.external?.[provider];
    return typeof v === "boolean" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Where Supabase sends people back to after email links and Google: `${SITE_URL}/auth/callback?next=…`.
 * `site` is SITE_URL handed down by the server page; falls back to this tab's origin.
 */
export function callbackUrl(next: string, site?: string): string {
  const base = (site || window.location.origin).replace(/\/+$/, "");
  return `${base}/auth/callback?next=${encodeURIComponent(next)}`;
}
