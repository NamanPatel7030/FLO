// Settings → Integrations → Slack. One click (OAuth through our website, token lands in the keychain via
// flo://slack), with the old paste-a-token path tucked under "Advanced". See docs/slack-setup.md.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { ChevronDown, ExternalLink, Loader2, Plug, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { api, on } from "../lib/api";
import { EV, type SlackEvent } from "../lib/types";
import { useStore } from "./store";
import { Button, Card, CardTitle, Input, Skeleton, Toggle } from "./ui";

export const SlackIcon = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
    <path fill="#E01E5A" d="M5 15a2 2 0 1 1-2-2h2v2Zm1 0a2 2 0 1 1 4 0v5a2 2 0 1 1-4 0v-5Z" />
    <path fill="#36C5F0" d="M9 5a2 2 0 1 1 2-2v2H9Zm0 1a2 2 0 1 1 0 4H4a2 2 0 1 1 0-4h5Z" />
    <path fill="#2EB67D" d="M19 9a2 2 0 1 1 2 2h-2V9Zm-1 0a2 2 0 1 1-4 0V4a2 2 0 1 1 4 0v5Z" />
    <path fill="#ECB22E" d="M15 19a2 2 0 1 1-2 2v-2h2Zm0-1a2 2 0 1 1 0-4h5a2 2 0 1 1 0 4h-5Z" />
  </svg>
);

/** "parth · Northwind" → {user: "@parth", team: "Northwind", initials: "P"} */
export function parseSlackWho(who: string): { user: string; team: string; initials: string } {
  const [u, ...rest] = who.split(" · ");
  const name = (u ?? "").trim() || "you";
  const team = rest.join(" · ").trim();
  const handle = /\s/.test(name) ? name : `@${name}`;
  const initials = name
    .replace(/^@/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return { user: handle, team, initials: initials || "?" };
}

/** Big Slack-branded button (also used as a shortcut wherever Slack is relevant). */
export function ConnectSlackButton({ onClick, busy, className }: { onClick: () => void; busy?: boolean; className?: string }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      disabled={busy}
      className={clsx(
        "inline-flex h-11 items-center justify-center gap-2.5 rounded-xl bg-[#4A154B] pl-1.5 pr-4 text-[14px] font-semibold text-white",
        "shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_10px_24px_-12px_rgb(74_21_75/0.9)] ring-1 ring-white/10 transition hover:bg-[#5b1d5c] disabled:opacity-60",
        className,
      )}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#fff]">
        {busy ? <Loader2 size={16} className="animate-spin text-[#4A154B]" /> : <SlackIcon size={18} />}
      </span>
      Connect Slack
    </motion.button>
  );
}

/** Is Slack connected? (undefined while checking; follows EV.slack live). For "Connect Slack" shortcuts. */
export function useSlackConnected(): boolean | undefined {
  const [ok, setOk] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    api.slackStatus().then((w) => alive && setOk(!!w));
    const off = on<SlackEvent>(EV.slack, (e) => (e.connected || !e.error) && setOk(e.connected));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return ok;
}

type Phase = "idle" | "starting" | "waiting";

export function SlackCard() {
  const { toast, settings, setSettings } = useStore();
  const [who, setWho] = useState<string | null | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [revoke, setRevoke] = useState(true);
  const lastUrl = useRef<string | null>(null);

  useEffect(() => {
    api.slackStatus().then(setWho);
    // the flo://slack deep link (or a pasted token) finishing in the backend
    return on<SlackEvent>(EV.slack, (e) => {
      if (e.connected) {
        setWho(e.who ?? null);
        setError(null);
      } else {
        if (e.error) setError(e.error);
        else setWho(null);
      }
      setPhase("idle");
    });
  }, []);

  const start = async () => {
    setError(null);
    setPhase("starting");
    try {
      lastUrl.current = await api.slackOauthStart();
      setPhase("waiting");
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
      setPhase("idle");
    }
  };

  const pasteConnect = async () => {
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

  const disconnect = async () => {
    setBusy(true);
    try {
      await api.slackDisconnect(revoke);
      setWho(null);
      setConfirmOff(false);
      toast({ kind: "success", text: revoke ? "Slack disconnected and access revoked" : "Slack disconnected" });
    } catch (e) {
      toast({ kind: "error", text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const me = who ? parseSlackWho(who) : null;

  return (
    <Card className="p-5">
      <CardTitle icon={<SlackIcon />}>Slack</CardTitle>
      {who === undefined ? (
        <Skeleton className="h-16" />
      ) : me ? (
        <div className="flex flex-col gap-3" data-testid="slack-connected">
          <div className="flex items-center gap-3 rounded-2xl bg-[var(--glass)] p-3">
            <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#611f69] to-[#4A154B] text-[15px] font-semibold text-white">
              {me.initials}
              <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-md bg-[#fff] shadow">
                <SlackIcon size={12} />
              </span>
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold" data-testid="slack-user">
                {me.user}
              </div>
              {me.team && (
                <div className="truncate text-[12px] text-muted" data-testid="slack-team">
                  {me.team}
                </div>
              )}
            </div>
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10.5px] font-medium text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" /> Connected
            </span>
          </div>
          {settings && (
            <Toggle
              label="Turn unanswered DMs and mentions into to-dos"
              hint="Checked locally. Messages are never sent without your OK in the notch."
              checked={settings.slackSync}
              onChange={(v) => setSettings({ ...settings, slackSync: v })}
            />
          )}
          {/* no mode="wait": a quick Cancel → Disconnect must show the question again at once */}
          <AnimatePresence initial={false}>
            {confirmOff ? (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex flex-col gap-2.5 rounded-2xl border border-rose-300/20 bg-rose-400/[0.06] p-3"
                data-testid="slack-disconnect-confirm"
              >
                <div className="text-[13px] font-medium">Disconnect Slack from Flo?</div>
                <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted">
                  <input type="checkbox" checked={revoke} onChange={(e) => setRevoke(e.target.checked)} className="accent-brand-400" />
                  Also revoke Flo&apos;s access on Slack
                </label>
                <div className="flex gap-2">
                  <Button size="sm" variant="danger" icon={<Unplug size={13} />} disabled={busy} onClick={disconnect}>
                    Disconnect
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmOff(false)}>
                    Cancel
                  </Button>
                </div>
              </motion.div>
            ) : (
              <motion.div key="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex gap-2">
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
                <Button size="sm" variant="ghost" icon={<Unplug size={13} />} onClick={() => setConfirmOff(true)}>
                  Disconnect
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        <div className="flex flex-col gap-3" data-testid="slack-disconnected">
          <p className="-mt-1.5 text-[12.5px] text-muted">See Slack messages waiting on you as to-dos, and reply by voice. Flo always asks before sending.</p>
          {phase === "waiting" ? (
            <div className="flex items-center gap-3 rounded-2xl bg-[var(--glass)] p-3" data-testid="slack-waiting">
              <Loader2 size={18} className="shrink-0 animate-spin text-brand-300" />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium">Finish in your browser</div>
                <div className="text-[12px] text-muted">Approve Flo on Slack. This card updates by itself.</div>
              </div>
              <Button size="sm" variant="ghost" icon={<ExternalLink size={13} />} onClick={start}>
                Open again
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPhase("idle")}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <ConnectSlackButton onClick={start} busy={phase === "starting"} />
              <span className="flex items-center gap-1.5 text-[12px] text-faint">
                <ShieldCheck size={13} /> Opens Slack in your browser. The token stays in this Mac&apos;s keychain.
              </span>
            </div>
          )}
          {error && (
            <p role="alert" className="rounded-xl border border-rose-300/25 bg-rose-400/10 px-3 py-2 text-[12.5px] text-rose-200">
              {error}
            </p>
          )}
          <button
            onClick={() => setAdvanced((v) => !v)}
            aria-expanded={advanced}
            className="flex items-center gap-1 self-start text-[12px] text-muted hover:text-[var(--fg)]"
          >
            Advanced: paste a token <ChevronDown size={13} className={clsx("transition", advanced && "rotate-180")} />
          </button>
          <AnimatePresence initial={false}>
            {advanced && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex flex-col gap-2 overflow-hidden">
                <div className="flex gap-2">
                  <Input type="password" placeholder="xoxp-…" aria-label="Slack token" value={token} onChange={(e) => setToken(e.target.value)} className="font-mono" />
                  <Button variant="glass" disabled={!token.trim() || busy} onClick={pasteConnect} icon={<Plug size={13} />}>
                    Connect
                  </Button>
                </div>
                <ol className="list-decimal pl-5 text-[12px] leading-relaxed text-muted">
                  <li>Create an app at api.slack.com/apps (from scratch, pick your workspace).</li>
                  <li>Open OAuth &amp; Permissions.</li>
                  <li>
                    Under User Token Scopes add:{" "}
                    <code className="font-mono text-[11px] text-[var(--fg)]">channels:history groups:history im:history mpim:history im:read users:read search:read chat:write</code>
                  </li>
                  <li>Install to workspace.</li>
                  <li>Copy the User OAuth Token (starts with xoxp) and paste it above.</li>
                </ol>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </Card>
  );
}
