// Notch tray: live items in the wings beside the camera (Claude sessions, to-dos, meeting) +
// tooltips, the correction card and the meeting-detected prompt. Pure presentation; state lives
// in Island.tsx.
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { ArrowUpRight, Asterisk, Check, CheckCircle2, ChevronLeft, ChevronRight, Folder, Trash2, ExternalLink, MousePointer2, Radio, Send, Sparkles, Terminal, Webhook, X } from "lucide-react";
import {
  appLabel,
  claudeStatusLabel,
  formatDue,
  ISLAND_GAP,
  PERM_LINE,
  PERM_LINES,
  PERM_LINES_MAX,
  permissionCmdLines,
  permissionCommand,
  relativeTime,
  toolLabel,
  TRAY_LIST_ROW,
  waitedLabel,
  type TraySlot,
} from "../lib/format";
import type { ClaudeSession, ConfirmEvent, CorrectionEvent, IslandGeometry, Todo } from "../lib/types";
import { CardRow } from "./CardRow";
import { useAutoContinue } from "../lib/autoContinue";
import { acFor, LimitLine, LimitStatus, LimitSwitch } from "./LimitWait";

export type TrayItem =
  /** ALL agent sessions behind one stacked icon (sorted most urgent first) */
  | { id: "agents"; kind: "agents"; sessions: ClaudeSession[] }
  | { id: "todos"; kind: "todos"; todos: Todo[] }
  | { id: "meeting"; kind: "meeting"; app: string };

/** calm, no-overshoot ease for everything in the tray */
const EASE = { type: "tween", duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const;

const SHORT_STATUS: Record<ClaudeSession["status"], string> = {
  working: "Working",
  done: "Done",
  waiting_reply: "Reply",
  needs_approval: "Approve",
};

const STATUS_COLOR: Record<ClaudeSession["status"], string> = {
  working: "text-brand-300",
  done: "text-brand-200",
  waiting_reply: "text-sky-300",
  needs_approval: "text-amber-300",
};

/** Per-agent look: Claude orange, Codex white/black, Cursor black, anything else light blue. */
const SOURCE_LOOK: Record<string, { bg: string; bgWorking: string; icon: React.ReactNode }> = {
  claude: {
    bg: "radial-gradient(circle at 35% 30%, #f0a383, #d97757 55%, #a8492d)",
    bgWorking: "radial-gradient(circle at 35% 30%, rgba(217,119,87,0.55), rgba(90,40,24,0.55) 70%)",
    icon: <Asterisk size={12} strokeWidth={3} className="text-white" />,
  },
  codex: {
    bg: "radial-gradient(circle at 35% 30%, #ffffff, #e5e7eb 70%)",
    bgWorking: "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.55), rgba(160,160,160,0.45) 70%)",
    icon: <Terminal size={11} strokeWidth={2.6} className="text-black" />,
  },
  cursor: {
    bg: "radial-gradient(circle at 35% 30%, #3a3a3a, #0b0b0b 70%)",
    bgWorking: "radial-gradient(circle at 35% 30%, rgba(70,70,70,0.6), rgba(10,10,10,0.6) 70%)",
    icon: <MousePointer2 size={10} strokeWidth={2.6} className="text-white" />,
  },
  other: {
    bg: "radial-gradient(circle at 35% 30%, #93ddff, #1a9be0 70%)",
    bgWorking: "radial-gradient(circle at 35% 30%, rgba(147,221,255,0.5), rgba(26,155,224,0.45) 70%)",
    icon: <Webhook size={10} strokeWidth={2.6} className="text-black" />,
  },
};
export const sourceLook = (source?: string) => SOURCE_LOOK[source ?? "claude"] ?? SOURCE_LOOK.other;

/**
 * Smooth, cheap "working" spinner: ONE pre-rendered SVG arc (~270°, gradient stroke with a fading
 * tail, round caps) on its own element, rotated only by a CSS `transform` keyframe. WebKit hands
 * transform-only animations to Core Animation (compositor), so the main thread does nothing:
 * no JS ticks, no conic-gradient / mask / shadow / filter on the rotating element.
 */
function WorkingArc({ still }: { still?: boolean }) {
  // still: the resting tray holds the arc in place (paused, not removed) so an idle notch draws
  // zero frames; it picks up spinning the moment the island is hovered / opened
  return (
    <span className="flo-spin pointer-events-none absolute -inset-[3px]" data-still={still ? "true" : undefined} aria-hidden>
      <svg viewBox="0 0 26 26" width="100%" height="100%">
        <defs>
          <linearGradient id="flo-arc" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#1a9be0" stopOpacity="0" />
            <stop offset="0.45" stopColor="#1a9be0" />
            <stop offset="0.8" stopColor="#66ceff" />
            <stop offset="1" stopColor="#e3f6ff" />
          </linearGradient>
        </defs>
        {/* 270° arc, r = 11.5 around (13,13): starts at 9 o'clock, ends at 6 o'clock */}
        <path d="M 1.5 13 A 11.5 11.5 0 1 1 13 24.5" fill="none" stroke="url(#flo-arc)" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** 20px round glass avatar for an agent session, with a status ring/badge. */
export function ClaudeAvatar({ status, source, still }: { status: ClaudeSession["status"]; hot?: boolean; source?: string; still?: boolean }) {
  const working = status === "working";
  const look = sourceLook(source);
  return (
    <span className="relative flex h-5 w-5 items-center justify-center">
      {working && <WorkingArc still={still} />}
      <span
        className="relative flex h-5 w-5 items-center justify-center rounded-full"
        style={{
          background: working ? look.bgWorking : look.bg,
          // static rings only (nothing animates on an idle tray)
          boxShadow:
            status === "waiting_reply"
              ? "0 0 0 1.5px #66ceff, 0 0 8px rgba(102,206,255,0.4)"
              : status === "needs_approval"
                ? "0 0 0 1.5px #fbbf24, 0 0 8px rgba(251,191,36,0.4)"
                : "inset 0 1px 0 rgba(255,255,255,0.35)",
          opacity: working ? 0.75 : 1,
        }}
      >
        {look.icon}
      </span>
      {status === "done" && (
        <span className="absolute -bottom-[2px] -right-[3px] flex h-[10px] w-[10px] items-center justify-center rounded-full bg-brand-300 ring-[1.5px] ring-black">
          <Check size={7} strokeWidth={4} className="text-black" />
        </span>
      )}
    </span>
  );
}

function Chip({ children, badge, tone = "blue" }: { children: React.ReactNode; hot?: boolean; badge?: number; tone?: "blue" | "red" }) {
  return (
    <span className="relative flex h-5 min-w-5 items-center justify-center">
      <span
        className="flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white/85"
        style={{
          background: "linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04))",
          border: `1px solid ${tone === "red" ? "rgba(248,113,113,0.45)" : "rgba(150,215,255,0.28)"}`,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)",
        }}
      >
        {children}
      </span>
      {!!badge && (
        <span className="absolute -right-[5px] -top-[4px] flex h-[13px] min-w-[13px] items-center justify-center rounded-full bg-brand-400 px-[3px] text-[8.5px] font-bold leading-none text-black ring-[1.5px] ring-black">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </span>
  );
}

/** One stacked icon for every agent session: the most urgent one on top, a ghost disc behind
 *  when there are more, and a small count badge. Status (ring / check / stepped spinner) comes
 *  from the most urgent session. */
function AgentStack({ sessions, hot, still }: { sessions: ClaudeSession[]; hot?: boolean; still?: boolean }) {
  const top = sessions[0];
  const n = sessions.length;
  return (
    <span className="relative flex h-5 w-5 items-center justify-center">
      {n > 1 && (
        <span
          className="absolute h-5 w-5 rounded-full"
          style={{ transform: "translate(4px, -3px) scale(0.86)", background: sourceLook(sessions[1].source).bg, opacity: 0.45, boxShadow: "0 0 0 1.5px #000" }}
          aria-hidden
        />
      )}
      <ClaudeAvatar status={top.status} hot={hot} source={top.source} still={still} />
      {n > 1 && (
        <span
          className="absolute -right-[7px] -top-[5px] flex h-[13px] min-w-[13px] items-center justify-center rounded-full bg-white px-[3px] text-[8.5px] font-bold leading-none text-black ring-[1.5px] ring-black"
          data-testid="agents-count"
        >
          {n > 9 ? "9+" : n}
        </span>
      )}
    </span>
  );
}

export function TrayItemView({ item, hot, still }: { item: TrayItem; hot?: boolean; still?: boolean }) {
  switch (item.kind) {
    case "agents":
      return <AgentStack sessions={item.sessions} hot={hot} still={still} />;
    case "todos":
      return (
        <Chip hot={hot} badge={item.todos.length}>
          <CheckCircle2 size={11} className="text-brand-200" />
        </Chip>
      );
    case "meeting":
      return (
        <Chip hot={hot} tone="red">
          <span className="relative flex h-2 w-2">
            <span className="absolute inset-0 rounded-full bg-red-500 opacity-60 [animation:ping_1s_cubic-bezier(0,0,0.2,1)_3]" />
            <span className="relative h-2 w-2 rounded-full bg-red-500 shadow-[0_0_8px_#ef4444]" />
          </span>
        </Chip>
      );
  }
}

/** Items positioned in the wings (notch) — centred on the window/pill centre via slot.cx. */
export function TrayRow({
  items,
  slots,
  nh,
  hot,
  onItem,
  live = true,
}: {
  items: TrayItem[];
  slots: TraySlot[];
  /** unused: icons are anchored to the centre (kept so callers needn't change) */
  pillW?: number;
  nh: number;
  hot: number;
  onItem: (item: TrayItem) => void;
  /** the island is hovered / open (false = resting tray: nothing animates) */
  live?: boolean;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: nh }}>
      {items.map((it, i) => {
        const s = slots[i];
        if (!s) return null;
        // icons fade in place (no scale-pop); hover = a soft halo behind the icon (.tray-btn)
        return (
          <motion.button
            key={it.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ ...EASE, delay: Math.min(i, 5) * 0.015 }}
            data-hot={hot === i ? "true" : "false"}
            className="tray-btn pointer-events-auto absolute flex h-6 w-6 items-center justify-center"
            // anchored to the centre (= the camera), which never moves while the shape morphs; an
            // offset from the *target* width made icons jump mid-animation
            style={{ left: `calc(50% + ${s.cx - 12}px)`, top: (nh - 24) / 2 }}
            onClick={(e) => {
              e.stopPropagation();
              onItem(it);
            }}
            aria-label={it.kind === "agents" ? `Agents: ${it.sessions.length} · ${it.sessions[0].project} ${claudeStatusLabel(it.sessions[0].status)}` : it.kind}
          >
            <TrayItemView item={it} hot={hot === i} still={!live} />
          </motion.button>
        );
      })}
    </div>
  );
}

const btnGhost = "rounded-full px-2.5 py-[3px] text-[11px] font-medium text-white/65 transition hover:bg-white/10 hover:text-white";
const iconGhost = "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white/55 transition hover:bg-white/10 hover:text-white";
const btnPrimary =
  "flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[11px] font-semibold text-white transition hover:brightness-110 " +
  "bg-[linear-gradient(135deg,rgba(147,221,255,0.55),rgba(61,187,255,0.35))] border border-brand-200/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_6px_16px_-8px_rgba(61,187,255,0.9)]";

/** Glass tooltip card for a hovered tray item. */
export function TrayTooltip({
  item,
  rect,
  onOpen,
  onDismiss,
  onClearDone,
  onStartNotes,
  onIgnoreMeeting,
  onOpenTodos,
  onDoneTodo,
  onDeleteTodo,
  scale = 1,
}: {
  scale?: number;
  item: TrayItem;
  rect: { x: number; y: number; w: number; h: number };
  onOpen: (s: ClaudeSession) => void;
  onDismiss: (s: ClaudeSession) => void;
  onClearDone: () => void;
  onStartNotes: (app: string) => void;
  onIgnoreMeeting: (app: string) => void;
  onOpenTodos: () => void;
  /** tick a to-do off right in the list */
  onDoneTodo?: (t: Todo) => void;
  /** delete a to-do from the list */
  onDeleteTodo?: (t: Todo) => void;
}) {
  const ac = useAutoContinue(); // sessions waiting on a usage-limit reset
  return (
    <motion.div
      key={item.id}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -2, transition: { type: "tween", duration: 0.14, ease: [0.4, 0, 1, 1] } }}
      transition={{ type: "tween", duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="island-tip absolute z-20 overflow-hidden rounded-2xl text-white"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, transformOrigin: "top center" }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* content laid out at base size, zoomed to the Settings → Notch size (rect is already scaled) */}
      <div className="flex flex-col px-3 py-2.5" style={{ width: rect.w / scale, height: rect.h / scale, zoom: scale }}>
      {item.kind === "agents" && (
        <div className="flex h-full flex-col" data-testid="session-list">
          <div className="mb-1 flex h-[26px] shrink-0 items-center gap-1.5 text-[12px] font-semibold text-white/85">
            {item.sessions.length} session{item.sessions.length === 1 ? "" : "s"}
            <span className="ml-auto text-[10.5px] font-normal text-white/40">{item.sessions.filter((s) => s.status === "working").length} working</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" style={{ maxHeight: TRAY_LIST_ROW * 6 }}>
            {item.sessions.map((s) => (
              <div key={s.sessionId} className="group flex shrink-0 items-center gap-2 rounded-lg px-1 hover:bg-white/[0.05]" style={{ height: TRAY_LIST_ROW }} data-testid="session-row">
                <span className="flex w-5 shrink-0 scale-[0.85] justify-center">
                  <ClaudeAvatar status={s.status} source={s.source} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[12px] font-medium">{s.project}</span>
                    {acFor(ac, s.sessionId) ? (
                      <LimitStatus a={acFor(ac, s.sessionId)!} />
                    ) : (
                      <span className={"shrink-0 text-[10px] " + STATUS_COLOR[s.status]} title={claudeStatusLabel(s.status)}>
                        {SHORT_STATUS[s.status]}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-[10px] text-white/35">{relativeTime(s.updatedAt)}</span>
                  </span>
                  {acFor(ac, s.sessionId) ? <LimitLine a={acFor(ac, s.sessionId)!} /> : <span className="block truncate text-[11px] leading-tight text-white/50">{s.message || " "}</span>}
                </span>
                {acFor(ac, s.sessionId) && <LimitSwitch a={acFor(ac, s.sessionId)!} />}
                <button className={iconGhost} onClick={() => onOpen(s)} title="Open" aria-label={`Open ${s.project}`}>
                  <ExternalLink size={12} />
                </button>
                <button className={iconGhost + " opacity-60 group-hover:opacity-100"} onClick={() => onDismiss(s)} title="Dismiss" aria-label={`Dismiss ${s.project}`}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-auto flex h-[30px] shrink-0 items-center justify-end border-t border-white/[0.06] pt-1">
            <button className={btnGhost} disabled={!item.sessions.some((s) => s.status === "done")} onClick={onClearDone}>
              Clear done
            </button>
          </div>
        </div>
      )}
      {item.kind === "todos" && (
        <>
          <div className="mb-1 flex h-[26px] shrink-0 items-center gap-1.5 text-[12.5px] font-semibold">
            <CheckCircle2 size={13} className="text-brand-300" /> {item.todos.length} to-do{item.todos.length === 1 ? "" : "s"} need you
          </div>
          {/* every to-do, scrollable (it used to show only the first three), each one tickable */}
          <div className="flo-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain" style={{ maxHeight: TRAY_LIST_ROW * 6 }} data-testid="todo-tip-list">
            {item.todos.map((t) => {
              const why = t.reason || (t.due ? `due ${formatDue(t.due)}` : t.app ? `from ${t.app}` : t.person ? `from ${t.person}` : "");
              return (
                <div key={t.id} className="group flex shrink-0 items-center gap-2 rounded-lg px-1 hover:bg-white/[0.05]" style={{ height: TRAY_LIST_ROW }} data-testid="todo-tip-row">
                  <button
                    aria-label={`Done: ${t.title}`}
                    title="Mark done"
                    onClick={() => onDoneTodo?.(t)}
                    className="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-white/30 transition hover:border-brand-300 hover:bg-brand-300/20"
                  >
                    <Check size={9} strokeWidth={3.5} className="text-brand-200 opacity-0 group-hover:opacity-60" />
                  </button>
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate text-[12.5px] text-white/90">{t.title}</div>
                    {why && <div className="truncate text-[10.5px] text-white/45">{why}</div>}
                  </div>
                  <button
                    aria-label={`Delete: ${t.title}`}
                    title="Delete"
                    onClick={() => onDeleteTodo?.(t)}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white/40 opacity-0 transition hover:bg-red-500/15 hover:text-red-300 focus:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-auto flex shrink-0 justify-end pt-1">
            <button className={btnPrimary} onClick={onOpenTodos}>
              Open to-dos
            </button>
          </div>
        </>
      )}
      {item.kind === "meeting" && (
        <>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500 shadow-[0_0_10px_#ef4444]" />
            <span className="text-[13px] font-semibold">{item.app} call detected</span>
          </div>
          <p className="mt-1 text-[12px] text-white/65">Take notes? Flo will transcribe and summarize it on this Mac.</p>
          <div className="mt-auto flex justify-end gap-1">
            <button className={btnGhost} onClick={() => onIgnoreMeeting(item.app)}>
              Ignore
            </button>
            <button className={btnPrimary} onClick={() => onStartNotes(item.app)}>
              <Radio size={11} /> Start notes
            </button>
          </div>
        </>
      )}
      </div>
    </motion.div>
  );
}

/** "Send to Rahul on Slack?" — Flo never sends without this OK. */
export function ConfirmCard({
  c,
  more,
  notch,
  geo,
  onAnswer,
  ...perm
}: {
  c: ConfirmEvent;
  more: number;
  notch: boolean;
  geo: IslandGeometry;
  onAnswer: (approve: boolean | "terminal") => void;
  /** Claude permission queue: position, stepping, "Show all", focusing the session */
  index?: number;
  total?: number;
  onStep?: (delta: number) => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onOpen?: () => void;
}) {
  if (c.kind === "claude") return <ClaudePermissionCard c={c} notch={notch} geo={geo} onAnswer={onAnswer} {...perm} />;
  return (
    <CardRow
      notch={notch}
      geo={geo}
      testId="confirm-card"
      icon={
        <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden>
          <path fill="#E01E5A" d="M5 15a2 2 0 1 1-2-2h2v2Zm1 0a2 2 0 1 1 4 0v5a2 2 0 1 1-4 0v-5Z" />
          <path fill="#36C5F0" d="M9 5a2 2 0 1 1 2-2v2H9Zm0 1a2 2 0 1 1 0 4H4a2 2 0 1 1 0-4h5Z" />
          <path fill="#2EB67D" d="M19 9a2 2 0 1 1 2 2h-2V9Zm-1 0a2 2 0 1 1-4 0V4a2 2 0 1 1 4 0v5Z" />
          <path fill="#ECB22E" d="M15 19a2 2 0 1 1-2 2v-2h2Zm0-1a2 2 0 1 1 0-4h5a2 2 0 1 1 0 4h-5Z" />
        </svg>
      }
      actions={
        <div className="flex flex-col items-stretch gap-1">
          <button className={btnPrimary + " justify-center"} onClick={() => onAnswer(true)}>
            <Send size={11} /> Send
          </button>
          <button className={btnGhost} onClick={() => onAnswer(false)}>
            Cancel
          </button>
        </div>
      }
    >
      <div className="flex items-center gap-1.5">
        <span className="truncate text-[13px] font-semibold">{c.title}</span>
        {more > 0 && <span className="shrink-0 rounded-full bg-white/10 px-1.5 text-[10px] text-white/70">+{more}</span>}
      </div>
      <p className="selectable mt-1 line-clamp-3 rounded-xl border border-white/[0.06] bg-white/[0.04] px-2.5 py-1.5 text-[12.5px] leading-[17px] text-white/85">{c.body}</p>
    </CardRow>
  );
}

/** Where a Claude permission card came from, for the header. */
function permissionWho(c: ConfirmEvent) {
  const i = c.title.indexOf("·");
  const project = c.project || (i >= 0 ? c.title.slice(i + 1).trim() : "") || "Claude Code";
  return { project, tool: toolLabel(c.tool, c.body), app: appLabel(c.app) };
}

/** A command with its flags dimmed and quoted strings tinted (still plain, selectable text). */
function CommandText({ text }: { text: string }) {
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((p, i) =>
        /^\s+$/.test(p) ? (
          p
        ) : /^--?[\w-]/.test(p) ? (
          <span key={i} className="text-white/45">
            {p}
          </span>
        ) : /^["'`]/.test(p) ? (
          <span key={i} className="text-amber-200/85">
            {p}
          </span>
        ) : /^(&&|\|\||\||;|>|>>)$/.test(p) ? (
          <span key={i} className="text-[#d97757]">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function useWaited(c: ConfirmEvent) {
  const [first] = useState(() => (c.at && !Number.isNaN(Date.parse(c.at)) ? Date.parse(c.at) : Date.now()));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (now - first) / 1000;
}

/**
 * "blog-100-plan · Bash · iTerm · 12s … Open ↗" — a Claude Code permission prompt.
 * The card is sized from its content (islandSize("confirm", { claude, cmdLines })), so the command
 * and buttons are never clipped: up to 4 lines, "Show all" for longer ones (scrolls past 10).
 * Allow / Deny flash a confirmation, then the next queued question slides in.
 * Keys (when the island has focus): ⌘↩ Allow · ⎋ Deny.
 */
function ClaudePermissionCard({
  c,
  notch,
  geo,
  onAnswer,
  index = 0,
  total = 1,
  onStep,
  expanded = false,
  onToggleExpand,
  onOpen,
}: {
  c: ConfirmEvent;
  notch: boolean;
  geo: IslandGeometry;
  onAnswer: (a: boolean | "terminal") => void;
  index?: number;
  total?: number;
  onStep?: (delta: number) => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onOpen?: () => void;
}) {
  const who = permissionWho(c);
  const cmd = permissionCommand(c.body, c.tool);
  const lines = permissionCmdLines(c.body, c.tool);
  const long = lines > PERM_LINES;
  const visible = Math.min(lines, expanded ? PERM_LINES_MAX : PERM_LINES);
  const waited = useWaited(c);
  const [done, setDone] = useState<"allow" | "deny" | null>(null);
  const answer = (a: boolean) => {
    if (done) return;
    setDone(a ? "allow" : "deny");
    setTimeout(() => onAnswer(a), 650);
  };
  const answerRef = useRef(answer);
  answerRef.current = answer;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        answerRef.current(true);
      } else if (e.key === "Escape") answerRef.current(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const chip = "shrink-0 rounded-md bg-white/[0.08] px-1.5 py-[2px] text-[10.5px] font-medium leading-none text-white/65";
  return (
    <div className="absolute inset-x-0 bottom-0 flex flex-col px-4 pb-3" style={{ top: notch ? geo.notchHeight + ISLAND_GAP + 4 : 8 }} data-testid="claude-permission-card" data-session={c.sessionId}>
      {/* header: who's asking */}
      <div className="flex h-6 shrink-0 items-center gap-2">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inset-0 rounded-full bg-amber-400 opacity-60 [animation:ping_1.4s_cubic-bezier(0,0,0.2,1)_infinite]" />
          <span className="relative h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
        </span>
        <Folder size={13} className="shrink-0 text-white/50" />
        <span className="min-w-0 truncate text-[13.5px] font-semibold text-white" data-testid="perm-project" title={c.cwd || who.project}>
          {who.project}
        </span>
        <span className={chip} data-testid="perm-tool">
          {who.tool}
        </span>
        {who.app && <span className="shrink-0 truncate text-[11px] text-white/40">in {who.app}</span>}
        <span className="shrink-0 text-[11px] tabular-nums text-white/40" data-testid="perm-waited">
          · {waitedLabel(waited)}
        </span>
        <span className="flex-1" />
        {total > 1 && (
          <span className="flex shrink-0 items-center rounded-full bg-white/[0.06] text-[10.5px] tabular-nums text-white/65" data-testid="perm-queue">
            <button aria-label="Previous question" className="rounded-full p-0.5 hover:bg-white/10 disabled:opacity-30" disabled={index === 0} onClick={() => onStep?.(-1)}>
              <ChevronLeft size={12} />
            </button>
            <span className="px-0.5">
              {index + 1}/{total}
            </span>
            <button aria-label="Next question" className="rounded-full p-0.5 hover:bg-white/10 disabled:opacity-30" disabled={index >= total - 1} onClick={() => onStep?.(1)}>
              <ChevronRight size={12} />
            </button>
          </span>
        )}
        <button
          className="flex shrink-0 items-center gap-1 rounded-full bg-white/[0.08] px-2 py-[3px] text-[11px] font-medium text-white/80 hover:bg-white/[0.14] hover:text-white"
          onClick={onOpen}
          aria-label={`Open ${who.project}`}
          title={`Show the ${who.project} session${who.app ? ` in ${who.app}` : ""}`}
        >
          Open <ArrowUpRight size={11} />
        </button>
      </div>
      {/* the command */}
      <div className="relative mt-2 shrink-0 rounded-xl border border-white/[0.07] bg-white/[0.05] px-3 py-[7px]">
        <p
          className={"selectable whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-[12px] text-white/90 " + (expanded && lines > PERM_LINES_MAX ? "flo-scroll overflow-y-auto" : "overflow-hidden")}
          style={{ lineHeight: `${PERM_LINE}px`, maxHeight: visible * PERM_LINE }}
          data-testid="perm-command"
        >
          {c.tool === "Bash" || (!c.tool && /^Run:\s/.test(c.body.trim())) ? <span className="select-none text-white/30">$ </span> : null}
          <CommandText text={cmd} />
        </p>
        {long && (
          <button
            className="absolute bottom-[5px] right-2 rounded-md bg-[#141414] px-1.5 text-[10.5px] font-medium text-brand-200 shadow-[-10px_0_10px_#141414] hover:text-white"
            onClick={onToggleExpand}
          >
            {expanded ? "Show less" : "Show all"}
          </button>
        )}
      </div>
      {/* answer */}
      <div className="mt-[10px] flex h-7 shrink-0 items-center gap-1.5">
        {done ? (
          <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className={"ml-auto flex items-center gap-1.5 text-[12px] font-semibold " + (done === "allow" ? "text-emerald-300" : "text-white/60")}
            data-testid="perm-answered"
          >
            {done === "allow" ? <CheckCircle2 size={14} /> : <X size={14} />} {done === "allow" ? "Allowed" : "Denied"}
          </motion.span>
        ) : (
          <>
            <button className="mr-auto rounded-full px-2 py-1 text-[11px] text-white/45 hover:bg-white/10 hover:text-white/80" onClick={() => onAnswer("terminal")} title="Answer in the terminal instead">
              Answer in terminal
            </button>
            <button className={btnGhost + " flex items-center gap-1"} onClick={() => answer(false)} aria-label="Deny" title="Deny (esc)">
              <X size={12} /> Deny
            </button>
            <button className={btnPrimary + " flex items-center gap-1.5"} onClick={() => answer(true)} aria-label="Allow" title="Allow (⌘↩)">
              <Check size={12} strokeWidth={3} /> Allow <span className="text-[10px] font-medium opacity-60">⌘↩</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** "Did I mishear?" card below the notch. */
export function CorrectionCard({
  c,
  more,
  notch,
  geo,
  onSave,
  onIgnore,
  onUndo,
}: {
  c: CorrectionEvent;
  more: number;
  notch: boolean;
  geo: IslandGeometry;
  onSave: () => Promise<void>;
  onIgnore: () => void;
  /** undo a correction Flo already saved */
  onUndo: () => Promise<void>;
}) {
  // learned automatically → apologise and offer Undo; otherwise ask (older behaviour)
  const [state, setState] = useState<"learned" | "ask" | "saved" | "undone">(c.saved ? "learned" : "ask");
  const learned = state === "learned" || state === "undone";
  return (
    <CardRow
      notch={notch}
      geo={geo}
      testId="correction-card"
      icon={<Sparkles size={15} className="text-brand-300" />}
      actions={
        state === "saved" ? (
          <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-1 text-[11.5px] font-medium text-brand-200">
            <Check size={12} strokeWidth={3} /> Saved
          </motion.span>
        ) : state === "undone" ? (
          <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="text-[11.5px] font-medium text-white/60">
            Undone
          </motion.span>
        ) : state === "learned" ? (
          <>
            <button
              className={btnGhost}
              onClick={async () => {
                await onUndo();
                setState("undone");
              }}
            >
              Undo
            </button>
            <button className={btnPrimary} onClick={onIgnore} aria-label="Got it">
              Got it
            </button>
          </>
        ) : (
          <>
            <button className={btnGhost} onClick={onIgnore}>
              Ignore
            </button>
            <button
              className={btnPrimary}
              aria-label="Save to dictionary"
              title="Save to dictionary"
              onClick={async () => {
                await onSave();
                setState("saved");
              }}
            >
              Save
            </button>
          </>
        )
      }
    >
      <div className="flex items-center gap-1.5">
        <span className="truncate text-[13px] font-semibold">{learned ? "Sorry, my mistake" : "Did I mishear?"}</span>
        {more > 0 && <span className="shrink-0 rounded-full bg-white/10 px-1.5 text-[10.5px] text-white/70">+{more}</span>}
      </div>
      <p className="truncate text-[12.5px] leading-snug text-white/70">
        {learned ? "Updated: " : ""}
        <span className="text-white/45 line-through decoration-white/30">{c.heard}</span>
        <span className="mx-1.5 text-white/40">→</span>
        <span className="font-medium text-brand-200">{c.corrected}</span>
        {learned && <span className="text-white/45"> from now on</span>}
      </p>
    </CardRow>
  );
}

/** "Zoom call detected — Take notes?" card below the notch. */
export function MeetingPromptCard({
  app,
  notch,
  geo,
  onStart,
  onLater,
}: {
  app: string;
  notch: boolean;
  geo: IslandGeometry;
  onStart: () => void;
  onLater: () => void;
}) {
  return (
    <CardRow
      notch={notch}
      geo={geo}
      testId="meeting-prompt-card"
      icon={
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inset-0 rounded-full bg-red-500 opacity-60 [animation:ping_1s_cubic-bezier(0,0,0.2,1)_3]" />
          <span className="relative h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_10px_#ef4444]" />
        </span>
      }
      actions={
        <>
          <button className={iconGhost} onClick={onLater} aria-label="Not now" title="Not now">
            <X size={12} />
          </button>
          <button className={btnPrimary} onClick={onStart}>
            <Radio size={11} /> Start notes
          </button>
        </>
      }
    >
      <div className="truncate text-[13px] font-semibold">{app} call detected</div>
      <p className="truncate text-[12px] text-white/60">Take notes on this Mac?</p>
    </CardRow>
  );
}
