// Pure logic for one-click "Connect Google" (Calendar + Gmail): scope choices, the authorize URL
// parameters, Google token responses and the refresh request body. No imports, so node --test can
// run it directly (tests/google-logic.test.mjs). The server side lives in lib/google.ts.

/** What the desktop can ask for. */
export const GOOGLE_SCOPE_KEYS = ["calendar", "gmail"] as const;
export type GoogleScopeKey = (typeof GOOGLE_SCOPE_KEYS)[number];

/** Always requested: lets the callback read the account's email from the id_token. */
export const BASE_SCOPES = ["openid", "email"] as const;

/** OAuth scopes per choice. Keep in sync with src-tauri/src/google.rs and docs/google-setup.md. */
export const GOOGLE_SCOPES: Record<GoogleScopeKey, readonly string[]> = {
  calendar: ["https://www.googleapis.com/auth/calendar.readonly"],
  gmail: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"],
};

/** `["gmail", "calendar", "gmail"]` → `["calendar", "gmail"]`. Null when empty, not an array, or unknown keys. */
export function parseScopeKeys(v: unknown): GoogleScopeKey[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 8) return null;
  const set = new Set<GoogleScopeKey>();
  for (const k of v) {
    if (typeof k !== "string" || !(GOOGLE_SCOPE_KEYS as readonly string[]).includes(k)) return null;
    set.add(k as GoogleScopeKey);
  }
  return GOOGLE_SCOPE_KEYS.filter((k) => set.has(k));
}

/** How the choice is kept on the one-time state row: "calendar gmail". */
export const storeScopeKeys = (keys: readonly GoogleScopeKey[]) => keys.join(" ");

/** Back from the state row; unknown words are dropped. */
export function loadScopeKeys(s: string): GoogleScopeKey[] {
  const words = new Set(String(s ?? "").split(/\s+/));
  return GOOGLE_SCOPE_KEYS.filter((k) => words.has(k));
}

/** The space-separated `scope` parameter: "openid email" plus each chosen product's scopes. */
export function scopeParam(keys: readonly GoogleScopeKey[]): string {
  return [...BASE_SCOPES, ...keys.flatMap((k) => GOOGLE_SCOPES[k])].join(" ");
}

/** Which products a granted `scope` string covers (Google lets people untick boxes). Gmail needs both scopes. */
export function grantedKeys(scope: string): GoogleScopeKey[] {
  const got = new Set(String(scope ?? "").split(/\s+/).filter(Boolean));
  return GOOGLE_SCOPE_KEYS.filter((k) => GOOGLE_SCOPES[k].every((s) => got.has(s)));
}

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** Query parameters for accounts.google.com. Offline + consent so Google always returns a refresh token. */
export function authorizeParams(o: { clientId: string; redirectUri: string; state: string; keys: readonly GoogleScopeKey[] }): Record<string, string> {
  return {
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: "code",
    scope: scopeParam(o.keys),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: o.state,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const TOKEN_RE = /^[\x21-\x7e]{10,4096}$/;
const EMAIL_RE = /^[^\s@]{1,200}@[^\s@]{1,200}$/;

/** Google's error code, short and printable, or a fallback. */
function errorCode(j: Record<string, unknown>, fallback: string): string {
  return typeof j.error === "string" && /^[a-z_]{1,60}$/.test(j.error) ? j.error : fallback;
}

/** Seconds until the access token expires, clamped to something sane. */
function expiresIn(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 86_400) : 3600;
}

/**
 * The account's email from an OpenID id_token. The token came straight from Google's token endpoint
 * over TLS (we never accept it from anyone else), so reading its payload without checking the
 * signature is fine (OpenID Connect Core 3.1.3.7). Returns "" when absent or odd.
 */
export function emailFromIdToken(idToken: unknown): string {
  if (typeof idToken !== "string" || idToken.length > 8192) return "";
  const part = idToken.split(".")[1];
  if (!part) return "";
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const p = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!isObj(p) || typeof p.email !== "string") return "";
    const email = p.email.trim();
    return EMAIL_RE.test(email) ? email : "";
  } catch {
    return "";
  }
}

export type GoogleTokens = { refreshToken: string; accessToken: string; expiresIn: number; scope: string; email: string };

/** authorization_code → tokens. A refresh token is required (that is the whole point of connecting). */
export function parseCodeResponse(status: number, j: unknown): { ok: true; tokens: GoogleTokens } | { ok: false; error: string } {
  const o = isObj(j) ? j : {};
  if (status < 200 || status >= 300) return { ok: false, error: errorCode(o, `http_${status}`) };
  const accessToken = typeof o.access_token === "string" && TOKEN_RE.test(o.access_token) ? o.access_token : "";
  const refreshToken = typeof o.refresh_token === "string" && TOKEN_RE.test(o.refresh_token) ? o.refresh_token : "";
  if (!accessToken) return { ok: false, error: "no_access_token" };
  if (!refreshToken) return { ok: false, error: "no_refresh_token" };
  return {
    ok: true,
    tokens: {
      refreshToken,
      accessToken,
      expiresIn: expiresIn(o.expires_in),
      scope: typeof o.scope === "string" ? o.scope.slice(0, 2000) : "",
      email: emailFromIdToken(o.id_token),
    },
  };
}

/** refresh_token → a fresh access token. `invalid_grant` means the user revoked access (or it expired). */
export function parseRefreshResponse(
  status: number,
  j: unknown,
): { ok: true; accessToken: string; expiresIn: number; scope?: string } | { ok: false; error: "invalid_grant" | "google" } {
  const o = isObj(j) ? j : {};
  if (status < 200 || status >= 300) return { ok: false, error: errorCode(o, "") === "invalid_grant" ? "invalid_grant" : "google" };
  const accessToken = typeof o.access_token === "string" && TOKEN_RE.test(o.access_token) ? o.access_token : "";
  if (!accessToken) return { ok: false, error: "google" };
  const out: { ok: true; accessToken: string; expiresIn: number; scope?: string } = { ok: true, accessToken, expiresIn: expiresIn(o.expires_in) };
  if (typeof o.scope === "string" && o.scope) out.scope = o.scope.slice(0, 2000);
  return out;
}

/** POST /api/google/refresh body: `{refresh_token}`. */
export function parseRefreshBody(body: unknown): { refreshToken: string } | { error: string } {
  if (!isObj(body)) return { error: "Expected a JSON object." };
  const t = body.refresh_token;
  if (typeof t !== "string" || !TOKEN_RE.test(t)) return { error: "Missing refresh_token." };
  return { refreshToken: t };
}

/** The sealed hand-off payload, with when it was obtained so the claim can report the time left. */
export type SealedGoogle = { refresh_token: string; access_token: string; expires_in: number; scope: string; email: string; obtained_at: number };

/** Unsealed JSON → the claim response (`expiresIn` counts down from when Google issued it). */
export function claimResponse(plain: string, now: number): { refreshToken: string; accessToken: string; expiresIn: number; scope: string; email: string } | null {
  let p: unknown;
  try {
    p = JSON.parse(plain);
  } catch {
    return null;
  }
  if (!isObj(p) || typeof p.refresh_token !== "string" || typeof p.access_token !== "string") return null;
  const issued = typeof p.obtained_at === "number" ? p.obtained_at : now;
  const total = typeof p.expires_in === "number" ? p.expires_in : 0;
  const left = Math.max(0, Math.floor(total - Math.max(0, now - issued) / 1000));
  return {
    refreshToken: p.refresh_token,
    accessToken: p.access_token,
    expiresIn: left,
    scope: typeof p.scope === "string" ? p.scope : "",
    email: typeof p.email === "string" ? p.email : "",
  };
}
