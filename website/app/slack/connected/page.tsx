import { AuthShell } from "@/components/AuthShell";
import { SlackHandoff } from "@/components/SlackHandoff";

export const metadata = { title: "Connect Slack", robots: { index: false } };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, [string, string]> = {
  denied: ["Slack wasn't connected", "You cancelled on Slack. Nothing was shared. Click Connect Slack in Flo whenever you're ready."],
  expired: ["This link expired", "Connect links work once and expire after 10 minutes. Click Connect Slack in Flo to start again."],
  state: ["Start again from Flo", "This page was opened outside the Connect Slack flow, or in a different browser. Click Connect Slack in Flo to start again."],
  rate: ["Too many tries", "Wait a few minutes, then click Connect Slack in Flo again."],
  setup: ["Slack isn't set up yet", "This Flo server doesn't have its Slack app configured. See /slack/setup."],
  slack: ["Slack said no", "Slack couldn't finish connecting. Click Connect Slack in Flo to try again."],
};

/** Where /api/slack/callback lands: success hands off to Flo via flo://slack, errors explain what to do. */
export default async function SlackConnected({ searchParams }: { searchParams: Promise<{ code?: string; team?: string; error?: string }> }) {
  const q = await searchParams;
  const code = /^[A-Za-z0-9_-]{16,100}$/.test(q.code ?? "") ? q.code! : "";
  if (code && !q.error) {
    return (
      <AuthShell>
        <SlackHandoff code={code} team={(q.team ?? "").slice(0, 120)} />
      </AuthShell>
    );
  }
  const [title, body] = ERRORS[q.error ?? ""] ?? ERRORS.slack;
  return (
    <AuthShell>
      <div className="glass-strong w-full max-w-[460px] rounded-[28px] p-7 text-center sm:p-8" data-testid="slack-error-page">
        <h1 className="text-[24px] font-semibold tracking-tight">{title}</h1>
        <p role="alert" className="mt-3 text-[14.5px] text-muted">
          {body}
        </p>
      </div>
    </AuthShell>
  );
}
