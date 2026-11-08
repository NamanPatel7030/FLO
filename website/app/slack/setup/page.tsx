import { headers } from "next/headers";
import { AuthShell } from "@/components/AuthShell";
import { manifestYaml, missingSlackEnv } from "@/lib/slack";

export const metadata = { title: "Set up Slack", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Developer page: shown by /api/slack/install until SLACK_CLIENT_ID / SLACK_CLIENT_SECRET are set. Names only, never values. */
export default async function SlackSetup() {
  const h = await headers();
  const site =
    (process.env.SITE_URL ?? "").trim().replace(/\/+$/, "") ||
    `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`;
  const missing = missingSlackEnv();
  const step = "flex gap-3 text-left text-[14px] leading-relaxed text-muted";
  const num = "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-400/15 text-[12px] font-semibold text-brand-200";
  return (
    <AuthShell>
      <div className="glass-strong w-full max-w-[640px] rounded-[28px] p-7 sm:p-9" data-testid="slack-setup-page">
        <p className="text-[12px] font-medium tracking-[0.14em] text-brand-300 uppercase">For the developer · one time</p>
        <h1 className="mt-2 text-[26px] font-semibold tracking-tight">{missing.length ? "Set up Connect Slack" : "Slack is set up"}</h1>
        {missing.length ? (
          <p className="mt-2 text-[14.5px] text-muted">
            Flo users click <span className="text-ink">Connect Slack</span> and land here because this server has no Slack app yet. About a minute, once:
          </p>
        ) : (
          <p className="mt-2 text-[14.5px] text-muted">Everything&apos;s configured. Flo users can click Connect Slack.</p>
        )}
        {missing.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2" data-testid="slack-missing">
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
              Open{" "}
              <a className="text-brand-300 underline-offset-2 hover:underline" href="https://api.slack.com/apps?new_app=1" target="_blank" rel="noreferrer">
                api.slack.com/apps
              </a>{" "}
              → <span className="text-ink">Create New App → From a manifest</span>, pick a workspace you own and paste:
            </span>
          </li>
        </ol>
        <pre className="mt-3 max-h-64 overflow-auto rounded-2xl border border-white/10 bg-black/40 p-4 font-mono text-[12px] leading-relaxed text-brand-100" data-testid="slack-manifest">
          {manifestYaml(site)}
        </pre>
        <ol className="mt-5 flex flex-col gap-4" start={2}>
          <li className={step}>
            <span className={num}>2</span>
            <span>
              In <span className="text-ink">Basic Information</span>, copy the Client ID and Client Secret into the website env (
              <code className="font-mono text-[12.5px] text-ink">website/.env.local</code> locally, your host&apos;s env in production):
              <code className="mt-2 block rounded-xl bg-black/40 px-3 py-2 font-mono text-[12.5px] text-brand-100">
                SLACK_CLIENT_ID=…
                <br />
                SLACK_CLIENT_SECRET=…
              </code>
            </span>
          </li>
          <li className={step}>
            <span className={num}>3</span>
            <span>
              <span className="text-ink">Manage Distribution → Activate Public Distribution</span> so people outside your workspace can connect (needs an https
              SITE_URL). Then restart or redeploy the website.
            </span>
          </li>
        </ol>
        <p className="mt-7 text-[12.5px] text-faint">Full guide: docs/slack-setup.md. Tokens are never stored on this server: they&apos;re sealed for 5 minutes, handed to the Mac once, then deleted.</p>
      </div>
    </AuthShell>
  );
}
