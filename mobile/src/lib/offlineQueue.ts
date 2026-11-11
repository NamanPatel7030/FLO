// Questions, to-dos and notes said while the phone is offline (or Flo's server can't be reached):
// kept on the phone and sent when it's back online, then their answers are picked up on the next
// look. Pure and unit-tested; state/Offline.tsx persists it and runs the flush.
import type { AskMode } from '../api/types';

export type QueueStatus = 'queued' | 'waiting' | 'answered' | 'failed';

export interface QueuedAsk {
  id: string;
  mode: AskMode;
  text: string;
  /** ms since epoch, when it was said */
  createdAt: number;
  status: QueueStatus;
  /** 'app': said in Flo's Ask screen. 'bubble': said to the voice bubble, taken over by the app. */
  source: 'app' | 'bubble';
  attempts: number;
  /** the server's request id once sent */
  requestId?: string;
  answer?: string;
  answeredBy?: 'computer' | 'cloud';
  /** when it got its answer (or gave up) */
  doneAt?: number;
  error?: string;
}

export const QUEUE_KEY = 'flo.askQueue.v1';
export const MAX_ITEMS = 25;
export const MAX_ATTEMPTS = 5;
const KEEP_DONE_MS = 7 * 24 * 3600_000;
/** the same words twice within this window are one question (a double tap on Send) */
const DEDUPE_MS = 10_000;
/** an answer that never comes: stop looking after a day */
const GIVE_UP_MS = 24 * 3600_000;

const open = (q: QueuedAsk) => q.status === 'queued' || q.status === 'waiting';

export function parseQueue(raw: string | null): QueuedAsk[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter(
      (x): x is QueuedAsk =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as QueuedAsk).id === 'string' &&
        typeof (x as QueuedAsk).text === 'string' &&
        typeof (x as QueuedAsk).createdAt === 'number' &&
        ['queued', 'waiting', 'answered', 'failed'].includes((x as QueuedAsk).status),
    );
  } catch {
    return [];
  }
}

let seq = 0;
export const newId = (now: number) => `q${now.toString(36)}${(seq++).toString(36)}`;

/** Add something to send later. Newest last. Over the cap, the oldest finished items go first. */
export function enqueue(
  q: QueuedAsk[],
  item: { mode: AskMode; text: string; source?: QueuedAsk['source']; createdAt?: number; id?: string },
  now: number,
): QueuedAsk[] {
  const text = item.text.trim();
  if (!text) return q;
  const dupe = q.some((x) => open(x) && x.mode === item.mode && x.text === text && now - x.createdAt < DEDUPE_MS);
  if (dupe) return q;
  const next = [...q, { id: item.id ?? newId(now), mode: item.mode, text, createdAt: item.createdAt ?? now, status: 'queued' as const, source: item.source ?? 'app', attempts: 0 }];
  while (next.length > MAX_ITEMS) {
    const i = next.findIndex((x) => !open(x));
    next.splice(i >= 0 ? i : 0, 1);
  }
  return next;
}

/** The next item to send, oldest first. */
export const nextToSend = (q: QueuedAsk[]) => q.find((x) => x.status === 'queued');
/** Sent, still waiting for the computer (or the cloud) to answer. */
export const awaiting = (q: QueuedAsk[]) => q.filter((x) => x.status === 'waiting' && !!x.requestId);
export const pendingCount = (q: QueuedAsk[]) => q.filter(open).length;

const patch = (q: QueuedAsk[], id: string, p: Partial<QueuedAsk>) => q.map((x) => (x.id === id ? { ...x, ...p } : x));

export const markSent = (q: QueuedAsk[], id: string, requestId: string) => patch(q, id, { status: 'waiting', requestId, error: undefined });

export const markAnswered = (q: QueuedAsk[], id: string, answer: string, answeredBy: QueuedAsk['answeredBy'], now: number) =>
  patch(q, id, { status: 'answered', answer, answeredBy, doneAt: now, error: undefined });

/**
 * Sending failed. [retry] (no connection) puts it back in line until [MAX_ATTEMPTS]; otherwise (the
 * server said no) it's failed for good with the server's words.
 */
export function markFailed(q: QueuedAsk[], id: string, error: string, retry: boolean, now: number): QueuedAsk[] {
  const x = q.find((i) => i.id === id);
  if (!x) return q;
  const attempts = x.attempts + 1;
  if (retry && attempts < MAX_ATTEMPTS) return patch(q, id, { status: 'queued', attempts, error });
  return patch(q, id, { status: 'failed', attempts, error, doneAt: now });
}

/** Drop finished items after a week, and stop waiting on answers that never came. */
export function prune(q: QueuedAsk[], now: number): QueuedAsk[] {
  return q
    .map((x) => (x.status === 'waiting' && now - x.createdAt > GIVE_UP_MS ? { ...x, status: 'failed' as const, error: 'No answer came back.', doneAt: now } : x))
    .filter((x) => open(x) || now - (x.doneAt ?? x.createdAt) < KEEP_DONE_MS);
}

export const remove = (q: QueuedAsk[], id: string) => q.filter((x) => x.id !== id);
export const clearDone = (q: QueuedAsk[]) => q.filter(open);

/** What the phone says the moment something is saved for later. */
export function savedMessage(mode: AskMode): string {
  if (mode === 'ask') return "You're offline. Saved: Flo will answer when you're back online.";
  if (mode === 'todo') return "You're offline. Saved: Flo will add the to-do when you're back online.";
  return "You're offline. Saved: Flo will save the note when you're back online.";
}

/** A line for the item in the list. */
export function statusLine(x: QueuedAsk): string {
  switch (x.status) {
    case 'queued':
      return x.attempts ? 'Waiting for a connection (will retry)' : 'Will send when you are back online';
    case 'waiting':
      return 'Sent. Waiting for the answer';
    case 'answered':
      return x.answeredBy === 'cloud' ? 'Answered in the cloud' : x.mode === 'ask' ? 'Answered by your computer' : 'Done';
    case 'failed':
      return x.error || "Couldn't send this";
  }
}

/** A bubble question already on the server whose answer came too late for the bubble: watch for it. */
export function adoptLate(q: QueuedAsk[], late: { requestId: string; text: string; createdAt: number }): QueuedAsk[] {
  if (!late.requestId || q.some((x) => x.requestId === late.requestId)) return q;
  return [...q, { id: `late-${late.requestId}`, mode: 'ask', text: late.text, createdAt: late.createdAt, status: 'waiting', source: 'bubble', attempts: 0, requestId: late.requestId }];
}

/** FloBubble.takeLate() JSON. */
export function parseLate(raw: string | null | undefined): { requestId: string; text: string; createdAt: number }[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter((x) => x && typeof x.requestId === 'string' && x.requestId && typeof x.text === 'string')
      .map((x) => ({ requestId: x.requestId as string, text: x.text as string, createdAt: typeof x.at === 'number' ? x.at : Date.now() }));
  } catch {
    return [];
  }
}

/** Items the bubble kept natively (FloBubble.takeQueued()), as queue items. */
export function fromNative(raw: string | null | undefined): { text: string; createdAt: number; id: string }[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter((x) => x && typeof x.text === 'string' && x.text.trim())
      .map((x) => ({ text: String(x.text), createdAt: typeof x.at === 'number' ? x.at : Date.now(), id: typeof x.id === 'string' ? `b-${x.id}` : newId(Date.now()) }));
  } catch {
    return [];
  }
}
