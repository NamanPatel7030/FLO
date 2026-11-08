import "server-only";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * FCM HTTP v1 sender. Service account from env `FCM_SERVICE_ACCOUNT` (the JSON itself) or
 * `FCM_SERVICE_ACCOUNT_FILE` (a path). OAuth2: a self-signed RS256 JWT is exchanged for an access
 * token (cached until shortly before it expires). No SDK, no extra dependencies.
 */
type ServiceAccount = { project_id: string; client_email: string; private_key: string; token_uri?: string };

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

let cachedAccount: ServiceAccount | null | undefined;
let cachedToken: { token: string; exp: number } | null = null;

export function serviceAccount(): ServiceAccount | null {
  if (cachedAccount !== undefined) return cachedAccount;
  try {
    const raw = process.env.FCM_SERVICE_ACCOUNT || (process.env.FCM_SERVICE_ACCOUNT_FILE ? readFileSync(process.env.FCM_SERVICE_ACCOUNT_FILE, "utf8") : "");
    if (!raw.trim()) return (cachedAccount = null);
    const sa = JSON.parse(raw) as ServiceAccount;
    if (!sa.project_id || !sa.client_email || !sa.private_key) throw new Error("missing project_id / client_email / private_key");
    // only ever talk to Google's token endpoint
    if (sa.token_uri && !/^https:\/\/oauth2\.googleapis\.com\//.test(sa.token_uri)) sa.token_uri = DEFAULT_TOKEN_URI;
    return (cachedAccount = sa);
  } catch (e) {
    console.error("FCM service account is invalid:", String(e).slice(0, 200));
    return (cachedAccount = null);
  }
}

export const pushConfigured = () => serviceAccount() !== null;

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** Signed JWT assertion for Google's OAuth2 token endpoint (RFC 7523). Exported for tests. */
export function signAssertion(sa: ServiceAccount, nowSec = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri || DEFAULT_TOKEN_URI, iat: nowSec, exp: nowSec + 3600 }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(sa.private_key).toString("base64url")}`;
}

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const res = await fetch(sa.token_uri || DEFAULT_TOKEN_URI, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signAssertion(sa) }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !j.access_token) throw new Error(`FCM auth failed (${res.status} ${j.error ?? ""})`);
  cachedToken = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

export type PushMessage = { title: string; body: string; data: Record<string, string> };
export type PushResult = { sent: number; unregistered: string[]; error?: string };

/** Android notification channel the Flo app creates for each kind (see mobile/). */
export function channelFor(kind: string | undefined): string {
  switch (kind) {
    case "claude_done":
    case "claude_needs_you":
    case "claude_limit":
    case "claude_resumed":
      return "claude";
    case "todo_due":
    case "todos_digest":
      return "todos";
    case "reminder":
      return "reminders";
    case "skill_ran":
      return "skills";
    case "meeting_summary":
      return "meetings";
    default:
      return "default";
  }
}

/** True when FCM's error response means the token will never work again. */
export function isUnregistered(status: number, body: unknown): boolean {
  const err = (body as { error?: { status?: string; details?: { errorCode?: string }[] } })?.error;
  if (err?.details?.some((d) => d.errorCode === "UNREGISTERED")) return true;
  return status === 404 && err?.status === "NOT_FOUND";
}

/** Send one notification to each token. Never throws. */
export async function sendPush(tokens: string[], msg: PushMessage): Promise<PushResult> {
  const sa = serviceAccount();
  if (!sa) return { sent: 0, unregistered: [], error: "push not configured" };
  if (!tokens.length) return { sent: 0, unregistered: [] };
  let bearer: string;
  try {
    bearer = await accessToken(sa);
  } catch (e) {
    console.error(String(e));
    return { sent: 0, unregistered: [], error: "push auth failed" };
  }
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`;
  const results = await Promise.all(
    tokens.map(async (token) => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: msg.title, body: msg.body },
              data: msg.data,
              android: { priority: "HIGH", notification: { channel_id: channelFor(msg.data.kind) } },
            },
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return "sent" as const;
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) cachedToken = null;
        return isUnregistered(res.status, body) ? ("gone" as const) : ("failed" as const);
      } catch {
        return "failed" as const;
      }
    }),
  );
  return {
    sent: results.filter((r) => r === "sent").length,
    unregistered: tokens.filter((_, i) => results[i] === "gone"),
  };
}
