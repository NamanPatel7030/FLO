import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Globe, Mic, Plus, Search, Sparkles, Telescope, Zap } from "lucide-react";
import { api, on } from "../../lib/api";
import { relativeTime } from "../../lib/format";
import { EV, type AssistantMode, type AssistantResponse, type AssistantThread } from "../../lib/types";
import { followThread, isNearBottom, mergeExchanges, shows, sourceLabel, upsertThread, type ThreadView } from "../../lib/assistantThreads";
import { assistantHotkeyLabel, useStore } from "../store";
import { Card, Kbd, PageHeader } from "../ui";
import { Logo } from "../Logo";
import { Markdown } from "../Markdown";
import { openExternal } from "../Signature";

const HINTS = [
  "Add a to-do to Apollo: send the deck by Friday",
  "What's blocked across my projects?",
  "Start meeting notes for Design sync",
  "Create a project called Zephyr for the mobile app",
  "Summarize what I did today",
];

const MODES: { id: AssistantMode; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: "quick", label: "Quick", icon: <Zap size={13} />, hint: "Short answer from your projects, to-dos and notes" },
  { id: "deep", label: "Deep", icon: <Telescope size={13} />, hint: "Reads your screen and answers in detail" },
  { id: "web", label: "Web", icon: <Globe size={13} />, hint: "Searches the web and cites sources" },
];

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Local "favicon": a monogram tinted by the host (no network requests for icons). */
function SourceChip({ title, url }: { title: string; url: string }) {
  const host = hostOf(url);
  const hue = [...host].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <button
      onClick={() => openExternal(url)}
      title={title}
      className="flex max-w-[240px] items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--glass)] py-0.5 pl-0.5 pr-2.5 text-[11.5px] text-muted transition hover:text-[var(--fg)]"
      data-testid="source-chip"
    >
      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: `hsl(${hue} 55% 42%)` }} aria-hidden>
        {host[0]?.toUpperCase()}
      </span>
      <span className="truncate">{host}</span>
    </button>
  );
}

function ModeBadge({ mode }: { mode: AssistantMode }) {
  const m = MODES.find((x) => x.id === mode) ?? MODES[0];
  return (
    <span className="flex items-center gap-1 rounded-full bg-brand-300/12 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-300" data-testid="mode-badge">
      {m.icon}
      {m.label}
    </span>
  );
}

const PAGE = 30;

function SourceLabel({ source }: { source?: string }) {
  const label = sourceLabel(source);
  if (!label) return null;
  return (
    <span className="rounded-full border border-[var(--border)] px-1.5 py-px text-[10.5px] font-medium text-muted" data-testid="source-label">
      {label}
    </span>
  );
}

function ThreadList({
  threads,
  view,
  query,
  onQuery,
  onPick,
  onNew,
}: {
  threads: AssistantThread[];
  view: ThreadView | null;
  query: string;
  onQuery: (q: string) => void;
  onPick: (v: ThreadView) => void;
  onNew: () => void;
}) {
  const item = (active: boolean) =>
    clsx("w-full rounded-xl px-2.5 py-2 text-left transition", active ? "bg-brand-500/15 text-[var(--fg)]" : "text-muted hover:bg-[var(--glass)] hover:text-[var(--fg)]");
  return (
    <aside className="hidden w-[230px] shrink-0 flex-col gap-2 md:flex" aria-label="Threads">
      <button onClick={onNew} className="glass flex items-center justify-center gap-1.5 rounded-xl py-2 text-[12.5px] font-medium transition hover:bg-[var(--glass-hover)]">
        <Plus size={14} /> New thread
      </button>
      <label className="glass flex items-center gap-1.5 rounded-xl px-2.5">
        <Search size={13} className="shrink-0 text-faint" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          aria-label="Search threads"
          placeholder="Search threads"
          className="h-8 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-[var(--fg-faint)]"
        />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        <div className="flex flex-col gap-0.5">
          {view?.kind === "new" && (
            <div className={item(true)} data-testid="thread-item" aria-current="true">
              <div className="truncate text-[12.5px] font-medium">New thread</div>
              <div className="text-[11px] text-faint">Ask something to start it</div>
            </div>
          )}
          {threads.map((t) => {
            const active = view?.kind === "thread" && view.id === t.id;
            return (
              <button key={t.id} onClick={() => onPick({ kind: "thread", id: t.id })} className={item(active)} data-testid="thread-item" aria-current={active || undefined} title={t.title}>
                <div className="truncate text-[12.5px] font-medium">{t.title || "Untitled"}</div>
                <div className="text-[11px] text-faint">
                  {relativeTime(t.updatedAt)} · {t.count} {t.count === 1 ? "answer" : "answers"}
                </div>
              </button>
            );
          })}
          {threads.length === 0 && query.trim() && <div className="px-2.5 py-2 text-[12px] text-faint">No threads match.</div>}
          {threads.length > 0 && (
            <button onClick={() => onPick({ kind: "all" })} className={clsx(item(view?.kind === "all"), "mt-1 text-[12px]")}>
              All conversations
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

export default function Assistant() {
  const geo = useStore((s) => s.geo);
  const settings = useStore((s) => s.settings);
  const toast = useStore((s) => s.toast);
  const focusId = useStore((s) => s.pageArg);
  const [items, setItems] = useState<AssistantResponse[]>([]);
  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const [view, setView] = useState<ThreadView | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [query, setQuery] = useState("");
  const [text, setText] = useState("");
  const [mode, setMode] = useState<AssistantMode>("quick");
  const [busy, setBusy] = useState<{ label: string; question?: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // the subscription is registered once: it reads the latest state through these
  const viewRef = useRef<ThreadView | null>(null);
  const threadsRef = useRef<AssistantThread[]>([]);
  const seen = useRef(new Set<string>());
  const atBottom = useRef(true);
  /** a newer thread to move to when the user jumps down (they were reading older answers) */
  const pendingFollow = useRef<ThreadView | null>(null);
  /** what to do with the scroll position after the next render of `items` */
  const pendingScroll = useRef<{ kind: "bottom" } | { kind: "keep"; height: number; top: number } | null>(null);
  viewRef.current = view;
  threadsRef.current = threads;

  const loadView = useCallback(async (v: ThreadView) => {
    viewRef.current = v; // before the await: a fast reply must not look like a stale one
    pendingFollow.current = null;
    setView(v);
    setUnseen(0);
    if (v.kind === "new") {
      setItems([]);
      setHasMore(false);
      return;
    }
    const page = await api.listAssistantPage({ threadId: v.kind === "thread" ? v.id : undefined, limit: PAGE }).catch(() => [] as AssistantResponse[]);
    if (viewRef.current !== v) return; // switched again meanwhile
    page.forEach((r) => seen.current.add(r.id));
    pendingScroll.current = { kind: "bottom" };
    setItems(mergeExchanges([], page));
    setHasMore(page.length === PAGE);
  }, []);

  /** An answer arrived (live event, or the reply to something asked here: `mine`). */
  const receive = useCallback(
    (r: AssistantResponse, mine: boolean) => {
      const counted = seen.current.has(r.id);
      seen.current.add(r.id);
      const latest = threadsRef.current[0]?.id;
      setThreads((ts) => (query.trim() ? ts : upsertThread(ts, r, counted)));
      const cur = viewRef.current;
      if (!cur) return;
      const next = followThread(cur, latest, r, mine);
      if (next !== cur && !(next.kind === "thread" && cur.kind === "thread" && next.id === cur.id)) {
        if (!mine && !atBottom.current) {
          // reading older answers: don't pull the page away, offer the jump instead
          pendingFollow.current = next;
          if (!counted) setUnseen((n) => n + 1);
          return;
        }
        if (r.threadId === r.id) {
          // a thread that starts with this answer: nothing older to fetch
          viewRef.current = next;
          setView(next);
          setHasMore(false);
          setUnseen(0);
          pendingScroll.current = { kind: "bottom" };
          setItems([r]);
        } else {
          void loadView(next);
        }
        return;
      }
      if (!shows(cur, r)) return;
      const el = scroller.current;
      const stick = mine || !el || atBottom.current;
      if (stick) pendingScroll.current = { kind: "bottom" };
      else if (!counted) setUnseen((n) => n + 1);
      setItems((xs) => mergeExchanges(xs, [r]));
    },
    [loadView, query],
  );
  const receiveRef = useRef(receive);
  receiveRef.current = receive;

  // first load: threads, then the latest thread's newest page (the latest answer at the bottom)
  useEffect(() => {
    let alive = true;
    api
      .listAssistantThreads({ limit: 100 })
      .catch(() => [] as AssistantThread[])
      .then((ts) => {
        if (!alive) return;
        setThreads(ts);
        void loadView(ts[0] ? { kind: "thread", id: ts[0].id } : { kind: "all" });
      });
    const live = (r: AssistantResponse) => receiveRef.current(r, false);
    const offs = [on<AssistantResponse>(EV.assistant, live), on<AssistantResponse>(EV.assistantLog, live)];
    return () => {
      alive = false;
      offs.forEach((off) => off());
    };
  }, [loadView]);

  // search across threads
  useEffect(() => {
    const q = query.trim();
    const t = setTimeout(() => {
      api
        .listAssistantThreads({ limit: 100, query: q || undefined })
        .then(setThreads)
        .catch(() => {});
    }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [query]);

  // apply the pending scroll once the new items are on screen
  useLayoutEffect(() => {
    const el = scroller.current;
    const p = pendingScroll.current;
    if (!el || !p) return;
    pendingScroll.current = null;
    if (p.kind === "keep") {
      el.scrollTop = p.top + (el.scrollHeight - p.height);
    } else {
      // instant, not smooth: a smooth scroll still under way when the next answer lands would read
      // as "the user scrolled up" and stop following
      el.scrollTop = el.scrollHeight;
      atBottom.current = true;
      setUnseen(0);
    }
  }, [items, busy]);

  // "Open full answer" from the notch → scroll to that answer and highlight it
  useEffect(() => {
    if (!focusId || !view) return;
    const el = document.getElementById(`answer-${focusId}`);
    if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
    else if (view.kind === "thread" && items.length > 0) void loadView({ kind: "all" });
  }, [focusId, items.length, view, loadView]);

  const loadOlder = async () => {
    const v = viewRef.current;
    if (!v || v.kind === "new" || !hasMore || loadingOlder || !items[0]) return;
    setLoadingOlder(true);
    try {
      const page = await api.listAssistantPage({ threadId: v.kind === "thread" ? v.id : undefined, before: items[0].id, limit: PAGE });
      if (viewRef.current !== v) return;
      page.forEach((r) => seen.current.add(r.id));
      const el = scroller.current;
      if (el) pendingScroll.current = { kind: "keep", height: el.scrollHeight, top: el.scrollTop };
      setItems((xs) => mergeExchanges(xs, page));
      setHasMore(page.length === PAGE);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingOlder(false);
    }
  };

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = isNearBottom(el);
    if (atBottom.current && unseen && !pendingFollow.current) setUnseen(0);
    if (el.scrollTop < 120) void loadOlder();
  };

  const jumpToLatest = () => {
    if (pendingFollow.current) {
      void loadView(pendingFollow.current);
      return;
    }
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    atBottom.current = true;
    setUnseen(0);
  };

  const run = async (b: { label: string; question?: string }, f: () => Promise<AssistantResponse>) => {
    if (busy) return;
    pendingScroll.current = { kind: "bottom" };
    setBusy(b);
    try {
      receive(await f(), true);
    } catch (e) {
      toast({ kind: "error", text: String(e) });
    } finally {
      setBusy(null);
    }
  };
  const threadOpts = () => (view?.kind === "thread" ? { threadId: view.id } : view?.kind === "new" ? { newThread: true } : undefined);
  const ask = (q: string) => {
    if (!q.trim()) return;
    setText("");
    const label = mode === "web" ? "Searching the web…" : mode === "deep" ? "Reading your screen…" : "Thinking…";
    run({ label, question: q.trim() }, () => api.askAssistant(q.trim(), mode, threadOpts()));
  };
  const followup = (r: AssistantResponse, m: "deep" | "web") => run({ label: m === "web" ? "Searching the web…" : "Going deeper…" }, () => api.assistantFollowup(r.id, m));
  const newThread = () => {
    void loadView({ kind: "new" });
    input.current?.focus();
  };

  return (
    <div className="flex h-[calc(100vh-80px)] flex-col">
      <PageHeader title="Assistant" subtitle="Run all your projects by voice. Flo sees your projects, to-dos and notes, and acts on them." />
      <div className="flex min-h-0 flex-1 gap-4">
        <ThreadList threads={threads} view={view} query={query} onQuery={setQuery} onPick={(v) => void loadView(v)} onNew={newThread} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto pr-1" data-testid="assistant-scroller">
              {items.length === 0 && !busy && (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <Logo size={64} />
                  <div className="text-[16px] font-semibold">{view?.kind === "new" ? "New thread" : "Ask Flo anything"}</div>
                  <div className="text-[13px] text-muted">
                    Hold <Kbd>{assistantHotkeyLabel(geo, settings)}</Kbd> and speak, or type below.
                  </div>
                </div>
              )}
              {hasMore && (
                <div className="flex justify-center py-2">
                  <button onClick={() => void loadOlder()} disabled={loadingOlder} className="rounded-full px-3 py-1 text-[12px] text-muted hover:bg-[var(--glass)]">
                    {loadingOlder ? "Loading…" : "Load earlier"}
                  </button>
                </div>
              )}
              <div className="flex flex-col gap-5">
                <AnimatePresence initial={false}>
                  {items.map((r, i) => (
                    <motion.div key={r.id} id={`answer-${r.id}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex scroll-mt-4 flex-col gap-2" data-testid="answer">
                      {view?.kind === "all" && i > 0 && r.threadId !== items[i - 1].threadId && (
                        <div className="flex items-center gap-2 text-[11px] text-faint" data-testid="thread-divider">
                          <span className="h-px flex-1 bg-[var(--border)]" /> New thread · {relativeTime(r.createdAt)} <span className="h-px flex-1 bg-[var(--border)]" />
                        </div>
                      )}
                      <div className="selectable self-end rounded-2xl rounded-br-md bg-brand-500/20 px-4 py-2.5 text-[13.5px]">{r.query}</div>
                      <div className="flex gap-3">
                        <span className="accent-gradient mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
                          <Sparkles size={13} className="text-white" />
                        </span>
                        <Card className={clsx("max-w-[80%] rounded-tl-md px-4 py-3", focusId === r.id && "ring-1 ring-brand-400/60")}>
                          <div className="mb-1.5 flex items-center gap-2">
                            <ModeBadge mode={r.mode ?? "quick"} />
                            <SourceLabel source={r.source} />
                            <span className="text-[11px] text-faint">{relativeTime(r.createdAt)}</span>
                          </div>
                          <Markdown src={r.reply} />
                          {r.results.length > 0 && (
                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                              {r.results.map((x, i) => (
                                <span key={i} className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[11.5px] text-emerald-600 dark:text-emerald-300">
                                  {x}
                                </span>
                              ))}
                            </div>
                          )}
                          {!!r.sources?.length && (
                            <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Sources">
                              {r.sources.map((s) => (
                                <SourceChip key={s.url} {...s} />
                              ))}
                            </div>
                          )}
                          <div className="mt-3 flex gap-1.5 border-t border-[var(--border)] pt-2.5">
                            {r.mode !== "deep" && (
                              <button
                                disabled={!!busy}
                                onClick={() => followup(r, "deep")}
                                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] text-muted transition hover:bg-[var(--glass)] hover:text-[var(--fg)] disabled:opacity-40"
                              >
                                <Telescope size={13} /> Go deeper
                              </button>
                            )}
                            {r.mode !== "web" && (
                              <button
                                disabled={!!busy}
                                onClick={() => followup(r, "web")}
                                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] text-muted transition hover:bg-[var(--glass)] hover:text-[var(--fg)] disabled:opacity-40"
                              >
                                <Globe size={13} /> Search the web
                              </button>
                            )}
                          </div>
                        </Card>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {busy && (
                  <>
                    {busy.question && <div className="selectable self-end rounded-2xl rounded-br-md bg-brand-500/20 px-4 py-2.5 text-[13.5px]">{busy.question}</div>}
                    <div className="flex items-center gap-3">
                      <span className="accent-gradient flex h-7 w-7 items-center justify-center rounded-full">
                        <Sparkles size={13} className="text-white" />
                      </span>
                      <span className="accent-text animate-pulse text-[13.5px] font-medium">{busy.label}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
            {unseen > 0 && (
              <button
                onClick={jumpToLatest}
                className="accent-gradient absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-semibold text-[#001522] shadow-lg"
                data-testid="new-answer-pill"
              >
                <ArrowDown size={13} /> {unseen === 1 ? "New answer" : `${unseen} new answers`}
              </button>
            )}
          </div>

          <div className="pt-4">
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              {HINTS.map((h) => (
                <button key={h} onClick={() => ask(h)} className="glass rounded-full px-3 py-1 text-[12px] text-muted transition hover:text-[var(--fg)]">
                  "{h}"
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                ask(text);
              }}
              className="glass-strong flex items-center gap-2 rounded-2xl p-1.5 pl-1.5"
            >
              <div role="radiogroup" aria-label="Answer mode" className="flex shrink-0 rounded-xl bg-[var(--glass)] p-0.5">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={mode === m.id}
                    title={m.hint}
                    onClick={() => setMode(m.id)}
                    className={clsx(
                      "relative flex h-8 items-center gap-1 rounded-[10px] px-2.5 text-[12px] font-medium transition",
                      mode === m.id ? "text-[var(--fg)]" : "text-muted hover:text-[var(--fg)]",
                    )}
                  >
                    {mode === m.id && <motion.span layoutId="ask-mode" className="glass-strong absolute inset-0 rounded-[10px]" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                    <span className="relative flex items-center gap-1">
                      {m.icon}
                      {m.label}
                    </span>
                  </button>
                ))}
              </div>
              <input
                ref={input}
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-label="Ask Flo"
                placeholder={mode === "web" ? "Search the web..." : mode === "deep" ? "Ask about what's on your screen..." : "Ask or tell Flo to do something..."}
                className="h-9 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--fg-faint)]"
              />
              <button type="button" onClick={() => api.startSession("assistant")} className="flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:bg-[var(--glass)]" title="Speak">
                <Mic size={16} />
              </button>
              <button type="submit" disabled={!text.trim() || !!busy} className="accent-gradient flex h-9 w-9 items-center justify-center rounded-xl font-semibold text-[#001522] disabled:opacity-40" title="Send" aria-label="Send">
                <ArrowUp size={16} />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
