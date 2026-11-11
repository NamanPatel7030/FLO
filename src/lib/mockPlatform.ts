// Browser preview / tests: what the Windows and Linux backends report under Settings → Permissions
// (platform/mod.rs linux_checks / windows_checks), for ?platform=linux|windows. A GNOME-on-Wayland
// machine fresh from install: microphone fine, the input group and ydotool still missing.
import type { PermCheck, Platform } from "./types";

const c = (id: string, label: string, status: PermCheck["status"], detail: string, extra: Partial<PermCheck> = {}): PermCheck => ({ id, label, status, detail, required: false, canFix: false, ...extra });

/** ids the preview has "fixed" (Fix on start-at-login) */
const fixed = new Set<string>();

export function mockFix(kind: string) {
  if (kind === "autostart") fixed.add(kind);
}

export function mockChecks(p: Platform, micOk: boolean): PermCheck[] {
  const autostart = fixed.has("autostart");
  if (p === "windows")
    return [
      micOk ? c("microphone", "Microphone", "ok", "Allowed under Settings > Privacy > Microphone.") : c("microphone", "Microphone", "missing", 'Turn on "Let desktop apps access your microphone" under Settings > Privacy > Microphone.', { required: true, canFix: true }),
      c("keyboard", "Flo key", "ok", "Uses a standard keyboard hook. No permission needed."),
      c("typing", "Typing into apps", "ok", "No permission needed. Windows blocks typing only into apps run as administrator."),
      c("screen", "Screen", "notNeeded", "Not needed: Windows lets desktop apps see the screen. Images stay on this computer."),
      c("ocr", "Reading text on screen", "ok", "Uses the text recognition built into Windows, on this computer."),
      c("accessibility", "Accessibility", "notNeeded", "Not needed on Windows: there's no Accessibility switch."),
      c("notifications", "Notifications", "notNeeded", "Not needed: Flo shows alerts in its own pill."),
      autostart ? c("autostart", "Start at login", "ok", "Flo opens when you sign in.") : c("autostart", "Start at login", "missing", "Optional. Opens Flo when you sign in, so your Flo key always works.", { canFix: true }),
    ];
  return [
    micOk ? c("microphone", "Microphone", "ok", "Linux has no per-app microphone switch: Flo records from your default input.") : c("microphone", "Microphone", "missing", "No microphone found. Plug one in or pick an input in Sound settings.", { required: true, canFix: true }),
    c("keyboard", "Flo key", "missing", "Wayland blocks global keys, so Flo reads the keyboard directly. Add yourself to the input group, then log out and back in. Until then, use the tray menu's Start / stop dictation.", { required: true, command: "sudo usermod -aG input $USER" }),
    c("typing", "Typing into apps", "missing", "GNOME on Wayland lets apps type only through ydotool. Without it Flo copies the words and you press Ctrl+V.", { command: "sudo apt install ydotool" }),
    c("screen", "Screen", "ok", "For screen-aware answers and Attention. Your desktop asks once in its own dialog. Images stay on this computer."),
    c("ocr", "Reading text on screen", "missing", "Optional. Lets Attention and screen-aware answers read text, on this computer.", { command: "sudo apt install tesseract-ocr" }),
    c("windows", "Window titles", "limited", "Wayland hides other apps' windows, so Flo spots calls from the microphone instead of the window title."),
    c("accessibility", "Accessibility", "notNeeded", "Not needed on Linux: there's no Accessibility switch. Typing and the Flo key are covered above."),
    c("notifications", "Notifications", "notNeeded", "Not needed: Flo shows alerts in its own pill."),
    autostart ? c("autostart", "Start at login", "ok", "Flo opens when you log in.") : c("autostart", "Start at login", "missing", "Optional. Opens Flo when you log in, so your Flo key always works.", { canFix: true }),
  ];
}
