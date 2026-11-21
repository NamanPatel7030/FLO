import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { ArrowDown, ListChecks, Mic, Pencil, Plus, Radio, Sparkles, Square, StickyNote, Trash2, Copy, Users } from "lucide-react";
import { splitLive } from "../../lib/liveText";
import { isStopped, markStopped, stopMeetingNow } from "../../lib/meetingStops";
import { api, on } from "../../lib/api";
import { formatClock, formatDuration, relativeTime } from "../../lib/format";
import { EV, type KnownVoice, type MeetingEvent, type MeetingInfo, type MeetingSegment, type NameGuess, type Note } from "../../lib/types";
import { useStore, usePick, usePageArg } from "../store";
import { indicLang, shownName, speakerColor as defaultColor, speakerPalette, speakerStats, splitOwner } from "../../lib/speakers";
import { deviceWord } from "../../lib/os";

/** Per-note speaker colours (no two people share one); falls back to the global mapping. */
const ColorCtx = createContext<(who?: string) => string>(defaultColor);
const useSpeakerColor = () => useContext(ColorCtx);
import { Button, Card, CardTitle, Empty, Input, PageHeader, Skeleton, Tooltip } from "../ui";

/** Keep segments ordered by start time (the mic and call tracks finish out of order). */
function insertSorted(segs: MeetingSegment[], s: MeetingSegment): MeetingSegment[] {
  let at = segs.length;
  while (at > 0 && segs[at - 1].t > s.t) at--;
  return [...segs.slice(0, at), s, ...segs.slice(at)];
}

function useMeetingInfo(noteId: string, refreshKey: unknown, tick = 0) {
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
  }, [noteId, refreshKey, tick]);
  return info;
}

const SOURCE_TEXT: Record<NameGuess["source"], string> = {
  voice: "Flo recognized this voice",
  screen: "The meeting window showed them speaking",
  intro: "They introduced themselves",
  calendar: "The only guest on the calendar invite",
  user: "You named them",
};

/** "sounds like Ana …" reason for a suggestion. */
function suggestionReason(g?: NameGuess): string {
  switch (g?.source) {
    case "screen":
      return "from the meeting window";
    case "intro":
      return "from how they introduced themselves";
    case "calendar":
      return "from the calendar invite";
    case "voice":
      return "by voice";
    default:
      return "from the conversation";
  }
}

/** "Who is this?": one click on a guest / remembered voice, or type a name. */
function SpeakerPicker({ who, candidates, onPick, onClose }: { who: string; candidates: string[]; onPick: (to: string) => void; onClose: () => void }) {
  const [val, setVal] = useState("");
  const box = useRef<HTMLDivElement>(null);
  // a chip near the right edge opens its picker leftwards (never past the window: no sideways scroll)
  const [alignRight, setAlignRight] = useState(false);
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect();
    if (r && r.right > window.innerWidth - 12) setAlignRight(true);
  }, []);
  // a click anywhere else closes it (clicks on its own chip toggle it there)
  useEffect(() => {
    const chip = box.current?.parentElement;
    const down = (e: PointerEvent) => {
      if (chip && !chip.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [onClose]);
  return (
    <div
      ref={box}
      data-testid="speaker-picker"
      role="dialog"
      aria-label={`Who is ${who}?`}
      className={clsx(
        "absolute top-full z-30 mt-1 flex w-60 flex-col gap-1 rounded-xl border border-[var(--border)] bg-[var(--bg,white)] p-2 shadow-lg",
        alignRight ? "right-0" : "left-0",
      )}
    >
      <div className="truncate px-1 text-[11px] font-semibold uppercase tracking-wider text-faint">Who is {who}?</div>
      {candidates.map((c) => (
        <button
          key={c}
          type="button"
          data-testid="speaker-pick"
          className="truncate rounded-md px-2 py-1 text-left text-[12.5px] hover:bg-[var(--glass)]"
          title={c}
          onClick={() => {
            onClose();
            onPick(c);
          }}
        >
          {c}
        </button>
      ))}
      <input
        autoFocus
        data-testid="speaker-pick-input"
        placeholder="Another name…"
        aria-label={`Name ${who}`}
        className="mt-1 rounded-md border border-[var(--border)] bg-[var(--glass)] px-2 py-1 text-[12.5px] outline-none"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && val.trim()) {
            onClose();
            onPick(val.trim());
          } else if (e.key === "Escape") onClose();
        }}
      />
    </div>
  );
}

/** Voices Flo remembers: forget one, or merge two that are the same person. */
function VoicesPanel({ onToast }: { onToast: (t: { kind: "success" | "info" | "error"; text: string }) => void }) {
  const [voices, setVoices] = useState<KnownVoice[] | null>(null);
  const load = () =>
    api
      .listVoices()
      .then((v) => setVoices(v ?? []))
      .catch(() => setVoices([]));
  useEffect(() => {
    load();
  }, []);
  if (!voices) return null;
  return (
    <div data-testid="voices-panel" className="flex flex-col gap-1 rounded-lg border border-[var(--border)] p-2.5 text-[12px]">
      <div className="text-[11.5px] text-faint">Voices stay on this {deviceWord()}. Flo names a speaker only when the voice clearly matches.</div>
      {voices.length === 0 && <div className="text-muted">No voices yet. Name a speaker and Flo remembers their voice.</div>}
      {voices.map((v) => (
        <div key={v.name} data-testid="voice-row" data-voice={v.name} className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate font-medium" title={v.name}>
            {v.name} <span className="text-faint">· {v.samples} {v.samples === 1 ? "clip" : "clips"}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {voices.length > 1 && (
              <select
                data-testid="voice-merge"
                aria-label={`Merge ${v.name} into`}
                className="rounded-md border border-[var(--border)] bg-[var(--glass)] px-1 py-0.5 text-[11.5px]"
                value=""
                onChange={async (e) => {
                  const into = e.target.value;
                  if (!into) return;
                  try {
                    await api.mergeVoices(v.name, into);
                    onToast({ kind: "success", text: `Merged ${v.name} into ${into}` });
                  } catch (err) {
                    onToast({ kind: "error", text: `Couldn't merge: ${err}` });
                  }
                  load();
                }}
              >
                <option value="">Same person as…</option>
                {voices
                  .filter((o) => o.name !== v.name)
                  .map((o) => (
                    <option key={o.name} value={o.name}>
                      {o.name}
                    </option>
                  ))}
              </select>
            )}
            <button
              type="button"
              data-testid="voice-forget"
              aria-label={`Forget ${v.name}'s voice`}
              className="rounded-md px-1.5 py-0.5 text-[11.5px] text-muted hover:bg-[var(--glass)] hover:text-red-500"
              onClick={async () => {
                await api.forgetVoice(v.name);
                onToast({ kind: "success", text: `Flo forgot ${v.name}'s voice` });
                load();
              }}
            >
              Forget
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}

/** "You + call audio" vs "Mic only" (with the reason when call audio wasn't captured). */
function CaptureBadge({ info }: { info: MeetingInfo | null }) {
  if (!info) return null;
  const dual = info.capture === "mic+call";
  const badge = (
    <span
      data-testid="capture-mode"
      className={clsx(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-sans text-[11px] font-medium",
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
function SpeakerTag({ who, me, names, onRename, guess }: { who: string; me?: string; names?: string[]; onRename?: (to: string) => void; guess?: string }) {
  const speakerColor = useSpeakerColor();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(who);
  const color = speakerColor(who);
  if (editing && onRename)
    return (
      <input
        autoFocus
        list={names?.length ? "flo-known-voices" : undefined}
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
  const tag = (
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
      className={clsx("group inline-flex min-w-0 max-w-full items-center gap-1 text-[12px] font-semibold", canRename && "cursor-pointer hover:underline")}
      style={{ color }}
    >
      <span className="truncate">{shownName(who, me)}</span>
      {canRename && <Pencil size={10} className="opacity-0 transition group-hover:opacity-70" />}
    </button>
  );
  if (!guess || !onRename) return tag;
  // a name Flo isn't sure of: "Speaker 2 · Rahul?" — one click makes it so
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
      {tag}
      <button
        type="button"
        data-testid="speaker-tag-guess"
        title={`Is this ${guess}? Click to confirm.`}
        onClick={() => onRename(guess)}
        className="max-w-[10rem] shrink-0 truncate rounded-full border border-dashed border-[var(--border)] px-1.5 text-[11px] font-medium text-muted hover:text-[var(--fg)]"
      >
        {guess}?
      </button>
    </span>
  );
}

/** Transcript rows: a colour bar per speaker, the name shown whenever the speaker changes. */
function TranscriptRows({
  segs,
  me,
  names,
  onRename,
  guesses,
  live,
}: {
  segs: MeetingSegment[];
  me?: string;
  names?: string[];
  onRename?: (from: string, to: string) => void;
  guesses?: Record<string, string>;
  /** live meeting: new lines slide in. A saved note opens still (hundreds of rows animating a
   *  blur at once stuttered, most of all on Linux) */
  live?: boolean;
}) {
  const speakerColor = useSpeakerColor();
  // an hour-long meeting's times ("1:02:03") need a wider column than "12:03"
  const timeW = segs.some((s) => s.t >= 3600) ? "w-14" : "w-11";
  return (
    <>
      {segs.map((s, i) => {
        const who = s.speaker;
        const showWho = !!who && (i === 0 || segs[i - 1].speaker !== who);
        const lang = indicLang(s.text);
        return (
          <motion.div
            key={`${s.t}:${i}`}
            initial={live ? { opacity: 0, y: 8 } : false}
            animate={{ opacity: 1, y: 0 }}
            className={clsx("flex gap-3", showWho && i > 0 && "mt-2")}
            data-testid="transcript-row"
          >
            <span className={clsx(timeW, "shrink-0 pt-[2px] text-right font-mono text-[11.5px] tabular-nums text-faint")}>{formatClock(s.t)}</span>
            {who && <span className="w-[3px] shrink-0 rounded-full" style={{ background: speakerColor(who), opacity: 0.75 }} aria-hidden />}
            <div className="min-w-0 flex-1">
              {showWho && (
                <div className="mb-0.5 flex min-w-0">
                  <SpeakerTag who={who!} me={me} names={names} guess={guesses?.[who!]} onRename={onRename ? (to) => onRename(who!, to) : undefined} />
                </div>
              )}
              <div lang={lang} dir="auto" data-testid="transcript-text" className={clsx("selectable break-words text-[13.5px]", lang ? "leading-[1.8]" : "leading-relaxed")}>
                {s.text}
              </div>
            </div>
          </motion.div>
        );
      })}
    </>
  );
}

/** Everyone on the call: colour, name, share of the talking, and one-click names Flo heard. The
 *  row of chips stays pinned at the top while you read down the transcript (a legend). */
function SpeakersBar({
  segs,
  me,
  info,
  onRename,
  onConfirm,
  onToast,
}: {
  segs: MeetingSegment[];
  me?: string;
  info: MeetingInfo | null;
  onRename: (from: string, to: string) => void;
  onConfirm?: (label: string) => void;
  onToast?: (t: { kind: "success" | "info" | "error"; text: string }) => void;
}) {
  const speakerColor = useSpeakerColor();
  const [picking, setPicking] = useState<string | null>(null);
  const [voicesOpen, setVoicesOpen] = useState(false);
  const stats = speakerStats(segs);
  if (stats.length < 2 && !stats.some((s) => s.who !== "You")) return null;
  const suggestions = Object.entries(info?.suggestions ?? {}).filter(([from]) => stats.some((s) => s.who === from));
  const present = new Set(stats.map((s) => s.who.toLowerCase()));
  // "Who is this?" candidates: Flo's guess first, then the invite's guests and remembered voices not on the call yet
  const candidatesFor = (who: string) =>
    [...new Set([info?.suggestions?.[who], ...(info?.attendees ?? []), ...(info?.knownVoices ?? [])].filter((n): n is string => !!n && !present.has(n.toLowerCase())))].slice(0, 8);
  return (
    <>
      {/* pinned while reading; a crowd (7+) would pin half the screen, so it scrolls away then */}
      <div data-testid="speakers-legend" className={clsx("speaker-legend z-10 -mx-2 mb-3 rounded-xl px-2 py-2", stats.length <= 6 ? "sticky top-0" : "relative")}>
        <div className="flex flex-wrap items-center gap-1.5" data-testid="speakers-bar">
          {stats.map(({ who, share }) => {
            const g = info?.nameInfo?.[who];
            // a name Flo found itself (voice / screen) and you haven't confirmed yet
            const found = g && g.source !== "user" && g.name === who;
            const guess = info?.suggestions?.[who];
            const name = shownName(who, me);
            return (
              <span
                key={who}
                data-testid="speaker-chip"
                data-speaker={who}
                className="relative inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--glass)] py-[3px] pl-2 pr-2.5 text-[12px] font-medium"
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: speakerColor(who) }} aria-hidden />
                {who === "You" ? (
                  <span data-testid="speaker-chip-label" className="min-w-0 max-w-[11rem] truncate" style={{ color: speakerColor(who) }} title={name}>
                    {name}
                  </span>
                ) : (
                  <button
                    type="button"
                    data-testid="speaker-chip-name"
                    title={`Who is ${name}?`}
                    aria-haspopup="dialog"
                    aria-expanded={picking === who}
                    className="min-w-0 max-w-[11rem] truncate hover:underline"
                    style={{ color: speakerColor(who) }}
                    onClick={() => setPicking(picking === who ? null : who)}
                  >
                    {name}
                  </button>
                )}
                {who === "You" && me?.trim() && <span className="shrink-0 text-[10.5px] text-faint">you</span>}
                {guess && (
                  <button
                    type="button"
                    data-testid="speaker-guess"
                    title={`${SOURCE_TEXT[info?.nameInfo?.[who]?.source ?? "intro"]}. Click to confirm.`}
                    onClick={() => onRename(who, guess)}
                    className="max-w-[8rem] shrink-0 truncate rounded-full border border-dashed border-[var(--border)] px-1.5 text-[11px] text-muted hover:text-[var(--fg)]"
                  >
                    {guess}?
                  </button>
                )}
                {found && (
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-500/10 pl-1.5 pr-0.5 text-emerald-700 dark:text-emerald-300">
                    <Tooltip text={`${SOURCE_TEXT[g.source]} (${Math.round(g.confidence * 100)}% sure)`}>
                      <span data-testid="speaker-confidence" data-source={g.source} className="text-[10.5px] tabular-nums">
                        {g.source} {Math.round(g.confidence * 100)}%
                      </span>
                    </Tooltip>
                    {onConfirm ? (
                      <button
                        type="button"
                        data-testid="speaker-confirm"
                        aria-label={`Confirm ${who}`}
                        title={`Yes, this is ${who}`}
                        onClick={() => onConfirm(who)}
                        className="flex h-4 w-4 items-center justify-center rounded-full text-[10px] hover:bg-emerald-500/20"
                      >
                        ✓
                      </button>
                    ) : (
                      <span className="w-1" />
                    )}
                  </span>
                )}
                <span className="shrink-0 border-l border-[var(--border)] pl-1.5 tabular-nums text-faint" title="Share of the talking">
                  {share}%
                </span>
                {picking === who && (
                  <SpeakerPicker
                    who={name}
                    candidates={candidatesFor(who)}
                    onClose={() => setPicking(null)}
                    onPick={(to) => (to === who ? onConfirm?.(who) : onRename(who, to))}
                  />
                )}
              </span>
            );
          })}
          {onToast && (
            <button
              type="button"
              data-testid="voices-open"
              aria-expanded={voicesOpen}
              onClick={() => setVoicesOpen((v) => !v)}
              className="ml-auto shrink-0 rounded-full px-2 py-1 text-[11.5px] text-faint hover:bg-[var(--glass)] hover:text-[var(--fg)]"
            >
              Voices
            </button>
          )}
        </div>
      </div>
      {(voicesOpen && onToast) || suggestions.length > 0 ? (
        <div className="mb-4 flex flex-col gap-2">
          {voicesOpen && onToast && <VoicesPanel onToast={onToast} />}
          {suggestions.map(([from, to]) => (
            <div
              key={from}
              data-testid="speaker-suggestion"
              className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-[var(--border)] px-2.5 py-1.5 text-[12px] text-muted"
            >
              <Sparkles size={12} className="shrink-0 text-brand-500" />
              <span className="min-w-0 flex-1">
                <span className="font-semibold" style={{ color: speakerColor(from) }}>
                  {from}
                </span>{" "}
                sounds like <span className="font-semibold text-[var(--fg)]">{to}</span> {suggestionReason(info?.nameInfo?.[from])}.
              </span>
              <Button size="sm" variant="glass" onClick={() => onRename(from, to)}>
                Name them {to}
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

/** Action item with its owner as a coloured name (Fathom style). */
function ActionItemText({ item, me }: { item: string; me?: string }) {
  const speakerColor = useSpeakerColor();
  const { owner, task } = splitOwner(item);
  return (
    <span className="flex min-w-0 items-start gap-2 text-[13px] leading-relaxed">
      <span className="mt-[8px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: owner ? speakerColor(owner) : "var(--fg-faint)" }} aria-hidden />
      <span lang={indicLang(item)} className="min-w-0 break-words">
        {owner && (
          <>
            <span data-testid="action-owner" className="font-semibold" style={{ color: speakerColor(owner) }}>
              {shownName(owner, me)}
            </span>
            {": "}
          </>
        )}
        {task}
      </span>
    </span>
  );
}

/** Delete with one confirm click (the note, its transcript and summary are gone for good). */
function DeleteNoteButton({ onDelete }: { onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return armed ? (
    <Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={onDelete} aria-label="Confirm delete note">
      Delete note?
    </Button>
  ) : (
    <Button size="sm" variant="danger" icon={<Trash2 size={13} />} aria-label="Delete note" title="Delete note" onClick={() => setArmed(true)} />
  );
}

export default function Notes() {
  const { notes, go, projects, toast } = usePick("notes", "go", "projects", "toast");
  const pageArg = usePageArg("notes");
  const [title, setTitle] = useState("");
  const live = notes?.find((n) => n.live);
  const selectedId = pageArg ?? live?.id ?? notes?.[0]?.id;
  const selected = notes?.find((n) => n.id === selectedId);
  // opening another note starts at its top (a long note scrolled to the end left the next, shorter
  // one out of view: an empty page)
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = root.current?.closest(".overflow-y-auto");
    if (scroller && scroller.scrollTop > 0) scroller.scrollTo({ top: 0 });
  }, [selectedId]);

  const start = async () => {
    const n = await api.startMeeting(title.trim() || undefined);
    setTitle("");
    go("notes", n.id);
  };

  return (
    <div ref={root}>
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
        <div className="grid grid-cols-[minmax(0,232px)_minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
          <nav aria-label="Notes" data-testid="notes-list" className="no-scrollbar sticky top-3 flex max-h-[calc(100vh-7rem)] flex-col gap-1.5 overflow-y-auto">
            {notes.map((n) => (
              <button
                key={n.id}
                onClick={() => go("notes", n.id)}
                aria-current={n.id === selectedId ? "true" : undefined}
                className={clsx("shrink-0 rounded-xl px-3 py-2.5 text-left transition", n.id === selectedId ? "glass-strong" : "hover:bg-[var(--glass)]")}
              >
                <div className="flex items-center gap-1.5 text-[13.5px] font-medium">
                  {n.live && <span className="h-2 w-2 shrink-0 rounded-full bg-red-500 animate-pulse" />}
                  <span className="truncate">{n.title}</span>
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-faint">
                  <span className="shrink-0">
                    {n.live ? "Recording" : relativeTime(n.createdAt)} · {formatDuration(n.durationSec)}
                  </span>
                  {n.projectId && (
                    <>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: projects?.find((p) => p.id === n.projectId)?.color }} />
                      <span className="truncate">{projects?.find((p) => p.id === n.projectId)?.name}</span>
                    </>
                  )}
                </div>
              </button>
            ))}
          </nav>
          {/* the next note fades straight in: waiting for the old one to fade out first doubled the
              delay, and on a slow Linux webview the detail stayed blank for seconds */}
          {selected && (
            <motion.div key={selected.id} className="min-w-0" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.16, ease: "easeOut" }}>
              {selected.live ? <LiveNote note={selected} /> : <NoteDetail note={selected} onToast={toast} />}
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}

function LiveNote({ note }: { note: Note }) {
  const me = useStore((s) => s.settings?.userName);
  const { toast, refreshNotes } = usePick("toast", "refreshNotes");
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
  const [partialWho, setPartialWho] = useState<string | undefined>();
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
        if (e.partial !== undefined) {
          setPartial(e.partial);
          setPartialWho(e.partial ? e.partialSpeaker : undefined);
        } else if (e.segment) setPartial("");
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
        <div className="relative flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {stopping ? (
              <span className="relative flex h-3 w-3 shrink-0 rounded-full bg-brand-300 shadow-[0_0_10px_rgba(102,206,255,0.8)]" />
            ) : (
              <span className="relative flex h-3 w-3 shrink-0">
                <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-60" />
                <span className="relative h-3 w-3 rounded-full bg-red-500" />
              </span>
            )}
            <div className="min-w-0">
              <div className="truncate text-[17px] font-semibold" title={note.title}>
                {note.title}
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[13px] tabular-nums text-muted">
                <span
                  data-testid="recording-state"
                  className={clsx("font-sans text-[11px] font-semibold uppercase tracking-wider", stopping ? "text-brand-500 dark:text-brand-300" : "text-red-500")}
                >
                  {stopping ? "Writing summary" : "Recording"}
                </span>
                <span data-testid="meeting-timer">{formatClock(elapsed)}</span> <CaptureBadge info={info} />
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
            <ColorCtx.Provider value={speakerPalette(segs.map((x) => x.speaker))}>
              <TranscriptRows segs={segs} me={me} live />
            </ColorCtx.Provider>
          </AnimatePresence>
          <div className="flex gap-3" data-testid="live-line">
            <span className="w-11 shrink-0 pt-[1px] font-mono text-[11.5px] tabular-nums text-brand-300/70">{formatClock(elapsed)}</span>
            {partial && partialWho && (
              <span className="w-[3px] shrink-0 rounded-full opacity-40" style={{ background: speakerPalette(segs.map((x) => x.speaker))(partialWho) }} aria-hidden />
            )}
            <div className="min-w-0">
              {partial && partialWho && (
                <div data-testid="live-speaker" className="text-[12px] font-semibold opacity-80" style={{ color: speakerPalette(segs.map((x) => x.speaker))(partialWho) }}>
                  {shownName(partialWho, me)}
                </div>
              )}
              <LiveLine text={partial} placeholder={stopping ? "" : segs.length === 0 ? "Listening. Lines appear here as people talk" : ""} />
            </div>
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
    <span lang={indicLang(text)} className={clsx("selectable text-[13.5px] text-[var(--fg)]/70", indicLang(text) ? "leading-[1.8]" : "leading-relaxed")} aria-live="polite">
      {stable}
      <span key={stable.length + ":" + added} className="flo-type-in">
        {added}
      </span>
      <span className="flo-caret" aria-hidden />
    </span>
  );
}

/** True from Stop until the backend's final event (summary + action items written). */
function useSummaryPending(note: Note) {
  const [pending, setPending] = useState(() => isStopped(note.id) && !note.summary);
  useEffect(() => {
    if (!pending) return;
    const off = on<MeetingEvent>(EV.meeting, (e) => {
      if (e.noteId === note.id && !e.live && e.summary !== undefined) setPending(false);
    });
    const t = setTimeout(() => setPending(false), 120_000); // never spin forever
    return () => {
      off();
      clearTimeout(t);
    };
  }, [note.id, pending]);
  useEffect(() => {
    if (note.summary) setPending(false);
  }, [note.summary]);
  return pending;
}

function NoteDetail({ note, onToast }: { note: Note; onToast: (t: { kind: "success" | "info" | "error"; text: string }) => void }) {
  const { go, refreshNotes } = usePick("go", "refreshNotes");
  const writing = useSummaryPending(note);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [infoTick, setInfoTick] = useState(0);
  const info = useMeetingInfo(note.id, note.transcript, infoTick);
  const me = useStore((s) => s.settings?.userName);
  const confirm = async (label: string) => {
    try {
      await api.confirmSpeaker(note.id, label);
      setInfoTick((t) => t + 1);
      onToast({ kind: "success", text: `Confirmed ${label}. Flo will recognize this voice next time.` });
    } catch (e) {
      onToast({ kind: "error", text: `Couldn't confirm: ${e}` });
    }
  };
  // rename suggestions: voices Flo knows, names the conversation revealed, and the calendar invite's guests
  const names = [...new Set([...(info?.knownVoices ?? []), ...Object.values(info?.suggestions ?? {}), ...(info?.attendees ?? [])])];
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
  const palette = useMemo(() => speakerPalette(note.transcript.map((x) => x.speaker)), [note.transcript]);
  return (
    <ColorCtx.Provider value={palette}>
    <div className="flex flex-col gap-4">
      <Card strong className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="break-words text-[19px] font-semibold leading-snug tracking-tight">{note.title}</div>
            <div className="mt-0.5 text-[12.5px] text-faint">
              {new Date(note.createdAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {formatDuration(note.durationSec)}
            </div>
            {info && (
              <div className="mt-1.5">
                <CaptureBadge info={info} />
              </div>
            )}
          </div>
          <div className="flex shrink-0 gap-1.5">
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
            <DeleteNoteButton
              onDelete={async () => {
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
          {writing ? (
            <div data-testid="summary-writing" className="flex flex-col gap-2 py-1" aria-live="polite">
              <span className="text-[13px] text-muted">Writing the summary and action items…</span>
              <span className="h-2.5 w-11/12 animate-pulse rounded-full bg-[var(--glass-strong,rgba(127,127,127,0.18))]" />
              <span className="h-2.5 w-3/4 animate-pulse rounded-full bg-[var(--glass-strong,rgba(127,127,127,0.18))]" />
            </div>
          ) : note.summary ? (
            <p className="text-[13.5px] leading-relaxed selectable">{note.summary}</p>
          ) : (
            <p data-testid="summary-empty" className="text-[13px] text-faint">
              {note.transcript.length ? "No summary for this meeting. With an AI model set in Settings → AI, Flo writes one when you stop." : "Nothing was said in this meeting."}
            </p>
          )}
        </div>
        {note.actionItems.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold">
              <ListChecks size={14} /> Action items
            </div>
            <div className="flex flex-col gap-1">
              {note.actionItems.map((a, i) => (
                <div key={i} data-testid="action-item" className="flex items-start justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-[var(--glass)]">
                  <ActionItemText item={a} me={me} />
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
      {note.transcript.length > 0 && (
      <Card className="p-5">
        <CardTitle>Transcript</CardTitle>
        {note.transcript.some((s) => s.speaker && s.speaker !== "You") && (
          <p className="-mt-1 mb-3 text-[11.5px] text-faint">Click a speaker's name to rename them everywhere in this note.</p>
        )}
        <SpeakersBar segs={note.transcript} me={me} info={info} onRename={rename} onConfirm={confirm} onToast={onToast} />
        {names.length > 0 && (
          <datalist id="flo-known-voices">
            {names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        )}
        <div className="flex flex-col gap-2.5" data-testid="note-transcript">
          <TranscriptRows segs={note.transcript} me={me} names={names} onRename={rename} guesses={info?.suggestions} />
        </div>
      </Card>
      )}
    </div>
    </ColorCtx.Provider>
  );
}
