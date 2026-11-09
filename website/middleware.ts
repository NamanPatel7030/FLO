import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseEnv } from "@/lib/supabase/env";

/**
 * Keeps the Supabase Auth cookie session fresh: on each page / cookie-auth request, `auth.getUser()`
 * refreshes an expiring access token and writes the new cookies to both the request (for the Server
 * Components rendering now) and the response (for the browser).
 */
export async function middleware(request: NextRequest) {
  const env = supabaseEnv();
  // no Supabase session cookie → nothing to refresh (skips a network call for anonymous visitors)
  if (!env || !request.cookies.getAll().some((c) => c.name.startsWith("sb-"))) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  // don't put code between createServerClient and getUser: it's what refreshes the session
  try {
    await supabase.auth.getUser();
  } catch {
    // Supabase unreachable: serve the page; server code treats the visitor as signed out
  }
  return response;
}

export const config = {
  matcher: [
    // pages and the cookie-session routes; not static files, images, or the Bearer-token APIs
    "/((?!_next/static|_next/image|favicon|apple-touch-icon|android-chrome|site\\.webmanifest|naman/|releases/|api/mobile|api/push|api/presence|api/updates|api/slack/claim|api/slack/start|api/app/login|api/app/exchange|api/app/me|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|mp4|webm|woff2?)$).*)",
  ],
};
