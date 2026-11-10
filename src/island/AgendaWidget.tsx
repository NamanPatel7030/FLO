// Notch widget "Today's agenda": the next few Google Calendar events today with their times, a
// "Next: Design sync in 25 min" headline and a Join chip for meetings with a video link.
import { CalendarDays, Video } from "lucide-react";
import { api } from "../lib/api";
import { eventStartMs, joinLabel, nextHeadline, todaysAgenda, eventTimeLabel, currentEvent } from "../lib/meetingAlert";
import { openLink, useCalendar } from "../lib/useCalendar";

export function AgendaWidget() {
  const { connected, events, now } = useCalendar();
  const list = todaysAgenda(events, now, 4);
  const live = currentEvent(events, now);
  const headline = live ? `Now: ${live.title}` : nextHeadline(events, now);
  return (
    <div className="flex h-full flex-col rounded-xl bg-white/[0.04] p-2.5" data-testid="agenda-widget">
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-white/45">
        <CalendarDays size={12} /> Today&apos;s agenda
      </div>
      {connected === false ? (
        <button
          onClick={() => api.openDashboard("settings/integrations")}
          className="mt-2 flex flex-1 items-center justify-center rounded-lg bg-white/[0.04] text-[12px] font-medium text-white/70 transition hover:bg-white/[0.08] hover:text-white"
        >
          Connect Google in Settings
        </button>
      ) : (
        <>
          {headline && (
            <div className="mt-1 truncate text-[12.5px] font-semibold text-white/90" data-testid="agenda-next">
              {headline}
            </div>
          )}
          <div className="flo-scroll mt-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain pr-0.5">
            {list.map((e) => {
              const past = !e.allDay && eventStartMs(e) <= now;
              return (
                <div key={e.id} className="flex items-center gap-2 rounded-md px-1 py-[3px]" data-testid="agenda-row">
                  <span className={"w-[58px] shrink-0 text-[10.5px] tabular-nums " + (past ? "text-[var(--accent)]" : "text-white/45")}>{eventTimeLabel(e)}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-white/85">{e.title}</span>
                  {e.joinUrl && (
                    <button
                      onClick={() => openLink(e.joinUrl!)}
                      className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2 py-[1px] text-[10.5px] font-medium text-white/80 hover:bg-white/20"
                      title={e.joinUrl}
                    >
                      <Video size={10} /> {joinLabel(e.joinKind)}
                    </button>
                  )}
                </div>
              );
            })}
            {connected && list.length === 0 && <div className="pt-1 text-[12px] text-white/50">Nothing else on your calendar today.</div>}
          </div>
        </>
      )}
    </div>
  );
}
