import { os, setOS } from "../lib/os";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { settleConfirmedCard } from "./confirmCard";
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import { api, isTauri, on } from "../lib/api";
import {
  formatHotkey,
  islandSize,
  notchBox,
  notchStyle,
  pickTip,
  TRAY_TIP_H,
  trayTipHeight,
  ISLAND_EAR,
  ISLAND_WING,
  MUSIC_WING,
  greeting,
  hitTestTrayC,
  TRAY_SLOT,
  PERM_LINES,
  PERM_LINES_MAX,
  permissionCmdLines,
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
  type HandsfreeEvent,
  type HoverEvent,
  type IslandGeometry,
  type MeetingAlert,
  type MeetingAlertAction,
  type MeetingDetectedEvent,
  type MeetingEvent,
  type Mode,
  type Phase,
  type Settings,
  type StateEvent,
  type Todo,
  type TranscriptEvent,
} from "../lib/types";
import { IslandContent } from "./IslandContent";
import { MeetingCard } from "./MeetingCard";
import { alertExpired, upsertAlert } from "../lib/meetingAlert";
import { ConfirmCard, CorrectionCard, MeetingPromptCard, TrayItemView, TrayRow, TrayTooltip, type TrayItem } from "./Tray";
import { runDemo } from "./demo";
import { NotchViz } from "./Ribbon";
import { WidgetGrid } from "./Widgets";
import { MusicWings } from "./NowPlaying";
import { useMediaActivity } from "../lib/nowPlaying";
import { AgentCard, AgentModePill } from "./AgentCard";
import { expireAgent, expireHandsfree, isActive as isAgentActive, reduceAgent, stopLocally, type AgentEvent, type AgentState } from "./agentState";
import { loadWidgets, onWidgetsChange, widgetsBodyHeight, type WidgetId } from "../lib/widgets";
import { applyTheme, onNotchPreview, onSettingsBroadcast, watchSystemTheme } from "../lib/theme";
import { isStopped, markStopped, stopMeetingNow } from "../lib/meetingStops";
import { playConfigured } from "../lib/cueSounds";
import { getNotchScale, setNotchScale } from "../lib/format";
import { Notchling } from "../lib/NotchlingFace";
import { moodForState, type AvatarSettings } from "../lib/notchling";

export interface MeetingInfo {
  live: boolean;
  noteId?: string;
  startedAt: number;
  lastLine?: string;
  /** recent committed transcript lines (shown in the notch; summary lives in the app) */
  lines?: { speaker?: string; text: string }[];
  /** live, still-changing line while someone talks */
  partial?: string;
  /** who is speaking the live line */
  partialSpeaker?: string;
  summary?: string;
}

/** Calm, premium motion: no springs, no overshoot anywhere in the notch. A long, soft ease-out
 *  ("expo-ish") for opening; a quicker, symmetric ease for closing back into the camera. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
const EASE_CLOSE = [0.32, 0.72, 0, 1] as const;
/** Opening: a critically damped spring (velocity carries over when a new state interrupts the
 *  morph, so chained states flow instead of restarting; zero bounce, because the window is sized
 *  to the target and an overshoot would be clipped flat). Radii ease alongside. */
const MORPH_OPEN = { type: "spring", visualDuration: 0.34, bounce: 0, restDelta: 0.5, restSpeed: 4, borderRadius: { type: "tween", duration: 0.3, ease: EASE_OUT } } as const;
const MORPH_CLOSE = { type: "tween", duration: 0.22, ease: EASE_CLOSE } as const;
/** default for every motion element under the island (motion's default for x/y/scale is a bouncy spring) */
const CALM = { type: "tween", duration: 0.2, ease: EASE_OUT } as const;
/** Bottom-corner radii of the notch shape (the top corners are square + concave shoulders). */
const NOTCH_R = { closed: 12, row: 14, tall: 18, card: 24, panel: 28 } as const;
/** the window shrinks only after the close animation has finished (content never jumps) */
const COLLAPSE_MS = 300;
const DONE_MS = 1500;
const ERROR_MS = 5000;
const RESULT_MS = 2600;
/** continuous hover required before the notch opens (intent: a cursor passing to the menu bar
 *  doesn't open it, a deliberate hover opens the whole panel almost at once) */
const DWELL_MS = 200;
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
  // a notchless Mac draws a fake notch: normalise so every child lays out against it
  const applyGeometry = useCallback((g: IslandGeometry | null) => {
    setOS(g?.platform);
    // Linux: the web view's own pointer events drive hover (see backendHover)
    if (g) backendHover.current = isTauri && g.platform !== "linux";
    setGeo(g && notchStyle(g) ? { ...g, notchWidth: notchBox(g).width, notchHeight: notchBox(g).height } : g);
  }, []);
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
  /** Google Calendar meetings about to start (EV.meetingAlert; same id updates in place) */
  const [meetingAlerts, setMeetingAlerts] = useState<MeetingAlert[]>([]);
  const seenAlerts = useRef(new Set<string>());
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
  /** hands-free agent mode (double-tap fn): null when off */
  const [handsfree, setHandsfree] = useState<HandsfreeEvent | null>(null);
  const handsfreeAt = useRef(Date.now());
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
  /** Windows / Linux: a press on the pill that may become a drag (see onPointerDown) */
  const dragRef = useRef<{ x: number; y: number; id: number; on: boolean; raf: number } | null>(null);
  const draggedRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const dwellRef = useRef(false);
  const pendingTip = useRef<{ t: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  /** flo://hover is the single source of truth once the backend speaks (always inside Tauri).
   *  WebKit fires DOM mouseleave/mouseenter when the window resizes under a resting cursor,
   *  which used to open/close the peek menu in a loop. DOM hover is a browser-preview fallback only. */
  // Linux has no backend tracker: X11 delivers pointer enter / leave to the unfocused island
  // window, and Wayland has no global cursor to poll, so the DOM events are the source there.
  const backendHover = useRef(isTauri && os() !== "linux");
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
    if (g.shown === "peek") {
      // the hover panel is open: it stays put, except when the cursor lands squarely on a tray
      // icon in the notch row (its list opens, like from the collapsed notch). The quick-action
      // tile under the cursor lights up — hit-tested on the real DOM, since a non-activating
      // panel gets no DOM hover while another app is frontmost
      const onIcon = g.notch && g.slots.length ? hitTestTrayC(g.slots, cx, e.y, g.nh, TRAY_SLOT / 2) : -1;
      if (onIcon !== tipRef.current) commitTip(onIcon);
      if (onIcon >= 0) return;
      const r = rootRef.current?.getBoundingClientRect();
      // hover coords are window-relative; the root fills the window in the app (offset 0) and
      // sits on a fake desktop in the browser preview
      const px = (e.x ?? g.winW / 2 + cx) + (r?.left ?? 0);
      const py = e.y + (r?.top ?? 0);
      const el = typeof document !== "undefined" ? (document.elementFromPoint(px, py) as HTMLElement | null) : null;
      const hit = el?.closest<HTMLElement>("[data-peek-tile]");
      const tile = hit ? Number(hit.dataset.peekTile) : -1;
      if (tile !== hotTileRef.current) {
        hotTileRef.current = tile;
        setHotTile(tile);
      }
      return;
    }
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
    if (hotTileRef.current !== -1) {
      hotTileRef.current = -1;
      setHotTile(-1);
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
      // carrying the pill: never open the panel under the cursor mid-drag
      if (dragRef.current?.on && e?.inside) return;
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
    api.getIslandGeometry().then(applyGeometry);
    api.getSettings().then(setSettings).catch(() => {});
    api.listClaudeSessions().then(setSessions);
    api.listTodos().then(setTodos).catch(() => {});
    api.agentModeStatus().then((on) => on && setHandsfree((h) => h ?? { active: true, phase: "listening" }));
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
      on(EV.settingsChanged, () => api.getSettings().then(setSettings).catch(() => {})),
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
      on<MeetingAlert>(EV.meetingAlert, (a) => {
        if (!a || !a.id) return;
        setMeetingAlerts((q) => upsertAlert(q, a));
        if (!seenAlerts.current.has(a.id)) {
          seenAlerts.current.add(a.id);
          notifyChime();
        }
      }),
      on<{ id: string }>(EV.meetingAlertDone, (d) => d && d.id && setMeetingAlerts((q) => q.filter((x) => x.id !== d.id))),
      on<null>(EV.todos, () => api.listTodos().then(setTodos).catch(() => {})),
      on<ConfirmEvent>(EV.confirm, (c) => {
        if (!c || !c.id) return;
        setConfirms((q) => (q.some((x) => x.id === c.id) ? q : [...q, c]));
        if (c.kind === "claude") notifyChime();
      }),
      on<{ id: string }>(EV.confirmDone, (d) => d && d.id && setConfirms((q) => q.filter((x) => x.id !== d.id))),
      // display resolution / monitor changed: the backend re-centred the window, re-lay out to match
      on<IslandGeometry>(EV.islandGeometry, (g) => g && applyGeometry(g)),
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
          partialSpeaker: e.partial ? e.partialSpeaker : e.partial !== undefined || e.segment ? undefined : m.partialSpeaker,
          summary: e.summary ?? m.summary,
        }));
      }),
      on<HoverEvent>(EV.hover, (e) => {
        backendHover.current = true;
        handleHoverRef.current(e);
      }),
      on<HandsfreeEvent>(EV.handsfree, (e) => {
        if (!e || typeof e !== "object") return;
        handsfreeAt.current = Date.now();
        setHandsfree(e.active ? e : null);
      }),
      on<AgentEvent>(EV.agent, (e) => setAgent((prev) => reduceAgent(prev, e))),
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

  // never spin forever: a run (or agent mode's "working") that has gone silent is closed locally
  useEffect(() => {
    if (!isAgentActive(agent) && handsfree?.phase !== "thinking") return;
    const t = setInterval(() => {
      setAgent((a) => expireAgent(a));
      setHandsfree((h) => expireHandsfree(h, handsfreeAt.current));
    }, 5000);
    return () => clearInterval(t);
  }, [agent, handsfree?.phase]);

  const stopAgent = useCallback(() => {
    api.stopAgent();
    setAgent((a) => stopLocally(a));
  }, []);

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

  const headMeeting = meetingAlerts[0];
  // a meeting card drops off 10 minutes after the meeting started
  useEffect(() => {
    if (!meetingAlerts.length) return;
    const prune = () => setMeetingAlerts((q) => (q.some((a) => alertExpired(a, Date.now())) ? q.filter((a) => !alertExpired(a, Date.now())) : q));
    prune();
    const t = setInterval(prune, 30_000);
    return () => clearInterval(t);
  }, [meetingAlerts.length]);
  const answerMeeting = useCallback((a: MeetingAlert, action: MeetingAlertAction) => {
    setMeetingAlerts((q) => q.filter((x) => x.id !== a.id));
    api.googleMeetingAction(a.id, action).catch(() => {});
  }, []);

  const headClaude = claudeQueue[0];
  useEffect(() => {
    if (!headClaude || hover) return;
    const t = setTimeout(() => setClaudeQueue((q) => q.slice(1)), CLAUDE_CARD_MS);
    return () => clearTimeout(t);
  }, [headClaude, hover]);

  // the confirm on screen: the user can step through a queue of permission questions
  const [confirmIdx, setConfirmIdx] = useState(0);
  const [expandedConfirm, setExpandedConfirm] = useState<string | null>(null);
  const headConfirm = confirms[Math.min(confirmIdx, Math.max(0, confirms.length - 1))];
  const oldestConfirm = confirms[0];
  const answerConfirm = useCallback((c: ConfirmEvent, approve: boolean | "terminal") => {
    setConfirms((q) => {
      const i = q.findIndex((x) => x.id === c.id);
      // stay on the same slot → the next question slides into place
      setConfirmIdx((k) => Math.max(0, Math.min(k, q.length - 2, i >= 0 ? i : k)));
      return q.filter((x) => x.id !== c.id);
    });
    if (c.kind === "claude") api.answerClaudePermission(c.id, approve === "terminal" ? "terminal" : approve ? "allow" : "deny").catch(() => {});
    else
      api
        .confirmAction(c.id, approve === true)
        .then((outcome) => setCard((card) => settleConfirmedCard(card, outcome)))
        .catch((err) => setCard((card) => settleConfirmedCard(card, err instanceof Error ? err.message : String(err))));
  }, []);
  useEffect(() => {
    if (!oldestConfirm) return;
    // never auto-deny a Claude permission: unanswered, it goes back to the terminal (the backend
    // also times out and closes the card); a staged Slack message is simply cancelled
    const t = setTimeout(() => answerConfirm(oldestConfirm, oldestConfirm.kind === "claude" ? "terminal" : false), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [oldestConfirm, answerConfirm]);

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

  // every Mac hangs the island from the top edge (the hardware notch, or a fake one)
  const notch = notchStyle(geo);
  const hwNotch = notch && !!geo?.hasNotch;
  // live music activity: media playing (or paused < 30 s) → artwork + equalizer in the wings
  const media = useMediaActivity();
  const musicLive = notch && !!media;
  const layout = geo && notch ? trayLayout(geo, trayItems.left.length, trayItems.right.length, musicLive ? MUSIC_WING : 0) : null;

  // ── resize protocol state ───────────────────────────────────────────────
  const [shown, setShown] = useState<IslandVariant>("collapsed");
  const [shownContent, setShownContent] = useState<CardContent | undefined>();
  const winSize = useRef<{ width: number; height: number } | null>(null);
  const shownRef = useRef<IslandVariant>("collapsed");
  shownRef.current = shown;
  const shrinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Windows / Linux: the window size last applied (the pill fills it) and the latest resize */
  const [pcWin, setPcWin] = useState<{ width: number; height: number } | null>(null);
  const pcSeq = useRef(0);

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
    if (headMeeting) return "meetingSoon";
    if (headReminder) return "reminder";
    if (headClaude) return "claude";
    if (history) return "history";
    if (meeting.live) return meetingOpen ? "meetingExpanded" : "meeting";
    // the panel pinned open programmatically (demo / perf probe); hover opens the same panel below
    if (widgetsOpen) return "peek";
    // agent mode stays visible (it's listening) — above hover/tray, below anything with content
    if (handsfree) return "agentMode";
    if (preview) return "listening"; // show the selected notch style live for ~3s
    if (hover && dwell && tipItem) return "trayTooltip";
    // ONE hover = everything: quick actions + widgets in a single panel (no second click)
    if (hover && dwell) return "peek";
    if (trayItems.all.length || musicLive) return "tray";
    return "collapsed";
  }, [phase, mode, result, headConfirm, headFix, agent, promptOpen, detected, card, headMeeting, headReminder, headClaude, history, meeting.live, meetingOpen, widgetsOpen, handsfree, preview, hover, dwell, tipItem, trayItems.all.length, musicLive]);

  // no expansion before the dwell completes (prevents an enter-resize that could feed back into hover)
  const swell = false;
  const trayCounts = { trayLeft: trayItems.left.length, trayRight: trayItems.right.length, ...(musicLive ? { music: true } : {}) };

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
      case "peek":
        return { ...trayCounts, widgetBody: widgetsBodyHeight(widgetIds), scale: getNotchScale() };
      case "confirm": {
        if (headConfirm?.kind !== "claude") return { claude: false };
        const n = permissionCmdLines(headConfirm.body, headConfirm.tool);
        return { claude: true, cmdLines: Math.min(n, expandedConfirm === headConfirm.id ? PERM_LINES_MAX : PERM_LINES) };
      }
      case "agent":
        return {
          agentSteps: agent?.steps.length ?? 0,
          agentDone: !!agent && agent.status !== "running" && agent.status !== "confirm",
          agentConfirm: agent?.status === "confirm",
        };
      case "collapsed":
        return swell ? { swell: true } : undefined;
      case "tray":
        return { ...trayCounts, swell };
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
    if (!notchStyle(geo)) {
      // Windows / Linux: no notch to morph out of, and the pill fills its window (pcWin), so the two
      // can never disagree. One resize per change, no union-then-shrink and no animated size:
      // growing resizes first and shows the new content once the window is that big; shrinking
      // shows the smaller content first (it fits) and then shrinks the window at once. The old
      // macOS protocol (grow to the union, morph, shrink 300 ms later unless hovered) left the
      // pill stranded in a corner of a too-big window and the content cut off on WebKitGTK.
      const cur = winSize.current;
      if (cur && target === shownRef.current && next.width === cur.width && next.height === cur.height) {
        setShownContent(content);
        return;
      }
      const seq = ++pcSeq.current;
      const grows = !cur || next.width > cur.width || next.height > cur.height;
      winSize.current = next;
      if (grows) {
        api.islandResize(next.width, next.height).finally(() => {
          if (seq !== pcSeq.current) return;
          setPcWin(next);
          setShown(target);
          setShownContent(content);
        });
      } else {
        setShown(target);
        setShownContent(content);
        api.islandResize(next.width, next.height).finally(() => seq === pcSeq.current && setPcWin(next));
      }
      return;
    }
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
      else if (agent && (agent.status === "running" || agent.status === "confirm")) stopAgent();
      else if (agent) setAgent(null);
      else if (handsfree) api.toggleAgentMode().catch(() => {});
      else if (phase === "listening" && mode !== "meeting") api.cancelSession();
      else if (history) setHistory(null);
      else if (headFix) setCorrections((q) => q.slice(1));
      else if (card) setCard(null);
      else if (result) setResult(null);
      else if (phase === "error") setPhase("idle");
      else if (headMeeting) setMeetingAlerts((q) => q.slice(1));
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
  }, [phase, mode, card, headMeeting, headReminder, headClaude, history, result, headFix, promptOpen, agent, widgetsOpen, handsfree]);

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

  // "Clear all": drop the whole stack and mark every Claude event seen, so none come back
  const clearAllClaude = useCallback(() => {
    setClaudeQueue([]);
    api.markClaudeSeen().catch(() => {});
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

  // DOM mouse tracking: browser preview only (ignored once the backend reports hover).
  // mousemove can fire at 120 Hz: coalesce to one hit-test per frame.
  const moveRaf = useRef(0);
  const lastMove = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const onMouseMove = (e: React.MouseEvent) => {
    if (backendHover.current) return;
    lastMove.current = { x: e.clientX, y: e.clientY };
    if (moveRaf.current) return;
    moveRaf.current = requestAnimationFrame(() => {
      moveRaf.current = 0;
      if (backendHover.current) return;
      const r = rootRef.current?.getBoundingClientRect();
      if (!r) return;
      const x = lastMove.current.x - r.left;
      handleHover({ inside: true, x, y: lastMove.current.y - r.top, cx: x - r.width / 2 });
    });
  };
  useEffect(() => () => cancelAnimationFrame(moveRaf.current), []);

  // Windows / Linux: there's no notch to hang from, so the pill can be dragged anywhere. A press
  // does nothing until the pointer moves 4 px; then the backend follows the cursor (physical
  // pixels, right on mixed-DPI monitors), snaps on release and remembers the spot per monitor.
  // The click that ends a drag is swallowed so it never opens the dashboard. macOS: no-op.
  const onPointerDown = (e: React.PointerEvent) => {
    draggedRef.current = false;
    if (notch || e.button !== 0) return;
    if ((e.target as Element).closest?.("input, textarea, select, [contenteditable=true], [data-no-drag]")) return;
    dragRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId, on: false, raf: 0 };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.id) return;
    if (!d.on) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
      d.on = true;
      draggedRef.current = true;
      setDragging(true);
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        /* capture unsupported: the drag still follows while the pointer is over the pill */
      }
      // carry the pill, not an open panel
      leaveNow();
      void api.islandDragStart().catch(() => {});
      return;
    }
    if (d.raf) return;
    d.raf = requestAnimationFrame(() => {
      d.raf = 0;
      void api.islandDragMove().catch(() => {});
    });
  };
  const endDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.id) return;
    dragRef.current = null;
    // a move still waiting for its frame is sent now, so a quick flick lands where it was let go
    const pending = d.raf !== 0;
    cancelAnimationFrame(d.raf);
    if (!d.on) return;
    if (pending) void api.islandDragMove().catch(() => {});
    setDragging(false);
    try {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    void api.islandDragEnd().catch(() => {});
  };
  const swallowDragClick = (e: React.MouseEvent) => {
    if (!draggedRef.current) return;
    draggedRef.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  // last pill size drawn (picks the open vs close easing); declared before the early return
  // (compared against the last COMMITTED pill: StrictMode renders twice, so a render-time write
  // would make every close look like an open)
  const lastPill = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const drawnPill = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  useEffect(() => {
    lastPill.current = drawnPill.current;
  });

  if (!geo) return null;

  const size = islandSize(shown, geo, shownContent);
  const collapsed = shown === "collapsed" && !shownContent?.swell;
  const swollen = !!shownContent?.swell;
  const EAR = ISLAND_EAR;
  const compact = shown === "done";
  const stage = !isTauri; // browser preview: draw a fake desktop behind
  // Linux without a compositor: transparent pixels draw black, so the pill fills its window as a
  // solid tile (no floating edge or shadow that would show as a dark box around it)
  const opaque = !notch && !!geo.opaque;
  const win = notch ? (winSize.current ?? size) : (pcWin ?? size);
  const showTray = ["tray", "trayTooltip", "peek"].includes(shown) && trayItems.all.length > 0;
  const trayW = layout?.width ?? 0;

  // pill geometry (the black shape); tooltip / glow live outside it
  const rawPill = notch
    ? collapsed
      ? { width: geo.notchWidth, height: geo.notchHeight }
      : shown === "collapsed" && swollen
        ? { width: geo.notchWidth + 2 * SWELL_X, height: geo.notchHeight + SWELL_Y }
        : shown === "tray"
          ? { width: trayW - 2 * EAR + (swollen ? 2 * SWELL_X : 0), height: geo.notchHeight + (swollen ? SWELL_Y : 0) }
          : shown === "trayTooltip"
            ? { width: trayW - 2 * EAR, height: geo.notchHeight }
            : { width: size.width - EAR * 2, height: size.height }
    : opaque
      ? { width: win.width, height: win.height }
      : { width: win.width - 24, height: win.height - 24 };
  // whole points at rest (crisp edges at 1x; the collapsed shape keeps the hardware notch's size)
  const pill = collapsed ? rawPill : { width: Math.round(rawPill.width), height: Math.round(rawPill.height) };
  const bigCard = ["card", "claude", "reminder", "meetingSoon", "meetingExpanded", "peek", "history", "result", "error", "correction", "meetingPrompt", "confirm", "agent"].includes(shown);
  const panelOpen = shown === "peek";
  // one radius scale for the whole notch: the closed notch (a touch rounder than the hardware's,
  // so its corners stay hidden behind the camera housing), the live row, cards, the open panel
  const radius = notch
    ? collapsed
      ? `0 0 ${NOTCH_R.closed}px ${NOTCH_R.closed}px`
      : panelOpen
        ? `0 0 ${NOTCH_R.panel}px ${NOTCH_R.panel}px`
        : bigCard
          ? `0 0 ${NOTCH_R.card}px ${NOTCH_R.card}px`
          : compact || shown === "tray" || shown === "trayTooltip" || swollen || shown === "listening" || shown === "working"
            ? `0 0 ${NOTCH_R.row}px ${NOTCH_R.row}px`
            : `0 0 ${NOTCH_R.tall}px ${NOTCH_R.tall}px`
    : opaque
      ? "0px"
      : panelOpen
        ? "26px"
        : bigCard || shown === "trayTooltip"
          ? "22px"
          : "999px";
  // easing per direction (no overshoot either way); the shape leads, content follows
  const growing = pill.width * pill.height >= lastPill.current.width * lastPill.current.height;
  drawnPill.current = pill;
  // Windows / Linux: the window snaps to its new size, so the pill does too (a JS size animation
  // on WebKitGTK lagged behind the window and read as slow)
  const morph = reduce || !notch ? { duration: 0 } : growing ? MORPH_OPEN : MORPH_CLOSE;

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
    dict: formatHotkey(settings?.hotkeyDictation ?? "ctrl", geo.platform),
    asst: formatHotkey(settings?.hotkeyAssistant ?? "fn", geo.platform),
  };

  const glow = notch && (swollen || shown === "listening" || shown === "agentMode");
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
        justifyContent: "center",
        alignItems: notch ? "flex-start" : "center",
        padding: notch || opaque ? 0 : 12,
        boxSizing: "border-box",
        ...(opaque ? { background: "#05080d" } : {}),
        ...(!notch ? { cursor: dragging ? "grabbing" : undefined, touchAction: "none" } : {}),
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={swallowDragClick}
      onMouseEnter={(e) => onMouseMove(e)}
      onMouseMove={onMouseMove}
      onMouseLeave={() => {
        cancelAnimationFrame(moveRaf.current);
        moveRaf.current = 0;
        if (!backendHover.current) handleHover({ inside: false });
        setDomItem(-1);
      }}
    >
      <motion.div
        initial={false}
        animate={{ width: pill.width, height: pill.height, borderRadius: radius }}
        transition={morph}
        className={notch ? "relative bg-black text-white" : "relative text-white"}
        data-testid="island-pill"
        style={
          notch
            ? {
                overflow: "visible",
                // glow is bottom-weighted + tightly clipped (negative spread) so it hugs the rounded
                // pill instead of haloing the flat-topped notch as a rectangle.
                // static per state (never transitioned: an animated box-shadow repaints the whole
                // shape every frame); the hover glow is a separate layer that only fades its opacity
                boxShadow: glow
                  ? "inset 0 -1px 0 rgba(102,206,255,0.72), 0 5px 15px -11px rgba(61,187,255,0.5)"
                  : shown === "error"
                    ? "inset 0 -1px 0 rgba(252,211,77,0.35)"
                    : "none", // pure #000 otherwise: no rim, so it reads as the notch itself
              }
            : {
                // no backdrop-filter: the window is transparent over the desktop, so a blur here
                // only cost GPU time on every frame of the morph without blurring anything
                // solid: with no blur behind it, a see-through panel let the app underneath bleed into the text
                background: opaque ? "#05080d" : "linear-gradient(180deg, rgb(12,18,26), rgb(3,5,9))",
                border: `1px solid ${hover ? "rgba(147,221,255,0.30)" : "rgba(147,221,255,0.14)"}`,
                // the window is the pill + 12 px on every side: the drop shadow must end inside it
                // (a shadow cut by the window edge drew a dark box around the pill)
                boxShadow: opaque ? "inset 0 1px 0 rgba(255,255,255,0.09)" : "inset 0 1px 0 rgba(255,255,255,0.09), 0 5px 10px -5px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(0,0,0,0.6)",
                overflow: "hidden",
                transition: "border-color 160ms ease",
              }
        }
      >
        {notch && <Ears size={EAR} show={!collapsed || !hwNotch} instant={!!reduce} />}
        {/* hover: a calm accent rim along the bottom edge + a soft under-glow. Its own layer, so the
            hover only fades opacity (compositor) — nothing pops, nothing repaints */}
        {notch && (
          <span
            aria-hidden
            data-testid="notch-hover-glow"
            className="pointer-events-none absolute inset-0"
            style={{
              borderRadius: "inherit",
              boxShadow: "inset 0 -1px 0 rgba(147,221,255,0.55), 0 8px 22px -14px rgba(61,187,255,0.55)",
              opacity: hovering && !glow ? 1 : 0,
              transition: `opacity ${hovering ? 180 : 240}ms cubic-bezier(0.22,1,0.36,1)`,
            }}
          />
        )}
        <div
          className="absolute inset-0 overflow-hidden"
          style={{
            borderRadius: "inherit", // follows the morphing shape frame by frame
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
              leftWing={shown === "working" && settings?.avatar?.enabled === false}
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
          {/* Only the current content is rendered (enter animation only). Exit animations could leave
              ghost content (e.g. a frozen spinner) on screen if they were ever interrupted. */}
          {(
            <motion.div
              key={shown + (shown === "claude" ? headClaude?.id : "") + (shown === "correction" ? headFix?.id : "") + (shown === "confirm" ? headConfirm?.id : "")}
              className="absolute top-0"
              // opacity + transform only: both run on the compositor (an animated blur filter
              // repaints the whole card every frame and was the main source of stutter).
              // Laid out at the FINAL pill size and centred, so the morphing shape clips it
              // instead of reflowing it every frame.
              // No scale (a scaled panel re-rasterises and reads as a "pop"): a short fade with a
              // few px of drift, starting once the shape has led the way.
              // Windows / Linux: shown at once with its window (no frame-driven fade that a
              // throttled WebKitGTK island could leave half-drawn)
              initial={!notch ? false : panelOpen ? { opacity: 0, y: -4 } : { opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              // content fades in WITH the shape (a later start left the growing shape empty and black)
              transition={panelOpen ? { type: "tween", duration: 0.22, delay: 0.04, ease: EASE_OUT } : { type: "tween", duration: 0.18, delay: 0.03, ease: EASE_OUT }}
              style={{ transformOrigin: "50% 0%", left: "50%", width: pill.width, marginLeft: -pill.width / 2, height: pill.height }}
            >
              {shown === "agent" && agent ? (
                <AgentCard
                  agent={agent}
                  notch={notch}
                  geo={geo}
                  onStop={stopAgent}
                  onDismiss={() => setAgent(null)}
                  onAnswer={(yes) => api.agentConfirm(yes)}
                  handsfree={!!handsfree}
                  queued={handsfree?.queued}
                />
              ) : shown === "agentMode" && handsfree ? (
                <AgentModePill
                  hf={handsfree}
                  notch={notch}
                  geo={geo}
                  exitHint={`double-tap ${keys.asst} or say “stop”`}
                  onExit={() => api.toggleAgentMode().catch(() => setHandsfree(null))}
                />
              ) : shown === "confirm" && headConfirm ? (
                <ConfirmCard
                  c={headConfirm}
                  more={confirms.length - 1}
                  notch={notch}
                  geo={geo}
                  onAnswer={(ok) => answerConfirm(headConfirm, ok)}
                  index={confirms.indexOf(headConfirm)}
                  total={confirms.length}
                  onStep={(d) => setConfirmIdx((k) => Math.max(0, Math.min(confirms.length - 1, k + d)))}
                  expanded={expandedConfirm === headConfirm.id}
                  onToggleExpand={() => setExpandedConfirm((e) => (e === headConfirm.id ? null : headConfirm.id))}
                  onOpen={() => api.focusClaudeSession(headConfirm.sessionId, headConfirm.cwd).catch(() => {})}
                />
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
              ) : shown === "meetingSoon" && headMeeting ? (
                <MeetingCard alert={headMeeting} more={meetingAlerts.length - 1} notch={notch} geo={geo} onAction={(a) => answerMeeting(headMeeting, a)} />
              ) : shown === "meetingPrompt" && detected ? (
                <MeetingPromptCard app={detected} notch={notch} geo={geo} onStart={() => startNotes(detected)} onLater={() => setPromptOpen(false)} />
              ) : shown === "tray" || shown === "trayTooltip" ? (
                notch ? null : (
                  // the row keeps the capsule's 40 px; a hovered item's list opens below it
                  <div style={{ height: shown === "trayTooltip" ? 40 : "100%" }}>
                    <WinTray items={trayItems.all} onItem={onTrayItem} onHover={setDomItem} />
                  </div>
                )
              ) : (
                <IslandContent
                  avatar={settings?.avatar}
                  accent={settings?.accent}
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
                  scale={getNotchScale()}
                  onActed={() => {
                    setWidgetsOpen(false);
                    leaveNow();
                  }}
                  panel={
                    shown === "peek" ? (
                      <WidgetGrid
                        ids={widgetIds}
                        sessions={sessions}
                        onAction={(a) => {
                          if (a === "todos") api.openDashboard("todos");
                          else if (a === "customize") api.openDashboard("settings/appearance");
                          else api.openDashboard();
                        }}
                      />
                    ) : undefined
                  }
                  onAgentMode={() =>
                    api.toggleAgentMode().catch((err) => {
                      setPhase("error");
                      setMessage(String(err));
                    })
                  }
                  onClaude={dismissClaude}
                  onClaudeClearAll={clearAllClaude}
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
              {/* live = the island is open: a working session's arc only spins then (the resting
                  tray draws nothing per frame) */}
              <TrayRow items={trayItems.all} slots={layout.slots} pillW={pill.width} nh={geo.notchHeight} hot={tipIdx} onItem={onTrayItem} live={hover || shown !== "tray"} />
            </AnimatePresence>
          )}
          {/* the music live activity stays put while the shape morphs (collapsed → tray → panel) */}
          {notch && media && ["tray", "trayTooltip", "peek"].includes(shown) && <MusicWings np={media} geo={geo} />}
          {notch && panelOpen && <PanelHeader pillW={pill.width} nh={geo.notchHeight} inner={Math.max(geo.notchWidth / 2 + (musicLive ? MUSIC_WING : 0), ...(layout?.slots ?? []).map((s) => Math.abs(s.cx) + 12))} avatar={settings?.avatar} accent={settings?.accent} />}
        </div>
      </motion.div>
      <AnimatePresence>
        {shown === "trayTooltip" && tipItem && (
          <TrayTooltip
            item={tipItem}
            rect={
              notch && layout
                ? tooltipRect(win.width, layout.slots[tipIdx]?.cx ?? 0, geo.notchHeight, geomRef.current.tipH(tipIdx))
                : // Windows / Linux: inside the card, under the tray row (the window is sized for both)
                  { x: (win.width - pill.width) / 2 + 8, y: (win.height - pill.height) / 2 + 44, w: pill.width - 16, h: geomRef.current.tipH(tipIdx) }
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
            onDeleteTodo={(t) => {
              setTodos((list) => list.filter((x) => x.id !== t.id));
              api.deleteTodo(t.id).catch(() => {});
            }}
            scale={getNotchScale()}
          />
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <MotionConfig reducedMotion="user" transition={CALM}>
      {stage ? (
        <Stage notch={notch} nh={geo.notchHeight} hw={hwNotch ? { width: geo.notchWidth, height: geo.notchHeight } : null}>
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

const PANEL_DATE = new Intl.DateTimeFormat([], { weekday: "short", month: "short", day: "numeric" });

/** The notch row of the open panel: a greeting on the left wing, today's date on the right,
 *  shown only where they clear the camera, the music activity and tray icons. */
function PanelHeader({ pillW, nh, inner, avatar, accent }: { pillW: number; nh: number; inner: number; avatar?: AvatarSettings; accent?: string }) {
  const room = pillW / 2 - inner - 18;
  if (room < 70) return null;
  const now = new Date();
  return (
    <motion.div
      className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-[18px] text-[12px] font-medium"
      style={{ height: nh }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ type: "tween", duration: 0.2, delay: 0.12, ease: EASE_OUT }}
    >
      <span className="flex min-w-0 items-center gap-2" style={{ maxWidth: room }}>
        {avatar && avatar.enabled !== false && room >= 110 && (
          <Notchling variant="bare" mood={moodForState({ phase: "idle", hour: now.getHours() })} avatar={avatar} accent={accent} size={Math.max(18, Math.min(26, nh - 10))} testId="panel-avatar" />
        )}
        <span className="truncate text-white/80">{greeting(now.getHours())}</span>
      </span>
      <span className="truncate text-white/45" style={{ maxWidth: room }}>
        {PANEL_DATE.format(now)}
      </span>
    </motion.div>
  );
}

/** Concave "shoulders" where the island meets the top edge of the screen, like the hardware
 *  notch's fillets. Vector paths (crisp at 1x and 2x), each overlapping the body by 1 px so no
 *  hairline seam shows between the two shapes at fractional positions mid-morph. They grow in from
 *  the corner as the island opens (a closed hardware notch shows none: its own fillets are there). */
function Ears({ size, show, instant }: { size: number; show: boolean; instant: boolean }) {
  const d = {
    left: `M0 0H${size + 1}V${size}H${size}A${size} ${size} 0 0 0 0 0Z`,
    right: `M0 0H${size + 1}A${size} ${size} 0 0 0 1 ${size}H0Z`,
  };
  const ear = (side: "left" | "right") => (
    <svg
      aria-hidden
      data-testid={`notch-shoulder-${side}`}
      className="pointer-events-none absolute top-0"
      width={size + 1}
      height={size}
      viewBox={`0 0 ${size + 1} ${size}`}
      style={{
        [side]: -size,
        transform: `scale(${show ? 1 : 0})`,
        transformOrigin: side === "left" ? "100% 0" : "0 0",
        transition: instant ? "none" : `transform ${show ? 260 : 180}ms cubic-bezier(0.22,1,0.36,1)`,
        shapeRendering: "geometricPrecision",
      }}
    >
      <path d={d[side]} fill="#000" />
    </svg>
  );
  return (
    <>
      {ear("left")}
      {ear("right")}
    </>
  );
}

/** Browser-only preview stage: a macOS-like wallpaper + translucent menu bar, and (on a notched
 *  Mac) the camera housing itself, so screenshots show how the island merges with the hardware.
 *  ?wall=dark keeps the old night backdrop. */
function Stage({ notch, nh, hw, children }: { notch: boolean; nh: number; hw: { width: number; height: number } | null; children: React.ReactNode }) {
  const dark = new URLSearchParams(location.search).get("wall") === "dark";
  const menuH = hw ? nh : 24;
  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{
        background: dark
          ? "radial-gradient(1100px 600px at 20% 0%, #0b3b5c 0%, transparent 60%), radial-gradient(900px 700px at 90% 85%, #0a2a44 0%, transparent 55%), linear-gradient(160deg,#04070c,#000)"
          : "radial-gradient(900px 520px at 18% 8%, #f6b78c 0%, transparent 62%), radial-gradient(1000px 640px at 82% 0%, #8fb7ff 0%, transparent 60%), radial-gradient(900px 700px at 50% 110%, #3b3f9e 0%, transparent 65%), linear-gradient(180deg,#c9a3d9,#5a63c9)",
      }}
    >
      {notch ? (
        <>
          <div
            className="absolute inset-x-0 top-0 flex items-center justify-between px-4 text-[13px]"
            style={{
              height: menuH,
              color: dark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.85)",
              background: dark ? "rgba(20,20,30,0.35)" : "rgba(255,255,255,0.28)",
              backdropFilter: "blur(20px) saturate(180%)",
            }}
          >
            <span className="flex gap-5">
              <span className="font-semibold"> Flo</span>
              <span>File</span>
              <span>Edit</span>
              <span>View</span>
            </span>
            <span>Wed 5 Nov 12:41</span>
          </div>
          {/* the camera housing: the island must cover it exactly when closed */}
          {hw && (
            <div
              aria-hidden
              data-testid="stage-hardware-notch"
              className="absolute left-1/2 top-0 -translate-x-1/2 bg-black"
              style={{ width: hw.width, height: hw.height, borderRadius: "0 0 10px 10px" }}
            />
          )}
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
