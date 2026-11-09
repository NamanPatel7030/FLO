import { redirect } from "next/navigation";
import { AuthSplit } from "@/components/AuthSplit";
import { ResetForm } from "@/components/PasswordForms";
import { getUser } from "@/lib/supabase/server";
import { safeNext } from "@/lib/validate";

export const metadata = { title: "New password" };
export const dynamic = "force-dynamic";

/** Reached from the reset email via /auth/callback (which signs the visitor in with the recovery link). */
export default async function ResetPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const user = await getUser();
  if (!user) redirect(`/auth/forgot?error=link&next=${encodeURIComponent(next)}`);
  return (
    <AuthSplit>
      <ResetForm next={next} email={user.email} />
    </AuthSplit>
  );
}
