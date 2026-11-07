import type {
  Analytics,
  AssistantMode,
  AssistantResponse,
  AttentionStatus,
  ClaudeEvent,
  ClaudeHookStatus,
  ClaudeSession,
  ContextDoc,
  Skill,
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
export type PermissionKind = "microphone" | "accessibility" | "input" | "screen";

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
  openDashboard: (route?: string) => call<void>("open_dashboard", { route }),

  startSession: (mode: Mode) => call<void>("start_session", { mode }),
  stopSession: () => call<void>("stop_session"),
  cancelSession: () => call<void>("cancel_session"),
  askAssistant: (text: string, mode: AssistantMode = "quick") => call<AssistantResponse>("ask_assistant", { text, mode }),
  /** re-ask a previous answer: deep = reads the focused window, detailed; web = web search + sources */
  assistantFollowup: (id: string, mode: "deep" | "web") => call<AssistantResponse>("assistant_followup", { id, mode }),
  /** Not in original contract; falls back to [] if backend lacks it. */
  listAssistant: () => call<AssistantResponse[]>("list_assistant").catch(() => [] as AssistantResponse[]),

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

  listDictionary: () => call<DictionaryEntry[]>("list_dictionary"),
  addDictionary: (word: string, replacement?: string) => call<DictionaryEntry>("add_dictionary", { word, replacement }),
  removeDictionary: (id: string) => call<void>("remove_dictionary", { id }),

  networkLog: () => call<NetworkLogEntry[]>("network_log"),
  listModels: () => call<LocalModel[]>("list_models"),
  downloadModel: (id: string) => call<void>("download_model", { id }),
  deleteModel: (id: string) => call<void>("delete_model", { id }),

  attentionStatus: () => call<AttentionStatus>("attention_status"),
  setAttentionPaused: (paused: boolean) => call<void>("set_attention_paused", { paused }),
  checkPermissions: () => call<Permissions>("check_permissions"),
  openPermissionSettings: (kind: PermissionKind) => call<void>("open_permission_settings", { kind }),
  fixFnKey: () => call<void>("fix_fn_key"),
  restartApp: () => call<void>("restart_app"),

  listClaudeEvents: (limit = 50) => call<ClaudeEvent[]>("list_claude_events", { limit }),
  markClaudeSeen: (id?: string) => call<void>("mark_claude_seen", { id }),
  repairPermissions: () => call<void>("repair_permissions"),
  openClaudeSession: (id: string) => call<string>("open_claude_session", { id }),
  // integrations (Claude Code, Codex, Cursor, webhook) + Slack + confirmations
  listIntegrations: () => call<Integration[]>("list_integrations").catch(() => [] as Integration[]),
  installIntegration: (id: string) => call<Integration[]>("install_integration", { id }),
  uninstallIntegration: (id: string) => call<Integration[]>("uninstall_integration", { id }),
  slackConnect: (token: string) => call<string>("slack_connect", { token }),
  slackStatus: () => call<string | null>("slack_status").catch(() => null),
  slackDisconnect: () => call<void>("slack_disconnect"),
  slackSyncNow: () => call<number>("slack_sync_now"),
  confirmAction: (id: string, approve: boolean) => call<string>("confirm_action", { id, approve }),
  // context library
  listSkills: () => call<Skill[]>("list_skills"),
  listConnections: () => call<Connection[]>("list_connections"),
  saveConnection: (connection: Connection) => call<Connection>("save_connection", { connection }),
  deleteConnection: (id: string) => call<void>("delete_connection", { id }),
  /** connect to an MCP server and list its tools (works before saving) */
  testConnection: (connection: Connection) => call<McpTool[]>("test_connection", { connection }),
  saveSkill: (skill: Skill) => call<Skill>("save_skill", { skill }),
  deleteSkill: (id: string) => call<void>("delete_skill", { id }),
  listContextDocs: () => call<ContextDoc[]>("list_context_docs").catch(() => [] as ContextDoc[]),
  getContextDoc: (id: string) => call<{ doc: ContextDoc; content: string }>("get_context_doc", { id }),
  addContextDoc: (title: string, content: string) => call<ContextDoc>("add_context_doc", { title, content }),
  updateContextDoc: (id: string, patch: { title?: string; enabled?: boolean; pinned?: boolean; content?: string }) =>
    call<ContextDoc>("update_context_doc", { id, ...patch }),
  deleteContextDoc: (id: string) => call<void>("delete_context_doc", { id }),
  listClaudeSessions: () => call<ClaudeSession[]>("list_claude_sessions").catch(() => [] as ClaudeSession[]),
  openClaudeBySession: (sessionId: string) => call<string>("open_claude_by_session", { sessionId }),
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
  claudeHookStatus: () => call<ClaudeHookStatus>("claude_hook_status"),
  installClaudeHook: () => call<ClaudeHookStatus>("install_claude_hook"),
  uninstallClaudeHook: () => call<ClaudeHookStatus>("uninstall_claude_hook"),
};
