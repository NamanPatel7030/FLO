// Browser mock for Projects → Code (code::* commands). Hooked into mock.ts's default case.
// Tests steer it through window.__floCodeMock (folder to pick, clone failure, agent states).
import type { AgentStatus, CodeRun, RepoInfo } from "./code";
import { parseGithubUrl } from "./githubUrl";

export const UNHANDLED = Symbol("unhandled");

type ProjectLike = { id: string; name: string; repoUrl?: string; localPath?: string; updatedAt: string };
interface Ctx {
  projects: Map<string, ProjectLike>;
  emit: (event: string, payload: unknown) => void;
}

const DEFAULT_AGENTS: AgentStatus[] = [
  { id: "claude", name: "Claude Code", provider: "Claude", installed: true, path: "/opt/homebrew/bin/claude", version: "2.0.14", signedIn: true, account: "you@example.com", installCommand: "npm install -g @anthropic-ai/claude-code", signInCommand: "claude" },
  { id: "codex", name: "Codex CLI", provider: "ChatGPT", installed: true, path: "/opt/homebrew/bin/codex", version: "0.46.0", signedIn: false, installCommand: "npm install -g @openai/codex", signInCommand: "codex login" },
  { id: "gemini", name: "Gemini CLI", provider: "Gemini", installed: false, signedIn: false, installCommand: "npm install -g @google/gemini-cli", signInCommand: "gemini" },
];

const state = {
  /** what the folder picker returns (null = cancelled) */
  folder: "/Users/you/Code" as string | null,
  /** make the next clone fail with this message */
  cloneError: null as string | null,
  /** ms between clone progress steps */
  cloneStepMs: 120,
  agents: DEFAULT_AGENTS.map((a) => ({ ...a })),
  repos: new Map<string, RepoInfo>(),
  runs: [] as CodeRun[],
  logs: new Map<string, string[]>(),
  timers: new Map<string, number[]>(),
};

const now = () => new Date().toISOString();
let seq = 1;
const rid = () => `run_${(seq++).toString(36)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

function fakeRepo(path: string, remote?: string): RepoInfo {
  return {
    path,
    name: basename(path),
    exists: true,
    isGit: true,
    branch: "main",
    remote,
    lastCommit: { hash: "7f3c2a1", subject: "Initial landing page and pricing section", author: "You", at: new Date(Date.now() - 3 * 3600_000).toISOString() },
    changed: 2,
  };
}

function setLink(ctx: Ctx, projectId: string, repoUrl: string | undefined, localPath: string | undefined) {
  const p = ctx.projects.get(projectId);
  if (!p) throw "That project no longer exists";
  p.repoUrl = repoUrl;
  p.localPath = localPath;
  p.updatedAt = now();
  ctx.emit("flo://projects-changed", {});
}

export async function codeMock(cmd: string, args: Record<string, any>, ctx: Ctx): Promise<unknown> {
  switch (cmd) {
    case "choose_folder":
      return state.folder;
    case "validate_repo_url": {
      const r = parseGithubUrl(args.url ?? "");
      if (!r) throw "Paste a GitHub repository URL, like https://github.com/owner/repo";
      return { ...r, cloneUrl: `https://github.com/${r.owner}/${r.repo}.git`, displayUrl: `https://github.com/${r.owner}/${r.repo}` };
    }
    case "clone_repo": {
      const r = parseGithubUrl(args.url ?? "");
      if (!r) throw "Paste a GitHub repository URL, like https://github.com/owner/repo";
      if (!String(args.parent ?? "").startsWith("/")) throw "Pick a folder (the path must be absolute)";
      const steps: [string, number][] = [["Starting", 0], ["Counting objects", 5], ["Receiving objects", 24], ["Receiving objects", 47], ["Receiving objects", 71], ["Resolving deltas", 92]];
      for (const [phase, percent] of steps) {
        ctx.emit("flo://code-clone", { projectId: args.projectId, phase, percent, message: `${phase}: ${percent}%` });
        await sleep(state.cloneStepMs);
      }
      if (state.cloneError) {
        const err = state.cloneError;
        state.cloneError = null;
        throw err;
      }
      ctx.emit("flo://code-clone", { projectId: args.projectId, phase: "Done", percent: 100, message: "Cloned" });
      const path = `${String(args.parent).replace(/\/+$/, "")}/${r.repo}`;
      const info = fakeRepo(path, `https://github.com/${r.owner}/${r.repo}.git`);
      state.repos.set(path, info);
      setLink(ctx, args.projectId, `https://github.com/${r.owner}/${r.repo}`, path);
      return info;
    }
    case "link_folder": {
      const info = fakeRepo(args.path);
      state.repos.set(args.path, info);
      setLink(ctx, args.projectId, info.remote, args.path);
      return info;
    }
    case "repo_info": {
      const p = ctx.projects.get(args.projectId);
      if (!p?.localPath) return null;
      return state.repos.get(p.localPath) ?? fakeRepo(p.localPath, p.repoUrl);
    }
    case "unlink_code":
      setLink(ctx, args.projectId, undefined, undefined);
      return null;
    case "open_code":
      return null;
    case "coding_agents":
      return state.agents.map((a) => ({ ...a }));
    case "agent_sign_in":
      return null;
    case "edit_with_ai": {
      const req = args.req ?? {};
      if (!String(req.prompt ?? "").trim()) throw "Say what to build first";
      if (req.mode === "background" && !req.acceptEdits) throw "Tick the confirmation first.";
      const a = state.agents.find((x) => x.id === req.agent);
      if (!a?.installed) throw `${a?.name ?? req.agent} isn't installed.`;
      const run: CodeRun = {
        id: rid(),
        projectId: req.projectId,
        prompt: String(req.prompt).trim(),
        agent: req.agent,
        mode: req.mode,
        status: req.mode === "background" ? "running" : "launched",
        createdAt: now(),
      };
      state.runs.unshift(run);
      if (req.mode === "background") {
        const lines = [`$ ${a.name} (${ctx.projects.get(req.projectId)?.localPath ?? ""})`, "Claude Code started", "Reading the project structure.", "→ Read src/App.tsx", "→ Edit src/App.tsx", "Added the feature and updated the styles."];
        state.logs.set(run.id, []);
        const ts: number[] = [];
        lines.forEach((line, i) => {
          ts.push(
            window.setTimeout(() => {
              state.logs.get(run.id)?.push(line);
              ctx.emit("flo://code-run", { runId: run.id, projectId: run.projectId, line });
            }, 150 * (i + 1)),
          );
        });
        ts.push(
          window.setTimeout(() => {
            if (run.status !== "running") return;
            run.status = "done";
            run.finishedAt = now();
            state.logs.get(run.id)?.push("Finished.");
            ctx.emit("flo://code-run", { runId: run.id, projectId: run.projectId, line: "Finished." });
            ctx.emit("flo://code-run", { runId: run.id, projectId: run.projectId, status: "done" });
          }, 150 * (lines.length + 1) + ((window as any).__floCodeMock?.runHoldMs ?? 0)),
        );
        state.timers.set(run.id, ts);
      }
      return { ...run };
    }
    case "list_code_runs":
      return state.runs.filter((r) => r.projectId === args.projectId).map((r) => ({ ...r }));
    case "code_run_log":
      return [...(state.logs.get(args.runId) ?? [])];
    case "stop_code_run": {
      const run = state.runs.find((r) => r.id === args.runId);
      if (!run || run.status !== "running") throw "That run isn't running";
      state.timers.get(run.id)?.forEach((t) => clearTimeout(t));
      run.status = "stopped";
      run.finishedAt = now();
      state.logs.get(run.id)?.push("Stopped.");
      ctx.emit("flo://code-run", { runId: run.id, projectId: run.projectId, line: "Stopped." });
      ctx.emit("flo://code-run", { runId: run.id, projectId: run.projectId, status: "stopped" });
      return null;
    }
    default:
      return UNHANDLED;
  }
}

if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) {
  (window as any).__floCodeMock = Object.assign(state, {
    setAgents: (list: AgentStatus[]) => {
      state.agents = list.map((a) => ({ ...a }));
    },
    resetAgents: () => {
      state.agents = DEFAULT_AGENTS.map((a) => ({ ...a }));
    },
  });
}
