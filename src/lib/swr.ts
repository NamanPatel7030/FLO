// Stale-while-revalidate for dashboard data: a page shows the last result it had instantly, then
// refreshes in the background. Entries live in memory only (never localStorage: the data is
// encrypted at rest in Flo's database and shouldn't be copied out in plain text), so the cache
// lasts while the dashboard window is open. Backend change events invalidate the matching keys,
// so nothing stale is shown after a change.
import { useEffect, useRef, useState } from "react";
import { on } from "./api";
import { EV } from "./types";

type Entry = { value: unknown; at: number; used: number };

export class SwrCache {
  private map = new Map<string, Entry>();
  constructor(
    private cap = 40,
    private now: () => number = () => Date.now(),
  ) {}

  get<T>(key: string): { value: T; age: number } | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    e.used = this.now();
    return { value: e.value as T, age: this.now() - e.at };
  }

  set(key: string, value: unknown) {
    if (!this.map.has(key) && this.map.size >= this.cap) {
      let oldest: string | undefined;
      let t = Infinity;
      for (const [k, e] of this.map) if (e.used < t) [t, oldest] = [e.used, k];
      if (oldest !== undefined) this.map.delete(oldest);
    }
    const n = this.now();
    this.map.set(key, { value, at: n, used: n });
  }

  /** drop every key that starts with `prefix` ("" = everything) */
  invalidate(prefix = "") {
    for (const k of [...this.map.keys()]) if (k.startsWith(prefix)) this.map.delete(k);
  }

  get size() {
    return this.map.size;
  }
}

export const swr = new SwrCache();

/** Calls `fn` with the newest value; `subscribe` wires backend events (returns an unsubscribe). */
type Subscribe = (refresh: () => void) => () => void;

/**
 * `useSwr("analytics:30", () => api.getAnalytics(30), { maxAgeMs: 30_000, subscribe })`
 * returns the cached value immediately (or null on the very first load), refetches when the
 * entry is older than `maxAgeMs` (default 0 = always refresh in the background) and whenever
 * `subscribe` reports a change. `key = null` disables the hook.
 */
export function useSwr<T>(key: string | null, fetcher: () => Promise<T>, opts: { maxAgeMs?: number; subscribe?: Subscribe; cache?: SwrCache } = {}): T | null {
  const cache = opts.cache ?? swr;
  const [value, setValue] = useState<T | null>(() => (key ? (cache.get<T>(key)?.value ?? null) : null));
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const maxAge = opts.maxAgeMs ?? 0;
  const subscribe = opts.subscribe;
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const hit = cache.get<T>(key);
    setValue(hit ? hit.value : null);
    const refresh = () =>
      fetchRef
        .current()
        .then((v) => {
          cache.set(key, v);
          if (alive) setValue(v);
        })
        .catch(() => {});
    if (!hit || hit.age >= maxAge) refresh();
    const off = subscribe?.(() => {
      cache.invalidate(key);
      refresh();
    });
    return () => {
      alive = false;
      off?.();
    };
    // `subscribe` is expected to be stable (defined at module level)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, maxAge]);
  return value;
}

// ── backend events that change cached data ─────────────────────────────────

/** a new dictation landed (history, words, time saved) */
export const onNewDictation: Subscribe = (refresh) => on(EV.transcript, (t: { final?: boolean }) => t?.final && setTimeout(refresh, 600));
/** analytics also count to-dos and meetings */
export const onStatsChange: Subscribe = (refresh) => {
  const offs = [onNewDictation(refresh), on(EV.todos, () => refresh()), on(EV.notes, () => refresh())];
  return () => offs.forEach((f) => f());
};
