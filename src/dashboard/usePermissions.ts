import { useEffect, useState } from "react";
import { api, type PermissionKind, type Permissions } from "../lib/api";

/** Live permission status: polls every 2s (pass a shorter interval while a permission step is up) and re-checks whenever the window regains focus. */
export function usePermissions(intervalMs = 2000): Permissions | null {
  const [p, setP] = useState<Permissions | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .checkPermissions()
        .then((x) => alive && setP(x))
        .catch(() => {});
    load();
    const t = setInterval(load, intervalMs);
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("focus", load);
    };
  }, [intervalMs]);
  return p;
}

export interface PermissionItem {
  key: "microphone" | "accessibility" | "screen";
  kind: PermissionKind;
  label: string;
  why: string;
  required: boolean;
}

export const PERMISSION_ITEMS: PermissionItem[] = [
  { key: "microphone", kind: "microphone", label: "Microphone", why: "To hear you while you hold your Flo key or record a meeting.", required: true },
  { key: "accessibility", kind: "accessibility", label: "Accessibility", why: "Lets your Flo key work and types the words where your cursor is.", required: true },
  { key: "screen", kind: "screen", label: "Screen Recording", why: "Optional: screen-aware answers and Attention. Images stay on this device.", required: false },
];

/** Accessibility is on but the key listener still isn't running after a grace period. The backend
 *  starts it within about a second of the grant, so this only shows when something is really off
 *  (then a relaunch helps). */
export function useHotkeyStuck(p: Permissions | null, graceMs = 6000): boolean {
  const ready = !!p && missingRequired(p).length === 0;
  const waiting = ready && !p!.hotkeyActive;
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!waiting) {
      setStuck(false);
      return;
    }
    const t = setTimeout(() => setStuck(true), graceMs);
    return () => clearTimeout(t);
  }, [waiting, graceMs]);
  return waiting && stuck;
}

/** Required permissions that are still missing. */
export function missingRequired(p: Permissions | null): PermissionItem[] {
  if (!p) return [];
  return PERMISSION_ITEMS.filter((i) => i.required && !p[i.key]);
}
