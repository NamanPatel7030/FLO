// Flo Agent → Overview: the command box (type or talk), the live run with its step timeline, and
// recent runs. Everything updates from events; nothing polls.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { ArrowUp, ChevronDown, Cpu, Loader2, Mic, Plug, ShieldCheck, Square, Trash2, Zap } from "lucide-react";
import { api, on } from "../../lib/api";
import { relativeTime } from "../../lib/format";
import { EV, type HandsfreeEvent } from "../../lib/types";
import { AGENT_EV, agentApi, isFinished, runDuration, upsertRun, type AgentConfig, type AgentRun, type RoutePlan } from "../../lib/floAgent";
import { useStore } from "../store";
import { Button, Card, Skeleton } from "../ui";
import { LogoMark } from "../Logo";
import { EASE, RouteBadge, RouteTile, RunStatusPill, Timeline } from "./parts";

const SUGGESTIONS = ["Open LinkedIn and write a post about what I shipped this week", "Go to YouTube and play lofi beats", "In Notion, find my notes from Monday's design sync", "Summarize what I did today"];

export function Overview({ cfg }: { cfg: AgentConfig | null }) {
  const toast = useStore((s) => s.toast);
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  useEffect(() => {
    let alive = true;
    agentApi.runs().then((r) => alive && setRuns((cur) => (cur ? r.reduce(upsertRun, cur) : r)));
    const off = on<AgentRun>(AGENT_EV.run, (r) => setRuns((l) => upsertRun(l ?? [], r)));
    return () => {
      alive = false;
      off();
    };
  }, []);
  const live = runs?.find((r) => !isFinished(r)) ?? null;
  const recent = (runs ?? []).filter((r) => r !== live);

  const run = async (goal: string) => {
    try {
      const r = await agentApi.run(goal);
      setRuns((l) => upsertRun(l ?? [], r));
      return true;
    } catch (e) {
      toast({ kind: "error", text: String(e) });
      return false;
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <div className="mb-5">
          <h1 className="text-[28px] font-semibold tracking-tight">Flo Agent</h1>
          <p className="mt-1 text-[13.5px] text-muted">Ask once. Flo works on your screen, in your apps, or with your skills, and shows every step.</p>
        </div>
        <CommandBox busy={!!live} onRun={run} />
        <AnimatePresence initial={false}>
          {live && (
            <motion.div key={live.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.24, ease: EASE }}>
              <LiveRun run={live} />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="mt-8 mb-3 flex items-center justify-between">
          <div className="text-[11.5px] font-semibold uppercase tracking-wider text-faint">Recent runs</div>
          {recent.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={12} />}
              onClick={async () => {
                await agentApi.clearRuns();
                setRuns((l) => (l ?? []).filter((r) => !isFinished(r)));
              }}
            >
              Clear
            </Button>
          )}
        </div>
        {!runs ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : recent.length === 0 ? (
          <Card className="px-5 py-6 text-center text-[12.5px] text-muted">Runs show up here with every step Flo took.</Card>
        ) : (
          <div className="flex flex-col gap-2" data-testid="recent-runs">
            {recent.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </div>
        )}
      </div>
      <Aside cfg={cfg} />
    </div>
  );
}

function CommandBox({ busy, onRun }: { busy: boolean; onRun: (goal: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<RoutePlan | null>(null);
  const [listening, setListening] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);

  // route preview while typing (debounced; nothing runs until Enter)
  useEffect(() => {
    const g = text.trim();
    if (!g) {
      setPlan(null);
      return;
    }
    const t = setTimeout(() => {
      agentApi.plan(g).then(setPlan).catch(() => setPlan(null));
    }, 220);
    return () => clearTimeout(t);
  }, [text]);

  // the mic is Flo's hands-free agent mode (also: double-tap fn)
  useEffect(() => {
    api.agentModeStatus().then(setListening);
    return on<HandsfreeEvent>(EV.handsfree, (e) => setListening(!!e.active));
  }, []);

  // grow with the text, up to 5 lines
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  const submit = async () => {
    const g = text.trim();
    if (!g || busy) return;
    if (await onRun(g)) setText("");
  };

  return (
    <div data-testid="agent-command">
      <div className="rounded-[22px] glass-strong p-2 shadow-[0_18px_50px_-24px_rgba(0,0,0,0.7)] ring-1 ring-white/[0.04] transition focus-within:ring-[var(--accent)]/35">
        <div className="flex items-start gap-3 px-2 pt-2">
          <LogoMark size={30} className="mt-0.5 shrink-0 rounded-[9px]" />
          <textarea
            ref={ta}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask Flo Agent to do anything…"
            aria-label="Ask Flo Agent"
            style={{ boxShadow: "none" }}
            className="min-h-[34px] flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-[22px] outline-none placeholder:text-[var(--fg-faint)]"
          />
        </div>
        <div className="mt-1 flex items-center gap-2 px-2 pb-1">
          <div className="min-w-0 flex-1">
            <AnimatePresence mode="wait" initial={false}>
              {plan && text.trim() ? (
                <motion.div key={plan.reason} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="flex items-center gap-2 text-[11.5px] text-faint" data-testid="route-preview">
                  <RouteBadge route={plan.route} />
                  <span className="truncate">{plan.reason}</span>
                </motion.div>
              ) : (
                <motion.span key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="text-[11.5px] text-faint">
                  Enter to run · Shift + Enter for a new line
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <button
            onClick={async () => setListening(await api.toggleAgentMode())}
            aria-label={listening ? "Stop listening" : "Talk to Flo Agent"}
            aria-pressed={listening}
            title={listening ? "Listening. Click to stop." : "Talk instead (hands-free agent mode)"}
            className={clsx(
              "flex h-9 w-9 items-center justify-center rounded-full transition",
              listening ? "bg-red-500/90 text-white shadow-[0_0_0_4px_rgba(239,68,68,0.18)]" : "text-muted hover:bg-[var(--glass)] hover:text-[var(--fg)]",
            )}
          >
            <Mic size={16} />
          </button>
          <button
            onClick={submit}
            disabled={!text.trim() || busy}
            aria-label="Run"
            className="accent-gradient flex h-9 w-9 items-center justify-center rounded-full text-white shadow-[0_6px_18px_-6px_var(--accent)] transition disabled:opacity-35 disabled:shadow-none"
          >
            <ArrowUp size={17} strokeWidth={2.4} />
          </button>
        </div>
      </div>
      {!text && !busy && (
        <div className="mt-3 flex flex-wrap gap-2" data-testid="agent-suggestions">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setText(s);
                ta.current?.focus();
              }}
              className="rounded-full border border-[var(--border)] bg-[var(--glass)] px-3 py-1.5 text-[12px] text-muted transition hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LiveRun({ run }: { run: AgentRun }) {
  const waiting = run.status === "waiting";
  const question = waiting ? [...run.steps].reverse().find((s) => s.kind === "confirm")?.text : null;
  const [answering, setAnswering] = useState(false);
  const answer = async (yes: boolean) => {
    setAnswering(true);
    await api.agentConfirm(yes);
    setAnswering(false);
  };
  return (
    <Card strong className={clsx("mt-4 p-5 ring-1", waiting ? "ring-amber-300/30" : "ring-[var(--accent)]/20")} >
      <div data-testid="live-run" className="contents">
        <div className="flex items-start gap-3">
          <RouteTile route={run.route} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <RunStatusPill status={run.status} />
              <RouteBadge route={run.route} label={run.skill ?? undefined} />
            </div>
            <div className="mt-1.5 text-[14.5px] font-medium leading-snug">{run.goal}</div>
          </div>
          <Button size="sm" icon={run.status === "running" ? <Loader2 size={12} className="animate-spin" /> : <Square size={10} className="fill-current" />} onClick={() => agentApi.stop(run.id)} aria-label="Stop">
            Stop
          </Button>
        </div>
        <div className="mt-4 pl-[46px]">
          {/* the question being asked shows once, in the answer bar below */}
          <Timeline steps={waiting ? run.steps.filter((s, i) => !(s.kind === "confirm" && i === run.steps.length - 1)) : run.steps} live={!waiting} />
          {waiting && question && (
            <div className="mt-4 flex items-center gap-3 rounded-xl bg-amber-400/[0.08] px-3.5 py-2.5 ring-1 ring-amber-300/20" data-testid="agent-confirm">
              <ShieldCheck size={15} className="shrink-0 text-amber-200" />
              <span className="min-w-0 flex-1 text-[12.5px] text-amber-50">{question}</span>
              <Button size="sm" variant="ghost" disabled={answering} onClick={() => answer(false)}>
                No
              </Button>
              <Button size="sm" variant="primary" disabled={answering} onClick={() => answer(true)}>
                Yes, do it
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function RunRow({ run }: { run: AgentRun }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="overflow-hidden" >
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left" aria-expanded={open} data-testid="run-row">
        <RouteTile route={run.route} size={30} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium">{run.goal}</div>
          <div className="mt-0.5 truncate text-[11.5px] text-faint">
            {run.result ?? ""}
          </div>
        </div>
        <span className="hidden shrink-0 text-[11px] text-faint sm:block">
          {relativeTime(run.startedAt)}
          {run.finishedAt ? ` · ${runDuration(run.startedAt, run.finishedAt)}` : ""}
        </span>
        <RunStatusPill status={run.status} />
        <ChevronDown size={14} className={clsx("shrink-0 text-faint transition-transform duration-200", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: EASE }}>
            <div className="border-t border-[var(--border)] px-4 pb-4 pt-3.5 pl-[58px]">
              <div className="mb-3 flex items-center gap-2 text-[11px] text-faint">
                <RouteBadge route={run.route} label={run.skill ?? undefined} />
                <span>{run.source === "voice" ? "Asked by voice" : "Typed"}</span>
                <span>·</span>
                <span>{run.engine === "hermes" ? "Hermes engine" : "Flo engine"}</span>
              </div>
              <Timeline steps={run.steps} live={false} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

/** What Flo Agent can work with right now, with a way into each tab. */
function Aside({ cfg }: { cfg: AgentConfig | null }) {
  const go = useStore((s) => s.go);
  const [counts, setCounts] = useState<{ mcp: number; platforms: number; skills: number; slack: boolean } | null>(null);
  useEffect(() => {
    Promise.all([api.listConnections().catch(() => []), api.listSkills().catch(() => []), api.slackStatus()]).then(([c, k, s]) =>
      setCounts({ mcp: c.filter((x) => x.kind === "mcp" && x.enabled).length, platforms: c.filter((x) => x.kind === "platform").length, skills: k.filter((x) => x.enabled).length, slack: !!s }),
    );
  }, []);
  const hermes = cfg?.engine === "hermes";
  const row = (icon: React.ReactNode, title: string, sub: string, tab: string, testid: string) => (
    <button onClick={() => go("agent", tab)} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition hover:bg-[var(--glass)]" data-testid={testid}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--glass-strong)] text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="block truncate text-[11.5px] text-faint">{sub}</span>
      </span>
    </button>
  );
  return (
    <div className="flex flex-col gap-4 lg:pt-[90px]">
      <Card className="p-2">
        <div className="px-2.5 pb-1 pt-2 text-[11.5px] font-semibold uppercase tracking-wider text-faint">Works with</div>
        {!counts ? (
          <Skeleton className="m-2 h-32" />
        ) : (
          <>
            {row(<Plug size={15} />, "Apps", `${counts.mcp} MCP server${counts.mcp === 1 ? "" : "s"} · Slack ${counts.slack ? "connected" : "not connected"}`, "apps", "aside-apps")}
            {row(<Zap size={15} />, "Skills", counts.skills ? `${counts.skills} skill${counts.skills === 1 ? "" : "s"} ready` : "Build your first skill", "skills", "aside-skills")}
            {row(<Cpu size={15} />, "Engine", hermes ? "Hermes Agent" : "Flo (built in)", "engine", "aside-engine")}
          </>
        )}
      </Card>
      <Card className="p-4">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <ShieldCheck size={15} className="text-emerald-300" /> Always asks first
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted">Before anything that sends, posts, pays or deletes, Flo Agent stops and asks you. Stop any run at any time.</p>
        {cfg?.confirmEveryStep && <p className="mt-2 text-[12px] text-amber-200/90">It also asks before every step (Customize).</p>}
      </Card>
    </div>
  );
}
