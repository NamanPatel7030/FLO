import { AuthShell } from "@/components/AuthShell";

export const metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <AuthShell>
      <article className="glass max-w-2xl rounded-[28px] p-8 text-[15px] leading-relaxed text-muted">
        <h1 className="text-2xl font-semibold text-ink">Terms of use</h1>
        <p className="mt-4">Flo is provided as is, free of charge. You are responsible for the AI providers you connect and for what you send them under your own keys.</p>
        <p className="mt-3">Don&apos;t use Flo to break the law or other people&apos;s privacy. Meeting notes record audio: tell participants and follow the rules where you live.</p>
        <p className="mt-3">We may update these terms; we&apos;ll note the date here. Last updated November 2026.</p>
      </article>
    </AuthShell>
  );
}
