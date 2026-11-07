"use client";

import { useEffect, useState } from "react";

export type OS = "mac" | "windows" | "linux";
export type Detected = OS | "ios" | "android";

export const OS_LABEL: Record<OS, string> = { mac: "macOS", windows: "Windows", linux: "Linux" };
export const OS_ORDER: OS[] = ["mac", "windows", "linux"];

type UAData = { platform?: string; mobile?: boolean };

function fromUA(ua: string): Detected | null {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "mac";
  if (/Linux|X11|CrOS/i.test(ua)) return "linux";
  return null;
}

function fromPlatform(p: string): Detected | null {
  const s = p.toLowerCase();
  if (!s) return null;
  if (s.includes("android")) return "android";
  if (s.includes("ios") || s.includes("iphone") || s.includes("ipad")) return "ios";
  if (s.includes("win")) return "windows";
  if (s.includes("mac")) return "mac";
  if (s.includes("linux") || s.includes("chrome os") || s.includes("chromeos")) return "linux";
  return null;
}

/**
 * Client-only OS detection. Prefers `navigator.userAgentData.platform`, falls back to the user-agent
 * string. When both are present and disagree (a UA override, a remote browser), the UA string wins,
 * because that is what the visitor's browser is presenting itself as.
 */
export function detectOS(): Detected {
  const nav = navigator as Navigator & { userAgentData?: UAData };
  const ua = nav.userAgent || "";
  const byUA = fromUA(ua);
  // iPadOS 13+ reports itself as a Mac; touch points give it away
  if (byUA === "mac" && nav.maxTouchPoints > 1) return "ios";
  const byPlatform = fromPlatform(nav.userAgentData?.platform ?? "");
  if (byPlatform && (!byUA || byUA === byPlatform)) return byPlatform;
  return byUA ?? byPlatform ?? "mac";
}

/** `null` on the server and on the first client render (no hydration mismatch); the real OS after mount. */
export function useOS(): Detected | null {
  const [os, setOs] = useState<Detected | null>(null);
  useEffect(() => setOs(detectOS()), []);
  return os;
}

export const downloadHref = (os: OS) => `/download?os=${os}`;
