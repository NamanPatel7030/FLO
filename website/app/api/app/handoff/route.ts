import { createHandoff } from "@/lib/db";
import { getUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Signed-in website session (Supabase cookie) → one-time code (5 min) for the desktop app. */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { state?: unknown };
  const state = typeof body.state === "string" ? body.state.slice(0, 200) : "";
  if (!state) return Response.json({ error: "Missing state." }, { status: 400 });
  return Response.json({ code: await createHandoff(user.id, state) });
}
