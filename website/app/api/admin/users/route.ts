import { notFound } from "next/navigation";
import { adminAccess } from "@/lib/admin-auth";
import { loadDataset } from "@/lib/admin-data";
import { buildUserSummaries, queryUsers, usersCsv } from "@/lib/admin-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admins only (404 for everyone else): the users table as CSV, with the same q / filter / sort as /admin/users. */
export async function GET(req: Request) {
  const gate = await adminAccess();
  // the same 404 as a route that doesn't exist
  if (gate.status !== 200) notFound();
  const p = new URL(req.url).searchParams;
  const data = await loadDataset(gate.demo);
  const all = buildUserSummaries(data.users, data.days, data.counts, data.today);
  const { rows } = queryUsers(all, { q: p.get("q") ?? "", filter: p.get("filter") ?? "", sort: p.get("sort") ?? "", dir: p.get("dir") ?? "", per: 100_000 });
  return new Response(usersCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="flo-users-${data.today}.csv"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
