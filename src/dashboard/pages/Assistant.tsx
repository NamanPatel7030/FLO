import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Mic, Sparkles } from "lucide-react";
import { api, on } from "../../lib/api";
import { relativeTime } from "../../lib/format";
import { EV, type AssistantResponse } from "../../lib/types";
import { assistantHotkeyLabel, useStore } from "../store";
import { Card, Kbd, PageHeader } from "../ui";
import { Logo } from "../Logo";

const HINTS = [
  "Add a to-do to Apollo: send the deck by Friday",
  "What's blocked across my projects?",
  "Start meeting notes for Design sync",
  "Create a project called Zephyr for the mobile app",
  "Mark the invoice reply as done",
  "Summarize what I did today",
];

export default function Assistant() {
  const geo = useStore((s) => s.geo);
  const settings = useStore((s) => s.settings);
  const toast = useStore((s) => s.toast);
  const [items, setItems] = useState<AssistantResponse[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listAssistant().then((r) => setItems([...r].reverse()));
    return on<AssistantResponse>(EV.assistant, (r) => setItems((xs) => (xs.some((x) => x.id === r.id) ? xs : [...xs, r])));
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [items.length, busy]);

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    setText("");
    setBusy(true);
    try {
      const r = await api.askAssistant(q.trim());
      setItems((xs) => (xs.some((x) => x.id === r.id) ? xs : [...xs, r]));
    } catch (e) {
      toast({ kind: "error", text: String(e) });
    } finally {
      setBusy(false);
    }
  };

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
              <motion.div key={r.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-2">
                <div className="self-end rounded-2xl rounded-br-md bg-brand-500/20 px-4 py-2.5 text-[13.5px] selectable">{r.query}</div>
                <div className="flex gap-3">
                  <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full accent-gradient">
                    <Sparkles size={13} className="text-white" />
                  </span>
                  <Card className="max-w-[80%] rounded-tl-md px-4 py-3">
                    <p className="text-[13.5px] leading-relaxed selectable">{r.reply}</p>
                    {r.results.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {r.results.map((x, i) => (
                          <span key={i} className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[11.5px] text-emerald-600 dark:text-emerald-300">
                            {x}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 text-[11px] text-faint">{relativeTime(r.createdAt)}</div>
                  </Card>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {busy && (
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full accent-gradient">
                <Sparkles size={13} className="text-white" />
              </span>
              <span className="accent-text animate-pulse text-[13.5px] font-medium">Thinking…</span>
            </div>
          )}
          <div ref={bottom} />
        </div>
      </div>

      <div className="pt-4">
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {HINTS.map((h) => (
            <button key={h} onClick={() => ask(h)} className="rounded-full glass px-3 py-1 text-[12px] text-muted transition hover:text-[var(--fg)]">
              “{h}”
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(text);
          }}
          className="glass-strong flex items-center gap-2 rounded-2xl p-1.5 pl-4"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ask or tell Flo to do something…"
            className="h-9 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--fg-faint)]"
          />
          <button type="button" onClick={() => api.startSession("assistant")} className="flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:bg-[var(--glass)]" title="Speak">
            <Mic size={16} />
          </button>
          <button type="submit" disabled={!text.trim() || busy} className="flex h-9 w-9 items-center justify-center rounded-xl accent-gradient text-[#001522] font-semibold disabled:opacity-40" title="Send">
            <ArrowUp size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
