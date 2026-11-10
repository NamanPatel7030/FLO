// Hermes, one click at a time: Install (the official installer, run by Flo on click, with live
// progress and Cancel) and Play / Pause (the gateway that answers in Slack). Shared by Engine and Slack.
import { os } from "../../lib/os";
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Download, Loader2, Pause, Play, X } from "lucide-react";
import { on } from "../../lib/api";
import { AGENT_EV, agentApi, type HermesStatus, type InstallState } from "../../lib/floAgent";
import { useStore } from "../store";
import { Button } from "../ui";

/** Hermes status + install progress, refreshed on open, on events and when the window comes back (no timers). */
export function useHermes() {
  const [st, setSt] = useState<HermesStatus | null>(null);
  const [install, setInstall] = useState<InstallState>({ phase: "idle", lines: [] });
  const [checking, setChecking] = useState(false);
  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      setSt(await agentApi.hermesStatus());
    } catch {
      /* keep the last status */
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    refresh();
    agentApi
      .hermesInstallState()
      .then(setInstall)
      .catch(() => {});
    const offs = [
      on<HermesStatus>(AGENT_EV.hermes, (s) => (s && "phase" in s ? setSt(s) : refresh())),
      on<InstallState>(AGENT_EV.install, (s) => {
        setInstall(s);
        if (s.phase !== "running") refresh();
      }),
      on<string>(AGENT_EV.installLog, (l) => setInstall((s) => ({ ...s, lines: [...s.lines.slice(-299), l] }))),
    ];
    const vis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", vis);
    return () => {
      offs.forEach((f) => f());
      document.removeEventListener("visibilitychange", vis);
    };
  }, [refresh]);
  return { st, setSt, refresh, checking, install, setInstall };
}
export type HermesHook = ReturnType<typeof useHermes>;

/** The single next step for Hermes: Install, Play or Pause. */
export function HermesAction({ h, size = "md" }: { h: HermesHook; size?: "sm" | "md" }) {
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const { st, install } = h;
  if (!st) return null;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast({ kind: "error", text: String(e) });
      h.refresh();
    } finally {
      setBusy(false);
    }
  };
  if (install.phase === "running" || st.installing)
    return (
      <Button size={size} variant="ghost" icon={<X size={13} />} onClick={() => run(() => agentApi.hermesInstallCancel())}>
        Cancel
      </Button>
    );
  if (!st.installed) {
    if (!st.appleSilicon) return null;
    return (
      <Button size={size} variant="primary" icon={<Download size={13} />} disabled={busy} onClick={() => run(async () => h.setInstall(await agentApi.hermesInstall()))}>
        {st.broken ? "Repair Hermes" : "Install Hermes"}
      </Button>
    );
  }
  return st.playing ? (
    <Button size={size} icon={<Pause size={13} className="fill-current" />} disabled={busy} onClick={() => run(async () => h.setSt(await agentApi.hermesStop()))}>
      Pause
    </Button>
  ) : (
    <Button size={size} variant="primary" icon={<Play size={13} className="fill-current" />} disabled={busy} onClick={() => run(async () => h.setSt(await agentApi.hermesStart()))}>
      Play
    </Button>
  );
}

/** Live installer output while it runs, and the installer's own last lines when it fails. */
export function InstallProgress({ h }: { h: HermesHook }) {
  const { install, st } = h;
  const ref = useRef<HTMLDivElement>(null);
  const running = install.phase === "running";
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [install.lines.length]);
  if (st && !st.installed && !st.appleSilicon)
    return (
      <p className="mt-3 rounded-xl border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-[12.5px] text-amber-700 dark:text-amber-100" data-testid="hermes-intel">
        {os() === "windows"
          ? "On Windows, Hermes only runs inside WSL2, so Flo can't install it here. Flo's built-in engine still works."
          : "Hermes runs on Apple Silicon computers only (M1 or newer). Flo's built-in engine still works here."}
      </p>
    );
  if (install.phase === "idle" || install.phase === "done") return null;
  return (
    <div className="mt-3 flex flex-col gap-2" data-testid="hermes-install-progress" data-phase={install.phase}>
      {running && (
        <div className="flex items-center gap-2 text-[12.5px] text-muted">
          <Loader2 size={13} className="animate-spin text-brand-300" />
          Installing Hermes with its official installer. This takes a few minutes.
        </div>
      )}
      {install.error && !running && (
        <p role="alert" className={clsx("rounded-xl border px-3 py-2 text-[12.5px]", install.phase === "cancelled" ? "border-[var(--border)] bg-[var(--glass)] text-muted" : "border-rose-300/25 bg-rose-400/10 text-rose-700 dark:text-rose-200")} data-testid="hermes-install-error">
          {install.error}
        </p>
      )}
      {install.lines.length > 0 && (
        <div ref={ref} className="max-h-[150px] overflow-y-auto rounded-xl border border-[var(--border)] bg-black/[0.04] px-3 py-2 font-mono text-[11.5px] leading-[18px] text-muted dark:border-white/[0.06] dark:bg-black/35" data-testid="hermes-install-log">
          {(running ? install.lines : install.lines.slice(-8)).map((l, i) => (
            <div key={i} className="whitespace-pre-wrap break-words">
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
