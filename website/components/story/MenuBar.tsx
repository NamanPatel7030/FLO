"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "../Logo";
import { CHAPTER_INDEX } from "./chapters";
import { useStory } from "./StoryContext";

/** A macOS-style menu bar: the notch sits in its middle, flowing into it through concave ears. */
export function MenuBar({ signedIn = false }: { signedIn?: boolean }) {
  const { goTo } = useStory();
  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState<string | null>(null);

  useEffect(() => {
    const fmt = () => setClock(new Date().toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(",", ""));
    fmt();
    const id = setInterval(fmt, 30_000);
    return () => clearInterval(id);
  }, []);

  const links: { label: string; go: () => void }[] = [
    { label: "Features", go: () => goTo(CHAPTER_INDEX.dictation) },
    { label: "Privacy", go: () => goTo(CHAPTER_INDEX.privacy) },
    { label: "Compare", go: () => document.getElementById("compare")?.scrollIntoView({ behavior: "smooth" }) },
    { label: "FAQ", go: () => document.getElementById("faq")?.scrollIntoView({ behavior: "smooth" }) },
  ];

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div className="menubar flex h-12 items-center justify-between px-4 text-[13px] md:h-[34px] md:px-4">
        <div className="flex items-center gap-1">
          <Link href="/" className="flex items-center gap-2 pr-2" aria-label="Flo home">
            <Logo size={20} />
            <span className="text-[14px] font-semibold tracking-tight">Flo</span>
          </Link>
          <div className="hidden items-center md:flex">
            {links.map((l) => (
              <button key={l.label} onClick={l.go} className="rounded-md px-2.5 py-1 text-white/70 transition hover:bg-white/10 hover:text-white">
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <div className="hidden items-center gap-1 md:flex">
          {clock && <span className="mr-3 hidden text-white/55 tabular-nums xl:inline">{clock}</span>}
          {signedIn ? (
            <Link href="/download" className="btn btn-primary h-[24px] px-3 text-[12px]">
              Download
            </Link>
          ) : (
            <>
              <Link href="/login" className="rounded-md px-2.5 py-1 text-white/70 transition hover:bg-white/10 hover:text-white">
                Sign in
              </Link>
              <Link href="/signup?next=/download" className="btn btn-primary ml-1 h-[24px] px-3 text-[12px]" data-testid="nav-get-flo">
                Get Flo
              </Link>
            </>
          )}
        </div>
        <button className="flex h-10 w-10 items-center justify-center rounded-full md:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {open && (
        <div className="glass-strong mx-3 mt-2 rounded-3xl p-3 md:hidden" role="menu">
          {links.map((l) => (
            <button
              key={l.label}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                l.go();
              }}
              className="block w-full rounded-2xl px-4 py-3 text-left text-[15px] text-muted hover:bg-white/5 hover:text-ink"
            >
              {l.label}
            </button>
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
