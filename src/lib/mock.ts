// In-browser mock backend so the full UI runs with `npm run dev` outside Tauri.
import { DEFAULT_AVATAR } from "./notchling";
import type {
  ConfirmEvent,
  Integration,
  ContextDoc,
  Analytics,
  AssistantResponse,
  AttentionStatus,
  ClaudeEvent,
  ClaudeHookStatus,
  ClaudeSession,
  CorrectionEvent,
  MeetingDetectedEvent,
  DailyStat,
  Dictation,
  DictionaryEntry,
  IslandGeometry,
  LocalModel,
  Mode,
  NetworkLogEntry,
  Note,
  Project,
  Settings,
  Todo,
  TodoStatus, Skill, Connection } from "./types";
import { EV, type ThemeMode } from "./types";
import { countWords } from "./format";
import { codeMock, UNHANDLED } from "./mockCode";
import { mediaControl, mediaSample, mediaSet } from "./mockMedia";
import { presenceMock } from "./mockPresence";
import { autoContinueMock } from "./mockAutoContinue";
import { floAgentMock, UNHANDLED as AGENT_UNHANDLED } from "./mockFloAgent";

// ── event bus ───────────────────────────────────────────────────────────────
type Cb = (payload: any) => void;
const bus = new Map<string, Set<Cb>>();
export function mockListen<T>(event: string, cb: (p: T) => void): () => void {
  if (!bus.has(event)) bus.set(event, new Set());
  bus.get(event)!.add(cb as Cb);
  return () => bus.get(event)?.delete(cb as Cb);
}
export function mockEmit(event: string, payload: unknown) {
  bus.get(event)?.forEach((cb) => cb(payload));
}

// ── helpers ─────────────────────────────────────────────────────────────────
let seq = 1000;
const uid = (p: string) => `${p}_${(seq++).toString(36)}`;
const iso = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
const dayStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return dayStr(d);
};
function rand(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

// ── data ────────────────────────────────────────────────────────────────────
const settings: Settings = {
  hotkeyDictation: "ctrl",
  hotkeyAssistant: "fn",
  meetingDetection: true,
  learnCorrections: true,
  systemPrompt: "",
  slackSync: false,
  // ?onboard=1 shows the first-run setup wizard in the browser preview
  accountUrl: "http://localhost:3000",
  onboarded: typeof location === "undefined" || !new URLSearchParams(location.search).has("onboard"),
  sttProvider: "local",
  sttModel: "large-v3-turbo-q5_0",
  language: "auto",
  autoLanguages: ["en", "hi", "gu"],
  llmProvider: "ollama",
  llmModel: "qwen3:8b",
  localLlmUrl: "http://localhost:11434",
  cleanupEnabled: true,
  assistantCloudAllowed: false,
  assistantScreenContext: true,
  attentionEnabled: true,
  attentionIntervalSec: 20,
  attentionDenylist: ["1Password", "Keychain Access", "Banking"],
  attentionCloudAllowed: false,
  playSounds: true,
  notchSize: "big",
  soundPack: "chime",
  soundVolume: 70,
  notifySound: true,
  soundStart: "chime",
  soundStop: "chime",
  soundNotify: "glass",
  startSoundOn: true,
  stopSoundOn: true,
  systemNotifications: true,
  claudeApprovals: true,
  claudeAutoContinue: false,
  claudeContinuePrompt: "Continue where you left off.",
  typingWpm: 40,
  userName: "Parth",
  // previews and tests can pick the theme up front (the real app keeps it in settings.json)
  theme: ((): ThemeMode => {
    try {
      const m = typeof localStorage === "undefined" ? null : localStorage.getItem("flo:theme-mode");
      return m === "dark" || m === "system" ? m : "light";
    } catch {
      return "light";
    }
  })(),
  accent: "#3dbbff",
  notchStyle: "ribbon",
  notchGradient: [],
  presence: "active",
  autoAway: false,
  autoAwayMinutes: 10,
  avatar: { ...DEFAULT_AVATAR },
  sync: { enabled: false, categories: ["todos", "notes", "settings", "history"] },
  sttKeepWarmMins: 10,
  reuseAnswers: true,
};

// ── sync your data (mock): ?syncjoin=1 pretends another Mac already set Sync up ──
const MOCK_RECOVERY = "7K2QF-M9X4D-HT8VB-3RJ6W-PZC1N-Y5GAE-QK7M2-XD9TF-4HV8R-JB3WN-6PC2K";
const syncMock = { hasKey: false, lastSync: null as string | null, items: 0, running: false };

const keys = new Set<string>(["groq"]);

const projectsBase: Omit<Project, "openTodos" | "doneTodos">[] = [
  { id: "p_apollo", name: "Apollo", description: "Client dashboard redesign for Northwind", status: "active", color: "#3dbbff", lastNote: "Design sync: agreed on glass cards", updatedAt: iso(40) },
  { id: "p_hermes", name: "Hermes API", description: "Payments gateway v2 migration", status: "blocked", color: "#1a9be0", lastNote: "Waiting on Stripe webhook keys", updatedAt: iso(300) },
  { id: "p_flo", name: "Flo", description: "Local-first voice assistant", status: "active", color: "#f59e0b", lastNote: "Notch island prototype done", updatedAt: iso(10) },
];
const projects = new Map(projectsBase.map((p) => [p.id, { ...p }]));

let mcpPrefill: { name?: string; url?: string; id?: string } | null = null;
const connections: Connection[] = [
  {
    id: "c1",
    name: "Notion",
    kind: "mcp",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server"],
    url: "",
    env: {},
    description: "",
    enabled: true,
    createdAt: iso(4000),
  },
];

const skills: Skill[] = [
  {
    id: "k1",
    name: "Upwork proposal",
    triggers: "proposal for this job, apply to this job",
    instructions: "Read the job post on screen. Write a 250-350 word proposal: the client's problem first, 2 matching projects, answer every question, end with one sharp question.",
    platforms: ["upwork", "browser"],
    mode: "write",
    enabled: true,
    uses: 12,
    createdAt: iso(3000),
  },
  {
    id: "k2",
    name: "Daily standup",
    triggers: "post my standup",
    instructions: "Open Slack, go to #scrum, and post yesterday / today / blockers from my to-dos and notes. Ask before sending.",
    platforms: ["slack"],
    mode: "do",
    enabled: true,
    uses: 4,
    createdAt: iso(2000),
  },
  {
    id: "k3",
    name: "Morning inbox digest",
    triggers: "inbox digest",
    instructions: "1. Read my unread Gmail from the last day\n2. Summarise it in 5 bullets: who needs a reply first\nFinish by typing the result into the field I'm in.",
    platforms: ["gmail"],
    mode: "write",
    enabled: true,
    uses: 9,
    createdAt: iso(1500),
    schedule: "0 9 * * 1-5",
    lastRun: null,
  },
];

/** "Build with AI" in the browser preview: a plausible skill for the description (no model). */
function mockGenerateSkill(description: string, current?: string): import("./types").GeneratedSkill {
  const d = description.toLowerCase();
  const platforms = (["gmail", "slack", "upwork", "linkedin", "whatsapp"] as const).filter((p) => d.includes(p));
  const mcp = connections.filter((c) => c.kind === "mcp" && d.includes(c.name.toLowerCase())).map((c) => c.id);
  const at = d.match(/\bat (\d{1,2})(?::(\d{2}))?/);
  const [h, m] = at ? [Number(at[1]), Number(at[2] ?? 0)] : [9, 0];
  const schedule = /every (\d+) minutes/.test(d)
    ? `*/${d.match(/every (\d+) minutes/)![1]} * * * *`
    : /weekday/.test(d)
      ? `${m} ${h} * * 1-5`
      : /every (day|morning)|daily/.test(d)
        ? `${m} ${h} * * *`
        : /every hour|hourly/.test(d)
          ? "0 * * * *"
          : null;
  if (current) {
    // refine: keep the current steps, add the change as a final step
    const steps = (current.match(/^\d+\. .+$/gm) ?? []).map((s) => s.replace(/^\d+\. /, ""));
    return { name: current.match(/^Name: (.+)$/m)?.[1] ?? "Refined skill", triggers: (current.match(/^Triggers: (.+)$/m)?.[1] ?? "").split(",").map((t) => t.trim()).filter((t) => t && t !== "(none)"), schedule: current.match(/^Schedule \(cron\): (.+)$/m)?.[1]?.replace("none", "") || schedule, steps: [...steps, description.trim().replace(/^./, (c) => c.toUpperCase())], platforms, mcp, knowledge: [], mode: "write", notes: [] };
  }
  const steps: string[] = [];
  if (d.includes("gmail") || d.includes("email") || d.includes("inbox")) steps.push("Read my unread Gmail from the last day");
  if (d.includes("summar")) steps.push("Summarise it in 5 short bullets, most urgent first");
  const post = d.match(/post (?:it )?to (?:slack )?(#[\w-]+)/);
  if (post) steps.push(`Post the summary to ${post[1]} in Slack`);
  if (!steps.length) steps.push(description.trim().replace(/^./, (c) => c.toUpperCase()));
  const name = d.includes("summar") && (d.includes("gmail") || d.includes("inbox")) ? "Daily inbox digest" : description.split(/\s+/).slice(0, 3).join(" ").replace(/^./, (c) => c.toUpperCase());
  return {
    name,
    triggers: [name.toLowerCase(), ...(post ? ["post my digest"] : [])],
    schedule,
    steps,
    platforms,
    mcp,
    knowledge: [],
    mode: post ? "do" : "write",
    notes: post && !mcp.length ? ["Add a Slack MCP server in Connections so Flo can post for you."] : [],
  };
}

const todos: Todo[] = [
  { id: "t1", title: "Reply to Rahul about the invoice", reason: "Rahul asked “can you confirm the invoice by today?”", person: "Rahul", app: "Slack", source: "attention", status: "open", confidence: 0.92, createdAt: iso(25) },
  { id: "t2", title: "Send Apollo deck to Northwind", source: "voice", status: "open", projectId: "p_apollo", due: inDays(2), createdAt: iso(120) },
  { id: "t3", title: "Review PR #482: notch window positioning", app: "GitHub", source: "attention", status: "open", reason: "You were requested as reviewer", confidence: 0.81, createdAt: iso(70), projectId: "p_flo" },
  { id: "t4", title: "Ask Priya for Stripe webhook keys", source: "meeting", status: "open", projectId: "p_hermes", createdAt: iso(200) },
  { id: "t5", title: "Book flight to Bangalore", source: "voice", status: "open", due: inDays(5), createdAt: iso(600) },
  { id: "t6", title: "Answer Mom on WhatsApp about Sunday lunch", app: "WhatsApp", person: "Mom", source: "attention", status: "open", confidence: 0.74, createdAt: iso(15) },
  { id: "t7", title: "Write release notes for v0.2", source: "assistant", status: "open", projectId: "p_flo", createdAt: iso(50) },
  { id: "t8", title: "Pay electricity bill", source: "manual", status: "open", due: inDays(0), createdAt: iso(900) },
  { id: "t9", title: "Update Hermes migration doc", source: "assistant", status: "done", projectId: "p_hermes", createdAt: iso(2000), completedAt: iso(300) },
  { id: "t10", title: "Share wireframes with Ana", source: "meeting", status: "done", projectId: "p_apollo", createdAt: iso(3000), completedAt: iso(1500) },
  { id: "t11", title: "Fix waveform jitter on Windows", source: "voice", status: "done", projectId: "p_flo", createdAt: iso(1600), completedAt: iso(100) },
  { id: "t12", title: "Follow up with Karan re: contract", person: "Karan", app: "Mail", source: "attention", status: "open", confidence: 0.68, createdAt: iso(400), projectId: "p_apollo" },
];
// a timed to-do with its reminder still ahead (Reminders section, notch reminder)
{
  const t8 = todos.find((t) => t.id === "t8");
  if (t8) {
    const due = new Date(Date.now() + 3 * 3600_000);
    t8.due = due.toISOString();
    t8.remindAt = new Date(due.getTime() - 5 * 60_000).toISOString();
  }
  const t4 = todos.find((t) => t.id === "t4");
  if (t4) t4.person = "Rahul";
}

/** n1: names the (mock) summary pass heard in the conversation ("Ana, can you…" → Speaker 2 answers) */
const mockSpeakerSuggestions: Record<string, string> = { "Speaker 2": "Ana" };

const notes: Note[] = [
  {
    id: "n1",
    title: "Design sync · Apollo",
    kind: "meeting",
    projectId: "p_apollo",
    durationSec: 1840,
    createdAt: iso(180),
    live: false,
    summary:
      "Team agreed to move the Apollo dashboard to glass cards with a violet→cyan accent. Ana owns the component library; launch target is the 20th. Open question: dark-mode contrast for charts.",
    actionItems: ["Speaker 2: finalize the component library by Monday", "You: send the updated deck to Northwind", "Speaker 1: check chart contrast in dark mode"],
    transcript: [
      { t: 4, text: "Okay, let's start with the dashboard cards.", speaker: "You" },
      { t: 12, text: "हाँ, नए कार्ड्स काफ़ी साफ़ दिख रहे हैं।", speaker: "Rahul" },
      { t: 31, text: "I like the frosted look, it feels much lighter than the old one.", speaker: "Speaker 1" },
      { t: 88, text: "Ana, can you own the component library?", speaker: "You" },
      { t: 95, text: "Yes, I can have it by Monday.", speaker: "Speaker 2" },
      { t: 160, text: "We should double-check contrast for the charts in dark mode.", speaker: "Speaker 1" },
      { t: 240, text: "Launch target is still the twentieth.", speaker: "Speaker 2" },
    ],
  },
  {
    id: "n2",
    title: "Hermes standup",
    kind: "meeting",
    projectId: "p_hermes",
    durationSec: 720,
    createdAt: iso(1500),
    live: false,
    summary: "Migration blocked on Stripe webhook keys. Priya will request them; retry tests tomorrow.",
    actionItems: ["Ask Priya for Stripe webhook keys", "Rerun integration tests"],
    transcript: [
      { t: 3, text: "Status on Hermes?" },
      { t: 12, text: "Still blocked on the webhook keys from Stripe." },
      { t: 40, text: "Priya, can you ping them today?" },
    ],
  },
  {
    id: "n3",
    title: "Idea: voice macros",
    kind: "voice",
    projectId: "p_flo",
    durationSec: 45,
    createdAt: iso(60 * 30),
    live: false,
    summary: "Let users save spoken macros like “daily wrap-up” that run several assistant actions.",
    actionItems: [],
    transcript: [{ t: 0, text: "What if I could say daily wrap-up and it summarizes every project and drafts my standup." }],
  },
];

const APPS = ["Slack", "Gmail", "Cursor", "Notion", "WhatsApp", "Linear", "Chrome"];
const history: Dictation[] = Array.from({ length: 28 }, (_, i) => {
  const samples = [
    "Hey team, quick update: the notch island is working and I'll push the build tonight.",
    "Can we move the Apollo review to Thursday afternoon?",
    "Thanks Rahul, confirming the invoice amount is correct.",
    "Refactor the hotkey module so the event tap restarts if macOS disables it.",
    "Let's ship the glass dashboard first and polish analytics next week.",
    "Reminder to follow up with Karan about the contract renewal.",
  ];
  const text = samples[i % samples.length];
  return {
    id: `d${i}`,
    createdAt: iso(i * 47 + 3),
    app: APPS[i % APPS.length],
    mode: (i % 7 === 3 ? "assistant" : "dictation") as Mode,
    rawText: "um " + text.toLowerCase(),
    finalText: text,
    words: countWords(text),
    durationMs: 2500 + (i % 5) * 900,
    latencyMs: 380 + Math.round(rand(i) * 420),
  };
});

const dictionary: DictionaryEntry[] = [
  { id: "w1", word: "Flo" },
  { id: "w2", word: "Tauri" },
  { id: "w3", word: "Northwind", replacement: "north wind" },
];

const models: LocalModel[] = [
  { id: "parakeet-tdt-0.6b-v3", label: "Parakeet v3 · fastest", sizeMb: 640, languages: "English + 24 EU", installed: false },
  { id: "large-v3-turbo-q5_0", label: "Whisper Large v3 Turbo", sizeMb: 574, languages: "99 languages", installed: true },
  { id: "small-q5_1", label: "Whisper Small · light", sizeMb: 190, languages: "99 languages", installed: false },
];

const netlog: NetworkLogEntry[] = [
  { at: iso(2), host: "localhost:11434", purpose: "LLM cleanup (Ollama)", allowed: true, bytes: 1840 },
  { at: iso(9), host: "api.groq.com", purpose: "Assistant (BYOK, cloud allowed)", allowed: true, bytes: 5230 },
  { at: iso(33), host: "telemetry.example.com", purpose: "Blocked: not on allow-list", allowed: false, bytes: 0 },
  { at: iso(80), host: "huggingface.co", purpose: "Model download", allowed: true, bytes: 601_882_112 },
];

const assistantLog: AssistantResponse[] = [
  {
    id: "a1",
    query: "What's blocked across my projects?",
    reply: "Only Hermes API is blocked, it's waiting on Stripe webhook keys from Priya. Apollo and Flo are on track.",
    actions: [],
    results: [],
    createdAt: iso(90),
    mode: "quick",
  },
  {
    id: "a2",
    query: "Add a to-do to Apollo: send the deck by Friday",
    reply: "Added to Apollo, due Friday.",
    actions: [{ type: "add_todo", title: "Send Apollo deck to Northwind", project: "Apollo", due: inDays(2) }],
    results: ["✓ To-do added to Apollo"],
    createdAt: iso(120),
    mode: "quick",
  },
];

const claudeEvents: ClaudeEvent[] = [
  { id: "c1", kind: "stop", sessionId: "s1", project: "Flo", cwd: "/Users/parth/Flo", message: "Built the island UI and glass dashboard; all 15 tests pass.", at: iso(4), seen: false },
  { id: "c2", kind: "notification", sessionId: "s2", project: "hermes-api", cwd: "/Users/parth/hermes-api", message: "Claude needs your permission to run `npm publish`.", at: iso(22), seen: false },
  { id: "c3", kind: "stop", sessionId: "s3", project: "apollo-web", cwd: "/Users/parth/apollo-web", message: "Refactored chart components and fixed dark-mode contrast.", at: iso(140), seen: true },
];
const hook: ClaudeHookStatus = { installed: false, configPath: "~/.claude/settings.json", port: 47821, listening: true };

// ── live Claude sessions (notch tray) ───────────────────────────────────────
const claudeSessions: ClaudeSession[] = [
  { sessionId: "s1", project: "Flo", cwd: "/Users/parth/Flo", status: "done", message: "Built the notch tray and correction card, all 34 tests pass.", updatedAt: iso(3), appBundle: "com.microsoft.VSCode", source: "claude" },
  { sessionId: "s2", project: "hermes-api", cwd: "/Users/parth/hermes-api", status: "needs_approval", message: "Claude needs your permission to run `npm publish`.", updatedAt: iso(9), appBundle: "com.googlecode.iterm2", source: "claude" },
  { sessionId: "s4", project: "apollo-web", cwd: "/Users/parth/apollo-web", status: "working", message: "Refactoring chart components…", updatedAt: iso(1), appBundle: "com.todesktop.230313mzl4w4u92", source: "claude" },
];
const emitSessions = () => mockEmit(EV.claudeSessions, claudeSessions.map((s) => ({ ...s })));

/** Demo: a session asks for a reply. */
export function mockClaudeSession(status: ClaudeSession["status"] = "waiting_reply", project = "job-finder", message = "Which job boards should I scrape next, LinkedIn or Wellfound?") {
  const existing = claudeSessions.find((s) => s.project === project);
  if (existing) Object.assign(existing, { status, message, updatedAt: new Date().toISOString() });
  else claudeSessions.unshift({ sessionId: uid("s"), project, cwd: `/Users/parth/${project}`, status, message, updatedAt: new Date().toISOString(), source: "claude" });
  emitSessions();
}

/** Demo: user fixed a word Flo typed. */
export function mockCorrection(heard = "tory", corrected = "Tauri") {
  const e: CorrectionEvent = { id: uid("fix"), heard, corrected, app: "Slack" };
  mockEmit(EV.correction, e);
  return e;
}

/** Demo: another app started using the mic for a call. */
export function mockMeetingDetected(app = "Zoom", active = true) {
  const e: MeetingDetectedEvent = { app, active };
  mockEmit(EV.meetingDetected, e);
}

/** Push a fake Claude Code event (used by the island demo). */
export function mockClaudeEvent(kind: ClaudeEvent["kind"] = "stop", project = "Flo", message = "Built the island UI, all tests pass.") {
  const e: ClaudeEvent = { id: uid("c"), kind, sessionId: uid("s"), project, cwd: `/Users/parth/${project}`, message, at: new Date().toISOString(), seen: false };
  claudeEvents.unshift(e);
  mockEmit(EV.claude, e);
  return e;
}

// ── analytics ───────────────────────────────────────────────────────────────
export function buildAnalytics(days: number, now: Date = new Date()): Analytics {
  const daily: DailyStat[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const seed = Math.floor(d.getTime() / 86_400_000);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const base = weekend ? 250 : 1400;
    const growth = 1 + (days - i) / (days * 2);
    const words = Math.round((base + rand(seed) * 1200) * growth);
    daily.push({
      day: dayStr(d),
      words,
      dictations: Math.round(words / 22),
      assistant: Math.round(rand(seed + 1) * (weekend ? 3 : 14)),
      meetingMin: weekend ? 0 : Math.round(rand(seed + 2) * 90),
      todosDone: Math.round(rand(seed + 3) * (weekend ? 2 : 8)),
    });
  }
  const totalWords = daily.reduce((s, d) => s + d.words, 0);
  const totalDictations = daily.reduce((s, d) => s + d.dictations, 0);
  const avgWpm = 148;
  const minutesSaved = Math.round(totalWords / settings.typingWpm - totalWords / avgWpm);
  let streakDays = 0;
  for (let i = daily.length - 1; i >= 0 && daily[i].words > 0; i--) streakDays++;
  const hourly = Array.from({ length: 24 }, (_, h) => {
    const peak = Math.exp(-((h - 11) ** 2) / 10) + 0.8 * Math.exp(-((h - 16) ** 2) / 8);
    return Math.round((totalWords / 12) * peak * (0.8 + rand(h) * 0.4));
  });
  const shares = [0.29, 0.21, 0.17, 0.12, 0.1, 0.07, 0.04];
  return {
    totalWords,
    totalDictations,
    avgWpm,
    minutesSaved,
    streakDays,
    todosOpen: todos.filter((t) => t.status === "open").length,
    todosDone: daily.reduce((s, d) => s + d.todosDone, 0),
    meetingMinutes: daily.reduce((s, d) => s + d.meetingMin, 0),
    daily,
    topApps: APPS.map((app, i) => ({ app, words: Math.round(totalWords * shares[i]) })),
    hourly,
  };
}

// ── session simulation ──────────────────────────────────────────────────────
let sessionMode: Mode = "dictation";
let levelTimer: ReturnType<typeof setInterval> | null = null;
let meetingTimer: ReturnType<typeof setInterval> | null = null;
let liveNote: Note | null = null;

function startLevels() {
  stopLevels();
  const t0 = Date.now();
  levelTimer = setInterval(() => {
    const t = (Date.now() - t0) / 1000;
    const rms = Math.max(0, 0.35 + 0.3 * Math.sin(t * 5) * Math.sin(t * 1.7) + (Math.random() - 0.5) * 0.25);
    mockEmit(EV.level, { rms });
  }, 33);
}
function stopLevels() {
  if (levelTimer) clearInterval(levelTimer);
  levelTimer = null;
  mockEmit(EV.level, { rms: 0 });
}

const MEETING_LINES = [
  "Alright, let's kick off, first item is the launch checklist.",
  "The notch animation feels great on the new MacBook.",
  "We still need Windows bottom-right positioning tested.",
  "Can someone own the release notes?",
  "I'll take that, should be done by tomorrow.",
  "Let's also review analytics accuracy next week.",
];

function startMockMeeting(title?: string, projectId?: string): Note {
  liveNote = {
    id: uid("n"),
    title: title || "Meeting notes",
    kind: "meeting",
    projectId,
    transcript: [],
    summary: "",
    actionItems: [],
    durationSec: 0,
    createdAt: new Date().toISOString(),
    live: true,
  };
  notes.unshift(liveNote);
  mockEmit(EV.notes, {});
  mockEmit(EV.state, { phase: "listening", mode: "meeting" });
  startLevels();
  const t0 = Date.now();
  let i = 0;
  let words = 0;
  let lineStart = 0;
  // Wispr-style: the current line grows word by word as a live `partial`, then commits as a segment
  meetingTimer = setInterval(() => {
    if (!liveNote) return;
    const elapsedSec = Math.round((Date.now() - t0) / 1000);
    liveNote.durationSec = elapsedSec;
    const line = MEETING_LINES[i % MEETING_LINES.length].split(" ");
    if (words === 0) lineStart = elapsedSec;
    words++;
    if (words < line.length) {
      mockEmit(EV.meeting, { noteId: liveNote.id, partial: line.slice(0, words).join(" "), elapsedSec, live: true });
      return;
    }
    const seg = { t: lineStart, text: line.join(" ") };
    liveNote.transcript.push(seg);
    i++;
    words = 0;
    if (i % 3 === 0)
      liveNote.summary = `Discussed launch checklist and the notch animation. Windows positioning still needs testing; release notes have an owner.`;
    mockEmit(EV.meeting, { noteId: liveNote.id, segment: seg, partial: "", summary: liveNote.summary || undefined, elapsedSec, live: true });
  }, 320);
  return liveNote;
}

function stopMockMeeting(): Note | null {
  if (meetingTimer) clearInterval(meetingTimer);
  meetingTimer = null;
  stopLevels();
  const n = liveNote;
  if (n) {
    n.live = false;
    n.summary ||= "Short meeting, no major decisions captured.";
    n.actionItems = ["Test Windows bottom-right positioning", "Write release notes"];
    mockEmit(EV.meeting, { noteId: n.id, summary: n.summary, elapsedSec: n.durationSec, live: false });
  }
  liveNote = null;
  mockEmit(EV.state, { phase: "done", mode: "meeting", message: "Notes saved" });
  setTimeout(() => mockEmit(EV.state, { phase: "idle", mode: "meeting" }), 1200);
  mockEmit(EV.notes, {});
  return n;
}

function projectView(p: Omit<Project, "openTodos" | "doneTodos">): Project {
  const ts = todos.filter((t) => t.projectId === p.id);
  return { ...p, openTodos: ts.filter((t) => t.status === "open").length, doneTodos: ts.filter((t) => t.status === "done").length };
}

/** deep / web answers: long markdown (+ sources for web) */
function fakeDepth(query: string, mode: "deep" | "web"): AssistantResponse {
  const reply =
    mode === "web"
      ? `## What I found\n\n- **Tauri 2** ships a stable plugin API for global shortcuts.\n- Notch apps place a borderless panel at the top centre of the screen.\n- Use \`NSPanel\` so the window never steals focus.\n\nSee the [Tauri docs](https://v2.tauri.app/plugin/global-shortcut/) for setup.`
      : `## Deeper look\n\nFrom your screen, the failing step is the **island resize** after hover.\n\n1. Ignore DOM hover inside Tauri\n2. Only resize when the size changes\n3. Never shrink while hovered\n\n\`\`\`ts\nif (backendHover.current) return;\n\`\`\`\n\nThat removes the open/close loop.`;
  return {
    id: uid("a"),
    query,
    reply,
    actions: [],
    results: [],
    createdAt: new Date().toISOString(),
    mode,
    sources:
      mode === "web"
        ? [
            { title: "Global Shortcut | Tauri", url: "https://v2.tauri.app/plugin/global-shortcut/" },
            { title: "NSPanel | Apple Developer", url: "https://developer.apple.com/documentation/appkit/nspanel" },
            { title: "tauri-nspanel on GitHub", url: "https://github.com/ahkohd/tauri-nspanel" },
          ]
        : undefined,
  };
}

function fakeAssistant(text: string): AssistantResponse {
  const q = text.toLowerCase();
  const res: AssistantResponse = { id: uid("a"), query: text, reply: "", actions: [], results: [], createdAt: new Date().toISOString(), mode: "quick" };
  const proj = [...projects.values()].find((p) => q.includes(p.name.toLowerCase()));
  if (q.includes("to-do") || q.includes("todo") || q.startsWith("add") || q.includes("remind")) {
    const title = text.replace(/.*?(to-?do( to \w+)?|remind me to)[:,]?\s*/i, "").replace(/^./, (c) => c.toUpperCase()) || text;
    const t: Todo = { id: uid("t"), title, source: "assistant", status: "open", projectId: proj?.id, createdAt: res.createdAt };
    todos.unshift(t);
    res.actions.push({ type: "add_todo", title, project: proj?.name });
    res.results.push(`✓ To-do added${proj ? ` to ${proj.name}` : ""}`);
    res.reply = `Got it. “${title}” is on your list${proj ? ` under ${proj.name}` : ""}.`;
    mockEmit(EV.todos, {});
  } else if (q.includes("meeting")) {
    const title = text.replace(/.*meeting notes( for)?/i, "").trim() || "Meeting notes";
    startMockMeeting(title, proj?.id);
    res.actions.push({ type: "start_meeting", title });
    res.results.push("● Recording meeting notes");
    res.reply = `Started meeting notes for “${title}”. I'll summarize live.`;
  } else if (q.includes("blocked") || q.includes("status") || q.includes("projects")) {
    const lines = [...projects.values()].map((p) => `${p.name}: ${p.status}`);
    res.reply = `Here's where things stand: ${lines.join(" · ")}. Hermes is waiting on Stripe keys.`;
  } else {
    res.reply = "I'm running in demo mode. Connect a model in Settings → AI and I'll answer for real.";
  }
  assistantLog.unshift(res);
  return res;
}

// ── invoke dispatcher ───────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── account (signed out by default; ?signedin=1 or localStorage flo.mock.signedin=1 bypasses) ──
const qs = () => (typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search));
// demos / tests can open the island at a notch size: ?notchSize=biggest
{
  const z = qs().get("notchSize");
  if (z === "small" || z === "big" || z === "bigger" || z === "biggest") settings.notchSize = z;
}
const mockSignedIn = (() => {
  try {
    return qs().has("signedin") || localStorage.getItem("flo.mock.signedin") === "1";
  } catch {
    return qs().has("signedin");
  }
})();
const DEMO_USER = { id: "u_1", email: "naman@hellonaman.com", name: "Naman Gundaniya" };
const account: { signedIn: boolean; user?: typeof DEMO_USER; googleState?: string } = mockSignedIn
  ? { signedIn: true, user: DEMO_USER }
  : { signedIn: false, user: qs().has("offline") ? DEMO_USER : undefined };
const ACCOUNT_URL = "http://localhost:3000";
const nameFromEmail = (e: string) =>
  e
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

// Input Monitoring stays off: Flo doesn't need it (the Flo key runs on Accessibility alone)
const perms = { microphone: true, accessibility: true, inputMonitoring: false, screen: false, hotkeyActive: true, accessibilityStale: false };
// ?perms=none starts the preview with nothing granted (first launch on a fresh Mac);
// ?perms=noax with only the microphone; ?perms=stale as after an update that reset Accessibility
{
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("perms") : null;
  if (q === "none" || q === "noax" || q === "stale") {
    perms.accessibility = false;
    perms.hotkeyActive = false;
  }
  if (q === "none") perms.microphone = false;
  if (q === "stale") perms.accessibilityStale = true;
}

// ── context library ──────────────────────────────────────────────────────────
const ctxContent = new Map<string, string>();
const contextDocs: ContextDoc[] = [];
function makeDoc(title: string, content: string, pinned = false): ContextDoc {
  const d: ContextDoc = {
    id: uid("ctx"),
    title,
    chars: content.length,
    tokens: Math.ceil(content.length / 4),
    enabled: true,
    pinned,
    createdAt: new Date().toISOString(),
    preview: content.replace(/\s+/g, " ").trim().slice(0, 160),
  };
  ctxContent.set(d.id, content);
  return d;
}
contextDocs.push(
  makeDoc("About me", "I'm Parth, a full-stack developer in Ahmedabad. I build AI agents and dashboards. Prefer short, warm replies.", true),
  makeDoc(
    "Apollo project brief",
    "# Apollo\nClient dashboard redesign for Northwind. Stack: React, Tailwind, Supabase. Launch target: end of month. Owner of release notes: Priya. Open risk: Windows positioning of the notch window.",
  ),
);

// ── integrations + Slack + confirmations ─────────────────────────────────────
const integrations: Integration[] = [
  { id: "claude", name: "Claude Code", available: true, installed: true, configPath: "~/.claude/settings.json", note: "Hooks ping Flo when a session finishes or needs you." },
  { id: "codex", name: "Codex CLI", available: true, installed: false, configPath: "~/.codex/config.toml", note: "Notify hook reports finished turns." },
  { id: "cursor", name: "Cursor", available: false, installed: false, configPath: "~/.cursor/hooks.json", note: "Agent hooks report when a task stops." },
  { id: "webhook", name: "Any tool (webhook)", available: true, installed: true, configPath: "http://127.0.0.1:47621/agent/hook?token=TOKEN&source=NAME", note: "POST JSON {status, project, message} from any script or agent." },
];
let slackWho: string | null = null;
/** Connect Slack started (slack_oauth_start) and waiting for flo://slack */
let slackPending: string | null = null;
let slackRevoked = 0;
/** URLs the app would open in the browser (for tests) */
export const openedUrls: string[] = [];
/** what the Rust flo://slack deep-link handler does once the website hands the token back */
function mockSlackDeepLink(code = "handoff_demo_code_123456") {
  if (!slackPending || code.toUpperCase().includes("BAD")) {
    const error = "That Slack link expired. Click Connect Slack in Flo again.";
    mockEmit(EV.slack, { connected: false, error });
    mockEmit(EV.toast, { kind: "error", text: `Slack: ${error}` });
    return false;
  }
  slackPending = null;
  slackWho = "parth · Northwind";
  mockEmit(EV.slack, { connected: true, who: slackWho });
  mockEmit(EV.toast, { kind: "success", text: "Slack connected as @parth in Northwind" });
  return true;
}
/** confirm_action calls (for tests) */
export const confirmLog: { id: string; approve: boolean }[] = [];
export function mockConfirm(title = "Send to Rahul on Slack?", body = "Hey Rahul, the deck is in the shared drive. Can you review it before Friday's call? Thanks!") {
  const e: ConfirmEvent = { id: uid("cf"), kind: "slack", title, body };
  mockEmit(EV.confirm, e);
  return e;
}

/** A Claude Code permission prompt, shaped like claude.rs ask_permission emits it. */
export function mockPermission(project = "blog-100-plan", tool = "Bash", body = "Run: npm run build && npx wrangler pages deploy ./dist --project-name blog-100-plan --branch main --commit-dirty=true", secsAgo = 0) {
  const e: ConfirmEvent = {
    id: uid("perm"),
    kind: "claude",
    title: `Claude needs you · ${project}`,
    body,
    sessionId: `sess-${project}`,
    cwd: `/Users/p/${project}`,
    project,
    tool,
    app: "com.googlecode.iterm2",
    at: new Date(Date.now() - secsAgo * 1000).toISOString(),
  };
  mockEmit(EV.confirm, e);
  return e;
}

/** Every island_resize call (for tests: detect resize oscillation). */
export const resizeLog: { w: number; h: number; at: number }[] = [];

/** every invoke (for tests: assert which commands ran with which args) */
export const callLog: { cmd: string; args: Record<string, any> }[] = [];

// now playing: simulated in mockMedia.ts (Spotify queue with artwork, a video in Chrome);
// every change is pushed as EV.nowPlaying like the backend does
const emitNowPlaying = (np: unknown) => mockEmit(EV.nowPlaying, np);
if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) setTimeout(() => emitNowPlaying(mediaSample()), 400);
let mockVolume = 55;
let mockAgentMode = false;

export async function mockInvoke(cmd: string, args: Record<string, any> = {}): Promise<unknown> {
  callLog.push({ cmd, args });
  switch (cmd) {
    case "get_settings":
      return { ...settings };
    case "save_settings":
      // like the backend: presence changes only through set_presence
      Object.assign(settings, args.settings, { presence: settings.presence });
      return null;
    case "set_api_key":
      keys.add(args.provider);
      return null;
    case "has_api_key":
      return keys.has(args.provider);
    case "delete_api_key":
      keys.delete(args.provider);
      return null;
    case "provider_models": {
      await sleep(350);
      const M: Record<string, string[]> = {
        openai: ["gpt-5-mini", "gpt-5", "gpt-5-nano", "gpt-4.1-mini"],
        anthropic: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"],
        gemini: ["gemini-flash-latest", "gemini-2.5-pro", "gemini-2.5-flash-lite"],
        groq: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile", "qwen/qwen3-32b"],
        openrouter: ["openai/gpt-oss-120b", "anthropic/claude-haiku-5-5", "qwen/qwen3-235b-a22b", "deepseek/deepseek-chat"],
        minimax: ["MiniMax-M2", "MiniMax-Text-01"],
        qwen: ["qwen-plus", "qwen-max", "qwen-turbo", "qwen3-coder-plus"],
        ollama_cloud: ["gpt-oss:120b", "gpt-oss:20b", "qwen3-coder:480b", "deepseek-v3.1:671b"],
        lmstudio: ["local-model"],
        ollama: ["qwen3:8b", "llama3.2:3b"],
      };
      return M[args.provider] ?? [];
    }
    case "local_models":
      await sleep(250);
      // ?ollama=none → nothing pulled / not running
      return new URLSearchParams(location.search).get("ollama") === "none" ? [] : ["qwen3:8b", "llama3.2:3b", "gemma3:4b"];
    case "test_llm":
      await sleep(600);
      return `${settings.llmProvider} · ${settings.llmModel} responded in 412 ms`;
    case "get_island_geometry": {
      const p = new URLSearchParams(location.search).get("platform");
      const geo: IslandGeometry =
        p === "windows"
          ? { platform: "windows", hasNotch: false, notchWidth: 0, notchHeight: 0, screenWidth: 1920 }
          : (() => {
              // ?nh=38 previews the taller notch of 14"/16" MacBook Pros
              const q = new URLSearchParams(location.search);
              const nh = Number(q.get("nh")) || 32;
              const nw = Number(q.get("nw")) || (nh >= 38 ? 200 : 185);
              return { platform: "macos" as const, hasNotch: true, notchWidth: nw, notchHeight: nh, screenWidth: 1512 };
            })();
      return geo;
    }
    case "island_resize":
      resizeLog.push({ w: args.width, h: args.height, at: Date.now() });
      return null;
    case "open_dashboard":
      return null;
    case "account_status":
      await sleep(120);
      return { signedIn: account.signedIn, user: account.user, accountUrl: ACCOUNT_URL, offline: !account.signedIn && qs().has("offline") };
    case "account_login": {
      await sleep(450);
      const email = String(args.email ?? "").trim();
      if (email.includes("offline")) throw new Error("network error: could not connect to the account server");
      if (!email.includes("@") || String(args.password ?? "").length < 4 || args.password === "wrong") throw new Error("401 Unauthorized: invalid email or password");
      account.signedIn = true;
      account.user = { id: "u_" + email.length, email, name: nameFromEmail(email) };
      mockEmit("flo://account", { signedIn: true, user: account.user });
      return account.user;
    }
    case "account_google_start":
      await sleep(200);
      account.googleState = "st_" + Math.random().toString(36).slice(2, 8);
      return { state: account.googleState };
    case "account_exchange": {
      await sleep(400);
      if (!args.code || String(args.code).toUpperCase() === "BAD") throw new Error("400: invalid or expired code");
      account.signedIn = true;
      account.user = DEMO_USER;
      mockEmit("flo://account", { signedIn: true, user: account.user });
      return account.user;
    }
    case "sync_status":
      return { enabled: !!settings.sync?.enabled, categories: settings.sync?.categories ?? [], hasKey: syncMock.hasKey, running: syncMock.running, lastSync: syncMock.lastSync, lastError: null, syncedItems: syncMock.items };
    case "sync_enable": {
      if (!account.signedIn) throw new Error("Sign in to Flo to use Sync.");
      if (qs().has("syncjoin") && !syncMock.hasKey) return { enabled: false, recoveryKey: null, needsRecoveryKey: true };
      const first = !syncMock.hasKey;
      syncMock.hasKey = true;
      settings.sync = { enabled: true, categories: settings.sync?.categories ?? ["todos", "notes", "settings", "history"] };
      syncMock.lastSync = new Date().toISOString();
      syncMock.items = 1284;
      return { enabled: true, recoveryKey: first ? MOCK_RECOVERY : null, needsRecoveryKey: false };
    }
    case "sync_join": {
      const k = String((args as { recoveryKey?: string })?.recoveryKey ?? "").replace(/[^0-9a-z]/gi, "");
      if (k.length !== 55) throw new Error("That recovery key is the wrong length. It has 55 letters and numbers.");
      syncMock.hasKey = true;
      settings.sync = { enabled: true, categories: settings.sync?.categories ?? ["todos", "notes", "settings", "history"] };
      syncMock.lastSync = new Date().toISOString();
      syncMock.items = 1284;
      return null;
    }
    case "sync_disable":
      settings.sync = { ...(settings.sync ?? { categories: [] }), enabled: false } as typeof settings.sync;
      return null;
    case "sync_now":
      syncMock.lastSync = new Date().toISOString();
      return { pulled: 3, pushed: 2, skipped: 0 };
    case "sync_set_categories":
      settings.sync = { enabled: !!settings.sync?.enabled, categories: (args as { categories: string[] }).categories as never };
      return null;
    case "sync_recovery_key":
      if (!syncMock.hasKey) throw new Error("This Mac has no sync key yet.");
      return MOCK_RECOVERY;
    case "sync_delete_remote":
      syncMock.hasKey = false;
      syncMock.items = 0;
      syncMock.lastSync = null;
      settings.sync = { enabled: false, categories: settings.sync?.categories ?? [] };
      return null;
    case "account_logout":
      account.signedIn = false;
      account.user = undefined;
      mockEmit("flo://account", { signedIn: false });
      return null;
    case "start_session":
      // the backend refuses sessions while signed out
      if (!account.signedIn) {
        mockEmit(EV.state, { phase: "error", mode: args.mode ?? "dictation", message: "Sign in to Flo to start dictating." });
        throw new Error("Sign in to Flo first");
      }
      sessionMode = args.mode ?? "dictation";
      if (sessionMode === "meeting") {
        startMockMeeting();
        return null;
      }
      mockEmit(EV.state, { phase: "listening", mode: sessionMode });
      startLevels();
      return null;
    case "stop_session": {
      if (sessionMode === "meeting") {
        stopMockMeeting();
        return null;
      }
      stopLevels();
      const mode = sessionMode;
      mockEmit(EV.state, { phase: "transcribing", mode });
      setTimeout(() => mockEmit(EV.state, { phase: "thinking", mode }), 450);
      setTimeout(() => {
        if (mode === "assistant") {
          const r = fakeAssistant("What's blocked across my projects?");
          mockEmit(EV.assistant, r);
          mockEmit(EV.state, { phase: "idle", mode });
        } else {
          mockEmit(EV.transcript, { text: "Hey team, the build is ready for review.", final: true });
          mockEmit(EV.state, { phase: "done", mode });
          setTimeout(() => mockEmit(EV.state, { phase: "idle", mode }), 900);
        }
      }, 1000);
      return null;
    }
    case "set_setup_capture":
      return null;
    case "cancel_session":
      stopLevels();
      mockEmit(EV.state, { phase: "idle", mode: sessionMode });
      return null;
    case "ask_assistant": {
      await sleep(700);
      // mirror the app's "connect to <X> MCP" intent: open Apps with the form filled in
      const m = /^(?:connect(?: to)?|add|set ?up|install)\s+(?:the\s+|my\s+)?(.+?)\s+mcp(?:\s+server)?\.?$/i.exec(String(args.text ?? "").trim());
      if (m && (args.mode ?? "quick") === "quick") {
        const raw = m[1].trim();
        const name = /^mob+in$/i.test(raw) ? "Mobbin" : raw.replace(/\b\w/g, (c: string) => c.toUpperCase());
        mcpPrefill = { name, url: "" };
        mockEmit("flo://mcp-prefill", null);
        const r = {
          id: uid("a"),
          query: args.text,
          reply: `Opened Apps with ${name} filled in. Paste its MCP URL or command, then Save.`,
          actions: [{ type: "connect_mcp", name }],
          results: [],
          createdAt: new Date().toISOString(),
          mode: "quick",
          sources: [],
        } as unknown as AssistantResponse;
        assistantLog.unshift(r);
        mockEmit(EV.assistant, r);
        return r;
      }
      const r = args.mode && args.mode !== "quick" ? fakeDepth(args.text, args.mode) : fakeAssistant(args.text);
      assistantLog.unshift(r);
      mockEmit(EV.assistant, r);
      return r;
    }
    case "assistant_followup": {
      await sleep(900);
      const prev = assistantLog.find((x) => x.id === args.id);
      const r = fakeDepth(prev?.query ?? "that", args.mode);
      assistantLog.unshift(r);
      mockEmit(EV.assistant, r);
      return r;
    }
    case "list_assistant":
      return [...assistantLog];
    case "list_history":
      return history.slice(0, args.limit ?? 100);
    case "get_analytics":
      return buildAnalytics(args.days ?? 30);
    case "list_connections":
      return connections.map((c) => ({ ...c }));
    case "clear_caches":
      return null;
    case "take_mcp_prefill": {
      const p = mcpPrefill;
      mcpPrefill = null;
      return p;
    }
    case "save_connection": {
      const c = { ...args.connection } as Connection;
      if (!c.id) {
        c.id = uid("c");
        c.createdAt = new Date().toISOString();
        connections.push(c);
      } else {
        const i = connections.findIndex((x) => x.id === c.id);
        if (i >= 0) connections[i] = c;
      }
      return { ...c };
    }
    case "delete_connection": {
      const i = connections.findIndex((x) => x.id === args.id);
      if (i >= 0) connections.splice(i, 1);
      return null;
    }
    case "test_connection": {
      const c = args.connection as Connection;
      if (c.transport === "stdio" && !c.command) throw new Error("Add the command that starts this MCP server");
      return [
        { name: "search_pages", description: "Search pages in your workspace", inputSchema: { type: "object" } },
        { name: "create_page", description: "Create a page", inputSchema: { type: "object" } },
      ];
    }
    case "list_skills":
      return skills.map((k) => ({ ...k }));
    case "save_skill": {
      const k = { ...args.skill } as Skill;
      if (!k.id) {
        k.id = uid("k");
        k.createdAt = new Date().toISOString();
        k.uses = 0;
        skills.unshift(k);
      } else {
        const i = skills.findIndex((x) => x.id === k.id);
        if (i >= 0) skills[i] = { ...skills[i], ...k };
      }
      return { ...k };
    }
    case "delete_skill": {
      const i = skills.findIndex((x) => x.id === args.id);
      if (i >= 0) skills.splice(i, 1);
      return null;
    }
    case "generate_skill_graph": {
      await sleep(qs().has("slowai") ? 6000 : 900);
      if (!String(args.description ?? "").trim()) throw "Describe what the skill should do.";
      if (/\bfail\b/i.test(args.description)) throw "The AI didn't return a skill. Try again, or describe it a little differently.";
      return mockGenerateSkill(args.description, args.current ?? undefined);
    }
    case "run_skill_now": {
      const k = skills.find((x) => x.id === args.id);
      if (!k) throw "That skill no longer exists.";
      await sleep(600);
      k.lastRun = new Date().toISOString();
      k.uses += 1;
      const resp: AssistantResponse = {
        id: uid("a"),
        query: `Run my “${k.name}” skill`,
        reply: "• Rahul needs the Apollo deck reviewed by Friday\n• Stripe sent the Hermes webhook keys\n• 3 newsletters, nothing urgent",
        actions: [],
        results: [],
        createdAt: new Date().toISOString(),
        mode: "quick",
      };
      assistantLog.push(resp);
      mockEmit(EV.assistant, resp);
      mockEmit(EV.toast, { kind: "success", text: `${k.name} ran` });
      return resp;
    }
    case "list_todos":
      return [...todos];
    case "add_todo": {
      const t: Todo = { id: uid("t"), title: args.title, projectId: args.projectId, due: args.due, source: "manual", status: "open", createdAt: new Date().toISOString() };
      todos.unshift(t);
      mockEmit(EV.todos, {});
      return t;
    }
    case "update_todo": {
      const t = todos.find((x) => x.id === args.id);
      if (t) {
        if (args.status) {
          t.status = args.status as TodoStatus;
          t.completedAt = args.status === "done" ? new Date().toISOString() : undefined;
        }
        if (args.title !== undefined) t.title = args.title;
        if (args.projectId !== undefined) t.projectId = args.projectId || undefined;
      }
      mockEmit(EV.todos, {});
      return t ?? null;
    }
    case "delete_todo": {
      const i = todos.findIndex((x) => x.id === args.id);
      if (i >= 0) todos.splice(i, 1);
      mockEmit(EV.todos, {});
      return null;
    }
    case "list_projects":
      return [...projects.values()].map(projectView);
    case "create_project": {
      const palette = ["#3dbbff", "#1a9be0", "#f59e0b", "#10b981", "#ec4899", "#3b82f6"];
      const p = {
        id: uid("p"),
        name: args.name,
        description: args.description,
        status: "active" as const,
        color: palette[projects.size % palette.length],
        updatedAt: new Date().toISOString(),
        client: args.client,
        clientDetails: args.clientDetails,
        keywords: args.keywords,
      };
      projects.set(p.id, p);
      mockEmit(EV.projects, {});
      return projectView(p);
    }
    case "update_project": {
      const p = projects.get(args.id);
      if (p) {
        for (const k of ["name", "description", "status", "client", "clientDetails", "keywords"] as const) if (args[k] !== undefined) (p as any)[k] = args[k] || undefined;
        p.updatedAt = new Date().toISOString();
      }
      mockEmit(EV.projects, {});
      return p ? projectView(p) : null;
    }
    case "delete_project":
      projects.delete(args.id);
      mockEmit(EV.projects, {});
      return null;
    case "list_notes":
      return notes.map((n) => ({ ...n }));
    case "get_note":
      return notes.find((n) => n.id === args.id) ?? null;
    case "delete_note": {
      const i = notes.findIndex((n) => n.id === args.id);
      if (i >= 0) notes.splice(i, 1);
      mockEmit(EV.notes, {});
      return null;
    }
    case "start_meeting":
      sessionMode = "meeting";
      return startMockMeeting(args.title, args.projectId);
    case "stop_meeting":
      return stopMockMeeting();
    case "meeting_info": {
      if (args.noteId === "n1")
        return { capture: "mic+call", voiced: ["Speaker 1", "Speaker 2", "Rahul"], suggestions: { ...mockSpeakerSuggestions }, knownVoices: ["Meera", "Rahul"] };
      if (args.noteId === "n2") return { capture: "mic", captureNote: "Call audio capture needs macOS 14.2 or later", voiced: [] };
      return liveNote && args.noteId === liveNote.id ? { capture: "mic+call", voiced: [] } : null;
    }
    case "rename_speaker": {
      const n = notes.find((x) => x.id === args.noteId);
      const to = String(args.to ?? "").trim();
      if (!n || !to || to === args.from) return n ?? null;
      n.transcript = n.transcript.map((s) => (s.speaker === args.from ? { ...s, speaker: to } : s));
      // like the backend: generic labels in the summary / action items follow, the suggestion is used up
      if (/^Speaker \d+$/.test(args.from)) {
        const re = new RegExp(`\\b${args.from}\\b`, "g");
        n.summary = n.summary.replace(re, to);
        n.actionItems = n.actionItems.map((a) => a.replace(re, to));
      }
      delete mockSpeakerSuggestions[args.from];
      mockEmit(EV.notes, {});
      return { ...n };
    }
    case "list_dictionary":
      return [...dictionary];
    case "add_dictionary": {
      const e = { id: uid("w"), word: args.word, replacement: args.replacement || undefined };
      dictionary.push(e);
      return e;
    }
    case "remove_dictionary": {
      const i = dictionary.findIndex((d) => d.id === args.id);
      if (i >= 0) dictionary.splice(i, 1);
      return null;
    }
    case "network_log":
      return [...netlog];
    case "list_models":
      return models.map((m) => ({ ...m }));
    case "download_model": {
      const m = models.find((x) => x.id === args.id);
      if (!m) return null;
      const total = m.sizeMb * 1_048_576;
      let received = 0;
      const timer = setInterval(() => {
        received = Math.min(total, received + total / 25);
        const done = received >= total;
        mockEmit(EV.modelProgress, { id: m.id, received, total, done });
        if (done) {
          m.installed = true;
          clearInterval(timer);
        }
      }, 120);
      return null;
    }
    case "delete_model": {
      const m = models.find((x) => x.id === args.id);
      if (m) m.installed = false;
      return null;
    }
    case "remove_unused_models": {
      let freed = 0;
      for (const m of models) {
        if (m.installed && m.id !== settings.sttModel) {
          m.installed = false;
          freed += m.sizeMb;
        }
      }
      return freed;
    }
    case "attention_status": {
      const s: AttentionStatus = { enabled: settings.attentionEnabled, paused: false, lastCaptureAt: iso(1), capturesToday: 312, lastApp: "Slack" };
      return s;
    }
    case "set_attention_paused":
      return null;
    case "check_permissions":
      return { ...perms };
    case "open_permission_settings": {
      // simulate the user granting it in System Settings a moment later
      const k = args.kind === "input" ? "inputMonitoring" : (args.kind as "microphone" | "accessibility" | "screen");
      // a stale switch doesn't take until it's reset
      if (k === "accessibility" && perms.accessibilityStale) return null;
      setTimeout(() => {
        perms[k] = true;
        // the backend starts the Flo key listener on its own once Accessibility lands
        if (k === "accessibility") perms.hotkeyActive = true;
      }, 1500);
      return null;
    }
    case "reset_accessibility":
      perms.accessibilityStale = false;
      setTimeout(() => {
        perms.accessibility = true;
        perms.hotkeyActive = true;
      }, 1500);
      return null;
    case "close_permission_guide":
      return null;
    case "restart_app":
      perms.hotkeyActive = perms.accessibility;
      (window as any).__floRestarted = ((window as any).__floRestarted ?? 0) + 1;
      return null;
    case "check_update": {
      // tests (or a demo) publish a release with window.__floMockRelease = {version, notes}
      const rel = (window as any).__floMockRelease as { version: string; notes?: string } | undefined;
      const ready = !!(window as any).__floUpdateReady;
      return { available: !!rel, current: "0.1.0", version: rel?.version ?? null, notes: rel?.notes ?? null, date: null, ready };
    }
    case "install_update": {
      const rel = (window as any).__floMockRelease as { version: string; notes?: string } | undefined;
      if (!rel) throw "Flo is already up to date";
      const total = 18_000_000;
      for (let i = 1; i <= 6; i++) {
        await new Promise((r) => setTimeout(r, 120));
        mockEmit(EV.update, { phase: "downloading", downloaded: Math.round((total * i) / 6), total });
      }
      (window as any).__floUpdateReady = true;
      mockEmit(EV.update, { phase: "ready", version: rel.version });
      return { available: true, current: "0.1.0", version: rel.version, notes: rel.notes ?? null, date: null, ready: true };
    }
    case "fix_fn_key":
      return null;
    case "list_claude_events":
      return claudeEvents.slice(0, args.limit ?? 50).map((e) => ({ ...e }));
    case "mark_claude_seen":
      claudeEvents.forEach((e) => {
        if (!args.id || e.id === args.id) e.seen = true;
      });
      mockEmit(EV.claude, null);
      return null;
    case "repair_permissions":
      return null;
    case "list_integrations":
      return integrations.map((i) => ({ ...i }));
    case "install_integration":
    case "uninstall_integration": {
      const it = integrations.find((i) => i.id === args.id);
      if (it) {
        if (!it.available) throw new Error(`${it.name} was not found on this Mac`);
        it.installed = cmd === "install_integration";
      }
      return integrations.map((i) => ({ ...i }));
    }
    case "slack_connect":
      if (!String(args.token ?? "").startsWith("xox")) throw new Error("That doesn't look like a Slack token (xoxp-…)");
      slackWho = "Parth Gundaniya · Northwind";
      mockEmit(EV.slack, { connected: true, who: slackWho });
      return slackWho;
    case "slack_oauth_start": {
      // the real app opens this in the browser; finish with __floMock.slackDeepLink()
      await sleep(150);
      slackPending = "st_" + Math.random().toString(36).slice(2, 10);
      const url = `${ACCOUNT_URL}/api/slack/install?state=${slackPending}`;
      openedUrls.push(url);
      return url;
    }
    case "slack_status":
      return slackWho;
    case "slack_disconnect":
      slackWho = null;
      slackRevoked += args.revoke ? 1 : 0;
      mockEmit(EV.slack, { connected: false });
      return null;
    case "slack_sync_now":
      return 3;
    case "confirm_action":
      confirmLog.push({ id: args.id, approve: !!args.approve });
      return args.approve ? "Sent" : "Cancelled";
    case "list_context_docs":
      return contextDocs.map((d) => ({ ...d }));
    case "get_context_doc": {
      const d = contextDocs.find((x) => x.id === args.id);
      if (!d) throw new Error("not found");
      return { doc: { ...d }, content: ctxContent.get(d.id) ?? "" };
    }
    case "add_context_doc": {
      const d = makeDoc(String(args.title || "Untitled"), String(args.content ?? ""));
      contextDocs.unshift(d);
      return { ...d };
    }
    case "update_context_doc": {
      const d = contextDocs.find((x) => x.id === args.id);
      if (!d) throw new Error("not found");
      if (args.title !== undefined) d.title = args.title;
      if (args.enabled !== undefined) d.enabled = args.enabled;
      if (args.pinned !== undefined) d.pinned = args.pinned;
      if (args.content !== undefined) {
        ctxContent.set(d.id, args.content);
        d.chars = args.content.length;
        d.tokens = Math.ceil(args.content.length / 4);
        d.preview = args.content.replace(/\s+/g, " ").trim().slice(0, 160);
      }
      return { ...d };
    }
    case "delete_context_doc": {
      const i = contextDocs.findIndex((x) => x.id === args.id);
      if (i >= 0) contextDocs.splice(i, 1);
      ctxContent.delete(args.id);
      return null;
    }
    case "list_claude_sessions":
      return claudeSessions.map((s) => ({ ...s }));
    case "focus_claude_session":
      return claudeSessions.find((s) => s.sessionId === args.sessionId)?.appBundle ?? "com.googlecode.iterm2";
    case "open_claude_by_session":
    case "dismiss_claude_session": {
      const i = claudeSessions.findIndex((s) => s.sessionId === args.sessionId);
      const s = claudeSessions[i];
      if (i >= 0 && (cmd === "dismiss_claude_session" || s.status !== "working")) claudeSessions.splice(i, 1);
      emitSessions();
      return cmd === "open_claude_by_session" ? (s?.appBundle ?? "") : null;
    }
    case "accept_correction": {
      const e: DictionaryEntry = { id: uid("d"), word: args.heard, replacement: args.corrected };
      dictionary.push(e);
      return e;
    }
    case "undo_correction": {
      for (let i = dictionary.length - 1; i >= 0; i--) {
        if (dictionary[i].word.toLowerCase() === String(args.heard).toLowerCase()) dictionary.splice(i, 1);
      }
      return null;
    }
    case "open_claude_session": {
      const ev = claudeEvents.find((e) => e.id === args.id);
      if (ev) ev.seen = true;
      mockEmit(EV.claude, null);
      return ev?.appBundle ?? "com.microsoft.VSCode";
    }
    case "now_playing":
      return mediaSample();
    case "answer_claude_permission":
      (window as any).__floPermissions = [...((window as any).__floPermissions ?? []), { id: args.id, decision: args.decision }];
      return null;
    case "snooze_todo": {
      const t = todos.find((x) => x.id === args.id);
      if (t) (t as any).remindAt = new Date(Date.now() + Number(args.minutes) * 60_000).toISOString();
      (window as any).__floSnoozed = { id: args.id, minutes: args.minutes };
      return null;
    }
    case "weather":
      return { tempC: 27, code: 2, isDay: true, place: "Ahmedabad" };
    case "media_control":
      emitNowPlaying(mediaControl(String(args.action)));
      return null;
    case "get_volume":
      return mockVolume;
    case "set_volume":
      mockVolume = Math.max(0, Math.min(100, args.level ?? mockVolume));
      return mockVolume;
    case "stop_agent":
      return undefined;
    case "toggle_agent_mode":
      mockAgentMode = !mockAgentMode;
      mockEmit(EV.handsfree, { active: mockAgentMode, phase: "listening", message: mockAgentMode ? null : "Agent mode off." });
      return mockAgentMode;
    case "agent_mode_status":
      return mockAgentMode;
    case "agent_confirm":
      // like the backend: yes → the agent carries on and finishes; no → it stops
      if (args.yes) {
        mockEmit(EV.agent, { kind: "step", text: "Confirmed, continuing" });
        setTimeout(() => mockEmit(EV.agent, { kind: "done", text: "Sent." }), 700);
      } else mockEmit(EV.agent, { kind: "aborted", text: "Cancelled, you said no." });
      if (mockAgentMode) mockEmit(EV.handsfree, { active: true, phase: args.yes ? "acting" : "listening" });
      return true;
    case "claude_hook_status":
      return { ...hook };
    case "install_claude_hook":
      hook.installed = true;
      hook.listening = true;
      return { ...hook };
    case "uninstall_claude_hook":
      hook.installed = false;
      return { ...hook };
    default: {
      // Projects → Code commands live in their own mock (lib/mockCode.ts)
      const r = await codeMock(cmd, args, { projects, emit: mockEmit });
      if (r !== UNHANDLED) return r;
      // presence (Active / Away) + paired phones live in lib/mockPresence.ts
      const pr = await presenceMock(cmd, args, { settings, emit: mockEmit, signedIn: () => account.signedIn });
      if (pr !== UNHANDLED) return pr;
      // auto-continue after a Claude usage limit lives in lib/mockAutoContinue.ts
      const ac = await autoContinueMock(cmd, args, { settings, emit: mockEmit });
      if (ac !== UNHANDLED) return ac;
      // Flo Agent + Hermes live in lib/mockFloAgent.ts
      const fa = await floAgentMock(cmd, args, { emit: mockEmit, listen: mockListen, skills: () => skills, connections: () => connections, secrets: () => keys });
      if (fa !== AGENT_UNHANDLED) return fa;
      console.warn("[mock] unknown command", cmd, args);
      return null;
    }
  }
}

// ── test hook (browser preview only; never loaded inside the app) ──────────────
if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) {
  (window as any).__floMock = {
    emit: mockEmit,
    invoke: mockInvoke,
    claudeSession: mockClaudeSession,
    correction: mockCorrection,
    meetingDetected: mockMeetingDetected,
    resizes: resizeLog,
    calls: callLog,
    /** finish a pending "Continue with Google" like the deep link would */
    completeGoogle: () => {
      account.signedIn = true;
      account.user = DEMO_USER;
      mockEmit("flo://account", { signedIn: true, user: DEMO_USER });
    },
    /** replace the mock's agent sessions (so open / dismiss act on them) and emit the list */
    setSessions: (list: ClaudeSession[]) => {
      claudeSessions.splice(0, claudeSessions.length, ...list);
      emitSessions();
    },
    confirm: mockConfirm,
    permission: mockPermission,
    confirms: confirmLog,
    /** browser opens requested by the app (Connect Slack, …) */
    opened: openedUrls,
    /** simulate flo://slack?code=… arriving (after Connect Slack in the browser) */
    slackDeepLink: mockSlackDeepLink,
    slackRevoked: () => slackRevoked,
    /** now playing: "spotify" | "youtube" | "paused" | "none" | a NowPlaying | null → emits EV.nowPlaying */
    setNowPlaying: (v: unknown) => emitNowPlaying(mediaSet(v as never)),
  };
}
