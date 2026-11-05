import { useEffect } from "react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import clsx from "clsx";
import { BarChart3, CheckCircle2, FolderKanban, History, Home as HomeIcon, Settings as SettingsIcon, Sparkles, StickyNote, CircleAlert, CircleCheck, Info } from "lucide-react";
import { bootStore, hotkeyLabel, useStore, type Page } from "./store";
import Home from "./pages/Home";
import Assistant from "./pages/Assistant";
import Todos from "./pages/Todos";
import Projects from "./pages/Projects";
import Notes from "./pages/Notes";
import Analytics from "./pages/Analytics";
import HistoryPage from "./pages/History";
import Settings from "./pages/Settings";
import { Kbd } from "./ui";

const NAV: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: "home", label: "Home", icon: <HomeIcon size={16} /> },
  { id: "assistant", label: "Assistant", icon: <Sparkles size={16} /> },
  { id: "todos", label: "To-dos", icon: <CheckCircle2 size={16} /> },
  { id: "projects", label: "Projects", icon: <FolderKanban size={16} /> },
  { id: "notes", label: "Notes", icon: <StickyNote size={16} /> },
  { id: "analytics", label: "Analytics", icon: <BarChart3 size={16} /> },
  { id: "history", label: "History", icon: <History size={16} /> },
  { id: "settings", label: "Settings", icon: <SettingsIcon size={16} /> },
];

const PAGES: Record<Page, () => React.ReactElement> = {
  home: Home,
  assistant: Assistant,
  todos: Todos,
  projects: Projects,
  notes: Notes,
  analytics: Analytics,
  history: HistoryPage,
  settings: Settings,
};

export default function Dashboard() {
  useEffect(() => bootStore(), []);
  const page = useStore((s) => s.page);
  const go = useStore((s) => s.go);
  const todos = useStore((s) => s.todos);
  const claude = useStore((s) => s.claude);
  const notes = useStore((s) => s.notes);
  const geo = useStore((s) => s.geo);
  const openTodos = todos?.filter((t) => t.status === "open").length ?? 0;
  const unseenClaude = claude?.filter((c) => !c.seen).length ?? 0;
  const liveMeeting = notes?.some((n) => n.live);
  const Current = PAGES[page];
  const mac = geo?.platform !== "windows";

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex h-full overflow-hidden noise">
        <Backdrop />
        {/* sidebar */}
        <aside className="relative z-10 flex w-[216px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--glass)] backdrop-blur-2xl">
          <div data-tauri-drag-region className={clsx("shrink-0", mac ? "h-11" : "h-3")} />
          <div data-tauri-drag-region className="mb-4 flex items-center gap-2.5 px-4">
            <Logo />
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-tight">Flo Flow</div>
              <div className="text-[11px] text-faint">Local · BYOK · Private</div>
            </div>
          </div>
          <nav className="flex flex-col gap-0.5 px-2.5">
            {NAV.map((n) => {
              const active = page === n.id;
              const badge = n.id === "todos" ? openTodos : n.id === "home" ? unseenClaude : 0;
              return (
                <button
                  key={n.id}
                  onClick={() => go(n.id)}
                  className={clsx(
                    "relative flex h-9 items-center gap-2.5 rounded-xl px-2.5 text-[13.5px] transition",
                    active ? "text-[var(--fg)]" : "text-muted hover:bg-[var(--glass)] hover:text-[var(--fg)]",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-xl glass-strong"
                      transition={{ type: "spring", stiffness: 500, damping: 38 }}
                    />
                  )}
                  <span className={clsx("relative", active && "text-violet-400")}>{n.icon}</span>
                  <span className="relative font-medium">{n.label}</span>
                  {n.id === "notes" && liveMeeting && <span className="relative ml-auto h-2 w-2 rounded-full bg-red-500 animate-pulse" />}
                  {badge > 0 && (
                    <span
                      className={clsx(
                        "relative ml-auto min-w-5 rounded-full px-1.5 text-center text-[10.5px] font-semibold leading-[18px]",
                        n.id === "home" ? "bg-[#d97757] text-white" : "bg-[var(--glass-strong)] text-muted",
                      )}
                      title={n.id === "home" ? "Unseen Claude Code sessions" : "Open to-dos"}
                    >
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
          <div className="mt-auto p-3">
            <div className="rounded-2xl glass-strong p-3 text-[12px] text-muted">
              <div className="mb-1.5 flex items-center gap-1.5 font-medium text-[var(--fg)]">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" /> Ready
              </div>
              Hold <Kbd>{hotkeyLabel(geo)}</Kbd> anywhere to dictate.
            </div>
          </div>
        </aside>

        {/* content */}
        <main className="relative z-10 flex min-w-0 flex-1 flex-col">
          <div data-tauri-drag-region className="h-8 shrink-0" />
          <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10">
            <AnimatePresence mode="wait">
              <motion.div
                key={page}
                initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                className="mx-auto max-w-[1180px]"
              >
                <Current />
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
        <Toasts />
      </div>
    </MotionConfig>
  );
}

function Logo() {
  return (
    <div className="relative flex h-9 w-9 items-center justify-center rounded-xl accent-gradient shadow-[0_6px_20px_-6px_rgba(139,92,246,0.8)]">
      <div className="flex items-center gap-[2.5px]">
        {[0.45, 0.85, 1, 0.65].map((h, i) => (
          <span key={i} className="w-[3px] rounded-full bg-white" style={{ height: 16 * h }} />
        ))}
      </div>
    </div>
  );
}

function Backdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.div
        className="absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full opacity-[0.22] blur-[110px]"
        style={{ background: "#8b5cf6" }}
        animate={{ x: [0, 60, 0], y: [0, 40, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -bottom-48 right-[-120px] h-[560px] w-[560px] rounded-full opacity-[0.18] blur-[120px]"
        style={{ background: "#06b6d4" }}
        animate={{ x: [0, -50, 0], y: [0, -30, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="absolute left-1/2 top-1/3 h-[300px] w-[300px] rounded-full opacity-[0.08] blur-[100px]" style={{ background: "#f472b6" }} />
    </div>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40 }}
            className="glass-strong pointer-events-auto flex items-center gap-2.5 rounded-2xl px-4 py-3 text-[13px] shadow-xl"
          >
            {t.kind === "error" ? (
              <CircleAlert size={16} className="text-red-400" />
            ) : t.kind === "success" ? (
              <CircleCheck size={16} className="text-emerald-400" />
            ) : (
              <Info size={16} className="text-cyan-400" />
            )}
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
