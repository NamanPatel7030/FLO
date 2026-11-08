import Link from "next/link";
import { Aurora } from "./Aurora";
import { AuthScene } from "./AuthScene";
import { Logo } from "./Logo";
import { MakerSignature } from "./Signature";

/** Split layout for /login and /signup: the form on the left, the notch alive on the right (stacks on narrow). */
export function AuthSplit({ children, caption }: { children: React.ReactNode; caption?: { title: string; sub: string } }) {
  const c = caption ?? { title: "Speak. Flo writes, answers and remembers.", sub: "Dictation, to-dos and translation, right in your notch." };
  return (
    <>
      <Aurora />
      <div className="grid min-h-dvh lg:grid-cols-[minmax(480px,1fr)_minmax(0,1.1fr)]">
        <div className="flex min-h-dvh flex-col px-5 pb-6 pt-6 sm:px-10 lg:px-16">
          <Link href="/" className="flex w-fit items-center gap-2.5 rounded-xl" aria-label="Flo home">
            <Logo size={32} />
            <span className="text-lg font-semibold tracking-tight">Flo</span>
          </Link>
          <main className="flex w-full flex-1 items-center justify-center py-10 lg:py-12">{children}</main>
          <div className="flex justify-center">
            <MakerSignature />
          </div>
        </div>

        <aside className="relative px-3 pb-3 lg:sticky lg:top-0 lg:h-dvh lg:self-start lg:py-3 lg:pl-0" aria-label="What Flo does">
          <div
            className="relative flex h-full lg:min-h-0 min-h-[600px] flex-col overflow-hidden rounded-[32px] border border-white/10 max-lg:min-h-[580px]"
            style={{
              background:
                "radial-gradient(120% 70% at 50% -10%, rgba(61,187,255,0.30), transparent 60%), radial-gradient(80% 60% at 100% 100%, rgba(26,155,224,0.22), transparent 60%), linear-gradient(170deg, rgba(10,42,68,0.92) 0%, rgba(6,23,38,0.94) 45%, rgba(3,8,14,0.96) 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12), 0 30px 80px -40px rgba(0,0,0,0.8)",
            }}
          >
            <div className="flex flex-1">
              <AuthScene />
            </div>
            <div className="px-7 pb-8 sm:px-10 sm:pb-10">
              <p className="font-display text-[22px] font-semibold leading-snug tracking-tight text-ink sm:text-[26px]">{c.title}</p>
              <p className="mt-2 text-[14.5px] text-muted">{c.sub}</p>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
