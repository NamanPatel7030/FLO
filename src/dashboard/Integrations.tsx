// Settings → Integrations: agent tools (Claude Code, Codex, Cursor, webhook) + Slack.
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { Asterisk, Check, ChevronDown, Copy, MousePointer2, Plug, RefreshCw, Terminal, Unplug, Webhook } from "lucide-react";
import { api } from "../lib/api";
import { copyText } from "../lib/clipboard";
import type { Integration } from "../lib/types";
import { useStore } from "./store";
import { Button, Card, CardTitle, Input, Skeleton, Toggle } from "./ui";

const LOOK: Record<string, { icon: React.ReactNode; bg: string }> = {
  claude: { icon: <Asterisk size={18} strokeWidth={3} />, bg: "bg-[#d97757] text-white" },
  codex: { icon: <Terminal size={17} />, bg: "bg-white text-black" },
  cursor: { icon: <MousePointer2 size={16} />, bg: "bg-[#0b0b0b] text-white border border-white/20" },
  webhook: { icon: <Webhook size={17} />, bg: "bg-brand-400/20 text-brand-200 border border-brand-300/30" },
};

export function Integrations() {
  const toast = useStore((x) => x.toast);
  const [list, setList] = useState<Integration[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    api.listIntegrations().then(setList);
  }, []);
  const act = async (it: Integration, on: boolean) => {
    setBusy(it.id);
    try {
      setList(await (on ? api.installIntegration(it.id) : api.uninstallIntegration(it.id)));
      toast({ kind: "success", text: `${it.name} ${on ? "connected" : "disconnected"}` });
    } catch (e) {
      toast({ kind: "error", text: String(e) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="-mb-1 text-[12.5px] text-muted">Agents ping Flo on 127.0.0.1 when they finish or need you. Sessions show up in the notch.</p>
      {!list ? (
        <Skeleton className="h-52" />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="integrations-grid">
          {list.map((it) => (
            <IntegrationCard key={it.id} it={it} busy={busy === it.id} onToggle={(on) => act(it, on)} />
          ))}
        </div>
      )}
      <SlackCard />
    </div>
  );
}

function StatusPill({ it }: { it: Integration }) {
  const [label, cls] = !it.available
    ? ["Not found on this Mac", "bg-[var(--glass-strong)] text-faint"]
    : it.installed
      ? ["Connected", "bg-emerald-400/15 text-emerald-300"]
      : ["Not installed", "bg-[var(--glass-strong)] text-muted"];
  return <span className={clsx("rounded-full px-2 py-0.5 text-[10.5px] font-medium", cls)}>{label}</span>;
}

function IntegrationCard({ it, busy, onToggle }: { it: Integration; busy: boolean; onToggle: (on: boolean) => void }) {
  const look = LOOK[it.id] ?? LOOK.webhook;
  const webhook = it.id === "webhook";
  const [copied, setCopied] = useState(false);
  const shown = it.configPath.replace(/token=[^&]+/, "token=•••");
  return (
    <Card className="flex flex-col gap-3 p-4" >
      <div className="flex items-start gap-3" data-testid="integration-card">
        <span className={clsx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", look.bg)}>{look.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold">{it.name}</span>
            <StatusPill it={it} />
          </div>
          <p className="mt-0.5 text-[12px] text-muted">{it.note}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-xl bg-[var(--glass)] px-2.5 py-1.5">
        <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint" title={shown}>
          {shown}
        </code>
        {webhook && (
          <button
            onClick={async () => {
              if (await copyText(it.configPath)) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              }
            }}
            className="rounded-lg p-1 text-faint hover:text-[var(--fg)]"
            title="Copy webhook URL"
            aria-label="Copy webhook URL"
          >
            {copied ? <Check size={13} className="text-brand-300" /> : <Copy size={13} />}
          </button>
        )}
      </div>
      {!webhook && (
        <div className="flex justify-end">
          {it.installed ? (
            <Button size="sm" variant="glass" icon={<Unplug size={13} />} disabled={busy} onClick={() => onToggle(false)}>
              Disconnect
            </Button>
          ) : (
            <Button size="sm" variant="primary" icon={<Plug size={13} />} disabled={busy || !it.available} onClick={() => onToggle(true)}>
              Connect
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

const SlackIcon = () => (
  <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden>
    <path fill="#E01E5A" d="M5 15a2 2 0 1 1-2-2h2v2Zm1 0a2 2 0 1 1 4 0v5a2 2 0 1 1-4 0v-5Z" />
    <path fill="#36C5F0" d="M9 5a2 2 0 1 1 2-2v2H9Zm0 1a2 2 0 1 1 0 4H4a2 2 0 1 1 0-4h5Z" />
    <path fill="#2EB67D" d="M19 9a2 2 0 1 1 2 2h-2V9Zm-1 0a2 2 0 1 1-4 0V4a2 2 0 1 1 4 0v5Z" />
    <path fill="#ECB22E" d="M15 19a2 2 0 1 1-2 2v-2h2Zm0-1a2 2 0 1 1 0-4h5a2 2 0 1 1 0 4h-5Z" />
  </svg>
);

function SlackCard() {
  const { toast, settings, setSettings } = useStore();
  const [who, setWho] = useState<string | null | undefined>(undefined);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    api.slackStatus().then(setWho);
  }, []);
  const connect = async () => {
    setBusy(true);
    try {
      setWho(await api.slackConnect(token.trim()));
      setToken("");
      toast({ kind: "success", text: "Slack connected" });
    } catch (e) {
      toast({ kind: "error", text: String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="p-5" >
      <CardTitle icon={<SlackIcon />}>Slack</CardTitle>
      {who === undefined ? (
        <Skeleton className="h-16" />
      ) : who ? (
        <div className="flex flex-col gap-3" data-testid="slack-connected">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
            <span className="font-medium">{who}</span>
          </div>
          {settings && (
            <Toggle
              label="Turn unanswered DMs and mentions into to-dos"
              hint="Checked locally. Messages are never sent without your OK in the notch."
              checked={settings.slackSync}
              onChange={(v) => setSettings({ ...settings, slackSync: v })}
            />
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              icon={<RefreshCw size={13} />}
              onClick={async () => {
                try {
                  const n = await api.slackSyncNow();
                  toast({ kind: "success", text: `${n} to-do${n === 1 ? "" : "s"} added` });
                } catch (e) {
                  toast({ kind: "error", text: String(e) });
                }
              }}
            >
              Sync now
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Unplug size={13} />}
              onClick={async () => {
                await api.slackDisconnect();
                setWho(null);
              }}
            >
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Input type="password" placeholder="xoxp-…" aria-label="Slack token" value={token} onChange={(e) => setToken(e.target.value)} className="font-mono" />
            <Button variant="primary" disabled={!token.trim() || busy} onClick={connect} icon={<Plug size={13} />}>
              Connect
            </Button>
          </div>
          <button onClick={() => setHelp((v) => !v)} className="flex items-center gap-1 self-start text-[12px] text-brand-300 hover:text-brand-200">
            How to get a token <ChevronDown size={13} className={clsx("transition", help && "rotate-180")} />
          </button>
          <AnimatePresence>
            {help && (
              <motion.ol initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="list-decimal overflow-hidden pl-5 text-[12px] leading-relaxed text-muted">
                <li>Create an app at api.slack.com/apps (from scratch, pick your workspace).</li>
                <li>Open OAuth &amp; Permissions.</li>
                <li>
                  Under User Token Scopes add: <code className="font-mono text-[11px] text-[var(--fg)]">channels:history groups:history im:history mpim:history im:read users:read search:read chat:write</code>
                </li>
                <li>Install to workspace.</li>
                <li>Copy the User OAuth Token (starts with xoxp) and paste it above.</li>
              </motion.ol>
            )}
          </AnimatePresence>
        </div>
      )}
    </Card>
  );
}
