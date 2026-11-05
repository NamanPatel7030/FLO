"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { validateEmail, validateName, validatePassword } from "@/lib/validate";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function AuthForm({ mode, next, googleEnabled }: { mode: "signup" | "login"; next: string; googleEnabled: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string | null>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = {
      name: mode === "signup" ? validateName(name) : null,
      email: validateEmail(email),
      password: mode === "signup" ? validatePassword(password) : password ? null : "Enter your password.",
    };
    setFieldErr(errs);
    if (Object.values(errs).some(Boolean)) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        const r = await fetch("/api/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Couldn't create your account.");
      }
      const res = await signIn("credentials", { email, password, redirect: false });
      if (!res || res.error) throw new Error(mode === "login" ? "Wrong email or password." : "Account created, but sign-in failed. Try signing in.");
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const other = mode === "signup" ? { href: `/login?next=${encodeURIComponent(next)}`, text: "Already have an account?", cta: "Sign in" } : { href: `/signup?next=${encodeURIComponent(next)}`, text: "New to Flo?", cta: "Create an account" };

  return (
    <div className="glass-strong w-full max-w-[420px] rounded-[28px] p-7 sm:p-8">
      <h1 className="text-[26px] font-semibold tracking-tight">{mode === "signup" ? "Create your Flo account" : "Welcome back"}</h1>
      <p className="mt-1.5 text-[14.5px] text-muted">{mode === "signup" ? "Then download Flo and sign in with the same account." : "Sign in to download Flo or connect the app."}</p>

      {googleEnabled ? (
        <button type="button" onClick={() => signIn("google", { callbackUrl: next })} className="btn btn-glass mt-6 w-full py-3 text-[14.5px]" data-testid="google">
          <GoogleIcon /> Continue with Google
        </button>
      ) : (
        <p className="mt-6 rounded-2xl border border-white/10 px-4 py-3 text-[12.5px] text-faint" data-testid="google-off">
          Google sign-in isn&apos;t configured on this server yet. Use email and password.
        </p>
      )}
      <div className="my-5 flex items-center gap-3 text-[12px] text-faint">
        <span className="h-px flex-1 bg-white/10" /> or with email <span className="h-px flex-1 bg-white/10" />
      </div>

      <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
        {mode === "signup" && (
          <label className="flex flex-col gap-1.5 text-[13px] text-muted">
            Name
            <input className="field" name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Naman Gundaniya" aria-invalid={!!fieldErr.name} />
            {fieldErr.name && <span className="text-[12.5px] text-rose-300">{fieldErr.name}</span>}
          </label>
        )}
        <label className="flex flex-col gap-1.5 text-[13px] text-muted">
          Email
          <input className="field" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-invalid={!!fieldErr.email} />
          {fieldErr.email && <span className="text-[12.5px] text-rose-300">{fieldErr.email}</span>}
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] text-muted">
          Password
          <span className="relative">
            <input
              className="field pr-11"
              name="password"
              type={show ? "text" : "password"}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
              aria-invalid={!!fieldErr.password}
            />
            <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-ink" aria-label={show ? "Hide password" : "Show password"}>
              {show ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </span>
          {fieldErr.password && <span className="text-[12.5px] text-rose-300">{fieldErr.password}</span>}
        </label>
        {error && (
          <p role="alert" className="rounded-2xl border border-rose-300/25 bg-rose-400/10 px-4 py-2.5 text-[13.5px] text-rose-200">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="btn btn-primary mt-1 w-full py-3 text-[15px] disabled:opacity-70" data-testid="submit">
          {busy && <Loader2 size={16} className="animate-spin" />}
          {mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>
      <p className="mt-5 text-center text-[13.5px] text-muted">
        {other.text}{" "}
        <Link href={other.href} className="text-brand-300 hover:text-brand-200">
          {other.cta}
        </Link>
      </p>
      {mode === "signup" && (
        <p className="mt-3 text-center text-[11.5px] text-faint">
          By continuing you agree to the <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy policy</Link>.
        </p>
      )}
    </div>
  );
}
