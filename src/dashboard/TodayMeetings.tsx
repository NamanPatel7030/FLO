// Home's "Today's meetings": today's Google Calendar meetings (video link or other guests; not
// declined, no all-day or focus blocks) with Join, guests, a per-meeting "Take notes" switch and
// the notes taken in each one. Automatic notes (autonotes.rs) record a meeting only once its call
// is joined; turning them on the first time explains what is recorded (AutoNotesConsent).
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import clsx from "clsx";
import { CalendarDays, FileText, Mic, Radio, ShieldCheck, Video, X } from "lucide-react";
import { api, on } from "../lib/api";
import { EV, type AgendaItem, type GoogleSettings, DEFAULT_GOOGLE_SETTINGS } from "../lib/types";
import { agendaStatus, guests, notesOnCount, timeRange, type AgendaStatus } from "../lib/agenda";
import { joinLabel, attendeeSummary } from "../lib/meetingAlert";
import { openLink } from "../lib/useCalendar";
import { deviceWord } from "../lib/os";
import { usePick } from "./store";
import { Button, Card } from "./ui";

/** Today's agenda, live: reloads on calendar / agenda / notes changes and ticks for status labels. */
export function useAgenda(): { items: AgendaItem[] | null; now: number } {
  const [items, setItems] = useState<AgendaItem[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true;
    const load = () => api.calendarAgenda().then((a) => alive && setItems(Array.isArray(a) ? a : []));
    load();
    const offs = [on(EV.agenda, load), on(EV.calendar, load), on(EV.notes, load), on(EV.google, load)];
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive = false;
      offs.forEach((f) => f());
      clearInterval(t);
    };
  }, []);
  return { items, now };
}

/** Save `google` settings with a patch. */
function useGoogleSettings(): [GoogleSettings, (p: Partial<GoogleSettings>) => Promise<void> | undefined] {
  const { settings, setSettings } = usePick("settings", "setSettings");
  const g = { ...DEFAULT_GOOGLE_SETTINGS, ...(settings?.google ?? {}) };
  return [g, (p) => (settings ? setSettings({ ...settings, google: { ...g, ...p } }) : undefined)];
}

/** Turn automatic notes on: the first time, explain what is recorded and ask. */
export function useAutoNotesSwitch() {
  const [g, save] = useGoogleSettings();
  const [asking, setAsking] = useState(false);
  const set = (on: boolean) => {
    if (on && !g.autoNotesConsent) setAsking(true);
    else save({ autoNotes: on });
  };
  const dialog = asking ? (
    <AutoNotesConsent
      onAccept={() => {
        setAsking(false);
        save({ autoNotes: true, autoNotesConsent: true });
      }}
      onCancel={() => setAsking(false)}
    />
  ) : null;
  return { on: !!g.autoNotes && !!g.autoNotesConsent, set, dialog, google: g, save };
}

export function AutoNotesConsent({ onAccept, onCancel }: { onAccept: () => void; onCancel: () => void }) {
  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "var(--scrim)" }} onClick={onCancel}>
      <motion.div
        initial={{ y: 10, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        role="dialog"
        aria-label="Automatic meeting notes"
        data-testid="autonotes-consent"
        className="w-full max-w-[520px] rounded-2xl border border-[var(--border)] p-5 shadow-[var(--shadow)]"
        style={{ background: "var(--sheet-bg)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-400/15 text-brand-300">
            <ShieldCheck size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-semibold tracking-tight">Take meeting notes automatically?</div>
            <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4 text-[13px] text-muted">
              <li>
                When a calendar meeting with <b>Take notes</b> on starts and you join the call, Flo records <b>your microphone and the call's audio</b> on this {deviceWord()}. No bot joins the meeting.
              </li>
              <li>It records only while you're in the call, and stops when you leave. Stop it anytime from the notch.</li>
              <li>Audio is transcribed with your speech engine and never uploaded by Flo. The notes are written by the AI you chose in Settings → AI.</li>
              <li>
                <b>Tell the people in the meeting</b> that you're taking notes. Some places require everyone's consent to record.
              </li>
            </ul>
          </div>
          <button className="rounded-lg p-1 text-faint hover:bg-[var(--glass-strong)]" onClick={onCancel} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={onCancel}>Not now</Button>
          <Button variant="primary" icon={<Mic size={14} />} onClick={onAccept}>
            Turn on automatic notes
          </Button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

const STATUS: Record<AgendaStatus, { text: string; cls: string } | null> = {
  recording: { text: "Taking notes", cls: "bg-red-500/15 text-red-500 dark:text-red-300" },
  now: { text: "Now", cls: "bg-brand-400/15 text-brand-600 dark:text-brand-200" },
  soon: { text: "Soon", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-300" },
  later: null,
  done: { text: "Ended", cls: "bg-[var(--glass-strong)] text-faint" },
};

function Switch({ checked, onChange, label, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; testId?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className={clsx("relative h-[20px] w-[34px] shrink-0 rounded-full transition", checked ? "accent-gradient" : "bg-[var(--border-strong)]")}
    >
      <span className="absolute top-[3px] h-[14px] w-[14px] rounded-full bg-[#fff] shadow transition-all" style={{ left: checked ? 17 : 3 }} />
    </button>
  );
}

function Row({ item, now, autoOn, onToggle }: { item: AgendaItem; now: number; autoOn: boolean; onToggle: (on: boolean) => void }) {
  const { go, toast } = usePick("go", "toast");
  const st = agendaStatus(item, now);
  const pill = STATUS[st];
  const names = guests(item);
  const live = st === "now" || st === "soon";
  return (
    <div data-testid="today-row" data-status={st} className={clsx("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-2.5 py-2", st === "done" ? "opacity-80" : "", st === "recording" && "bg-red-500/[0.06]")}>
      <div className="w-[118px] shrink-0 font-mono text-[12px] tabular-nums text-muted">{timeRange(item)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          {st === "recording" && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" aria-hidden />}
          <span className="truncate text-[13.5px] font-medium" data-testid="today-title">
            {item.title}
          </span>
          {pill && <span className={clsx("shrink-0 rounded-full px-2 py-px text-[10.5px] font-semibold", pill.cls)}>{pill.text}</span>}
        </div>
        <div className="truncate text-[11.5px] text-faint" data-testid="today-guests" title={names.join(", ")}>
          {attendeeSummary(names)}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {item.noteIds.length > 0 && (
          <Button size="sm" variant="ghost" icon={<FileText size={13} />} onClick={() => go("notes", item.noteIds[item.noteIds.length - 1])} aria-label={`Open notes for ${item.title}`}>
            {item.recording ? "Live notes" : "Notes"}
          </Button>
        )}
        {item.joinUrl && st !== "done" && (
          <Button size="sm" icon={<Video size={13} />} onClick={() => openLink(item.joinUrl!)}>
            {joinLabel(item.joinKind)}
          </Button>
        )}
        {live && !item.recording && (
          <Button size="sm" variant="ghost" icon={<Radio size={13} />} onClick={() => api.startEventNotes(item.occurrence).catch((e) => toast({ kind: "error", text: `Couldn't take notes: ${e}` }))}>
            Take notes now
          </Button>
        )}
        {st !== "done" && (
          <label className="flex items-center gap-1.5 text-[11.5px] text-muted" title={autoOn ? "Flo takes notes once you join the call" : "Turn on automatic notes to record this meeting by itself"}>
            Notes
            <Switch checked={item.takeNotes} onChange={onToggle} label={`Take notes for ${item.title}`} testId="take-notes-toggle" />
          </label>
        )}
      </div>
    </div>
  );
}

export function TodayMeetings() {
  const { items, now } = useAgenda();
  const auto = useAutoNotesSwitch();
  if (!items) return null;
  // not connected (or nothing today and nothing to set up): the card stays out of the way
  if (items.length === 0) return null;
  const upcoming = notesOnCount(items, now);
  const toggle = (it: AgendaItem, on: boolean) => {
    api.setEventNotes(it.id, on);
    // turning a meeting's notes on before automatic notes were ever agreed to: offer them (once
    // agreed, the global switch stays the user's choice)
    if (on && !auto.on && !auto.google.autoNotesConsent) auto.set(true);
  };
  return (
    <Card className="p-4" >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2" data-testid="today-meetings">
        <div className="flex items-center gap-2 text-[13px] font-semibold tracking-tight">
          <CalendarDays size={15} className="text-muted" />
          Today's meetings
          <span className="text-[12px] font-normal text-faint">
            {items.length} · notes on for {upcoming}
          </span>
        </div>
        <div className="flex items-center gap-4 text-[12px] text-muted">
          <label className="flex items-center gap-1.5" title="A notification each morning with today's meetings">
            Morning brief
            <Switch checked={auto.google.morningBrief !== false} onChange={(v) => auto.save({ morningBrief: v })} label="Morning brief" testId="morning-brief-toggle" />
          </label>
          <label className="flex items-center gap-1.5">
            Automatic notes
            <Switch checked={auto.on} onChange={auto.set} label="Automatic notes" testId="autonotes-toggle" />
          </label>
        </div>
      </div>
      {!auto.on && upcoming > 0 && (
        <div data-testid="autonotes-banner" className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[var(--border)] px-3 py-2 text-[12.5px] text-muted">
          <Mic size={13} className="text-brand-400" />
          Flo can take notes for these meetings by itself, with everyone's real names, once you join the call.
          <Button size="sm" variant="primary" className="ml-auto" onClick={() => auto.set(true)}>
            Turn on
          </Button>
        </div>
      )}
      <div className="flex flex-col">
        {items.map((it) => (
          <Row key={it.occurrence} item={it} now={now} autoOn={auto.on} onToggle={(on) => toggle(it, on)} />
        ))}
      </div>
      {auto.dialog}
    </Card>
  );
}
