// Your computer's to-dos, Claude Code questions and settings, as the desktop app last published them.
//
// Polls only while the app is in the foreground (nothing runs in the background): every 20 s,
// every 10 s while a Claude Code session is working (so "api-server finished" shows promptly),
// every 5 s while a Claude Code question waits (they time out on the computer after 2 minutes),
// and every 2.5 s while one of the phone's own changes is on the way.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { ApiError, describeError } from '../api/client';
import type { ActionKind, ActionValue, ClaudeSessionView, ComputerState } from '../api/types';
import { finishedSince, finishedText, liveApprovals, needsYouCount as countNeedsYou, overlay, pendingKey, reconcile, type Pending } from '../lib/computer';
import { useFlo } from './FloContext';
import { loadComputerCache, saveComputerCache } from '../lib/storage';

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
  /** questions waiting for Allow / Deny or a choice right now */
  needsYouCount: number;
  /** what the computer said about the last reply to each session ("Sent to api-server."), shown briefly */
  sent: Record<string, { message: string; at: number }>;
  /** "api-server finished" when a session went from working to done since the last look */
  finished: string | null;
  /** phone clock, ticking while something is on the way (for "hasn't picked this up yet") */
  now: number;
  /** the phone's own changes still on the way (read-only; the settings screen shows their progress) */
  pending: readonly Pending[];
  refresh(): Promise<void>;
  act(kind: ActionKind, target: string, value?: ActionValue): Promise<void>;
  clearNotice(): void;
  clearFinished(): void;
}

const Ctx = createContext<ComputerCtx | null>(null);

export function useComputer(): ComputerCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useComputer outside ComputerProvider');
  return v;
}

const SLOW_MS = 20_000;
const WORKING_MS = 10_000;
const QUESTION_MS = 5_000;
const PENDING_MS = 2_500;
const SENT_SHOW_MS = 8_000;

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
  const [sent, setSent] = useState<Record<string, { message: string; at: number }>>({});
  const [finished, setFinished] = useState<string | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const sessionsRef = useRef<ClaudeSessionView[] | null>(null);

  const refresh = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const snap = await api.getComputer();
      setRaw(snap.state);
      setUpdatedAt(snap.updatedAt);
      // kept for offline: to-dos and computer settings still open without a connection
      if (!flo.mock && snap.state) void saveComputerCache({ state: snap.state, updatedAt: snap.updatedAt });
      const at = Date.now();
      const r = reconcile(pendingRef.current, snap, at);
      setPending(r.pending);
      if (r.failures.length) setNotice(r.failures[r.failures.length - 1]);
      if (r.confirmations.length) {
        setSent((cur) => {
          const next = { ...cur };
          for (const c of r.confirmations) next[c.key.slice('session:'.length)] = { message: c.message, at };
          return next;
        });
      }
      const sessions = snap.state?.sessions ?? [];
      if (sessionsRef.current) {
        const text = finishedText(finishedSince(sessionsRef.current, sessions));
        if (text) setFinished(text);
      }
      sessionsRef.current = sessions;
      setError(null);
    } catch (e) {
      // an unpaired phone is handled by the inbox poll (FloContext signs out)
      // no connection: keep showing the saved snapshot (the offline pill says why it's not fresh)
      if (e instanceof ApiError && e.status === 0) setError(null);
      else if (!(e instanceof ApiError && e.isUnauthorized)) setError(describeError(e));
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
    setSent({});
    setFinished(null);
    sessionsRef.current = null;
    if (!api || flo.mock) return;
    // show the last snapshot at once (and offline), until the first fresh one arrives
    let live = true;
    void loadComputerCache().then((c) => {
      if (!live || !c) return;
      setRaw((cur) => cur ?? c.state);
      setUpdatedAt((cur) => cur ?? c.updatedAt);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);

  const waitingQuestions = raw ? liveApprovals(raw, now).length + raw.sessions.filter((x) => x.question).length : 0;
  const working = raw ? raw.sessions.some((x) => x.state === 'working') : false;
  const every = pending.length ? PENDING_MS : waitingQuestions ? QUESTION_MS : working ? WORKING_MS : SLOW_MS;

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

  // keep "expires in", expired questions and "hasn't picked this up yet" current
  const ticking = waitingQuestions > 0 || pending.some((p) => p.key.startsWith('session:')) || Object.keys(sent).length > 0;
  useEffect(() => {
    if (!ticking || !active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking, active]);

  // confirmations ("Sent to api-server.") fade after a few seconds
  useEffect(() => {
    const stale = Object.entries(sent).filter(([, v]) => now - v.at > SENT_SHOW_MS);
    if (!stale.length) return;
    setSent((cur) => {
      const next = { ...cur };
      for (const [k] of stale) delete next[k];
      return next;
    });
  }, [now, sent]);

  const act = useCallback(
    async (kind: ActionKind, target: string, value?: ActionValue) => {
      if (!api) return;
      const key = pendingKey(kind, target);
      const p: Pending = { key, kind, target, value: value ?? null, createdAt: Date.now() };
      setPending((cur) => [...cur.filter((x) => x.key !== key), p]);
      setSent((cur) => {
        if (!(target in cur)) return cur;
        const next = { ...cur };
        delete next[target];
        return next;
      });
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
  const needsYouCount = state ? countNeedsYou(state, now) : 0;

  const value: ComputerCtx = {
    state,
    updatedAt,
    loading,
    loaded,
    error,
    notice,
    needsYouCount,
    pending,
    sent,
    finished,
    now,
    refresh,
    act,
    clearNotice: () => setNotice(null),
    clearFinished: () => setFinished(null),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
