// Inbox normalisation, merge and dedupe.
import type { InboxItem } from '../api/types';

export const INBOX_LIMIT = 100;

function toMillis(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Validate/normalise one raw server item; returns null if unusable. */
export function normalizeItem(raw: unknown): InboxItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = r.id;
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  if (String(id).length === 0) return null;
  const createdAt =
    typeof r.createdAt === 'string'
      ? r.createdAt
      : typeof r.createdAt === 'number'
        ? new Date(r.createdAt).toISOString()
        : new Date(0).toISOString();
  return {
    id: String(id),
    kind: typeof r.kind === 'string' ? r.kind : 'unknown',
    title: typeof r.title === 'string' ? r.title : '',
    body: typeof r.body === 'string' ? r.body : '',
    data: r.data && typeof r.data === 'object' ? (r.data as Record<string, unknown>) : null,
    createdAt,
  };
}

/** Newest first; ties broken by id (numeric when both are numbers) so order is stable. */
export function compareItems(a: InboxItem, b: InboxItem): number {
  const dt = toMillis(b.createdAt) - toMillis(a.createdAt);
  if (dt !== 0) return dt;
  const na = Number(a.id);
  const nb = Number(b.id);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return nb - na;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Merge freshly fetched items into the existing inbox.
 * Deduplicates by id (incoming wins, since the server is the source of truth),
 * sorts newest first and caps at `limit` (server keeps last 100 per user).
 */
export function mergeInbox(existing: InboxItem[], incoming: unknown[], limit = INBOX_LIMIT): InboxItem[] {
  const byId = new Map<string, InboxItem>();
  for (const item of existing) byId.set(item.id, item);
  for (const raw of incoming) {
    const item = normalizeItem(raw);
    if (item) byId.set(item.id, item);
  }
  return [...byId.values()].sort(compareItems).slice(0, limit);
}

/** The id to pass as `?after=` for incremental fetches (newest item), or undefined. */
export function latestId(items: InboxItem[]): string | undefined {
  if (items.length === 0) return undefined;
  return [...items].sort(compareItems)[0].id;
}

/** Ids present in `next` but not in `prev` (used to decide what is "new"). */
export function newIds(prev: InboxItem[], next: InboxItem[]): string[] {
  const seen = new Set(prev.map((i) => i.id));
  return next.filter((i) => !seen.has(i.id)).map((i) => i.id);
}
