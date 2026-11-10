import { describe, expect, it } from "vitest";
import { PERMISSION_ITEMS, missingRequired } from "../usePermissions";
import { SETUP_PERMS, STUCK_AFTER_MS, accessibilityState, hotkeyReady, nextSetupPerm, setupDone } from "./perms";
import type { Permissions } from "../../lib/types";

const P = (p: Partial<Permissions> = {}): Permissions => ({
  microphone: false,
  accessibility: false,
  inputMonitoring: false,
  screen: false,
  hotkeyActive: false,
  accessibilityStale: false,
  ...p,
});

describe("first-run permissions", () => {
  it("asks for exactly two things: the microphone and Accessibility", () => {
    expect(SETUP_PERMS.map((x) => x.key)).toEqual(["microphone", "accessibility"]);
    expect(PERMISSION_ITEMS.filter((x) => x.required).map((x) => x.key)).toEqual(["microphone", "accessibility"]);
  });

  it("never asks for Input Monitoring: the Flo key's event tap runs on Accessibility alone", () => {
    expect(PERMISSION_ITEMS.map((x) => x.key)).not.toContain("inputMonitoring");
    expect(setupDone(P({ microphone: true, accessibility: true, inputMonitoring: false }))).toBe(true);
    expect(missingRequired(P({ microphone: true, accessibility: true }))).toEqual([]);
  });

  it("Screen Recording is optional and never part of setup", () => {
    expect(SETUP_PERMS.map((x) => x.key)).not.toContain("screen");
    expect(PERMISSION_ITEMS.find((x) => x.key === "screen")?.required).toBe(false);
  });

  it("goes microphone first (one system prompt), then Accessibility", () => {
    expect(nextSetupPerm(null)).toBeNull();
    expect(nextSetupPerm(P())).toBe("microphone");
    expect(nextSetupPerm(P({ microphone: true }))).toBe("accessibility");
    expect(nextSetupPerm(P({ accessibility: true }))).toBe("microphone");
    expect(nextSetupPerm(P({ microphone: true, accessibility: true }))).toBeNull();
  });

  it("the Flo key is ready once Accessibility is on (the tap starts without a relaunch)", () => {
    expect(hotkeyReady(null)).toBe(true); // unknown yet: don't nag
    expect(hotkeyReady(P())).toBe(false);
    expect(hotkeyReady(P({ accessibility: true }))).toBe(true);
    expect(hotkeyReady(P({ hotkeyActive: true }))).toBe(true);
    expect(hotkeyReady(P({ inputMonitoring: true }))).toBe(false);
  });
});

describe("accessibility state", () => {
  const now = 100_000;
  it("granted wins over everything", () => {
    expect(accessibilityState(P({ accessibility: true, accessibilityStale: true }), now - 60_000, now)).toBe("granted");
  });
  it("idle until the person clicks Allow", () => {
    expect(accessibilityState(P(), null, now)).toBe("idle");
    expect(accessibilityState(null, null, now)).toBe("idle");
  });
  it("waiting right after Allow, while macOS shows its dialog / the switch", () => {
    expect(accessibilityState(P(), now - 2000, now)).toBe("waiting");
  });
  it("stuck when nothing changed for a while: the switch may be an old build's", () => {
    expect(accessibilityState(P(), now - STUCK_AFTER_MS - 1, now)).toBe("stuck");
  });
  it("stale right away when Flo was trusted under an earlier build (an update reset the grant)", () => {
    expect(accessibilityState(P({ accessibilityStale: true }), null, now)).toBe("stale");
    expect(accessibilityState(P({ accessibilityStale: true }), now - 1000, now)).toBe("stale");
  });
});
