// Flo's update server. The app asks GET /api/updates/{target}/{arch}/{current_version}:
//   204           → already on the newest version
//   200 + JSON    → { version, notes, pub_date, url, signature } for that platform
// Releases are published by scripts/release.sh, which writes releases/latest.json and puts the
// signed bundle in public/releases/<version>/. The signature is checked by the app against the
// public key built into it, so this server can't push anything that wasn't signed by us.
import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isNewer, platformKey, type Manifest } from "@/lib/updates";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ target: string; arch: string; current: string }> }) {
  const { target, arch, current } = await ctx.params;
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(process.cwd(), "releases", "latest.json"), "utf8"));
  } catch {
    return new NextResponse(null, { status: 204 }); // nothing published yet
  }
  const entry = manifest.platforms?.[platformKey(target, arch)];
  if (!entry || !isNewer(manifest.version, current)) return new NextResponse(null, { status: 204 });
  // relative URLs are served by this site (public/releases/...)
  const url = /^https?:\/\//.test(entry.url) ? entry.url : new URL(entry.url, req.url).toString();
  return NextResponse.json(
    { version: manifest.version, notes: manifest.notes ?? "", pub_date: manifest.pub_date, url, signature: entry.signature },
    { headers: { "Cache-Control": "no-store" } },
  );
}
