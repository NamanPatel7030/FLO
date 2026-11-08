// In-app updates, shared by every view: one state, many subscribers.
//   idle → (check) → available → (install) → downloading → ready → (restart) → new version
// The backend checks on its own every few hours and announces `available` on flo://update; the
// UI can also check on demand (Settings → General → Updates).
import { useEffect, useState } from "react";
import { api, on } from "./api";
import { EV, type UpdateEvent, type UpdateInfo } from "./types";

export type UpdatePhase = "idle" | "checking" | "uptodate" | "available" | "downloading" | "ready" | "error";

export interface UpdateState {
  phase: UpdatePhase;
  current?: string;
  version?: string;
  notes?: string;
  downloaded?: number;
  total?: number | null;
  error?: string;
  checkedAt?: number;
}

let state: UpdateState = { phase: "idle" };
const subs = new Set<(s: UpdateState) => void>();
function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f(state));
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  on<UpdateEvent>(EV.update, (e) => {
    if (e.phase === "available") {
      if (state.phase !== "downloading" && state.phase !== "ready") set({ phase: "available", version: e.version, notes: e.notes ?? undefined, error: undefined });
    } else if (e.phase === "downloading") set({ phase: "downloading", downloaded: e.downloaded, total: e.total ?? null });
    else if (e.phase === "ready") set({ phase: "ready", version: e.version });
    else if (e.phase === "error") set({ phase: "error", error: e.message });
  });
}

function fromInfo(i: UpdateInfo): Partial<UpdateState> {
  if (i.ready) return { phase: "ready", current: i.current, version: i.version ?? undefined, notes: i.notes ?? undefined };
  if (i.available) return { phase: "available", current: i.current, version: i.version ?? undefined, notes: i.notes ?? undefined };
  return { phase: "uptodate", current: i.current };
}

export async function checkForUpdate(): Promise<UpdateState> {
  wire();
  if (state.phase === "downloading" || state.phase === "ready") return state;
  set({ phase: "checking", error: undefined });
  try {
    set({ ...fromInfo(await api.checkUpdate()), checkedAt: Date.now() });
  } catch (e) {
    set({ phase: "error", error: String(e), checkedAt: Date.now() });
  }
  return state;
}

export async function installUpdate(): Promise<void> {
  wire();
  if (state.phase === "downloading" || state.phase === "ready") return;
  set({ phase: "downloading", downloaded: 0, total: null, error: undefined });
  try {
    set(fromInfo(await api.installUpdate()));
  } catch (e) {
    set({ phase: "error", error: String(e) });
  }
}

export function restartToUpdate(): void {
  void api.restartApp();
}

/** Subscribe a component to the update state (also wires the backend events once). */
export function useUpdate(): UpdateState {
  const [s, setS] = useState(state);
  useEffect(() => {
    wire();
    subs.add(setS);
    setS(state);
    return () => {
      subs.delete(setS);
    };
  }, []);
  return s;
}

export function progressPct(s: UpdateState): number | null {
  if (!s.total || !s.downloaded) return null;
  return Math.min(100, Math.round((s.downloaded / s.total) * 100));
}

/** for tests */
export function _resetUpdateState() {
  state = { phase: "idle" };
  subs.forEach((f) => f(state));
}
