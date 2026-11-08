// Projects → Code: link a repo / folder to a project and hand work to the user's own coding agent.
// Typed wrappers over the code::* Tauri commands (src-tauri/src/code.rs).
import { invokeRaw as call, on } from "./api";

export type AgentId = "claude" | "codex" | "gemini";
export type RunMode = "terminal" | "background";
export type RunStatus = "launched" | "running" | "done" | "failed" | "stopped" | "interrupted";

export interface Commit {
  hash: string;
  subject: string;
  author: string;
  /** ISO time */
  at: string;
}

export interface RepoInfo {
  path: string;
  name: string;
  exists: boolean;
  isGit: boolean;
  branch?: string;
  remote?: string;
  lastCommit?: Commit;
  /** files with uncommitted changes */
  changed: number;
}

export interface RepoRef {
  owner: string;
  repo: string;
  cloneUrl: string;
  displayUrl: string;
}

export interface CodeRun {
  id: string;
  projectId: string;
  prompt: string;
  agent: AgentId;
  mode: RunMode;
  status: RunStatus;
  createdAt: string;
  finishedAt?: string;
  exitCode?: number;
}

export interface AgentStatus {
  id: AgentId;
  name: string;
  /** Claude | ChatGPT | Gemini */
  provider: string;
  installed: boolean;
  path?: string;
  version?: string;
  /** undefined = can't tell */
  signedIn?: boolean;
  /** non-secret account label (email) */
  account?: string;
  installCommand: string;
  signInCommand: string;
}

export interface CloneProgress {
  projectId: string;
  phase: string;
  /** overall 0–100 */
  percent: number;
  message: string;
}

export interface RunEvent {
  runId: string;
  projectId: string;
  line?: string;
  status?: RunStatus;
}

export const CODE_EV = { clone: "flo://code-clone", run: "flo://code-run" } as const;

/** installed and not known to be signed out */
export const agentReady = (a: AgentStatus) => a.installed && a.signedIn !== false;

export { parseGithubUrl } from "./githubUrl";

export const codeApi = {
  /** native folder picker; null when cancelled */
  chooseFolder: (prompt?: string) => call<string | null>("choose_folder", { prompt }),
  validateRepoUrl: (url: string) => call<RepoRef>("validate_repo_url", { url }),
  /** progress arrives on CODE_EV.clone */
  cloneRepo: (projectId: string, url: string, parent: string) => call<RepoInfo>("clone_repo", { projectId, url, parent }),
  linkFolder: (projectId: string, path: string) => call<RepoInfo>("link_folder", { projectId, path }),
  repoInfo: (projectId: string) => call<RepoInfo | null>("repo_info", { projectId }),
  unlink: (projectId: string) => call<void>("unlink_code", { projectId }),
  open: (projectId: string, target: "finder" | "vscode" | "terminal") => call<void>("open_code", { projectId, target }),
  agents: () => call<AgentStatus[]>("coding_agents"),
  signIn: (agent: AgentId) => call<void>("agent_sign_in", { agent }),
  editWithAi: (req: { projectId: string; prompt: string; agent: AgentId; mode: RunMode; includeNotes: boolean; acceptEdits: boolean }) =>
    call<CodeRun>("edit_with_ai", { req }),
  runs: (projectId: string) => call<CodeRun[]>("list_code_runs", { projectId }),
  runLog: (runId: string) => call<string[]>("code_run_log", { runId }),
  stopRun: (runId: string) => call<void>("stop_code_run", { runId }),
  onClone: (cb: (p: CloneProgress) => void) => on<CloneProgress>(CODE_EV.clone, cb),
  onRun: (cb: (p: RunEvent) => void) => on<RunEvent>(CODE_EV.run, cb),
};
