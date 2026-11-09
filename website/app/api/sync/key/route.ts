// Encrypted sync key check. POST { check? }: registers the check when this account has none,
// and always answers with the stored one, so a second Mac can verify its recovery key locally.
import { syncKeyCheck, syncSummary } from "@/lib/db";
import { failed, syncUser } from "@/lib/sync-route";
import { validCheck } from "@/lib/sync-validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const who = await syncUser(req, "key", 30);
  if ("res" in who) return who.res;
  const body = (await req.json().catch(() => ({}))) as { check?: unknown };
  if (body.check !== undefined && body.check !== null && !validCheck(body.check)) return Response.json({ error: "Invalid key check." }, { status: 400 });
  try {
    const r = await syncKeyCheck(who.userId, validCheck(body.check) ? body.check : null);
    return Response.json({ ...r, ...(await syncSummary(who.userId)) });
  } catch (e) {
    console.error("sync key:", e instanceof Error ? e.message : "error");
    return failed("setup");
  }
}
