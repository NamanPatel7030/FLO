import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, Check, CheckCircle2, Lock, Clock, Flame, FolderKanban, Keyboard, Mic, Radio, Sparkles, StickyNote, Type, Eye } from "lucide-react";
import { api } from "../../lib/api";
import { formatDuration, formatNumber, greeting, groupTodos, relativeTime } from "../../lib/format";
import type { Analytics, AttentionStatus } from "../../lib/types";
import { assistantHotkeyLabel, hotkeyLabel, useStore } from "../store";
import { Card, CardTitle, Empty, Kbd, ProgressRing, Skeleton, Stat, StatusPill, Button } from "../ui";
import { ClaudeSessionsCard, TodoRow } from "../components";
import { missingRequired, PERMISSION_ITEMS, usePermissions } from "../usePermissions";
import { Logo } from "../Logo";
import { Ocean } from "../../island/Ocean";

export default function Home() {
  const { settings, todos, projects, notes, geo, go } = useStore();
  const [a, setA] = useState<Analytics | null>(null);
  const [att, setAtt] = useState<AttentionStatus | null>(null);
  useEffect(() => {
    api.getAnalytics(30).then(setA);
    api.attentionStatus().then(setAtt);
  }, []);
  const today = a?.daily[a.daily.length - 1];
  const groups = todos ? groupTodos(todos) : null;
  const todayTodos = groups ? [...groups.today, ...groups.screen].slice(0, 6) : null;

  return (
    <div className="flex flex-col gap-5">
      <SetupCard onOpen={() => go("settings", "permissions")} />
      {/* hero */}
      <Card strong className="relative overflow-hidden p-6">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full opacity-40 blur-3xl accent-gradient" />
        {/* a calm wave echoing the notch */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 opacity-40" aria-hidden>
          <Ocean width={1200} height={44} calm style={{ width: "100%", height: 44 }} />
        </div>
        <div className="relative flex items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <Logo size={20} glow={false} />
              <span>{new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span>
            </div>
            <h1 className="mt-1 text-[32px] font-semibold tracking-tight">
              {greeting(new Date().getHours())}
              {settings?.userName ? (
                <>
                  , <span className="serif-accent ink-grad pr-1 text-[1.14em]">{settings.userName}.</span>
                </>
              ) : (
                "."
              )}
            </h1>
            <p className="mt-2 max-w-lg text-[14px] text-muted">
              Hold <Kbd>{hotkeyLabel(geo, settings)}</Kbd> to dictate anywhere. Hold <Kbd>{assistantHotkeyLabel(geo, settings)}</Kbd> to ask Flo, “add a to-do to Apollo”, “what's blocked?”, “start meeting notes”.
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="primary" icon={<Mic size={15} />} onClick={() => api.startSession("dictation")}>
                Try dictation
              </Button>
              <Button icon={<Sparkles size={15} />} onClick={() => go("assistant")}>
                Ask Flo
              </Button>
              <Button icon={<Radio size={15} />} onClick={() => api.startMeeting()}>
                Start meeting notes
              </Button>
              <Button icon={<Keyboard size={15} />} onClick={() => go("typing")}>
                Typing test
              </Button>
            </div>
          </div>
          <MicOrb />
        </div>
      </Card>

      {/* today stats */}
      <div className="grid grid-cols-4 gap-4">
        {a && today ? (
          <>
            <Stat label="Words today" value={formatNumber(today.words)} sub={`${formatNumber(a.totalWords)} this month`} icon={<Type size={13} />} tint="#93ddff" />
            <Stat label="Time saved" value={formatDuration(a.minutesSaved * 60)} sub={`at ${a.avgWpm} wpm vs ${settings?.typingWpm ?? 40} typing`} icon={<Clock size={13} />} tint="#66ceff" />
            <Stat label="Streak" value={`${a.streakDays}d`} sub="days in a row" icon={<Flame size={13} />} tint="#f59e0b" />
            <Stat label="Open to-dos" value={todos?.filter((t) => t.status === "open").length ?? "–"} sub={`${groups?.screen.length ?? 0} found on your screen`} icon={<CheckCircle2 size={13} />} tint="#34d399" />
          </>
        ) : (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[112px]" />)
        )}
      </div>

      <div className="grid grid-cols-5 gap-4">
        {/* todos */}
        <Card className="col-span-3 p-4">
          <CardTitle
            icon={<CheckCircle2 size={15} />}
            action={
              <Button size="sm" variant="ghost" onClick={() => go("todos")}>
                All <ArrowRight size={13} />
              </Button>
            }
          >
            Today
          </CardTitle>
          {!todayTodos ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : todayTodos.length === 0 ? (
            <Empty icon={<CheckCircle2 size={18} />} title="All clear" hint="Nothing on your plate. Flo will add things it notices on your screen." />
          ) : (
            <div className="flex flex-col">
              {todayTodos.map((t) => (
                <TodoRow key={t.id} todo={t} />
              ))}
            </div>
          )}
          {att && (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-[var(--glass)] px-3 py-2 text-[12px] text-muted">
              <Eye size={13} className="text-brand-400" />
              {att.blocked ? (
                <span className="text-amber-300/90">Attention is waiting: {att.blocked}</span>
              ) : (
                <>
                  Attention is {att.enabled ? (att.paused ? "paused" : "on") : "off"} · {att.capturesToday} looks today
                  {att.lastApp ? ` · last in ${att.lastApp}` : ""} · stays on this Mac
                </>
              )}
            </div>
          )}
        </Card>

        <div className="col-span-2 flex flex-col gap-4">
          <ClaudeSessionsCard />
          {/* projects */}
          <Card className="p-4">
            <CardTitle
              icon={<FolderKanban size={15} />}
              action={
                <Button size="sm" variant="ghost" onClick={() => go("projects")}>
                  All <ArrowRight size={13} />
                </Button>
              }
            >
              Projects
            </CardTitle>
            <div className="flex flex-col gap-1">
              {projects?.slice(0, 4).map((p) => {
                const total = p.openTodos + p.doneTodos;
                return (
                  <button key={p.id} onClick={() => go("projects", p.id)} className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-[var(--glass)]">
                    <ProgressRing value={total ? p.doneTodos / total : 0} color={p.color} size={32} stroke={3.5} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-medium">{p.name}</div>
                      <div className="truncate text-[11.5px] text-faint">{p.openTodos} open · {p.lastNote}</div>
                    </div>
                    <StatusPill status={p.status} />
                  </button>
                );
              }) ?? <Skeleton className="h-24" />}
            </div>
          </Card>
        </div>
      </div>

      {/* notes */}
      <Card className="p-4">
        <CardTitle
          icon={<StickyNote size={15} />}
          action={
            <Button size="sm" variant="ghost" onClick={() => go("notes")}>
              All <ArrowRight size={13} />
            </Button>
          }
        >
          Recent notes
        </CardTitle>
        <div className="grid grid-cols-3 gap-3">
          {notes?.slice(0, 3).map((n) => (
            <button key={n.id} onClick={() => go("notes", n.id)} className="rounded-xl bg-[var(--glass)] p-3 text-left transition hover:bg-[var(--glass-strong)]">
              <div className="flex items-center gap-1.5 text-[13px] font-medium">
                {n.live && <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />}
                <span className="truncate">{n.title}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-faint">
                {relativeTime(n.createdAt)} · {formatDuration(n.durationSec)}
              </div>
              <p className="mt-1.5 line-clamp-2 text-[12px] text-muted">{n.summary || "Live, summary coming…"}</p>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

function MicOrb() {
  return (
    <div className="relative hidden h-36 w-36 shrink-0 items-center justify-center lg:flex">
      {/* CSS-only pulse rings (compositor-driven, no JS per frame) */}
      {[0, 1, 2].map((i) => (
        <span key={i} className="flo-ring absolute inset-0 rounded-full border border-brand-400/30" style={{ animationDelay: `${i}s` }} />
      ))}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => api.startSession("dictation")}
        className="relative flex h-20 w-20 items-center justify-center rounded-full accent-gradient shadow-[0_10px_40px_-6px_rgba(61,187,255,0.8)]"
        aria-label="Start dictation"
      >
        <Mic size={30} className="text-[#001522]" />
      </motion.button>
    </div>
  );
}


/** Prominent checklist until the required permissions are granted and the fn key is live. */
function SetupCard({ onOpen }: { onOpen: () => void }) {
  const p = usePermissions(2000);
  const missing = missingRequired(p);
  const needsRestart = !!p && missing.length === 0 && !p.hotkeyActive;
  if (!p || (missing.length === 0 && !needsRestart)) return null;
  const left = missing.length + (needsRestart ? 1 : 0);
  return (
    <Card strong className="relative overflow-hidden border-brand-400/30 p-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(500px_200px_at_0%_0%,rgba(61,187,255,0.18),transparent_70%)]" />
      <div className="relative flex flex-wrap items-center gap-5">
        <div className="min-w-[220px] flex-1">
          <div className="text-[16px] font-semibold tracking-tight">
            Finish setup · {left} step{left === 1 ? "" : "s"} left
          </div>
          <p className="mt-1 text-[13px] text-muted">Flo needs these so holding fn can hear you and type where your cursor is.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {PERMISSION_ITEMS.filter((i) => i.required).map((i) => (
            <span
              key={i.key}
              className={
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium " +
                (p[i.key] ? "bg-brand-400/15 text-brand-200" : "bg-amber-500/15 text-amber-300")
              }
            >
              {p[i.key] ? <Check size={13} strokeWidth={3} /> : <Lock size={12} />}
              {i.label}
            </span>
          ))}
          {needsRestart && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1.5 text-[12.5px] font-medium text-amber-300">Restart Flo</span>
          )}
        </div>
        <Button variant="primary" icon={<ArrowRight size={15} />} onClick={needsRestart ? () => api.restartApp() : onOpen}>
          {needsRestart ? "Restart Flo" : "Grant access"}
        </Button>
      </div>
    </Card>
  );
}
