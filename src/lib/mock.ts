// In-browser mock backend so the full UI runs with `npm run dev` outside Tauri.
import type {
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
  TodoStatus,
} from "./types";
import { EV } from "./types";
import { countWords } from "./format";

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
  sttProvider: "local",
  sttModel: "large-v3-turbo-q5_0",
  language: "auto",
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
  typingWpm: 40,
  userName: "Parth",
};

const keys = new Set<string>(["groq"]);

const projectsBase: Omit<Project, "openTodos" | "doneTodos">[] = [
  { id: "p_apollo", name: "Apollo", description: "Client dashboard redesign for Northwind", status: "active", color: "#3dbbff", lastNote: "Design sync — agreed on glass cards", updatedAt: iso(40) },
  { id: "p_hermes", name: "Hermes API", description: "Payments gateway v2 migration", status: "blocked", color: "#1a9be0", lastNote: "Waiting on Stripe webhook keys", updatedAt: iso(300) },
  { id: "p_flo", name: "Flo", description: "Local-first voice assistant", status: "active", color: "#f59e0b", lastNote: "Notch island prototype done", updatedAt: iso(10) },
];
const projects = new Map(projectsBase.map((p) => [p.id, { ...p }]));

const todos: Todo[] = [
  { id: "t1", title: "Reply to Rahul about the invoice", reason: "Rahul asked “can you confirm the invoice by today?”", person: "Rahul", app: "Slack", source: "attention", status: "open", confidence: 0.92, createdAt: iso(25) },
  { id: "t2", title: "Send Apollo deck to Northwind", source: "voice", status: "open", projectId: "p_apollo", due: inDays(2), createdAt: iso(120) },
  { id: "t3", title: "Review PR #482 — notch window positioning", app: "GitHub", source: "attention", status: "open", reason: "You were requested as reviewer", confidence: 0.81, createdAt: iso(70), projectId: "p_flo" },
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

const notes: Note[] = [
  {
    id: "n1",
    title: "Design sync — Apollo",
    kind: "meeting",
    projectId: "p_apollo",
    durationSec: 1840,
    createdAt: iso(180),
    live: false,
    summary:
      "Team agreed to move the Apollo dashboard to glass cards with a violet→cyan accent. Ana owns the component library; launch target is the 20th. Open question: dark-mode contrast for charts.",
    actionItems: ["Ana to finalize component library by Monday", "Send updated deck to Northwind", "Check chart contrast in dark mode"],
    transcript: [
      { t: 4, text: "Okay, let's start with the dashboard cards." },
      { t: 31, text: "I like the frosted look, it feels much lighter than the old one." },
      { t: 88, text: "Ana, can you own the component library?" },
      { t: 95, text: "Yes, I can have it by Monday." },
      { t: 160, text: "We should double-check contrast for the charts in dark mode." },
      { t: 240, text: "Launch target is still the twentieth." },
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
  { id: "parakeet-tdt-0.6b-v3", label: "Parakeet v3 — fastest", sizeMb: 640, languages: "English + 24 EU", installed: false },
  { id: "large-v3-turbo-q5_0", label: "Whisper Large v3 Turbo", sizeMb: 574, languages: "99 languages", installed: true },
  { id: "small-q5_1", label: "Whisper Small — light", sizeMb: 190, languages: "99 languages", installed: false },
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
    reply: "Only Hermes API is blocked — it's waiting on Stripe webhook keys from Priya. Apollo and Flo are on track.",
    actions: [],
    results: [],
    createdAt: iso(90),
  },
  {
    id: "a2",
    query: "Add a to-do to Apollo: send the deck by Friday",
    reply: "Added to Apollo, due Friday.",
    actions: [{ type: "add_todo", title: "Send Apollo deck to Northwind", project: "Apollo", due: inDays(2) }],
    results: ["✓ To-do added to Apollo"],
    createdAt: iso(120),
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
  { sessionId: "s1", project: "Flo", cwd: "/Users/parth/Flo", status: "done", message: "Built the notch tray and correction card — all 34 tests pass.", updatedAt: iso(3), appBundle: "com.microsoft.VSCode" },
  { sessionId: "s2", project: "hermes-api", cwd: "/Users/parth/hermes-api", status: "needs_approval", message: "Claude needs your permission to run `npm publish`.", updatedAt: iso(9), appBundle: "com.googlecode.iterm2" },
  { sessionId: "s4", project: "apollo-web", cwd: "/Users/parth/apollo-web", status: "working", message: "Refactoring chart components…", updatedAt: iso(1), appBundle: "com.todesktop.230313mzl4w4u92" },
];
const emitSessions = () => mockEmit(EV.claudeSessions, claudeSessions.map((s) => ({ ...s })));

/** Demo: a session asks for a reply. */
export function mockClaudeSession(status: ClaudeSession["status"] = "waiting_reply", project = "job-finder", message = "Which job boards should I scrape next — LinkedIn or Wellfound?") {
  const existing = claudeSessions.find((s) => s.project === project);
  if (existing) Object.assign(existing, { status, message, updatedAt: new Date().toISOString() });
  else claudeSessions.unshift({ sessionId: uid("s"), project, cwd: `/Users/parth/${project}`, status, message, updatedAt: new Date().toISOString() });
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
export function mockClaudeEvent(kind: ClaudeEvent["kind"] = "stop", project = "Flo", message = "Built the island UI — all tests pass.") {
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
  "Alright, let's kick off — first item is the launch checklist.",
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
  meetingTimer = setInterval(() => {
    if (!liveNote) return;
    const elapsedSec = Math.round((Date.now() - t0) / 1000);
    liveNote.durationSec = elapsedSec;
    const seg = { t: elapsedSec, text: MEETING_LINES[i % MEETING_LINES.length] };
    liveNote.transcript.push(seg);
    i++;
    if (i % 3 === 0)
      liveNote.summary = `Discussed launch checklist and the notch animation. Windows positioning still needs testing; release notes have an owner.`;
    mockEmit(EV.meeting, { noteId: liveNote.id, segment: seg, summary: liveNote.summary || undefined, elapsedSec, live: true });
  }, 2500);
  return liveNote;
}

function stopMockMeeting(): Note | null {
  if (meetingTimer) clearInterval(meetingTimer);
  meetingTimer = null;
  stopLevels();
  const n = liveNote;
  if (n) {
    n.live = false;
    n.summary ||= "Short meeting — no major decisions captured.";
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

function fakeAssistant(text: string): AssistantResponse {
  const q = text.toLowerCase();
  const res: AssistantResponse = { id: uid("a"), query: text, reply: "", actions: [], results: [], createdAt: new Date().toISOString() };
  const proj = [...projects.values()].find((p) => q.includes(p.name.toLowerCase()));
  if (q.includes("to-do") || q.includes("todo") || q.startsWith("add") || q.includes("remind")) {
    const title = text.replace(/.*?(to-?do( to \w+)?|remind me to)[:,]?\s*/i, "").replace(/^./, (c) => c.toUpperCase()) || text;
    const t: Todo = { id: uid("t"), title, source: "assistant", status: "open", projectId: proj?.id, createdAt: res.createdAt };
    todos.unshift(t);
    res.actions.push({ type: "add_todo", title, project: proj?.name });
    res.results.push(`✓ To-do added${proj ? ` to ${proj.name}` : ""}`);
    res.reply = `Got it — “${title}” is on your list${proj ? ` under ${proj.name}` : ""}.`;
    mockEmit(EV.todos, {});
  } else if (q.includes("meeting")) {
    const title = text.replace(/.*meeting notes( for)?/i, "").trim() || "Meeting notes";
    startMockMeeting(title, proj?.id);
    res.actions.push({ type: "start_meeting", title });
    res.results.push("● Recording meeting notes");
    res.reply = `Started meeting notes for “${title}”. I'll summarize live.`;
  } else if (q.includes("blocked") || q.includes("status") || q.includes("projects")) {
    const lines = [...projects.values()].map((p) => `${p.name}: ${p.status}`);
    res.reply = `Here's where things stand — ${lines.join(" · ")}. Hermes is waiting on Stripe keys.`;
  } else {
    res.reply = "I'm running in demo mode. Connect a model in Settings → AI and I'll answer for real.";
  }
  assistantLog.unshift(res);
  return res;
}

// ── invoke dispatcher ───────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const perms = { microphone: true, accessibility: true, inputMonitoring: false, screen: false, hotkeyActive: false };

export async function mockInvoke(cmd: string, args: Record<string, any> = {}): Promise<unknown> {
  switch (cmd) {
    case "get_settings":
      return { ...settings };
    case "save_settings":
      Object.assign(settings, args.settings);
      return null;
    case "set_api_key":
      keys.add(args.provider);
      return null;
    case "has_api_key":
      return keys.has(args.provider);
    case "delete_api_key":
      keys.delete(args.provider);
      return null;
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
    case "open_dashboard":
      return null;
    case "start_session":
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
    case "cancel_session":
      stopLevels();
      mockEmit(EV.state, { phase: "idle", mode: sessionMode });
      return null;
    case "ask_assistant": {
      await sleep(700);
      const r = fakeAssistant(args.text);
      mockEmit(EV.assistant, r);
      return r;
    }
    case "list_assistant":
      return [...assistantLog];
    case "list_history":
      return history.slice(0, args.limit ?? 100);
    case "get_analytics":
      return buildAnalytics(args.days ?? 30);
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
      const p = { id: uid("p"), name: args.name, description: args.description, status: "active" as const, color: palette[projects.size % palette.length], updatedAt: new Date().toISOString() };
      projects.set(p.id, p);
      mockEmit(EV.projects, {});
      return projectView(p);
    }
    case "update_project": {
      const p = projects.get(args.id);
      if (p) {
        for (const k of ["name", "description", "status"] as const) if (args[k] !== undefined) (p as any)[k] = args[k];
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
      setTimeout(() => {
        perms[k] = true;
      }, 1500);
      return null;
    }
    case "restart_app":
      perms.hotkeyActive = perms.accessibility && perms.inputMonitoring;
      return null;
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
    case "list_claude_sessions":
      return claudeSessions.map((s) => ({ ...s }));
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
    case "open_claude_session": {
      const ev = claudeEvents.find((e) => e.id === args.id);
      if (ev) ev.seen = true;
      mockEmit(EV.claude, null);
      return ev?.appBundle ?? "com.microsoft.VSCode";
    }
    case "claude_hook_status":
      return { ...hook };
    case "install_claude_hook":
      hook.installed = true;
      hook.listening = true;
      return { ...hook };
    case "uninstall_claude_hook":
      hook.installed = false;
      return { ...hook };
    default:
      console.warn("[mock] unknown command", cmd, args);
      return null;
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
  };
}
