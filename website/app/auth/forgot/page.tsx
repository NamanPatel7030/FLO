import { AuthSplit } from "@/components/AuthSplit";
import { ForgotForm } from "@/components/PasswordForms";
import { authNotice, siteUrl } from "@/lib/site";
import { safeNext } from "@/lib/validate";

export const metadata = { title: "Reset password" };

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const q = await searchParams;
  return (
    <AuthSplit>
      <ForgotForm next={safeNext(q.next)} site={siteUrl()} notice={authNotice(q.error)} />
    </AuthSplit>
  );
}
