// Which OS Flo is running on, for copy and setup. The backend's island geometry says it for sure
// (`setOS` when it arrives); until then, inside the app, the web view's user agent is a reliable
// guess (WebView2 on Windows says "Windows NT", WebKitGTK on Linux says "Linux" / "X11"). The
// browser preview / tests use the mock backend, which is macOS unless `?platform=windows|linux`.
import type { Platform } from "./types";

export function osFromUserAgent(ua: string): Platform {
  if (/Windows/i.test(ua)) return "windows";
  if (/Linux|X11|CrOS/i.test(ua) && !/Android/i.test(ua)) return "linux";
  return "macos";
}

const inApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const previewOS = (): Platform => {
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("platform") : null;
  return q === "windows" || q === "linux" ? q : "macos";
};
let current: Platform = inApp && typeof navigator !== "undefined" ? osFromUserAgent(navigator.userAgent) : previewOS();

export const os = (): Platform => current;
export const setOS = (p: Platform | undefined | null) => {
  if (p === "macos" || p === "windows" || p === "linux") current = p;
};
export const isMac = (p: Platform = current) => p === "macos";

/** "Mac" / "PC": for copy like "stays on this Mac". */
export const deviceWord = (p: Platform = current) => (p === "macos" ? "Mac" : "computer");

/** The OS settings app, for "open … Sound". */
export const settingsApp = (p: Platform = current) => (p === "macos" ? "System Settings" : p === "windows" ? "Settings" : "your system settings");

/** Where secrets live on this OS. */
export const keyStoreName = (p: Platform = current) =>
  p === "macos" ? "macOS Keychain" : p === "windows" ? "Windows Credential Manager" : "system keyring (Secret Service)";

/** The shortcut modifier shown in hints: ⌘ on a Mac, Ctrl elsewhere ("⌘↵" / "Ctrl+↵"). */
export const modKey = (p: Platform = current) => (p === "macos" ? "⌘" : "Ctrl+");
