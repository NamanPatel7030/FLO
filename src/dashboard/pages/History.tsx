import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Copy, History as HistoryIcon, Search, Sparkles } from "lucide-react";
import { api } from "../../lib/api";
import { relativeTime } from "../../lib/format";
import type { Dictation } from "../../lib/types";
import { useStore } from "../store";
import { Card, Empty, Input, PageHeader, Skeleton } from "../ui";

export default function History() {
  const toast = useStore((s) => s.toast);
  const [items, setItems] = useState<Dictation[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    api.listHistory(500).then(setItems);
  }, []);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items?.filter((d) => !s || d.finalText.toLowerCase().includes(s) || d.app.toLowerCase().includes(s)) ?? null;
  }, [items, q]);

  return (
    <div>
      <PageHeader title="History" subtitle="Every dictation stays on this device. Search, copy, reuse." />
      <div className="relative mb-4">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <Input className="pl-9" placeholder="Search your words…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!shown ? (
        <Skeleton className="h-96" />
      ) : shown.length === 0 ? (
        <Card className="p-8">
          <Empty icon={<HistoryIcon size={18} />} title={q ? "No matches" : "Nothing yet"} hint={q ? "Try another word." : "Hold the hotkey and speak — your dictations show up here."} />
        </Card>
      ) : (
        <Card className="divide-y divide-[var(--border)] overflow-hidden">
          {shown.map((d, i) => (
            <motion.div
              key={d.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: Math.min(i, 12) * 0.02 }}
              className="group flex items-start gap-4 px-4 py-3 transition hover:bg-[var(--glass)]"
            >
              <div className="w-24 shrink-0">
                <div className="flex items-center gap-1 text-[12.5px] font-medium">
                  {d.mode === "assistant" && <Sparkles size={11} className="text-violet-400" />}
                  {d.app}
                </div>
                <div className="text-[11px] text-faint">{relativeTime(d.createdAt)}</div>
              </div>
              <p className="min-w-0 flex-1 text-[13.5px] leading-relaxed selectable">{d.finalText}</p>
              <div className="w-28 shrink-0 text-right text-[11px] tabular-nums text-faint">
                {d.words} words
                <br />
                {d.latencyMs} ms
              </div>
              <button
                className="rounded-lg p-1.5 text-faint opacity-0 transition hover:bg-[var(--glass-strong)] hover:text-[var(--fg)] group-hover:opacity-100"
                title="Copy"
                onClick={() => {
                  navigator.clipboard?.writeText(d.finalText);
                  toast({ kind: "success", text: "Copied" });
                }}
              >
                <Copy size={14} />
              </button>
            </motion.div>
          ))}
        </Card>
      )}
    </div>
  );
}
