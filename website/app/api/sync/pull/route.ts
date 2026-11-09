// Encrypted sync: items changed since a cursor, oldest first, a page at a time.
import { syncPull } from "@/lib/db";
import { failed, syncUser } from "@/lib/sync-route";
import { parseCursor, SYNC_LIMITS } from "@/lib/sync-validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const who = await syncUser(req, "pull", 240);
  if ("res" in who) return who.res;
  const since = parseCursor(new URL(req.url).searchParams.get("since"));
  if (since === null) return Response.json({ error: "Invalid cursor." }, { status: 400 });
  try {
    return Response.json(await syncPull(who.userId, since, SYNC_LIMITS.pageSize), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("sync pull:", e instanceof Error ? e.message : "error");
    return failed("download");
  }
}
