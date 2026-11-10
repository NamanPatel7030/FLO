// Notch card for a Google Calendar meeting that starts soon (EV.meetingAlert): title, a live
// countdown ("in 5 min", then "Starting now"), who's coming, and Join / Take notes. State (the
// alert queue) lives in Island.tsx; the pure bits are in lib/meetingAlert.ts.
import { useEffect, useState } from "react";
import { AlarmClock, CalendarClock, Radio, Video, X } from "lucide-react";
import { attendeeSummary, countdownLabel, guestCount, joinLabel, tickMs } from "../lib/meetingAlert";
import type { IslandGeometry, MeetingAlert, MeetingAlertAction } from "../lib/types";
import { CardRow } from "./CardRow";

/** Re-render on a cadence that keeps the countdown honest (every second near the start). */
function useNow(start: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setTimeout(() => setNow(Date.now()), tickMs(start, now));
    return () => clearTimeout(t);
  }, [start, now]);
  return now;
}

export function MeetingCard({
  alert,
  more,
  notch,
  geo,
  onAction,
}: {
  alert: MeetingAlert;
  /** other alerts waiting behind this one */
  more: number;
  notch: boolean;
  geo: IslandGeometry;
  onAction: (action: MeetingAlertAction) => void;
}) {
  const now = useNow(alert.start);
  const when = countdownLabel(alert.start, now, alert.phase);
  const starting = when === "Starting now" || when.startsWith("Started");
  const who = attendeeSummary(alert.attendees, alert.attendeeCount);
  return (
    <CardRow
      notch={notch}
      geo={geo}
      testId="meeting-alert-card"
      label={`${alert.title} ${when}`}
      icon={
        <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)]/15 text-[var(--accent)]">
          {starting && <span className="absolute inset-0 rounded-full bg-[var(--accent)]/25 [animation:ping_1.2s_cubic-bezier(0,0,0.2,1)_3]" />}
          <CalendarClock size={13} className="relative" />
        </span>
      }
      actions={
        <>
          <button
            className="flex h-7 w-7 items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
            onClick={() => onAction("dismiss")}
            aria-label="Dismiss"
            title="Don't remind me about this meeting"
          >
            <X size={13} />
          </button>
          <button
            className="flex h-7 w-7 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
            onClick={() => onAction("snooze")}
            aria-label="Snooze"
            title={starting ? "Remind me again in 2 minutes" : "Remind me when it starts"}
          >
            <AlarmClock size={13} />
          </button>
          <button
            className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11.5px] font-medium text-white/85 hover:bg-white/20"
            onClick={() => onAction("notes")}
            title="Start meeting notes for this event"
          >
            <Radio size={12} /> Take notes
          </button>
          {alert.joinUrl && (
            <button
              className="flex items-center gap-1 rounded-full bg-[var(--accent)] px-3 py-1 text-[11.5px] font-semibold text-black hover:brightness-110"
              onClick={() => onAction("join")}
            >
              <Video size={12} strokeWidth={2.5} /> {joinLabel(alert.joinKind)}
            </button>
          )}
        </>
      }
    >
      <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold">
        <span className="truncate" data-testid="meeting-alert-title">
          {alert.title}
        </span>
        <span className={"shrink-0 font-normal " + (starting ? "text-[var(--accent)]" : "text-white/55")} data-testid="meeting-alert-when">
          · {when}
        </span>
        {more > 0 && <span className="shrink-0 rounded-full bg-white/10 px-1.5 text-[10px] font-normal text-white/70">+{more}</span>}
      </span>
      <span className="block truncate text-[12px] leading-snug text-white/65" data-testid="meeting-alert-guests">
        {alert.attendeeCount > 0 ? `${guestCount(alert.attendeeCount)} · ${who}` : who}
      </span>
    </CardRow>
  );
}
