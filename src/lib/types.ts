// ─────────────────────────────────────────────────────────────────────────────
// Flo Flow IPC contract. Mirrors src-tauri/src/model.rs (serde camelCase).
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
  | "openrouter";

/** Providers whose API key lives in the OS keychain. */
export type KeyProvider = "openai" | "anthropic" | "gemini" | "groq" | "openrouter";

export interface Settings {
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
}

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
  | { type: "insert_text"; text: string };

export interface AssistantResponse {
  id: string;
  query: string;
  reply: string;
  actions: AssistantAction[];
  /** human readable results of executed actions */
  results: string[];
  createdAt: string;
}

export interface MeetingSegment {
  /** seconds from meeting start */
  t: number;
  text: string;
}

export interface MeetingEvent {
  noteId: string;
  segment?: MeetingSegment;
  summary?: string;
  elapsedSec: number;
  live: boolean;
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
}

export interface ClaudeHookStatus {
  installed: boolean;
  /** settings.json that contains (or would contain) the hook */
  configPath: string;
  port: number;
  listening: boolean;
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
} as const;

/**
 * Tauri commands (snake_case names, camelCase args):
 *  get_settings() -> Settings            save_settings({settings})
 *  set_api_key({provider,key})           has_api_key({provider}) -> bool
 *  delete_api_key({provider})            test_llm() -> string
 *  get_island_geometry() -> IslandGeometry
 *  island_resize({width,height})         open_dashboard({route?})
 *  start_session({mode})                 stop_session()       cancel_session()
 *  ask_assistant({text}) -> AssistantResponse
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
 *  check_permissions() -> {microphone,accessibility,screen: boolean}
 *  open_permission_settings({kind})
 *  fix_fn_key()  — macOS: set "Press 🌐 key to: Do Nothing" so Fn is free for Flo
 *  list_claude_events({limit}) -> ClaudeEvent[]   mark_claude_seen({id?})  (no id = all)
 *  claude_hook_status() -> ClaudeHookStatus
 *  install_claude_hook() -> ClaudeHookStatus      uninstall_claude_hook() -> ClaudeHookStatus
 */
