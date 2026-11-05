// Notch tray: live items in the wings beside the camera (Claude sessions, to-dos, meeting) +
// tooltips, the correction card and the meeting-detected prompt. Pure presentation; state lives
// in Island.tsx.
import { useState } from "react";
import { motion } from "motion/react";
import { Asterisk, Check, CheckCircle2, ExternalLink, MousePointer2, Radio, Send, Sparkles, Terminal, Webhook, X } from "lucide-react";
import { claudeStatusLabel, relativeTime, ISLAND_GAP, TRAY_LIST_ROW, type TraySlot } from "../lib/format";
import type { ClaudeSession, ConfirmEvent, CorrectionEvent, IslandGeometry, Todo } from "../lib/types";

export type TrayItem =
  | { id: string; kind: "claude"; session: ClaudeSession }
  | { id: "more"; kind: "more"; sessions: ClaudeSession[] }
  | { id: "todos"; kind: "todos"; todos: Todo[] }
  | { id: "meeting"; kind: "meeting"; app: string };

const SPRING = { type: "spring", stiffness: 520, damping: 30 } as const;

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

/** 20px round glass avatar for an agent session, with a status ring/badge. */
export function ClaudeAvatar({ status, hot, source }: { status: ClaudeSession["status"]; hot?: boolean; source?: string }) {
  const working = status === "working";
  const look = sourceLook(source);
  return (
    <motion.span animate={{ scale: hot ? 1.14 : 1 }} transition={SPRING} className="relative flex h-5 w-5 items-center justify-center">
      {working && (
        <span
          className="absolute -inset-[3px] rounded-full"
          style={{
            background: "conic-gradient(from 0deg, transparent 0 55%, #66ceff 85%, #e3f6ff 100%)",
            WebkitMask: "radial-gradient(circle, transparent 10.5px, #000 11px)",
            mask: "radial-gradient(circle, transparent 10.5px, #000 11px)",
            animation: "flo-spin 1.1s linear infinite",
          }}
        />
      )}
      <span
        className="relative flex h-5 w-5 items-center justify-center rounded-full"
        style={{
          background: working ? look.bgWorking : look.bg,
          boxShadow:
            status === "waiting_reply"
              ? "0 0 0 1.5px #66ceff, 0 0 10px rgba(102,206,255,0.45)"
              : status === "needs_approval"
                ? undefined
                : "inset 0 1px 0 rgba(255,255,255,0.35)",
          animation: status === "needs_approval" ? "flo-pulse-ring 1.6s ease-in-out infinite" : undefined,
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
    </motion.span>
  );
}

function Chip({ children, hot, badge, tone = "blue" }: { children: React.ReactNode; hot?: boolean; badge?: number; tone?: "blue" | "red" }) {
  return (
    <motion.span animate={{ scale: hot ? 1.14 : 1 }} transition={SPRING} className="relative flex h-5 min-w-5 items-center justify-center">
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
    </motion.span>
  );
}

export function TrayItemView({ item, hot }: { item: TrayItem; hot?: boolean }) {
  switch (item.kind) {
    case "claude":
      return <ClaudeAvatar status={item.session.status} hot={hot} source={item.session.source} />;
    case "more": {
      // all sessions: total count, badge = how many are still working
      const working = item.sessions.filter((s) => s.status === "working").length;
      return (
        <Chip hot={hot} badge={working}>
          {item.sessions.length}
        </Chip>
      );
    }
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
            <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-60" />
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
  pillW,
  nh,
  hot,
  onItem,
}: {
  items: TrayItem[];
  slots: TraySlot[];
  pillW: number;
  nh: number;
  hot: number;
  onItem: (item: TrayItem) => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: nh }}>
      {items.map((it, i) => {
        const s = slots[i];
        if (!s) return null;
        return (
          <motion.button
            key={it.id}
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.4 }}
            transition={{ ...SPRING, delay: Math.min(i, 5) * 0.03 }}
            className="pointer-events-auto absolute flex h-6 w-6 items-center justify-center"
            style={{ left: pillW / 2 + s.cx - 12, top: (nh - 24) / 2 }}
            onClick={(e) => {
              e.stopPropagation();
              onItem(it);
            }}
            aria-label={it.kind === "claude" ? `${it.session.project}: ${claudeStatusLabel(it.session.status)}` : it.kind}
          >
            <TrayItemView item={it} hot={hot === i} />
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
  onStartNotes,
  onIgnoreMeeting,
  onOpenTodos,
}: {
  item: TrayItem;
  rect: { x: number; y: number; w: number; h: number };
  onOpen: (s: ClaudeSession) => void;
  onDismiss: (s: ClaudeSession) => void;
  onStartNotes: (app: string) => void;
  onIgnoreMeeting: (app: string) => void;
  onOpenTodos: () => void;
}) {
  return (
    <motion.div
      key={item.id}
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 480, damping: 34 }}
      className="island-tip absolute z-20 flex flex-col overflow-hidden rounded-2xl px-3.5 py-3 text-white"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, transformOrigin: "top center" }}
      onClick={(e) => e.stopPropagation()}
    >
      {item.kind === "claude" && (
        <>
          <div className="flex items-center gap-2">
            <ClaudeAvatar status={item.session.status} source={item.session.source} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold leading-tight">{item.session.project}</div>
              <div className={"text-[11px] font-medium leading-tight " + STATUS_COLOR[item.session.status]}>{claudeStatusLabel(item.session.status)}</div>
            </div>
            <span className="shrink-0 text-[10.5px] text-white/40">{relativeTime(item.session.updatedAt)}</span>
          </div>
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-[16px] text-white/70">{item.session.message || "No message yet."}</p>
          <div className="mt-auto flex justify-end gap-1">
            <button className={iconGhost} onClick={() => onDismiss(item.session)} title="Dismiss" aria-label="Dismiss">
              <X size={13} />
            </button>
            <button className={btnPrimary} onClick={() => onOpen(item.session)} title="Open" aria-label="Open">
              <ExternalLink size={12} /> Open
            </button>
          </div>
        </>
      )}
      {item.kind === "more" && (
        <>
          <div className="mb-1 flex h-[26px] items-center gap-1.5 text-[12px] font-semibold text-white/85">
            <Asterisk size={12} strokeWidth={3} className="text-[#e0896a]" />
            {item.sessions.length} Claude sessions
            <span className="ml-auto text-[10.5px] font-normal text-white/40">
              {item.sessions.filter((s) => s.status === "working").length} working
            </span>
          </div>
          <div className="flex min-h-0 flex-col overflow-y-auto" style={{ maxHeight: TRAY_LIST_ROW * 6 }}>
            {item.sessions.map((s) => (
              <div key={s.sessionId} className="group flex shrink-0 items-center gap-2 rounded-lg px-1" style={{ height: TRAY_LIST_ROW }}>
                <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => onOpen(s)} aria-label={`Open ${s.project}`}>
                  <span className="scale-[0.8]">
                    <ClaudeAvatar status={s.status} source={s.source} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[12px] font-medium">{s.project}</span>
                      <span className={"shrink-0 text-[10px] " + STATUS_COLOR[s.status]} title={claudeStatusLabel(s.status)}>{SHORT_STATUS[s.status]}</span>
                    </span>
                    <span className="block truncate text-[11px] leading-tight text-white/50">{s.message || " "}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-white/35">{relativeTime(s.updatedAt)}</span>
                </button>
                <button className={iconGhost + " opacity-60 group-hover:opacity-100"} onClick={() => onDismiss(s)} title="Dismiss" aria-label={`Dismiss ${s.project}`}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {item.kind === "todos" && (
        <>
          <div className="mb-1 flex items-center gap-1.5 text-[12.5px] font-semibold">
            <CheckCircle2 size={13} className="text-brand-300" /> {item.todos.length} to-do{item.todos.length === 1 ? "" : "s"} need you
          </div>
          <div className="flex min-h-0 flex-col gap-[3px] overflow-hidden">
            {item.todos.slice(0, 3).map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-[12px] text-white/75">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-300" />
                <span className="truncate">{t.title}</span>
              </div>
            ))}
          </div>
          <div className="mt-auto flex justify-end">
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
    </motion.div>
  );
}

/** "Send to Rahul on Slack?" — Flo never sends without this OK. */
export function ConfirmCard({ c, more, notch, geo, onAnswer }: { c: ConfirmEvent; more: number; notch: boolean; geo: IslandGeometry; onAnswer: (approve: boolean) => void }) {
  return (
    <div className="absolute inset-x-0 bottom-0 flex flex-col px-4 pb-3" style={{ top: notch ? geo.notchHeight + ISLAND_GAP : 10 }} data-testid="confirm-card">
      <div className="flex items-center gap-2">
        <svg viewBox="0 0 24 24" width={15} height={15} aria-hidden>
          <path fill="#E01E5A" d="M5 15a2 2 0 1 1-2-2h2v2Zm1 0a2 2 0 1 1 4 0v5a2 2 0 1 1-4 0v-5Z" />
          <path fill="#36C5F0" d="M9 5a2 2 0 1 1 2-2v2H9Zm0 1a2 2 0 1 1 0 4H4a2 2 0 1 1 0-4h5Z" />
          <path fill="#2EB67D" d="M19 9a2 2 0 1 1 2 2h-2V9Zm-1 0a2 2 0 1 1-4 0V4a2 2 0 1 1 4 0v5Z" />
          <path fill="#ECB22E" d="M15 19a2 2 0 1 1-2 2v-2h2Zm0-1a2 2 0 1 1 0-4h5a2 2 0 1 1 0 4h-5Z" />
        </svg>
        <span className="truncate text-[13px] font-semibold">{c.title}</span>
        {more > 0 && <span className="ml-auto rounded-full bg-white/10 px-1.5 text-[10px] text-white/70">+{more}</span>}
      </div>
      <p className="selectable mt-1.5 line-clamp-3 rounded-xl border border-white/[0.06] bg-white/[0.04] px-2.5 py-1.5 text-[12.5px] leading-[17px] text-white/85">{c.body}</p>
      <div className="mt-auto flex justify-end gap-1">
        <button className={btnGhost} onClick={() => onAnswer(false)}>
          Cancel
        </button>
        <button className={btnPrimary} onClick={() => onAnswer(true)}>
          <Send size={11} /> Send
        </button>
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
}: {
  c: CorrectionEvent;
  more: number;
  notch: boolean;
  geo: IslandGeometry;
  onSave: () => Promise<void>;
  onIgnore: () => void;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="absolute inset-x-0 bottom-0 flex flex-col px-4 pb-3" style={{ top: notch ? geo.notchHeight + ISLAND_GAP : 10 }}>
      <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-white/60">
        <Sparkles size={12} className="text-brand-300" /> Did I mishear?
        <span className="font-normal text-white/35">· {c.app}</span>
        {more > 0 && <span className="ml-auto rounded-full bg-white/10 px-1.5 text-[10px] text-white/70">+{more}</span>}
      </div>
      <div className="mt-1.5 flex items-baseline gap-2 text-[15px]">
        <span className="text-white/40 line-through decoration-white/40">{c.heard}</span>
        <span className="text-white/35">→</span>
        <span className="font-semibold text-brand-200 drop-shadow-[0_0_10px_rgba(102,206,255,0.45)]">{c.corrected}</span>
      </div>
      <div className="mt-auto flex items-center justify-end gap-1">
        {saved ? (
          <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-1 text-[11.5px] font-medium text-brand-200">
            <Check size={12} strokeWidth={3} /> Saved. I'll spell it right next time
          </motion.span>
        ) : (
          <>
            <button className={btnGhost} onClick={onIgnore}>
              Ignore
            </button>
            <button
              className={btnPrimary}
              onClick={async () => {
                await onSave();
                setSaved(true);
              }}
            >
              Save to dictionary
            </button>
          </>
        )}
      </div>
    </div>
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
    <div className="absolute inset-x-0 bottom-0 flex flex-col px-4 pb-3" style={{ top: notch ? geo.notchHeight + ISLAND_GAP : 10 }}>
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inset-0 animate-ping rounded-full bg-red-500 opacity-60" />
          <span className="relative h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_10px_#ef4444]" />
        </span>
        <span className="text-[13px] font-semibold">{app} call detected</span>
        <button className="ml-auto rounded-full p-1 text-white/45 hover:bg-white/10 hover:text-white" onClick={onLater} aria-label="Not now">
          <X size={12} />
        </button>
      </div>
      <p className="mt-1 text-[12px] text-white/60">Take notes? I'll transcribe and summarize it on this Mac.</p>
      <div className="mt-auto flex justify-end gap-1">
        <button className={btnGhost} onClick={onLater}>
          Not now
        </button>
        <button className={btnPrimary} onClick={onStart}>
          <Radio size={11} /> Start notes
        </button>
      </div>
    </div>
  );
}
