import { desktopCaller, formatCode, serverUrl, startPairing, unauthorized } from "@/lib/mobile";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

/** Desktop: new pairing code → {code: "483 920", payload: "flo-pair://<host>/<code>", expiresAt}. 6 digits, 5 min, single use. */
export async function POST(req: Request) {
  const c = await desktopCaller(req);
  if (!c) return unauthorized();
  if (!rateLimit(`pair-start:${c.user.id}`, 20)) return Response.json({ error: "Too many pairing codes. Try again in a few minutes." }, { status: 429 });
  const { digits, expiresAt } = await startPairing(c.user.id);
  const server = new URL(serverUrl(req));
  // ?scheme= tells the phone http vs https (it otherwise assumes http only for LAN/localhost/.local)
  const scheme = server.protocol === "http:" ? "http" : "https";
  return Response.json({ code: formatCode(digits), payload: `flo-pair://${server.host}/${digits}?scheme=${scheme}`, expiresAt });
}
