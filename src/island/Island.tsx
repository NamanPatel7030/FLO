import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import { api, isTauri, on } from "../lib/api";
import {
  formatHotkey,
  hitTestTray,
  islandSize,
  ISLAND_EAR,
  peekTileAt,
  SWELL_X,
  SWELL_Y,
  tooltipRect,
  trayLayout,
  wantsFix,
  type CardContent,
  type IslandVariant,
} from "../lib/format";
import { isStuck } from "../lib/format";
import {
  EV,
  type AssistantResponse,
  type ClaudeEvent,
  type ClaudeSession,
  type CorrectionEvent,
  type Dictation,
  type HoverEvent,
  type IslandGeometry,
  type MeetingDetectedEvent,
  type MeetingEvent,
  type Mode,
  type Phase,
  type Settings,
  type StateEvent,
  type Todo,
  type TranscriptEvent,
} from "../lib/types";
import { IslandContent, PEEK_ACTIONS } from "./IslandContent";
import { CorrectionCard, MeetingPromptCard, TrayItemView, TrayRow, TrayTooltip, type TrayItem } from "./Tray";
import { runDemo } from "./demo";

export interface MeetingInfo {
  live: boolean;
  noteId?: string;
  startedAt: number;
  lastLine?: string;
  summary?: string;
}

const SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.9 } as const;
const COLLAPSE_MS = 520;
const DONE_MS = 1500;
const ERROR_MS = 5000;
const RESULT_MS = 2600;
const DWELL_MS = 180;
const CLAUDE_CARD_MS = 4000;
const CORRECTION_MS = 10000;
const MEETING_PROMPT_MS = 8000;
const MAX_AVATARS = 5;

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** To-dos worth a tray badge: open & due today/overdue, or new from Attention (last 24h). */
function urgentTodos(todos: Todo[]): Todo[] {
  const today = todayStr();
  const dayAgo = Date.now() - 86_400_000;
  return todos.filter(
    (t) => t.status === "open" && ((t.due && t.due.slice(0, 10) <= today) || (t.source === "attention" && new Date(t.createdAt).getTime() > dayAgo)),
  );
}

export default function Island() {
  const [geo, setGeo] = useState<IslandGeometry | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const lastStateAt = useRef(Date.now());
  const lastLevelAt = useRef(0);
  useEffect(() => on<{ rms: number }>(EV.level, () => (lastLevelAt.current = Date.now())), []);
  const [mode, setMode] = useState<Mode>("dictation");
  const [message, setMessage] = useState<string | undefined>();
  const [card, setCard] = useState<AssistantResponse | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [history, setHistory] = useState<Dictation[] | null>(null);
  const [claudeQueue, setClaudeQueue] = useState<ClaudeEvent[]>([]);
  const [meeting, setMeeting] = useState<MeetingInfo>({ live: false, startedAt: 0 });
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [corrections, setCorrections] = useState<CorrectionEvent[]>([]);
  const [detected, setDetected] = useState<string | null>(null);
  const [ignoredDetect, setIgnoredDetect] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  // hover: backend cursor tracking (non-activating panel) + DOM fallback
  const [pos, setPos] = useState<HoverEvent>({ inside: false });
  const [dwell, setDwell] = useState(false);
  const reduce = useReducedMotion();
  const modeRef = useRef<Mode>("dictation");
  const rootRef = useRef<HTMLDivElement>(null);
  const hover = pos.inside;

  useEffect(() => {
    api.getIslandGeometry().then(setGeo);
    api.getSettings().then(setSettings).catch(() => {});
    api.listClaudeSessions().then(setSessions);
    api.listTodos().then(setTodos).catch(() => {});
  }, []);

  // ── backend events ──────────────────────────────────────────────────────
  useEffect(() => {
    const offs = [
      on<StateEvent>(EV.state, (e) => {
        lastStateAt.current = Date.now();
        setPhase(e.phase);
        setMode(e.mode);
        modeRef.current = e.mode;
        setMessage(e.message);
        if (e.mode === "meeting" && e.phase === "listening") setMeeting((m) => (m.live ? m : { live: true, startedAt: Date.now() }));
        if (e.phase === "listening" && e.mode !== "meeting") {
          setCard(null);
          setResult(null);
          setHistory(null);
          api.getSettings().then(setSettings).catch(() => {});
        }
      }),
      on<TranscriptEvent>(EV.transcript, (t) => {
        if (t.final && modeRef.current !== "assistant" && t.text.trim()) setResult(t.text.trim());
      }),
      on<AssistantResponse>(EV.assistant, (r) => setCard(r)),
      on<ClaudeEvent | null>(EV.claude, (e) => {
        if (e && e.id) setClaudeQueue((q) => (q.some((x) => x.id === e.id) ? q : [...q, e]));
      }),
      on<ClaudeSession[]>(EV.claudeSessions, (list) => setSessions(Array.isArray(list) ? list : [])),
      on<null>(EV.todos, () => api.listTodos().then(setTodos).catch(() => {})),
      on<CorrectionEvent>(EV.correction, (c) => c && setCorrections((q) => (q.some((x) => x.id === c.id) ? q : [...q, c]))),
      on<MeetingDetectedEvent>(EV.meetingDetected, (e) => {
        if (e.active) {
          setDetected(e.app);
          setPromptOpen(true);
        } else {
          setDetected(null);
          setPromptOpen(false);
          setIgnoredDetect(null);
        }
      }),
      on<MeetingEvent>(EV.meeting, (e) => {
        if (!e.live) {
          setMeeting({ live: false, startedAt: 0 });
          setMeetingOpen(false);
          return;
        }
        setPromptOpen(false);
        setMeeting((m) => ({
          live: true,
          noteId: e.noteId,
          startedAt: m.live ? m.startedAt : Date.now() - e.elapsedSec * 1000,
          lastLine: e.segment?.text ?? m.lastLine,
          summary: e.summary ?? m.summary,
        }));
      }),
      on<HoverEvent>(EV.hover, (e) => setPos(e && typeof e === "object" ? e : { inside: false })),
    ];
    return () => offs.forEach((f) => f());
  }, []);

  const openHistory = useCallback(() => {
    api.listHistory(6).then((h) => setHistory(h)).catch(() => setHistory([]));
  }, []);

  // demo driver (browser only, ?demo=…)
  useEffect(() => {
    const demo = new URLSearchParams(location.search).get("demo");
    if (!isTauri && demo) return runDemo(demo, { setPos, setMeetingOpen, openHistory });
  }, [openHistory]);

  // ── hover dwell: swell first, then open ─────────────────────────────────
  useEffect(() => {
    if (!hover) {
      setDwell(false);
      return;
    }
    const t = setTimeout(() => setDwell(true), reduce ? 0 : DWELL_MS);
    return () => clearTimeout(t);
  }, [hover, reduce]);

  // ── local timers: never get stuck on done / error / result ──────────────
  useEffect(() => {
    if (phase !== "done" && phase !== "error") return;
    if (phase === "error" && hover) return;
    const t = setTimeout(() => setPhase((p) => (p === phase ? "idle" : p)), phase === "done" ? DONE_MS : ERROR_MS);
    return () => clearTimeout(t);
  }, [phase, hover]);

  useEffect(() => {
    if (!result || hover) return;
    const t = setTimeout(() => setResult(null), RESULT_MS);
    return () => clearTimeout(t);
  }, [result, hover]);

  useEffect(() => {
    if (!card || hover) return;
    const t = setTimeout(() => setCard(null), 8000);
    return () => clearTimeout(t);
  }, [card, hover]);

  const headClaude = claudeQueue[0];
  useEffect(() => {
    if (!headClaude || hover) return;
    const t = setTimeout(() => setClaudeQueue((q) => q.slice(1)), CLAUDE_CARD_MS);
    return () => clearTimeout(t);
  }, [headClaude, hover]);

  const headFix = corrections[0];
  useEffect(() => {
    if (!headFix || hover) return;
    const t = setTimeout(() => setCorrections((q) => q.slice(1)), CORRECTION_MS);
    return () => clearTimeout(t);
  }, [headFix, hover]);

  useEffect(() => {
    if (!promptOpen || hover) return;
    const t = setTimeout(() => setPromptOpen(false), MEETING_PROMPT_MS);
    return () => clearTimeout(t);
  }, [promptOpen, hover]);

  // ── tray items ──────────────────────────────────────────────────────────
  const trayItems = useMemo(() => {
    const ses: TrayItem[] = sessions.slice(0, MAX_AVATARS).map((s) => ({ id: `claude:${s.sessionId}`, kind: "claude", session: s }));
    if (sessions.length > MAX_AVATARS) ses.push({ id: "more", kind: "more", sessions: sessions.slice(MAX_AVATARS) });
    const others: TrayItem[] = [];
    const urgent = urgentTodos(todos);
    if (urgent.length) others.push({ id: "todos", kind: "todos", todos: urgent });
    if (detected && !meeting.live && ignoredDetect !== detected) others.push({ id: "meeting", kind: "meeting", app: detected });
    let left = ses;
    let right = others;
    // balance when one side is empty
    if ((!left.length || !right.length) && left.length + right.length > 1) {
      const all = [...left, ...right];
      left = all.slice(0, Math.ceil(all.length / 2));
      right = all.slice(Math.ceil(all.length / 2));
    }
    return { left, right, all: [...left, ...right] };
  }, [sessions, todos, detected, meeting.live, ignoredDetect]);

  const notch = !!geo && geo.platform === "macos" && geo.hasNotch;
  const layout = geo && notch ? trayLayout(geo, trayItems.left.length, trayItems.right.length) : null;

  // ── resize protocol state ───────────────────────────────────────────────
  const [shown, setShown] = useState<IslandVariant>("collapsed");
  const [shownContent, setShownContent] = useState<CardContent | undefined>();
  const winSize = useRef<{ width: number; height: number } | null>(null);
  const shrinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // hit-testing (notch): which tray item / peek tile is under the cursor
  const winW = winSize.current?.width ?? 0;
  const nh = geo?.notchHeight ?? 0;
  const lastTip = useRef<number>(-1);
  const hitItem = useMemo(() => {
    if (!notch || !layout || !hover || pos.x === undefined || pos.y === undefined) return -1;
    const i = hitTestTray(layout.slots, winW, pos.x, pos.y, nh);
    if (i >= 0) return i;
    // keep the tooltip while the cursor travels into it
    if (shown === "trayTooltip" && lastTip.current >= 0) {
      const s = layout.slots[lastTip.current];
      if (s) {
        const r = tooltipRect(winW, s.cx, nh);
        if (pos.x >= r.x - 4 && pos.x <= r.x + r.w + 4 && pos.y >= nh - 2 && pos.y <= r.y + r.h + 4) return lastTip.current;
      }
    }
    return -1;
  }, [notch, layout, hover, pos.x, pos.y, winW, nh, shown]);
  // DOM fallback for non-notch / browser: per-item hover
  const [domItem, setDomItem] = useState(-1);
  const tipIdx = notch ? hitItem : hover ? domItem : -1;
  useEffect(() => {
    lastTip.current = tipIdx;
  }, [tipIdx]);
  const tipItem = tipIdx >= 0 ? trayItems.all[tipIdx] : undefined;

  // ── target variant ──────────────────────────────────────────────────────
  const target: IslandVariant = useMemo(() => {
    if (mode !== "meeting" && phase === "listening") return "listening";
    if (phase === "transcribing" || phase === "thinking") return "working";
    if (phase === "error") return "error";
    if (result) return "result";
    if (phase === "done" && mode !== "assistant") return "done";
    if (headFix) return "correction";
    if (promptOpen && detected && !meeting.live) return "meetingPrompt";
    if (card) return "card";
    if (headClaude) return "claude";
    if (history) return "history";
    if (meeting.live) return meetingOpen ? "meetingExpanded" : "meeting";
    if (hover && dwell && tipItem) return "trayTooltip";
    if (hover && dwell) return "peek";
    if (trayItems.all.length) return "tray";
    return "collapsed";
  }, [phase, mode, result, headFix, promptOpen, detected, card, headClaude, history, meeting.live, meetingOpen, hover, dwell, tipItem, trayItems.all.length]);

  const swell = hover && !dwell && (target === "collapsed" || target === "tray");
  const trayCounts = { trayLeft: trayItems.left.length, trayRight: trayItems.right.length };

  const contentFor = (v: IslandVariant): CardContent | undefined => {
    switch (v) {
      case "card":
        return card ? { replyChars: card.reply.length, results: card.results.length } : undefined;
      case "error":
        return { textChars: (message ?? "Something went wrong").length, action: wantsFix(message) };
      case "result":
        return { textChars: result?.length ?? 0 };
      case "history":
        return { rows: Math.max(1, history?.length ?? 1) };
      case "collapsed":
        return swell ? { swell: true } : undefined;
      case "tray":
        return { ...trayCounts, swell };
      case "peek":
        return trayCounts;
      case "trayTooltip":
        return { ...trayCounts, tipCx: layout?.slots[tipIdx]?.cx ?? 0 };
      default:
        return undefined;
    }
  };
  const content = contentFor(target);
  const contentKey = JSON.stringify(content ?? null);

  useEffect(() => {
    if (!geo) return;
    const next = islandSize(target, geo, content);
    const cur = winSize.current ?? next;
    const union = { width: Math.max(cur.width, next.width), height: Math.max(cur.height, next.height) };
    if (shrinkTimer.current) clearTimeout(shrinkTimer.current);
    const grow = !winSize.current || union.width !== cur.width || union.height !== cur.height;
    const apply = () => {
      setShown(target);
      setShownContent(content);
      shrinkTimer.current = setTimeout(
        () => {
          if (winSize.current?.width !== next.width || winSize.current?.height !== next.height) {
            winSize.current = next;
            api.islandResize(next.width, next.height);
          }
        },
        reduce ? 0 : COLLAPSE_MS,
      );
    };
    if (grow) {
      winSize.current = union;
      api.islandResize(union.width, union.height).finally(apply);
    } else apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, geo, reduce, contentKey]);

  // Esc: cancel / dismiss · click-away (window blur) closes transient cards
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (phase === "listening" && mode !== "meeting") api.cancelSession();
      else if (history) setHistory(null);
      else if (headFix) setCorrections((q) => q.slice(1));
      else if (card) setCard(null);
      else if (result) setResult(null);
      else if (phase === "error") setPhase("idle");
      else if (headClaude) setClaudeQueue((q) => q.slice(1));
      else if (promptOpen) setPromptOpen(false);
      else setMeetingOpen(false);
    };
    const onBlur = () => {
      setCard(null);
      setHistory(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [phase, mode, card, headClaude, history, result, headFix, promptOpen]);

  // watchdog: if the backend stopped confirming activity, return to idle (never spin forever)
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      if (isStuck(phase, mode, now - lastStateAt.current, now - lastLevelAt.current)) {
        setPhase("idle");
        lastStateAt.current = now;
      }
    }, 2000);
    return () => clearInterval(t);
  }, [phase, mode]);

  const dismissClaude = useCallback((seen: boolean) => {
    setClaudeQueue((q) => {
      // "Open" jumps to the editor / terminal where the session runs (and marks it seen)
      if (seen && q[0]) api.openClaudeSession(q[0].id).catch(() => api.markClaudeSeen(q[0].id));
      return q.slice(1);
    });
  }, []);

  const removeSession = (id: string) => setSessions((list) => list.filter((s) => s.sessionId !== id));
  const openSession = (s: ClaudeSession) => {
    if (s.status !== "working") removeSession(s.sessionId);
    api.openClaudeBySession(s.sessionId).catch(() => {});
    setPos({ inside: false });
  };
  const dismissSession = (s: ClaudeSession) => {
    removeSession(s.sessionId);
    api.dismissClaudeSession(s.sessionId).catch(() => {});
  };
  const startNotes = (app: string) => {
    setPromptOpen(false);
    api.startMeeting(`${app} call`).catch(() => {});
  };
  const ignoreMeeting = (app: string) => {
    setIgnoredDetect(app);
    setPromptOpen(false);
  };
  const onTrayItem = (it: TrayItem) => {
    if (it.kind === "claude") openSession(it.session);
    else if (it.kind === "todos") api.openDashboard("todos");
    else if (it.kind === "meeting") setPromptOpen(true);
    else api.openDashboard("home");
  };

  // DOM mouse tracking (browser preview; harmless in Tauri alongside backend events)
  const onMouseMove = (e: React.MouseEvent) => {
    const r = rootRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ inside: true, x: e.clientX - r.left, y: e.clientY - r.top });
  };

  if (!geo) return null;

  const size = islandSize(shown, geo, shownContent);
  const collapsed = shown === "collapsed" && !shownContent?.swell;
  const swollen = !!shownContent?.swell;
  const EAR = ISLAND_EAR;
  const compact = shown === "done";
  const stage = !isTauri; // browser preview: draw a fake desktop behind
  const win = winSize.current ?? size;
  const showTray = ["tray", "trayTooltip", "peek"].includes(shown) && trayItems.all.length > 0;
  const trayW = layout?.width ?? 0;

  // pill geometry (the black shape); tooltip / glow live outside it
  const pill = notch
    ? collapsed
      ? { width: size.width, height: size.height }
      : shown === "collapsed" && swollen
        ? { width: geo.notchWidth + 2 * SWELL_X, height: geo.notchHeight + SWELL_Y }
        : shown === "tray"
          ? { width: trayW - 2 * EAR + (swollen ? 2 * SWELL_X : 0), height: geo.notchHeight + (swollen ? SWELL_Y : 0) }
          : shown === "trayTooltip"
            ? { width: trayW - 2 * EAR, height: geo.notchHeight }
            : { width: size.width - EAR * 2, height: size.height }
    : { width: size.width - 24, height: size.height - 24 };
  const bigCard = ["card", "claude", "meetingExpanded", "peek", "history", "result", "error", "correction", "meetingPrompt"].includes(shown);
  const radius = notch
    ? collapsed
      ? "0 0 9px 9px"
      : bigCard
        ? "0 0 22px 22px"
        : compact || shown === "tray" || shown === "trayTooltip" || swollen
          ? "0 0 13px 13px"
          : "0 0 18px 18px"
    : bigCard
      ? "22px"
      : "999px";

  const hotTile = shown === "peek" && pos.x !== undefined && pos.y !== undefined ? peekTileAt(win.width, pill.width, pos.x, pos.y, nh, PEEK_ACTIONS) : -1;
  const keys = {
    dict: geo.platform === "windows" ? "Right Ctrl" : formatHotkey(settings?.hotkeyDictation ?? "ctrl"),
    asst: geo.platform === "windows" ? "Right Alt" : formatHotkey(settings?.hotkeyAssistant ?? "fn"),
  };

  const glow = notch && (swollen || shown === "listening");
  const island = (
    <div
      ref={rootRef}
      data-island-root
      className="relative"
      style={{
        width: stage ? win.width : "100vw",
        height: stage ? win.height : "100vh",
        display: "flex",
        justifyContent: notch ? "center" : "flex-end",
        alignItems: notch ? "flex-start" : "flex-end",
        padding: notch ? 0 : 12,
        boxSizing: "border-box",
      }}
      onMouseEnter={(e) => onMouseMove(e)}
      onMouseMove={onMouseMove}
      onMouseLeave={() => {
        setPos({ inside: false });
        setDomItem(-1);
      }}
    >
      <motion.div
        layout
        initial={false}
        animate={{ width: pill.width, height: pill.height, borderRadius: radius }}
        transition={SPRING}
        className={notch ? "relative bg-black text-white" : "relative text-white"}
        style={
          notch
            ? {
                overflow: "visible",
                boxShadow: glow
                  ? "inset 0 -1px 0 rgba(102,206,255,0.7), 0 4px 14px -4px rgba(61,187,255,0.55)"
                  : shown === "error"
                    ? "inset 0 -1px 0 rgba(252,211,77,0.35)"
                    : bigCard
                      ? "inset 0 -1px 0 rgba(147,221,255,0.14)"
                      : "none",
                transition: "box-shadow 0.25s ease",
              }
            : {
                background: "linear-gradient(180deg, rgba(10,16,24,0.80), rgba(2,4,8,0.88))",
                backdropFilter: "blur(30px) saturate(180%)",
                WebkitBackdropFilter: "blur(30px) saturate(180%)",
                border: `1px solid ${hover ? "rgba(147,221,255,0.32)" : "rgba(147,221,255,0.16)"}`,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10), 0 14px 36px -10px rgba(0,0,0,0.7), 0 0 0 0.5px rgba(0,0,0,0.6)",
                overflow: "hidden",
                transition: "border-color 0.25s ease",
              }
        }
      >
        {notch && !collapsed && <Ears size={EAR} />}
        <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: radius }}>
          {/* tiny shimmer along the bottom rim while swelling */}
          {notch && swollen && !reduce && (
            <span
              className="pointer-events-none absolute bottom-0 left-0 h-px w-1/3"
              style={{ background: "linear-gradient(90deg, transparent, #e3f6ff, transparent)", animation: "flo-shimmer-x 0.9s ease-out 1" }}
            />
          )}
          {/* Only the current content is rendered (enter animation only). Exit animations could leave
              ghost content — e.g. a frozen spinner — on screen if they were ever interrupted. */}
          {(
            <motion.div
              key={shown + (shown === "claude" ? headClaude?.id : "") + (shown === "correction" ? headFix?.id : "")}
              className="absolute inset-0"
              initial={{ opacity: 0, filter: "blur(6px)", scale: 0.97 }}
              animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
              transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {shown === "correction" && headFix ? (
                <CorrectionCard
                  c={headFix}
                  more={corrections.length - 1}
                  notch={notch}
                  geo={geo}
                  onIgnore={() => setCorrections((q) => q.slice(1))}
                  onSave={async () => {
                    await api.acceptCorrection(headFix.heard, headFix.corrected).catch(() => {});
                    setTimeout(() => setCorrections((q) => q.filter((x) => x.id !== headFix.id)), 1300);
                  }}
                />
              ) : shown === "meetingPrompt" && detected ? (
                <MeetingPromptCard app={detected} notch={notch} geo={geo} onStart={() => startNotes(detected)} onLater={() => setPromptOpen(false)} />
              ) : shown === "tray" || shown === "trayTooltip" ? (
                notch ? null : (
                  <WinTray items={trayItems.all} onItem={onTrayItem} onHover={setDomItem} />
                )
              ) : (
                <IslandContent
                  variant={shown}
                  notch={notch}
                  geo={geo}
                  phase={phase}
                  mode={mode}
                  message={message}
                  card={card}
                  result={result}
                  history={history}
                  claude={headClaude}
                  claudeMore={Math.max(0, claudeQueue.length - 1)}
                  meeting={meeting}
                  hotTile={hotTile}
                  keys={keys}
                  onCloseCard={() => setCard(null)}
                  onCloseError={() => setPhase("idle")}
                  onCloseHistory={() => setHistory(null)}
                  onOpenHistory={openHistory}
                  onClaude={dismissClaude}
                  onToggleMeeting={() => setMeetingOpen((v) => !v)}
                />
              )}
            </motion.div>
          )}
          {notch && showTray && layout && (
            <AnimatePresence>
              <TrayRow items={trayItems.all} slots={layout.slots} pillW={pill.width} nh={geo.notchHeight} hot={tipIdx} onItem={onTrayItem} />
            </AnimatePresence>
          )}
        </div>
      </motion.div>
      <AnimatePresence>
        {shown === "trayTooltip" && tipItem && (
          <TrayTooltip
            item={tipItem}
            rect={
              notch && layout
                ? tooltipRect(win.width, layout.slots[tipIdx]?.cx ?? 0, geo.notchHeight)
                : { x: Math.max(8, win.width - 12 - 300), y: 4, w: 300, h: 118 }
            }
            onOpen={openSession}
            onDismiss={dismissSession}
            onStartNotes={startNotes}
            onIgnoreMeeting={ignoreMeeting}
            onOpenTodos={() => api.openDashboard("todos")}
          />
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <MotionConfig reducedMotion="user">
      {stage ? (
        <Stage notch={notch} nh={geo.notchHeight}>
          {island}
        </Stage>
      ) : (
        island
      )}
    </MotionConfig>
  );
}

/** Windows / no-notch: tray items in a row inside the capsule (DOM hover works there). */
function WinTray({ items, onItem, onHover }: { items: TrayItem[]; onItem: (i: TrayItem) => void; onHover: (i: number) => void }) {
  return (
    <div className="flex h-full items-center justify-center gap-1 px-3">
      {items.map((it, i) => (
        <button key={it.id} className="flex h-6 w-6 items-center justify-center" onMouseEnter={() => onHover(i)} onClick={() => onItem(it)}>
          <TrayItemView item={it} />
        </button>
      ))}
    </div>
  );
}

/** Concave "ears" that blend the expanded island into the menu bar edge. */
function Ears({ size }: { size: number }) {
  const ear = (side: "left" | "right") => (
    <div
      className="absolute top-0"
      style={{
        [side]: -size,
        width: size,
        height: size,
        background: `radial-gradient(circle at ${side === "left" ? "0 100%" : "100% 100%"}, transparent ${size - 0.5}px, #000 ${size}px)`,
      }}
    />
  );
  return (
    <>
      {ear("left")}
      {ear("right")}
    </>
  );
}

/** Browser-only preview stage: fake wallpaper + menu bar, so the island is visible. */
function Stage({ notch, nh, children }: { notch: boolean; nh: number; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{
        background:
          "radial-gradient(1100px 600px at 20% 0%, #0b3b5c 0%, transparent 60%), radial-gradient(900px 700px at 90% 85%, #0a2a44 0%, transparent 55%), linear-gradient(160deg,#04070c,#000)",
      }}
    >
      {notch ? (
        <>
          <div
            className="absolute inset-x-0 top-0 flex items-center justify-between px-4 text-[13px] text-white/85"
            style={{ height: nh, background: "rgba(20,20,30,0.35)", backdropFilter: "blur(20px)" }}
          >
            <span className="font-semibold"> Flo</span>
            <span>Wed 5 Nov 12:41</span>
          </div>
          <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2">{children}</div>
        </>
      ) : (
        <>
          <div className="absolute inset-x-0 bottom-0 h-12" style={{ background: "rgba(20,20,30,0.6)", backdropFilter: "blur(20px)" }} />
          <div className="absolute bottom-12 right-0 z-10">{children}</div>
        </>
      )}
    </div>
  );
}
