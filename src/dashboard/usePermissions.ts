import { useEffect, useState } from "react";
import { api, type PermissionKind, type Permissions } from "../lib/api";

/** Live permission status: polls every 2s and re-checks whenever the window regains focus. */
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
  key: "microphone" | "accessibility" | "inputMonitoring" | "screen";
  kind: PermissionKind;
  label: string;
  why: string;
  required: boolean;
}

export const PERMISSION_ITEMS: PermissionItem[] = [
  { key: "microphone", kind: "microphone", label: "Microphone", why: "To hear you while you hold fn or record a meeting.", required: true },
  { key: "accessibility", kind: "accessibility", label: "Accessibility", why: "Needed to paste text into the app you're typing in.", required: true },
  { key: "inputMonitoring", kind: "input", label: "Input Monitoring", why: "Needed to notice when you hold the fn key.", required: true },
  { key: "screen", kind: "screen", label: "Screen Recording", why: "Optional: screen-aware answers and Attention. Images stay on this device.", required: false },
];

/** Required permissions that are still missing. */
export function missingRequired(p: Permissions | null): PermissionItem[] {
  if (!p) return [];
  return PERMISSION_ITEMS.filter((i) => i.required && !p[i.key]);
}
