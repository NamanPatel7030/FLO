// Flo Agent: one command box for everything Flo can do, with an optional Hermes engine.
// Typed wrappers over floagent::* and hermes::* (src-tauri/src/floagent.rs, hermes.rs).
import { invokeRaw as call } from "./api";

export type AgentRoute = "skill" | "screen" | "tools" | "answer" | "hermes";
export type RunStatus = "running" | "waiting" | "done" | "failed" | "stopped";
export type StepKind = "route" | "step" | "tool" | "confirm" | "output" | "done" | "error" | "stopped";

export interface RunStep {
  at: string;
  kind: StepKind;
  text: string;
}

export interface AgentRun {
  id: string;
  goal: string;
  route: AgentRoute;
  engine: "flo" | "hermes";
  source: "typed" | "voice";
  status: RunStatus;
  skill?: string | null;
  steps: RunStep[];
  result?: string | null;
  startedAt: string;
  finishedAt?: string | null;
}

export interface AgentConfig {
  engine: "flo" | "hermes";
  persona: string;
  instructions: string;
  memory: boolean;
  allowScreen: boolean;
  allowTools: boolean;
  allowSkills: boolean;
  confirmEveryStep: boolean;
  hermesUseFloKey: boolean;
  slackEnabled: boolean;
  slackAllowedUsers: string;
}

export interface RoutePlan {
  route: AgentRoute;
  target?: string | null;
  reason: string;
}

export interface ExportSummary {
  dir: string;
  mcpServers: number;
  skills: number;
  model?: string | null;
  at: string;
}

export interface HermesStatus {
  installed: boolean;
  path?: string | null;
  version?: string | null;
  outdated: boolean;
  testedVersion: string;
  running: boolean;
  healthy: boolean;
  port: number;
  startedAt?: string | null;
  home: string;
  export?: ExportSummary | null;
  slackRunning: boolean;
  slackBotToken: boolean;
  slackAppToken: boolean;
  installCommand: string;
  docsUrl: string;
}

export const AGENT_EV = {
  /** payload: AgentRun (whole run, on every change) */
  run: "flo://flo-agent",
  /** payload: HermesStatus */
  hermes: "flo://hermes",
  /** payload: string (one gateway log line) */
  hermesLog: "flo://hermes-log",
} as const;

export const HERMES_SLACK_DOCS = "https://hermes-agent.nousresearch.com/docs/user-guide/messaging/slack";

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  engine: "flo",
  persona: "",
  instructions: "",
  memory: true,
  allowScreen: true,
  allowTools: true,
  allowSkills: true,
  confirmEveryStep: false,
  hermesUseFloKey: true,
  slackEnabled: false,
  slackAllowedUsers: "",
};

export const agentApi = {
  config: () => call<AgentConfig>("flo_agent_config"),
  saveConfig: (config: AgentConfig) => call<AgentConfig>("flo_agent_save_config", { config }),
  runs: () => call<AgentRun[]>("flo_agent_runs").catch(() => [] as AgentRun[]),
  plan: (goal: string) => call<RoutePlan>("flo_agent_plan", { goal }),
  run: (goal: string, source: "typed" | "voice" = "typed") => call<AgentRun>("flo_agent_run", { goal, source }),
  stop: (id: string) => call<void>("flo_agent_stop", { id }),
  clearRuns: () => call<void>("flo_agent_clear_runs"),
  hermesStatus: () => call<HermesStatus>("hermes_status"),
  hermesExport: () => call<ExportSummary>("hermes_export"),
  hermesStart: () => call<HermesStatus>("hermes_start"),
  hermesStop: () => call<HermesStatus>("hermes_stop"),
  hermesLog: () => call<string[]>("hermes_log").catch(() => [] as string[]),
};

export const isFinished = (r: AgentRun) => r.status === "done" || r.status === "failed" || r.status === "stopped";

/** Insert or replace a run snapshot, newest first. */
export function upsertRun(list: AgentRun[], run: AgentRun): AgentRun[] {
  const i = list.findIndex((r) => r.id === run.id);
  if (i < 0) return [run, ...list];
  const next = list.slice();
  next[i] = run;
  return next;
}

/** "3 s" / "1 min 12 s" between two ISO times (or until now). */
export function runDuration(startIso: string, endIso?: string | null, now = Date.now()): string {
  const ms = Math.max(0, (endIso ? Date.parse(endIso) : now) - Date.parse(startIso));
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}
