// Active / Away presence (backend: src-tauri/src/push.rs). Shared by the dashboard sidebar, the
// notch quick menu and Settings; every window stays in step through EV.presence.
import { useCallback, useEffect, useState } from "react";
import qrcode from "qrcode-generator";
import { api, on } from "./api";
import { deviceWord } from "./os";
import { EV, type PresenceInfo, type PresenceStatus } from "./types";

export function usePresence() {
  const [info, setInfo] = useState<PresenceInfo | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .getPresence()
        .then((p) => live && setInfo(p))
        .catch(() => live && setInfo({ status: "active", signedIn: false, auto: false }));
    load();
    const off = on<PresenceInfo>(EV.presence, (p) => setInfo(p));
    // signing in or out after this window opened changes whether a phone can be paired
    const offAccount = on(EV.account, () => load());
    return () => {
      live = false;
      off();
      offAccount();
    };
  }, []);
  const set = useCallback(async (status: PresenceStatus) => {
    setBusy(true);
    try {
      setInfo(await api.setPresence(status));
    } finally {
      setBusy(false);
    }
  }, []);
  return { info, status: info?.status ?? "active", busy, set };
}

/** One line under the switch. */
export function presenceHint(info: PresenceInfo | null): string {
  if (!info) return "";
  if (info.status === "active") return `You're at your ${deviceWord()}. Nothing goes to your phone.`;
  if (!info.signedIn) return "Away. Sign in to get notifications on your phone.";
  return info.auto ? "Away (screen locked or idle). Notifications go to your phone." : "Away. Notifications go to your phone.";
}

/** QR matrix for `text` (byte mode, error correction M). */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** SVG path ("M x y h1 v1 h-1 z" per dark module) for a QR matrix, origin at the quiet zone. */
export function qrPath(m: boolean[][], quiet = 2): string {
  let d = "";
  m.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }),
  );
  return d;
}

/** "4:59" from ms. */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
