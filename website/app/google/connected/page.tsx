import { AuthShell } from "@/components/AuthShell";
import { GoogleHandoff } from "@/components/GoogleHandoff";

export const metadata = { title: "Connect Google", robots: { index: false } };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, [string, string]> = {
  denied: ["Google wasn't connected", "You cancelled on Google. Nothing was shared. Click Connect Google in Flo whenever you're ready."],
  expired: ["This link expired", "Connect links work once and expire after 10 minutes. Click Connect Google in Flo to start again."],
  state: ["Start again from Flo", "This page was opened outside the Connect Google flow, or in a different browser. Click Connect Google in Flo to start again."],
  rate: ["Too many tries", "Wait a few minutes, then click Connect Google in Flo again."],
  setup: ["Google isn't set up yet", "This Flo server doesn't have its Google sign-in configured. See /google/setup."],
  scopes: ["Nothing to connect", "Flo needs access to Calendar or Gmail. Click Connect Google in Flo again and leave the boxes ticked."],
  google: ["Google said no", "Google couldn't finish connecting. Click Connect Google in Flo to try again."],
};

/** Where /api/google/callback lands: success hands off to Flo via flo://google, errors explain what to do. */
export default async function GoogleConnected({ searchParams }: { searchParams: Promise<{ code?: string; email?: string; error?: string }> }) {
  const q = await searchParams;
  const code = /^[A-Za-z0-9_-]{16,100}$/.test(q.code ?? "") ? q.code! : "";
  if (code && !q.error) {
    const email = /^[^\s@]{1,200}@[^\s@]{1,200}$/.test(q.email ?? "") ? q.email! : "";
    return (
      <AuthShell>
        <GoogleHandoff code={code} email={email} />
      </AuthShell>
    );
  }
  const [title, body] = ERRORS[q.error ?? ""] ?? ERRORS.google;
  return (
    <AuthShell>
      <div className="glass-strong w-full max-w-[460px] rounded-[28px] p-7 text-center sm:p-8" data-testid="google-error-page">
        <h1 className="text-[24px] font-semibold tracking-tight">{title}</h1>
        <p role="alert" className="mt-3 text-[14.5px] text-muted">
          {body}
        </p>
      </div>
    </AuthShell>
  );
}
