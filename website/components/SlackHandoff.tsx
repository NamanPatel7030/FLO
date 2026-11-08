"use client";

import { useEffect, useState } from "react";
import { Check, ExternalLink } from "lucide-react";

/** After Slack OAuth: hand the one-time code to the desktop app via flo://slack (the page stays as a fallback). */
export function SlackHandoff({ code, team }: { code: string; team: string }) {
  const link = `flo://slack?code=${encodeURIComponent(code)}`;
  const [tried, setTried] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      window.location.href = link;
      setTried(true);
    }, 350);
    return () => clearTimeout(t);
  }, [link]);
  return (
    <div className="glass-strong w-full max-w-[460px] rounded-[28px] p-7 text-center sm:p-8" data-testid="slack-connected-page">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-300/30 bg-emerald-400/15 text-emerald-300 shadow-[0_0_40px_-8px_rgb(52_211_153/0.6)]">
        <Check size={26} strokeWidth={2.5} />
      </div>
      <h1 className="mt-5 text-[24px] font-semibold tracking-tight">Slack connected</h1>
      <p className="mt-2 text-[14.5px] text-muted">
        {team ? (
          <>
            Flo can now see <span className="text-ink">{team}</span>. You can close this tab.
          </>
        ) : (
          <>You can close this tab.</>
        )}
      </p>
      <a href={link} className="btn btn-glass mt-7 w-full py-3 text-[14.5px]" data-testid="open-flo">
        <ExternalLink size={16} /> {tried ? "Flo didn't open? Open Flo" : "Open Flo"}
      </a>
      <p className="mt-4 text-[12px] text-faint">Your Slack token goes straight to your Mac&apos;s keychain. Flo&apos;s servers don&apos;t keep it.</p>
    </div>
  );
}
