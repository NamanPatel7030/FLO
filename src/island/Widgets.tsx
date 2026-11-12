import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  Timer as TimerIcon,
  ListChecks,
  Settings as SettingsIcon,
  Clock,
  Cloud,
  Hourglass,
  Bot,
  StickyNote,
  RotateCcw,
  Check,
  ExternalLink,
} from "lucide-react";
import { api } from "../lib/api";
import type { ClaudeSession, Todo, Weather } from "../lib/types";
import { EMPTY_WIDGETS_H, GAP, PANEL_COLS, packPanelRows, panelGridHeight, panelGridMax, widgetHeight, ZONE_ROW_H, type WidgetId } from "../lib/widgets";
import { NowPlayingCard } from "./NowPlaying";
import { AgendaWidget } from "./AgendaWidget";
import { TAGLINE, savedSummary } from "../lib/timeSaved";
import { dayOffset, dayOffsetLabel, formatZoneTime, hourDiffLabel, isDaytime, loadZones, onZonesChange, type ClockZone } from "../lib/timezones";

export type WidgetAction = "dictate" | "ask" | "meeting" | "dashboard" | "todos" | "customize";

/**
 * The widget grid inside the hover panel (below the quick actions). Rows are packed exactly like
 * widgetsBodyHeight measures them (4 columns: span-2 = half, span-1 = quarter, a row's free space
 * goes to its last tile), laid out at base size; the panel zooms it to the notch size.
 * Rows slide in one after another once the black shape has opened.
 */
export function WidgetGrid({ ids, sessions, onAction }: { ids: WidgetId[]; sessions: ClaudeSession[]; onAction: (a: WidgetAction) => void }) {
  if (ids.length === 0)
    return (
      <button
        onClick={() => onAction("customize")}
        style={{ height: EMPTY_WIDGETS_H }}
        className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-white/[0.04] text-white/55 transition hover:bg-white/[0.07]"
      >
        <SettingsIcon size={16} className="text-[var(--accent)]" />
        <span className="text-[12px] font-medium">Add widgets</span>
        <span className="text-[10.5px] text-white/40">Choose what shows here</span>
      </button>
    );
  const rows = packPanelRows(ids);
  // scroll only when it really doesn't fit (zoom rounding would otherwise flash a scrollbar)
  const scrolls = panelGridHeight(ids) > panelGridMax();
  return (
    <div
      className={"flex flex-col " + (scrolls ? "flo-scroll overflow-y-auto overscroll-contain" : "overflow-visible")}
      style={{ gap: GAP, maxHeight: scrolls ? panelGridMax() : undefined }}
      data-testid="widget-grid"
    >
      {rows.map((row, r) => (
        <motion.div
          key={row.cells.map((c) => c.id).join("+")}
          className="grid shrink-0"
          style={{ gridTemplateColumns: `repeat(${PANEL_COLS}, minmax(0, 1fr))`, gap: GAP, height: row.h }}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "tween", duration: 0.22, ease: [0.22, 1, 0.36, 1], delay: 0.12 + r * 0.02 }}
        >
          {row.cells.map((c) => (
            // explicit height: WebKit doesn't resolve a tile's h-full against a stretched grid item
            <div key={c.id} style={{ gridColumn: `span ${c.span} / span ${c.span}`, height: row.h }} className="min-w-0" data-widget={c.id}>
              <WidgetTile id={c.id} sessions={sessions} onAction={onAction} />
            </div>
          ))}
        </motion.div>
      ))}
    </div>
  );
}

/** Live preview of a single widget, rendered inside a mini dark notch panel (for Settings).
 *  Decorative: non-interactive and hidden from the a11y tree so clicking a preview can't toggle a
 *  real to-do or control media, and its inner controls don't leak into the page's accessible roles. */
export function WidgetPreview({ id, sessions = [] }: { id: WidgetId; sessions?: ClaudeSession[] }) {
  return (
    <div aria-hidden className="pointer-events-none overflow-hidden rounded-2xl border border-white/10 bg-[#0a0c10] p-2" style={{ colorScheme: "dark" }}>
      <div style={{ height: widgetHeight(id) }}>
        <WidgetTile id={id} sessions={sessions} onAction={() => {}} />
      </div>
    </div>
  );
}

function WidgetTile({ id, sessions, onAction }: { id: WidgetId; sessions: ClaudeSession[]; onAction: (a: WidgetAction) => void }) {
  switch (id) {
    case "nowPlaying":
      return <NowPlayingCard />;
    case "today":
      return <TodayWidget onOpen={() => onAction("todos")} />;
    case "timer":
      return <StopwatchWidget />;
    case "pomodoro":
      return <PomodoroWidget />;
    case "clock":
      return <ClockWidget />;
    case "weather":
      return <WeatherWidget />;
    case "agents":
      return <AgentsWidget sessions={sessions} onOpen={() => onAction("dashboard")} />;
    case "note":
      return <NoteWidget />;
    case "agenda":
      return <AgendaWidget />;
    case "saved":
      return <TimeSavedWidget />;
  }
}

/** Small label shown at the top of most tiles. */
function TileHead({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-white/45">
      {icon} {children}
    </div>
  );
}

/** The stopwatch lives outside the widget: the panel unmounts when the island closes, and a
 *  running stopwatch must keep counting (it used to stop and reset every time the panel closed). */
export const stopwatch = {
  /** ms banked before the current run */
  base: 0,
  /** Date.now() when the current run started; null while paused */
  since: null as number | null,
  elapsed(now = Date.now()) {
    return this.base + (this.since === null ? 0 : now - this.since);
  },
  toggle(now = Date.now()) {
    if (this.since === null) this.since = now;
    else {
      this.base += now - this.since;
      this.since = null;
    }
  },
  reset() {
    this.base = 0;
    this.since = null;
  },
};

function StopwatchWidget() {
  const [, tick] = useState(0);
  const running = stopwatch.since !== null;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(t);
  }, [running]);
  const ms = stopwatch.elapsed();
  const s = Math.floor(ms / 1000);
  const label = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return (
    <div className="flex h-full flex-col justify-between rounded-xl bg-white/[0.04] p-2.5">
      <TileHead icon={<TimerIcon size={12} />}>Stopwatch</TileHead>
      <div className="font-mono text-[22px] font-semibold tabular-nums text-white/90">{label}</div>
      <div className="flex gap-1.5 text-[11px]">
        <button
          onClick={() => {
            stopwatch.toggle();
            tick((n) => n + 1);
          }}
          className="flex-1 rounded-md bg-white/10 py-1 font-medium hover:bg-white/20"
        >
          {running ? "Pause" : "Start"}
        </button>
        <button
          onClick={() => {
            stopwatch.reset();
            tick((n) => n + 1);
          }}
          className="rounded-md bg-white/5 px-2 py-1 text-white/60 hover:bg-white/10"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

const POMODORO_MS = 25 * 60 * 1000;

function PomodoroWidget() {
  const [left, setLeft] = useState(POMODORO_MS);
  const [running, setRunning] = useState(false);
  const end = useRef(0);
  useEffect(() => {
    if (!running) return;
    end.current = Date.now() + left;
    const t = setInterval(() => {
      const rem = Math.max(0, end.current - Date.now());
      setLeft(rem);
      if (rem <= 0) setRunning(false);
    }, 250);
    return () => clearInterval(t);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = Math.ceil(left / 1000);
  const label = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const done = left <= 0;
  return (
    <div className="flex h-full flex-col justify-between rounded-xl bg-white/[0.04] p-2.5">
      <TileHead icon={<Hourglass size={12} />}>{done ? "Break time" : "Focus"}</TileHead>
      <div className={`font-mono text-[22px] font-semibold tabular-nums ${done ? "text-[var(--accent)]" : "text-white/90"}`}>{label}</div>
      <div className="flex gap-1.5 text-[11px]">
        <button onClick={() => setRunning((r) => !r)} disabled={done} className="flex-1 rounded-md bg-white/10 py-1 font-medium hover:bg-white/20 disabled:opacity-40">
          {running ? "Pause" : "Start"}
        </button>
        <button
          onClick={() => {
            setRunning(false);
            setLeft(POMODORO_MS);
          }}
          aria-label="Reset"
          className="rounded-md bg-white/5 px-2 py-1 text-white/60 hover:bg-white/10"
        >
          <RotateCcw size={13} />
        </button>
      </div>
    </div>
  );
}

/** Flo's tagline and the time dictation saved today and this week (local analytics only). */
function TimeSavedWidget() {
  const [mins, setMins] = useState<{ today: number; week: number } | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([api.getAnalytics(1), api.getAnalytics(7)])
      .then(([d, w]) => alive && setMins({ today: d.minutesSaved, week: w.minutesSaved }))
      .catch(() => alive && setMins({ today: 0, week: 0 }));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="flex h-full items-center gap-3 rounded-xl bg-white/[0.04] px-3" data-testid="saved-widget">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[rgb(var(--accent-rgb)/0.16)] text-[var(--accent)]">
        <Clock size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-serif text-[19px] italic leading-tight text-white/95">{TAGLINE}</div>
        <div className="truncate text-[12px] tabular-nums text-white/60" data-testid="saved-summary">
          {mins ? savedSummary(mins.today, mins.week) : "\u00a0"}
        </div>
      </div>
    </div>
  );
}

function ClockWidget() {
  const [now, setNow] = useState(() => new Date());
  const [zones, setZones] = useState<ClockZone[]>(() => loadZones());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  // world-clock zones are edited in Settings → Appearance → Notch widgets (any window)
  useEffect(() => onZonesChange(setZones), []);
  const time = DUE_TIME.format(now);
  const date = DUE_DATE.format(now);
  const local = (
    <>
      <TileHead icon={<Clock size={12} />}>Clock</TileHead>
      <div className="text-[24px] font-semibold tabular-nums leading-none text-white/90">{time}</div>
      <div className="text-[12px] text-white/55">{date}</div>
    </>
  );
  if (zones.length === 0) return <div className="flex h-full flex-col justify-between rounded-xl bg-white/[0.04] p-2.5">{local}</div>;
  // with zones the tile takes a full row: local time on the left, the world clock on the right
  return (
    <div className="flex h-full gap-2.5 rounded-xl bg-white/[0.04] p-2.5" data-testid="clock-widget">
      <div className="flex w-[100px] shrink-0 flex-col justify-between">{local}</div>
      <div className="@container flex min-w-0 flex-1 flex-col justify-center border-l border-white/[0.07] pl-2.5" data-testid="clock-zones">
        {zones.map((z) => {
          const day = dayOffsetLabel(dayOffset(now, z.tz));
          const sun = isDaytime(now, z.tz);
          return (
            <div key={z.city + z.tz} className="flex items-center gap-1.5" style={{ height: ZONE_ROW_H }} title={`${z.city} · ${hourDiffLabel(now, z.tz)}`} data-testid="clock-zone">
              <span
                aria-label={sun ? "Day" : "Night"}
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={sun ? { background: "#fcd34d", boxShadow: "0 0 6px rgba(252,211,77,0.7)" } : { background: "rgb(var(--accent-2-rgb) / 0.55)" }}
              />
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-white/80">{z.city}</span>
              <span className="hidden shrink-0 text-[10.5px] tabular-nums text-white/35 @[250px]:inline">{hourDiffLabel(now, z.tz)}</span>
              <span className="min-w-[36px] shrink-0 text-right text-[12.5px] font-semibold tabular-nums text-white/90">{formatZoneTime(now, z.tz)}</span>
              <span className="w-[13px] shrink-0 text-[10px] font-semibold tabular-nums text-[var(--accent)]">{day}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** WMO weather-code → short human label. */
function wxLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorm";
}

function WeatherWidget() {
  const [wx, setWx] = useState<Weather | null | "err">(null);
  useEffect(() => {
    let alive = true;
    api
      .weather()
      .then((w) => alive && setWx(w ?? "err"))
      .catch(() => alive && setWx("err"));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="flex h-full flex-col justify-between rounded-xl bg-white/[0.04] p-2.5">
      <TileHead icon={<Cloud size={12} />}>Weather</TileHead>
      {wx === null ? (
        <div className="text-[12px] text-white/40">Loading…</div>
      ) : wx === "err" ? (
        <div className="text-[11px] text-white/40">Unavailable offline</div>
      ) : (
        <>
          <div className="flex items-baseline gap-1 text-white/90">
            <span className="text-[24px] font-semibold leading-none tabular-nums">{Math.round(wx.tempC)}°</span>
            <span className="text-[12px] text-white/55">{wxLabel(wx.code)}</span>
          </div>
          <div className="truncate text-[11px] text-white/40">{wx.place || "Your location"}</div>
        </>
      )}
    </div>
  );
}

/** "due Sun, Nov 8" — adds the time only when it isn't midnight (date-only to-dos look cleaner). */
// Intl formatters are expensive to build (~5–10 ms each on a busy machine); toLocale*String()
// builds a new one per call, which made the to-do tile stall the panel's opening animation.
const DUE_DATE = new Intl.DateTimeFormat([], { weekday: "short", month: "short", day: "numeric" });
const DUE_TIME = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" });
function dueLabel(due: string): string {
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return "";
  const date = DUE_DATE.format(d);
  const midnight = d.getHours() === 0 && d.getMinutes() === 0;
  return midnight ? date : `${date}, ${DUE_TIME.format(d)}`;
}

/** A warm beige tile (used for the to-do and Claude cards). Hover never scales or moves it: a soft
 *  top highlight and a crisp inner rim fade in (opacity only). */
function BeigeTile({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="group relative isolate flex h-full flex-col overflow-hidden rounded-xl p-2.5 text-left"
      style={{ background: "linear-gradient(150deg, #efe7d5 0%, #e4d6bd 100%)", color: "#2f2a20", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)" }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100"
        style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0) 45%)", boxShadow: "inset 0 0 0 1px rgba(122,108,78,0.28)" }}
      />
      {children}
    </div>
  );
}

/** Header for beige tiles (dark text on beige). */
function BeigeHead({ icon, children, action }: { icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: "#7a6c4e" }}>
      {icon} <span className="flex-1">{children}</span>
      {action}
    </div>
  );
}

function TodayWidget({ onOpen }: { onOpen: () => void }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  useEffect(() => {
    const load = () =>
      api
        .listTodos()
        .then((all) => {
          const today = new Date().toISOString().slice(0, 10);
          // open tasks, plus anything completed today so it can still be un-checked
          setTodos(all.filter((x) => x.status === "open" || (x.status === "done" && (x.completedAt ?? "").slice(0, 10) === today)));
        })
        .catch(() => {});
    load();
  }, []);
  const openCount = todos.filter((t) => t.status === "open").length;
  const toggle = (t: Todo) => {
    const next = t.status === "open" ? "done" : "open";
    setTodos((list) => list.map((x) => (x.id === t.id ? { ...x, status: next, completedAt: next === "done" ? new Date().toISOString() : undefined } : x)));
    api.updateTodo(t.id, { status: next }).catch(() => {});
  };
  return (
    <BeigeTile>
      <BeigeHead icon={<ListChecks size={12} />} action={<ExternalLink size={12} className="cursor-pointer opacity-50 hover:opacity-90" onClick={onOpen} />}>
        Today · {openCount}
      </BeigeHead>
      <div className="mt-1.5 min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-0.5 flo-scroll-beige">
        {todos.map((t) => {
          const done = t.status === "done";
          const why = t.reason || (t.due ? `due ${dueLabel(t.due)}` : t.app ? `from ${t.app}` : t.person ? `from ${t.person}` : "");
          return (
            <button key={t.id} onClick={() => toggle(t)} className="flex w-full items-start gap-2 rounded-md px-1 py-1 text-left transition hover:bg-black/[0.06]">
              <span
                className="mt-[1px] flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[5px] border transition"
                style={{ borderColor: done ? "#6f8f5a" : "#b3a580", background: done ? "#6f8f5a" : "transparent" }}
              >
                {done && <Check size={11} strokeWidth={3} color="#fff" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-[12px] font-medium leading-tight ${done ? "line-through opacity-45" : ""}`} style={{ color: "#2f2a20" }}>
                  {t.title}
                </span>
                {why && <span className="mt-0.5 block truncate text-[10.5px] leading-tight" style={{ color: "#8a7c5c" }}>{why}</span>}
              </span>
            </button>
          );
        })}
        {todos.length === 0 && <div className="pt-1 text-[12px]" style={{ color: "#8a7c5c" }}>All clear, nothing due.</div>}
      </div>
    </BeigeTile>
  );
}

const STATUS_LABEL: Record<ClaudeSession["status"], string> = {
  needs_approval: "needs approval",
  waiting_reply: "waiting for you",
  working: "working",
  done: "done",
};
const STATUS_DOT: Record<ClaudeSession["status"], string> = {
  needs_approval: "#ffb020",
  waiting_reply: "var(--accent)",
  working: "#8b8f98",
  done: "#34d399",
};

function AgentsWidget({ sessions, onOpen }: { sessions: ClaudeSession[]; onOpen: () => void }) {
  return (
    <BeigeTile>
      <BeigeHead icon={<Bot size={12} />} action={<ExternalLink size={12} className="cursor-pointer opacity-50 hover:opacity-90" onClick={onOpen} />}>
        Claude · {sessions.length}
      </BeigeHead>
      <div className="mt-1.5 min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-0.5 flo-scroll-beige">
        {sessions.map((s) => (
          <button key={s.sessionId} onClick={onOpen} className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition hover:bg-black/[0.06]">
            <span className="mt-[3px] h-2 w-2 shrink-0 self-start rounded-full" style={{ background: STATUS_DOT[s.status] }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium leading-tight" style={{ color: "#2f2a20" }}>{s.project}</span>
              {s.message && <span className="mt-0.5 block truncate text-[10.5px] leading-tight" style={{ color: "#8a7c5c" }}>{s.message}</span>}
            </span>
            <span className="shrink-0 self-start text-[10.5px]" style={{ color: "#8a7c5c" }}>{STATUS_LABEL[s.status]}</span>
          </button>
        ))}
        {sessions.length === 0 && <div className="pt-1 text-[12px]" style={{ color: "#8a7c5c" }}>No active sessions.</div>}
      </div>
    </BeigeTile>
  );
}

function NoteWidget() {
  const [text, setText] = useState("");
  useEffect(() => {
    try {
      setText(localStorage.getItem("flo.note") ?? "");
    } catch {
      /* ignore */
    }
  }, []);
  return (
    <div className="flex h-full flex-col rounded-xl bg-white/[0.04] p-2.5">
      <TileHead icon={<StickyNote size={12} />}>Quick note</TileHead>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            localStorage.setItem("flo.note", e.target.value);
          } catch {
            /* ignore */
          }
        }}
        onFocus={() => void api.islandFocus(true).catch(() => {})}
        onBlur={() => void api.islandFocus(false).catch(() => {})}
        placeholder="Jot something…"
        className="mt-1 h-full w-full resize-none bg-transparent text-[12px] text-white/85 placeholder:text-white/30 focus:outline-none"
      />
    </div>
  );
}
