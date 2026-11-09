/**
 * Supabase project settings (public: safe in the browser). Both are inlined at build time, so the
 * references must stay literal `process.env.NEXT_PUBLIC_…`.
 * The anon key may be the legacy anon JWT or the new publishable key (`sb_publishable_…`).
 */
export type SupabaseEnv = { url: string; anonKey: string };

export function supabaseEnv(): SupabaseEnv | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  return /^https?:\/\//.test(url) && anonKey ? { url, anonKey } : null;
}

export const NOT_CONFIGURED =
  "Supabase isn't configured on this server yet. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see docs/supabase-setup.md).";
