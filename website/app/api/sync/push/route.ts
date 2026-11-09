// Encrypted sync: upload changed items. Body { items: [{kind,id,rev,nonce,ct,deleted}] }.
// The server stores ciphertext only (it never has the key) and keeps the newest rev per item.
import { syncPush } from "@/lib/db";
import { failed, syncUser } from "@/lib/sync-route";
import { parsePush, SYNC_LIMITS } from "@/lib/sync-validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const who = await syncUser(req, "push", 120);
  if ("res" in who) return who.res;
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > SYNC_LIMITS.maxBodyBytes) return Response.json({ error: "Too much at once. Send smaller batches." }, { status: 413 });
  const text = await req.text().catch(() => "");
  if (text.length > SYNC_LIMITS.maxBodyBytes) return Response.json({ error: "Too much at once. Send smaller batches." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const parsed = parsePush(body);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  try {
    return Response.json(await syncPush(who.userId, parsed.items));
  } catch (e) {
    console.error("sync push:", e instanceof Error ? e.message : "error");
    return failed("upload");
  }
}
