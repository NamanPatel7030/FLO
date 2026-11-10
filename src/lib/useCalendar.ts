// Google Calendar data for the UI (notch agenda widget, Home): is Calendar connected, and the
// cached events (api.googleEvents), kept live by EV.google + EV.calendar. A clock ticks so
// "in 25 min" labels stay current.
import { useEffect, useState } from "react";
import { api, isTauri, on } from "./api";
import { EV, type CalendarEvent, type GoogleEvent } from "./types";

export interface CalendarState {
  /** undefined while checking; true when a Google account with the Calendar scope is connected */
  connected: boolean | undefined;
  events: CalendarEvent[];
  now: number;
}

export function useCalendar(tickMs = 30_000): CalendarState {
  const [connected, setConnected] = useState<boolean | undefined>(undefined);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true;
    const load = () =>
      api.googleStatus().then((s) => {
        if (!alive) return;
        const ok = !!s && s.calendar;
        setConnected(ok);
        if (ok) api.googleEvents().then((e) => alive && setEvents(Array.isArray(e) ? e : []));
        else setEvents([]);
      });
    load();
    const offs = [
      on<GoogleEvent>(EV.google, (e) => {
        if (e && (e.connected || !e.error)) load();
      }),
      on<CalendarEvent[]>(EV.calendar, (list) => {
        if (!Array.isArray(list)) return;
        setEvents(list);
        if (list.length) setConnected(true);
      }),
    ];
    return () => {
      alive = false;
      offs.forEach((f) => f());
    };
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(t);
  }, [tickMs]);
  return { connected, events, now };
}

/** Open a join / calendar link in the default browser. */
export async function openLink(url: string) {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
