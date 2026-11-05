"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";

/** Signed-in website → one-time code for the desktop app (flo:// link + copyable fallback). */
export function ConnectHandoff({ state, email }: { state: string; email: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/app/handoff", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ state }) })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Couldn't create a sign-in code.");
        if (!alive) return;
        setCode(j.code);
        // hand it to the app; the page stays as a manual fallback
        setTimeout(() => {
          window.location.href = `flo://auth?code=${encodeURIComponent(j.code)}&state=${encodeURIComponent(state)}`;
        }, 400);
      })
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [state]);

  const link = code ? `flo://auth?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}` : "#";

  return (
    <div className="glass-strong w-full max-w-[460px] rounded-[28px] p-7 text-center sm:p-8">
      <h1 className="text-[24px] font-semibold tracking-tight">Connecting Flo</h1>
      <p className="mt-2 text-[14.5px] text-muted">Signed in as {email}. Flo should open and finish signing in.</p>
      {error ? (
        <p role="alert" className="mt-6 rounded-2xl border border-rose-300/25 bg-rose-400/10 px-4 py-3 text-[13.5px] text-rose-200">
          {error}
        </p>
      ) : !code ? (
        <p className="mt-8 flex items-center justify-center gap-2 text-muted">
          <Loader2 size={16} className="animate-spin" /> Creating a secure code…
        </p>
      ) : (
        <>
          <a href={link} className="btn btn-primary mt-7 w-full py-3 text-[15px]" data-testid="open-flo">
            <ExternalLink size={16} /> Open Flo
          </a>
          <p className="mt-6 text-[13px] text-faint">Flo didn&apos;t open? Paste this code in Flo:</p>
          <div className="mt-2 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-2 pl-4">
            <code className="flex-1 truncate text-left font-mono text-[14px] text-brand-100" data-testid="handoff-code">
              {code}
            </code>
            <button
              onClick={() => navigator.clipboard?.writeText(code).then(() => setCopied(true), () => setCopied(false))}
              className="btn btn-glass px-3 py-2 text-[13px]"
              aria-label="Copy code"
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-3 text-[12px] text-faint">The code works once and expires in 5 minutes.</p>
        </>
      )}
    </div>
  );
}
