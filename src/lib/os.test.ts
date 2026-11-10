import { describe, expect, it } from "vitest";
import { osFromUserAgent, deviceWord, settingsApp, keyStoreName, modKey } from "./os";
import { formatHotkey, hotkeyOptions, hotkeyWords, pcCombo, sameHotkey } from "./format";

describe("OS detection", () => {
  it("reads the web view's user agent", () => {
    expect(osFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/130")).toBe("windows");
    expect(osFromUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15")).toBe("linux");
    expect(osFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")).toBe("macos");
    expect(osFromUserAgent("Mozilla/5.0 (Linux; Android 14)")).toBe("macos");
  });

  it("words copy for each OS", () => {
    expect(deviceWord("macos")).toBe("Mac");
    expect(deviceWord("windows")).toBe("computer");
    expect(settingsApp("windows")).toBe("Settings");
    expect(settingsApp("macos")).toBe("System Settings");
    expect(keyStoreName("windows")).toBe("Windows Credential Manager");
    expect(keyStoreName("linux")).toMatch(/Secret Service/);
    expect(modKey("linux")).toBe("Ctrl+");
  });
});

describe("push-to-talk keys on a PC keyboard", () => {
  it("fn means Ctrl + Win / Super, as the backend maps it", () => {
    expect(pcCombo("fn")).toBe("ctrl+cmd");
    expect(pcCombo("fn+ctrl")).toBe("ctrl+cmd");
    expect(formatHotkey("fn", "windows")).toBe("Ctrl + Win");
    expect(formatHotkey("fn", "linux")).toBe("Ctrl + Super");
    expect(formatHotkey("ctrl", "windows")).toBe("Ctrl");
    expect(hotkeyWords("ctrl+alt", "linux")).toBe("Ctrl + Alt");
    expect(formatHotkey("fn+ctrl", "macos")).toBe("fn + ⌃");
  });

  it("offers no fn on Windows / Linux and treats fn and ctrl+cmd as the same key", () => {
    expect(hotkeyOptions("windows")).not.toContain("fn");
    expect(hotkeyOptions("macos")).toContain("fn");
    expect(sameHotkey("fn", "ctrl+cmd", "windows")).toBe(true);
    expect(sameHotkey("fn", "ctrl+cmd", "macos")).toBe(false);
  });
});
