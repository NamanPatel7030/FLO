import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { AlarmClock, Asterisk, Check, MousePointer2, SquareTerminal, Terminal, Webhook, X, BellRing } from "lucide-react";
import { api, on } from "../lib/api";
import { claudeStatusLabel, relativeTime } from "../lib/format";
import { EV, type ClaudeSession, type Todo } from "../lib/types";
import { useStore } from "./store";
import { Card, CardTitle, Empty, SourceBadge } from "./ui";

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

const SOURCE_STYLE: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
  claude: { cls: "bg-[#d97757] text-white", icon: <Asterisk size={10} strokeWidth={3} />, label: "Claude Code" },
  codex: { cls: "bg-white text-black", icon: <SquareTerminal size={10} strokeWidth={2.5} />, label: "Codex" },
  cursor: { cls: "bg-[#0b0b0b] text-white ring-1 ring-white/20", icon: <MousePointer2 size={9} strokeWidth={2.5} />, label: "Cursor" },
  other: { cls: "bg-brand-400 text-black", icon: <Webhook size={9} strokeWidth={2.5} />, label: "Webhook" },
};

/** Small round glyph per agent (Claude orange, Codex white/black, Cursor, anything else light blue). */
function SourceGlyph({ source, live }: { source?: string; live?: boolean }) {
  const st = SOURCE_STYLE[source ?? "claude"] ?? SOURCE_STYLE.other;
  return (
    <span className="relative flex h-[18px] w-[18px] shrink-0" title={st.label} aria-label={st.label}>
      {live && <span className={clsx("absolute inset-0 animate-ping rounded-full opacity-40", st.cls)} />}
      <span className={clsx("relative flex h-[18px] w-[18px] items-center justify-center rounded-full", st.cls)}>{st.icon}</span>
    </span>
  );
}

const STATUS_CHIP: Record<ClaudeSession["status"], string> = {
  working: "border-brand-300/30 bg-brand-300/10 text-brand-200",
  done: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200",
  waiting_reply: "border-sky-300/30 bg-sky-300/10 text-sky-200",
  needs_approval: "border-amber-300/35 bg-amber-300/10 text-amber-200",
};

/** Live Claude Code sessions (same list as the notch tray). */
export function ClaudeSessionsCard() {
  const [sessions, setSessions] = useState<ClaudeSession[] | null>(null);
  useEffect(() => {
    api.listClaudeSessions().then(setSessions).catch(() => setSessions([]));
    return on<ClaudeSession[]>(EV.claudeSessions, (l) => setSessions(Array.isArray(l) ? l : []));
  }, []);
  const working = sessions?.filter((s) => s.status === "working").length ?? 0;
  const drop = (id: string) => setSessions((l) => (l ?? []).filter((s) => s.sessionId !== id));
  return (
    <Card className="p-4">
      <CardTitle icon={<Terminal size={15} />}>
        Claude sessions
        {!!sessions?.length && <span className="rounded-full bg-[#d97757] px-1.5 text-[10.5px] font-semibold leading-[18px] text-white">{sessions.length}</span>}
        {working > 0 && <span className="text-[11px] font-normal text-brand-300">{working} working</span>}
      </CardTitle>
      {!sessions ? null : sessions.length === 0 ? (
        <Empty icon={<BellRing size={18} />} title="All caught up" hint="Connect Claude Code in Settings · Integrations and your sessions show up here and in the notch." />
      ) : (
        <div className="flex max-h-[320px] flex-col gap-0.5 overflow-y-auto">
          <AnimatePresence initial={false}>
            {sessions.map((s) => (
              <ClaudeRow
                key={s.sessionId}
                s={s}
                onOpen={() => {
                  if (s.status !== "working") drop(s.sessionId);
                  api.openClaudeBySession(s.sessionId).catch(() => {});
                }}
                onDismiss={() => {
                  drop(s.sessionId);
                  api.dismissClaudeSession(s.sessionId).catch(() => {});
                }}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </Card>
  );
}

function ClaudeRow({ s, onOpen, onDismiss }: { s: ClaudeSession; onOpen: () => void; onDismiss: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className="group flex items-center gap-2 rounded-xl px-2 py-1.5 transition hover:bg-[var(--glass)]"
    >
      <button onClick={onOpen} title="Open where this session runs" className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <SourceGlyph source={s.source} live={s.status !== "done"} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13px]">
            <span className="truncate font-medium">{s.project}</span>
            <span className={clsx("shrink-0 rounded-full border px-1.5 text-[10.5px] leading-[16px]", STATUS_CHIP[s.status])}>{claudeStatusLabel(s.status)}</span>
            <span className="ml-auto shrink-0 text-[11px] text-faint">{relativeTime(s.updatedAt)}</span>
          </div>
          <div className="truncate text-[12px] text-muted">{s.message}</div>
        </div>
      </button>
      <button onClick={onDismiss} title="Dismiss" aria-label={`Dismiss ${s.project}`} className="rounded-lg p-1 text-faint opacity-0 transition group-hover:opacity-100 hover:bg-[var(--glass-strong)] hover:text-[var(--fg)]">
        <X size={13} />
      </button>
    </motion.div>
  );
}
