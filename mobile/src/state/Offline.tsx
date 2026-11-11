// Offline: is the phone online, and what's waiting to be sent.
//
// - Questions, to-dos and notes said in Flo while offline are kept on the phone (AsyncStorage) and
//   sent when the phone is back online; their answers are picked up on the next look.
// - Questions the voice bubble kept: the bubble service sends them itself the moment the phone is
//   online again (and shows the answer as a notification). If the service is off, the app takes
//   them over here. Bubble questions whose answer came too late are watched here too.
// - Everything runs only while Flo is open (no background work), like the rest of the app.
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { ApiError, describeError } from '../api/client';
import { mockOffline } from '../api/mock';
import type { AskMode } from '../api/types';
import { bubble, type BubbleHistoryItem } from '../lib/bubble';
import {
  QUEUE_KEY,
  adoptLate,
  awaiting,
  clearDone as clearDoneQ,
  enqueue,
  fromNative,
  markAnswered,
  markFailed,
  markSent,
  nextToSend,
  parseLate,
  parseQueue,
  pendingCount,
  prune,
  remove as removeQ,
  savedMessage,
  type QueuedAsk,
} from '../lib/offlineQueue';
import { useFlo } from './FloContext';

interface OfflineCtx {
  /** false when the phone has no connection (or Flo's server can't be reached) */
  online: boolean;
  queue: QueuedAsk[];
  /** kept or sent, still waiting */
  pending: number;
  /** keep something said offline; returns what to tell the user */
  keep(mode: AskMode, text: string): string;
  flush(): Promise<void>;
  remove(id: string): void;
  clearDone(): void;
  /** the bubble's Recent list */
  history: BubbleHistoryItem[];
  refreshHistory(): void;
  clearHistory(): void;
}

const C = createContext<OfflineCtx | null>(null);

export function useOffline(): OfflineCtx {
  const v = useContext(C);
  if (!v) throw new Error('useOffline outside OfflineProvider');
  return v;
}

const RECHECK_MS = 30_000;

function mockQueue(): QueuedAsk[] {
  const now = Date.now();
  return [
    { id: 'm1', mode: 'ask', text: "What's on my calendar after lunch?", createdAt: now - 4 * 60_000, status: 'queued', source: 'app', attempts: 0 },
    { id: 'm2', mode: 'todo', text: 'Book the train tickets for Saturday', createdAt: now - 11 * 60_000, status: 'queued', source: 'bubble', attempts: 0 },
  ];
}

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const flo = useFlo();
  const api = flo.api;
  const [queue, setQueue] = useState<QueuedAsk[]>(() => (flo.mock && mockOffline() ? mockQueue() : []));
  const [nativeOnline, setNativeOnline] = useState<boolean | null>(() => bubble.isOnline());
  const [history, setHistory] = useState<BubbleHistoryItem[]>(() => bubble.history());
  const ref = useRef(queue);
  ref.current = queue;
  const flushing = useRef(false);

  const online = !flo.offline && nativeOnline !== false && !(flo.mock && mockOffline());

  const save = useCallback(
    (q: QueuedAsk[]) => {
      ref.current = q;
      setQueue(q);
      if (!flo.mock) void AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q)).catch(() => undefined);
    },
    [flo.mock],
  );

  useEffect(() => {
    if (flo.mock) return;
    void AsyncStorage.getItem(QUEUE_KEY)
      .then((raw) => {
        const q = prune(parseQueue(raw), Date.now());
        ref.current = q;
        setQueue(q);
      })
      .catch(() => undefined);
  }, [flo.mock]);

  const keep = useCallback(
    (mode: AskMode, text: string) => {
      save(enqueue(ref.current, { mode, text }, Date.now()));
      return savedMessage(mode);
    },
    [save],
  );

  const flush = useCallback(async () => {
    if (!api || flo.mock || flushing.current) return;
    flushing.current = true;
    try {
      let q = ref.current;
      const now = Date.now();
      // the bubble's kept questions: the service sends them itself while it's on
      if (!bubble.serviceOn()) {
        for (const b of fromNative(bubble.takeQueued())) q = enqueue(q, { mode: 'ask', text: b.text, source: 'bubble', createdAt: b.createdAt, id: b.id }, now);
      }
      for (const l of parseLate(bubble.takeLate())) q = adoptLate(q, l);
      if (q !== ref.current) save(q);

      // send what's waiting, oldest first; stop at the first lost connection
      for (let x = nextToSend(q); x; x = nextToSend(q)) {
        try {
          const r = await api.ask(x.mode, x.text);
          q = r.status === 'done' && r.answer ? markAnswered(markSent(q, x.id, r.id), x.id, r.answer, r.answeredBy ?? 'computer', Date.now()) : markSent(q, x.id, r.id);
        } catch (e) {
          const lost = e instanceof ApiError && e.status === 0;
          q = markFailed(q, x.id, describeError(e), lost, Date.now());
          save(q);
          if (lost) return;
        }
        save(q);
      }

      // pick up answers
      for (const w of awaiting(q)) {
        try {
          const a = await api.getAsk(w.requestId!);
          if (a.status === 'done') q = markAnswered(q, w.id, a.answer || a.hint || 'Done.', a.answeredBy ?? 'computer', Date.now());
          else if (a.status === 'failed') q = markFailed(q, w.id, a.answer || "Your computer couldn't do that.", false, Date.now());
          else if (a.queued) q = markAnswered(q, w.id, a.hint ?? 'Saved. Your computer will add it when it is back online.', 'computer', Date.now());
        } catch (e) {
          if (e instanceof ApiError && e.status === 0) break;
          if (e instanceof ApiError && e.status === 404) q = markFailed(q, w.id, 'Flo no longer has this question.', false, Date.now());
        }
      }
      save(prune(q, Date.now()));
    } finally {
      flushing.current = false;
    }
  }, [api, flo.mock, save]);

  const refreshHistory = useCallback(() => setHistory(bubble.history()), []);

  // back online, or Flo opened: send what's waiting and look for answers
  useEffect(() => {
    if (online) void flush();
  }, [online, flush]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      setNativeOnline(bubble.isOnline());
      refreshHistory();
      void flush();
    });
    return () => sub.remove();
  }, [flush, refreshHistory]);

  // while something waits, look again now and then (only while Flo is open)
  const waiting = pendingCount(queue) > 0;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      setNativeOnline(bubble.isOnline());
      void flush();
    }, RECHECK_MS);
    return () => clearInterval(t);
  }, [waiting, flush]);

  const value = useMemo<OfflineCtx>(
    () => ({
      online,
      queue,
      pending: pendingCount(queue),
      keep,
      flush,
      remove: (id) => save(removeQ(ref.current, id)),
      clearDone: () => save(clearDoneQ(ref.current)),
      history,
      refreshHistory,
      clearHistory: () => {
        bubble.clearHistory();
        setHistory([]);
      },
    }),
    [online, queue, keep, flush, save, history, refreshHistory],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}
