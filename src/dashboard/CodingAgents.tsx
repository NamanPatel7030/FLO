// "Connect your AI coding account": Claude Code / Codex / Gemini CLI, signed in with the user's own
// subscription. Flo only detects the CLIs and opens their own sign-in flow; it never sees credentials.
import { deviceWord } from "../lib/os";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Asterisk, Check, Copy, LogIn, RefreshCw, ShieldCheck, Terminal } from "lucide-react";
import { codeApi, type AgentId, type AgentStatus } from "../lib/code";
import { copyText } from "../lib/clipboard";
import { useStore } from "./store";
import { Button, Skeleton } from "./ui";

const GeminiMark = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
    <defs>
      <linearGradient id="flo-gemini" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#8ab4ff" />
        <stop offset="1" stopColor="#c58bff" />
      </linearGradient>
    </defs>
    <path fill="url(#flo-gemini)" d="M12 1.5c.6 5.6 4.9 9.9 10.5 10.5-5.6.6-9.9 4.9-10.5 10.5C11.4 16.9 7.1 12.6 1.5 12 7.1 11.4 11.4 7.1 12 1.5Z" />
  </svg>
);

export const AGENT_LOOK: Record<AgentId, { icon: React.ReactNode; bg: string }> = {
  claude: { icon: <Asterisk size={18} strokeWidth={3} />, bg: "bg-[#d97757] text-white" },
  codex: { icon: <Terminal size={16} />, bg: "bg-[#fff] text-black" },
  gemini: { icon: <GeminiMark />, bg: "bg-[#131a2a] border border-white/10" },
};

export function AgentTile({ id, size = 40 }: { id: AgentId; size?: number }) {
  const look = AGENT_LOOK[id];
  return (
    <span className={clsx("flex shrink-0 items-center justify-center rounded-xl", look.bg)} style={{ width: size, height: size }}>
      {look.icon}
    </span>
  );
}

export type AgentState = "connected" | "signed-out" | "missing";
export const agentState = (a: AgentStatus): AgentState => (!a.installed ? "missing" : a.signedIn === false ? "signed-out" : "connected");

/** Load (and re-check) the coding agents; shared by Settings and Edit with AI. */
export function useCodingAgents() {
  const [agents, setAgents] = useState<AgentStatus[] | null>(null);
  const [checking, setChecking] = useState(false);
  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      setAgents(await codeApi.agents());
    } catch {
      setAgents([]);
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    recheck();
  }, [recheck]);
  return { agents, checking, recheck };
}

function StatePill({ s }: { s: AgentState }) {
  const [label, cls, dot] =
    s === "connected"
      ? ["Connected", "bg-emerald-400/15 text-emerald-300", "bg-emerald-400"]
      : s === "signed-out"
        ? ["Not signed in", "bg-amber-400/15 text-amber-300", "bg-amber-400"]
        : ["Not installed", "bg-[var(--glass-strong)] text-faint", "bg-zinc-500"];
  return (
    <span className={clsx("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-medium", cls)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", dot)} />
      {label}
    </span>
  );
}

function CommandBox({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-xl border border-white/[0.06] bg-black/30 py-1.5 pl-3 pr-1.5">
      <span className="select-none pt-[5px] font-mono text-[11px] leading-[16px] text-faint">$</span>
      <code className="min-w-0 flex-1 select-all break-words py-[5px] font-mono text-[11.5px] leading-[16px] text-[var(--fg)]" title={cmd}>
        {cmd}
      </code>
      <button
        onClick={async () => {
          if (await copyText(cmd)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }
        }}
        className="rounded-lg p-1.5 text-faint transition hover:bg-[var(--glass)] hover:text-[var(--fg)]"
        aria-label="Copy install command"
        title="Copy"
      >
        {copied ? <Check size={13} className="text-emerald-300" /> : <Copy size={13} />}
      </button>
    </div>
  );
}

export function AgentCard({ a, onRecheck, checking, compact }: { a: AgentStatus; onRecheck: () => void; checking: boolean; compact?: boolean }) {
  const toast = useStore((x) => x.toast);
  const s = agentState(a);
  const signIn = async () => {
    try {
      await codeApi.signIn(a.id);
      toast({ kind: "info", text: `Finish signing in to ${a.provider} in Terminal, then press Re-check.` });
    } catch (e) {
      toast({ kind: "error", text: String(e) });
    }
  };
  return (
    <div
      data-testid="agent-card"
      data-agent={a.id}
      data-state={s}
      className={clsx("flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4", compact && "p-3.5")}
    >
      <div className="flex items-start gap-3">
        <AgentTile id={a.id} size={compact ? 34 : 40} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold tracking-tight">{a.provider}</div>
          <div className="mt-0.5 truncate text-[11.5px] text-faint">
            {a.name}
            {a.version ? ` · v${a.version}` : ""}
          </div>
        </div>
      </div>
      <div className="-mt-0.5 flex">
        <StatePill s={s} />
      </div>
      <div className="-mt-1 min-h-[18px] text-[12px] leading-snug text-muted">
        {s === "connected" ? (
          a.account ? (
            <>
              Connected as <span className="font-medium text-[var(--fg)]">{a.account}</span>
            </>
          ) : (
            `Signed in on this ${deviceWord()}.`
          )
        ) : s === "signed-out" ? (
          `Installed. Sign in with your ${a.provider} account in its own window.`
        ) : (
          "Install it from Terminal, then press Re-check."
        )}
      </div>
      {s === "missing" && <CommandBox cmd={a.installCommand} />}
      <div className="mt-auto flex items-center justify-end gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          aria-label="Re-check"
          title="Re-check"
          icon={<RefreshCw size={12} className={clsx(checking && "animate-spin")} />}
          disabled={checking}
          onClick={onRecheck}
        >
          Re-check
        </Button>
        {s === "signed-out" && (
          <Button size="sm" variant="primary" icon={<LogIn size={13} />} onClick={signIn}>
            Sign in
          </Button>
        )}
      </div>
    </div>
  );
}

export const PRIVACY_NOTE = `Agents run on your ${deviceWord()} with your own Claude, ChatGPT or Gemini subscription. You sign in inside each provider's own CLI; Flo never sees or stores your passwords or tokens.`;

/** The three agent cards. `compact` = stacked for the project drawer. */
export function CodingAgents({ compact, state }: { compact?: boolean; state?: ReturnType<typeof useCodingAgents> }) {
  const own = useCodingAgents();
  const { agents, checking, recheck } = state ?? own;
  return (
    <div className="flex flex-col gap-3" data-testid="coding-agents">
      {!agents ? (
        <Skeleton className={compact ? "h-40" : "h-44"} />
      ) : (
        <div className={clsx("grid gap-3", compact ? "grid-cols-1" : "grid-cols-1 md:grid-cols-3")}>
          {agents.map((a) => (
            <AgentCard key={a.id} a={a} onRecheck={recheck} checking={checking} compact={compact} />
          ))}
        </div>
      )}
      <div className="flex items-start gap-2 text-[11.5px] leading-snug text-faint">
        <ShieldCheck size={13} className="mt-[1px] shrink-0 text-emerald-300/80" />
        <span>{PRIVACY_NOTE}</span>
      </div>
    </div>
  );
}
