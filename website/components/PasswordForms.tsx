"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertCircle, ArrowLeft, ArrowRight, Check, Eye, EyeOff, Loader2, Mail } from "lucide-react";
import { checkEmail, checkPassword, EASE, Field, fieldCls, Strength } from "@/components/AuthForm";
import { authMessage, classifyAuthError } from "@/lib/auth-messages";
import { NOT_CONFIGURED } from "@/lib/supabase/env";
import { callbackUrl, createClient } from "@/lib/supabase/client";

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <motion.p
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      role="alert"
      className="flex items-start gap-2.5 rounded-[14px] border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-[13.5px] leading-snug text-amber-100"
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-200" />
      <span>{children}</span>
    </motion.p>
  );
}

function Shell({ title, sub, children, testId }: { title: string; sub: React.ReactNode; children: React.ReactNode; testId: string }) {
  const reduce = !!useReducedMotion();
  return (
    <motion.div initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE }} className="w-full max-w-[420px]" data-testid={testId}>
      <h1 className="font-display text-[28px] font-semibold leading-[1.12] tracking-tight text-balance sm:text-[32px]">{title}</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted text-pretty">{sub}</p>
      {children}
    </motion.div>
  );
}

/** /auth/forgot: email → Supabase sends a reset link to /auth/callback → /auth/reset. */
export function ForgotForm({ next, site, notice }: { next: string; site?: string; notice?: string | null }) {
  const ids = useId().replace(/:/g, "");
  const [email, setEmail] = useState("");
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(notice ?? null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const fe = checkEmail(email);
    setFieldErr(fe);
    if (fe) return ref.current?.focus();
    const supabase = createClient();
    if (!supabase) return setError(NOT_CONFIGURED);
    setBusy(true);
    setError(null);
    const addr = email.trim();
    const after = `/auth/reset?next=${encodeURIComponent(next)}`;
    const { error: err } = await supabase.auth.resetPasswordForEmail(addr, { redirectTo: callbackUrl(after, site) }).catch((x) => ({ error: x as Error }));
    setBusy(false);
    // same answer whether or not the address has an account
    if (err) return setError(authMessage(classifyAuthError(err), "forgot"));
    setSent(addr);
  }

  if (sent) {
    return (
      <Shell testId="reset-sent" title="Check your email" sub={<>If there&apos;s a Flo account for <span className="font-semibold text-ink">{sent}</span>, a link to choose a new password is on its way.</>}>
        <span className="mt-6 grid h-14 w-14 place-items-center rounded-[18px] border border-white/10 bg-brand-400/15 text-brand-200" aria-hidden>
          <Mail size={26} />
        </span>
        <p className="mt-6 text-[13.5px] leading-relaxed text-faint">The link works once and expires in an hour. Nothing there? Check spam.</p>
        <p className="mt-6 text-[14px] text-muted">
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="inline-flex items-center gap-1.5 font-semibold text-brand-300 underline-offset-4 hover:text-brand-200 hover:underline">
            <ArrowLeft size={15} /> Back to sign in
          </Link>
        </p>
      </Shell>
    );
  }

  return (
    <Shell testId="forgot-form" title="Reset your password" sub="Enter the email you signed up with and we'll send you a link to choose a new password.">
      <form onSubmit={submit} noValidate className="mt-7 flex flex-col gap-4">
        <Field id={`${ids}-email`} label="Email" error={fieldErr}>
          <input
            ref={ref}
            id={`${ids}-email`}
            className={fieldCls(!!fieldErr)}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            value={email}
            onChange={(e) => (setEmail(e.target.value), setFieldErr(null))}
            placeholder="you@example.com"
            aria-invalid={!!fieldErr}
            aria-describedby={fieldErr ? `${ids}-email-msg` : undefined}
          />
        </Field>
        <AnimatePresence initial={false}>{error && <Alert>{error}</Alert>}</AnimatePresence>
        <button type="submit" disabled={busy} aria-busy={busy} className="btn btn-primary group mt-1 h-12 w-full !rounded-[14px] text-[15px] disabled:cursor-default" data-testid="submit">
          {busy ? (
            <>
              <Loader2 size={17} className="animate-spin" /> Sending…
            </>
          ) : (
            <>
              Send reset link <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
            </>
          )}
        </button>
      </form>
      <p className="mt-6 text-center text-[14px] text-muted">
        Remembered it?{" "}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-brand-300 underline-offset-4 hover:text-brand-200 hover:underline">
          Sign in
        </Link>
      </p>
    </Shell>
  );
}

/** /auth/reset: signed in through the recovery link → set a new password (`auth.updateUser`). */
export function ResetForm({ next, email }: { next: string; email: string }) {
  const router = useRouter();
  const ids = useId().replace(/:/g, "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [fieldErr, setFieldErr] = useState<{ password?: string | null; confirm?: string | null }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const pwRef = useRef<HTMLInputElement>(null);
  const cfRef = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || done) return;
    const errs = { password: checkPassword(password, "signup"), confirm: confirm === password ? null : "These don't match yet." };
    setFieldErr(errs);
    if (errs.password) return pwRef.current?.focus();
    if (errs.confirm) return cfRef.current?.focus();
    const supabase = createClient();
    if (!supabase) return setError(NOT_CONFIGURED);
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password }).catch((x) => ({ error: x as Error }));
    if (err) {
      setBusy(false);
      return setError(authMessage(classifyAuthError(err), "reset"));
    }
    setDone(true);
    setTimeout(() => {
      router.replace(next);
      router.refresh();
    }, 700);
  }

  return (
    <Shell testId="reset-form" title="Choose a new password" sub={<>For <span className="font-semibold text-ink">{email}</span>. You&apos;ll stay signed in on this device.</>}>
      <form onSubmit={submit} noValidate className="mt-7 flex flex-col gap-4">
        <Field id={`${ids}-pw`} label="New password" error={fieldErr.password} aside={<Strength value={password} />}>
          <span className="relative block">
            <input
              ref={pwRef}
              id={`${ids}-pw`}
              className={`${fieldCls(!!fieldErr.password)} !pr-12`}
              name="new-password"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(e) => (setPassword(e.target.value), setFieldErr((f) => ({ ...f, password: null })))}
              placeholder="At least 8 characters"
              aria-invalid={!!fieldErr.password}
              aria-describedby={fieldErr.password ? `${ids}-pw-msg` : undefined}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-pressed={show}
              className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-[10px] text-faint transition hover:bg-white/10 hover:text-ink"
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </span>
        </Field>
        <Field id={`${ids}-cf`} label="Type it again" error={fieldErr.confirm}>
          <input
            ref={cfRef}
            id={`${ids}-cf`}
            className={fieldCls(!!fieldErr.confirm)}
            name="confirm-password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => (setConfirm(e.target.value), setFieldErr((f) => ({ ...f, confirm: null })))}
            aria-invalid={!!fieldErr.confirm}
            aria-describedby={fieldErr.confirm ? `${ids}-cf-msg` : undefined}
          />
        </Field>
        <AnimatePresence initial={false}>{error && <Alert>{error}</Alert>}</AnimatePresence>
        <button type="submit" disabled={busy || done} aria-busy={busy} className="btn btn-primary group mt-1 h-12 w-full !rounded-[14px] text-[15px] disabled:cursor-default" data-testid="submit">
          {done ? (
            <>
              <Check size={18} strokeWidth={2.8} /> Password updated
            </>
          ) : busy ? (
            <>
              <Loader2 size={17} className="animate-spin" /> Saving…
            </>
          ) : (
            <>
              Save new password <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
            </>
          )}
        </button>
      </form>
    </Shell>
  );
}
