// Encrypted sync: DELETE wipes everything this account has synced (items and key check).
import { syncWipe } from "@/lib/db";
import { failed, syncUser } from "@/lib/sync-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request) {
  const who = await syncUser(req, "wipe", 10);
  if ("res" in who) return who.res;
  try {
    return Response.json({ deleted: await syncWipe(who.userId) });
  } catch (e) {
    console.error("sync wipe:", e instanceof Error ? e.message : "error");
    return failed("delete");
  }
}
