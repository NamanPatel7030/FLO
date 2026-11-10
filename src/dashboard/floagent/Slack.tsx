// Flo Agent → Slack: the one Slack page. Top: one status and the single next step (Install,
// Play or Pause). Then "Answer @Flo in Slack" (Hermes' Slack bot, Socket Mode, tokens in the
// keychain) and "Slack to-dos" (Flo's own Slack connection, src-tauri/src/slack.rs).
import { useEffect, useState } from "react";
import clsx from "clsx";
import { Check, ExternalLink, Lock, X } from "lucide-react";
import { api } from "../../lib/api";
import type { KeyProvider } from "../../lib/types";
import { agentApi, slackReadiness, type AgentConfig, type SlackBotCheck } from "../../lib/floAgent";
import { useStore } from "../store";
import { openExternal } from "../Signature";
import { SlackCard, SlackIcon } from "../SlackCard";
import { Button, Card, Input, Skeleton } from "../ui";
import { HermesAction, InstallProgress, useHermes, type HermesHook } from "./HermesControls";

type Save = (c: AgentConfig) => Promise<AgentConfig>;

export function SlackPage({ cfg, save, reload }: { cfg: AgentConfig | null; save: Save; reload: () => void }) {
  const toast = useStore((s) => s.toast);
  const h = useHermes();
  const [bot, setBot] = useState<SlackBotCheck | null>(null);
  const [editing, setEditing] = useState(false);
  const hasBot = !!h.st?.slackBotToken;

  // check the bot token with Slack, and fill an empty allow-list with the user's own Member ID
  const check = async () => {
    try {
      const r = await agentApi.hermesSlackCheck();
      setBot(r);
      if (r.autofilled) {
        reload();
        toast({ kind: "success", text: `Added you (${r.autofilled}) to who can talk to Flo` });
      }
    } catch {
      setBot(null);
    }
  };
  // the config may have changed elsewhere (an autofilled allow-list, Play / Pause): read it fresh
  useEffect(reload, [reload]);
  useEffect(() => {
    if (hasBot) check();
    else setBot(null);
  }, [hasBot]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cfg || !h.st) return <Skeleton className="h-72" />;
  const r = slackReadiness(h.st, cfg, bot, h.install.phase === "running");
  const connected = r.botReady && !!bot?.ok;
  return (
    <div data-testid="agent-slack" className="flex flex-col gap-5">
      <Hero h={h} blocker={r.blocker} checks={r.checks} onFix={(id) => (id === "bot" || id === "app" || id === "people" ? setEditing(true) : undefined)} />
      <Card className="p-5" >
        <div data-testid="slack-bot" className="contents">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#fff]">
              <SlackIcon size={17} />
            </span>
            <div className="text-[14.5px] font-semibold">Answer @Flo in Slack</div>
          </div>
          {connected && !editing ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 rounded-xl bg-[var(--glass)] px-3.5 py-2.5 text-[13px]" data-testid="slack-bot-connected">
                <Check size={14} className="text-emerald-500 dark:text-emerald-300" strokeWidth={3} />
                <span className="min-w-0 flex-1 truncate">
                  Bot connected: <b>@{bot?.bot}</b>
                  {bot?.team ? ` in ${bot.team}` : ""}
                </span>
                <button className="text-[12px] text-brand-300 hover:underline" onClick={() => setEditing(true)}>
                  Change
                </button>
              </div>
              <p className="text-[12px] text-muted">
                Mention @{bot?.bot} in any channel it's in (type <code className="font-mono">/invite @{bot?.bot}</code> in the channel first), or send it a DM. People allowed: {cfg.slackAllowedUsers.split(",").join(", ")}.
              </p>
            </div>
          ) : (
            <Setup cfg={cfg} save={save} h={h} bot={bot} onSaved={() => (h.refresh(), check())} onDone={connected ? () => setEditing(false) : undefined} />
          )}
        </div>
      </Card>
      <SlackCard />
    </div>
  );
}

function Hero({ h, blocker, checks, onFix }: { h: HermesHook; blocker: string | null; checks: ReturnType<typeof slackReadiness>["checks"]; onFix: (id: string) => void }) {
  const st = h.st!;
  const installing = h.install.phase === "running" || st.installing;
  const liveInSlack = st.phase === "live" && st.slackRunning && !st.slackError;
  const title = installing
    ? "Installing Hermes…"
    : !st.installed
      ? st.broken
        ? "Hermes needs a repair"
        : "Install Hermes to answer in Slack"
      : st.phase === "paused"
        ? "Paused"
        : st.phase === "error"
          ? "Hermes stopped"
          : st.phase === "starting"
            ? "Starting…"
            : liveInSlack
              ? "Flo is live in Slack"
              : "Hermes is running";
  return (
    <Card strong className="p-5">
      <div data-testid="slack-hero" data-phase={installing ? "installing" : st.phase} className="contents">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <span className={clsx("h-2.5 w-2.5 shrink-0 rounded-full", liveInSlack ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]" : st.phase === "error" ? "bg-rose-400" : installing || st.phase === "starting" ? "bg-amber-400" : "bg-[var(--border-strong)]")} />
          <div className="min-w-[200px] flex-1">
            <div className="text-[18px] font-semibold tracking-tight" data-testid="slack-status">
              {title}
            </div>
            {blocker && !installing && (
              <div className="mt-0.5 text-[12.5px] text-muted" data-testid="slack-blocker">
                {blocker}
              </div>
            )}
          </div>
          <HermesAction h={h} />
        </div>
        <InstallProgress h={h} />
        <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Slack readiness" data-testid="slack-checks">
          {checks.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={c.ok || c.id === "installed" || c.id === "live"}
                onClick={() => onFix(c.id)}
                data-ok={c.ok}
                className={clsx("flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium", c.ok ? "bg-emerald-400/12 text-emerald-700 dark:text-emerald-300" : "bg-[var(--glass)] text-muted hover:text-[var(--fg)]")}
              >
                {c.ok ? <Check size={11} strokeWidth={3} /> : <X size={11} />}
                {c.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/** Three steps, shown only while something is missing (or on Change). */
function Setup({ cfg, save, h, bot, onSaved, onDone }: { cfg: AgentConfig; save: Save; h: HermesHook; bot: SlackBotCheck | null; onSaved: () => void; onDone?: () => void }) {
  const toast = useStore((s) => s.toast);
  const st = h.st!;
  const [ids, setIds] = useState(cfg.slackAllowedUsers.split(",").filter(Boolean).join(", "));
  useEffect(() => setIds(cfg.slackAllowedUsers.split(",").filter(Boolean).join(", ")), [cfg.slackAllowedUsers]);
  const tokens = st.slackBotToken && st.slackAppToken;
  const saveIds = async () => {
    const c = await save({ ...cfg, slackAllowedUsers: ids });
    setIds(c.slackAllowedUsers.split(",").filter(Boolean).join(", "));
    toast({ kind: c.slackAllowedUsers ? "success" : "error", text: c.slackAllowedUsers ? "Saved who can talk to Flo" : "No valid Member IDs. They look like U01ABC2DEF3." });
  };
  const step = (n: number, done: boolean, title: string, body: React.ReactNode, child?: React.ReactNode) => (
    <li className="flex gap-3.5">
      <span className={clsx("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold", done ? "bg-emerald-400/15 text-emerald-600 dark:text-emerald-300" : "bg-[var(--glass-strong)] text-muted")}>{done ? <Check size={12} strokeWidth={3} /> : n}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium">{title}</div>
        {body && <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{body}</div>}
        {child && <div className="mt-2.5">{child}</div>}
      </div>
    </li>
  );
  return (
    <ol className="flex flex-col gap-5" data-testid="slack-setup">
      {step(
        1,
        tokens,
        "Create the Slack app",
        "Slack opens with everything filled in. Click Create, then Install to Workspace.",
        <Button size="sm" icon={<ExternalLink size={12} />} onClick={() => openExternal(st.slackAppUrl)}>
          Create Slack app
        </Button>,
      )}
      {step(
        2,
        tokens && (bot ? bot.ok : true),
        "Paste the two tokens",
        <>
          Bot token: <i>Install App</i>, Bot User OAuth Token. App token: <i>Basic Information</i>, App-Level Tokens, Generate with the connections:write scope. Both stay in your keychain.
        </>,
        <div className="flex flex-col gap-2">
          <SecretField k="hermes_slack_bot" label="Bot token" prefix="xoxb-" onChange={onSaved} />
          {bot && !bot.ok && st.slackBotToken && (
            <p className="text-[12px] text-rose-600 dark:text-rose-300" data-testid="slack-bot-error">
              {bot.error}
            </p>
          )}
          <SecretField k="hermes_slack_app" label="App token" prefix="xapp-" onChange={onSaved} />
        </div>,
      )}
      {step(
        3,
        !!cfg.slackAllowedUsers,
        "Who can talk to Flo",
        "Slack Member IDs (profile, ⋮, Copy member ID). Everyone else is ignored.",
        <div className="flex gap-2">
          <Input aria-label="Allowed Slack Member IDs" placeholder="U01ABC2DEF3, U04XYZ9KLM1" value={ids} onChange={(e) => setIds(e.target.value)} spellCheck={false} />
          <Button onClick={saveIds} disabled={ids.replace(/\s/g, "") === cfg.slackAllowedUsers}>
            Save
          </Button>
        </div>,
      )}
      {onDone && (
        <li>
          <Button size="sm" variant="ghost" onClick={onDone}>
            Done
          </Button>
        </li>
      )}
    </ol>
  );
}

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
        <span className="w-[76px] shrink-0 text-[12px] text-faint">{label}</span>
        <span className="flex flex-1 items-center gap-1.5 text-[12.5px] text-emerald-600 dark:text-emerald-300">
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
        <Input type="password" autoComplete="off" spellCheck={false} aria-label={label} placeholder={`${label}: ${prefix}…`} value={val} onChange={(e) => (setVal(e.target.value), setErr(""))} />
        {err && <div className="mt-1 text-[11.5px] text-red-500 dark:text-red-300">{err}</div>}
      </div>
      <Button size="md" type="submit" disabled={!val.trim()}>
        Save
      </Button>
    </form>
  );
}

