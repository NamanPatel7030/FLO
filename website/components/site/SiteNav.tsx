"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Menu, X } from "lucide-react";
import { Logo } from "../Logo";

const LINKS = [
  { href: "/#dictation", label: "Dictation" },
  { href: "/#assistant", label: "Assistant" },
  { href: "/#work", label: "Work" },
  { href: "/#privacy", label: "Privacy" },
  { href: "/#faq", label: "FAQ" },
];

/** A floating glass pill. It tightens and frosts more once you scroll. */
export function SiteNav({ signedIn = false }: { signedIn?: boolean }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const cta = signedIn ? { href: "/download", label: "Download" } : { href: "/signup?next=/download", label: "Get Flo free" };
  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:pt-4">
      <nav
        aria-label="Main"
        className={`mx-auto flex items-center justify-between rounded-full px-2.5 py-2 transition-all duration-500 ${scrolled ? "g max-w-4xl" : "max-w-6xl border border-transparent"}`}
      >
        <Link href="/" className="flex items-center gap-2.5 rounded-full pl-1.5 pr-2" aria-label="Flo home">
          <Logo size={30} />
          <span className="text-[17px] font-semibold tracking-tight ink">Flo</span>
        </Link>
        <div className="hidden items-center md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="rounded-full px-3.5 py-2 text-[14px] font-medium mut transition hover:bg-white/70 hover:text-[var(--v2-ink)]">
              {l.label}
            </a>
          ))}
        </div>
        <div className="hidden items-center gap-1.5 md:flex">
          {!signedIn && (
            <Link href="/login" className="rounded-full px-3.5 py-2 text-[14px] font-medium mut transition hover:text-[var(--v2-ink)]">
              Sign in
            </Link>
          )}
          <Link href={cta.href} className="btn btn-primary h-10 px-5 text-[14px]" data-testid="nav-get-flo">
            {cta.label}
          </Link>
        </div>
        <button className="grid h-10 w-10 place-items-center rounded-full ink md:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="g mx-auto mt-2 max-w-6xl rounded-[28px] p-2.5 md:hidden"
          >
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="block rounded-2xl px-4 py-3 text-[15px] font-medium ink-2 hover:bg-white/70">
                {l.label}
              </a>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Link href={signedIn ? "/download" : "/login"} className="btn btn-glass h-12 text-[14px]" onClick={() => setOpen(false)}>
                {signedIn ? "Download" : "Sign in"}
              </Link>
              <Link href={cta.href} className="btn btn-primary h-12 text-[14px]" onClick={() => setOpen(false)}>
                {cta.label}
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
