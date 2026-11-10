import "server-only";
import {
  authorizeParams,
  GOOGLE_AUTHORIZE_URL,
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  parseCodeResponse,
  parseRefreshResponse,
  type GoogleScopeKey,
  type GoogleTokens,
} from "./google-logic";
import { sealWith, siteBase, unsealWith } from "./slack";

/**
 * One-click "Connect Google" (Calendar + Gmail) brokered by this site, exactly like Connect Slack.
 * See docs/google-setup.md.
 *
 *   Flo  ── POST /api/google/start {challenge, scopes} ──▶ one-time state (10 min)
 *   Flo opens /api/google/install?state=…  ──▶ accounts.google.com (offline, consent)
 *   Google ──▶ /api/google/callback?code&state ──▶ oauth2.googleapis.com/token ──▶ tokens sealed (AES-256-GCM, 5 min)
 *          ──▶ /google/connected?code=<handoff> ──▶ flo://google?code=<handoff>
 *   Flo  ── POST /api/google/claim {code, verifier} ──▶ tokens (once), row deleted ──▶ keychain
 *   Flo  ── POST /api/google/refresh {refresh_token} (signed in) ──▶ a fresh access token (nothing stored)
 *
 * The client secret never leaves this server, which is why refreshing goes through it too. Nothing
 * Google-related is kept here after the claim (or 5 minutes), and tokens are never logged.
 */

export const STATE_TTL_MS = 10 * 60_000;
export const HANDOFF_TTL_MS = 5 * 60_000;
export const STATE_COOKIE = "flo_google_state";
const KEY_INFO = "flo/google-handoff/v1";

export function googleConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = (process.env.GOOGLE_OAUTH_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "").trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Which keys are missing (for the developer setup page: names only, never values). */
export function missingGoogleEnv(): string[] {
  return (["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "AUTH_SECRET"] as const).filter((k) => !(process.env[k] ?? "").trim());
}

/** Must match an "Authorized redirect URI" on the Google Cloud OAuth client exactly. */
export const redirectUri = (req: Request) => `${siteBase(req)}/api/google/callback`;

export function authorizeUrl(req: Request, clientId: string, state: string, keys: readonly GoogleScopeKey[]): string {
  const u = new URL(GOOGLE_AUTHORIZE_URL);
  for (const [k, v] of Object.entries(authorizeParams({ clientId, redirectUri: redirectUri(req), state, keys }))) u.searchParams.set(k, v);
  return u.toString();
}

export const seal = (plain: string, aad: string) => sealWith(KEY_INFO, plain, aad);
export const unseal = (sealed: string, aad: string) => unsealWith(KEY_INFO, sealed, aad);

async function postForm(url: string, body: URLSearchParams): Promise<{ status: number; json: unknown } | null> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    return { status: r.status, json: await r.json().catch(() => ({})) };
  } catch {
    return null;
  }
}

/** Exchange the OAuth code. Returns only what we need; never log the response. */
export async function exchangeCode(
  req: Request,
  cfg: { clientId: string; clientSecret: string },
  code: string,
): Promise<{ ok: true; tokens: GoogleTokens } | { ok: false; error: string }> {
  const r = await postForm(
    GOOGLE_TOKEN_URL,
    new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri(req), grant_type: "authorization_code" }),
  );
  if (!r) return { ok: false, error: "unreachable" };
  return parseCodeResponse(r.status, r.json);
}

/** A fresh access token for the desktop. The refresh token is used for this one call only. */
export async function refreshAccessToken(
  cfg: { clientId: string; clientSecret: string },
  refreshToken: string,
): Promise<ReturnType<typeof parseRefreshResponse> | { ok: false; error: "unreachable" }> {
  const r = await postForm(
    GOOGLE_TOKEN_URL,
    new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  );
  if (!r) return { ok: false, error: "unreachable" };
  return parseRefreshResponse(r.status, r.json);
}

/** Best effort: give a token back (used when the person granted nothing Flo can use). */
export async function revokeToken(token: string): Promise<void> {
  await postForm(GOOGLE_REVOKE_URL, new URLSearchParams({ token })).catch(() => null);
}
