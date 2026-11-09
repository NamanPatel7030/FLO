import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createPlainClient, type SupabaseClient, type User as AuthUser } from "@supabase/supabase-js";
import type { User } from "../db";
import { supabaseEnv } from "./env";

/**
 * Server-side Supabase clients.
 *   createClient()     cookie-bound (Server Components, Route Handlers, Server Actions): the visitor's session
 *   statelessClient()  no cookies, no persistence: server-to-Supabase calls such as /api/app/login
 * Both return null when NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY aren't set, so pages still render.
 */
export async function createClient(): Promise<SupabaseClient | null> {
  const env = supabaseEnv();
  if (!env) return null;
  const store = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // called from a Server Component (read-only cookies): middleware.ts refreshes the session instead
        }
      },
    },
  });
}

export function statelessClient(): SupabaseClient | null {
  const env = supabaseEnv();
  if (!env) return null;
  return createPlainClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Map a Supabase Auth user to Flo's account shape ({id, email, name, image}). */
export function toFloUser(u: AuthUser): User {
  const m = (u.user_metadata ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
  return {
    id: u.id,
    email: (u.email ?? "").toLowerCase(),
    name: s(m.name) || s(m.full_name),
    image: s(m.avatar_url) || s(m.picture) || null,
  };
}

/**
 * The signed-in visitor, verified with the Supabase Auth server (`auth.getUser()`, not just the cookie).
 * Null when signed out, when the session is invalid, or when Supabase isn't configured. Cached per request.
 */
export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return toFloUser(data.user);
  } catch {
    return null;
  }
});
