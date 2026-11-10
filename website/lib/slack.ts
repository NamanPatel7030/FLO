import "server-only";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

/**
 * One-click "Connect Slack" (OAuth v2, user token) brokered by this site. See docs/slack-setup.md.
 *
 *   Flo  ── POST /api/slack/start {challenge} ──▶ one-time state (10 min)
 *   Flo opens /api/slack/install?state=…  ──▶ slack.com/oauth/v2/authorize
 *   Slack ──▶ /api/slack/callback?code&state ──▶ oauth.v2.access ──▶ token sealed (AES-256-GCM, 5 min)
 *        ──▶ /slack/connected?code=<handoff> ──▶ flo://slack?code=<handoff>
 *   Flo  ── POST /api/slack/claim {code, verifier} ──▶ token (once), row deleted ──▶ macOS keychain
 *
 * The token only passes through; nothing Slack-related is kept here after the claim (or 5 minutes).
 * The handoff code alone is useless: claiming needs the verifier that never left the desktop app.
 */

/** The user-token scopes src-tauri/src/slack.rs needs. Keep in sync with slack-app-manifest.yml. */
export const SLACK_USER_SCOPES = [
  "channels:history",
  "groups:history",
  "im:history",
  "mpim:history",
  "im:read",
  "users:read",
  "search:read",
  "chat:write",
] as const;

export const STATE_TTL_MS = 10 * 60_000;
export const HANDOFF_TTL_MS = 5 * 60_000;
export const STATE_COOKIE = "flo_slack_state";

export function slackConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = (process.env.SLACK_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.SLACK_CLIENT_SECRET ?? "").trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Which keys are missing (for the developer setup page — names only, never values). */
export function missingSlackEnv(): string[] {
  return (["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "AUTH_SECRET"] as const).filter((k) => !(process.env[k] ?? "").trim());
}

/** Public base URL of this site (no trailing slash). Must match the app manifest's redirect URL. */
export function siteBase(req: Request): string {
  const s = (process.env.SITE_URL ?? "").trim().replace(/\/+$/, "");
  return s || new URL(req.url).origin;
}

export const redirectUri = (req: Request) => `${siteBase(req)}/api/slack/callback`;

export function authorizeUrl(req: Request, clientId: string, state: string): string {
  const u = new URL("https://slack.com/oauth/v2/authorize");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("user_scope", SLACK_USER_SCOPES.join(","));
  u.searchParams.set("redirect_uri", redirectUri(req));
  u.searchParams.set("state", state);
  return u.toString();
}

/** PKCE-style: the desktop keeps `verifier`, the server only ever stores sha256(verifier). */
export const challengeOf = (verifier: string) => createHash("sha256").update(verifier, "utf8").digest("base64url");
export const isChallenge = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{43}$/.test(s);
export const isVerifier = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(s);

export const randomCode = () => randomBytes(24).toString("base64url");

// ── sealing (AES-256-GCM, key derived from AUTH_SECRET) ─────────────────────
// Format: base64url(iv[12] ‖ tag[16] ‖ ciphertext). tests/slack-routes.mjs mirrors this to seed rows.
const KEY_INFO = "flo/slack-handoff/v1";
function key(info: string): Buffer {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return Buffer.from(hkdfSync("sha256", s, "", info, 32));
}

/** Seal under a per-feature key (HKDF `info`), e.g. "flo/google-handoff/v1" in lib/google.ts. */
export function sealWith(info: string, plain: string, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(info), iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}

export function unsealWith(info: string, sealed: string, aad: string): string | null {
  try {
    const b = Buffer.from(sealed, "base64url");
    const d = createDecipheriv("aes-256-gcm", key(info), b.subarray(0, 12));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const seal = (plain: string, aad: string) => sealWith(KEY_INFO, plain, aad);
export const unseal = (sealed: string, aad: string) => unsealWith(KEY_INFO, sealed, aad);

/** Exchange the OAuth code. Returns only what we need; never log the response. */
export async function exchangeCode(
  req: Request,
  cfg: { clientId: string; clientSecret: string },
  code: string,
): Promise<{ ok: true; token: string; team: string; slackUser: string } | { ok: false; error: string }> {
  const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: redirectUri(req) });
  let r: Response;
  try {
    r = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, error: "unreachable" };
  }
  const j = (await r.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    authed_user?: { id?: string; access_token?: string; token_type?: string };
    team?: { name?: string };
  };
  const token = j.authed_user?.access_token ?? "";
  if (!j.ok || !token.startsWith("xoxp-")) return { ok: false, error: typeof j.error === "string" ? j.error.slice(0, 60) : "no_user_token" };
  return { ok: true, token, team: String(j.team?.name ?? "").slice(0, 120), slackUser: String(j.authed_user?.id ?? "").slice(0, 40) };
}

/** Slack app manifest for this site (same as slack-app-manifest.yml, with the real redirect URL filled in). */
export function manifestYaml(site: string): string {
  return [
    "display_information:",
    "  name: Flo",
    "  description: Your voice assistant in the notch. Turns Slack messages waiting on you into to-dos and sends replies you approve.",
    '  background_color: "#05070a"',
    "oauth_config:",
    "  redirect_urls:",
    `    - ${site}/api/slack/callback`,
    "  scopes:",
    "    user:",
    ...SLACK_USER_SCOPES.map((s) => `      - ${s}`),
    "settings:",
    "  org_deploy_enabled: false",
    "  socket_mode_enabled: false",
    "  token_rotation_enabled: false",
    "",
  ].join("\n");
}
