// Pure validation for the encrypted sync API (no imports, so node --test can run it directly).
// The server never sees plaintext: it checks shapes and sizes only.

export type SyncItemIn = { kind: string; id: string; rev: number; nonce: string; ct: string; deleted: boolean };

export const SYNC_LIMITS = {
  /** items per push request */
  maxItems: 500,
  /** one encrypted item (base64), ~1.5 MB of plaintext: long meeting transcripts fit */
  maxItemBytes: 2_000_000,
  /** one push request body */
  maxBodyBytes: 8_000_000,
  /** items per pull page */
  pageSize: 500,
} as const;

const KIND_RE = /^[a-z][a-z0-9_]{0,39}$/;
const B64_RE = /^[A-Za-z0-9+/=_-]*$/;

/** Validate a push body. Returns the cleaned items or an error message. */
export function parsePush(body: unknown): { items: SyncItemIn[] } | { error: string } {
  const raw = (body as { items?: unknown })?.items;
  if (!Array.isArray(raw)) return { error: "Expected { items: [...] }." };
  if (raw.length === 0) return { items: [] };
  if (raw.length > SYNC_LIMITS.maxItems) return { error: `At most ${SYNC_LIMITS.maxItems} items per request.` };
  const items: SyncItemIn[] = [];
  const seen = new Set<string>();
  for (const it of raw) {
    const o = it as Record<string, unknown>;
    const kind = o?.kind, id = o?.id, rev = o?.rev, nonce = o?.nonce ?? "", ct = o?.ct ?? "", deleted = o?.deleted === true;
    if (typeof kind !== "string" || !KIND_RE.test(kind)) return { error: "Invalid kind." };
    if (typeof id !== "string" || id.length < 1 || id.length > 200) return { error: "Invalid id." };
    if (typeof rev !== "number" || !Number.isSafeInteger(rev) || rev < 0) return { error: "Invalid rev." };
    if (typeof nonce !== "string" || typeof ct !== "string" || !B64_RE.test(nonce) || !B64_RE.test(ct)) return { error: "Invalid ciphertext." };
    if (ct.length > SYNC_LIMITS.maxItemBytes) return { error: "An item is too large." };
    if (!deleted && (!ct || !nonce)) return { error: "Missing ciphertext." };
    const key = `${kind}\u0000${id}`;
    if (seen.has(key)) return { error: "Duplicate item in one request." };
    seen.add(key);
    items.push({ kind, id, rev, nonce: deleted ? "" : nonce, ct: deleted ? "" : ct, deleted });
  }
  return { items };
}

/** Cursor for pull: a non-negative integer (the last seq the client saw). */
export function parseCursor(v: string | null): number | null {
  if (v === null || v === "") return 0;
  if (!/^\d{1,18}$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

/** The key check is a small opaque JSON blob produced by the app. */
export function validCheck(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= 2000;
}
