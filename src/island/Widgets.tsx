import { useEffect, useRef, useState } from "react";
import {
  Mic,
  Sparkles,
  Radio,
  LayoutDashboard,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Timer as TimerIcon,
  Volume2,
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
import type { ClaudeSession, NowPlaying, Todo, Weather } from "../lib/types";
import { WIDGET_META, type WidgetId } from "../lib/widgets";

export type WidgetAction = "dictate" | "ask" | "meeting" | "dashboard" | "todos" | "customize";

/** The panel that hangs below the notch. Renders the user's chosen widgets (customised in Settings). */
export function Widgets({ top, ids, sessions, onAction, scale = 1 }: { top: number; ids: WidgetId[]; sessions: ClaudeSession[]; onAction: (a: WidgetAction) => void; scale?: number }) {
  return (
    <div className="flex h-full flex-col">
      <div style={{ height: top }} />
      {/* laid out at base size, zoomed to Settings → Notch size (the window is sized to match) */}
      <div className="px-3 pb-3 pt-1" style={{ zoom: scale, width: `${100 / scale}%` }}>
        {ids.length === 0 ? (
          <button
            onClick={() => onAction("customize")}
            className="flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-xl bg-white/[0.04] text-white/55 transition hover:bg-white/[0.07]"
          >
            <SettingsIcon size={18} className="text-[var(--accent)]" />
            <span className="text-[12px] font-medium">Add widgets</span>
            <span className="text-[10.5px] text-white/40">Choose what shows here</span>
          </button>
        ) : (
          <div className="grid grid-cols-2 content-start gap-2">
            {ids.map((id) => (
              <div key={id} style={{ height: WIDGET_META[id]?.h }} className={WIDGET_META[id]?.span === 2 ? "col-span-2" : "col-span-1"}>
                <WidgetTile id={id} sessions={sessions} onAction={onAction} />
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 flex items-center justify-around rounded-xl bg-white/[0.04] p-1">
          <QuickAction icon={<Mic size={15} />} label="Dictate" onClick={() => onAction("dictate")} />
          <QuickAction icon={<Sparkles size={15} />} label="Ask" onClick={() => onAction("ask")} />
          <QuickAction icon={<Radio size={15} />} label="Meeting" onClick={() => onAction("meeting")} />
          <QuickAction icon={<LayoutDashboard size={15} />} label="Open" onClick={() => onAction("dashboard")} />
          <QuickAction icon={<SettingsIcon size={15} />} label="Edit" onClick={() => onAction("customize")} />
        </div>
      </div>
    </div>
  );
}

/** Live preview of a single widget, rendered inside a mini dark notch panel (for Settings).
 *  Decorative: non-interactive and hidden from the a11y tree so clicking a preview can't toggle a
 *  real to-do or control media, and its inner controls don't leak into the page's accessible roles. */
export function WidgetPreview({ id, sessions = [] }: { id: WidgetId; sessions?: ClaudeSession[] }) {
  return (
    <div aria-hidden className="pointer-events-none overflow-hidden rounded-2xl border border-white/10 bg-[#0a0c10] p-2" style={{ colorScheme: "dark" }}>
      <div style={{ height: WIDGET_META[id]?.h }}>
        <WidgetTile id={id} sessions={sessions} onAction={() => {}} />
      </div>
    </div>
  );
}

function WidgetTile({ id, sessions, onAction }: { id: WidgetId; sessions: ClaudeSession[]; onAction: (a: WidgetAction) => void }) {
  switch (id) {
    case "nowPlaying":
      return <NowPlayingWidget />;
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
  }
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-white/75 transition hover:bg-white/10 hover:text-white">
      <span className="text-[var(--accent)]">{icon}</span>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

/** Small label shown at the top of most tiles. */
function TileHead({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-white/45">
      {icon} {children}
    </div>
  );
}

function NowPlayingWidget() {
  const [np, setNp] = useState<NowPlaying | null>(null);
  const [vol, setVol] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = () => api.nowPlaying().then((v) => alive && setNp(v)).catch(() => {});
    poll();
    api.getVolume().then((v) => alive && setVol(v)).catch(() => {});
    const t = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!np) {
    return (
      <div className="flex h-full items-center gap-2 rounded-xl bg-white/[0.04] px-3 text-[12px] text-white/45">
        <Volume2 size={14} /> Nothing playing
      </div>
    );
  }
  const control = async (a: "playpause" | "next" | "previous") => {
    await api.mediaControl(a).catch(() => {});
    api.nowPlaying().then(setNp).catch(() => {});
  };
  return (
    <div className="flex h-full flex-col justify-center rounded-xl bg-white/[0.05] px-3 py-2">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={{ background: "linear-gradient(135deg, var(--accent-grad-from), var(--accent-grad-to))" }}>
          <span className="h-2 w-2 rounded-full bg-white/90" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-white/90">{np.title}</div>
          <div className="truncate text-[11px] text-white/50">{np.artist}</div>
        </div>
        <div className="flex items-center gap-0.5 text-white/80">
          <button aria-label="Previous" onClick={() => control("previous")} className="rounded-full p-1 hover:bg-white/10"><SkipBack size={15} /></button>
          <button aria-label={np.playing ? "Pause" : "Play"} onClick={() => control("playpause")} className="rounded-full bg-white/10 p-1.5 hover:bg-white/20">
            {np.playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
          </button>
          <button aria-label="Next" onClick={() => control("next")} className="rounded-full p-1 hover:bg-white/10"><SkipForward size={15} /></button>
        </div>
      </div>
      {vol !== null && (
        <div className="mt-2 flex items-center gap-2">
          <Volume2 size={13} className="text-white/45" />
          <input
            type="range"
            min={0}
            max={100}
            value={vol}
            aria-label="Volume"
            onChange={(e) => {
              const v = Number(e.target.value);
              setVol(v);
              api.setVolume(v).catch(() => {});
            }}
            className="flo-range h-1 flex-1"
          />
        </div>
      )}
    </div>
  );
}

function StopwatchWidget() {
  const [ms, setMs] = useState(0);
  const [running, setRunning] = useState(false);
  const start = useRef(0);
  useEffect(() => {
    if (!running) return;
    start.current = Date.now() - ms;
    const t = setInterval(() => setMs(Date.now() - start.current), 200);
    return () => clearInterval(t);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = Math.floor(ms / 1000);
  const label = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return (
    <div className="flex h-full flex-col justify-between rounded-xl bg-white/[0.04] p-2.5">
      <TileHead icon={<TimerIcon size={12} />}>Stopwatch</TileHead>
      <div className="font-mono text-[22px] font-semibold tabular-nums text-white/90">{label}</div>
      <div className="flex gap-1.5 text-[11px]">
        <button onClick={() => setRunning((r) => !r)} className="flex-1 rounded-md bg-white/10 py-1 font-medium hover:bg-white/20">
          {running ? "Pause" : "Start"}
        </button>
        <button
          onClick={() => {
            setRunning(false);
            setMs(0);
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

function ClockWidget() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const time = DUE_TIME.format(now);
  const date = DUE_DATE.format(now);
  return (
    <div className="flex h-full flex-col justify-between rounded-xl bg-white/[0.04] p-2.5">
      <TileHead icon={<Clock size={12} />}>Clock</TileHead>
      <div className="text-[24px] font-semibold tabular-nums leading-none text-white/90">{time}</div>
      <div className="text-[12px] text-white/55">{date}</div>
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

/** A warm beige tile that lifts and grows a touch on hover (used for the to-do and Claude cards). */
function BeigeTile({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="group relative flex h-full flex-col overflow-hidden rounded-xl p-2.5 text-left transition-[transform,box-shadow] duration-200 ease-out hover:z-20 hover:-translate-y-1 hover:scale-[1.04] hover:shadow-[0_14px_34px_rgba(0,0,0,0.55)]"
      style={{ background: "linear-gradient(150deg, #efe7d5 0%, #e4d6bd 100%)", color: "#2f2a20" }}
    >
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
      <div className="mt-1.5 flex-1 space-y-1 overflow-y-auto pr-0.5 flo-scroll-beige">
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
        {todos.length === 0 && <div className="pt-1 text-[12px]" style={{ color: "#8a7c5c" }}>All clear — nothing due.</div>}
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
  waiting_reply: "#3dbbff",
  working: "#8b8f98",
  done: "#34d399",
};

function AgentsWidget({ sessions, onOpen }: { sessions: ClaudeSession[]; onOpen: () => void }) {
  return (
    <BeigeTile>
      <BeigeHead icon={<Bot size={12} />} action={<ExternalLink size={12} className="cursor-pointer opacity-50 hover:opacity-90" onClick={onOpen} />}>
        Claude · {sessions.length}
      </BeigeHead>
      <div className="mt-1.5 flex-1 space-y-1 overflow-y-auto pr-0.5 flo-scroll-beige">
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
        placeholder="Jot something…"
        className="mt-1 h-full w-full resize-none bg-transparent text-[12px] text-white/85 placeholder:text-white/30 focus:outline-none"
      />
    </div>
  );
}
