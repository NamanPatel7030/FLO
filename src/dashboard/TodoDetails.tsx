// "Details" for one to-do: who said it, where Flo caught it, when, and the words it came from —
// so a to-do can be cross-checked (and the whole conversation opened) when it looks wrong.
import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { Bell, CalendarClock, Clock, ExternalLink, FolderKanban, Gauge, MapPin, MessageSquareQuote, User, X } from "lucide-react";
import type { MeetingSegment, Note, Todo } from "../lib/types";
import { formatDue, formatWhen } from "../lib/format";
import { useStore } from "./store";
import { SourceBadge } from "./ui";

const SOURCE_LABEL: Record<string, string> = {
  meeting: "A meeting",
  attention: "Your screen (Attention)",
  voice: "You, by voice",
  assistant: "The assistant",
  manual: "Added by hand",
  slack: "Slack",
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/^[a-z ]{1,24}:\s*/, "") // "Client: send…" → "send…"
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const words = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length > 2));

/** The meeting note this to-do came from: an action item that matches its title. */
export function findSourceNote(todo: Todo, notes: Note[] | null | undefined): Note | undefined {
  if (!notes || todo.source !== "meeting") return undefined;
  const t = norm(todo.title);
  return notes
    .filter((n) => n.actionItems.some((a) => norm(a) === t || norm(a).includes(t) || t.includes(norm(a))))
    .sort((a, b) => Math.abs(Date.parse(a.createdAt) - Date.parse(todo.createdAt)) - Math.abs(Date.parse(b.createdAt) - Date.parse(todo.createdAt)))[0];
}

/** The stretch of transcript that best matches the to-do (best line ± 2). */
export function transcriptExcerpt(todo: Todo, transcript: MeetingSegment[]): MeetingSegment[] {
  if (!transcript.length) return [];
  const want = words(todo.title);
  let best = -1;
  let bestScore = 0;
  transcript.forEach((s, i) => {
    const have = words(s.text);
    let score = 0;
    want.forEach((w) => have.has(w) && score++);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  if (best < 0 || bestScore < 2) return [];
  return transcript.slice(Math.max(0, best - 2), best + 3);
}

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--glass)] text-brand-300">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">{label}</div>
        <div className="mt-0.5 text-[13.5px] leading-snug text-[var(--fg)]">{children}</div>
      </div>
    </div>
  );
}

export function TodoDetails({ todo, onClose }: { todo: Todo; onClose: () => void }) {
  const { notes, projects, refreshNotes, go } = useStore();
  useEffect(() => {
    if (!notes) refreshNotes().catch(() => {});
  }, [notes, refreshNotes]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const note = useMemo(() => findSourceNote(todo, notes), [todo, notes]);
  const excerpt = useMemo(() => (note ? transcriptExcerpt(todo, note.transcript) : []), [todo, note]);
  const project = projects?.find((p) => p.id === todo.projectId);
  const who = todo.person ?? excerpt.find((s) => s.speaker)?.speaker;
  const reminderAhead = todo.remindAt && Date.parse(todo.remindAt) > Date.now();

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="To-do details" data-testid="todo-details">
      <motion.div className="absolute inset-0 bg-black/70 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
        // solid surface: a translucent panel let the page show through and was hard to read
        className="relative max-h-[85vh] w-full max-w-[560px] overflow-y-auto overflow-x-hidden rounded-2xl border border-white/10 p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
        style={{ background: "linear-gradient(180deg, #0f1b27 0%, #0a121b 100%)" }}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">To-do details</div>
            <h2 className="mt-1 text-[17px] font-semibold leading-snug">{todo.title}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-faint hover:bg-[var(--glass-strong)] hover:text-[var(--fg)]">
            <X size={16} />
          </button>
        </div>

        <div className="mt-3 divide-y divide-[var(--border)]">
          <Row icon={<User size={13} />} label="Who said it">
            {who ?? <span className="text-faint">Not recorded</span>}
          </Row>
          <Row icon={<MapPin size={13} />} label="Captured from">
            <span className="inline-flex flex-wrap items-center gap-2">
              {SOURCE_LABEL[todo.source] ?? todo.source}
              {todo.app && <SourceBadge source={todo.source} app={todo.app} />}
              {note && <span className="text-faint">· {note.title}</span>}
            </span>
          </Row>
          <Row icon={<Clock size={13} />} label="When">
            {formatWhen(todo.createdAt)}
          </Row>
          <Row icon={<CalendarClock size={13} />} label="Due">
            {todo.due ? formatDue(todo.due) : <span className="text-faint">No deadline</span>}
          </Row>
          <Row icon={<Bell size={13} />} label="Reminder">
            {todo.remindAt ? (
              <>
                {formatDue(todo.remindAt)} {!reminderAhead && <span className="text-faint">(already sent)</span>}
              </>
            ) : (
              <span className="text-faint">None. Give it a time ("tomorrow at 5pm") and Flo reminds you 5 minutes early.</span>
            )}
          </Row>
          {project && (
            <Row icon={<FolderKanban size={13} />} label="Project">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: project.color }} /> {project.name}
              </span>
            </Row>
          )}
          {todo.confidence != null && (
            <Row icon={<Gauge size={13} />} label="How sure Flo was">
              {Math.round(todo.confidence * 100)}%
            </Row>
          )}
        </div>

        {(todo.reason || excerpt.length > 0) && (
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
              <MessageSquareQuote size={13} /> What was said
            </div>
            {todo.reason && <blockquote className="rounded-xl border-l-2 border-brand-400 bg-[var(--glass)] px-3 py-2 text-[13px] leading-relaxed">{todo.reason}</blockquote>}
            {excerpt.length > 0 && (
              <div className="mt-2 space-y-1.5 rounded-xl bg-[var(--glass)] p-3" data-testid="todo-excerpt">
                {excerpt.map((s, i) => (
                  <div key={i} className="flex gap-2 text-[12.5px] leading-relaxed">
                    <span className="w-10 shrink-0 tabular-nums text-faint">{mmss(s.t)}</span>
                    {s.speaker && <span className="shrink-0 font-semibold text-brand-200">{s.speaker}</span>}
                    <span className="min-w-0">{s.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {note && (
          <button
            onClick={() => {
              onClose();
              go("notes", note.id);
            }}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full glass px-3 py-1.5 text-[12.5px] font-medium text-brand-200 hover:glass-strong"
          >
            <ExternalLink size={13} /> Open the full meeting note
          </button>
        )}
      </motion.div>
    </div>,
    document.body,
  );
}
