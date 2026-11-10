import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { Mascot } from "@/components/site/Mascot";

export const metadata: Metadata = {
  title: "Page not found · Flo",
  robots: { index: false },
};

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/download", label: "Download" },
  { href: "/changelog", label: "What's new" },
  { href: "/privacy", label: "Privacy" },
];

/** Every unknown URL (and pages that hide themselves, like /admin for non-admins) lands here. */
export default function NotFound() {
  return (
    <AuthShell>
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <Mascot mood="think" size={132} title="Notchling looking around" />
        <p className="mt-6 font-mono text-sm tracking-[0.2em] text-[var(--color-faint)]">404</p>
        <h1 className="mt-2 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          This page isn&apos;t <span className="font-serif italic font-normal">here.</span>
        </h1>
        <p className="mt-3 text-pretty text-base text-[var(--color-muted)]">
          The link may be old, or the address has a typo. Everything else is right where you left it.
        </p>
        <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-full bg-[#0b1220] px-6 text-sm font-semibold !text-[#ffffff] shadow-lg transition hover:bg-[#1b2436] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3dbbff]"
          >
            Back to Flo
          </Link>
          <Link
            href="/download"
            className="inline-flex h-11 items-center justify-center rounded-full border border-[rgb(11_18_32/0.16)] bg-[rgb(255_255_255/0.6)] px-6 text-sm font-semibold transition hover:bg-[rgb(255_255_255/0.9)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3dbbff]"
          >
            Download Flo
          </Link>
        </div>
        <nav aria-label="Helpful links" className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-[var(--color-faint)]">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="underline-offset-4 hover:text-[var(--color-ink)] hover:underline">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </AuthShell>
  );
}
