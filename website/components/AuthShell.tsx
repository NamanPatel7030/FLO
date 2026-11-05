import Link from "next/link";
import { Backdrop } from "./Backdrop";
import { Logo } from "./Logo";
import { MakerSignature } from "./Signature";

/** Centered layout for auth / account pages. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Backdrop />
      <div className="flex min-h-dvh flex-col items-center px-5 py-8">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Flo home">
          <Logo size={32} />
          <span className="text-lg font-semibold">Flo</span>
        </Link>
        <main className="flex w-full flex-1 items-center justify-center py-10">{children}</main>
        <MakerSignature />
      </div>
    </>
  );
}
