// Flo Agent: one command box for everything Flo can do, with an optional Hermes engine.
// Typed wrappers over floagent::* and hermes::* (src-tauri/src/floagent.rs, hermes.rs).
import { os } from "./os";
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
  /** older builds' "connect Slack when Hermes starts"; Slack now joins whenever it's set up */
  slackEnabled: boolean;
  slackAllowedUsers: string;
  /** Play / Pause (read only here: hermesStart / hermesStop change it) */
  hermesPlaying?: boolean;
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
  /** a hermes file exists but doesn't run (install didn't finish) */
  broken?: string | null;
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
  /** the user pressed Play (saved across launches) */
  playing: boolean;
  phase: HermesPhase;
  /** why it isn't running (start failed or kept crashing) */
  error?: string | null;
  restarts: number;
  appleSilicon: boolean;
  installing: boolean;
  /** a Slack error from Hermes' output (bad token, missing scope) */
  slackError?: string | null;
  /** Slack's new-app dialog with Flo's manifest filled in */
  slackAppUrl: string;
}

export type HermesPhase = "installing" | "not_installed" | "paused" | "starting" | "live" | "error";

export interface InstallState {
  phase: "idle" | "running" | "done" | "failed" | "cancelled";
  lines: string[];
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  version?: string | null;
}

export interface SlackBotCheck {
  ok: boolean;
  bot?: string | null;
  team?: string | null;
  botUserId?: string | null;
  error?: string | null;
  /** the Member ID Flo put into an empty allow-list (from Flo's own Slack connection) */
  autofilled?: string | null;
}

export const AGENT_EV = {
  /** payload: AgentRun (whole run, on every change) */
  run: "flo://flo-agent",
  /** payload: HermesStatus */
  hermes: "flo://hermes",
  /** payload: string (one gateway log line) */
  hermesLog: "flo://hermes-log",
  /** payload: InstallState */
  install: "flo://hermes-install",
  /** payload: string (one installer output line) */
  installLog: "flo://hermes-install-log",
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
  hermesInstall: () => call<InstallState>("hermes_install"),
  hermesInstallCancel: () => call<void>("hermes_install_cancel"),
  hermesInstallState: () => call<InstallState>("hermes_install_state"),
  hermesSlackCheck: () => call<SlackBotCheck>("hermes_slack_check"),
};

// ── Slack: readiness, and why "@Flo" got no answer ─────────────────────────
export interface SlackCheckItem {
  id: "installed" | "bot" | "app" | "people" | "live";
  label: string;
  ok: boolean;
}

export interface SlackReadiness {
  checks: SlackCheckItem[];
  /** the first thing stopping Flo from answering in Slack, in one sentence (null = answering) */
  blocker: string | null;
  /** everything set up on the Slack side (tokens valid + people) */
  botReady: boolean;
}

/** What has to be true for "@Flo" to answer in Slack, and the first thing that isn't. */
export function slackReadiness(st: HermesStatus | null, cfg: AgentConfig | null, bot: SlackBotCheck | null, installing = false): SlackReadiness {
  const ids = (cfg?.slackAllowedUsers ?? "").split(",").filter(Boolean);
  const installed = !!st?.installed;
  const botOk = !!st?.slackBotToken && (bot ? bot.ok : true);
  const appOk = !!st?.slackAppToken;
  const people = ids.length > 0;
  const live = !!st?.running && !!st?.healthy && !!st?.slackRunning && !st?.slackError;
  const checks: SlackCheckItem[] = [
    { id: "installed", label: "Hermes installed", ok: installed },
    { id: "bot", label: "Bot token (xoxb-)", ok: botOk },
    { id: "app", label: "App token (xapp-)", ok: appOk },
    { id: "people", label: "Who can talk to Flo", ok: people },
    { id: "live", label: "Live in Slack", ok: live },
  ];
  let blocker: string | null = null;
  if (installing || st?.installing) blocker = "Hermes is installing. Flo answers in Slack as soon as it's done.";
  else if (!st) blocker = null;
  else if (st.broken) blocker = "Hermes isn't fully installed, so nothing answers in Slack. Install it again.";
  else if (!installed) blocker = st.appleSilicon === false ? (os() === "windows" ? "Hermes only runs inside WSL2 on Windows, so Flo can't answer in Slack here." : "Hermes needs an Apple Silicon computer, so Flo can't answer in Slack here.") : "Hermes isn't installed, so nothing is listening for @Flo in Slack.";
  else if (!st.slackBotToken) blocker = "The bot token is missing, so Hermes can't join Slack.";
  else if (bot && !bot.ok) blocker = bot.error ?? "Slack rejected the bot token.";
  else if (!appOk) blocker = "The app token is missing, so Hermes can't connect to Slack.";
  else if (!people) blocker = "Nobody is on the allow-list, so Hermes ignores every message.";
  else if (!st.playing) blocker = "Hermes is paused, so Flo doesn't answer in Slack.";
  else if (st.phase === "error") blocker = st.error ?? "Hermes stopped.";
  else if (st.slackError) blocker = st.slackError;
  else if (!st.running || !st.healthy) blocker = "Hermes is starting.";
  else if (!st.slackRunning) blocker = "Hermes is running without Slack. Pause and Play to connect it.";
  return { checks, blocker, botReady: botOk && appOk && people };
}

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
