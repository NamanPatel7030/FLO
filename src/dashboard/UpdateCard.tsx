import { useEffect, useState } from "react";
// The in-app update UI: a card in the sidebar (only while an update is available / downloading /
// ready) and a full "Updates" row in Settings → General. Both drive the same shared state.
import { AnimatePresence, motion } from "motion/react";
import { ArrowDownToLine, CheckCircle2, Loader2, RefreshCw, RotateCw, Sparkles, TriangleAlert, X } from "lucide-react";
import { checkForUpdate, installUpdate, progressPct, restartToUpdate, useUpdate, type UpdateState } from "../lib/updates";
import { Button } from "./ui";

function Progress({ s }: { s: UpdateState }) {
  const pct = progressPct(s);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100} aria-label="Download progress">
      {pct === null ? (
        <motion.div className="h-full w-1/3 rounded-full bg-brand-400" animate={{ x: ["-100%", "300%"] }} transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }} />
      ) : (
        <motion.div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-300" initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.2 }} />
      )}
    </div>
  );
}

/** Sidebar card: appears only when there's something to do. */
export function UpdateSidebarCard() {
  const s = useUpdate();
  const show = s.phase === "available" || s.phase === "downloading" || s.phase === "ready" || (s.phase === "error" && !!s.version);
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="upd"
          initial={{ opacity: 0, y: 8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: 8, height: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
          className="overflow-hidden"
        >
          <div
            className="relative mb-2.5 overflow-hidden rounded-2xl border border-[rgb(var(--accent-rgb)/0.35)] p-3 text-[12px]"
            style={{ background: "linear-gradient(150deg, rgb(var(--accent-rgb) / 0.20), rgb(var(--accent-rgb) / 0.05) 60%), var(--glass-strong)" }}
            data-testid="update-card"
          >
            <span aria-hidden className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full" style={{ background: "radial-gradient(circle, rgb(var(--accent-rgb) / 0.35), transparent 70%)" }} />
            {s.phase === "ready" ? (
              <>
                <div className="relative mb-1 flex items-center gap-1.5 font-semibold text-[var(--fg)]">
                  <CheckCircle2 size={13} className="text-emerald-300" /> Flo {s.version} is ready
                </div>
                <div className="relative mb-2.5 text-muted">Restart to start using it.</div>
                <Button size="sm" variant="primary" className="relative w-full justify-center" icon={<RotateCw size={13} />} onClick={restartToUpdate}>
                  Restart now
                </Button>
              </>
            ) : s.phase === "downloading" ? (
              <>
                <div className="relative mb-2 flex items-center gap-1.5 font-semibold text-[var(--fg)]">
                  <Loader2 size={13} className="animate-spin text-brand-300" /> Updating to {s.version ?? "the new version"}…
                </div>
                <Progress s={s} />
                <div className="relative mt-1.5 text-[11px] text-faint">{progressPct(s) !== null ? `${progressPct(s)}%` : "Starting download"} · keep using Flo</div>
              </>
            ) : s.phase === "error" ? (
              <>
                <div className="relative mb-1 flex items-center gap-1.5 font-semibold text-amber-300">
                  <TriangleAlert size={13} /> Update didn't finish
                </div>
                <div className="relative mb-2.5 line-clamp-2 text-muted" title={s.error}>
                  {s.error}
                </div>
                <Button size="sm" className="relative w-full justify-center" icon={<RefreshCw size={13} />} onClick={installUpdate}>
                  Try again
                </Button>
              </>
            ) : (
              <>
                <div className="relative mb-1 flex items-center gap-1.5 font-semibold text-[var(--fg)]">
                  <Sparkles size={13} className="text-brand-300" /> Flo {s.version} is available
                </div>
                {s.notes && <div className="relative mb-2.5 line-clamp-2 text-muted">{s.notes}</div>}
                <Button size="sm" variant="primary" className="relative w-full justify-center" icon={<ArrowDownToLine size={13} />} onClick={installUpdate}>
                  {s.downloadUrl ? "Download" : "Update"}
                </Button>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Settings → General → Updates. */
export function UpdateSettingsRow() {
  const s = useUpdate();
  const status =
    s.phase === "checking"
      ? "Checking…"
      : s.phase === "uptodate"
        ? `You're on the latest version${s.current ? ` (${s.current})` : ""}.`
        : s.phase === "available"
          ? s.opened
            ? `Flo ${s.version}: the installer is downloading in your browser. Run it to update.`
            : `Flo ${s.version} is available.`
          : s.phase === "downloading"
            ? `Downloading Flo ${s.version ?? ""}…`
            : s.phase === "ready"
              ? `Flo ${s.version} is installed. Restart to finish.`
              : s.phase === "error"
                ? s.error ?? "Couldn't check for updates."
                : "Flo checks for updates on its own every few hours.";
  return (
    <div className="flex items-center justify-between gap-4 py-3" data-testid="update-settings">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">Updates</div>
        <div className={`mt-0.5 text-[12px] ${s.phase === "error" ? "text-amber-300" : "text-muted"}`} data-testid="update-status">
          {status}
        </div>
        {s.phase === "available" && s.notes && <div className="mt-1 max-w-md whitespace-pre-line text-[12px] text-faint">{s.notes}</div>}
        {s.phase === "downloading" && (
          <div className="mt-2 w-64">
            <Progress s={s} />
          </div>
        )}
      </div>
      <div className="shrink-0">
        {s.phase === "available" ? (
          <Button size="sm" variant="primary" icon={<ArrowDownToLine size={13} />} onClick={installUpdate}>
            {s.downloadUrl ? "Download" : "Update"}
          </Button>
        ) : s.phase === "ready" ? (
          <Button size="sm" variant="primary" icon={<RotateCw size={13} />} onClick={restartToUpdate}>
            Restart now
          </Button>
        ) : (
          <Button size="sm" icon={<RefreshCw size={13} className={s.phase === "checking" ? "animate-spin" : ""} />} disabled={s.phase === "checking" || s.phase === "downloading"} onClick={() => checkForUpdate()}>
            Check for updates
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Full-width bar at the top of the window whenever a new version exists: "Flo 0.1.2 is available ·
 * Update now". Shows progress while downloading and "Restart to finish" when ready. Hidden for this
 * version once dismissed (it comes back for the next one). Checks once when the window opens.
 */
export function UpdateBanner() {
  const s = useUpdate();
  const [hidden, setHidden] = useState<string | null>(() => {
    try {
      return localStorage.getItem("flo:update-dismissed");
    } catch {
      return null;
    }
  });
  useEffect(() => {
    const t = setTimeout(() => void checkForUpdate().catch(() => {}), 1500);
    return () => clearTimeout(t);
  }, []);
  const show = (s.phase === "available" || s.phase === "downloading" || s.phase === "ready") && !(s.phase === "available" && hidden === s.version);
  if (!show) return null;
  const pct = progressPct(s);
  return (
    <div className="hw relative z-20 mx-4 mt-3 flex items-center gap-3 overflow-hidden rounded-2xl bg-[#0b1220] px-4 py-2.5 text-white shadow-[0_10px_30px_-12px_rgba(11,18,32,0.6)]" role="status" data-testid="update-banner">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#5fb8ff] to-[#b48cff]">
        <ArrowDownToLine size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold">
          {s.phase === "ready" ? `Flo ${s.version ?? ""} is ready` : s.phase === "downloading" ? `Downloading Flo ${s.version ?? ""}` : `Flo ${s.version ?? ""} is available`}
        </p>
        <p className="truncate text-[12px] text-white/60">
          {s.phase === "ready" ? "Restart once to finish. Your work is saved." : s.phase === "downloading" ? (pct != null ? `${pct}% · keep working` : "In the background, keep working") : (s.notes?.split("\n")[0]?.replace(/\*\*/g, "") ?? "New features and fixes")}
        </p>
      </div>
      {s.phase === "downloading" && (
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10">
          <div className="h-full bg-gradient-to-r from-[#5fb8ff] to-[#b48cff] transition-[width] duration-300" style={{ width: `${pct ?? 15}%` }} />
        </div>
      )}
      {s.phase === "available" && (
        <>
          <button type="button" onClick={() => void installUpdate()} className="shrink-0 rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold text-[#0b1220] transition hover:bg-white/90" data-testid="update-now">
            {s.downloadUrl ? "Download" : "Update now"}
          </button>
          <button
            type="button"
            aria-label="Remind me later"
            title="Remind me later"
            onClick={() => {
              try {
                localStorage.setItem("flo:update-dismissed", s.version ?? "");
              } catch {
                /* private mode */
              }
              setHidden(s.version ?? "");
            }}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
          >
            <X size={14} />
          </button>
        </>
      )}
      {s.phase === "ready" && (
        <button type="button" onClick={restartToUpdate} className="shrink-0 rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold text-[#0b1220] transition hover:bg-white/90" data-testid="update-restart">
          Restart now
        </button>
      )}
    </div>
  );
}
