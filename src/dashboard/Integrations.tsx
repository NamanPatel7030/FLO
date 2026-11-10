// Settings → Integrations: agent tools (Claude Code, Codex, Cursor, webhook), Google (Calendar + Gmail).
// Slack has one page: Flo Agent → Slack.
import { deviceWord } from "../lib/os";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { ArrowRight, Asterisk, Check, CodeXml, Copy, MousePointer2, Plug, Terminal, Unplug, Webhook } from "lucide-react";
import { CodingAgents } from "./CodingAgents";
import { SlackIcon } from "./SlackCard";
import { GoogleCard } from "./GoogleCard";
import { api } from "../lib/api";
import { copyText } from "../lib/clipboard";
import type { Integration } from "../lib/types";
import { useStore } from "./store";
import { Button, Card, CardTitle, Skeleton } from "./ui";

const LOOK: Record<string, { icon: React.ReactNode; bg: string }> = {
  claude: { icon: <Asterisk size={18} strokeWidth={3} />, bg: "bg-[#d97757] text-white" },
  codex: { icon: <Terminal size={17} />, bg: "bg-[#fff] text-black" },
  cursor: { icon: <MousePointer2 size={16} />, bg: "bg-[#0b0b0b] text-white border border-white/20" },
  webhook: { icon: <Webhook size={17} />, bg: "bg-brand-400/20 text-brand-200 border border-brand-300/30" },
};

export function Integrations() {
  const toast = useStore((x) => x.toast);
  const go = useStore((x) => x.go);
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
      {/* Slack lives on one page (Flo Agent → Slack); this is just the way there */}
      <Card className="flex items-center gap-3 p-4" onClick={() => go("agent", "slack")}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fff]" data-testid="slack-link">
          <SlackIcon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">Slack</div>
          <p className="text-[12px] text-muted">Answer @Flo in Slack and turn messages into to-dos. All in Flo Agent, Slack.</p>
        </div>
        <span className="flex items-center gap-1 text-[12.5px] font-medium text-brand-300">
          Open <ArrowRight size={13} />
        </span>
      </Card>
      {/* Connect with Google: Calendar meeting alerts + Gmail */}
      <GoogleCard />
      <Card className="p-5">
        <CardTitle icon={<CodeXml size={15} />}>Coding agents</CardTitle>
        <p className="-mt-1.5 mb-3.5 text-[12.5px] text-muted">Connect your AI coding account. Projects → Code → Edit with AI hands your task to it, in your repo, on this {deviceWord()}.</p>
        <CodingAgents />
      </Card>
    </div>
  );
}

function StatusPill({ it }: { it: Integration }) {
  const [label, cls] = !it.available
    ? [`Not found on this ${deviceWord()}`, "bg-[var(--glass-strong)] text-faint"]
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

