import { useEffect, useState } from "react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import clsx from "clsx";
import { api, on } from "../lib/api";
import { EV, type ClaudeSession } from "../lib/types";
import { BarChart3, CheckCircle2, FolderKanban, History, Home as HomeIcon, Settings as SettingsIcon, Sparkles, StickyNote, CircleAlert, CircleCheck, Info, Zap } from "lucide-react";
import { bootStore, hotkeyLabel, useStore, type Page } from "./store";
import Home from "./pages/Home";
import Assistant from "./pages/Assistant";
import Todos from "./pages/Todos";
import Projects from "./pages/Projects";
import Notes from "./pages/Notes";
import Analytics from "./pages/Analytics";
import HistoryPage from "./pages/History";
import Settings from "./pages/Settings";
import SkillsPage from "./pages/Skills";
import Typing from "./pages/Typing";
import { Signature } from "./Signature";
import { Ocean } from "../island/Ocean";
import { Kbd } from "./ui";
import { Logo } from "./Logo";
import { missingRequired, usePermissions } from "./usePermissions";
import { Onboarding } from "./Onboarding";
import { SignIn } from "./SignIn";
import { useAccount } from "../lib/account";

const NAV: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: "home", label: "Home", icon: <HomeIcon size={16} /> },
  { id: "assistant", label: "Assistant", icon: <Sparkles size={16} /> },
  { id: "skills", label: "Skills", icon: <Zap size={16} /> },
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
  skills: SkillsPage,
  // old links to Context land on Skills → Knowledge
  context: KnowledgeRedirect,
  todos: Todos,
  projects: Projects,
  notes: Notes,
  analytics: Analytics,
  history: HistoryPage,
  settings: Settings,
  typing: Typing,
};

export default function Dashboard() {
  useEffect(() => bootStore(), []);
  const page = useStore((s) => s.page);
  const go = useStore((s) => s.go);
  const todos = useStore((s) => s.todos);
  const claude = useStore((s) => s.claude);
  const notes = useStore((s) => s.notes);
  const geo = useStore((s) => s.geo);
  const settings = useStore((s) => s.settings);
  const account = useAccount();
  const signedIn = !!account.status?.signedIn || (account.offlineOk && !!account.status?.user);
  const openTodos = todos?.filter((t) => t.status === "open").length ?? 0;
  // Home badge = live Claude sessions needing attention (matches the Home card), not stale events
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  useEffect(() => {
    api.listClaudeSessions().then(setSessions).catch(() => setSessions([]));
    return on<ClaudeSession[]>(EV.claudeSessions, (l) => setSessions(Array.isArray(l) ? l : []));
  }, []);
  const claudeAttention = sessions.filter((s) => s.status !== "working").length;
  void claude;
  const liveMeeting = notes?.some((n) => n.live);
  const Current = PAGES[page];
  const mac = geo?.platform !== "windows";
  const perms = usePermissions(5000);
  const missing = missingRequired(perms);
  const ready = !perms || (missing.length === 0 && perms.hotkeyActive);

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex h-full overflow-hidden noise">
        <Backdrop />
        {/* sidebar */}
        <aside className="relative z-10 flex w-[216px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--glass)] backdrop-blur-2xl">
          <div data-tauri-drag-region className={clsx("shrink-0", mac ? "h-11" : "h-3")} />
          <div data-tauri-drag-region className="mb-4 flex items-center gap-2.5 px-4">
            <Logo size={34} />
            <div className="leading-tight">
              <div className="text-[15.5px] font-semibold tracking-tight">Flo</div>
              <div className="text-[11px] font-medium tracking-wide text-brand-300/70">Your Assistant</div>
            </div>
          </div>
          <nav className="flex flex-col gap-0.5 px-2.5">
            {NAV.map((n) => {
              const active = page === n.id;
              const badge = n.id === "todos" ? openTodos : n.id === "home" ? claudeAttention : 0;
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
                  <span className={clsx("relative", active && "text-brand-400")}>{n.icon}</span>
                  <span className="relative font-medium">{n.label}</span>
                  {n.id === "notes" && liveMeeting && <span className="relative ml-auto h-2 w-2 rounded-full bg-red-500 animate-pulse" />}
                  {badge > 0 && (
                    <span
                      data-testid={`nav-badge-${n.id}`}
                      className={clsx(
                        "relative ml-auto min-w-5 rounded-full px-1.5 text-center text-[10.5px] font-semibold leading-[18px]",
                        n.id === "home" ? "bg-[#d97757] text-white" : "bg-[var(--glass-strong)] text-muted",
                      )}
                      title={n.id === "home" ? "Claude sessions needing attention" : "Open to-dos"}
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
              {ready ? (
                <>
                  <div className="mb-1.5 flex items-center gap-1.5 font-medium text-[var(--fg)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-brand-300 shadow-[0_0_8px_#66ceff]" /> Ready
                  </div>
                  Hold <Kbd>{hotkeyLabel(geo, settings)}</Kbd> anywhere to dictate.
                </>
              ) : (
                <button className="w-full text-left" onClick={() => go("settings", "permissions")}>
                  <div className="mb-1.5 flex items-center gap-1.5 font-medium text-amber-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Finish setup
                  </div>
                  {missing.length > 0 ? `Grant ${missing.map((m) => m.label).join(", ")}` : "Restart Flo to activate the fn key"} →
                </button>
              )}
            </div>
            <div className="mt-2.5">
              <Signature />
            </div>
          </div>
        </aside>

        {/* content */}
        <main className="relative z-10 flex min-w-0 flex-1 flex-col">
          <div data-tauri-drag-region className="h-8 shrink-0" />
          <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10 xl:px-12">
            <AnimatePresence mode="wait">
              <motion.div
                key={page}
                initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                className="mx-auto w-full max-w-[1240px]"
              >
                <Current />
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
        <Toasts />
        {/* account gate first, then first-run onboarding (or Settings → General → Run setup again) */}
        {account.status && !signedIn ? <SignIn status={account.status} /> : account.status && settings?.onboarded === false ? <Onboarding /> : null}
      </div>
    </MotionConfig>
  );
}

/** Static glow backdrop (no infinite animation → near-zero GPU when idle). */
/** Subtle ocean: deep navy → black gradient + a slow, low-opacity wave band along the bottom. */
function Backdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(640px 520px at -6% -8%, rgba(61,187,255,0.14), transparent 70%), radial-gradient(900px 500px at 50% 120%, rgba(6,42,68,0.55), transparent 70%), linear-gradient(180deg, rgba(2,4,8,0) 0%, rgba(4,20,34,0.45) 100%)",
        }}
      />
      <div className="absolute inset-x-0 bottom-0 opacity-[0.22]" data-testid="ocean-backdrop">
        <Ocean width={1600} height={120} calm foam style={{ width: "100%", height: 120 }} />
      </div>
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
              <Info size={16} className="text-brand-400" />
            )}
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Context moved into Skills as the Knowledge tab. */
function KnowledgeRedirect() {
  const go = useStore((st) => st.go);
  useEffect(() => go("skills", "knowledge"), [go]);
  return <></>;
}
