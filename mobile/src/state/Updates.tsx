// Checks for app updates on launch and whenever the app comes back to the foreground (at most
// every 30 minutes), and exposes what it found to the UI.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  applyOtaUpdate,
  checkNativeUpdate,
  fetchOtaUpdate,
  installApk,
  openInstallPermission,
  type AndroidRelease,
} from '../lib/updates';

interface UpdatesCtx {
  /** a JS update is downloaded and applies on restart */
  otaReady: boolean;
  /** a newer APK exists */
  native: AndroidRelease | null;
  checking: boolean;
  /** 0..1 while the APK downloads */
  progress: number | null;
  error: string | null;
  lastChecked: number | null;
  check(): Promise<void>;
  restart(): Promise<void>;
  install(): Promise<void>;
  allowInstalls(): Promise<void>;
  dismiss(): void;
  dismissed: boolean;
}

const Ctx = createContext<UpdatesCtx | null>(null);
export function useUpdates() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUpdates outside UpdatesProvider');
  return v;
}

const EVERY_MS = 30 * 60_000;

export function UpdatesProvider({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  const [otaReady, setOtaReady] = useState(false);
  const [native, setNative] = useState<AndroidRelease | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const last = useRef(0);

  const check = useCallback(async () => {
    if (disabled) return;
    last.current = Date.now();
    setChecking(true);
    setError(null);
    try {
      const [rel, ota] = await Promise.all([checkNativeUpdate(), fetchOtaUpdate()]);
      setNative(rel);
      if (ota) setOtaReady(true);
      setLastChecked(Date.now());
    } finally {
      setChecking(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (disabled) return;
    void check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && Date.now() - last.current > EVERY_MS) void check();
    });
    return () => sub.remove();
  }, [check, disabled]);

  const install = useCallback(async () => {
    if (!native) return;
    setError(null);
    setProgress(0);
    try {
      await installApk(native, setProgress);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  }, [native]);

  return (
    <Ctx.Provider
      value={{
        otaReady,
        native,
        checking,
        progress,
        error,
        lastChecked,
        check,
        restart: applyOtaUpdate,
        install,
        allowInstalls: openInstallPermission,
        dismiss: () => setDismissed(true),
        dismissed,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
