import { headers } from "next/headers";
import { AuthShell } from "@/components/AuthShell";
import { missingGoogleEnv } from "@/lib/google";
import { BASE_SCOPES, GOOGLE_SCOPES } from "@/lib/google-logic";

export const metadata = { title: "Set up Google", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Developer page: shown by /api/google/install until GOOGLE_OAUTH_CLIENT_ID / _SECRET are set. Names only, never values. */
export default async function GoogleSetup() {
  const h = await headers();
  const site =
    (process.env.SITE_URL ?? "").trim().replace(/\/+$/, "") ||
    `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`;
  const callback = `${site}/api/google/callback`;
  const missing = missingGoogleEnv();
  const scopes = [...BASE_SCOPES, ...GOOGLE_SCOPES.calendar, ...GOOGLE_SCOPES.gmail];
  const step = "flex gap-3 text-left text-[14px] leading-relaxed text-muted";
  const num = "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-400/15 text-[12px] font-semibold text-brand-200";
  const code = "font-mono text-[12.5px] text-ink";
  const block = "mt-2 block rounded-xl bg-black/40 px-3 py-2 font-mono text-[12.5px] break-all text-brand-100";
  return (
    <AuthShell>
      <div className="glass-strong w-full max-w-[640px] rounded-[28px] p-7 sm:p-9" data-testid="google-setup-page">
        <p className="text-[12px] font-medium tracking-[0.14em] text-brand-300 uppercase">For the developer · one time</p>
        <h1 className="mt-2 text-[26px] font-semibold tracking-tight">{missing.length ? "Set up Connect Google" : "Google is set up"}</h1>
        {missing.length ? (
          <p className="mt-2 text-[14.5px] text-muted">
            Flo users click <span className="text-ink">Connect Google</span> and land here because this server has no Google OAuth client yet. A few minutes,
            once:
          </p>
        ) : (
          <p className="mt-2 text-[14.5px] text-muted">Everything&apos;s configured. Flo users can click Connect Google.</p>
        )}
        {missing.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2" data-testid="google-missing">
            {missing.map((k) => (
              <code key={k} className="rounded-full border border-amber-300/30 bg-amber-400/10 px-3 py-1 font-mono text-[12px] text-amber-200">
                {k} missing
              </code>
            ))}
          </div>
        )}
        <ol className="mt-7 flex flex-col gap-4">
          <li className={step}>
            <span className={num}>1</span>
            <span>
              In the{" "}
              <a className="text-ink underline" href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">
                Google Cloud Console
              </a>
              , create (or pick) a project, then open <span className="text-ink">APIs &amp; Services → Library</span> and enable the{" "}
              <span className="text-ink">Google Calendar API</span> and the <span className="text-ink">Gmail API</span>.
            </span>
          </li>
          <li className={step}>
            <span className={num}>2</span>
            <span>
              <span className="text-ink">OAuth consent screen</span>: External, app name Flo, your support email, authorized domain{" "}
              <code className={code}>hellonaman.com</code>. Add these scopes:
              <code className={block} data-testid="google-scopes">
                {scopes.map((s) => (
                  <span key={s} className="block">
                    {s}
                  </span>
                ))}
              </code>
            </span>
          </li>
          <li className={step}>
            <span className={num}>3</span>
            <span>
              While the app is in <span className="text-ink">Testing</span>, add each person who will connect as a test user (up to 100). Google ends
              Testing-mode access after 7 days, so they reconnect weekly until the app is verified.
            </span>
          </li>
          <li className={step}>
            <span className={num}>4</span>
            <span>
              <span className="text-ink">Credentials → Create credentials → OAuth client ID</span>, type <span className="text-ink">Web application</span>,
              with this authorized redirect URI (production is <code className={code}>https://flo.hellonaman.com/api/google/callback</code>):
              <code className={block} data-testid="google-callback">
                {callback}
              </code>
            </span>
          </li>
          <li className={step}>
            <span className={num}>5</span>
            <span>
              Copy the client ID and secret into the website env (<code className={code}>website/.env.local</code> locally, Vercel Production and Preview in
              production), then restart or redeploy:
              <code className={block}>
                GOOGLE_OAUTH_CLIENT_ID=…
                <br />
                GOOGLE_OAUTH_CLIENT_SECRET=…
              </code>
            </span>
          </li>
          <li className={step}>
            <span className={num}>6</span>
            <span>
              Apply <code className={code}>supabase/migrations/0010_google.sql</code> to the database.
            </span>
          </li>
        </ol>
        <p className="mt-7 text-[12.5px] text-faint">
          Full guide: docs/google-setup.md. Google tokens are never stored on this server: they&apos;re sealed for 5 minutes, handed to your computer once,
          then deleted.
        </p>
      </div>
    </AuthShell>
  );
}
