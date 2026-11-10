// HTTP client for the Flo mobile API (docs/mobile-api.md).
import type { ActionKind, AskMode, AskRequest, AskStatus, ComputerSnapshot, InboxItem, PairClaimRequest, PairClaimResponse, PhoneAction, Presence, PresenceStatus } from './types';
import { parseAction, parseComputer } from '../lib/computer';
import { normalizeItem } from '../lib/inbox';
import { normalizeServerUrl } from '../lib/pairing';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
  /** The device token was revoked (unpaired from the Mac) or is invalid. */
  get isUnauthorized(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export interface FloApi {
  getPresence(): Promise<Presence>;
  setPresence(status: PresenceStatus): Promise<Presence>;
  updatePushToken(pushToken: string): Promise<void>;
  inbox(after?: string): Promise<InboxItem[]>;
  unpair(): Promise<void>;
  /** Queue a spoken request for the Mac (Ask Flo / Dictate). */
  ask(mode: AskMode, text: string): Promise<AskRequest>;
  getAsk(id: string): Promise<AskRequest>;
  /** What the computer last published: to-dos, Claude Code questions, settings. */
  getComputer(): Promise<ComputerSnapshot>;
  /** Ask the computer to do something with it (it applies it on its next poll). */
  sendAction(kind: ActionKind, target: string, value?: boolean | number | string): Promise<PhoneAction>;
}

const ASK_STATUSES: readonly AskStatus[] = ['pending', 'taken', 'done', 'failed'];

/** `{request: {...}}` from /api/mobile/ask → AskRequest (unit-tested). */
export function parseAsk(json: unknown): AskRequest {
  const r = (json && typeof json === 'object' ? (json as { request?: unknown }).request : null) as Record<string, unknown> | null;
  if (!r || (typeof r.id !== 'number' && typeof r.id !== 'string')) throw new ApiError('The server sent an unexpected reply.', 0);
  const mode = r.mode === 'todo' || r.mode === 'note' ? r.mode : 'ask';
  const status = ASK_STATUSES.includes(r.status as AskStatus) ? (r.status as AskStatus) : 'pending';
  const h = (json as { hint?: { text?: unknown } }).hint;
  const hint = h && typeof h.text === 'string' && h.text.trim() ? h.text.trim() : undefined;
  return {
    id: String(r.id),
    mode,
    text: typeof r.text === 'string' ? r.text : '',
    status,
    answer: typeof r.answer === 'string' ? r.answer : null,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    ...(hint ? { hint } : {}),
  };
}

/** Reached the network but the server isn't Flo / is down, versus no network at all. */
export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return "Couldn't reach Flo. Check your internet connection and try again.";
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

const DEFAULT_TIMEOUT_MS = 15000;

function joinUrl(server: string, path: string): string {
  return `${server.replace(/\/+$/, '')}${path}`;
}

async function request<T>(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit & { token?: string; timeoutMs?: number } = {},
): Promise<T> {
  const { token, timeoutMs = DEFAULT_TIMEOUT_MS, headers, ...rest } = init;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      ...rest,
      signal: controller?.signal,
      headers: {
        Accept: 'application/json',
        ...(rest.body != null ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(headers as Record<string, string> | undefined),
      },
    });
  } catch (e) {
    const aborted = (e as { name?: string })?.name === 'AbortError';
    throw new ApiError(aborted ? 'The server took too long to respond.' : "Couldn't reach your Flo server.", 0);
  } finally {
    if (timer) clearTimeout(timer);
  }

  const text = await res.text();
  let json: unknown = undefined;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  if (!res.ok) {
    const msg =
      (json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string'
        ? (json as { error: string }).error
        : undefined) ?? defaultMessage(res.status);
    throw new ApiError(msg, res.status);
  }
  return json as T;
}

function defaultMessage(status: number): string {
  if (status === 401 || status === 403) return 'This phone is no longer paired.';
  if (status === 404) return 'That code was not found — it may have expired.';
  if (status === 410) return 'That code has expired. Generate a new one on your computer.';
  if (status === 429) return 'Too many attempts. Wait a moment and try again.';
  return `Server error (${status}).`;
}

function parsePresence(json: unknown): Presence {
  const r = (json ?? {}) as Record<string, unknown>;
  const status: PresenceStatus = r.status === 'away' ? 'away' : 'active';
  const since = typeof r.since === 'string' ? r.since : typeof r.since === 'number' ? new Date(r.since).toISOString() : new Date().toISOString();
  return { status, since };
}

export function parseInboxResponse(json: unknown): InboxItem[] {
  const list = Array.isArray(json)
    ? json
    : json && typeof json === 'object' && Array.isArray((json as { items?: unknown }).items)
      ? (json as { items: unknown[] }).items
      : [];
  return list.map(normalizeItem).filter((i): i is InboxItem => i !== null);
}

/**
 * Step 2 of pairing: exchange the 6-digit code for a per-device token.
 * Unauthenticated. `server` must be an absolute base URL.
 */
export async function claimPairing(
  server: string,
  req: PairClaimRequest,
  fetchImpl: FetchLike = fetch,
): Promise<PairClaimResponse> {
  const base = normalizeServerUrl(server);
  if (!base) throw new ApiError('That server address is not valid.', 0);
  const body: PairClaimRequest = { code: req.code, deviceName: req.deviceName, platform: 'android' };
  if (req.pushToken) body.pushToken = req.pushToken;
  const json = await request<Record<string, unknown>>(fetchImpl, joinUrl(base, '/api/mobile/pair/claim'), {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const deviceToken = json?.deviceToken;
  if (typeof deviceToken !== 'string' || !deviceToken) {
    throw new ApiError('The server did not return a device token.', 500);
  }
  const user = (json.user ?? {}) as Record<string, unknown>;
  // Prefer the server's canonical URL when it gives a valid absolute one.
  const canonical = typeof json.server === 'string' ? normalizeServerUrl(json.server) : null;
  return {
    deviceToken,
    user: {
      name: typeof user.name === 'string' ? user.name : '',
      email: typeof user.email === 'string' ? user.email : '',
    },
    server: canonical && /^https?:\/\//.test(json.server as string) ? canonical : base,
  };
}

/** Authenticated client for a paired device. */
export function createHttpApi(server: string, deviceToken: string, fetchImpl: FetchLike = fetch): FloApi {
  const base = server.replace(/\/+$/, '');
  const call = <T>(path: string, init: RequestInit = {}) =>
    request<T>(fetchImpl, joinUrl(base, path), { ...init, token: deviceToken });

  return {
    async getPresence() {
      return parsePresence(await call('/api/presence'));
    },
    async setPresence(status) {
      return parsePresence(await call('/api/presence', { method: 'POST', body: JSON.stringify({ status }) }));
    },
    async updatePushToken(pushToken) {
      await call('/api/mobile/device', { method: 'POST', body: JSON.stringify({ pushToken }) });
    },
    async inbox(after) {
      const q = after ? `?after=${encodeURIComponent(after)}` : '';
      return parseInboxResponse(await call(`/api/mobile/inbox${q}`));
    },
    async unpair() {
      await call('/api/mobile/device', { method: 'DELETE' });
    },
    async ask(mode, text) {
      return parseAsk(await call('/api/mobile/ask', { method: 'POST', body: JSON.stringify({ mode, text }) }));
    },
    async getAsk(id) {
      return parseAsk(await call(`/api/mobile/ask/${encodeURIComponent(id)}`));
    },
    async getComputer() {
      return parseComputer(await call('/api/mobile/state'));
    },
    async sendAction(kind, target, value) {
      const body = value === undefined ? { kind, target } : { kind, target, value };
      return parseAction(await call('/api/mobile/actions', { method: 'POST', body: JSON.stringify(body) }));
    },
  };
}
