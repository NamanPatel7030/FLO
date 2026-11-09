import type { AvatarSettings } from "./notchling";
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

export type SttProvider = "local" | "openai" | "groq" | "sarvam";
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
export type KeyProvider = "openai" | "anthropic" | "gemini" | "groq" | "openrouter" | "slack" | "minimax" | "qwen" | "ollama_cloud" | "hermes_slack_bot" | "hermes_slack_app" | "sarvam";

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
  /** with language "auto": only these are considered (default en, hi, gu) */
  autoLanguages?: string[];
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
  /** hover panels size: small | big | bigger | biggest */
  notchSize?: NotchSize;
  soundPack?: "chime" | "glass" | "soft" | "pop";
  /** 0–100 */
  soundVolume?: number;
  /** chime when a reminder / Claude card appears */
  notifySound?: boolean;
  /** per-sound style; empty/missing = soundPack */
  soundStart?: string;
  soundStop?: string;
  soundNotify?: string;
  startSoundOn?: boolean;
  stopSoundOn?: boolean;
  /** macOS banners for reminders (the notch card shows either way) */
  systemNotifications?: boolean;
  /** answer Claude Code's permission prompts (Allow / Deny) from the notch */
  claudeApprovals?: boolean;
  /** resume a Claude Code session by itself once its usage limit resets (default off) */
  claudeAutoContinue?: boolean;
  /** what the resumed session is told */
  claudeContinuePrompt?: string;
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
  /** "active" (at the Mac) | "away" (phone gets notifications). Change it with set_presence, not save_settings. */
  presence?: PresenceStatus;
  /** go Away automatically when the screen locks or after `autoAwayMinutes` idle (macOS) */
  autoAway?: boolean;
  autoAwayMinutes?: number;
  /** Notchling, Flo's mascot in the notch (Settings → Appearance) */
  avatar?: AvatarSettings;
  /** "Sync your data" (end-to-end encrypted). Change it with the sync_* commands, not save_settings. */
  sync?: SyncSettings;
  /** minutes the on-device speech model stays loaded after the last dictation (0 = unload) */
  sttKeepWarmMins?: number;
  /** answer an identical question from a 10-minute cache */
  reuseAnswers?: boolean;
}

// ── sync your data (src-tauri/src/sync.rs, website/app/api/sync) ────────────
export type SyncCategory = "todos" | "notes" | "settings" | "history";
export interface SyncSettings {
  enabled: boolean;
  categories: SyncCategory[];
}
export interface SyncStatus {
  enabled: boolean;
  categories: SyncCategory[];
  /** this Mac holds the sync key (Keychain) */
  hasKey: boolean;
  running: boolean;
  lastSync?: string | null;
  lastError?: string | null;
  /** rows this Mac has in sync */
  syncedItems: number;
}
export interface SyncEnableResult {
  enabled: boolean;
  /** shown once, the first time Sync is turned on */
  recoveryKey?: string | null;
  /** this account already syncs from another Mac: ask for its recovery key */
  needsRecoveryKey: boolean;
}
export interface SyncReport {
  pulled: number;
  pushed: number;
  skipped: number;
}

// ── presence + phone relay (src-tauri/src/push.rs, docs/mobile-api.md) ──────
export type PresenceStatus = "active" | "away";
/** get_presence / set_presence and the EV.presence payload */
export interface PresenceInfo {
  status: PresenceStatus;
  /** signed in to a Flo account, so Away can reach a phone */
  signedIn: boolean;
  /** went Away by itself (screen lock / idle) */
  auto: boolean;
}
/** pair_phone_start: show a QR of `payload` + the code */
export interface PairCode {
  /** "483 920" */
  code: string;
  /** "flo-pair://<host>/<digits>" */
  payload: string;
  expiresAt: string;
}
export interface PhoneDevice {
  id: string;
  name: string;
  platform: string;
  lastSeen: string;
}
export interface PushResult {
  stored: boolean;
  pushed: number;
  reason?: string;
}

export type ThemeMode = "dark" | "light" | "system";
export type NotchSize = "small" | "big" | "bigger" | "biggest";
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
  | "constellation"
  | "helix"
  | "neon"
  | "sparkle"
  | "equalizer";

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
  | { type: "slack_send"; to: string; text: string }
  /** "connect to Mobbin MCP": opens Flo Agent > Apps with the Add MCP server form filled in */
  | { type: "connect_mcp"; name: string; url?: string };

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

/** How a meeting was recorded and which speakers Flo can remember by voice. */
export interface MeetingInfo {
  /** "mic+call" = your mic as "You" + the call's audio (others); "mic" = microphone only */
  capture: "mic+call" | "mic" | string;
  /** why call audio wasn't captured, or a warning about it */
  captureNote?: string;
  /** speaker labels with a stored voice (renaming them teaches Flo the voice) */
  voiced: string[];
  /** "Speaker 2" → "Riya": names the conversation revealed (confirm with one click) */
  suggestions?: Record<string, string>;
  /** every voice Flo remembers (rename autocomplete) */
  knownVoices?: string[];
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
  /** when Flo will remind you (5 minutes before a timed due date, or after a snooze) */
  remindAt?: string;
  confidence?: number;
  createdAt: string;
  completedAt?: string;
}

/** Something you taught Flo once and invoke by voice. */
export interface Skill {
  id: string;
  name: string;
  /** comma-separated phrases that invoke it */
  triggers: string;
  instructions: string;
  platforms: string[];
  /** write = compose into the focused field · do = operate the screen */
  mode: "write" | "do";
  enabled: boolean;
  uses: number;
  createdAt: string;
  /** the canvas it was built on (JSON of nodes + edges) */
  graph?: string;
  /** MCP servers / custom platforms it uses ("doc:<id>" = an attached knowledge doc) */
  connections?: string[];
  /** 5-field cron ("0 9 * * 1-5"): it also runs on its own at these local times */
  schedule?: string | null;
  /** when it last ran on its schedule / via Run now (RFC3339) */
  lastRun?: string | null;
}

/** A skill drafted by "Build with AI" (generate_skill_graph): the canvas lays nodes out from it. */
export interface GeneratedSkill {
  name: string;
  triggers: string[];
  schedule?: string | null;
  /** in run order */
  steps: string[];
  /** built-in platform ids or custom-platform connection ids */
  platforms: string[];
  /** MCP server connection ids */
  mcp: string[];
  /** "doc:<id>" */
  knowledge: string[];
  mode: "write" | "do";
  /** things to set up, names the AI used that don't exist… */
  notes: string[];
}

/** A custom platform or MCP server the user added (Skills → Connections). */
export interface Connection {
  id: string;
  name: string;
  kind: "platform" | "mcp";
  /** mcp: stdio = a local command · http = a URL */
  transport: "stdio" | "http";
  command: string;
  args: string[];
  url: string;
  /** stdio: environment variables · http: request headers */
  env: Record<string, string>;
  description: string;
  enabled: boolean;
  createdAt: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: unknown;
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
  /** who the project is for */
  client?: string;
  /** contact person, email, phone, website… */
  clientDetails?: string;
  /** comma-separated words that mean this project; captured items mentioning them are filed here */
  keywords?: string;
  /** linked code (see lib/code.ts): GitHub URL / git remote */
  repoUrl?: string;
  /** linked code: absolute local folder */
  localPath?: string;
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

/** limit / resumed: one-off notch cards from auto-continue (autocontinue.rs), never stored */
export type ClaudeEventKind = "stop" | "notification" | "subagent_stop" | "limit" | "resumed";

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
  /** slack = a drafted message to send · claude = a Claude Code permission prompt */
  kind: "slack" | "claude";
  title: string;
  body: string;
  // claude permission prompts: who is asking (all optional; older backends send title/body only)
  /** Claude Code session id (focus its window with focus_claude_session) */
  sessionId?: string;
  /** the session's working folder */
  cwd?: string;
  /** folder name, e.g. "blog-100-plan" */
  project?: string;
  /** Claude Code tool: "Bash", "Edit", "Write", "WebFetch", "mcp__server__tool", … */
  tool?: string;
  /** terminal / editor the session runs in (name or bundle id), when known */
  app?: string | null;
  /** RFC 3339 time the question was asked */
  at?: string;
}

/** Flo noticed you corrected a word it typed. */
export interface CorrectionEvent {
  id: string;
  /** what Flo typed */
  heard: string;
  /** what you changed it to */
  corrected: string;
  app: string;
  /** Flo already saved it to the dictionary (the card offers Undo) */
  saved?: boolean;
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

export interface NowPlaying {
  app: string;
  title: string;
  artist: string;
  album: string;
  playing: boolean;
  /** seconds into the track when it was sampled (see elapsedAt) */
  elapsed?: number;
  /** source app bundle id, e.g. "com.spotify.client", "com.google.Chrome" */
  bundleId?: string;
  /** track length in seconds (absent for live streams / unknown) */
  duration?: number;
  /** unix ms when `elapsed` was sampled; interpolate locally while playing */
  elapsedAt?: number;
  /** album art / video thumbnail as a data: URL */
  artwork?: string | null;
  /** the source app's icon as a data: URL (fallback when there's no artwork) */
  appIcon?: string | null;
}

export interface Weather {
  tempC: number;
  /** WMO weather-interpretation code */
  code: number;
  isDay: boolean;
  place: string;
}

/** Event names (Rust emits these to all windows) */
export const EV = {
  /** in-app updates: {phase: available|downloading|ready|error, ...} */
  update: "flo://update",
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
  /** a to-do's reminder fired (5 min before it's due, or after a snooze) */
  reminder: "flo://reminder",
  /** backend cursor tracking for the island: {inside: boolean} */
  hover: "flo://hover",
  /** payload: ClaudeSession[] (full current list, not dismissed) */
  claudeSessions: "flo://claude-sessions",
  correction: "flo://correction",
  meetingDetected: "flo://meeting-detected",
  /** payload: ConfirmEvent — show Send / Cancel; answer with confirm_action */
  confirm: "flo://confirm",
  /** a confirm card was answered elsewhere or timed out → close it */
  confirmDone: "flo://confirm-done",
  /** settings changed outside the settings window (the paired phone) → re-read them */
  settingsChanged: "flo://settings-changed",
  /** payload: {signedIn, user?} — e.g. after Google sign-in completes via flo:// deep link */
  account: "flo://account",
  /** payload: SlackEvent — Slack connected (flo://slack deep link / token) or disconnected */
  slack: "flo://slack",
  /** payload: {kind: "start"|"step"|"confirm"|"done"|"aborted"|"error", text, voice?} — computer-control agent */
  agent: "flo://agent",
  /** payload: HandsfreeEvent — hands-free agent mode (double-tap fn) */
  handsfree: "flo://handsfree",
  /** payload: PresenceInfo — Active / Away changed (any window, auto-away, or the phone) */
  presence: "flo://presence",
  /** payload: NowPlaying | null — media started / changed / paused / stopped (polling is the fallback) */
  nowPlaying: "flo://now-playing",
} as const;

/** EV.slack payload. `who` = "user · workspace" (same as slack_status). */
export interface SlackEvent {
  connected: boolean;
  who?: string;
  error?: string;
}

/** Hands-free agent mode: what it's doing and the last request it heard. */
export interface HandsfreeEvent {
  active: boolean;
  phase: "listening" | "thinking" | "acting" | "confirming";
  heard?: string | null;
  /** said while the agent was busy; runs next */
  queued?: string | null;
  message?: string | null;
}

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
 *  slack_connect({token}) -> string ("Name · workspace")   slack_status() -> string|null   slack_disconnect({revoke?})
 *  slack_oauth_start() -> string (Connect URL, opened in the browser; finishes via flo://slack → EV.slack)
 *  slack_sync_now() -> number (to-dos added)   confirm_action({id, approve}) -> string
 *  list_context_docs() -> ContextDoc[]          get_context_doc({id}) -> {doc: ContextDoc, content: string}
 *  add_context_doc({title, content}) -> ContextDoc   (frontend reads .md/.txt files via FileReader)
 *  update_context_doc({id, title?, enabled?, pinned?, content?})   delete_context_doc({id})
 *  open_claude_session({id}) -> string   — focus the editor/terminal running that session (marks seen)
 */

/** What the update server said (check_update / install_update). */
export interface UpdateInfo {
  available: boolean;
  current: string;
  version: string | null;
  notes: string | null;
  date: string | null;
  /** downloaded and installed; a restart switches to it */
  ready: boolean;
}

export type UpdateEvent =
  | { phase: "available"; version: string; notes?: string | null }
  | { phase: "downloading"; downloaded: number; total?: number | null }
  | { phase: "ready"; version: string }
  | { phase: "error"; message: string };
