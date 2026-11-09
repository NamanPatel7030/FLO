// "Sync your data": end-to-end encrypted backup and multi-Mac sync (src-tauri/src/sync.rs).
import { invokeRaw } from "./api";
import type { SyncCategory, SyncEnableResult, SyncReport, SyncStatus } from "./types";

export type { SyncCategory, SyncEnableResult, SyncReport, SyncStatus };

export const SYNC_CATEGORIES: { id: SyncCategory; label: string; hint: string }[] = [
  { id: "todos", label: "To-dos and reminders", hint: "Tasks, due dates and what's done." },
  { id: "notes", label: "Notes and meetings", hint: "Summaries, action items, transcripts and your Vault." },
  { id: "settings", label: "Dictionary, skills and projects", hint: "Your words, skills, projects and knowledge docs." },
  { id: "history", label: "Dictation history", hint: "Everything you've dictated or asked." },
];

export const syncApi = {
  status: () => invokeRaw<SyncStatus>("sync_status"),
  enable: () => invokeRaw<SyncEnableResult>("sync_enable"),
  join: (recoveryKey: string) => invokeRaw<void>("sync_join", { recoveryKey }),
  disable: () => invokeRaw<void>("sync_disable"),
  now: () => invokeRaw<SyncReport>("sync_now"),
  setCategories: (categories: SyncCategory[]) => invokeRaw<void>("sync_set_categories", { categories }),
  recoveryKey: () => invokeRaw<string>("sync_recovery_key"),
  deleteRemote: () => invokeRaw<void>("sync_delete_remote"),
};
