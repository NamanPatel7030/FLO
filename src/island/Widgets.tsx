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
} from "lucide-react";
import { api } from "../lib/api";
import type { ClaudeSession, NowPlaying, Todo } from "../lib/types";
import { WIDGET_META, type WidgetId } from "../lib/widgets";

export type WidgetAction = "dictate" | "ask" | "meeting" | "dashboard" | "todos" | "customize";

/** The panel that hangs below the notch. Renders the user's chosen widgets (customised in Settings). */
export function Widgets({ top, ids, sessions, onAction }: { top: number; ids: WidgetId[]; sessions: ClaudeSession[]; onAction: (a: WidgetAction) => void }) {
  return (
    <div className="flex h-full flex-col">
      <div style={{ height: top }} />
      <div className="flex-1 px-3 pb-3 pt-1">
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
  const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const date = now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  return (
    <div className="flex h-full flex-col justify-between rounded-xl bg-white/[0.04] p-2.5">
      <TileHead icon={<Clock size={12} />}>Clock</TileHead>
      <div className="text-[24px] font-semibold tabular-nums leading-none text-white/90">{time}</div>
      <div className="text-[12px] text-white/55">{date}</div>
    </div>
  );
}

function WeatherWidget() {
  return (
    <div className="flex h-full flex-col justify-between rounded-xl bg-white/[0.04] p-2.5">
      <TileHead icon={<Cloud size={12} />}>Weather</TileHead>
      <div className="flex items-baseline gap-1 text-white/85">
        <span className="text-[24px] font-semibold leading-none">—°</span>
      </div>
      <div className="text-[11px] text-white/40">Location setup soon</div>
    </div>
  );
}

function TodayWidget({ onOpen }: { onOpen: () => void }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  useEffect(() => {
    api.listTodos().then((t) => setTodos(t.filter((x) => x.status === "open"))).catch(() => {});
  }, []);
  return (
    <button onClick={onOpen} className="flex h-full flex-col rounded-xl bg-white/[0.04] p-2.5 text-left transition hover:bg-white/[0.07]">
      <TileHead icon={<ListChecks size={12} />}>Today · {todos.length}</TileHead>
      <div className="mt-1 flex-1 space-y-0.5 overflow-hidden">
        {todos.slice(0, 3).map((t) => (
          <div key={t.id} className="truncate text-[11.5px] text-white/80">
            {t.title}
          </div>
        ))}
        {todos.length === 0 && <div className="text-[11.5px] text-white/40">All clear</div>}
      </div>
    </button>
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
  const top = sessions[0];
  return (
    <button onClick={onOpen} className="flex h-full flex-col justify-center rounded-xl bg-white/[0.04] p-2.5 text-left transition hover:bg-white/[0.07]">
      <TileHead icon={<Bot size={12} />}>Agents · {sessions.length}</TileHead>
      {top ? (
        <div className="mt-1 flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_DOT[top.status] }} />
          <span className="truncate text-[12px] font-medium text-white/85">{top.project}</span>
          <span className="ml-auto shrink-0 text-[11px] text-white/45">{STATUS_LABEL[top.status]}</span>
        </div>
      ) : (
        <div className="mt-1 text-[11.5px] text-white/40">No active sessions</div>
      )}
    </button>
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
