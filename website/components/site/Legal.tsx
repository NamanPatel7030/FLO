import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "../Logo";
import { MakerSignature } from "../Signature";
import { PastelBackdrop } from "./Backdrop";

/** Privacy and terms: the site header, a big title, then the page. Same frame as the changelog. */
export function LegalShell({ tag, title, accent, lead, children }: { tag: string; title: string; accent: string; lead: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh px-4 py-6 sm:px-6">
      <PastelBackdrop />
      <div className="v2">
      <header className="mx-auto flex max-w-3xl items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Flo home">
          <Logo size={32} />
          <span className="text-lg font-semibold tracking-tight ink">Flo</span>
        </Link>
        <Link href="/" className="flex items-center gap-1.5 text-[14px] font-medium mut hover:text-[var(--v2-ink)]">
          <ArrowLeft size={15} /> Back to Flo
        </Link>
      </header>
      <main className="mx-auto max-w-3xl pb-10 pt-14">
        <span className="tag">
          <span className="tag-dot" />
          {tag}
        </span>
        <h1 className="mt-6 text-[clamp(40px,7vw,76px)] font-semibold leading-[0.98] tracking-[-0.05em] text-balance ink">
          {title} <span className="serif-i grad-text pr-1">{accent}</span>
        </h1>
        <p className="v2-lead mt-5 max-w-xl">{lead}</p>
        <div className="mt-12">{children}</div>
      </main>
      </div>
      {/* the signature uses the legacy light tokens, so it sits outside .v2 like on the auth pages */}
      <div className="flex justify-center pb-6">
        <MakerSignature />
      </div>
    </div>
  );
}

/** One titled block of a policy, inside a single glass card. */
export function LegalBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[rgba(20,30,60,0.08)] py-6 first:border-0 first:pt-0 last:pb-0">
      <h2 className="text-[18px] font-semibold tracking-tight ink">{title}</h2>
      <div className="mt-2 space-y-3 text-[15px] leading-relaxed mut">{children}</div>
    </section>
  );
}
