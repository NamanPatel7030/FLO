// Flo Agent → Engine: Flo built in, or Hermes Agent. Hermes installs with one click (Flo runs the
// official installer when the user asks) and runs with Play / Pause. Slack lives in Slack.tsx.
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, BookOpen, Check, FolderOpen, RefreshCw, Upload } from "lucide-react";
import { on } from "../../lib/api";
import { relativeTime } from "../../lib/format";
import { AGENT_EV, agentApi, type AgentConfig } from "../../lib/floAgent";
import { useStore } from "../store";
import { openExternal } from "../Signature";
import { LogoMark } from "../Logo";
import { Button, Card, PageHeader, Skeleton, Toggle } from "../ui";
import { HermesAction, InstallProgress, useHermes, type HermesHook } from "./HermesControls";
import { Dot, HermesTile } from "./parts";

type Save = (c: AgentConfig) => Promise<AgentConfig>;

export function EnginePanel({ cfg, save }: { cfg: AgentConfig | null; save: Save }) {
  const toast = useStore((s) => s.toast);
  const h = useHermes();
  const pick = async (engine: "flo" | "hermes") => {
    if (!cfg || cfg.engine === engine) return;
    await save({ ...cfg, engine });
    toast({ kind: "success", text: engine === "hermes" ? "Flo Agent now uses Hermes for app and answer tasks" : "Flo Agent now uses Flo's built-in engine" });
  };
  return (
    <div data-testid="agent-engine">
      <PageHeader title="Engine" subtitle="What thinks behind Flo Agent. Screen control and your skills always run in Flo; the engine handles app and answer tasks." />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2" role="radiogroup" aria-label="Engine">
        <EngineOption
          selected={cfg?.engine !== "hermes"}
          onSelect={() => pick("flo")}
          tile={<LogoMark size={40} className="rounded-xl" />}
          title="Flo"
          badge="Built in"
          body="Screen control, your apps and skills, with your own AI key. Nothing else to install."
        />
        <EngineOption
          selected={cfg?.engine === "hermes"}
          disabled={!h.st?.installed}
          onSelect={() => pick("hermes")}
          tile={<HermesTile />}
          title="Hermes Agent"
          badge="Open source · MIT"
          body="Nous Research's self-improving agent, running on your computer with Flo's apps, skills and persona. Adds memory it learns and answers in Slack."
          note={h.st && !h.st.installed ? "Install Hermes below to choose it" : undefined}
        />
      </div>
      <HermesCard h={h} cfg={cfg} save={save} />
    </div>
  );
}

function EngineOption({ selected, disabled, onSelect, tile, title, badge, body, note }: { selected: boolean; disabled?: boolean; onSelect: () => void; tile: React.ReactNode; title: string; badge: string; body: string; note?: string }) {
  return (
    <button
      role="radio"
      aria-checked={selected}
      aria-label={title}
      disabled={disabled}
      onClick={onSelect}
      className={clsx(
        "relative flex items-start gap-3.5 rounded-2xl p-5 text-left transition",
        selected ? "glass-strong ring-1 ring-[var(--accent)]/45" : "glass hover:bg-[var(--glass-hover)]",
        disabled && "cursor-not-allowed opacity-60 hover:bg-[var(--glass)]",
      )}
    >
      {tile}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[15px] font-semibold">{title}</span>
          <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[10.5px] font-medium text-muted">{badge}</span>
        </span>
        <span className="mt-1 block text-[12.5px] leading-relaxed text-muted">{body}</span>
        {note && <span className="mt-2 block text-[11.5px] text-faint">{note}</span>}
      </span>
      <span className={clsx("mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition", selected ? "accent-gradient border-transparent text-white" : "border-[var(--border-strong)]")}>
        {selected && <Check size={11} strokeWidth={3} />}
      </span>
    </button>
  );
}

function HermesCard({ h, cfg, save }: { h: HermesHook; cfg: AgentConfig | null; save: Save }) {
  const toast = useStore((s) => s.toast);
  const { st } = h;
  const [busy, setBusy] = useState<"export" | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    agentApi.hermesLog().then(setLog);
    return on<string>(AGENT_EV.hermesLog, (l) => setLog((xs) => [...xs.slice(-199), l]));
  }, []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log.length]);

  const act = async (kind: "export") => {
    setBusy(kind);
    try {
      const sum = await agentApi.hermesExport();
      h.setSt((s) => (s ? { ...s, export: sum } : s));
      toast({ kind: "success", text: `Exported ${sum.mcpServers} MCP server${sum.mcpServers === 1 ? "" : "s"} and ${sum.skills} skill${sum.skills === 1 ? "" : "s"} to Hermes` });
    } catch (e) {
      toast({ kind: "error", text: String(e) });
    } finally {
      setBusy(null);
    }
  };

  if (!st) return <Skeleton className="mt-5 h-56" />;
  return (
    <Card className="mt-5 p-5" >
      <div data-testid="hermes-card" className="contents">
        <div className="flex items-start gap-3.5">
          <HermesTile size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] font-semibold">Hermes Agent</span>
              {st.version && <span className="rounded-full bg-white/[0.07] px-2 py-0.5 font-mono text-[10.5px] text-muted">v{st.version}</span>}
              <span className="flex items-center gap-1.5 text-[12px] text-muted" data-testid="hermes-state">
                <Dot on={st.running && st.healthy} warn={(st.running && !st.healthy) || st.phase === "error"} />
                {h.install.phase === "running" || st.installing
                  ? "Installing…"
                  : !st.installed
                    ? st.broken
                      ? "Install incomplete"
                      : "Not installed"
                    : st.phase === "live"
                      ? `Running on 127.0.0.1:${st.port}`
                      : st.phase === "starting"
                        ? "Starting…"
                        : st.phase === "error"
                          ? "Stopped with an error"
                          : "Paused"}
              </span>
            </div>
            <div className="mt-1 text-[12.5px] text-muted">
              {st.installed
                ? st.phase === "error" && st.error
                  ? st.error
                  : "Your own Hermes, started by Flo with Flo's apps and skills. Play keeps it running, also after a restart; Pause stops it everywhere, Slack included."
                : st.broken
                  ? `Hermes isn't fully installed: ${st.path ?? "the hermes launcher"} is there but doesn't run (${st.broken}). Click Repair Hermes.`
                  : "One click installs Hermes with its official installer (about 3 minutes). It goes where Terminal would put it: ~/.hermes and ~/.local/bin."}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <HermesAction h={h} />
          </div>
        </div>

        {!st.installed ? (
          <div className="mt-4 flex flex-col gap-3" data-testid="hermes-install">
            <InstallProgress h={h} />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" icon={<RefreshCw size={12} className={clsx(h.checking && "animate-spin")} />} onClick={h.refresh} disabled={h.checking}>
                Check again
              </Button>
              <Button size="sm" variant="ghost" icon={<BookOpen size={12} />} onClick={() => openExternal(st.docsUrl)}>
                Install guide
              </Button>
              <span className="ml-auto text-[11.5px] text-faint">Apple Silicon · tested with v{st.testedVersion}</span>
            </div>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-[var(--border)] pt-4 text-[12.5px] md:grid-cols-[120px_minmax(0,1fr)] md:items-center">
            <span className="text-faint">Installed at</span>
            <code className="truncate font-mono text-[12px] text-muted" title={st.path ?? ""}>{st.path}</code>
            <span className="text-faint">Flo's Hermes home</span>
            <span className="flex min-w-0 items-center gap-2">
              <FolderOpen size={13} className="shrink-0 text-faint" />
              <code className="truncate font-mono text-[12px] text-muted" title={st.home}>{st.home}</code>
            </span>
            <span className="text-faint">Exported</span>
            <span className="flex min-w-0 flex-wrap items-center gap-2" data-testid="hermes-export">
              <span className="text-muted">
                {st.export
                  ? `${st.export.mcpServers} MCP server${st.export.mcpServers === 1 ? "" : "s"} · ${st.export.skills} skill${st.export.skills === 1 ? "" : "s"}${st.export.model ? ` · ${st.export.model}` : ""} · ${relativeTime(st.export.at)}`
                  : "Not yet. Flo exports your enabled MCP servers and skills every time it starts Hermes."}
              </span>
              <Button size="sm" variant="ghost" icon={<Upload size={12} />} disabled={!!busy} onClick={() => act("export")}>
                Export now
              </Button>
            </span>
            {st.outdated && (
              <>
                <span className="text-faint">Update</span>
                <span className="flex items-center gap-1.5 text-amber-200">
                  <AlertTriangle size={13} /> Flo was tested with v{st.testedVersion}. Run <code className="font-mono">hermes update</code> in Terminal.
                </span>
              </>
            )}
          </div>
        )}

        {st.installed && cfg && (
          <div className="mt-3 border-t border-[var(--border)] pt-1">
            <Toggle
              checked={cfg.hermesUseFloKey}
              onChange={(v) => save({ ...cfg, hermesUseFloKey: v })}
              label="Use my AI key from Flo"
              hint="Your key goes from the keychain straight to the Hermes process when Flo starts it. It's never written to a file. Off: Hermes uses its own setup."
            />
          </div>
        )}

        {st.installed && (st.running || log.length > 0) && (
          <div className="mt-3">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Hermes output</div>
            <div ref={logRef} className="max-h-[180px] overflow-y-auto rounded-xl border border-white/[0.06] bg-black/35 px-3 py-2.5 font-mono text-[11.5px] leading-[18px] text-muted" data-testid="hermes-log">
              {log.length === 0 ? <span className="text-faint">Waiting for output…</span> : log.map((l, i) => <div key={i} className="whitespace-pre-wrap break-words">{l}</div>)}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
