import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { PastelBackdrop } from "@/components/site/Backdrop";
import { requireAdmin } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } } };

/** /admin: ADMIN_EMAILS only; everyone else gets the normal 404 (lib/admin-auth.ts). Each page checks too. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="min-h-dvh px-4 py-5 sm:px-6">
      <PastelBackdrop />
      <style>{`.admin-bar:hover path{opacity:.7}`}</style>
      <div className="v2 mx-auto max-w-6xl">
        <header className="flex items-center justify-between gap-3">
          <Link href="/admin" className="flex items-center gap-2.5" aria-label="Admin home">
            <Logo size={28} />
            <span className="text-[17px] font-semibold tracking-tight ink">
              Flo <span className="fnt">admin</span>
            </span>
          </Link>
          <span className="truncate text-[12.5px] mut">{admin.email}</span>
        </header>
        <main className="pb-12 pt-6">{children}</main>
      </div>
    </div>
  );
}
