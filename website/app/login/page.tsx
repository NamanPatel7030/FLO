import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { AuthSplit } from "@/components/AuthSplit";
import { authNotice, siteUrl } from "@/lib/site";
import { getUser } from "@/lib/supabase/server";
import { safeNext } from "@/lib/validate";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const q = await searchParams;
  const next = safeNext(q.next);
  if (await getUser()) redirect(next);
  return (
    <AuthSplit>
      <AuthForm mode="login" next={next} site={siteUrl()} notice={authNotice(q.error)} />
    </AuthSplit>
  );
}
