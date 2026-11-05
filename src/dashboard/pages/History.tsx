import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Check, Copy, History as HistoryIcon, Mic, Search, Sparkles } from "lucide-react";
import { api, on } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { groupByDay } from "../../lib/format";
import { EV, type Dictation } from "../../lib/types";
import { useStore } from "../store";
import { Card, Empty, Input, PageHeader, Skeleton } from "../ui";

type Filter = "all" | "dictation" | "assistant";

export default function History() {
  const toast = useStore((s) => s.toast);
  const [items, setItems] = useState<Dictation[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const load = () => api.listHistory(500).then(setItems);
    load();
    // refresh after each new dictation
    return on(EV.transcript, (t: { final: boolean }) => t.final && setTimeout(load, 600));
  }, []);

  const groups = useMemo(() => {
    if (!items) return null;
    const s = q.trim().toLowerCase();
    const list = items.filter(
      (d) =>
        (filter === "all" || (filter === "assistant" ? d.mode === "assistant" : d.mode !== "assistant")) &&
        (!s || d.finalText.toLowerCase().includes(s) || d.rawText.toLowerCase().includes(s) || d.app.toLowerCase().includes(s)),
    );
    return groupByDay(list);
  }, [items, q, filter]);

  const copy = async (d: Dictation) => {
    if (await copyText(d.finalText)) {
      setCopied(d.id);
      toast({ kind: "success", text: "Copied to clipboard" });
      setTimeout(() => setCopied((c) => (c === d.id ? null : c)), 1500);
    }
  };

  return (
    <div>
      <PageHeader title="History" subtitle="Everything you've said to Flo, stays on this device. Click any entry to copy it." />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input className="pl-9" placeholder="Search your words…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="glass flex rounded-xl p-1">
          {(["all", "dictation", "assistant"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx(
                "rounded-lg px-3 py-1.5 text-[12.5px] font-medium capitalize transition",
                filter === f ? "bg-brand-400/20 text-brand-200 shadow-[inset_0_0_0_1px_rgba(102,206,255,0.25)]" : "text-muted hover:text-[var(--fg)]",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {!groups ? (
        <Skeleton className="h-96" />
      ) : groups.length === 0 ? (
        <Card className="p-10">
          <Empty
            icon={<HistoryIcon size={18} />}
            title={q || filter !== "all" ? "No matches" : "Nothing here yet"}
            hint={q || filter !== "all" ? "Try another word or filter." : "Hold your dictation key and speak, everything you dictate shows up here, ready to copy."}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.label}>
              <h3 className="mb-2 px-1 text-[11.5px] font-semibold uppercase tracking-wider text-faint">{g.label}</h3>
              <div className="flex flex-col gap-2">
                {g.items.map((d) => (
                  <div
                    key={d.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => window.getSelection()?.toString() || copy(d)}
                    onKeyDown={(e) => e.key === "Enter" && copy(d)}
                    className="glass group flex cursor-pointer items-start gap-4 rounded-2xl px-4 py-3.5 transition hover:border-brand-400/30 hover:bg-[var(--glass-hover)]"
                  >
                    <span
                      className={clsx(
                        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                        d.mode === "assistant" ? "bg-brand-400/15 text-brand-300" : "bg-white/[0.06] text-white/70",
                      )}
                    >
                      {d.mode === "assistant" ? <Sparkles size={13} /> : <Mic size={13} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="selectable whitespace-pre-wrap text-[14px] leading-relaxed text-[var(--fg)]">{d.finalText}</p>
                      <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-faint">
                        <span className="font-medium text-muted">{d.app}</span>
                        <span>·</span>
                        <span>{new Date(d.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                        <span>·</span>
                        <span className="tabular-nums">{d.words} words</span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copy(d);
                      }}
                      className={clsx(
                        "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition",
                        copied === d.id ? "bg-brand-400/20 text-brand-200" : "bg-white/[0.06] text-muted hover:bg-brand-400/15 hover:text-brand-200",
                      )}
                    >
                      {copied === d.id ? <Check size={13} strokeWidth={3} /> : <Copy size={13} />}
                      {copied === d.id ? "Copied" : "Copy"}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
