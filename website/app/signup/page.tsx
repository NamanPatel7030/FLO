import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { AuthSplit } from "@/components/AuthSplit";
import { authNotice, siteUrl } from "@/lib/site";
import { getUser } from "@/lib/supabase/server";
import { safeNext } from "@/lib/validate";

export const metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const q = await searchParams;
  const next = safeNext(q.next);
  if (await getUser()) redirect(next);
  return (
    <AuthSplit caption={{ title: "Talk to your computer like a person.", sub: "Dictate anywhere, ask about your screen, and keep to-dos in your notch. Free to start." }}>
      <AuthForm mode="signup" next={next} site={siteUrl()} notice={authNotice(q.error)} />
    </AuthSplit>
  );
}
