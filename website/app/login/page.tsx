import { redirect } from "next/navigation";
import { auth, googleEnabled } from "@/auth";
import { AuthForm } from "@/components/AuthForm";
import { AuthSplit } from "@/components/AuthSplit";
import { safeNext } from "@/lib/validate";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if ((await auth())?.user) redirect(next);
  return (
    <AuthSplit>
      <AuthForm mode="login" next={next} googleEnabled={googleEnabled} />
    </AuthSplit>
  );
}
