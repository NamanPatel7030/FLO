import { create } from "zustand";
import { api, on } from "../lib/api";
import { formatHotkey } from "../lib/format";
import { EV, type ClaudeEvent, type Note, type Project, type Settings, type ToastEvent, type Todo, type IslandGeometry } from "../lib/types";

export type Page = "home" | "assistant" | "todos" | "projects" | "notes" | "analytics" | "history" | "settings";

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
  const pages: Page[] = ["home", "assistant", "todos", "projects", "notes", "analytics", "history", "settings"];
  return { page: pages.includes(page as Page) ? (page as Page) : "home", arg };
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
  api.getSettings().then((settings) => useStore.setState({ settings }));
  api.getIslandGeometry().then((geo) => useStore.setState({ geo }));
  const offs = [
    on(EV.todos, () => {
      useStore.getState().refreshTodos();
      useStore.getState().refreshProjects();
    }),
    on(EV.projects, () => useStore.getState().refreshProjects()),
    on(EV.notes, () => useStore.getState().refreshNotes()),
    on(EV.claude, () => useStore.getState().refreshClaude()),
    on<ToastEvent>(EV.toast, (t) => useStore.getState().toast(t)),
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

/** Configured dictation key as keycaps ("⌃"), or Right Ctrl on Windows. */
export const hotkeyLabel = (geo: IslandGeometry | null, s?: Settings | null) =>
  geo?.platform === "windows" ? "Right Ctrl" : formatHotkey(s?.hotkeyDictation ?? "ctrl");
/** Configured assistant key as keycaps ("fn"), or Right Alt on Windows. */
export const assistantHotkeyLabel = (geo: IslandGeometry | null, s?: Settings | null) =>
  geo?.platform === "windows" ? "Right Alt" : formatHotkey(s?.hotkeyAssistant ?? "fn");
