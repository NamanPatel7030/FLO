import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { ArrowUp, Globe, Mic, Sparkles, Telescope, Zap } from "lucide-react";
import { api, on } from "../../lib/api";
import { relativeTime } from "../../lib/format";
import { EV, type AssistantMode, type AssistantResponse } from "../../lib/types";
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

export default function Assistant() {
  const geo = useStore((s) => s.geo);
  const settings = useStore((s) => s.settings);
  const toast = useStore((s) => s.toast);
  const focusId = useStore((s) => s.pageArg);
  const [items, setItems] = useState<AssistantResponse[]>([]);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<AssistantMode>("quick");
  const [busy, setBusy] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const add = (r: AssistantResponse) => setItems((xs) => (xs.some((x) => x.id === r.id) ? xs : [...xs, r]));

  useEffect(() => {
    api.listAssistant().then((r) => setItems([...r].reverse()));
    return on<AssistantResponse>(EV.assistant, add);
  }, []);

  // "Open full answer" from the notch → scroll to that answer and highlight it
  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(`answer-${focusId}`);
    if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focusId, items.length]);

  useEffect(() => {
    if (!focusId) bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [items.length, busy, focusId]);

  const run = async (label: string, f: () => Promise<AssistantResponse>) => {
    if (busy) return;
    setBusy(label);
    try {
      add(await f());
    } catch (e) {
      toast({ kind: "error", text: String(e) });
    } finally {
      setBusy(null);
    }
  };
  const ask = (q: string) => {
    if (!q.trim()) return;
    setText("");
    run(mode === "web" ? "Searching the web…" : mode === "deep" ? "Reading your screen…" : "Thinking…", () => api.askAssistant(q.trim(), mode));
  };
  const followup = (r: AssistantResponse, m: "deep" | "web") => run(m === "web" ? "Searching the web…" : "Going deeper…", () => api.assistantFollowup(r.id, m));

  return (
    <div className="flex h-[calc(100vh-80px)] flex-col">
      <PageHeader title="Assistant" subtitle="Run all your projects by voice. Flo sees your projects, to-dos and notes, and acts on them." />
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {items.length === 0 && !busy && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Logo size={64} />
            <div className="text-[16px] font-semibold">Ask Flo anything</div>
            <div className="text-[13px] text-muted">
              Hold <Kbd>{assistantHotkeyLabel(geo, settings)}</Kbd> and speak, or type below.
            </div>
          </div>
        )}
        <div className="flex flex-col gap-5">
          <AnimatePresence initial={false}>
            {items.map((r) => (
              <motion.div key={r.id} id={`answer-${r.id}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex scroll-mt-4 flex-col gap-2" data-testid="answer">
                <div className="selectable self-end rounded-2xl rounded-br-md bg-brand-500/20 px-4 py-2.5 text-[13.5px]">{r.query}</div>
                <div className="flex gap-3">
                  <span className="accent-gradient mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
                    <Sparkles size={13} className="text-white" />
                  </span>
                  <Card className={clsx("max-w-[80%] rounded-tl-md px-4 py-3", focusId === r.id && "ring-1 ring-brand-400/60")}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <ModeBadge mode={r.mode ?? "quick"} />
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
            <div className="flex items-center gap-3">
              <span className="accent-gradient flex h-7 w-7 items-center justify-center rounded-full">
                <Sparkles size={13} className="text-white" />
              </span>
              <span className="accent-text animate-pulse text-[13.5px] font-medium">{busy}</span>
            </div>
          )}
          <div ref={bottom} />
        </div>
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
  );
}
