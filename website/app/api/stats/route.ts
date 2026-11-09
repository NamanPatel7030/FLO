// Public user counter: totals only, never who. Cached for a minute at the edge.
import { dbConfigured, usageStats } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!dbConfigured()) return Response.json({ error: "unavailable" }, { status: 503 });
  try {
    const stats = await usageStats();
    return Response.json(stats, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch (e) {
    console.error("stats failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
