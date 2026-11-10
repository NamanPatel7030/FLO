import { desktopCaller, unauthorized } from "@/lib/mobile";
import { rateLimit } from "@/lib/ratelimit";
import { deleteUsageCounts, saveUsageCounts } from "@/lib/usage";
import { parseUsageCounts } from "@/lib/usage-logic";
import { todayUtc } from "@/lib/admin-metrics";

export const runtime = "nodejs";

/**
 * Desktop, opt-in only (Settings → Privacy → "Share usage counts with Flo"): daily totals, never content.
 * POST {days: [{day: "YYYY-MM-DD", counts: {dictations, words, assistant_asks, agent_runs, meetings}}]}
 * → {saved}. Sent at most once an hour; each (day, kind) is replaced by the latest total.
 * DELETE → {deleted}: sharing was turned off, forget every stored count.
 */
export async function POST(req: Request) {
  const c = await desktopCaller(req);
  if (!c) return unauthorized();
  if (!rateLimit(`usage:${c.user.id}`, 12, 60 * 60_000)) return Response.json({ error: "Too many requests. Try again later." }, { status: 429 });
  const parsed = parseUsageCounts(await req.json().catch(() => null), todayUtc());
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  return Response.json({ saved: await saveUsageCounts(c.user.id, parsed.rows) });
}

export async function DELETE(req: Request) {
  const c = await desktopCaller(req);
  if (!c) return unauthorized();
  return Response.json({ deleted: await deleteUsageCounts(c.user.id) });
}
