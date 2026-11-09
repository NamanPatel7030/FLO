// Flo's update server. The app asks GET /api/updates/{target}/{arch}/{current_version}:
//   204           → already on the newest version
//   200 + JSON    → { version, notes, pub_date, url, signature } for that platform
// The manifest (latest.json) comes from the newest GitHub Release, which scripts/release-mac.sh
// publishes together with the signed bundle, so a release needs no website deploy. Set
// UPDATE_MANIFEST_URL to host it elsewhere. A local releases/latest.json (dev) wins when present.
// The signature is checked by the app against the public key built into it, so this server can't
// push anything that wasn't signed by us.
import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { isNewer, platformKey, type Manifest } from "@/lib/updates";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ target: string; arch: string; current: string }> }) {
  const { target, arch, current } = await ctx.params;
  const manifest = await loadManifest();
  if (!manifest) return new NextResponse(null, { status: 204 }); // nothing published yet
  const entry = manifest.platforms?.[platformKey(target, arch)];
  if (!entry || !isNewer(manifest.version, current)) return new NextResponse(null, { status: 204 });
  // relative URLs are served by this site (public/releases/...)
  const url = /^https?:\/\//.test(entry.url) ? entry.url : new URL(entry.url, req.url).toString();
  return NextResponse.json(
    { version: manifest.version, notes: manifest.notes ?? "", pub_date: manifest.pub_date, url, signature: entry.signature },
    { headers: { "Cache-Control": "no-store" } },
  );
}

const DEFAULT_MANIFEST = "https://github.com/NamanPatel7030/FLO/releases/latest/download/latest.json";

async function loadManifest(): Promise<Manifest | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(process.cwd(), "releases", "latest.json"), "utf8"));
  } catch {
    /* no local manifest: use the published one */
  }
  try {
    const res = await fetch(process.env.UPDATE_MANIFEST_URL || DEFAULT_MANIFEST, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return (await res.json()) as Manifest;
  } catch {
    return null;
  }
}
