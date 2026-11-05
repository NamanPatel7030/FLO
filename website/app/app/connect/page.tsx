import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthShell } from "@/components/AuthShell";
import { ConnectHandoff } from "@/components/ConnectHandoff";

export const metadata = { title: "Connect Flo" };
export const dynamic = "force-dynamic";

/** Opened by the desktop app: sign in (Google or password) → hand a one-time code back to Flo. */
export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const state = ((await searchParams).state ?? "").slice(0, 200);
  if (!state) {
    return (
      <AuthShell>
        <div className="glass-strong max-w-md rounded-[28px] p-8 text-center">
          <h1 className="text-xl font-semibold">Open this page from Flo</h1>
          <p className="mt-2 text-muted">In the Flo app, choose Continue with Google or Sign in with browser.</p>
        </div>
      </AuthShell>
    );
  }
  const session = await auth();
  if (!session?.user) redirect(`/login?next=${encodeURIComponent(`/app/connect?state=${encodeURIComponent(state)}`)}`);
  return (
    <AuthShell>
      <ConnectHandoff state={state} email={session.user.email ?? ""} />
    </AuthShell>
  );
}
