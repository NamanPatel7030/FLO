// Browser mock for Flo Agent + Hermes (floagent::* and hermes::* commands). Hooked into mock.ts's
// default case. Screen runs are driven through EV.agent events, exactly like the backend, so the
// existing agent_confirm mock (Yes / No) carries a waiting run on.
// Tests steer it through window.__floAgentMock (Hermes installed / running, step speed).
import { planRoute } from "./agentRoute";
import { AGENT_EV, DEFAULT_AGENT_CONFIG, type AgentConfig, type AgentRun, type HermesPhase, type HermesStatus, type InstallState, type SlackBotCheck, type StepKind } from "./floAgent";
import type { Connection, Skill } from "./types";

export const UNHANDLED = Symbol("unhandled");

interface Ctx {
  emit: (event: string, payload: unknown) => void;
  listen: (event: string, cb: (p: any) => void) => () => void;
  skills: () => Skill[];
  connections: () => Connection[];
  secrets: () => Set<string>;
  /** Flo's own Slack (user token) connection, for the allow-list autofill */
  slackConnected?: () => boolean;
}

const iso = (minsAgo = 0) => new Date(Date.now() - minsAgo * 60_000).toISOString();
let seq = 1;
const rid = () => `run_${(seq++).toString(36)}`;

function seedRuns(): AgentRun[] {
  const step = (kind: StepKind, text: string, m: number) => ({ kind, text, at: iso(m) });
  return [
    {
      id: rid(),
      goal: "Go to YouTube and play lofi beats",
      route: "screen",
      engine: "flo",
      source: "voice",
      status: "done",
      steps: [step("route", "Works on your screen", 42), step("step", "Looking at your screen", 42), step("step", "Opening youtube.com", 42), step("step", "Clicking the first video", 41), step("done", "Playing “lofi hip hop radio”.", 41)],
      result: "Playing “lofi hip hop radio”.",
      startedAt: iso(42),
      finishedAt: iso(41),
    },
    {
      id: rid(),
      goal: "Write a proposal for this job",
      route: "skill",
      engine: "flo",
      source: "typed",
      status: "done",
      skill: "Upwork proposal",
      steps: [step("route", "Uses your Upwork proposal skill", 180), step("step", "Typed into Google Chrome", 179), step("done", "Done with your Upwork proposal skill.", 179)],
      result: "Done with your Upwork proposal skill.",
      startedAt: iso(180),
      finishedAt: iso(179),
    },
    {
      id: rid(),
      goal: "Open LinkedIn and message Priya about Thursday",
      route: "screen",
      engine: "flo",
      source: "typed",
      status: "stopped",
      steps: [step("route", "Works on your screen", 1500), step("step", "Opening linkedin.com", 1500), step("confirm", "About to send the message to Priya. Send it?", 1499), step("stopped", "Cancelled, you said no.", 1499)],
      result: "Cancelled, you said no.",
      startedAt: iso(1500),
      finishedAt: iso(1499),
    },
  ];
}

const DEFAULT_HERMES: HermesStatus = {
  installed: false,
  path: null,
  version: null,
  outdated: false,
  testedVersion: "0.22.5",
  running: false,
  healthy: false,
  port: 8642,
  startedAt: null,
  home: "/Users/you/Library/Application Support/com.flo.flow/hermes",
  export: null,
  slackRunning: false,
  slackBotToken: false,
  slackAppToken: false,
  installCommand: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
  docsUrl: "https://hermes-agent.nousresearch.com/docs",
  playing: false,
  phase: "not_installed",
  error: null,
  restarts: 0,
  appleSilicon: true,
  installing: false,
  slackError: null,
  slackAppUrl: "https://api.slack.com/apps?new_app=1&manifest_yaml=" + encodeURIComponent('display_information:\n  name: "Flo"\nsettings:\n  socket_mode_enabled: true\n'),
};

const INSTALL_LINES = ["→ Checking prerequisites", "✓ git found", "→ Cloning hermes-agent", "→ Setting up Python 3.12 with uv", "✓ venv ready", "→ Installing Python dependencies", "✓ hermes linked into ~/.local/bin", "✓ Hermes Agent installed"];

const state = {
  config: { ...DEFAULT_AGENT_CONFIG } as AgentConfig,
  runs: seedRuns(),
  active: null as string | null,
  timers: [] as number[],
  /** ms between simulated steps */
  stepMs: 650,
  hermes: { ...DEFAULT_HERMES } as HermesStatus,
  log: [] as string[],
  wired: false,
  install: { phase: "idle", lines: [] } as InstallState,
  /** tests: make the next install fail with this installer line */
  installFails: null as string | null,
  /** ms between simulated installer lines */
  installMs: 120,
  /** tests: Slack says the bot token is invalid */
  badBotToken: false,
};

function emitRun(ctx: Ctx, r: AgentRun) {
  ctx.emit(AGENT_EV.run, structuredClone(r));
}
function push(r: AgentRun, kind: StepKind, text: string) {
  r.steps.push({ at: iso(), kind, text });
}
function finish(ctx: Ctx, r: AgentRun, status: AgentRun["status"], text: string) {
  if (r.status === "done" || r.status === "failed" || r.status === "stopped") return;
  r.status = status;
  push(r, status === "done" ? "done" : status === "stopped" ? "stopped" : "error", text);
  r.result = text;
  r.finishedAt = iso();
  if (state.active === r.id) state.active = null;
  emitRun(ctx, r);
}
const activeRun = () => state.runs.find((r) => r.id === state.active && r.status !== "done" && r.status !== "failed" && r.status !== "stopped");

/** screen agent events → timeline (mirror of floagent::on_agent_event) */
function wire(ctx: Ctx) {
  if (state.wired) return;
  state.wired = true;
  ctx.listen("flo://agent", (e: { kind: string; text: string }) => {
    const r = activeRun();
    if (!r) {
      if (e.kind === "start") {
        const run: AgentRun = { id: rid(), goal: e.text, route: "screen", engine: "flo", source: "voice", status: "running", steps: [], startedAt: iso() };
        push(run, "route", "Works on your screen");
        state.runs.unshift(run);
        state.active = run.id;
        emitRun(ctx, run);
      }
      return;
    }
    if (e.kind === "start") push(r, "step", "Looking at your screen");
    else if (e.kind === "step" || e.kind === "confirm") {
      push(r, e.kind, e.text);
      r.status = e.kind === "confirm" ? "waiting" : "running";
    } else if (e.kind === "done") return finish(ctx, r, "done", e.text);
    else if (e.kind === "aborted") return finish(ctx, r, "stopped", e.text);
    else if (e.kind === "error") return finish(ctx, r, "failed", e.text);
    else return;
    emitRun(ctx, r);
  });
}

function later(fn: () => void, i: number) {
  state.timers.push(window.setTimeout(fn, state.stepMs * i));
}

function screenScript(goal: string): { steps: string[]; confirm?: string; done: string } {
  const g = goal.toLowerCase();
  if (g.includes("linkedin")) {
    const post = /post|share|write/.test(g);
    return {
      steps: ["Opening linkedin.com", post ? "Clicking Start a post" : "Clicking Messaging", post ? "Typing “Shipped Flo Agent today: one box for everything on my Mac.”" : "Typing the message"],
      confirm: post ? "About to post on LinkedIn. Post it?" : "About to send the message. Send it?",
      done: "Posted.",
    };
  }
  if (g.includes("youtube")) return { steps: ["Opening youtube.com", "Typing “lofi beats”", "Pressing return", "Clicking the first video"], done: "Playing “lofi hip hop radio”." };
  return { steps: ["Opening the page", "Clicking the first result"], done: "Done." };
}

function startRun(ctx: Ctx, goal: string, source: string): AgentRun {
  wire(ctx);
  if (activeRun()) throw "Flo Agent is already working on something. Stop it first.";
  const skills = ctx.skills().filter((k) => k.enabled);
  const servers = ctx.connections().filter((c) => c.kind === "mcp" && c.enabled).map((c) => c.name);
  const plan = planRoute(goal, skills, servers, state.config);
  const run: AgentRun = {
    id: rid(),
    goal,
    route: plan.route,
    engine: state.config.engine,
    source: source === "voice" ? "voice" : "typed",
    status: "running",
    skill: plan.route === "skill" ? plan.target : null,
    steps: [],
    startedAt: iso(),
  };
  push(run, "route", plan.reason);
  state.runs.unshift(run);
  state.active = run.id;
  const step = (kind: StepKind, text: string) => {
    push(run, kind, text);
    emitRun(ctx, run);
  };
  switch (plan.route) {
    case "screen": {
      const s = screenScript(goal);
      later(() => ctx.emit("flo://agent", { kind: "start", text: goal }), 1);
      s.steps.forEach((t, i) => later(() => ctx.emit("flo://agent", { kind: "step", text: t }), i + 2));
      const n = s.steps.length + 2;
      later(() => ctx.emit("flo://agent", s.confirm ? { kind: "confirm", text: s.confirm, voice: false } : { kind: "done", text: s.done }), n);
      break;
    }
    case "skill":
      later(() => step("step", "Reading the job post on screen"), 1);
      later(() => step("step", "Typed into Google Chrome"), 2);
      later(() => finish(ctx, run, "done", `Done with your ${plan.target} skill.`), 3);
      break;
    case "tools":
      later(() => step("step", `Connecting to ${plan.target}`), 1);
      later(() => step("tool", `Used ${String(plan.target).toLowerCase()}__search_pages`), 2);
      later(() => finish(ctx, run, "done", "Found 3 pages from Monday: Design sync, Hiring loop and Q4 roadmap."), 3);
      break;
    case "hermes":
      if (!state.hermes.installed) {
        later(() => finish(ctx, run, "failed", "Hermes isn't installed. Open Flo Agent → Engine to set it up, or switch the engine back to Flo."), 1);
        break;
      }
      if (!state.hermes.running) later(() => step("output", "Starting Hermes for this request"), 1);
      ["Looking through your week…", "You shipped Flo Agent, closed 12 to-dos and had 4 meetings.", "Next up: the Apollo deck is due Friday."].forEach((t, i) => later(() => step("output", t), i + 2));
      later(() => finish(ctx, run, "done", "You shipped Flo Agent, closed 12 to-dos and had 4 meetings. Next up: the Apollo deck is due Friday."), 5);
      break;
    default:
      later(() => finish(ctx, run, "done", "Done. Added a to-do and set a reminder for Friday."), 1);
  }
  return structuredClone(run);
}

function exportNow(ctx: Ctx) {
  const sum = {
    dir: state.hermes.home,
    mcpServers: ctx.connections().filter((c) => c.kind === "mcp" && c.enabled).length,
    skills: ctx.skills().filter((k) => k.enabled).length,
    model: "anthropic · claude-haiku-5-5",
    at: iso(),
  };
  state.hermes.export = sum;
  return sum;
}

function phaseOf(h: HermesStatus): HermesPhase {
  if (h.installing) return "installing";
  if (!h.installed) return "not_installed";
  if (!h.playing) return "paused";
  if (h.running && h.healthy) return "live";
  return h.error ? "error" : "starting";
}

function hermesStatus(ctx: Ctx): HermesStatus {
  const sec = ctx.secrets();
  const h = { ...state.hermes, playing: state.config.hermesPlaying ?? false, installing: state.install.phase === "running" };
  return { ...h, phase: phaseOf(h), slackBotToken: sec.has("hermes_slack_bot"), slackAppToken: sec.has("hermes_slack_app") };
}

function startGateway(ctx: Ctx): HermesStatus {
  exportNow(ctx);
  const sec = ctx.secrets();
  // like hermes::start: Slack joins whenever both tokens and a Member ID are set
  const slack = sec.has("hermes_slack_bot") && sec.has("hermes_slack_app") && !!state.config.slackAllowedUsers;
  state.config.hermesPlaying = true;
  state.hermes = { ...state.hermes, running: true, healthy: true, startedAt: iso(), slackRunning: slack, error: null };
  state.log = [];
  logLine(ctx, `$ hermes gateway  (home: ${state.hermes.home})`);
  logLine(ctx, "API server listening on http://127.0.0.1:8642");
  logLine(ctx, `Loaded MCP servers: ${state.hermes.export?.mcpServers ?? 0} · skills: ${state.hermes.export?.skills ?? 0}`);
  if (slack) logLine(ctx, "Slack: connected (Socket Mode)");
  const s = hermesStatus(ctx);
  ctx.emit(AGENT_EV.hermes, s);
  return s;
}

function setInstall(ctx: Ctx, patch: Partial<InstallState>) {
  state.install = { ...state.install, ...patch };
  ctx.emit(AGENT_EV.install, structuredClone(state.install));
}

/** like hermes::install: stream the installer, then detect Hermes and press Play */
function runInstall(ctx: Ctx): InstallState {
  if (state.install.phase === "running") return structuredClone(state.install);
  if (!state.hermes.appleSilicon) {
    setInstall(ctx, { phase: "failed", lines: [], error: "Hermes runs on Apple Silicon computers only (M1 or newer). This computer has an Intel chip, so Hermes can't be installed here. Flo's built-in engine still works.", finishedAt: iso() });
    return structuredClone(state.install);
  }
  setInstall(ctx, { phase: "running", lines: [], error: null, startedAt: iso(), finishedAt: null });
  ctx.emit(AGENT_EV.hermes, hermesStatus(ctx));
  const fail = state.installFails;
  const lines = fail ? [...INSTALL_LINES.slice(0, 2), `✗ ${fail}`] : INSTALL_LINES;
  lines.forEach((l, i) =>
    state.timers.push(
      window.setTimeout(() => {
        if (state.install.phase !== "running") return;
        state.install.lines.push(l);
        ctx.emit(AGENT_EV.installLog, l);
      }, state.installMs * (i + 1)),
    ),
  );
  state.timers.push(
    window.setTimeout(() => {
      if (state.install.phase !== "running") return;
      if (fail) {
        setInstall(ctx, { phase: "failed", error: `The Hermes installer stopped: ${fail}`, finishedAt: iso() });
        ctx.emit(AGENT_EV.hermes, hermesStatus(ctx));
        return;
      }
      state.hermes = { ...state.hermes, installed: true, broken: null, version: "0.22.5", path: "/Users/you/.local/bin/hermes" };
      setInstall(ctx, { phase: "done", version: "0.22.5", finishedAt: iso() });
      startGateway(ctx);
    }, state.installMs * (lines.length + 1)),
  );
  return structuredClone(state.install);
}

function slackCheck(ctx: Ctx): SlackBotCheck {
  const sec = ctx.secrets();
  if (!sec.has("hermes_slack_bot")) return { ok: false, error: "Paste the bot token (xoxb-) first." };
  if (state.badBotToken) return { ok: false, error: "Slack says this bot token isn't valid. Copy the Bot User OAuth Token (xoxb-) again from OAuth & Permissions." };
  const r: SlackBotCheck = { ok: true, bot: "flo", team: "Northwind", botUserId: "U0FLOBOT" };
  if (!state.config.slackAllowedUsers && ctx.slackConnected?.()) {
    state.config = { ...state.config, slackAllowedUsers: "U0AR547TTRS" };
    r.autofilled = "U0AR547TTRS";
  }
  return r;
}

function logLine(ctx: Ctx, line: string) {
  state.log.push(line);
  ctx.emit(AGENT_EV.hermesLog, line);
}

export async function floAgentMock(cmd: string, args: Record<string, any>, ctx: Ctx): Promise<unknown> {
  switch (cmd) {
    case "flo_agent_config":
      return { ...state.config };
    case "flo_agent_save_config": {
      const c = { ...DEFAULT_AGENT_CONFIG, ...args.config } as AgentConfig;
      if (c.engine !== "flo" && c.engine !== "hermes") c.engine = "flo";
      c.persona = c.persona.trim();
      c.instructions = c.instructions.trim();
      // like hermes::clean_member_ids
      c.slackAllowedUsers = c.slackAllowedUsers
        .split(/[\s,]+/)
        .map((x) => x.trim().toUpperCase())
        .filter((x) => /^[UW][A-Z0-9]{2,23}$/.test(x))
        .join(",");
      c.hermesPlaying = state.config.hermesPlaying ?? false; // only Play / Pause change it
      state.config = c;
      return { ...c };
    }
    case "flo_agent_runs":
      wire(ctx);
      return structuredClone(state.runs);
    case "flo_agent_plan": {
      const skills = ctx.skills().filter((k) => k.enabled);
      const servers = ctx.connections().filter((c) => c.kind === "mcp" && c.enabled).map((c) => c.name);
      return planRoute(String(args.goal ?? ""), skills, servers, state.config);
    }
    case "flo_agent_run": {
      const goal = String(args.goal ?? "").trim();
      if (!goal) throw "Say what Flo Agent should do.";
      return startRun(ctx, goal, args.source ?? "typed");
    }
    case "flo_agent_stop": {
      state.timers.forEach((t) => clearTimeout(t));
      state.timers = [];
      const r = state.runs.find((x) => x.id === args.id);
      if (r) finish(ctx, r, "stopped", "Stopped.");
      return null;
    }
    case "flo_agent_clear_runs":
      state.runs = state.runs.filter((r) => r.id === state.active);
      return null;
    case "hermes_status":
      return hermesStatus(ctx);
    case "hermes_export":
      if (!state.hermes.installed) throw "Hermes isn't installed.";
      return exportNow(ctx);
    case "hermes_start": {
      state.config.hermesPlaying = true;
      if (!state.hermes.installed) throw "Hermes isn't installed. Click Install Hermes in Flo Agent, Slack.";
      return startGateway(ctx);
    }
    case "hermes_install":
      return runInstall(ctx);
    case "hermes_install_cancel":
      if (state.install.phase === "running") {
        setInstall(ctx, { phase: "cancelled", error: "Install cancelled. Nothing else was changed; click Install Hermes to try again.", finishedAt: iso() });
        ctx.emit(AGENT_EV.hermes, hermesStatus(ctx));
      }
      return null;
    case "hermes_install_state":
      return structuredClone(state.install);
    case "hermes_slack_check":
      return slackCheck(ctx);
    case "hermes_stop": {
      state.config.hermesPlaying = false;
      state.hermes = { ...state.hermes, running: false, healthy: false, startedAt: null, slackRunning: false };
      logLine(ctx, "Stopped.");
      const s = hermesStatus(ctx);
      ctx.emit(AGENT_EV.hermes, s);
      return s;
    }
    case "hermes_log":
      return [...state.log];
    default:
      return UNHANDLED;
  }
}

if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) {
  (window as any).__floAgentMock = Object.assign(state, {
    /** e.g. setHermes({ installed: true, version: "0.22.5", path: "/Users/you/.local/bin/hermes" }) */
    setHermes: (patch: Partial<HermesStatus>) => {
      state.hermes = { ...state.hermes, ...patch };
    },
    resetHermes: () => {
      state.hermes = { ...DEFAULT_HERMES };
      state.install = { phase: "idle", lines: [] };
      state.config.hermesPlaying = false;
    },
  });
}
