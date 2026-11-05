import { auth } from "@/auth";
import { createHandoff } from "@/lib/db";

export const runtime = "nodejs";

/** Signed-in website session → one-time code (5 min) for the desktop app. */
export async function POST(req: Request) {
  const session = await auth();
  const uid = (session?.user as { id?: string } | undefined)?.id;
  if (!uid) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { state?: unknown };
  const state = typeof body.state === "string" ? body.state.slice(0, 200) : "";
  if (!state) return Response.json({ error: "Missing state." }, { status: 400 });
  return Response.json({ code: await createHandoff(uid, state) });
}
