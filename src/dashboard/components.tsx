import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { AlarmClock, Check, Terminal, X, BellRing } from "lucide-react";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import type { ClaudeEvent, Todo } from "../lib/types";
import { useStore } from "./store";
import { Card, CardTitle, Empty, SourceBadge, Button } from "./ui";

export function TodoRow({ todo, compact }: { todo: Todo; compact?: boolean }) {
  const projects = useStore((s) => s.projects);
  const [completing, setCompleting] = useState(false);
  const project = projects?.find((p) => p.id === todo.projectId);
  const done = todo.status === "done";

  const complete = async () => {
    if (done) {
      await api.updateTodo(todo.id, { status: "open" });
      return;
    }
    setCompleting(true);
    setTimeout(() => api.updateTodo(todo.id, { status: "done" }), 380);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={completing ? { opacity: 0, x: 40, height: 0, marginTop: 0, marginBottom: 0 } : { opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ duration: completing ? 0.36 : 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      className={clsx("group flex items-start gap-3 rounded-xl px-2.5 py-2 transition hover:bg-[var(--glass)]", compact && "py-1.5")}
    >
      <button
        onClick={complete}
        aria-label={done ? "Mark open" : "Complete"}
        className={clsx(
          "mt-[1px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition",
          done || completing ? "border-transparent accent-gradient" : "border-[var(--border-strong)] hover:border-brand-400",
        )}
      >
        {(done || completing) && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 700, damping: 20 }}>
            <Check size={11} strokeWidth={3.5} className="text-white" />
          </motion.span>
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className={clsx("text-[13.5px] leading-snug", done && "text-faint line-through")}>{todo.title}</div>
        {!compact && (todo.reason || project || todo.due || todo.source) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-faint">
            <SourceBadge source={todo.source} app={todo.app} />
            {project && (
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: project.color }} />
                {project.name}
              </span>
            )}
            {todo.due && <span>· due {new Date(todo.due).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</span>}
            {todo.reason && <span className="truncate">· {todo.reason}</span>}
          </div>
        )}
      </div>
      {!done && !compact && (
        <div className="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100">
          <button className="rounded-lg p-1 text-faint hover:bg-[var(--glass-strong)] hover:text-[var(--fg)]" title="Snooze" onClick={() => api.updateTodo(todo.id, { status: "snoozed" })}>
            <AlarmClock size={14} />
          </button>
          <button className="rounded-lg p-1 text-faint hover:bg-[var(--glass-strong)] hover:text-[var(--fg)]" title="Dismiss" onClick={() => api.updateTodo(todo.id, { status: "dismissed" })}>
            <X size={14} />
          </button>
        </div>
      )}
    </motion.div>
  );
}

export function ClaudeSessionsCard() {
  const claude = useStore((s) => s.claude);
  const unseen = claude?.filter((c) => !c.seen).length ?? 0;
  return (
    <Card className="p-4">
      <CardTitle
        icon={<Terminal size={15} />}
        action={
          unseen > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => api.markClaudeSeen()}>
              Mark all seen
            </Button>
          ) : undefined
        }
      >
        Claude sessions
        {unseen > 0 && <span className="rounded-full bg-[#d97757] px-1.5 text-[10.5px] font-semibold leading-[18px] text-white">{unseen} new</span>}
      </CardTitle>
      {!claude ? null : claude.length === 0 ? (
        <Empty icon={<BellRing size={18} />} title="No sessions yet" hint="Connect Claude Code in Settings → Integrations and Flo will ping you when a session finishes." />
      ) : (
        <div className="flex flex-col gap-1">
          <AnimatePresence initial={false}>
            {claude.slice(0, 5).map((c) => (
              <ClaudeRow key={c.id} e={c} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </Card>
  );
}

function ClaudeRow({ e }: { e: ClaudeEvent }) {
  const needs = e.kind === "notification";
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => api.openClaudeSession(e.id).catch(() => api.markClaudeSeen(e.id))}
      title="Open where this Claude session is running"
      className="flex items-start gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-[var(--glass)]"
    >
      <span className="relative mt-1.5 flex h-2 w-2 shrink-0">
        {!e.seen && <span className="absolute inset-0 animate-ping rounded-full bg-[#d97757] opacity-60" />}
        <span className={clsx("relative h-2 w-2 rounded-full", e.seen ? "bg-[var(--border-strong)]" : "bg-[#d97757]")} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13px]">
          <span className={clsx("font-medium", e.seen && "text-muted")}>{needs ? "Needs you" : "Finished"}</span>
          <span className="text-faint">· {e.project}</span>
          <span className="ml-auto shrink-0 text-[11px] text-faint">{relativeTime(e.at)}</span>
        </div>
        <div className="line-clamp-2 text-[12px] text-muted">{e.message}</div>
      </div>
    </motion.button>
  );
}
