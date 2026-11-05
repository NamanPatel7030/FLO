import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import { api, isTauri, on } from "../lib/api";
import { islandSize, ISLAND_EAR, wantsFix, type CardContent, type IslandVariant } from "../lib/format";
import {
  EV,
  type AssistantResponse,
  type ClaudeEvent,
  type Dictation,
  type IslandGeometry,
  type MeetingEvent,
  type Mode,
  type Phase,
  type StateEvent,
  type TranscriptEvent,
} from "../lib/types";
import { IslandContent } from "./IslandContent";
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


export default function Island() {
  const [geo, setGeo] = useState<IslandGeometry | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<Mode>("dictation");
  const [message, setMessage] = useState<string | undefined>();
  const [card, setCard] = useState<AssistantResponse | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [history, setHistory] = useState<Dictation[] | null>(null);
  const [claudeQueue, setClaudeQueue] = useState<ClaudeEvent[]>([]);
  const [meeting, setMeeting] = useState<MeetingInfo>({ live: false, startedAt: 0 });
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const reduce = useReducedMotion();
  const modeRef = useRef<Mode>("dictation");

  useEffect(() => {
    api.getIslandGeometry().then(setGeo);
  }, []);

  // ── backend events ──────────────────────────────────────────────────────
  useEffect(() => {
    const offs = [
      on<StateEvent>(EV.state, (e) => {
        setPhase(e.phase);
        setMode(e.mode);
        modeRef.current = e.mode;
        setMessage(e.message);
        if (e.mode === "meeting" && e.phase === "listening")
          setMeeting((m) => (m.live ? m : { live: true, startedAt: Date.now() }));
        if (e.phase === "listening" && e.mode !== "meeting") {
          setCard(null);
          setResult(null);
          setHistory(null);
        }
      }),
      on<TranscriptEvent>(EV.transcript, (t) => {
        if (t.final && modeRef.current !== "assistant" && t.text.trim()) setResult(t.text.trim());
      }),
      on<AssistantResponse>(EV.assistant, (r) => setCard(r)),
      on<ClaudeEvent | null>(EV.claude, (e) => {
        if (e && e.id) setClaudeQueue((q) => (q.some((x) => x.id === e.id) ? q : [...q, e]));
      }),
      on<MeetingEvent>(EV.meeting, (e) => {
        if (!e.live) {
          setMeeting({ live: false, startedAt: 0 });
          setMeetingOpen(false);
          return;
        }
        setMeeting((m) => ({
          live: true,
          noteId: e.noteId,
          startedAt: m.live ? m.startedAt : Date.now() - e.elapsedSec * 1000,
          lastLine: e.segment?.text ?? m.lastLine,
          summary: e.summary ?? m.summary,
        }));
      }),
    ];
    return () => offs.forEach((f) => f());
  }, []);

  const openHistory = useCallback(() => {
    api.listHistory(6).then((h) => setHistory(h)).catch(() => setHistory([]));
  }, []);

  // demo driver (browser only, ?demo=…)
  useEffect(() => {
    const demo = new URLSearchParams(location.search).get("demo");
    if (!isTauri && demo) return runDemo(demo, { setHover, setMeetingOpen, openHistory });
  }, [openHistory]);

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

  // ── target variant ──────────────────────────────────────────────────────
  const target: IslandVariant = useMemo(() => {
    if (mode !== "meeting" && phase === "listening") return "listening";
    if (phase === "transcribing" || phase === "thinking") return "working";
    if (phase === "error") return "error";
    if (result) return "result";
    if (phase === "done" && mode !== "assistant") return "done";
    if (card) return "card";
    if (claudeQueue.length) return "claude";
    if (history) return "history";
    if (meeting.live) return meetingOpen ? "meetingExpanded" : "meeting";
    if (hover) return "peek";
    return "collapsed";
  }, [phase, mode, result, card, claudeQueue.length, history, meeting.live, meetingOpen, hover]);

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
      default:
        return undefined;
    }
  };
  const content = contentFor(target);
  const contentKey = JSON.stringify(content ?? null);

  // ── resize protocol: grow window first, animate, shrink window after ────
  const [shown, setShown] = useState<IslandVariant>("collapsed");
  const [shownContent, setShownContent] = useState<CardContent | undefined>();
  const winSize = useRef<{ width: number; height: number } | null>(null);
  const shrinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // auto-dismiss assistant card after 8s (paused while hovered)
  useEffect(() => {
    if (!card || hover) return;
    const t = setTimeout(() => setCard(null), 8000);
    return () => clearTimeout(t);
  }, [card, hover]);

  // auto-collapse claude reminder after 10s
  const headClaude = claudeQueue[0];
  useEffect(() => {
    if (!headClaude || hover) return;
    const t = setTimeout(() => setClaudeQueue((q) => q.slice(1)), 10000);
    return () => clearTimeout(t);
  }, [headClaude, hover]);

  // Esc: cancel / dismiss · click-away (window blur) closes transient cards
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (phase === "listening" && mode !== "meeting") api.cancelSession();
      else if (history) setHistory(null);
      else if (card) setCard(null);
      else if (result) setResult(null);
      else if (phase === "error") setPhase("idle");
      else if (headClaude) setClaudeQueue((q) => q.slice(1));
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
  }, [phase, mode, card, headClaude, history, result]);

  const dismissClaude = useCallback((seen: boolean) => {
    setClaudeQueue((q) => {
      // "Open" jumps to the editor / terminal where the session runs (and marks it seen)
      if (seen && q[0]) api.openClaudeSession(q[0].id).catch(() => api.markClaudeSeen(q[0].id));
      return q.slice(1);
    });
  }, []);

  // Hover: the island is a non-activating panel, so DOM mouseleave is unreliable while another
  // app is active. The backend tracks the cursor and tells us; peek also auto-closes after 4 s.
  useEffect(() => on<{ inside: boolean }>(EV.hover, (e) => setHover(e.inside)), []);
  useEffect(() => {
    if (!hover) return;
    const t = setTimeout(() => setHover(false), 4000);
    return () => clearTimeout(t);
  }, [hover]);

  if (!geo) return null;

  const notch = geo.platform === "macos" && geo.hasNotch;
  const size = islandSize(shown, geo, shownContent);
  const collapsed = shown === "collapsed";
  const EAR = ISLAND_EAR;
  const compact = shown === "done";
  const stage = !isTauri; // browser preview: draw a fake desktop behind
  const win = winSize.current ?? size;

  // pill geometry
  const pill = notch
    ? { width: collapsed ? size.width : size.width - EAR * 2, height: size.height }
    : { width: size.width - 24, height: size.height - 24 };
  const bigCard = ["card", "claude", "meetingExpanded", "peek", "history", "result", "error"].includes(shown);
  // MacBook notch bottom corners are ~9pt; compact wings use 13pt so they read as one shape.
  const radius = notch
    ? collapsed
      ? "0 0 9px 9px"
      : bigCard
        ? "0 0 22px 22px"
        : compact
          ? "0 0 13px 13px"
          : "0 0 18px 18px"
    : bigCard
      ? "22px"
      : "999px";

  const island = (
    <div
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
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
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
                // hairline light-blue glow along the bottom edge while live
                boxShadow:
                  shown === "listening"
                    ? "inset 0 -1px 0 rgba(102,206,255,0.55)"
                    : shown === "error"
                      ? "inset 0 -1px 0 rgba(252,211,77,0.35)"
                      : bigCard
                        ? "inset 0 -1px 0 rgba(147,221,255,0.14)"
                        : "none",
              }
            : {
                background: "linear-gradient(180deg, rgba(10,16,24,0.80), rgba(2,4,8,0.88))",
                backdropFilter: "blur(30px) saturate(180%)",
                WebkitBackdropFilter: "blur(30px) saturate(180%)",
                border: "1px solid rgba(147,221,255,0.16)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10), 0 14px 36px -10px rgba(0,0,0,0.7), 0 0 0 0.5px rgba(0,0,0,0.6)",
                overflow: "hidden",
              }
        }
      >
        {notch && !collapsed && <Ears size={EAR} />}
        <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: radius }}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={shown + (shown === "claude" ? headClaude?.id : "")}
              className="absolute inset-0"
              initial={{ opacity: 0, filter: "blur(6px)", scale: 0.97 }}
              animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
              exit={{ opacity: 0, filter: "blur(6px)", scale: 0.97 }}
              transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
            >
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
                onCloseCard={() => setCard(null)}
                onCloseError={() => setPhase("idle")}
                onCloseHistory={() => setHistory(null)}
                onOpenHistory={openHistory}
                onClaude={dismissClaude}
                onToggleMeeting={() => setMeetingOpen((v) => !v)}
              />
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );

  return (
    <MotionConfig reducedMotion="user">
      {stage ? <Stage notch={notch} nh={geo.notchHeight}>{island}</Stage> : island}
    </MotionConfig>
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
