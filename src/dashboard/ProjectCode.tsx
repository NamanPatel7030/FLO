// Projects → Code: clone a GitHub repo or link a folder, see its git state, and "Edit with AI" —
// hand a task to Claude Code / Codex / Gemini CLI in Terminal (or headless, in the background).
import { deviceWord, modKey } from "../lib/os";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import {
  ArrowLeft,
  CircleStop,
  CodeXml,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  LoaderCircle,
  Mic,
  SendHorizontal,
  Sparkles,
  SquareTerminal,
  TriangleAlert,
  Unlink,
  X,
} from "lucide-react";
import { api, on } from "../lib/api";
import { codeApi, parseGithubUrl, agentReady, type AgentId, type CloneProgress, type CodeRun, type RepoInfo, type RunMode } from "../lib/code";
import { relativeTime } from "../lib/format";
import { EV, type Project, type StateEvent } from "../lib/types";
import { AgentTile, CodingAgents, useCodingAgents } from "./CodingAgents";
import { useStore } from "./store";
import { Button } from "./ui";

// ── "Add code" from a project card opens the drawer straight on the clone form ──
let pendingAdd: string | null = null;
export function requestAddCode(projectId: string) {
  pendingAdd = projectId;
}
function takePendingAdd(projectId: string) {
  const hit = pendingAdd === projectId;
  if (hit) pendingAdd = null;
  return hit;
}

export const GithubMark = ({ size = 14 }: { size?: number }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
);

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;
const tildify = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");
const shortRemote = (u?: string) => u?.replace(/^https:\/\/(www\.)?github\.com\//, "").replace(/^git@github\.com:/, "").replace(/\.git$/, "");

/** Small chip on a project card: the linked repo, or an "Add code" button. */
export function CodeChip({ p, onAdd }: { p: Project; onAdd: () => void }) {
  if (p.localPath)
    return (
      <span className="inline-flex max-w-[60%] items-center gap-1 truncate rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10.5px] text-muted" title={p.localPath} data-testid="code-chip">
        <CodeXml size={11} className="shrink-0" />
        <span className="truncate">{shortRemote(p.repoUrl) ?? basename(p.localPath)}</span>
      </span>
    );
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onAdd();
      }}
      className="inline-flex items-center gap-1 rounded-full border border-dashed border-white/15 px-2 py-0.5 text-[10.5px] font-medium text-faint transition hover:border-[var(--accent)] hover:text-[var(--fg)]"
      aria-label={`Add code to ${p.name}`}
    >
      <CodeXml size={11} /> Add code
    </button>
  );
}

const section = "mb-5 rounded-2xl glass p-3.5";
const label = "flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-faint";

/** The drawer's Code section. */
export function CodeSection({ p }: { p: Project }) {
  const toast = useStore((x) => x.toast);
  const [view, setView] = useState<"idle" | "clone">(() => (!p.localPath && takePendingAdd(p.id) ? "clone" : "idle"));
  const [info, setInfo] = useState<RepoInfo | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!p.localPath) {
      setInfo(null);
      return;
    }
    let live = true;
    codeApi.repoInfo(p.id).then((i) => live && setInfo(i)).catch(() => {});
    return () => {
      live = false;
    };
  }, [p.id, p.localPath]);

  const linkExisting = async () => {
    try {
      const path = await codeApi.chooseFolder(`Choose the folder with ${p.name}'s code`);
      if (!path) return;
      setInfo(await codeApi.linkFolder(p.id, path));
      setView("idle");
      toast({ kind: "success", text: `Linked ${basename(path)}` });
    } catch (e) {
      toast({ kind: "error", text: String(e) });
    }
  };

  return (
    <div className={section} data-testid="code-section">
      <div className="mb-2.5 flex items-center justify-between">
        <div className={label}>
          <CodeXml size={13} /> Code
        </div>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {p.localPath ? (
          <motion.div key="linked" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <RepoCard p={p} info={info} onEdit={() => setEditing(true)} editing={editing} />
            <AnimatePresence>{editing && <EditWithAI p={p} onClose={() => setEditing(false)} />}</AnimatePresence>
            <Runs p={p} />
          </motion.div>
        ) : view === "clone" ? (
          <motion.div key="clone" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <CloneForm p={p} onCancel={() => setView("idle")} onDone={(i) => (setInfo(i), setView("idle"))} />
          </motion.div>
        ) : (
          <motion.div key="empty" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} data-testid="code-empty">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-white/10 to-white/[0.02] text-muted ring-1 ring-white/10">
                <CodeXml size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium">Add your code</div>
                <div className="mt-0.5 text-[12px] leading-snug text-muted">Clone the repo or link a folder on your {deviceWord()}, then ask Claude, ChatGPT or Gemini to build features in it.</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="primary" size="sm" icon={<GithubMark size={13} />} onClick={() => setView("clone")} className="h-8">
                Clone from GitHub
              </Button>
              <Button size="sm" icon={<FolderOpen size={13} />} onClick={linkExisting} className="h-8">
                Use an existing folder
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── clone ─────────────────────────────────────────────────────────────────
function CloneForm({ p, onCancel, onDone }: { p: Project; onCancel: () => void; onDone: (i: RepoInfo) => void }) {
  const toast = useStore((x) => x.toast);
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [progress, setProgress] = useState<CloneProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = parseGithubUrl(url);
  const invalid = touched && url.trim() !== "" && !ref;

  useEffect(() => codeApi.onClone((ev) => ev.projectId === p.id && setProgress(ev)), [p.id]);

  const clone = async () => {
    setTouched(true);
    if (!ref || busy) return;
    setError(null);
    setBusy(true);
    try {
      const parent = await codeApi.chooseFolder(`Where should ${ref.repo} go? Flo clones it into a new “${ref.repo}” folder inside the one you pick.`);
      if (!parent) return;
      setProgress({ projectId: p.id, phase: "Starting", percent: 0, message: `Cloning ${ref.owner}/${ref.repo}…` });
      const info = await codeApi.cloneRepo(p.id, url.trim(), parent);
      toast({ kind: "success", text: `Cloned ${ref.repo} to ${tildify(info.path)}` });
      onDone(info);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div data-testid="clone-form">
      <div className="flex items-center gap-2">
        <button onClick={onCancel} disabled={busy} className="rounded-lg p-1 text-faint hover:bg-[var(--glass)] hover:text-[var(--fg)] disabled:opacity-40" aria-label="Back">
          <ArrowLeft size={14} />
        </button>
        <div className="text-[13px] font-medium">Clone from GitHub</div>
      </div>
      <div className="relative mt-2.5">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">
          <GithubMark size={14} />
        </span>
        <input
          autoFocus
          aria-label="GitHub repository URL"
          placeholder="https://github.com/owner/repo"
          value={url}
          disabled={busy}
          onChange={(e) => (setUrl(e.target.value), setError(null))}
          onBlur={() => setTouched(true)}
          onKeyDown={(e) => e.key === "Enter" && clone()}
          spellCheck={false}
          className={clsx(
            "h-9 w-full rounded-xl border bg-[var(--glass)] pl-9 pr-3 font-mono text-[12.5px] outline-none transition placeholder:font-sans placeholder:text-[var(--fg-faint)] focus:ring-2",
            invalid ? "border-rose-400/50 focus:ring-rose-500/20" : "border-[var(--border)] focus:border-brand-400/60 focus:ring-brand-500/20",
          )}
        />
      </div>
      <div className="mt-1.5 min-h-[16px] text-[11.5px]">
        {invalid ? (
          <span className="text-rose-300">Use a GitHub repo URL: https://github.com/owner/repo or git@github.com:owner/repo.git</span>
        ) : ref ? (
          <span className="text-faint">
            Clones <span className="font-mono text-muted">{ref.owner}/{ref.repo}</span> into a folder you pick next.
          </span>
        ) : (
          <span className="text-faint">Public repos work right away. Private ones use your git / GitHub sign-in.</span>
        )}
      </div>

      <AnimatePresence>
        {progress && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-2 rounded-xl bg-black/25 p-3" data-testid="clone-progress">
              <div className="flex items-center justify-between text-[12px]">
                <span className="flex items-center gap-1.5 text-muted">
                  <LoaderCircle size={12} className="animate-spin" /> {progress.phase}
                </span>
                <span className="font-mono tabular-nums text-[var(--fg)]">{progress.percent}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <motion.div className="h-full rounded-full accent-gradient" animate={{ width: `${Math.max(3, progress.percent)}%` }} transition={{ type: "spring", stiffness: 120, damping: 22 }} />
              </div>
              <div className="mt-1.5 truncate font-mono text-[10.5px] text-faint">{progress.message}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-rose-400/20 bg-rose-500/10 p-2.5 text-[12px] leading-snug text-rose-200" role="alert" data-testid="clone-error">
          <TriangleAlert size={13} className="mt-[2px] shrink-0" />
          <span className="select-text">{error}</span>
        </div>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" icon={busy ? <LoaderCircle size={13} className="animate-spin" /> : <FolderOpen size={13} />} disabled={!ref || busy} onClick={clone}>
          {busy ? "Cloning…" : "Choose folder & clone"}
        </Button>
      </div>
    </div>
  );
}

// ── repo card ─────────────────────────────────────────────────────────────
function RepoCard({ p, info, onEdit, editing }: { p: Project; info: RepoInfo | null; onEdit: () => void; editing: boolean }) {
  const toast = useStore((x) => x.toast);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const open = (target: "finder" | "vscode" | "terminal") => codeApi.open(p.id, target).catch((e) => toast({ kind: "error", text: String(e) }));
  const path = info?.path ?? p.localPath ?? "";
  const remote = shortRemote(info?.remote ?? p.repoUrl);
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-gradient-to-b from-white/[0.05] to-white/[0.015]" data-testid="repo-card">
      <div className="p-3">
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/30 text-[var(--fg)] ring-1 ring-white/10">{remote ? <GithubMark size={16} /> : <FolderOpen size={16} />}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[14px] font-semibold tracking-tight" data-testid="repo-name">
                {info?.name ?? basename(path)}
              </span>
              {info?.branch && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-white/[0.07] px-1.5 py-[1px] font-mono text-[10.5px] text-muted" data-testid="repo-branch">
                  <GitBranch size={10} /> {info.branch}
                </span>
              )}
            </div>
            <div className="truncate font-mono text-[10.5px] text-faint" title={remote ? `${remote}\n${path}` : path}>
              {remote && remote.split("/").pop() !== basename(path) ? `${remote} · ` : remote ? `${remote.split("/")[0]} · ` : ""}
              {tildify(path)}
            </div>
          </div>
          {info &&
            (info.exists && info.isGit ? (
              <span
                className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium", info.changed ? "bg-amber-400/15 text-amber-300" : "bg-emerald-400/15 text-emerald-300")}
                data-testid="repo-dirty"
              >
                {info.changed ? `${info.changed} changed` : "Clean"}
              </span>
            ) : (
              <span className="shrink-0 rounded-full bg-[var(--glass-strong)] px-2 py-0.5 text-[10.5px] font-medium text-faint">{info.exists ? "Not a git repo" : "Folder missing"}</span>
            ))}
        </div>
        {info?.lastCommit && (
          <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-black/20 px-2.5 py-1.5 text-[11.5px]" data-testid="repo-commit">
            <GitCommitHorizontal size={13} className="shrink-0 text-faint" />
            <span className="font-mono text-[10.5px] text-brand-200">{info.lastCommit.hash}</span>
            <span className="min-w-0 flex-1 truncate text-muted">{info.lastCommit.subject}</span>
            <span className="shrink-0 text-[10.5px] text-faint">{relativeTime(info.lastCommit.at)}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 border-t border-white/[0.06] bg-black/10 px-2 py-1.5">
        <IconAction label="Open in Finder" text="Finder" onClick={() => open("finder")} icon={<FolderOpen size={13} />} />
        <IconAction label="Open in VS Code" text="VS Code" onClick={() => open("vscode")} icon={<CodeXml size={13} />} />
        <IconAction label="Open in Terminal" text="Terminal" onClick={() => open("terminal")} icon={<SquareTerminal size={13} />} />
        <div className="flex-1" />
        {confirmUnlink ? (
          <span className="flex items-center gap-1 text-[11px] text-faint">
            Files stay on disk.
            <button
              className="rounded-md px-1.5 py-0.5 font-medium text-rose-300 hover:bg-rose-500/10"
              onClick={() => codeApi.unlink(p.id).catch((e) => toast({ kind: "error", text: String(e) }))}
            >
              Remove link
            </button>
            <button className="rounded-md p-0.5 hover:bg-[var(--glass)]" onClick={() => setConfirmUnlink(false)} aria-label="Keep link">
              <X size={12} />
            </button>
          </span>
        ) : (
          <>
            <IconAction label="Remove link" onClick={() => setConfirmUnlink(true)} icon={<Unlink size={13} />} />
            {!editing && (
              <Button size="sm" variant="primary" icon={<Sparkles size={12} />} onClick={onEdit} className="ml-1">
                Edit with AI
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function IconAction({ label, text, icon, onClick }: { label: string; text?: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={clsx("flex h-7 items-center justify-center gap-1.5 rounded-lg text-[11.5px] font-medium text-muted transition hover:bg-white/[0.07] hover:text-[var(--fg)]", text ? "px-2" : "w-7")}
    >
      {icon}
      {text}
    </button>
  );
}

// ── Edit with AI ──────────────────────────────────────────────────────────
function Seg<T extends string>({ value, onChange, options, ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; disabled?: boolean; title?: string }[]; ariaLabel: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex gap-1 rounded-xl bg-black/25 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={clsx(
            "relative flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11.5px] font-medium transition disabled:cursor-not-allowed disabled:opacity-35",
            value === o.value ? "text-[var(--fg)]" : "text-muted hover:text-[var(--fg)]",
          )}
        >
          {value === o.value && <motion.span layoutId={`seg-${ariaLabel}`} className="absolute inset-0 rounded-lg bg-white/[0.09] ring-1 ring-white/10" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
          <span className="relative flex items-center gap-1.5">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function Check({ checked, onChange, children, testid }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; testid?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-[12px] leading-snug text-muted" data-testid={testid}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-[2px] h-3.5 w-3.5 shrink-0 accent-[var(--accent)]" />
      <span>{children}</span>
    </label>
  );
}

/** Dictate into the prompt with Flo's own dictation (pastes into the focused field). */
function useDictation(focus: () => void) {
  const [listening, setListening] = useState(false);
  const active = useRef(false);
  useEffect(
    () =>
      on<StateEvent>(EV.state, (s) => {
        if (!active.current || s.mode !== "dictation") return;
        if (s.phase === "listening") setListening(true);
        if (s.phase === "idle" || s.phase === "error" || s.phase === "done") {
          setListening(false);
          active.current = false;
        }
      }),
    [],
  );
  const toggle = async () => {
    try {
      if (active.current) {
        setListening(false);
        await api.stopSession();
      } else {
        focus();
        active.current = true;
        await api.startSession("dictation");
      }
    } catch {
      active.current = false;
      setListening(false);
    }
  };
  return { listening, toggle };
}

function EditWithAI({ p, onClose }: { p: Project; onClose: () => void }) {
  const toast = useStore((x) => x.toast);
  const agentsState = useCodingAgents();
  const { agents } = agentsState;
  const [prompt, setPrompt] = useState("");
  const [agent, setAgent] = useState<AgentId | null>(null);
  const [mode, setMode] = useState<RunMode>("terminal");
  const [accept, setAccept] = useState(false);
  const [notes, setNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const dictation = useDictation(() => ta.current?.focus());
  const ready = agents?.filter(agentReady) ?? [];
  const none = agents !== null && ready.length === 0;

  useEffect(() => {
    if (agents && (!agent || !ready.some((a) => a.id === agent))) setAgent(ready[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents]);

  const go = async () => {
    if (!prompt.trim() || !agent || busy) return;
    if (mode === "background" && !accept) return;
    setBusy(true);
    try {
      const run = await codeApi.editWithAi({ projectId: p.id, prompt: prompt.trim(), agent, mode, includeNotes: notes, acceptEdits: mode === "background" && accept });
      const name = agents?.find((a) => a.id === agent)?.name ?? agent;
      toast({ kind: "success", text: mode === "terminal" ? `${name} opened in Terminal. Flo's notch shows when it needs you.` : `${name} is working in the background.` });
      setPrompt("");
      window.dispatchEvent(new CustomEvent("flo:code-run", { detail: run }));
      if (mode === "terminal") onClose();
    } catch (e) {
      toast({ kind: "error", text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
      <div className="mt-3 rounded-xl border border-[var(--accent)]/25 bg-gradient-to-b from-[var(--accent)]/[0.07] to-transparent p-3" data-testid="edit-with-ai">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight">
            <Sparkles size={14} className="text-brand-300" /> Edit with AI
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-faint hover:bg-[var(--glass)] hover:text-[var(--fg)]" aria-label="Close Edit with AI">
            <X size={14} />
          </button>
        </div>

        {none || showAgents ? (
          <div data-testid="connect-inline">
            <div className="mb-2 text-[12.5px] text-muted">{none ? `Connect an AI coding account first. Flo hands your task to it on this ${deviceWord()}.` : "Your coding agents"}</div>
            <CodingAgents compact state={agentsState} />
            {!none && (
              <button className="mt-2 text-[11.5px] font-medium text-brand-300 hover:text-brand-200" onClick={() => setShowAgents(false)}>
                Done
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="relative">
              <textarea
                ref={ta}
                aria-label="What should I build?"
                placeholder="What should I build? e.g. “Add a dark mode toggle to the settings page”"
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && go()}
                className="w-full resize-none rounded-xl border border-[var(--border)] bg-black/25 px-3 py-2.5 pr-10 text-[13px] leading-relaxed outline-none transition placeholder:text-faint focus:border-brand-400/60 focus:ring-2 focus:ring-brand-500/20"
              />
              <button
                onClick={dictation.toggle}
                aria-label={dictation.listening ? "Stop dictating" : "Dictate"}
                title={dictation.listening ? "Stop dictating" : "Dictate"}
                className={clsx(
                  "absolute bottom-2.5 right-2 flex h-7 w-7 items-center justify-center rounded-lg transition",
                  dictation.listening ? "bg-rose-500/20 text-rose-300" : "text-faint hover:bg-white/[0.07] hover:text-[var(--fg)]",
                )}
              >
                {dictation.listening && <span className="absolute inset-0 animate-ping rounded-lg bg-rose-400/20" />}
                <Mic size={14} className="relative" />
              </button>
            </div>

            <div className="mt-2.5 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-faint">
              <span>Agent</span>
              <button className="normal-case tracking-normal text-brand-300 hover:text-brand-200" onClick={() => setShowAgents(true)}>
                Manage accounts
              </button>
            </div>
            <div className="mt-1.5">
              {agents ? (
                <Seg<AgentId>
                  ariaLabel="Agent"
                  value={agent ?? "claude"}
                  onChange={setAgent}
                  options={agents.map((a) => ({
                    value: a.id,
                    disabled: !agentReady(a),
                    title: agentReady(a) ? a.name : !a.installed ? `${a.name} isn't installed` : `Sign in to ${a.provider} first`,
                    label: (
                      <>
                        <AgentTile id={a.id} size={16} />
                        {a.provider}
                      </>
                    ),
                  }))}
                />
              ) : (
                <div className="h-9 animate-pulse rounded-xl bg-[var(--glass-strong)]" />
              )}
            </div>

            <div className="mt-2.5 text-[11px] font-medium uppercase tracking-wider text-faint">Run</div>
            <div className="mt-1.5">
              <Seg<RunMode>
                ariaLabel="Run mode"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "terminal", label: <><SquareTerminal size={12} /> Open in Terminal</> },
                  { value: "background", label: <><LoaderCircle size={12} /> Run in background</> },
                ]}
              />
            </div>
            <div className="mt-1.5 text-[11.5px] leading-snug text-faint">
              {mode === "terminal"
                ? "Opens a Terminal window in the repo so you can watch. The agent asks before risky steps; Allow / Deny also appears in Flo's notch."
                : "Runs headless in the repo and streams its output here. It can edit files without asking each time."}
            </div>

            <div className="mt-2.5 flex flex-col gap-1.5">
              <AnimatePresence initial={false}>
                {mode === "background" && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div className="rounded-lg border border-amber-400/20 bg-amber-500/[0.07] px-2.5 py-2">
                      <Check checked={accept} onChange={setAccept} testid="accept-edits">
                        <span className="text-amber-100/90">Let the agent edit files in this repo without asking</span>
                      </Check>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <Check checked={notes} onChange={setNotes} testid="include-notes">
                Include project notes in the prompt
                <span className="text-faint"> · {["name", p.description && "description", p.client && "client", p.clientDetails && "client details"].filter(Boolean).join(", ")}</span>
              </Check>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-[10.5px] text-faint">{modKey()}↩ to send</span>
              <Button
                variant="primary"
                size="sm"
                icon={busy ? <LoaderCircle size={13} className="animate-spin" /> : <SendHorizontal size={13} />}
                disabled={!prompt.trim() || !agent || busy || (mode === "background" && !accept)}
                onClick={go}
                className="h-8 px-3"
              >
                {mode === "terminal" ? "Build it in Terminal" : "Build it"}
              </Button>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

// ── recent runs + live log ────────────────────────────────────────────────
const STATUS_LOOK: Record<CodeRun["status"], [string, string]> = {
  launched: ["In Terminal", "bg-sky-400/15 text-sky-300"],
  running: ["Running", "bg-brand-400/15 text-brand-200"],
  done: ["Done", "bg-emerald-400/15 text-emerald-300"],
  failed: ["Failed", "bg-rose-400/15 text-rose-300"],
  stopped: ["Stopped", "bg-[var(--glass-strong)] text-muted"],
  interrupted: ["Interrupted", "bg-[var(--glass-strong)] text-faint"],
};

function Runs({ p }: { p: Project }) {
  const toast = useStore((x) => x.toast);
  const [runs, setRuns] = useState<CodeRun[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const openIdRef = useRef<string | null>(null);
  openIdRef.current = openId;

  const reload = () => codeApi.runs(p.id).then(setRuns).catch(() => {});
  useEffect(() => {
    reload();
    const onLocal = (e: Event) => {
      const run = (e as CustomEvent<CodeRun>).detail;
      if (run.projectId !== p.id) return;
      reload();
      if (run.mode === "background") {
        setOpenId(run.id);
        setLog([]);
      }
    };
    window.addEventListener("flo:code-run", onLocal);
    const un = codeApi.onRun((ev) => {
      if (ev.projectId !== p.id) return;
      if (ev.line && ev.runId === openIdRef.current) setLog((l) => [...l.slice(-1999), ev.line!]);
      if (ev.status) setRuns((rs) => rs.map((r) => (r.id === ev.runId ? { ...r, status: ev.status! } : r)));
    });
    return () => {
      window.removeEventListener("flo:code-run", onLocal);
      un();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id]);

  useEffect(() => {
    if (!openId) return;
    codeApi.runLog(openId).then((l) => l.length && setLog(l)).catch(() => {});
  }, [openId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const open = runs.find((r) => r.id === openId);
  if (!runs.length) return null;
  return (
    <div className="mt-3.5" data-testid="code-runs">
      <AnimatePresence initial={false}>
        {open && open.mode === "background" && (
          <motion.div key="log" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mb-3 overflow-hidden rounded-xl border border-white/[0.07] bg-[#05090e]" data-testid="run-log">
              <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-1.5">
                <span className={clsx("h-1.5 w-1.5 rounded-full", open.status === "running" ? "animate-pulse bg-brand-300" : open.status === "done" ? "bg-emerald-400" : "bg-zinc-500")} />
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">{open.prompt}</span>
                {open.status === "running" ? (
                  <button
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-rose-300 hover:bg-rose-500/10"
                    onClick={() => codeApi.stopRun(open.id).catch((e) => toast({ kind: "error", text: String(e) }))}
                  >
                    <CircleStop size={12} /> Stop
                  </button>
                ) : (
                  <button className="rounded-md p-0.5 text-faint hover:bg-[var(--glass)]" onClick={() => setOpenId(null)} aria-label="Close log">
                    <X size={12} />
                  </button>
                )}
              </div>
              <div ref={logRef} className="max-h-48 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-[1.6] text-zinc-300">
                {log.length === 0 ? (
                  <span className="text-faint">Waiting for output…</span>
                ) : (
                  log.map((l, i) => (
                    <div key={i} className={clsx("whitespace-pre-wrap break-words", l.startsWith("→") && "text-sky-300/90", l.startsWith("✓") && "text-emerald-300", l.startsWith("✗") && "text-rose-300", l.startsWith("$") && "text-faint")}>
                      {l}
                    </div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">Recent runs</div>
      <div className="flex flex-col gap-1">
        {runs.slice(0, 6).map((r) => {
          const [lbl, cls] = STATUS_LOOK[r.status] ?? STATUS_LOOK.done;
          return (
            <button
              key={r.id}
              data-testid="code-run"
              onClick={() => r.mode === "background" && (setOpenId(r.id === openId ? null : r.id), setLog([]))}
              className={clsx("flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition", r.mode === "background" ? "hover:bg-white/[0.04]" : "cursor-default", r.id === openId && "bg-white/[0.05]")}
            >
              <AgentTile id={r.agent} size={20} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px]">{r.prompt}</div>
                <div className="flex items-center gap-1 text-[10.5px] text-faint">
                  {r.mode === "terminal" ? <SquareTerminal size={10} /> : <LoaderCircle size={10} />}
                  {r.mode === "terminal" ? "Terminal" : "Background"} · {relativeTime(r.createdAt)}
                </div>
              </div>
              <span className={clsx("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", cls)}>{lbl}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
