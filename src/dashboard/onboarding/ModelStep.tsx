// Setup's speech model: the first download (a small model, so Flo is ready in a minute and works
// offline after), the lock on the try-out until it's loaded, and an optional bigger model at the end.
import { motion } from "motion/react";
import { AlertCircle, Check, Cpu, Download, RotateCw, Sparkles } from "lucide-react";
import { api } from "../../lib/api";
import { advancedModels, progressText } from "../../lib/models";
import type { Settings } from "../../lib/types";
import type { Download as Dl, SetupModel } from "../useSpeechModels";
import { Btn, Heading, Rise, Stagger } from "./parts";

const pctOf = (d?: Dl) => (d && d.total > 0 ? Math.min(100, Math.round((d.received / d.total) * 100)) : 0);

function Bar({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[#e6eaf3]" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <motion.div className="h-full rounded-full bg-gradient-to-r from-[#2f8cff] to-[#7a6cff]" initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.25 }} />
    </div>
  );
}

/** Progress, the line under it, and Try again. Shared by the model step and the try-out lock. */
export function ModelProgress({ m, compact }: { m: SetupModel; compact?: boolean }) {
  const d = m.progress;
  const line =
    m.phase === "ready"
      ? "Ready. I work offline from now on."
      : m.phase === "loading"
        ? "Downloaded. Getting it ready..."
        : m.phase === "downloading"
          ? d && d.total > 0
            ? progressText(d.received, d.total, d.bps)
            : "Starting the download..."
          : m.phase === "cloud"
            ? "You picked a cloud engine. Nothing to download."
            : m.phase === "error"
              ? m.error
              : "Checking...";
  const pct = m.phase === "ready" || m.phase === "loading" ? 100 : pctOf(d);
  return (
    <div className="w-full" data-testid="model-progress-box" data-phase={m.phase}>
      {m.phase !== "cloud" && <Bar pct={pct} label="Speech model download" />}
      <div className={`mt-2.5 flex items-center justify-between gap-3 ${compact ? "text-[14px]" : "text-[15px]"}`}>
        <span data-testid={m.phase === "error" ? "model-error" : "model-progress"} className={m.phase === "error" ? "flex items-center gap-1.5 text-[#b4232c]" : m.phase === "ready" ? "font-semibold text-[#1f9e78]" : "text-[#5b6678]"}>
          {m.phase === "error" && <AlertCircle size={16} className="shrink-0" />}
          {m.phase === "ready" && <Check size={16} strokeWidth={3} className="mr-1 inline" />}
          {line}
        </span>
        {m.phase === "downloading" && <span className="shrink-0 font-semibold tabular-nums text-[#0b1220]">{pct}%</span>}
        {m.phase === "error" && (
          <Btn kind="soft" className="!h-10 !px-4 !text-[14px]" icon={<RotateCw size={14} />} onClick={m.retry}>
            Try again
          </Btn>
        )}
      </div>
    </div>
  );
}

/** Step 2: get the small model now. */
export function ModelStep({ title, sub, m }: { title: string; sub: string; m: SetupModel }) {
  const model = m.model;
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col items-center text-center" data-testid="model-step">
      <Heading title={title} sub={sub} />
      <Stagger className="mt-8 w-full">
        <Rise className="onb-glass w-full px-7 py-6 text-left">
          <div className="flex items-center gap-4">
            <span className="onb-icon h-14 w-14 shrink-0">
              <Cpu size={26} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[18px] font-semibold">{m.phase === "cloud" ? "Cloud speech engine" : (model?.label ?? "Speech model")}</div>
              {model && m.phase !== "cloud" && (
                <div className="onb-muted mt-0.5 text-[14px]">
                  {model.sizeMb} MB · {model.languages} · {model.speed}
                </div>
              )}
            </div>
          </div>
          <ModelProgress m={m} />
        </Rise>
        <Rise className="onb-faint mt-4 text-[14.5px]">Want more precision later? Bigger models are in Settings, Voice.</Rise>
      </Stagger>
    </div>
  );
}

/** Shown on the try-out while the model isn't ready: the demo stays locked until it is. */
export function ModelGate({ m }: { m: SetupModel }) {
  return (
    <div className="mt-5 w-full max-w-[680px] rounded-[20px] border border-[#d9e2f3] bg-white/70 px-5 py-4 text-left" data-testid="try-locked">
      <div className="text-[15.5px] font-semibold text-[#0b1220]">{m.phase === "loading" ? "Almost ready. Loading my speech model." : "One moment. I'm still downloading my speech model."}</div>
      <div className="onb-muted mt-0.5 text-[14px]">You can talk to me as soon as it's done.</div>
      <ModelProgress m={m} compact />
    </div>
  );
}

/** End of setup: the more precise model, now. Without a click Flo still gets it in the background
 *  after setup (on a computer that runs it well) and switches once it's downloaded. */
export function AdvancedCard({ m, s, set }: { m: SetupModel; s: Settings; set: (p: Partial<Settings>) => void }) {
  const best = m.models ? advancedModels(m.models)[0] : undefined;
  if (s.sttProvider !== "local" || !best) return null;
  const d = m.dl[best.id];
  const busy = !!d?.active;
  const inUse = s.sttModel === best.id;
  const use = () => {
    set({ sttModel: best.id, sttModelExplicit: true });
    api.loadSpeechModel(best.id).catch(() => {});
  };
  return (
    <div className="onb-glass mt-6 flex w-full max-w-[900px] items-center gap-5 px-6 py-4 text-left" data-testid="advanced-card">
      <span className="onb-icon h-12 w-12 shrink-0">
        <Sparkles size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[16px] font-semibold">Want more precision? {best.label}</div>
        <div className="onb-muted mt-0.5 text-[13.5px]">
          {best.sizeMb} MB · {best.accuracy}. Optional, you can get it later in Settings.
        </div>
        {busy && d && d.total > 0 && (
          <>
            <Bar pct={pctOf(d)} label={`${best.label} download`} />
            <div className="onb-muted mt-1.5 text-[13px]" data-testid="advanced-progress">
              {progressText(d.received, d.total, d.bps)}
            </div>
          </>
        )}
        {d?.error && !busy && <div className="mt-1.5 text-[13px] text-[#b4232c]">{d.error}</div>}
      </div>
      {inUse ? (
        <span className="flex shrink-0 items-center gap-1.5 text-[15px] font-semibold text-[#1f9e78]">
          <Check size={16} strokeWidth={3} /> In use
        </span>
      ) : best.installed ? (
        <Btn className="!h-11 !px-5 !text-[14.5px]" onClick={use}>
          Use this model
        </Btn>
      ) : (
        <Btn kind="soft" className="!h-11 !px-5 !text-[14.5px]" disabled={busy} icon={<Download size={15} />} onClick={() => m.download(best.id)}>
          {busy ? `${pctOf(d)}%` : d?.error ? "Try again" : "Download"}
        </Btn>
      )}
    </div>
  );
}
