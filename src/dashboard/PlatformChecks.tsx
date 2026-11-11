// Settings → Permissions on Windows / Linux. macOS has real system grants (Microphone,
// Accessibility, Screen Recording); these OSes mostly don't, so this lists everything Flo relies on
// with a live status: what's ready, what's missing (with a one-click Fix or the exact terminal
// command), and, in one line, what isn't needed on this OS and why.
import { useState } from "react";
import clsx from "clsx";
import { Check, Copy, Info, Lock, Minus, TriangleAlert } from "lucide-react";
import { api, type PermissionKind } from "../lib/api";
import { copyText } from "../lib/clipboard";
import type { PermCheck } from "../lib/types";
import { Button } from "./ui";

const BADGE: Record<PermCheck["status"], string> = { ok: "Ready", missing: "Missing", limited: "Limited here", notNeeded: "Not needed" };

export function PlatformChecks({ checks }: { checks: PermCheck[] }) {
  // the ones to act on first, then what works, then what this OS doesn't need
  const order = (c: PermCheck) => (c.status === "missing" ? (c.required ? 0 : 1) : c.status === "limited" ? 3 : c.status === "ok" ? 2 : 4);
  const sorted = [...checks].sort((a, b) => order(a) - order(b));
  return (
    <div className="flex flex-col gap-2" data-testid="platform-checks">
      {sorted.map((c) => (
        <CheckRow key={c.id} c={c} />
      ))}
    </div>
  );
}

function CheckRow({ c }: { c: PermCheck }) {
  const [copied, setCopied] = useState(false);
  const [asked, setAsked] = useState(false);
  const missing = c.status === "missing";
  const icon =
    c.status === "ok" ? <Check size={15} /> : c.status === "notNeeded" ? <Minus size={15} /> : c.status === "limited" ? <Info size={14} /> : c.required ? <Lock size={14} /> : <TriangleAlert size={14} />;
  return (
    <div className="flex items-center gap-4 rounded-xl bg-[var(--glass)] p-3" data-testid={`check-${c.id}`} data-status={c.status}>
      <span
        className={clsx(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          c.status === "ok" ? "bg-brand-400/15 text-brand-300" : missing ? (c.required ? "bg-amber-500/15 text-amber-400" : "bg-amber-500/10 text-amber-300") : "bg-[var(--glass-strong)] text-faint",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13.5px] font-medium">
          {c.label}
          {missing && !c.required && <span className="rounded-full bg-[var(--glass-strong)] px-1.5 py-px text-[10.5px] font-normal text-faint">optional</span>}
        </div>
        <div className="text-[12px] leading-relaxed text-muted">{c.detail}</div>
        {missing && c.command && (
          <div className="mt-1.5 flex items-center gap-2">
            <code className="selectable min-w-0 truncate rounded-lg bg-[var(--glass-strong)] px-2 py-1 font-mono text-[11.5px] text-[var(--fg)]">{c.command}</code>
            <button
              className="flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 text-[11.5px] font-medium text-brand-300 hover:bg-[var(--glass-strong)]"
              aria-label={`Copy ${c.command}`}
              onClick={async () => {
                if (await copyText(c.command!)) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }
              }}
            >
              {copied ? <Check size={12} strokeWidth={3} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
      </div>
      {missing && c.canFix ? (
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            setAsked(true);
            void api.openPermissionSettings(c.id as PermissionKind);
          }}
        >
          {asked ? "Check again" : c.id === "autostart" ? "Turn on" : "Fix"}
        </Button>
      ) : (
        <span className={clsx("shrink-0 text-[12px] font-medium", c.status === "ok" ? "text-brand-300" : missing ? "text-amber-300" : "text-faint")}>{BADGE[c.status]}</span>
      )}
    </div>
  );
}
