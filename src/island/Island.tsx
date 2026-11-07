import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import { api, isTauri, on } from "../lib/api";
import {
  formatHotkey,
  islandSize,
  pickTip,
  TRAY_TIP_H,
  trayTipHeight,
  ISLAND_EAR,
  ISLAND_WING,
  peekTileAt,
  SWELL_X,
  SWELL_Y,
  tooltipRect,
  trayLayout,
  wantsFix,
  type CardContent,
  type IslandVariant,
} from "../lib/format";
import { isStuck, sessionsByUrgency } from "../lib/format";
import { toPlainText } from "../lib/markdown";
import { isSignInError } from "../lib/account";
import {
  EV,
  type AssistantResponse,
  type ClaudeEvent,
  type ClaudeSession,
  type ConfirmEvent,
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
import { ConfirmCard, CorrectionCard, MeetingPromptCard, TrayItemView, TrayRow, TrayTooltip, type TrayItem } from "./Tray";
import { runDemo } from "./demo";
import { NotchViz } from "./Ribbon";
import { Widgets } from "./Widgets";
import { AgentCard, type AgentState } from "./AgentCard";
import { loadWidgets, onWidgetsChange, widgetsBodyHeight, type WidgetId } from "../lib/widgets";
import { applyTheme, onNotchPreview, onSettingsBroadcast, watchSystemTheme } from "../lib/theme";
import { isStopped, markStopped, stopMeetingNow } from "../lib/meetingStops";
import { playConfigured } from "../lib/cueSounds";
import { getNotchScale, setNotchScale } from "../lib/format";

export interface MeetingInfo {
  live: boolean;
  noteId?: string;
  startedAt: number;
  lastLine?: string;
  /** recent committed transcript lines (shown in the notch; summary lives in the app) */
  lines?: { speaker?: string; text: string }[];
  /** live, still-changing line while someone talks */
  partial?: string;
  summary?: string;
}

const SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.9 } as const;
const COLLAPSE_MS = 520;
const DONE_MS = 1500;
const ERROR_MS = 5000;
const RESULT_MS = 2600;
/** continuous hover required before the notch opens anything (kills quick-pass flicker) */
const DWELL_MS = 500;
/** a different tray item must be hit this long before the tooltip switches to it */
const TIP_SWITCH_MS = 120;
const CLAUDE_CARD_MS = 4000;
const CORRECTION_MS = 10000;
const MEETING_PROMPT_MS = 8000;
/** unanswered confirmations are cancelled (never auto-sent) */
const CONFIRM_MS = 60000;
/** Cursor may leave the island this long before hover state drops (so moving into a tooltip through the gap doesn't close it). */
const LEAVE_GRACE_MS = 300;

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

// chime for a new reminder / Claude card (Settings → Notch → Sounds); prefs set from the component
let notifyPrefs: Settings | null = null;
function notifyChime() {
  playConfigured("notify", notifyPrefs);
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
  const [followup, setFollowup] = useState<"deep" | "web" | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [history, setHistory] = useState<Dictation[] | null>(null);
  const [claudeQueue, setClaudeQueue] = useState<ClaudeEvent[]>([]);
  /** to-do reminders waiting for Done / Snooze (oldest first) */
  const [reminders, setReminders] = useState<Todo[]>([]);
  const [meeting, setMeeting] = useState<MeetingInfo>({ live: false, startedAt: 0 });
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [corrections, setCorrections] = useState<CorrectionEvent[]>([]);
  const [confirms, setConfirms] = useState<ConfirmEvent[]>([]);
  const [detected, setDetected] = useState<string | null>(null);
  const [ignoredDetect, setIgnoredDetect] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  // a style preview requested from Settings: play the notch for ~3s so the user sees it live
  const [preview, setPreview] = useState(false);
  const previewTimer = useRef<number>(0);
  const [widgetsOpen, setWidgetsOpen] = useState(false);
  const [widgetIds, setWidgetIds] = useState<WidgetId[]>(() => loadWidgets());
  const [agent, setAgent] = useState<AgentState | null>(null);
  // hover: backend cursor tracking (non-activating panel) + DOM fallback.
  // Raw positions live in refs; React state only changes when the hovered item/tile changes.
  const [hover, setHover] = useState(false);
  const [tip, setTip] = useState(-1);
  const [hotTile, setHotTile] = useState(-1);
  const posRef = useRef<HoverEvent | null>(null);
  const hoverRef = useRef(false);
  const tipRef = useRef(-1);
  const hotTileRef = useRef(-1);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dwellRef = useRef(false);
  const pendingTip = useRef<{ t: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  /** flo://hover is the single source of truth once the backend speaks (always inside Tauri).
   *  WebKit fires DOM mouseleave/mouseenter when the window resizes under a resting cursor,
   *  which used to open/close the peek menu in a loop. DOM hover is a browser-preview fallback only. */
  const backendHover = useRef(isTauri);
  const geomRef = useRef<{ notch: boolean; slots: { cx: number; side: "left" | "right"; index: number }[]; shown: IslandVariant; winW: number; pillW: number; nh: number; tipH: (i: number) => number }>({
    notch: false,
    slots: [],
    shown: "collapsed",
    winW: 0,
    pillW: 0,
    nh: 0,
    tipH: () => TRAY_TIP_H,
  });
  const [dwell, setDwell] = useState(false);
  const reduce = useReducedMotion();
  const modeRef = useRef<Mode>("dictation");
  /** set when the user stops a meeting; cleared when a new one starts */
  const meetingStoppedRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef<Phase>("idle");
  const settingsRef = useRef<Settings | null>(null);

  const recompute = useCallback(() => {
    const e = posRef.current;
    const g = geomRef.current;
    if (!e || !e.inside || e.y === undefined) return;
    // nothing opens (no tooltip, no tile, no resize) until the dwell timer has fired
    if (!dwellRef.current) {
      if (tipRef.current !== -1) {
        tipRef.current = -1;
        setTip(-1);
      }
      if (hotTileRef.current !== -1) {
        hotTileRef.current = -1;
        setHotTile(-1);
      }
      return;
    }
    const cx = e.cx ?? (e.x ?? 0) - g.winW / 2;
    const commitTip = (t: number) => {
      if (pendingTip.current) {
        clearTimeout(pendingTip.current.timer);
        pendingTip.current = null;
      }
      if (t !== tipRef.current) {
        tipRef.current = t;
        setTip(t);
      }
    };
    if (g.notch && g.slots.length) {
      const t = pickTip(tipRef.current, g.slots, cx, e.y, g.nh, g.tipH(tipRef.current));
      if (t === tipRef.current) {
        if (pendingTip.current) {
          clearTimeout(pendingTip.current.timer);
          pendingTip.current = null;
        }
      } else if (t >= 0 && tipRef.current >= 0) {
        // switching from one item to another: require it to persist briefly
        if (pendingTip.current?.t !== t) {
          if (pendingTip.current) clearTimeout(pendingTip.current.timer);
          pendingTip.current = { t, timer: setTimeout(() => commitTip(t), TIP_SWITCH_MS) };
        }
      } else {
        commitTip(t);
      }
    }
    const tile = g.shown === "peek" ? peekTileAt(g.winW, g.pillW, g.winW / 2 + cx, e.y, g.nh, PEEK_ACTIONS) : -1;
    if (tile !== hotTileRef.current) {
      hotTileRef.current = tile;
      setHotTile(tile);
    }
  }, []);

  const leaveNow = useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
    if (pendingTip.current) {
      clearTimeout(pendingTip.current.timer);
      pendingTip.current = null;
    }
    posRef.current = null;
    hoverRef.current = false;
    dwellRef.current = false;
    tipRef.current = -1;
    hotTileRef.current = -1;
    setHover(false);
    setTip(-1);
    setHotTile(-1);
  }, []);

  const handleHover = useCallback(
    (e: HoverEvent) => {
      if (!e || typeof e !== "object" || !e.inside) {
        if (!leaveTimer.current && hoverRef.current) leaveTimer.current = setTimeout(leaveNow, LEAVE_GRACE_MS);
        return;
      }
      if (leaveTimer.current) {
        clearTimeout(leaveTimer.current);
        leaveTimer.current = null;
      }
      posRef.current = e;
      if (!hoverRef.current) {
        hoverRef.current = true;
        setHover(true);
      }
      recompute();
    },
    [recompute, leaveNow],
  );

  useEffect(() => {
    api.getIslandGeometry().then(setGeo);
    api.getSettings().then(setSettings).catch(() => {});
    api.listClaudeSessions().then(setSessions);
    api.listTodos().then(setTodos).catch(() => {});
  }, []);

  // theme + accent: apply on change, and re-read when the dashboard window edits settings
  useEffect(() => {
    settingsRef.current = settings;
    if (settings) applyTheme(settings);
    setNotchScale(settings?.notchSize);
    notifyPrefs = settings ?? null;
  }, [settings?.theme, settings?.accent, settings?.notchGradient?.[0], settings?.notchGradient?.[1], settings?.notchSize, settings?.soundPack, settings?.soundVolume, settings?.notifySound, settings?.soundNotify, settings?.playSounds]);
  useEffect(() => {
    const offs = [
      onSettingsBroadcast(() => api.getSettings().then(setSettings).catch(() => {})),
      onNotchPreview(() => {
        api.getSettings().then(setSettings).catch(() => {});
        setPreview(true);
        window.clearTimeout(previewTimer.current);
        previewTimer.current = window.setTimeout(() => setPreview(false), 3000);
      }),
      watchSystemTheme(() => settings && applyTheme(settings)),
    ];
    return () => offs.forEach((f) => f());
  }, [settings]);

  // ── backend events ──────────────────────────────────────────────────────
  useEffect(() => {
    const offs = [
      on<StateEvent>(EV.state, (e) => {
        lastStateAt.current = Date.now();
        // push-to-talk sound cues (island only, gated on playSounds)
        const prefs = settingsRef.current;
        if (e.phase !== phaseRef.current) {
          if (e.phase === "listening") playConfigured("ready", prefs);
          else if (e.phase === "transcribing" || e.phase === "thinking") playConfigured("working", prefs);
          else if (e.phase === "done") playConfigured("done", prefs);
          else if (e.phase === "error") playConfigured("error", prefs);
          phaseRef.current = e.phase;
        }
        setPhase(e.phase);
        setMode(e.mode);
        modeRef.current = e.mode;
        setMessage(e.message);
        if (e.mode === "meeting" && e.phase === "listening" && !meetingStoppedRef.current)
          setMeeting((m) => (m.live ? m : { live: true, startedAt: Date.now() }));
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
        if (e && e.id) notifyChime();
      }),
      on<ClaudeSession[]>(EV.claudeSessions, (list) => setSessions(Array.isArray(list) ? list : [])),
      on<Todo>(EV.reminder, (t) => {
        if (t && t.id) setReminders((q) => (q.some((x) => x.id === t.id) ? q : [...q, t]));
        notifyChime();
      }),
      on<null>(EV.todos, () => api.listTodos().then(setTodos).catch(() => {})),
      on<ConfirmEvent>(EV.confirm, (c) => c && c.id && setConfirms((q) => (q.some((x) => x.id === c.id) ? q : [...q, c]))),
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
        if (!e.live) markStopped(e.noteId);
        if (!e.live || isStopped(e.noteId)) {
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
          lines: e.segment
            ? [...(m.lines ?? []), { speaker: e.segment.speaker, text: e.segment.text }].slice(-8)
            : m.lines,
          partial: e.partial !== undefined ? e.partial : e.segment ? "" : m.partial,
          summary: e.summary ?? m.summary,
        }));
      }),
      on<HoverEvent>(EV.hover, (e) => {
        backendHover.current = true;
        handleHoverRef.current(e);
      }),
      on<{ kind: string; text: string }>(EV.agent, (e) => {
        if (!e || !e.kind) return;
        setAgent((prev) => {
          if (e.kind === "start") return { goal: e.text ?? "", steps: [], status: "running" };
          const base: AgentState = prev ?? { goal: "", steps: [], status: "running" };
          switch (e.kind) {
            case "step":
              return { ...base, status: "running", steps: [...base.steps, e.text].slice(-6) };
            case "confirm":
              return { ...base, status: "confirm", text: e.text };
            case "done":
              return { ...base, status: "done", text: e.text };
            case "aborted":
              return { ...base, status: "aborted", text: e.text };
            case "error":
              return { ...base, status: "error", text: e.text };
            default:
              return base;
          }
        });
      }),
    ];
    return () => offs.forEach((f) => f());
  }, []);

  // live widget customisation from the Settings window (and this window)
  useEffect(() => onWidgetsChange(setWidgetIds), []);

  // auto-dismiss the agent card a few seconds after it finishes (paused while hovered)
  useEffect(() => {
    if (!agent || agent.status === "running" || agent.status === "confirm" || hover) return;
    const t = setTimeout(() => setAgent(null), 4500);
    return () => clearTimeout(t);
  }, [agent, hover]);

  const handleHoverRef = useRef(handleHover);
  handleHoverRef.current = handleHover;

  const openHistory = useCallback(() => {
    api.listHistory(6).then((h) => setHistory(h)).catch(() => setHistory([]));
  }, []);

  // demo driver (browser only, ?demo=…)
  useEffect(() => {
    const demo = new URLSearchParams(location.search).get("demo");
    // browser-only hook for perf probes / tests (never present inside the app)
    if (!isTauri) (window as unknown as { __floOpenWidgets?: () => void }).__floOpenWidgets = () => setWidgetsOpen(true);
    if (!isTauri && demo) return runDemo(demo, { setPos: (p) => handleHoverRef.current(p), setMeetingOpen, openHistory, openWidgets: () => setWidgetsOpen(true) });
  }, [openHistory]);

  // ── hover dwell: require ~500ms continuous hover before anything opens ────
  useEffect(() => {
    if (!hover) {
      dwellRef.current = false;
      setDwell(false);
      return;
    }
    const t = setTimeout(() => {
      dwellRef.current = true;
      setDwell(true);
      recompute(); // pick the item/tile under the cursor at the moment the dwell completes
    }, reduce ? 0 : DWELL_MS);
    return () => clearTimeout(t);
  }, [hover, reduce, recompute]);

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

  // widgets panel auto-closes shortly after the cursor leaves the notch — but only once it has
  // actually been hovered (so a panel opened programmatically, or before the hover event lands,
  // isn't closed out from under the user).
  const widgetsHovered = useRef(false);
  useEffect(() => {
    if (!widgetsOpen) {
      widgetsHovered.current = false;
      return;
    }
    if (hover) {
      widgetsHovered.current = true;
      return;
    }
    if (!widgetsHovered.current) return;
    const t = setTimeout(() => setWidgetsOpen(false), 450);
    return () => clearTimeout(t);
  }, [widgetsOpen, hover]);

  useEffect(() => {
    if (!card || hover || followup) return;
    const t = setTimeout(() => setCard(null), 8000);
    return () => clearTimeout(t);
  }, [card, hover, followup]);

  const headReminder = reminders[0];
  // a reminder waits for an answer; it only steps aside after 2 minutes (paused while hovered)
  useEffect(() => {
    if (!headReminder || hover) return;
    const t = setTimeout(() => setReminders((q) => q.slice(1)), 120_000);
    return () => clearTimeout(t);
  }, [headReminder, hover]);
  const answerReminder = useCallback((a: "done" | "snooze" | "open" | "dismiss") => {
    setReminders((q) => {
      const t = q[0];
      if (t) {
        if (a === "done") api.updateTodo(t.id, { status: "done" }).catch(() => {});
        else if (a === "snooze") api.snoozeTodo(t.id, 10).catch(() => {});
        else if (a === "open") api.openDashboard("todos");
      }
      return q.slice(1);
    });
  }, []);

  const headClaude = claudeQueue[0];
  useEffect(() => {
    if (!headClaude || hover) return;
    const t = setTimeout(() => setClaudeQueue((q) => q.slice(1)), CLAUDE_CARD_MS);
    return () => clearTimeout(t);
  }, [headClaude, hover]);

  const headConfirm = confirms[0];
  const answerConfirm = useCallback((c: ConfirmEvent, approve: boolean) => {
    setConfirms((q) => q.filter((x) => x.id !== c.id));
    api.confirmAction(c.id, approve).catch(() => {});
  }, []);
  useEffect(() => {
    if (!headConfirm) return;
    const t = setTimeout(() => answerConfirm(headConfirm, false), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [headConfirm, answerConfirm]);

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
    // ONE stacked icon for all agent sessions (most urgent on top); hover lists them all
    const ses: TrayItem[] = sessions.length ? [{ id: "agents", kind: "agents", sessions: sessionsByUrgency(sessions) }] : [];
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
  const shownRef = useRef<IslandVariant>("collapsed");
  shownRef.current = shown;
  const shrinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nh = geo?.notchHeight ?? 0;
  // DOM fallback for non-notch / browser: per-item hover
  const [domItem, setDomItem] = useState(-1);
  const tipIdx = notch ? tip : hover ? domItem : -1;
  const tipItem = tipIdx >= 0 ? trayItems.all[tipIdx] : undefined;

  // ── target variant ──────────────────────────────────────────────────────
  const target: IslandVariant = useMemo(() => {
    if (mode !== "meeting" && phase === "listening") return "listening";
    if (phase === "transcribing" || phase === "thinking") return "working";
    if (phase === "error") return "error";
    if (result) return "result";
    if (phase === "done" && mode !== "assistant") return "done";
    if (headConfirm) return "confirm";
    if (headFix) return "correction";
    if (agent) return "agent";
    if (promptOpen && detected && !meeting.live) return "meetingPrompt";
    if (card) return "card";
    if (headReminder) return "reminder";
    if (headClaude) return "claude";
    if (history) return "history";
    if (meeting.live) return meetingOpen ? "meetingExpanded" : "meeting";
    if (widgetsOpen) return "widgets";
    if (preview) return "listening"; // show the selected notch style live for ~3s
    if (hover && dwell && tipItem) return "trayTooltip";
    if (hover && dwell) return "peek";
    if (trayItems.all.length) return "tray";
    return "collapsed";
  }, [phase, mode, result, headConfirm, headFix, agent, promptOpen, detected, card, headReminder, headClaude, history, meeting.live, meetingOpen, widgetsOpen, preview, hover, dwell, tipItem, trayItems.all.length]);

  // no expansion before the dwell completes (prevents an enter-resize that could feed back into hover)
  const swell = false;
  const trayCounts = { trayLeft: trayItems.left.length, trayRight: trayItems.right.length };

  // sizes below read the notch scale; set it during render so a size change applies on this render
  setNotchScale(settings?.notchSize);
  const contentFor = (v: IslandVariant): CardContent | undefined => {
    switch (v) {
      case "card":
        return card ? { replyChars: toPlainText(card.reply).length, results: card.results.length } : undefined;
      case "error":
        // "Sign in to Flo" is a two-short-lines card
        return { textChars: isSignInError(message) ? 40 : (message ?? "Something went wrong").length, action: wantsFix(message) };
      case "result":
        return { textChars: result?.length ?? 0 };
      case "history":
        return { rows: Math.max(1, history?.length ?? 1) };
      case "widgets":
        return { widgetBody: widgetsBodyHeight(widgetIds), scale: getNotchScale() };
      case "agent":
        return { agentSteps: agent?.steps.length ?? 0, agentDone: !!agent && agent.status !== "running" && agent.status !== "confirm" };
      case "collapsed":
        return swell ? { swell: true } : undefined;
      case "tray":
        return { ...trayCounts, swell };
      case "peek":
        return trayCounts;
      case "trayTooltip":
        return { ...trayCounts, tipCx: layout?.slots[tipIdx]?.cx ?? 0, tipRows: tipItem?.kind === "agents" ? tipItem.sessions.length : tipItem?.kind === "todos" ? tipItem.todos.length : undefined, scale: getNotchScale() };
      default:
        return undefined;
    }
  };
  const content = contentFor(target);
  const contentKey = JSON.stringify(content ?? null);

  useEffect(() => {
    if (!geo) return;
    const next = islandSize(target, geo, content);
    // idempotent: same variant, same size -> no resize, no timers (a re-render on hover is a no-op)
    if (winSize.current && target === shownRef.current && next.width === winSize.current.width && next.height === winSize.current.height) {
      if (shrinkTimer.current) clearTimeout(shrinkTimer.current);
      shrinkTimer.current = null;
      setShownContent(content);
      return;
    }
    const cur = winSize.current ?? next;
    const union = { width: Math.max(cur.width, next.width), height: Math.max(cur.height, next.height) };
    if (shrinkTimer.current) clearTimeout(shrinkTimer.current);
    const grow = !winSize.current || union.width !== cur.width || union.height !== cur.height;
    const apply = () => {
      setShown(target);
      setShownContent(content);
      // never shrink while the cursor is on the island (prevents resize ↔ hit-test feedback loops)
      if (hoverRef.current) return;
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
  }, [target, geo, reduce, contentKey, hover]);

  // Esc: cancel / dismiss · click-away (window blur) closes transient cards
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (widgetsOpen) setWidgetsOpen(false);
      else if (agent && (agent.status === "running" || agent.status === "confirm")) api.stopAgent();
      else if (agent) setAgent(null);
      else if (phase === "listening" && mode !== "meeting") api.cancelSession();
      else if (history) setHistory(null);
      else if (headFix) setCorrections((q) => q.slice(1));
      else if (card) setCard(null);
      else if (result) setResult(null);
      else if (phase === "error") setPhase("idle");
      else if (headReminder) setReminders((q) => q.slice(1));
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
  }, [phase, mode, card, headReminder, headClaude, history, result, headFix, promptOpen, agent, widgetsOpen]);

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
    leaveNow();
  };
  const dismissSession = (s: ClaudeSession) => {
    removeSession(s.sessionId);
    api.dismissClaudeSession(s.sessionId).catch(() => {});
  };
  const stopMeeting = () => {
    meetingStoppedRef.current = true;
    const id = meeting.noteId;
    markStopped(id);
    // hide the pill / timer right away; the summary is written in the background
    setMeeting({ live: false, startedAt: 0 });
    setMeetingOpen(false);
    stopMeetingNow(id).catch(() => {});
  };
  const startNotes = (app: string) => {
    meetingStoppedRef.current = false;
    setPromptOpen(false);
    api.startMeeting(`${app} call`).catch(() => {});
  };
  const ignoreMeeting = (app: string) => {
    setIgnoredDetect(app);
    setPromptOpen(false);
  };
  const clearDone = () => {
    for (const s of sessions) if (s.status === "done") dismissSession(s);
  };
  const onTrayItem = (it: TrayItem) => {
    // click the stack: jump to the most urgent session
    if (it.kind === "agents") openSession(it.sessions[0]);
    else if (it.kind === "todos") api.openDashboard("todos");
    else if (it.kind === "meeting") setPromptOpen(true);
    else api.openDashboard("home");
  };

  // DOM mouse tracking: browser preview only (ignored once the backend reports hover)
  const onMouseMove = (e: React.MouseEvent) => {
    if (backendHover.current) return;
    const r = rootRef.current?.getBoundingClientRect();
    if (!r) return;
    const x = e.clientX - r.left;
    handleHover({ inside: true, x, y: e.clientY - r.top, cx: x - r.width / 2 });
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
  const bigCard = ["card", "claude", "reminder", "meetingExpanded", "peek", "history", "result", "error", "correction", "meetingPrompt", "confirm"].includes(shown);
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

  // keep hit-testing geometry current for the hover handler (refs → no re-render per mouse move)
  geomRef.current = {
    notch,
    slots: layout?.slots ?? [],
    shown,
    winW: win.width,
    pillW: pill.width,
    nh,
    tipH: (i: number) => {
      const it = trayItems.all[i];
      return it && it.kind === "agents" ? trayTipHeight(it.sessions.length) : it && it.kind === "todos" ? trayTipHeight(it.todos.length) : trayTipHeight();
    },
  };
  const keys = {
    dict: geo.platform === "windows" ? "Right Ctrl" : formatHotkey(settings?.hotkeyDictation ?? "ctrl"),
    asst: geo.platform === "windows" ? "Right Alt" : formatHotkey(settings?.hotkeyAssistant ?? "fn"),
  };

  const glow = notch && (swollen || shown === "listening");
  // premium hover feedback: instant accent rim-glow (no resize) the moment the cursor is on the notch
  const hovering = notch && hover;
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
        if (!backendHover.current) handleHover({ inside: false });
        setDomItem(-1);
      }}
    >
      <motion.div
        initial={false}
        animate={{ width: pill.width, height: pill.height, borderRadius: radius }}
        transition={SPRING}
        className={notch ? "relative bg-black text-white" : "relative text-white"}
        style={
          notch
            ? {
                overflow: "visible",
                // glow is bottom-weighted + tightly clipped (negative spread) so it hugs the rounded
                // pill instead of haloing the flat-topped notch as a rectangle.
                boxShadow: hovering
                  ? "inset 0 -1.5px 0 rgba(102,206,255,0.9), 0 7px 20px -10px rgba(61,187,255,0.55)"
                  : glow
                    ? "inset 0 -1px 0 rgba(102,206,255,0.72), 0 5px 15px -11px rgba(61,187,255,0.5)"
                    : shown === "error"
                      ? "inset 0 -1px 0 rgba(252,211,77,0.35)"
                      : bigCard
                        ? "inset 0 -1px 0 rgba(147,221,255,0.14)"
                        : "none",
                transition: "box-shadow 0.28s ease",
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
        <div
          className="absolute inset-0 overflow-hidden"
          style={{
            borderRadius: radius,
            // WebKit doesn't clip transformed children (the sheen) to border-radius unless the
            // clip layer is composited with a solid mask; this forces the clip with no visual change.
            transform: "translateZ(0)",
            WebkitMaskImage: "linear-gradient(#000, #000)",
            maskImage: "linear-gradient(#000, #000)",
          }}
        >
          {/* one luminous ribbon inside the wings: listening → working → done (persists across them);
              unmounted otherwise, so the idle notch / tray never draws */}
          {notch && (shown === "listening" || shown === "working" || shown === "done") && (
            <NotchViz
              style={settings?.notchStyle ?? "ribbon"}
              accent={settings?.accent}
              width={Math.round(geo.notchWidth + 2 * ISLAND_WING)}
              height={geo.notchHeight}
              notchWidth={geo.notchWidth}
              wing={ISLAND_WING}
              mode={shown === "listening" ? "listen" : shown === "done" ? "done" : phase === "thinking" ? "think" : "transcribe"}
              leftWing={shown === "working"}
              bright={message === "hands-free"}
              sim={preview}
            />
          )}
          {/* tiny shimmer along the bottom rim while swelling */}
          {notch && swollen && !reduce && (
            <span
              className="pointer-events-none absolute bottom-0 left-0 h-px w-1/3"
              style={{ background: "linear-gradient(90deg, transparent, #e3f6ff, transparent)", animation: "flo-shimmer-x 0.9s ease-out 1" }}
            />
          )}
          {/* premium hover: a single specular sheen sweeps across once on enter */}
          {hovering && !reduce && (
            <span
              key="sheen"
              aria-hidden
              className="flo-sheen pointer-events-none absolute inset-y-0 left-0 w-1/3"
              style={{ background: "linear-gradient(100deg, transparent, rgba(194,236,255,0.18), transparent)" }}
            />
          )}
          {/* Only the current content is rendered (enter animation only). Exit animations could leave
              ghost content (e.g. a frozen spinner) on screen if they were ever interrupted. */}
          {(
            <motion.div
              key={shown + (shown === "claude" ? headClaude?.id : "") + (shown === "correction" ? headFix?.id : "")}
              className="absolute inset-0"
              // opacity + transform only: both run on the compositor (an animated blur filter
              // repaints the whole card every frame and was the main source of stutter)
              initial={{ opacity: 0, y: -4, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ willChange: "opacity, transform", transformOrigin: "50% 0%" }}
            >
              {shown === "widgets" ? (
                <Widgets
                  scale={getNotchScale()}
                  top={notch ? geo.notchHeight : 0}
                  ids={widgetIds}
                  sessions={sessions}
                  onAction={(a) => {
                    setWidgetsOpen(false);
                    if (a === "dictate") api.startSession("dictation");
                    else if (a === "ask") api.startSession("assistant");
                    else if (a === "meeting") api.startMeeting();
                    else if (a === "todos") api.openDashboard("todos");
                    else if (a === "customize") api.openDashboard("settings/appearance");
                    else api.openDashboard();
                  }}
                />
              ) : shown === "agent" && agent ? (
                <AgentCard agent={agent} notch={notch} geo={geo} onStop={() => api.stopAgent()} onDismiss={() => setAgent(null)} />
              ) : shown === "confirm" && headConfirm ? (
                <ConfirmCard c={headConfirm} more={confirms.length - 1} notch={notch} geo={geo} onAnswer={(ok) => answerConfirm(headConfirm, ok)} />
              ) : shown === "correction" && headFix ? (
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
                  onUndo={async () => {
                    await api.undoCorrection(headFix.heard, headFix.corrected).catch(() => {});
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
                  reminder={headReminder}
                  onReminder={answerReminder}
                  claudeMore={Math.max(0, claudeQueue.length - 1)}
                  meeting={meeting}
                  hotTile={hotTile}
                  keys={keys}
                  pillW={pill.width}
                  onCloseCard={() => setCard(null)}
                  followup={followup}
                  onFollowup={(m) => {
                    if (!card || followup) return;
                    setFollowup(m);
                    api
                      .assistantFollowup(card.id, m)
                      .then((r) => setCard(r))
                      .catch(() => {})
                      .finally(() => setFollowup(null));
                  }}
                  onOpenAnswer={(id) => {
                    api.openDashboard(`assistant/${id}`);
                    setCard(null);
                  }}
                  onCloseError={() => setPhase("idle")}
                  onCloseHistory={() => setHistory(null)}
                  onOpenHistory={openHistory}
                  onWidgets={() => setWidgetsOpen(true)}
                  onClaude={dismissClaude}
                  onToggleMeeting={() => setMeetingOpen((v) => !v)}
                  onStopMeeting={stopMeeting}
                  onStartMeeting={() => {
                    meetingStoppedRef.current = false;
                    api.startMeeting().catch(() => {});
                  }}
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
                ? tooltipRect(win.width, layout.slots[tipIdx]?.cx ?? 0, geo.notchHeight, geomRef.current.tipH(tipIdx))
                : { x: Math.max(8, win.width - 12 - 300), y: 4, w: 300, h: geomRef.current.tipH(tipIdx) }
            }
            onOpen={openSession}
            onDismiss={dismissSession}
            onClearDone={clearDone}
            onStartNotes={startNotes}
            onIgnoreMeeting={ignoreMeeting}
            onOpenTodos={() => api.openDashboard("todos")}
            onDoneTodo={(t) => {
              setTodos((list) => list.filter((x) => x.id !== t.id));
              api.updateTodo(t.id, { status: "done" }).catch(() => {});
            }}
            scale={getNotchScale()}
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
