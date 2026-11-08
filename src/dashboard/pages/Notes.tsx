import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { ArrowDown, ListChecks, Mic, Pencil, Plus, Radio, Sparkles, Square, StickyNote, Trash2, Copy, Users } from "lucide-react";
import { splitLive } from "../../lib/liveText";
import { isStopped, markStopped, stopMeetingNow } from "../../lib/meetingStops";
import { api, on } from "../../lib/api";
import { formatClock, formatDuration, relativeTime } from "../../lib/format";
import { EV, type MeetingEvent, type MeetingInfo, type MeetingSegment, type Note } from "../../lib/types";
import { useStore } from "../store";
import { Button, Card, CardTitle, Empty, Input, PageHeader, Skeleton, Tooltip } from "../ui";

/** One colour per speaker, stable across notes: You, then Speaker N by number, names by hash. */
const SPEAKER_COLORS = ["#8b5cf6", "#f59e0b", "#10b981", "#ec4899", "#3b82f6", "#ef4444", "#14b8a6", "#a855f7"];
function speakerColor(who?: string): string {
  if (!who || who === "You") return "#0ea5e9";
  if (who === "Others") return "#94a3b8";
  const n = /^Speaker (\d+)$/.exec(who);
  if (n) return SPEAKER_COLORS[(Number(n[1]) - 1) % SPEAKER_COLORS.length];
  let h = 0;
  for (const c of who) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SPEAKER_COLORS[h % SPEAKER_COLORS.length];
}

/** Keep segments ordered by start time (the mic and call tracks finish out of order). */
function insertSorted(segs: MeetingSegment[], s: MeetingSegment): MeetingSegment[] {
  let at = segs.length;
  while (at > 0 && segs[at - 1].t > s.t) at--;
  return [...segs.slice(0, at), s, ...segs.slice(at)];
}

function useMeetingInfo(noteId: string, refreshKey: unknown) {
  const [info, setInfo] = useState<MeetingInfo | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .meetingInfo(noteId)
      .then((i) => alive && setInfo(i ?? null))
      .catch(() => alive && setInfo(null));
    return () => {
      alive = false;
    };
  }, [noteId, refreshKey]);
  return info;
}

/** "You + call audio" vs "Mic only" (with the reason when call audio wasn't captured). */
function CaptureBadge({ info }: { info: MeetingInfo | null }) {
  if (!info) return null;
  const dual = info.capture === "mic+call";
  const badge = (
    <span
      data-testid="capture-mode"
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-sans text-[11px] font-medium",
        dual ? "bg-sky-500/15 text-sky-600 dark:text-sky-300" : "bg-[var(--glass)] text-muted",
      )}
    >
      {dual ? <Users size={11} /> : <Mic size={11} />}
      {dual ? "You + call audio" : "Mic only"}
    </span>
  );
  return info.captureNote ? (
    <Tooltip text={info.captureNote}>{badge}</Tooltip>
  ) : (
    badge
  );
}

/** Speaker label in its colour; click to rename (everyone but "You"). */
function SpeakerTag({ who, onRename }: { who: string; onRename?: (to: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(who);
  const color = speakerColor(who);
  if (editing && onRename)
    return (
      <input
        autoFocus
        data-testid="speaker-rename-input"
        aria-label={`Rename ${who}`}
        className="w-32 rounded-md border border-[var(--border)] bg-[var(--glass)] px-1.5 py-0.5 text-[12px] font-semibold outline-none"
        style={{ color }}
        value={val}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const to = val.trim();
            setEditing(false);
            if (to && to !== who) onRename(to);
          } else if (e.key === "Escape") {
            setVal(who);
            setEditing(false);
          }
        }}
      />
    );
  const canRename = !!onRename && who !== "You";
  return (
    <button
      type="button"
      data-testid="speaker-tag"
      data-speaker={who}
      data-color={color}
      disabled={!canRename}
      title={canRename ? `Rename ${who}. Flo remembers the voice.` : undefined}
      onClick={() => {
        setVal(who);
        setEditing(true);
      }}
      className={clsx("group inline-flex items-center gap-1 text-[12px] font-semibold", canRename && "cursor-pointer hover:underline")}
      style={{ color }}
    >
      {who}
      {canRename && <Pencil size={10} className="opacity-0 transition group-hover:opacity-70" />}
    </button>
  );
}

/** Transcript rows: a colour bar per speaker, the name shown whenever the speaker changes. */
function TranscriptRows({ segs, onRename }: { segs: MeetingSegment[]; onRename?: (from: string, to: string) => void }) {
  return (
    <>
      {segs.map((s, i) => {
        const who = s.speaker;
        const showWho = !!who && (i === 0 || segs[i - 1].speaker !== who);
        return (
          <motion.div
            key={`${s.t}:${i}`}
            initial={{ opacity: 0, y: 8, filter: "blur(3px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            className={clsx("flex gap-3", showWho && i > 0 && "mt-1.5")}
            data-testid="transcript-row"
          >
            <span className="w-11 shrink-0 pt-[1px] font-mono text-[11.5px] tabular-nums text-faint">{formatClock(s.t)}</span>
            {who && <span className="w-[3px] shrink-0 rounded-full" style={{ background: speakerColor(who), opacity: 0.75 }} aria-hidden />}
            <div className="min-w-0">
              {showWho && <SpeakerTag who={who!} onRename={onRename ? (to) => onRename(who!, to) : undefined} />}
              <div className="text-[13.5px] leading-relaxed selectable">{s.text}</div>
            </div>
          </motion.div>
        );
      })}
    </>
  );
}

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
        subtitle="Meeting notes with live transcription and summaries, recorded and processed on this device."
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
  const { toast, refreshNotes } = useStore();
  const [stopping, setStopping] = useState(false);
  const stop = async () => {
    if (stopping) return;
    setStopping(true);
    markStopped(note.id);
    try {
      await stopMeetingNow(note.id);
      toast({ kind: "info", text: "Recording stopped. Writing the summary…" });
      await refreshNotes();
    } catch (e) {
      toast({ kind: "error", text: `Couldn't stop: ${e}` });
      setStopping(false);
    }
  };
  const [segs, setSegs] = useState(note.transcript);
  // the backend drops echoed mic lines and relabels speakers → follow the stored transcript
  useEffect(() => setSegs(note.transcript), [note.transcript]);
  const info = useMeetingInfo(note.id, null);
  const [partial, setPartial] = useState("");
  const [summary, setSummary] = useState(note.summary);
  const [elapsed, setElapsed] = useState(note.durationSec);
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  useEffect(
    () =>
      on<MeetingEvent>(EV.meeting, (e) => {
        if (e.noteId !== note.id) return;
        if (!e.live) markStopped(e.noteId);
        if (e.summary) setSummary(e.summary);
        // after Stop: no more live text (late final sentences must not revive the live view)
        if (!e.live || isStopped(e.noteId)) {
          setPartial("");
          setStopping(true);
          return;
        }
        if (e.segment) setSegs((s) => insertSorted(s, e.segment!));
        if (e.partial !== undefined) setPartial(e.partial);
        else if (e.segment) setPartial("");
        setElapsed(e.elapsedSec);
      }),
    [note.id],
  );
  useEffect(() => {
    if (stopping) return;
    const t = setInterval(() => setElapsed((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [stopping]);
  // keep pinned to the live line unless the user scrolled up to read
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [segs.length, partial, pinned]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card strong className="relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -left-10 -top-10 h-32 w-32 rounded-full bg-red-500 opacity-20 blur-3xl" />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            {stopping ? (
              <span className="relative flex h-3 w-3 rounded-full bg-brand-300 shadow-[0_0_10px_rgba(102,206,255,0.8)]" />
            ) : (
              <span className="relative flex h-3 w-3">
                <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-60" />
                <span className="relative h-3 w-3 rounded-full bg-red-500" />
              </span>
            )}
            <div>
              <div className="text-[17px] font-semibold">{note.title}</div>
              <div className="flex items-center gap-2 font-mono text-[13px] tabular-nums text-muted">
                {formatClock(elapsed)} <CaptureBadge info={info} />
              </div>
            </div>
          </div>
          <Button variant="danger" disabled={stopping} icon={<Square size={12} fill="currentColor" />} onClick={stop}>
            {stopping ? "Summarizing…" : "Stop & summarize"}
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
      <Card className="relative p-5">
        <CardTitle>Live transcript</CardTitle>
        <div ref={scroller} onScroll={onScroll} className="flex max-h-[46vh] flex-col gap-2.5 overflow-y-auto pr-1" data-testid="live-transcript">
          <AnimatePresence initial={false}>
            <TranscriptRows segs={segs} />
          </AnimatePresence>
          <div className="flex gap-3" data-testid="live-line">
            <span className="w-11 shrink-0 pt-[1px] font-mono text-[11.5px] tabular-nums text-brand-300/70">{formatClock(elapsed)}</span>
            <LiveLine text={partial} placeholder={segs.length === 0 ? "Waiting for someone to speak" : ""} />
          </div>
        </div>
        <AnimatePresence>
          {!pinned && (
            <motion.button
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              onClick={() => setPinned(true)}
              className="btn-primary absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px]"
            >
              <ArrowDown size={13} /> Jump to live
            </motion.button>
          )}
        </AnimatePresence>
      </Card>
    </div>
  );
}

/** The live, still-changing line: only newly appended words animate in, caret at the end. */
function LiveLine({ text, placeholder }: { text: string; placeholder: string }) {
  const prev = useRef("");
  const { stable, added } = splitLive(prev.current, text);
  useEffect(() => {
    prev.current = text;
  }, [text]);
  if (!text)
    return (
      <span className="text-[13.5px] leading-relaxed text-faint">
        {placeholder}
        <span className="flo-caret" aria-hidden />
      </span>
    );
  return (
    <span className="selectable text-[13.5px] leading-relaxed text-[var(--fg)]/70" aria-live="polite">
      {stable}
      <span key={stable.length + ":" + added} className="flo-type-in">
        {added}
      </span>
      <span className="flo-caret" aria-hidden />
    </span>
  );
}

function NoteDetail({ note, onToast }: { note: Note; onToast: (t: { kind: "success" | "info" | "error"; text: string }) => void }) {
  const { go, refreshNotes } = useStore();
  const [added, setAdded] = useState<Set<number>>(new Set());
  const info = useMeetingInfo(note.id, note.transcript);
  const rename = async (from: string, to: string) => {
    try {
      await api.renameSpeaker(note.id, from, to);
      await refreshNotes();
      const remembers = info?.voiced.includes(from);
      onToast({ kind: "success", text: remembers ? `Renamed to ${to}. Flo will recognize this voice next time.` : `Renamed to ${to}` });
    } catch (e) {
      onToast({ kind: "error", text: `Couldn't rename: ${e}` });
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <Card strong className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[19px] font-semibold tracking-tight">{note.title}</div>
            <div className="mt-0.5 text-[12.5px] text-faint">
              {new Date(note.createdAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {formatDuration(note.durationSec)}
            </div>
            {info && (
              <div className="mt-1.5">
                <CaptureBadge info={info} />
              </div>
            )}
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
        {note.transcript.some((s) => s.speaker && s.speaker !== "You") && (
          <p className="-mt-1 mb-3 text-[11.5px] text-faint">Click a speaker's name to rename them everywhere in this note.</p>
        )}
        <div className="flex flex-col gap-2.5" data-testid="note-transcript">
          <TranscriptRows segs={note.transcript} onRename={rename} />
        </div>
      </Card>
    </div>
  );
}
