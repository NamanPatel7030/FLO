import { desktopCaller, removeDevice, unauthorized } from "@/lib/mobile";

export const runtime = "nodejs";

/** Desktop: unpair a phone → {ok}. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const c = await desktopCaller(req);
  if (!c) return unauthorized();
  const { id } = await ctx.params;
  if (!(await removeDevice(c.user.id, id))) return Response.json({ error: "No such device." }, { status: 404 });
  return Response.json({ ok: true });
}
