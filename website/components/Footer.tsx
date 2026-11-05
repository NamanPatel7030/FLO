import Link from "next/link";
import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="border-t border-white/5 px-6 py-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-sm">
          <div className="flex items-center gap-2.5">
            <Logo size={28} />
            <span className="font-semibold">Flo</span>
            <span className="text-faint">· Your Assistant</span>
          </div>
          <p className="mt-3 text-sm text-muted">Private voice dictation, a screen-aware assistant and live meeting notes. Your data stays on your Mac.</p>
        </div>
        <div className="grid grid-cols-2 gap-8 text-sm sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <span className="text-faint">Product</span>
            <a href="/#features" className="text-muted hover:text-ink">Features</a>
            <a href="/#compare" className="text-muted hover:text-ink">Compare</a>
            <Link href="/download" className="text-muted hover:text-ink">Download</Link>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-faint">Company</span>
            <a href="https://hellonaman.com" target="_blank" rel="noreferrer" className="text-muted hover:text-ink">Made by Naman</a>
            <Link href="/privacy" className="text-muted hover:text-ink">Privacy</Link>
            <Link href="/terms" className="text-muted hover:text-ink">Terms</Link>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-faint">Account</span>
            <Link href="/login" className="text-muted hover:text-ink">Sign in</Link>
            <Link href="/signup?next=/download" className="text-muted hover:text-ink">Create account</Link>
          </div>
        </div>
      </div>
      <p className="mx-auto mt-10 max-w-6xl text-xs text-faint">© {new Date().getFullYear()} Flo. Built by Naman Gundaniya.</p>
    </footer>
  );
}
