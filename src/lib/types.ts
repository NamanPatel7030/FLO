// ─────────────────────────────────────────────────────────────────────────────
// Flo IPC contract. Mirrors src-tauri/src/model.rs (serde camelCase).
// Any change here MUST be mirrored in Rust.
// ─────────────────────────────────────────────────────────────────────────────

export type Platform = "macos" | "windows" | "linux";

export type Mode = "dictation" | "assistant" | "meeting";

export type Phase =
  | "idle"
  | "listening" // mic open
  | "transcribing" // STT running
  | "thinking" // LLM running
  | "done" // short success flash
  | "error";

export type SttProvider = "local" | "openai" | "groq";
export type LlmProvider =
  | "none"
  | "ollama"
  | "lmstudio"
  | "openai"
  | "anthropic"
  | "gemini"
  | "groq"
  | "openrouter"
  | "minimax"
  | "qwen"
  /** Ollama's hosted models (ollama.com, API key) — local Ollama is "ollama" */
  | "ollama_cloud";

/** Providers whose API key lives in the OS keychain. */
export type KeyProvider = "openai" | "anthropic" | "gemini" | "groq" | "openrouter" | "slack" | "minimax" | "qwen" | "ollama_cloud";

/** Modifier combo for push-to-talk (macOS). Any other key pressed while holding cancels. */
export type HotkeyCombo = "fn" | "ctrl" | "alt" | "fn+ctrl" | "ctrl+alt" | "cmd+alt" | "fn+shift";

export interface Settings {
  /** hold to dictate (default "ctrl") */
  hotkeyDictation: HotkeyCombo;
  /** hold for the assistant (default "fn") */
  hotkeyAssistant: HotkeyCombo;
  /** notice Zoom/Meet/Teams/Slack/FaceTime calls and offer to take notes */
  meetingDetection: boolean;
  /** watch for your fixes after a paste and suggest dictionary entries */
  learnCorrections: boolean;
  /** your own instructions (tone, who you are, how to reply) — added to assistant + meeting prompts;
   *  also to dictation cleanup when ≤ 300 chars */
  systemPrompt: string;
  /** turn unanswered Slack DMs / mentions into to-dos (when connected) */
  slackSync: boolean;
  /** first-run setup wizard completed */
  onboarded: boolean;
  /** Flo account server (sign-in only; data stays on the Mac) */
  accountUrl: string;
  /** cached signed-in user (offline start) */
  accountUser?: AccountUser | null;
  sttProvider: SttProvider;
  /** local: model id e.g. "large-v3-turbo-q5_0"; cloud: model name e.g. "whisper-large-v3-turbo" */
  sttModel: string;
  /** ISO code or "auto" */
  language: string;
  llmProvider: LlmProvider;
  llmModel: string;
  /** Base URL for ollama / lmstudio */
  localLlmUrl: string;
  /** Clean up dictation with the LLM (fillers, punctuation, formatting) */
  cleanupEnabled: boolean;
  /** Allow Assistant to send selected text / screenshot to a cloud LLM */
  assistantCloudAllowed: boolean;
  /** Assistant may include a screenshot of the active window */
  assistantScreenContext: boolean;
  attentionEnabled: boolean;
  attentionIntervalSec: number;
  /** App names Attention must never capture */
  attentionDenylist: string[];
  /** Allow Attention text (never images) to reach a cloud LLM. Default false. */
  attentionCloudAllowed: boolean;
  playSounds: boolean;
  /** Typing speed used for "time saved" analytics */
  typingWpm: number;
  userName: string;
  /** "dark" | "light" | "system" */
  theme: ThemeMode;
  /** accent hex, e.g. "#3dbbff" */
  accent: string;
  /** notch animation style */
  notchStyle: NotchStyle;
  /** two-stop gradient [from, to] for the notch; empty = derive from accent */
  notchGradient: string[];
}

export type ThemeMode = "dark" | "light" | "system";
export type NotchStyle =
  | "ribbon"
  | "wave"
  | "bars"
  | "pulse"
  | "orb"
  | "aurora"
  | "spectrum"
  | "comet"
  | "ripple"
  | "liquid"
  | "constellation";

/** Built-in accent presets (name → hex); users can also pick a custom hex. */
export const ACCENT_PRESETS: { name: string; accent: string; gradient: [string, string] }[] = [
  { name: "Sky", accent: "#3dbbff", gradient: ["#1a9be0", "#66ceff"] },
  { name: "Aqua", accent: "#22d3ee", gradient: ["#0891b2", "#67e8f9"] },
  { name: "Violet", accent: "#8b5cf6", gradient: ["#6d28d9", "#a78bfa"] },
  { name: "Emerald", accent: "#10b981", gradient: ["#059669", "#34d399"] },
  { name: "Sunset", accent: "#fb7185", gradient: ["#f43f5e", "#fda4af"] },
  { name: "Amber", accent: "#f59e0b", gradient: ["#d97706", "#fbbf24"] },
];

export interface IslandGeometry {
  platform: Platform;
  hasNotch: boolean;
  /** logical px */
  notchWidth: number;
  notchHeight: number;
  screenWidth: number;
}

export interface StateEvent {
  phase: Phase;
  mode: Mode;
  message?: string;
}

export interface LevelEvent {
  /** 0..1 smoothed RMS */
  rms: number;
}

export interface TranscriptEvent {
  text: string;
  final: boolean;
}

export type ProjectStatus = "active" | "paused" | "blocked" | "done";

export type AssistantAction =
  | { type: "add_todo"; title: string; project?: string; due?: string }
  | { type: "complete_todo"; match: string }
  | { type: "create_project"; name: string; description?: string }
  | { type: "set_project_status"; project: string; status: ProjectStatus }
  | { type: "add_project_note"; project: string; text: string }
  | { type: "start_meeting"; title?: string; project?: string }
  | { type: "stop_meeting" }
  | { type: "open_url"; url: string }
  | { type: "open_app"; name: string }
  | { type: "insert_text"; text: string }
  /** staged — the user confirms in the notch (flo://confirm) before sending */
  | { type: "slack_send"; to: string; text: string };

export type AssistantMode = "quick" | "deep" | "web";

export interface AssistantResponse {
  id: string;
  query: string;
  /** markdown; long in deep/web mode */
  reply: string;
  actions: AssistantAction[];
  /** human readable results of executed actions */
  results: string[];
  createdAt: string;
  mode: AssistantMode;
  /** web sources (web mode) */
  sources?: { title: string; url: string }[];
}

export interface MeetingSegment {
  /** seconds from meeting start */
  t: number;
  text: string;
  /** who said it ("You" for your mic, "Others"/name when call audio is captured) */
  speaker?: string;
}

export interface MeetingEvent {
  noteId: string;
  segment?: MeetingSegment;
  summary?: string;
  elapsedSec: number;
  live: boolean;
  /** live, still-changing line while someone is talking (cleared/replaced by the next segment) */
  partial?: string;
}

export interface ModelProgressEvent {
  id: string;
  received: number;
  total: number;
  done: boolean;
  error?: string;
}

export interface ToastEvent {
  kind: "info" | "success" | "error";
  text: string;
}

export interface Dictation {
  id: string;
  createdAt: string;
  app: string;
  mode: Mode;
  rawText: string;
  finalText: string;
  words: number;
  durationMs: number;
  latencyMs: number;
}

export type TodoSource = "voice" | "assistant" | "attention" | "meeting" | "manual";
export type TodoStatus = "open" | "done" | "snoozed" | "dismissed";

export interface Todo {
  id: string;
  title: string;
  reason?: string;
  person?: string;
  app?: string;
  source: TodoSource;
  status: TodoStatus;
  projectId?: string;
  due?: string;
  confidence?: number;
  createdAt: string;
  completedAt?: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  color: string;
  openTodos: number;
  doneTodos: number;
  lastNote?: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  title: string;
  kind: "meeting" | "voice" | "project";
  projectId?: string;
  transcript: MeetingSegment[];
  summary: string;
  actionItems: string[];
  durationSec: number;
  createdAt: string;
  live: boolean;
}

export interface DailyStat {
  /** YYYY-MM-DD */
  day: string;
  words: number;
  dictations: number;
  assistant: number;
  meetingMin: number;
  todosDone: number;
}

export interface Analytics {
  totalWords: number;
  totalDictations: number;
  avgWpm: number;
  minutesSaved: number;
  streakDays: number;
  todosOpen: number;
  todosDone: number;
  meetingMinutes: number;
  daily: DailyStat[];
  topApps: { app: string; words: number }[];
  /** 24 buckets of words by hour of day */
  hourly: number[];
}

export interface DictionaryEntry {
  id: string;
  word: string;
  /** optional "heard as" → replacement */
  replacement?: string;
}

export interface NetworkLogEntry {
  at: string;
  host: string;
  purpose: string;
  allowed: boolean;
  bytes: number;
  /** AI tokens sent / received (cloud LLM calls) */
  tokensIn?: number;
  tokensOut?: number;
}

export interface LocalModel {
  id: string;
  label: string;
  sizeMb: number;
  languages: string;
  installed: boolean;
}

export interface AttentionStatus {
  enabled: boolean;
  paused: boolean;
  lastCaptureAt?: string;
  capturesToday: number;
  lastApp?: string;
  /** why Attention is idle although enabled (no allowed AI model) */
  blocked?: string;
}

// ── Claude Code integration ────────────────────────────────────────────────
// Claude Code hooks (Stop / Notification / SubagentStop) POST to Flo's
// localhost-only listener; Flo shows an island reminder + logs the session.

export type ClaudeEventKind = "stop" | "notification" | "subagent_stop";

export interface ClaudeEvent {
  id: string;
  kind: ClaudeEventKind;
  sessionId: string;
  /** basename of cwd, e.g. "Flo" */
  project: string;
  cwd: string;
  /** Notification text, or the last assistant message (truncated) for stop */
  message: string;
  at: string;
  /** user has seen/acknowledged it */
  seen: boolean;
  /** macOS bundle id of the app running the session (com.microsoft.VSCode, com.apple.Terminal…) */
  appBundle?: string;
  /** $TERM_PROGRAM of the session */
  terminal?: string;
}

export interface ClaudeHookStatus {
  installed: boolean;
  /** settings.json that contains (or would contain) the hook */
  configPath: string;
  port: number;
  listening: boolean;
}

export interface Permissions {
  microphone: boolean;
  accessibility: boolean;
  /** Input Monitoring — required for the fn / Right-Ctrl push-to-talk listener */
  inputMonitoring: boolean;
  screen: boolean;
  /** true once the global hotkey listener is actually running */
  hotkeyActive: boolean;
}

// ── Claude Code sessions (notch tray) ──────────────────────────────────────
export type ClaudeStatus = "working" | "done" | "waiting_reply" | "needs_approval";

/** One live Claude Code session, kept in the notch tray until opened/dismissed. */
export interface ClaudeSession {
  sessionId: string;
  project: string;
  cwd: string;
  status: ClaudeStatus;
  /** last assistant line / notification text */
  message: string;
  updatedAt: string;
  appBundle?: string;
  /** which agent: "claude" | "codex" | "cursor" | any webhook source name */
  source: string;
}

/** A connectable tool (Claude Code, Codex CLI, Cursor, generic webhook). */
export interface Integration {
  id: string;
  name: string;
  /** the tool's config folder exists on this machine */
  available: boolean;
  installed: boolean;
  configPath: string;
  note: string;
}

/** Something Flo wants you to approve before it happens (e.g. send a Slack message). */
export interface ConfirmEvent {
  id: string;
  kind: "slack";
  title: string;
  body: string;
}

/** Flo noticed you corrected a word it typed. */
export interface CorrectionEvent {
  id: string;
  /** what Flo typed */
  heard: string;
  /** what you changed it to */
  corrected: string;
  app: string;
}

/** Another app started (active=true) or stopped using the microphone for a call. */
export interface MeetingDetectedEvent {
  app: string;
  active: boolean;
}

/** Backend cursor tracking for the island; x/y are logical px relative to the island window. */
export interface HoverEvent {
  inside: boolean;
  x?: number;
  y?: number;
  /** x offset from the island window's horizontal centre (stable while the window resizes) */
  cx?: number;
}

/** A document in the local context library (uploaded .md/.txt or pasted). */
export interface ContextDoc {
  id: string;
  title: string;
  chars: number;
  /** rough token estimate (chars / 4) */
  tokens: number;
  /** used by the assistant (relevant chunks only) */
  enabled: boolean;
  /** always included (keep pinned docs short) */
  pinned: boolean;
  createdAt: string;
  /** first ~160 chars */
  preview: string;
}

export interface AccountUser {
  id: string;
  email: string;
  name: string;
  image?: string;
}

export interface AccountStatus {
  signedIn: boolean;
  user?: AccountUser;
  accountUrl: string;
  /** token cached but the account server is unreachable */
  offline: boolean;
}

/** Event names (Rust emits these to all windows) */
export const EV = {
  state: "flo://state",
  level: "flo://level",
  transcript: "flo://transcript",
  assistant: "flo://assistant",
  meeting: "flo://meeting",
  todos: "flo://todos-changed",
  projects: "flo://projects-changed",
  notes: "flo://notes-changed",
  modelProgress: "flo://model-progress",
  toast: "flo://toast",
  claude: "flo://claude",
  /** backend cursor tracking for the island: {inside: boolean} */
  hover: "flo://hover",
  /** payload: ClaudeSession[] (full current list, not dismissed) */
  claudeSessions: "flo://claude-sessions",
  correction: "flo://correction",
  meetingDetected: "flo://meeting-detected",
  /** payload: ConfirmEvent — show Send / Cancel; answer with confirm_action */
  confirm: "flo://confirm",
  /** payload: {signedIn, user?} — e.g. after Google sign-in completes via flo:// deep link */
  account: "flo://account",
} as const;

/**
 * Tauri commands (snake_case names, camelCase args):
 *  get_settings() -> Settings            save_settings({settings})
 *  local_models() -> string[]   (pulled Ollama / LM Studio models; error hint when not running)
 *  provider_models({provider}) -> string[]  (live /models list incl. local Ollama pulls; curated fallback)
 *  set_api_key({provider,key})           has_api_key({provider}) -> bool
 *  delete_api_key({provider})            test_llm() -> string
 *  get_island_geometry() -> IslandGeometry
 *  island_resize({width,height})         open_dashboard({route?})
 *  start_session({mode})                 stop_session()       cancel_session()
 *  ask_assistant({text, mode?}) -> AssistantResponse     (mode: quick | deep | web)
 *  assistant_followup({id, mode: "deep"|"web"}) -> AssistantResponse  — re-ask a previous answer
 *     deep = screenshot of the focused window + detailed markdown; web = provider web search + sources
 *     (non-web providers: opens Perplexity and says so)
 *  list_history({limit}) -> Dictation[]  get_analytics({days}) -> Analytics
 *  list_todos() -> Todo[]                add_todo({title,projectId?,due?}) -> Todo
 *  update_todo({id,status?,title?,projectId?})   delete_todo({id})
 *  list_projects() -> Project[]          create_project({name,description?}) -> Project
 *  update_project({id,name?,description?,status?})  delete_project({id})
 *  list_notes() -> Note[]                get_note({id}) -> Note    delete_note({id})
 *  start_meeting({title?,projectId?}) -> Note    stop_meeting() -> Note
 *  list_dictionary() -> DictionaryEntry[]   add_dictionary({word,replacement?})  remove_dictionary({id})
 *  network_log() -> NetworkLogEntry[]
 *  list_models() -> LocalModel[]         download_model({id})   delete_model({id})
 *  attention_status() -> AttentionStatus set_attention_paused({paused})
 *  check_permissions() -> Permissions   (inputMonitoring = fn key listener; poll every 2s on the Permissions tab)
 *  repair_permissions()  — macOS: reset Flo's privacy records (tccutil reset All com.flo.flow) + relaunch
 *  restart_app()  — relaunch Flo (needed after granting Accessibility / Input Monitoring / Screen Recording)
 *  open_permission_settings({kind})
 *  fix_fn_key()  — macOS: set "Press 🌐 key to: Do Nothing" so Fn is free for Flo
 *  list_claude_events({limit}) -> ClaudeEvent[]   mark_claude_seen({id?})  (no id = all)
 *  claude_hook_status() -> ClaudeHookStatus
 *  install_claude_hook() -> ClaudeHookStatus      uninstall_claude_hook() -> ClaudeHookStatus
 *  list_claude_sessions() -> ClaudeSession[]
 *  open_claude_by_session({sessionId}) -> string  — focus its window; removes it from the tray unless still working
 *  dismiss_claude_session({sessionId})
 *  accept_correction({heard, corrected}) -> DictionaryEntry
 *  account_status() -> AccountStatus    account_login({email,password}) -> AccountUser
 *  account_google_start() -> {state} (opens browser)   account_exchange({code, state?}) -> AccountUser
 *  account_logout()      — sessions refuse to start while signed out ("Sign in to Flo…")
 *  list_integrations() -> Integration[]   install_integration({id}) / uninstall_integration({id}) -> Integration[]
 *  slack_connect({token}) -> string ("Name · workspace")   slack_status() -> string|null   slack_disconnect()
 *  slack_sync_now() -> number (to-dos added)   confirm_action({id, approve}) -> string
 *  list_context_docs() -> ContextDoc[]          get_context_doc({id}) -> {doc: ContextDoc, content: string}
 *  add_context_doc({title, content}) -> ContextDoc   (frontend reads .md/.txt files via FileReader)
 *  update_context_doc({id, title?, enabled?, pinned?, content?})   delete_context_doc({id})
 *  open_claude_session({id}) -> string   — focus the editor/terminal running that session (marks seen)
 */
