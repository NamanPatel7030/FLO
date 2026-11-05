"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "./Logo";

const LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#compare", label: "Compare" },
  { href: "/#privacy", label: "Privacy" },
  { href: "/#faq", label: "FAQ" },
];

export function Nav({ signedIn = false }: { signedIn?: boolean }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-6">
      <nav
        aria-label="Main"
        className={`mx-auto flex max-w-6xl items-center justify-between rounded-full px-3 py-2 transition-all duration-300 sm:px-4 ${
          scrolled || open ? "glass-strong" : "border border-transparent"
        }`}
      >
        <Link href="/" className="flex items-center gap-2.5 rounded-full pr-2" aria-label="Flo home">
          <Logo size={30} />
          <span className="text-[17px] font-semibold tracking-tight">Flo</span>
        </Link>
        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="rounded-full px-3.5 py-2 text-sm text-muted transition hover:bg-white/5 hover:text-ink">
              {l.label}
            </a>
          ))}
        </div>
        <div className="hidden items-center gap-2 md:flex">
          {signedIn ? (
            <Link href="/download" className="btn btn-primary px-4 py-2 text-sm">
              Download
            </Link>
          ) : (
            <>
              <Link href="/login" className="rounded-full px-3.5 py-2 text-sm text-muted transition hover:text-ink">
                Sign in
              </Link>
              <Link href="/signup?next=/download" className="btn btn-primary px-4 py-2 text-sm" data-testid="nav-get-flo">
                Get Flo
              </Link>
            </>
          )}
        </div>
        <button
          className="flex h-10 w-10 items-center justify-center rounded-full text-ink md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>
      {open && (
        <div className="glass-strong mx-auto mt-2 max-w-6xl rounded-3xl p-3 md:hidden" role="menu">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="block rounded-2xl px-4 py-3 text-[15px] text-muted hover:bg-white/5 hover:text-ink" role="menuitem">
              {l.label}
            </a>
          ))}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Link href={signedIn ? "/download" : "/login"} className="btn btn-glass py-3 text-sm" onClick={() => setOpen(false)}>
              {signedIn ? "Download" : "Sign in"}
            </Link>
            <Link href="/signup?next=/download" className="btn btn-primary py-3 text-sm" onClick={() => setOpen(false)}>
              Get Flo
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
