import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { ListChecks, Plus, Radio, Sparkles, Square, StickyNote, Trash2, Copy } from "lucide-react";
import { api, on } from "../../lib/api";
import { formatClock, formatDuration, relativeTime } from "../../lib/format";
import { EV, type MeetingEvent, type Note } from "../../lib/types";
import { useStore } from "../store";
import { Button, Card, CardTitle, Empty, Input, PageHeader, Skeleton } from "../ui";

export default function Notes() {
  const { notes, pageArg, go, projects, toast } = useStore();
  const [title, setTitle] = useState("");
  const live = notes?.find((n) => n.live);
  const selectedId = pageArg ?? live?.id ?? notes?.[0]?.id;
  const selected = notes?.find((n) => n.id === selectedId);

  const start = async () => {
    const n = await api.startMeeting(title.trim() || undefined);
    setTitle("");
    go("notes", n.id);
  };

  return (
    <div>
      <PageHeader
        title="Notes"
        subtitle="Meeting notes with live transcription and summaries — recorded and processed on this device."
        actions={
          !live && (
            <>
              <Input className="w-56" placeholder="Meeting title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && start()} />
              <Button variant="primary" icon={<Radio size={15} />} onClick={start}>
                Start meeting
              </Button>
            </>
          )
        }
      />
      {!notes ? (
        <Skeleton className="h-96" />
      ) : notes.length === 0 ? (
        <Card className="p-8">
          <Empty icon={<StickyNote size={18} />} title="No notes yet" hint="Start a meeting and Flo transcribes, summarizes, and pulls out action items." />
        </Card>
      ) : (
        <div className="grid grid-cols-[280px_1fr] gap-4">
          <div className="flex flex-col gap-1.5">
            {notes.map((n) => (
              <button
                key={n.id}
                onClick={() => go("notes", n.id)}
                className={clsx("rounded-xl px-3 py-2.5 text-left transition", n.id === selectedId ? "glass-strong" : "hover:bg-[var(--glass)]")}
              >
                <div className="flex items-center gap-1.5 text-[13.5px] font-medium">
                  {n.live && <span className="h-2 w-2 shrink-0 rounded-full bg-red-500 animate-pulse" />}
                  <span className="truncate">{n.title}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-faint">
                  {n.live ? "Recording" : relativeTime(n.createdAt)} · {formatDuration(n.durationSec)}
                  {n.projectId && (
                    <>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: projects?.find((p) => p.id === n.projectId)?.color }} />
                      {projects?.find((p) => p.id === n.projectId)?.name}
                    </>
                  )}
                </div>
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            {selected && (
              <motion.div key={selected.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                {selected.live ? <LiveNote note={selected} /> : <NoteDetail note={selected} onToast={toast} />}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function LiveNote({ note }: { note: Note }) {
  const [segs, setSegs] = useState(note.transcript);
  const [summary, setSummary] = useState(note.summary);
  const [elapsed, setElapsed] = useState(note.durationSec);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      on<MeetingEvent>(EV.meeting, (e) => {
        if (e.noteId !== note.id) return;
        if (e.segment) setSegs((s) => [...s, e.segment!]);
        if (e.summary) setSummary(e.summary);
        setElapsed(e.elapsedSec);
      }),
    [note.id],
  );
  useEffect(() => {
    const t = setInterval(() => setElapsed((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [segs.length]);

  return (
    <div className="flex flex-col gap-4">
      <Card strong className="relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -left-10 -top-10 h-32 w-32 rounded-full bg-red-500 opacity-20 blur-3xl" />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-60" />
              <span className="relative h-3 w-3 rounded-full bg-red-500" />
            </span>
            <div>
              <div className="text-[17px] font-semibold">{note.title}</div>
              <div className="font-mono text-[13px] tabular-nums text-muted">{formatClock(elapsed)}</div>
            </div>
          </div>
          <Button variant="danger" icon={<Square size={12} fill="currentColor" />} onClick={() => api.stopMeeting()}>
            Stop & summarize
          </Button>
        </div>
        <div className="relative mt-4 rounded-xl bg-[var(--glass)] p-3.5">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-300">
            <Sparkles size={12} /> Live summary
          </div>
          <AnimatePresence mode="wait">
            <motion.p key={summary} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[13.5px] leading-relaxed">
              {summary || <span className="text-faint">The summary appears after about a minute of conversation…</span>}
            </motion.p>
          </AnimatePresence>
        </div>
      </Card>
      <Card className="max-h-[52vh] overflow-y-auto p-5">
        <CardTitle>Live transcript</CardTitle>
        <div className="flex flex-col gap-2.5">
          <AnimatePresence initial={false}>
            {segs.map((s, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 8, filter: "blur(3px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} className="flex gap-3">
                <span className="w-11 shrink-0 pt-[1px] font-mono text-[11.5px] tabular-nums text-faint">{formatClock(s.t)}</span>
                <span className="text-[13.5px] leading-relaxed selectable">{s.text}</span>
              </motion.div>
            ))}
          </AnimatePresence>
          {segs.length === 0 && <div className="text-[13px] text-faint">Listening…</div>}
          <div ref={bottom} />
        </div>
      </Card>
    </div>
  );
}

function NoteDetail({ note, onToast }: { note: Note; onToast: (t: { kind: "success" | "info" | "error"; text: string }) => void }) {
  const { go } = useStore();
  const [added, setAdded] = useState<Set<number>>(new Set());
  return (
    <div className="flex flex-col gap-4">
      <Card strong className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[19px] font-semibold tracking-tight">{note.title}</div>
            <div className="mt-0.5 text-[12.5px] text-faint">
              {new Date(note.createdAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {formatDuration(note.durationSec)}
            </div>
          </div>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              icon={<Copy size={13} />}
              onClick={() => {
                navigator.clipboard?.writeText(`${note.title}\n\n${note.summary}\n\n${note.actionItems.map((a) => `- ${a}`).join("\n")}`);
                onToast({ kind: "success", text: "Copied summary" });
              }}
            >
              Copy
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 size={13} />}
              onClick={async () => {
                await api.deleteNote(note.id);
                go("notes");
              }}
            />
          </div>
        </div>
        <div className="mt-4 rounded-xl bg-[var(--glass)] p-3.5">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-300">
            <Sparkles size={12} /> Summary
          </div>
          <p className="text-[13.5px] leading-relaxed selectable">{note.summary}</p>
        </div>
        {note.actionItems.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold">
              <ListChecks size={14} /> Action items
            </div>
            <div className="flex flex-col gap-1">
              {note.actionItems.map((a, i) => (
                <div key={i} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-[var(--glass)]">
                  <span className="text-[13px]">• {a}</span>
                  <Button
                    size="sm"
                    variant={added.has(i) ? "ghost" : "glass"}
                    disabled={added.has(i)}
                    icon={<Plus size={12} />}
                    onClick={async () => {
                      await api.addTodo(a, note.projectId);
                      setAdded((s) => new Set(s).add(i));
                      onToast({ kind: "success", text: "Added to to-dos" });
                    }}
                  >
                    {added.has(i) ? "Added" : "To-do"}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
      <Card className="p-5">
        <CardTitle>Transcript</CardTitle>
        <div className="flex flex-col gap-2.5">
          {note.transcript.map((s, i) => (
            <div key={i} className="flex gap-3">
              <span className="w-11 shrink-0 pt-[1px] font-mono text-[11.5px] tabular-nums text-faint">{formatClock(s.t)}</span>
              <span className="text-[13.5px] leading-relaxed selectable">{s.text}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
