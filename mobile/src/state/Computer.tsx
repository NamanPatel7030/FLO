// Your computer's to-dos, Claude Code questions and settings, as the desktop app last published them.
//
// Polls only while the app is in the foreground (nothing runs in the background): every 20 s,
// every 5 s while a Claude Code question waits (they time out on the computer after 2 minutes),
// and every 2.5 s while one of the phone's own changes is on the way.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { ApiError, describeError } from '../api/client';
import type { ActionKind, ComputerState } from '../api/types';
import { liveApprovals, overlay, pendingKey, reconcile, type Pending } from '../lib/computer';
import { useFlo } from './FloContext';

interface ComputerCtx {
  /** the snapshot with the phone's own changes on top (null until the computer has published) */
  state: ComputerState | null;
  updatedAt: string | null;
  loading: boolean;
  /** first load finished (so "nothing yet" can be told apart from "loading") */
  loaded: boolean;
  error: string | null;
  /** the latest failure message for one of the phone's actions */
  notice: string | null;
  /** questions waiting for Allow / Deny right now */
  needsYouCount: number;
  refresh(): Promise<void>;
  act(kind: ActionKind, target: string, value?: boolean | number | string): Promise<void>;
  clearNotice(): void;
}

const Ctx = createContext<ComputerCtx | null>(null);

export function useComputer(): ComputerCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useComputer outside ComputerProvider');
  return v;
}

const SLOW_MS = 20_000;
const QUESTION_MS = 5_000;
const PENDING_MS = 2_500;

export function ComputerProvider({ children }: { children: React.ReactNode }) {
  const flo = useFlo();
  const api = flo.api;
  const [raw, setRaw] = useState<ComputerState | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [active, setActive] = useState(AppState.currentState === 'active' || AppState.currentState == null);
  const [now, setNow] = useState(Date.now());
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const refresh = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const snap = await api.getComputer();
      setRaw(snap.state);
      setUpdatedAt(snap.updatedAt);
      const r = reconcile(pendingRef.current, snap, Date.now());
      setPending(r.pending);
      if (r.failures.length) setNotice(r.failures[r.failures.length - 1]);
      setError(null);
    } catch (e) {
      // an unpaired phone is handled by the inbox poll (FloContext signs out)
      if (!(e instanceof ApiError && e.isUnauthorized)) setError(describeError(e));
    } finally {
      setLoading(false);
      setLoaded(true);
      setNow(Date.now());
    }
  }, [api]);

  // signed out / switched account: forget everything
  useEffect(() => {
    setRaw(null);
    setUpdatedAt(null);
    setPending([]);
    setLoaded(false);
  }, [api]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);

  const waitingQuestions = raw ? liveApprovals(raw, now).length : 0;
  const every = pending.length ? PENDING_MS : waitingQuestions ? QUESTION_MS : SLOW_MS;

  // foreground-only polling
  useEffect(() => {
    if (!api || !active) return;
    void refresh();
    const t = setInterval(() => void refresh(), every);
    return () => clearInterval(t);
  }, [api, active, every, refresh]);

  // something new in the inbox (e.g. "Claude needs you"): look again right away
  const newest = flo.inbox[0]?.id;
  useEffect(() => {
    if (api && active && newest) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newest]);

  // keep "expires in" and expired questions current while a question waits
  useEffect(() => {
    if (!waitingQuestions || !active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waitingQuestions, active]);

  const act = useCallback(
    async (kind: ActionKind, target: string, value?: boolean | number | string) => {
      if (!api) return;
      const key = pendingKey(kind, target);
      const p: Pending = { key, kind, target, value: value ?? null, createdAt: Date.now() };
      setPending((cur) => [...cur.filter((x) => x.key !== key), p]);
      try {
        const a = await api.sendAction(kind, target, value);
        setPending((cur) => cur.map((x) => (x === p || (x.key === key && x.createdAt === p.createdAt) ? { ...x, actionId: a.id } : x)));
      } catch (e) {
        setPending((cur) => cur.filter((x) => x.createdAt !== p.createdAt || x.key !== key));
        setNotice(describeError(e));
      }
    },
    [api],
  );

  const state = useMemo(() => (raw ? overlay(raw, pending, now) : null), [raw, pending, now]);
  const needsYouCount = state ? liveApprovals(state, now).filter((a) => !a.sending).length : 0;

  const value: ComputerCtx = {
    state,
    updatedAt,
    loading,
    loaded,
    error,
    notice,
    needsYouCount,
    refresh,
    act,
    clearNotice: () => setNotice(null),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
