import { redirect } from "next/navigation";
import { auth, googleEnabled } from "@/auth";
import { AuthForm } from "@/components/AuthForm";
import { AuthSplit } from "@/components/AuthSplit";
import { safeNext } from "@/lib/validate";

export const metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if ((await auth())?.user) redirect(next);
  return (
    <AuthSplit caption={{ title: "Talk to your Mac like a person.", sub: "Dictate anywhere, ask about your screen, and keep to-dos in your notch. Free to start." }}>
      <AuthForm mode="signup" next={next} googleEnabled={googleEnabled} />
    </AuthSplit>
  );
}
