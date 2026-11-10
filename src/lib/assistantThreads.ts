// Assistant page: ordering, threads and scroll logic (pure; unit-tested in assistantThreads.test.ts).
import { parseTime } from "./format";
import type { AssistantResponse, AssistantThread } from "./types";

/** What the conversation pane shows: one thread, every exchange, or an empty new thread. */
export type ThreadView = { kind: "thread"; id: string } | { kind: "all" } | { kind: "new" };

/** Merge pages / live events into one list, oldest first (the latest at the bottom), deduped by id. */
export function mergeExchanges(existing: AssistantResponse[], incoming: AssistantResponse[]): AssistantResponse[] {
  const byId = new Map<string, AssistantResponse>();
  for (const r of existing) byId.set(r.id, r);
  for (const r of incoming) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => parseTime(a.createdAt) - parseTime(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Does this view show the exchange? */
export function shows(view: ThreadView, r: AssistantResponse): boolean {
  if (view.kind === "all") return true;
  if (view.kind === "new") return false;
  return r.threadId === view.id;
}

/**
 * The view after an answer arrives. Someone reading the latest thread follows the conversation
 * into a new thread (e.g. a notch ask after a break); an older thread they picked, or All, stays.
 * A pending New thread becomes the thread of the answer to the question typed there (`mine`).
 */
export function followThread(view: ThreadView, latestThreadId: string | undefined, r: AssistantResponse, mine = false): ThreadView {
  if (!r.threadId) return view;
  if (view.kind === "new") return mine ? { kind: "thread", id: r.threadId } : view;
  if (view.kind === "thread" && (view.id === latestThreadId || mine)) return { kind: "thread", id: r.threadId };
  return view;
}

/** The thread list after an answer: its thread moves to the top (counted once per exchange). */
export function upsertThread(threads: AssistantThread[], r: AssistantResponse, alreadyCounted: boolean): AssistantThread[] {
  if (!r.threadId) return threads;
  const cur = threads.find((t) => t.id === r.threadId);
  const next: AssistantThread = cur
    ? { ...cur, updatedAt: parseTime(r.createdAt) > parseTime(cur.updatedAt) ? r.createdAt : cur.updatedAt, count: cur.count + (alreadyCounted ? 0 : 1) }
    : { id: r.threadId, title: r.query, createdAt: r.createdAt, updatedAt: r.createdAt, count: 1 };
  return [next, ...threads.filter((t) => t.id !== r.threadId)].sort((a, b) => parseTime(b.updatedAt) - parseTime(a.updatedAt));
}

const SOURCES: Record<string, string> = { notch: "Notch", typed: "Typed", phone: "Phone", agent: "Flo Agent", skill: "Skill" };

/** Human label for where a request came from (null for old exchanges logged before sources). */
export function sourceLabel(source: string | undefined | null): string | null {
  return (source && SOURCES[source]) || null;
}

/** The scroller is (close to) at the bottom, so new answers can scroll it down. */
export function isNearBottom(el: { scrollTop: number; scrollHeight: number; clientHeight: number }, threshold = 80): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}
