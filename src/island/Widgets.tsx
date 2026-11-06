import { useEffect, useRef, useState } from "react";
import { Mic, Sparkles, Radio, LayoutDashboard, SkipBack, SkipForward, Play, Pause, Timer as TimerIcon, Volume2, ListChecks } from "lucide-react";
import { api } from "../lib/api";
import type { NowPlaying, Todo } from "../lib/types";

/** Widgets panel that hangs below the notch: now playing, a timer, today's to-dos, quick actions. */
export function Widgets({ top, onAction }: { top: number; onAction: (a: "dictate" | "ask" | "meeting" | "dashboard" | "todos") => void }) {
  return (
    <div className="flex h-full flex-col">
      <div style={{ height: top }} />
      <div className="grid flex-1 grid-cols-2 gap-2 px-3 pb-3 pt-1">
        <div className="col-span-2">
          <NowPlayingWidget />
        </div>
        <TimerWidget />
        <TodayWidget onOpen={() => onAction("todos")} />
        <div className="col-span-2 flex items-center justify-around rounded-xl bg-white/[0.04] p-1">
          <QuickAction icon={<Mic size={15} />} label="Dictate" onClick={() => onAction("dictate")} />
          <QuickAction icon={<Sparkles size={15} />} label="Ask" onClick={() => onAction("ask")} />
          <QuickAction icon={<Radio size={15} />} label="Meeting" onClick={() => onAction("meeting")} />
          <QuickAction icon={<LayoutDashboard size={15} />} label="Open" onClick={() => onAction("dashboard")} />
        </div>
      </div>
    </div>
  );
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-white/75 transition hover:bg-white/10 hover:text-white">
      <span className="text-[var(--accent)]">{icon}</span>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
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
      <div className="flex items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-2.5 text-[12px] text-white/45">
        <Volume2 size={14} /> Nothing playing
      </div>
    );
  }
  const control = async (a: "playpause" | "next" | "previous") => {
    await api.mediaControl(a).catch(() => {});
    api.nowPlaying().then(setNp).catch(() => {});
  };
  return (
    <div className="rounded-xl bg-white/[0.05] px-3 py-2.5">
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

function TimerWidget() {
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
    <div className="flex flex-col justify-between rounded-xl bg-white/[0.04] p-2.5">
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-white/45">
        <TimerIcon size={12} /> Timer
      </div>
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

function TodayWidget({ onOpen }: { onOpen: () => void }) {
  const [todos, setTodos] = useState<Todo[]>([]);
  useEffect(() => {
    api.listTodos().then((t) => setTodos(t.filter((x) => x.status === "open"))).catch(() => {});
  }, []);
  return (
    <button onClick={onOpen} className="flex flex-col rounded-xl bg-white/[0.04] p-2.5 text-left transition hover:bg-white/[0.07]">
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-white/45">
        <ListChecks size={12} /> Today · {todos.length}
      </div>
      <div className="mt-1 flex-1 space-y-0.5 overflow-hidden">
        {todos.slice(0, 2).map((t) => (
          <div key={t.id} className="truncate text-[11.5px] text-white/80">
            {t.title}
          </div>
        ))}
        {todos.length === 0 && <div className="text-[11.5px] text-white/40">All clear</div>}
      </div>
    </button>
  );
}
