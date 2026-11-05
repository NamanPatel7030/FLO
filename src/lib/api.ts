import type {
  Analytics,
  AssistantResponse,
  AttentionStatus,
  ClaudeEvent,
  ClaudeHookStatus,
  ClaudeSession,
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

  getIslandGeometry: () => call<IslandGeometry>("get_island_geometry"),
  islandResize: (width: number, height: number) => call<void>("island_resize", { width, height }),
  openDashboard: (route?: string) => call<void>("open_dashboard", { route }),

  startSession: (mode: Mode) => call<void>("start_session", { mode }),
  stopSession: () => call<void>("stop_session"),
  cancelSession: () => call<void>("cancel_session"),
  askAssistant: (text: string) => call<AssistantResponse>("ask_assistant", { text }),
  /** Not in original contract; falls back to [] if backend lacks it. */
  listAssistant: () => call<AssistantResponse[]>("list_assistant").catch(() => [] as AssistantResponse[]),

  listHistory: (limit = 200) => call<Dictation[]>("list_history", { limit }),
  getAnalytics: (days = 30) => call<Analytics>("get_analytics", { days }),

  listTodos: () => call<Todo[]>("list_todos"),
  addTodo: (title: string, projectId?: string, due?: string) => call<Todo>("add_todo", { title, projectId, due }),
  updateTodo: (id: string, patch: { status?: TodoStatus; title?: string; projectId?: string }) =>
    call<Todo>("update_todo", { id, ...patch }),
  deleteTodo: (id: string) => call<void>("delete_todo", { id }),

  listProjects: () => call<Project[]>("list_projects"),
  createProject: (name: string, description?: string) => call<Project>("create_project", { name, description }),
  updateProject: (id: string, patch: { name?: string; description?: string; status?: ProjectStatus }) =>
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
  listClaudeSessions: () => call<ClaudeSession[]>("list_claude_sessions").catch(() => [] as ClaudeSession[]),
  openClaudeBySession: (sessionId: string) => call<string>("open_claude_by_session", { sessionId }),
  dismissClaudeSession: (sessionId: string) => call<void>("dismiss_claude_session", { sessionId }),
  acceptCorrection: (heard: string, corrected: string) => call<DictionaryEntry>("accept_correction", { heard, corrected }),
  claudeHookStatus: () => call<ClaudeHookStatus>("claude_hook_status"),
  installClaudeHook: () => call<ClaudeHookStatus>("install_claude_hook"),
  uninstallClaudeHook: () => call<ClaudeHookStatus>("uninstall_claude_hook"),
};
