import type {
  Analytics,
  AssistantMode,
  AssistantResponse,
  AssistantThread,
  AttentionStatus,
  CalendarEvent,
  GoogleCalendar,
  GoogleStatus,
  MeetingAlertAction,
  ClaudeEvent,
  ClaudeHookStatus,
  ClaudeSession,
  ContextDoc,
  Skill,
  GeneratedSkill,
  Connection,
  McpTool,
  Integration,
  Dictation,
  DictionaryEntry,
  IslandGeometry,
  KeyProvider,
  LocalModel,
  Mode,
  NetworkLogEntry,
  Note,
  MeetingInfo,
  Permissions,
  Project,
  ProjectStatus,
  Settings,
  Todo,
  TodoStatus,
} from "./types";
import { mockInvoke, mockListen } from "./mock";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) return (await mockInvoke(cmd, args ?? {})) as T;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Raw command call (for modules that keep their own typed wrappers, e.g. lib/account.ts). */
export const invokeRaw = call;

/** Subscribe to a backend event. Returns an unsubscribe fn (safe to call immediately). */
export function on<T>(event: string, cb: (payload: T) => void): () => void {
  if (!isTauri) return mockListen<T>(event, cb);
  let un: (() => void) | null = null;
  let cancelled = false;
  import("@tauri-apps/api/event").then(({ listen }) =>
    listen<T>(event, (e) => cb(e.payload)).then((u) => {
      if (cancelled) u();
      else un = u;
    }),
  );
  return () => {
    cancelled = true;
    un?.();
  };
}

export type { Permissions };
export type PermissionKind = "microphone" | "accessibility" | "input" | "screen" | "autostart" | "ocr" | "notifications";

export const api = {
  getSettings: () => call<Settings>("get_settings"),
  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),
  setApiKey: (provider: KeyProvider, key: string) => call<void>("set_api_key", { provider, key }),
  hasApiKey: (provider: KeyProvider) => call<boolean>("has_api_key", { provider }),
  deleteApiKey: (provider: KeyProvider) => call<void>("delete_api_key", { provider }),
  testLlm: () => call<string>("test_llm"),
  /** live /models list (local Ollama: pulled models); curated fallback when unreachable */
  providerModels: (provider: string) => call<string[]>("provider_models", { provider }).catch(() => [] as string[]),
  /** pulled local Ollama models ([] = none / not running); null when the backend lacks the command */
  localModels: () => call<string[]>("local_models").catch(() => null),

  getIslandGeometry: () => call<IslandGeometry>("get_island_geometry"),
  islandResize: (width: number, height: number) => call<void>("island_resize", { width, height }),
  /** Windows / Linux: let the island take keyboard focus while the quick note is typed into. */
  islandFocus: (focus: boolean) => call<void>("island_focus", { focus }),
  /** Windows / Linux: drag the pill anywhere (the backend follows the cursor, snaps on drop and
   *  remembers the spot per monitor). No-ops on macOS, where the island hangs from the notch. */
  islandDragStart: () => call<void>("island_drag_start"),
  islandDragMove: () => call<void>("island_drag_move"),
  islandDragEnd: () => call<void>("island_drag_end"),
  openDashboard: (route?: string) => call<void>("open_dashboard", { route }),

  startSession: (mode: Mode) => call<void>("start_session", { mode }),
  stopSession: () => call<void>("stop_session"),
  cancelSession: () => call<void>("cancel_session"),
  /** first-run setup's try-out: keep dictations made in Flo's own window inside Flo (no paste) */
  setSetupCapture: (on: boolean) => call<void>("set_setup_capture", { on }),
  askAssistant: (text: string, mode: AssistantMode = "quick", thread?: { threadId?: string; newThread?: boolean }) =>
    call<AssistantResponse>("ask_assistant", { text, mode, ...(thread ?? {}) }),
  /** re-ask a previous answer: deep = reads the focused window, detailed; web = web search + sources */
  assistantFollowup: (id: string, mode: "deep" | "web") => call<AssistantResponse>("assistant_followup", { id, mode }),
  /** Not in original contract; falls back to [] if backend lacks it. */
  listAssistant: () => call<AssistantResponse[]>("list_assistant").catch(() => [] as AssistantResponse[]),
  /** one page of history, oldest first: the newest `limit` exchanges older than `before` (an id) */
  listAssistantPage: (opts: { threadId?: string; before?: string; limit?: number } = {}) => call<AssistantResponse[]>("list_assistant_page", opts),
  listAssistantThreads: (opts: { limit?: number; query?: string } = {}) => call<AssistantThread[]>("list_assistant_threads", opts),

  listHistory: (limit = 200) => call<Dictation[]>("list_history", { limit }),
  getAnalytics: (days = 30) => call<Analytics>("get_analytics", { days }),

  listTodos: () => call<Todo[]>("list_todos"),
  addTodo: (title: string, projectId?: string, due?: string) => call<Todo>("add_todo", { title, projectId, due }),
  updateTodo: (id: string, patch: { status?: TodoStatus; title?: string; projectId?: string }) =>
    call<Todo>("update_todo", { id, ...patch }),
  deleteTodo: (id: string) => call<void>("delete_todo", { id }),
  /** remind again in `minutes` */
  snoozeTodo: (id: string, minutes: number) => call<void>("snooze_todo", { id, minutes }),

  listProjects: () => call<Project[]>("list_projects"),
  createProject: (name: string, description?: string, client?: { client?: string; clientDetails?: string; keywords?: string }) =>
    call<Project>("create_project", { name, description, ...client }),
  updateProject: (id: string, patch: { name?: string; description?: string; status?: ProjectStatus; client?: string; clientDetails?: string; keywords?: string }) =>
    call<Project>("update_project", { id, ...patch }),
  deleteProject: (id: string) => call<void>("delete_project", { id }),

  listNotes: () => call<Note[]>("list_notes"),
  getNote: (id: string) => call<Note>("get_note", { id }),
  deleteNote: (id: string) => call<void>("delete_note", { id }),
  startMeeting: (title?: string, projectId?: string) => call<Note>("start_meeting", { title, projectId }),
  stopMeeting: () => call<Note>("stop_meeting"),
  /** capture mode + speakers of a meeting (null for notes recorded before speaker support) */
  meetingInfo: (noteId: string) => call<MeetingInfo | null>("meeting_info", { noteId }),
  /** "Speaker 2" → "Rahul" across the note; Flo remembers the voice for next time */
  renameSpeaker: (noteId: string, from: string, to: string) => call<Note>("rename_speaker", { noteId, from, to }),

  listDictionary: () => call<DictionaryEntry[]>("list_dictionary"),
  addDictionary: (word: string, replacement?: string) => call<DictionaryEntry>("add_dictionary", { word, replacement }),
  removeDictionary: (id: string) => call<void>("remove_dictionary", { id }),

  networkLog: () => call<NetworkLogEntry[]>("network_log"),
  listModels: () => call<LocalModel[]>("list_models"),
  downloadModel: (id: string) => call<void>("download_model", { id }),
  deleteModel: (id: string) => call<void>("delete_model", { id }),
  /** load a downloaded speech model into memory; resolves once it's ready to transcribe */
  loadSpeechModel: (id: string) => call<void>("load_speech_model", { id }),
  /** the model setup should get ready: the chosen one if on disk, else the small starter */
  setupSpeechModel: () => call<string>("setup_speech_model"),
  /** deletes every downloaded speech model except the one in use; returns MB freed */
  removeUnusedModels: () => call<number>("remove_unused_models"),

  attentionStatus: () => call<AttentionStatus>("attention_status"),
  setAttentionPaused: (paused: boolean) => call<void>("set_attention_paused", { paused }),
  checkPermissions: () => call<Permissions>("check_permissions"),
  openPermissionSettings: (kind: PermissionKind) => call<void>("open_permission_settings", { kind }),
  fixFnKey: () => call<void>("fix_fn_key"),
  restartApp: () => call<void>("restart_app"),
  checkUpdate: () => call<import("./types").UpdateInfo>("check_update"),
  installUpdate: () => call<import("./types").UpdateInfo>("install_update"),

  listClaudeEvents: (limit = 50) => call<ClaudeEvent[]>("list_claude_events", { limit }),
  markClaudeSeen: (id?: string) => call<void>("mark_claude_seen", { id }),
  repairPermissions: () => call<void>("repair_permissions"),
  /** stale Accessibility switch after an update: clear Flo's record and ask again (no relaunch) */
  resetAccessibility: () => call<void>("reset_accessibility"),
  closePermissionGuide: () => call<void>("close_permission_guide"),
  openClaudeSession: (id: string) => call<string>("open_claude_session", { id }),
  // integrations (Claude Code, Codex, Cursor, webhook) + Slack + confirmations
  listIntegrations: () => call<Integration[]>("list_integrations").catch(() => [] as Integration[]),
  installIntegration: (id: string) => call<Integration[]>("install_integration", { id }),
  uninstallIntegration: (id: string) => call<Integration[]>("uninstall_integration", { id }),
  slackConnect: (token: string) => call<string>("slack_connect", { token }),
  slackStatus: () => call<string | null>("slack_status").catch(() => null),
  /** one-click Connect Slack: opens the browser; the result arrives on EV.slack */
  slackOauthStart: () => call<string>("slack_oauth_start"),
  slackDisconnect: (revoke = false) => call<void>("slack_disconnect", { revoke }),
  slackSyncNow: () => call<number>("slack_sync_now"),
  // Connect with Google (Calendar meeting alerts + Gmail); the OAuth result arrives on EV.google
  googleOauthStart: (calendar: boolean, gmail: boolean) => call<string>("google_oauth_start", { calendar, gmail }),
  googleStatus: () => call<GoogleStatus | null>("google_status").catch(() => null),
  /** revokes at Google and forgets the tokens on this computer */
  googleDisconnect: () => call<void>("google_disconnect"),
  googleCalendars: () => call<GoogleCalendar[]>("google_calendars"),
  /** cached: today + next 48 h, sorted by start ([] when not connected) */
  googleEvents: () => call<CalendarEvent[]>("google_events").catch(() => [] as CalendarEvent[]),
  googleRefreshEvents: () => call<CalendarEvent[]>("google_refresh_events"),
  googleMeetingAction: (id: string, action: MeetingAlertAction) => call<string>("google_meeting_action", { id, action }),
  gmailSyncNow: () => call<number>("gmail_sync_now"),
  confirmAction: (id: string, approve: boolean) => call<string>("confirm_action", { id, approve }),
  /** Claude Code permission prompt: allow | deny | terminal (answer it in the terminal instead) */
  answerClaudePermission: (id: string, decision: "allow" | "deny" | "terminal") => call<void>("answer_claude_permission", { id, decision }),
  // context library
  listSkills: () => call<Skill[]>("list_skills"),
  listConnections: () => call<Connection[]>("list_connections"),
  /** a pending Add MCP server form from a voice request ("connect to Mobbin MCP"), taken once */
  /** forget reused answers and cached account / MCP lookups */
  clearCaches: () => call<void>("clear_caches"),
  takeMcpPrefill: () => call<{ name?: string; url?: string; id?: string } | null>("take_mcp_prefill"),
  saveConnection: (connection: Connection) => call<Connection>("save_connection", { connection }),
  deleteConnection: (id: string) => call<void>("delete_connection", { id }),
  /** connect to an MCP server and list its tools (works before saving) */
  testConnection: (connection: Connection) => call<McpTool[]>("test_connection", { connection }),
  saveSkill: (skill: Skill) => call<Skill>("save_skill", { skill }),
  deleteSkill: (id: string) => call<void>("delete_skill", { id }),
  /** "Build with AI": draft a skill from a description; with `current` (the compiled skill), refine it */
  generateSkillGraph: (description: string, current?: string) => call<GeneratedSkill>("generate_skill_graph", { description, current: current ?? null }),
  /** run a skill now, unattended, like its schedule would (result saved as a note) */
  runSkillNow: (id: string) => call<AssistantResponse>("run_skill_now", { id }),
  listContextDocs: () => call<ContextDoc[]>("list_context_docs").catch(() => [] as ContextDoc[]),
  getContextDoc: (id: string) => call<{ doc: ContextDoc; content: string }>("get_context_doc", { id }),
  addContextDoc: (title: string, content: string) => call<ContextDoc>("add_context_doc", { title, content }),
  updateContextDoc: (id: string, patch: { title?: string; enabled?: boolean; pinned?: boolean; content?: string }) =>
    call<ContextDoc>("update_context_doc", { id, ...patch }),
  deleteContextDoc: (id: string) => call<void>("delete_context_doc", { id }),
  listClaudeSessions: () => call<ClaudeSession[]>("list_claude_sessions").catch(() => [] as ClaudeSession[]),
  openClaudeBySession: (sessionId: string) => call<string>("open_claude_by_session", { sessionId }),
  /** focus the window of a session that's asking for permission (nothing is dismissed) */
  focusClaudeSession: (sessionId?: string, cwd?: string) => call<string>("focus_claude_session", { sessionId: sessionId ?? null, cwd: cwd ?? null }),
  dismissClaudeSession: (sessionId: string) => call<void>("dismiss_claude_session", { sessionId }),
  acceptCorrection: (heard: string, corrected: string) => call<DictionaryEntry>("accept_correction", { heard, corrected }),
  undoCorrection: (heard: string, corrected: string) => call<void>("undo_correction", { heard, corrected }),
  // now playing / media / volume (notch widgets)
  nowPlaying: () => call<import("./types").NowPlaying | null>("now_playing").catch(() => null),
  weather: () => call<import("./types").Weather | null>("weather").catch(() => null),
  mediaControl: (action: "playpause" | "next" | "previous") => call<void>("media_control", { action }),
  getVolume: () => call<number | null>("get_volume").catch(() => null),
  setVolume: (level: number) => call<number>("set_volume", { level }),
  /** abort the running computer-control agent */
  stopAgent: () => call<void>("stop_agent").catch(() => {}),
  /** hands-free agent mode on/off (also: double-tap fn) → new state */
  toggleAgentMode: () => call<boolean>("toggle_agent_mode"),
  agentModeStatus: () => call<boolean>("agent_mode_status").catch(() => false),
  /** answer the screen agent's confirm question (Yes / No) */
  agentConfirm: (yes: boolean) => call<boolean>("agent_confirm", { yes }).catch(() => false),
  claudeHookStatus: () => call<ClaudeHookStatus>("claude_hook_status"),
  installClaudeHook: () => call<ClaudeHookStatus>("install_claude_hook"),
  uninstallClaudeHook: () => call<ClaudeHookStatus>("uninstall_claude_hook"),
  // presence (Active / Away) + paired phones (push.rs)
  getPresence: () => call<import("./types").PresenceInfo>("get_presence"),
  setPresence: (status: import("./types").PresenceStatus) => call<import("./types").PresenceInfo>("set_presence", { status }),
  pairPhoneStart: () => call<import("./types").PairCode>("pair_phone_start"),
  listPhones: () => call<import("./types").PhoneDevice[]>("list_phones"),
  removePhone: (id: string) => call<void>("remove_phone", { id }),
  /** only while Away; errors when Active */
  sendTestPush: () => call<import("./types").PushResult>("send_test_push"),
};
