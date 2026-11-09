// Installer downloads, for signed-in accounts only.
// The real file URLs live in server-only env vars (DOWNLOAD_MAC / DOWNLOAD_WINDOWS / DOWNLOAD_LINUX),
// never in the page or the JS bundle, so a link can't be shared around the sign-up. Signed-out
// visitors are sent to sign up and come straight back to the download.
import { NextResponse } from "next/server";
import { downloadUrl, isOS } from "@/lib/downloads";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ os: string }> }) {
  const { os } = await ctx.params;
  if (!isOS(os)) return NextResponse.json({ error: "Unknown platform" }, { status: 404 });
  if (!(await getUser())) {
    const next = encodeURIComponent(`/download?os=${os}`);
    return NextResponse.redirect(new URL(`/signup?next=${next}`, req.url), 302);
  }
  const url = downloadUrl(os);
  if (!url) return NextResponse.redirect(new URL(`/download?os=${os}&soon=1`, req.url), 302);
  // a relative path means a file this site serves (e.g. /releases/...)
  return NextResponse.redirect(new URL(url, req.url), 302);
}
