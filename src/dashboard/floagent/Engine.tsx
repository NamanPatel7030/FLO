// Flo Agent → Engine (Flo built in, or Hermes Agent) and → Slack (Hermes' Slack gateway).
// Flo never installs Hermes and never asks for passwords: it detects the user's own install,
// shows the official command to copy, and keeps Slack tokens in the OS keychain.
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, BookOpen, Check, ExternalLink, FolderOpen, Lock, Play, RefreshCw, Square, Upload } from "lucide-react";
import { api, on } from "../../lib/api";
import { relativeTime } from "../../lib/format";
import type { KeyProvider } from "../../lib/types";
import { AGENT_EV, agentApi, HERMES_SLACK_DOCS, type AgentConfig, type HermesStatus } from "../../lib/floAgent";
import { useStore } from "../store";
import { openExternal } from "../Signature";
import { LogoMark } from "../Logo";
import { SlackIcon } from "../SlackCard";
import { Button, Card, Input, PageHeader, Skeleton, Toggle } from "../ui";
import { CopyCommand, Dot, HermesTile } from "./parts";

type Save = (c: AgentConfig) => Promise<AgentConfig>;

/** Hermes status, refreshed on open, on status events and when the window comes back (no timers). */
export function useHermes() {
  const [st, setSt] = useState<HermesStatus | null>(null);
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
    const off = on<HermesStatus>(AGENT_EV.hermes, setSt);
    const vis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", vis);
    return () => {
      off();
      document.removeEventListener("visibilitychange", vis);
    };
  }, [refresh]);
  return { st, setSt, refresh, checking };
}

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
          body="Nous Research's self-improving agent, running on your Mac with Flo's apps, skills and persona. Adds memory it learns and a Slack gateway."
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

function HermesCard({ h, cfg, save }: { h: ReturnType<typeof useHermes>; cfg: AgentConfig | null; save: Save }) {
  const toast = useStore((s) => s.toast);
  const { st } = h;
  const [busy, setBusy] = useState<"start" | "stop" | "export" | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    agentApi.hermesLog().then(setLog);
    return on<string>(AGENT_EV.hermesLog, (l) => setLog((xs) => [...xs.slice(-199), l]));
  }, []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log.length]);

  const act = async (kind: "start" | "stop" | "export") => {
    setBusy(kind);
    try {
      if (kind === "export") {
        const sum = await agentApi.hermesExport();
        h.setSt((s) => (s ? { ...s, export: sum } : s));
        toast({ kind: "success", text: `Exported ${sum.mcpServers} MCP server${sum.mcpServers === 1 ? "" : "s"} and ${sum.skills} skill${sum.skills === 1 ? "" : "s"} to Hermes` });
      } else {
        h.setSt(await (kind === "start" ? agentApi.hermesStart() : agentApi.hermesStop()));
      }
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
                <Dot on={st.running && st.healthy} warn={st.running && !st.healthy} />
                {!st.installed ? (st.broken ? "Install incomplete" : "Not installed") : st.running ? (st.healthy ? `Running on 127.0.0.1:${st.port}` : "Starting…") : "Stopped"}
              </span>
            </div>
            <div className="mt-1 text-[12.5px] text-muted">
              {st.installed
                ? "Your own Hermes, started by Flo with Flo's apps and skills. It uses your AI key and asks before risky commands."
                : st.broken
                  ? `Hermes isn't fully installed: ${st.path ?? "the hermes launcher"} is there but doesn't run (${st.broken}). Run the install command again in Terminal, then check again.`
                  : "Not found on this Mac. Flo never installs software for you: copy the official command, run it in Terminal, then check again."}
            </div>
          </div>
          {st.installed && (
            <div className="flex shrink-0 gap-2">
              {st.running ? (
                <Button icon={<Square size={11} className="fill-current" />} disabled={!!busy} onClick={() => act("stop")}>
                  Stop
                </Button>
              ) : (
                <Button variant="primary" icon={<Play size={12} className="fill-current" />} disabled={!!busy} onClick={() => act("start")}>
                  {busy === "start" ? "Starting…" : "Start Hermes"}
                </Button>
              )}
            </div>
          )}
        </div>

        {!st.installed ? (
          <div className="mt-4 flex flex-col gap-3" data-testid="hermes-install">
            <CopyCommand cmd={st.installCommand} label="Copy install command" />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" icon={<RefreshCw size={12} className={clsx(h.checking && "animate-spin")} />} onClick={h.refresh} disabled={h.checking}>
                Check again
              </Button>
              <Button size="sm" variant="ghost" icon={<BookOpen size={12} />} onClick={() => openExternal(st.docsUrl)}>
                Install guide
              </Button>
              <span className="ml-auto text-[11.5px] text-faint">Apple Silicon Macs · tested with v{st.testedVersion}</span>
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

// ── Slack gateway ───────────────────────────────────────────────────────────
/** A token pasted once into the OS keychain (the same secure path as AI keys). */
function SecretField({ k, label, prefix, onChange }: { k: KeyProvider; label: string; prefix: string; onChange?: () => void }) {
  const toast = useStore((s) => s.toast);
  const [has, setHas] = useState<boolean | null>(null);
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    api.hasApiKey(k).then(setHas).catch(() => setHas(false));
  }, [k]);
  if (has === null) return <Skeleton className="h-9 w-full" />;
  if (has)
    return (
      <div className="flex h-9 items-center gap-2" data-testid={`secret-${k}`}>
        <span className="flex flex-1 items-center gap-1.5 text-[12.5px] text-emerald-300">
          <Lock size={12} /> Saved in your keychain
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            await api.deleteApiKey(k);
            setHas(false);
            onChange?.();
          }}
        >
          Remove
        </Button>
      </div>
    );
  return (
    <form
      className="flex items-start gap-2"
      data-testid={`secret-${k}`}
      onSubmit={async (e) => {
        e.preventDefault();
        const v = val.trim();
        if (!v.startsWith(prefix)) {
          setErr(`${label} starts with ${prefix}`);
          return;
        }
        try {
          await api.setApiKey(k, v);
          setVal("");
          setErr("");
          setHas(true);
          onChange?.();
          toast({ kind: "success", text: `${label} saved in your keychain` });
        } catch (x) {
          setErr(String(x));
        }
      }}
    >
      <div className="flex-1">
        <Input type="password" autoComplete="off" spellCheck={false} aria-label={label} placeholder={`${prefix}…`} value={val} onChange={(e) => (setVal(e.target.value), setErr(""))} />
        {err && <div className="mt-1 text-[11.5px] text-red-300">{err}</div>}
      </div>
      <Button size="md" type="submit" disabled={!val.trim()}>
        Save
      </Button>
    </form>
  );
}

export function SlackGateway({ cfg, save }: { cfg: AgentConfig | null; save: Save }) {
  const toast = useStore((s) => s.toast);
  const go = useStore((s) => s.go);
  const h = useHermes();
  const [ids, setIds] = useState("");
  useEffect(() => {
    if (cfg) setIds(cfg.slackAllowedUsers.split(",").filter(Boolean).join(", "));
  }, [cfg?.slackAllowedUsers]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cfg) return <Skeleton className="h-72" />;
  const st = h.st;
  const tokens = !!st?.slackBotToken && !!st?.slackAppToken;
  const idsSaved = cfg.slackAllowedUsers.length > 0;
  const live = !!st?.slackRunning;
  const saveIds = async () => {
    const c = await save({ ...cfg, slackAllowedUsers: ids });
    setIds(c.slackAllowedUsers.split(",").filter(Boolean).join(", "));
    toast({ kind: "success", text: c.slackAllowedUsers ? "Allowed people saved" : "No valid Member IDs. They look like U01ABC2DEF3." });
  };
  const step = (n: number, done: boolean, title: string, body: React.ReactNode, child?: React.ReactNode) => (
    <li className="flex gap-4">
      <span className={clsx("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold", done ? "bg-emerald-400/15 text-emerald-300" : "bg-[var(--glass-strong)] text-muted")}>{done ? <Check size={12} strokeWidth={3} /> : n}</span>
      <div className="min-w-0 flex-1 pb-1">
        <div className="text-[13.5px] font-medium">{title}</div>
        <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{body}</div>
        {child && <div className="mt-2.5">{child}</div>}
      </div>
    </li>
  );
  return (
    <div data-testid="agent-slack">
      <PageHeader title="Slack gateway" subtitle="Talk to your Flo Hermes from Slack. Hermes connects through your own Slack app, so messages go from Slack to your Mac and nowhere else." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="p-6">
          <ol className="flex flex-col gap-5">
            {step(
              1,
              tokens,
              "Create a Slack app for Hermes",
              "Turn on Socket Mode, add a bot user, and install the app to your workspace. The Hermes guide lists the scopes to add.",
              <Button size="sm" icon={<ExternalLink size={12} />} onClick={() => openExternal(HERMES_SLACK_DOCS)}>
                Open the Slack guide
              </Button>,
            )}
            {step(2, !!st?.slackBotToken, "Bot token", "From OAuth & Permissions. You paste it here once; Flo keeps it in your keychain and hands it only to Hermes.", <SecretField k="hermes_slack_bot" label="Bot token" prefix="xoxb-" onChange={h.refresh} />)}
            {step(3, !!st?.slackAppToken, "App token", "From Basic Information → App-Level Tokens, with the connections:write scope.", <SecretField k="hermes_slack_app" label="App token" prefix="xapp-" onChange={h.refresh} />)}
            {step(
              4,
              idsSaved,
              "Who can talk to it",
              "Slack Member IDs, separated by commas (profile → ⋯ → Copy member ID). Nobody else can use the bot.",
              <div className="flex gap-2">
                <Input aria-label="Allowed Slack Member IDs" placeholder="U01ABC2DEF3, U04XYZ9KLM1" value={ids} onChange={(e) => setIds(e.target.value)} spellCheck={false} />
                <Button onClick={saveIds} disabled={ids.replace(/\s/g, "") === cfg.slackAllowedUsers}>
                  Save
                </Button>
              </div>,
            )}
            {step(
              5,
              cfg.slackEnabled,
              "Turn it on",
              "Hermes joins Slack every time Flo starts it.",
              <div className="rounded-xl bg-[var(--glass)] px-3.5">
                <Toggle checked={cfg.slackEnabled} onChange={(v) => save({ ...cfg, slackEnabled: v })} label="Connect Slack when Hermes starts" hint={tokens && idsSaved ? undefined : "Needs both tokens and at least one Member ID."} />
              </div>,
            )}
          </ol>
        </Card>
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white">
                <SlackIcon size={20} />
              </span>
              <div>
                <div className="text-[14px] font-semibold">Hermes in Slack</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted" data-testid="slack-gateway-state">
                  <Dot on={live} />
                  {live ? "Live in your workspace" : !st?.installed ? "Needs Hermes" : st.running ? "Running without Slack" : "Off"}
                </div>
              </div>
            </div>
            <div className="mt-4">
              {!st ? (
                <Skeleton className="h-9" />
              ) : !st.installed ? (
                <Button className="w-full" onClick={() => go("agent", "engine")}>
                  Set up Hermes first
                </Button>
              ) : st.running ? (
                <Button className="w-full" onClick={async () => (await agentApi.hermesStop(), h.setSt(await agentApi.hermesStart()))}>
                  Restart Hermes to apply
                </Button>
              ) : (
                <Button variant="primary" className="w-full" icon={<Play size={12} className="fill-current" />} onClick={async () => h.setSt(await agentApi.hermesStart().catch((e) => (toast({ kind: "error", text: String(e) }), st)))}>
                  Start Hermes
                </Button>
              )}
            </div>
          </Card>
          <Card className="p-4 text-[12px] leading-relaxed text-muted">
            This is separate from <button className="text-brand-300 hover:underline" onClick={() => go("agent", "apps")}>Connect Slack</button> in Apps, which turns your Slack DMs and mentions into to-dos.
          </Card>
        </div>
      </div>
    </div>
  );
}
