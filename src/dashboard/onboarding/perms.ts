// First-run permissions, as pure logic (no React) so it is unit-tested (perms.test.ts).
// Flo needs two things from macOS to dictate: the Microphone (one system prompt) and Accessibility
// (one switch). Accessibility covers typing the words AND the Flo key: the hotkey is an active
// CGEventTap, which macOS allows for Accessibility-trusted apps, so Input Monitoring is never asked.
// Screen Recording, Automation and Calendar are asked later, only when a feature first needs them.
import type { Permissions } from "../../lib/types";
import { PERMISSION_ITEMS, type PermissionItem } from "../usePermissions";

export type SetupPermKey = "microphone" | "accessibility";

/** What setup asks for, in order. */
export const SETUP_PERMS: PermissionItem[] = PERMISSION_ITEMS.filter((it) => it.required);

export const setupDone = (p: Permissions | null) => !!p && SETUP_PERMS.every((it) => p[it.key]);

/** The next permission to ask for: the microphone first (a single click on macOS's own prompt),
 *  then Accessibility. */
export function nextSetupPerm(p: Permissions | null): SetupPermKey | null {
  if (!p) return null;
  if (!p.microphone) return "microphone";
  if (!p.accessibility) return "accessibility";
  return null;
}

/** May the Flo key work? Accessibility is enough; the backend starts the key listener the moment
 *  it is granted (no relaunch). Unknown status counts as ready so nothing nags before the first check. */
export const hotkeyReady = (p: Permissions | null) => !p || p.hotkeyActive || p.accessibility;

/** After this long with no grant, offer the one-click reset (the switch may belong to an old build). */
export const STUCK_AFTER_MS = 20_000;

export type AxState = "granted" | "idle" | "waiting" | "stuck" | "stale";

/** Where the Accessibility grant stands. `askedAt` is when the person clicked Allow (ms), or null.
 *  - stale: Flo was trusted under an earlier build and this build isn't (an update reset the grant;
 *    the switch in System Settings still looks on). Offer the reset straight away.
 *  - stuck: asked a while ago and still nothing. Offer the reset as a fallback. */
export function accessibilityState(p: Permissions | null, askedAt: number | null, now: number): AxState {
  if (p?.accessibility) return "granted";
  if (p?.accessibilityStale) return "stale";
  if (askedAt === null) return "idle";
  return now - askedAt > STUCK_AFTER_MS ? "stuck" : "waiting";
}
