import Link from "next/link";
import { AuthShowcase } from "./site/AuthShowcase";
import { PastelBackdrop } from "./site/Backdrop";
import { Logo } from "./Logo";
import { MakerSignature } from "./Signature";

/**
 * /login and /signup: the form sits in a frosted glass card on the left; on the right, a pastel
 * glass stage where the notch dictates, catches a to-do and switches language (stacks on narrow).
 */
export function AuthSplit({ children, caption }: { children: React.ReactNode; caption?: { title: string; sub: string } }) {
  const c = caption ?? { title: "Speak. Flo writes, answers and remembers.", sub: "Dictation, to-dos and translation, right in your notch." };
  return (
    <>
      <PastelBackdrop />
      <div className="mx-auto grid min-h-dvh max-w-[1400px] gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(460px,0.95fr)_minmax(0,1.05fr)]">
        <div className="flex min-h-[calc(100dvh-2rem)] flex-col px-2 pb-4 pt-3 sm:px-6">
          <Link href="/" className="v2 flex w-fit items-center gap-2.5 rounded-xl" aria-label="Flo home">
            <Logo size={32} />
            <span className="text-lg font-semibold tracking-tight ink">Flo</span>
          </Link>
          <main className="flex w-full flex-1 items-center justify-center py-8">
            <div className="g w-full max-w-[480px] rounded-[36px] px-6 py-9 sm:px-10 sm:py-11">{children}</div>
          </main>
          <div className="flex justify-center">
            <MakerSignature />
          </div>
        </div>
        <aside className="v2 relative hidden lg:sticky lg:top-4 lg:block lg:h-[calc(100dvh-2rem)]" aria-label="What Flo does">
          <AuthShowcase title={c.title} sub={c.sub} />
        </aside>
      </div>
    </>
  );
}
