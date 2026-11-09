import { parseSnapshot, STATE_LIMITS } from "@/lib/desktop-state";
import { clearDesktopState, desktopCaller, putDesktopState, unauthorized } from "@/lib/mobile";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

/**
 * Desktop: publish the computer's snapshot for the paired phone (to-dos, Claude Code approvals,
 * non-secret settings) → {stored}. The server keeps known fields only (lib/desktop-state.ts) and
 * stores nothing while no phone is paired.
 */
export async function POST(req: Request) {
  const c = await desktopCaller(req);
  if (!c) return unauthorized();
  if (!rateLimit(`state:${c.user.id}`, 60, 60_000)) return Response.json({ error: "Too many updates. Try again in a minute." }, { status: 429 });
  const raw = await req.text();
  if (raw.length > STATE_LIMITS.maxBytes) return Response.json({ error: "The snapshot is too large." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  const r = parseSnapshot(body);
  if ("error" in r) return Response.json({ error: r.error }, { status: 400 });
  const saved = await putDesktopState(c.user.id, r.state);
  return Response.json({ stored: !!saved, updatedAt: saved?.updatedAt ?? null });
}

/** Desktop: forget the snapshot (signing out). */
export async function DELETE(req: Request) {
  const c = await desktopCaller(req);
  if (!c) return unauthorized();
  await clearDesktopState(c.user.id);
  return Response.json({ ok: true });
}
