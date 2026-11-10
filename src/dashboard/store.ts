import { create } from "zustand";
import { api, on } from "../lib/api";
import { formatHotkey } from "../lib/format";
import { os, setOS } from "../lib/os";
import { applyTheme, broadcastSettings, onSettingsBroadcast, watchSystemTheme } from "../lib/theme";
import { EV, type ClaudeEvent, type Note, type Project, type Settings, type ToastEvent, type Todo, type IslandGeometry } from "../lib/types";

export type Page = "agent" | "home" | "assistant" | "skills" | "context" | "todos" | "projects" | "notes" | "analytics" | "history" | "settings" | "typing";

interface Toast extends ToastEvent {
  id: number;
}

interface State {
  page: Page;
  pageArg?: string;
  todos: Todo[] | null;
  projects: Project[] | null;
  notes: Note[] | null;
  claude: ClaudeEvent[] | null;
  settings: Settings | null;
  geo: IslandGeometry | null;
  toasts: Toast[];
  go: (page: Page, arg?: string) => void;
  refreshTodos: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshNotes: () => Promise<void>;
  refreshClaude: () => Promise<void>;
  setSettings: (s: Settings) => Promise<void>;
  toast: (t: ToastEvent) => void;
}

let toastId = 1;

function readHash(): { page: Page; arg?: string } {
  const [, page, arg] = location.hash.replace(/^#/, "").split("/");
  const pages: Page[] = ["agent", "home", "assistant", "skills", "context", "todos", "projects", "notes", "analytics", "history", "settings", "typing"];
  // Flo Agent is the main face: an empty / unknown route lands there (Home stays one click away)
  return { page: pages.includes(page as Page) ? (page as Page) : "agent", arg };
}

export const useStore = create<State>((set, get) => ({
  ...(() => {
    const h = readHash();
    return { page: h.page, pageArg: h.arg };
  })(),
  todos: null,
  projects: null,
  notes: null,
  claude: null,
  settings: null,
  geo: null,
  toasts: [],
  go: (page, arg) => {
    history.replaceState(null, "", `#/${page}${arg ? `/${arg}` : ""}`);
    set({ page, pageArg: arg });
  },
  refreshTodos: async () => set({ todos: await api.listTodos() }),
  refreshProjects: async () => set({ projects: await api.listProjects() }),
  refreshNotes: async () => set({ notes: await api.listNotes() }),
  refreshClaude: async () => set({ claude: await api.listClaudeEvents(50) }),
  setSettings: async (s) => {
    set({ settings: s });
    applyTheme(s);
    broadcastSettings();
    await api.saveSettings(s);
  },
  toast: (t) => {
    const id = toastId++;
    set({ toasts: [...get().toasts, { ...t, id }] });
    setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== id) }), 3800);
  },
}));

/** Load everything + wire backend events. Call once from the shell. */
export function bootStore(): () => void {
  const s = useStore.getState();
  s.refreshTodos();
  s.refreshProjects();
  s.refreshNotes();
  s.refreshClaude();
  api.getSettings().then((settings) => {
    useStore.setState({ settings });
    applyTheme(settings);
  });
  api.getIslandGeometry().then((geo) => {
    setOS(geo?.platform);
    useStore.setState({ geo });
  });
  const offs = [
    on(EV.todos, () => {
      useStore.getState().refreshTodos();
      useStore.getState().refreshProjects();
    }),
    on(EV.projects, () => useStore.getState().refreshProjects()),
    on(EV.notes, () => useStore.getState().refreshNotes()),
    on(EV.claude, () => useStore.getState().refreshClaude()),
    on<ToastEvent>(EV.toast, (t) => useStore.getState().toast(t)),
    onSettingsBroadcast(() => api.getSettings().then((settings) => { useStore.setState({ settings }); applyTheme(settings); })),
    on(EV.settingsChanged, () => api.getSettings().then((settings) => { useStore.setState({ settings }); applyTheme(settings); })),
    watchSystemTheme(() => { const st = useStore.getState().settings; if (st) applyTheme(st); }),
  ];
  const onHash = () => {
    const h = readHash();
    useStore.setState({ page: h.page, pageArg: h.arg });
  };
  window.addEventListener("hashchange", onHash);
  return () => {
    offs.forEach((f) => f());
    window.removeEventListener("hashchange", onHash);
  };
}

/** Configured dictation key as keycaps ("⌃" on a Mac, "Ctrl" on Windows / Linux). */
export const hotkeyLabel = (geo: IslandGeometry | null, s?: Settings | null) => formatHotkey(s?.hotkeyDictation ?? "ctrl", geo?.platform ?? os());
/** Configured assistant key as keycaps ("fn" on a Mac, "Ctrl + Win" on Windows). */
export const assistantHotkeyLabel = (geo: IslandGeometry | null, s?: Settings | null) => formatHotkey(s?.hotkeyAssistant ?? "fn", geo?.platform ?? os());
