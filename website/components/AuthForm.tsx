"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertCircle, ArrowRight, Check, ChevronDown, Eye, EyeOff, Loader2, Lock, Mail, RotateCw } from "lucide-react";
import { authMessage, classifyAuthError, isExistingAccountSignup } from "@/lib/auth-messages";
import { NOT_CONFIGURED } from "@/lib/supabase/env";
import { callbackUrl, createClient, providerEnabled } from "@/lib/supabase/client";
import { EMAIL_RE } from "@/lib/validate";

export const EASE = [0.2, 0.8, 0.2, 1] as const;
const REMEMBER_KEY = "flo.auth.email";
const remembered = {
  get: () => {
    try {
      return localStorage.getItem(REMEMBER_KEY) || "";
    } catch {
      return "";
    }
  },
  set: (v: string | null) => {
    try {
      if (v) localStorage.setItem(REMEMBER_KEY, v);
      else localStorage.removeItem(REMEMBER_KEY);
    } catch {
      /* private mode */
    }
  },
};

export function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 2.9-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.5z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.9-6.2z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

const greetFor = (h: number) => (h < 5 ? "Working late?" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 22 ? "Good evening" : "Working late?");

type Errs = { name?: string | null; email?: string | null; password?: string | null };

function checkName(n: string) {
  if (!n.trim()) return "Tell us what to call you.";
  if (n.length > 80) return "That's a long one. Keep it under 80 characters.";
  return null;
}
export function checkEmail(e: string) {
  const v = e.trim();
  if (!v) return "Add your email so we can find your account.";
  if (!EMAIL_RE.test(v) || v.length > 254) return "That email looks incomplete. Try something like name@example.com.";
  return null;
}
export function checkPassword(p: string, mode: "signup" | "login") {
  if (mode === "login") return p ? null : "Type your password to continue.";
  if (p.length < 8) return "Use at least 8 characters. A short phrase works well.";
  if (p.length > 200) return "That password is too long. Keep it under 200 characters.";
  return null;
}

export function Field({ id, label, error, hint, aside, children }: { id: string; label: string; error?: string | null; hint?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[13px] font-medium text-muted">
          {label}
        </label>
        {aside}
      </div>
      {children}
      <AnimatePresence initial={false}>
        {(error || hint) && (
          <motion.p
            id={`${id}-msg`}
            key={error ? "e" : "h"}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className={`flex items-center gap-1.5 overflow-hidden text-[12.5px] ${error ? "text-amber-200" : "text-faint"}`}
          >
            {error || hint}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

export const fieldCls = (bad: boolean) =>
  `field !h-12 !rounded-[14px] !py-0 text-[15px] ${bad ? "!border-amber-300/60 focus:!shadow-[0_0_0_4px_rgb(252_211_77/0.12)]" : "!border-[rgb(150_215_255/0.2)]"}`;

export function Strength({ value }: { value: string }) {
  const score = value.length === 0 ? 0 : value.length < 8 ? 1 : value.length < 12 || !/[^a-zA-Z]/.test(value) ? 2 : 3;
  const words = ["", "Keep going", "Good", "Strong"];
  return (
    <span className="flex items-center gap-2" aria-live="polite">
      <span className="flex gap-1" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className="h-1 w-6 rounded-full transition-colors duration-300" style={{ background: score >= i ? (score === 1 ? "#fcd34d" : "#66ceff") : "rgb(150 215 255 / 0.16)" }} />
        ))}
      </span>
      {score > 0 && <span className="text-[11.5px] text-faint">{words[score]}</span>}
    </span>
  );
}

type Resend = "idle" | "busy" | "sent" | "error";

export function AuthForm({ mode, next, site, notice }: { mode: "signup" | "login"; next: string; site?: string; notice?: string | null }) {
  const router = useRouter();
  const reduce = !!useReducedMotion();
  const ids = useId().replace(/:/g, "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [remember, setRemember] = useState(true);
  // Google leads; email + password is the secondary path, opened on demand (or for a returning email user)
  const [emailOpen, setEmailOpen] = useState(false);
  const [busy, setBusy] = useState<null | "form" | "google">(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<React.ReactNode>(notice ?? null);
  const [sentTo, setSentTo] = useState<string | null>(null); // sign-up done, waiting for the confirmation email
  const [unconfirmed, setUnconfirmed] = useState(false); // login blocked until the email is confirmed
  const [resend, setResend] = useState<Resend>("idle");
  const [fieldErr, setFieldErr] = useState<Errs>({});
  const [hello, setHello] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  const forDownload = next.startsWith("/download");
  const forConnect = next.startsWith("/app/connect");
  const other =
    mode === "signup"
      ? { href: `/login?next=${encodeURIComponent(next)}`, text: "Already have an account?", cta: "Sign in" }
      : { href: `/signup?next=${encodeURIComponent(next)}`, text: "New to Flo?", cta: "Create a free account" };

  // local time + remembered email are browser-only: read them after mount
  useEffect(() => {
    setHello(greetFor(new Date().getHours()));
    if (mode === "login") {
      const r = remembered.get();
      if (r) {
        setEmail(r);
        setReturning(true);
        setEmailOpen(true);
        requestAnimationFrame(() => pwRef.current?.focus({ preventScroll: true }));
      }
    }
  }, [mode]);

  useEffect(() => {
    const reset = (e: PageTransitionEvent) => e.persisted && setBusy(null);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const existing = (
    <>
      You already have a Flo account with this email.{" "}
      <Link href={other.href} className="font-semibold text-brand-200 underline underline-offset-2">
        Sign in instead
      </Link>
    </>
  );

  async function resendConfirmation(to: string) {
    const supabase = createClient();
    if (!supabase) return setError(NOT_CONFIGURED);
    setResend("busy");
    const { error: e } = await supabase.auth.resend({ type: "signup", email: to, options: { emailRedirectTo: callbackUrl(next, site) } });
    if (e) {
      setResend("error");
      setError(authMessage(classifyAuthError(e), "signup"));
    } else {
      setResend("sent");
      setError(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || done) return;
    const errs: Errs = {
      name: mode === "signup" ? checkName(name) : null,
      email: checkEmail(email),
      password: checkPassword(password, mode),
    };
    setFieldErr(errs);
    if (errs.name) return nameRef.current?.focus();
    if (errs.email) return emailRef.current?.focus();
    if (errs.password) return pwRef.current?.focus();
    const supabase = createClient();
    if (!supabase) return setError(NOT_CONFIGURED);
    setBusy("form");
    setError(null);
    setUnconfirmed(false);
    setResend("idle");
    const addr = email.trim();
    try {
      if (mode === "signup") {
        const { data, error: e } = await supabase.auth.signUp({
          email: addr,
          password,
          options: { data: { name: name.trim(), full_name: name.trim() }, emailRedirectTo: callbackUrl(next, site) },
        });
        if (e) {
          const p = classifyAuthError(e);
          if (p === "user_already_exists") {
            setError(existing);
            setBusy(null);
            return;
          }
          throw new Error(authMessage(p, "signup"));
        }
        if (isExistingAccountSignup(data.user)) {
          setError(existing);
          setBusy(null);
          return;
        }
        if (!data.session) {
          // email confirmations on: Supabase sent a link to /auth/callback
          setSentTo(addr);
          setBusy(null);
          return;
        }
      } else {
        const { error: e } = await supabase.auth.signInWithPassword({ email: addr, password });
        if (e) {
          const p = classifyAuthError(e);
          if (p === "email_not_confirmed") setUnconfirmed(true);
          throw new Error(authMessage(p, "login"));
        }
        remembered.set(remember ? addr : null);
      }
      setDone(true);
      setTimeout(
        () => {
          router.replace(next);
          router.refresh();
        },
        reduce ? 150 : 700,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : authMessage("network"));
      setBusy(null);
      if (mode === "login") pwRef.current?.select();
    }
  }

  const google = async () => {
    const supabase = createClient();
    if (!supabase) return setError(NOT_CONFIGURED);
    setBusy("google");
    setError(null);
    // a disabled provider would otherwise land on Supabase's raw JSON error page
    if ((await providerEnabled("google")) === false) {
      setError(authMessage("provider_disabled"));
      setBusy(null);
      return;
    }
    const { error: e } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: callbackUrl(next, site) } });
    if (e) {
      setError(authMessage(classifyAuthError(e), "google"));
      setBusy(null);
    }
  };

  const capsKey = (e: React.KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.("CapsLock") ?? false);
  const clear = (k: keyof Errs) => fieldErr[k] && setFieldErr((f) => ({ ...f, [k]: null }));

  const eyebrow = mode === "signup" ? "Free, and it takes 30 seconds" : (hello ?? " ");
  const title = mode === "signup" ? (forDownload ? "Create your free account to download Flo" : "Create your free Flo account") : "Welcome back";
  const sub =
    mode === "signup"
      ? "Then sign in on your computer with the same account. That's it."
      : returning
        ? "Good to see you again. Let's pick up where you left off."
        : forDownload
          ? "Sign in and your download starts right after."
          : forConnect
            ? "Sign in to connect the Flo app on your computer."
            : "Let's pick up where you left off.";

  if (sentTo) {
    return (
      <motion.div initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE }} className="w-full max-w-[420px]" data-testid="check-email">
        <span className="grid h-14 w-14 place-items-center rounded-[18px] border border-white/10 bg-brand-400/15 text-brand-200" aria-hidden>
          <Mail size={26} />
        </span>
        <h1 className="font-display mt-6 text-[28px] font-semibold leading-[1.12] tracking-tight text-balance sm:text-[32px]">Check your email to confirm</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted text-pretty">
          We sent a link to <span className="font-semibold text-ink">{sentTo}</span>. Open it to finish creating your account
          {forDownload ? " and your download starts right after." : "."}
        </p>
        <p className="mt-3 text-[13.5px] leading-relaxed text-faint">Nothing there? Check spam, or send it again.</p>
        <AnimatePresence initial={false}>
          {error && (
            <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" className="mt-5 flex items-start gap-2.5 rounded-[14px] border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-[13.5px] leading-snug text-amber-100">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-200" />
              <span>{error}</span>
            </motion.p>
          )}
        </AnimatePresence>
        <div className="mt-7 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => resendConfirmation(sentTo)}
            disabled={resend === "busy" || resend === "sent"}
            className="btn btn-primary h-12 w-full !rounded-[14px] text-[15px] disabled:cursor-default"
            data-testid="resend"
          >
            {resend === "busy" ? <Loader2 size={17} className="animate-spin" /> : resend === "sent" ? <Check size={18} strokeWidth={2.8} /> : <RotateCw size={16} />}
            {resend === "sent" ? "Sent again" : "Resend email"}
          </button>
          <button
            type="button"
            onClick={() => {
              setSentTo(null);
              setResend("idle");
              setError(null);
            }}
            className="btn btn-glass h-12 w-full !rounded-[14px] text-[15px]"
          >
            Use a different email
          </button>
        </div>
        <p className="mt-6 text-center text-[14px] text-muted">
          Already confirmed?{" "}
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-brand-300 underline-offset-4 hover:text-brand-200 hover:underline">
            Sign in
          </Link>
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE }} className="w-full max-w-[420px]">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-brand-300">
        <span className="relative flex h-2 w-2" aria-hidden>
          <span className="absolute inset-0 animate-ping rounded-full bg-brand-400/60 motion-reduce:animate-none" />
          <span className="relative h-2 w-2 rounded-full bg-brand-400" />
        </span>
        {eyebrow}
      </p>
      <h1 className={`font-display mt-3 ${mode === "signup" ? "text-[28px] sm:text-[32px]" : "text-[32px] sm:text-[38px]"} font-semibold leading-[1.12] tracking-tight text-balance`}>{title}</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted text-pretty">{sub}</p>

      {mode === "signup" && forDownload && (
        <ol className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-2 text-[12.5px] text-faint" aria-label="Three steps">
          {["Create account", "Download", "Sign in to the app"].map((s, i) => (
            <li key={s} className="flex items-center gap-2 whitespace-nowrap">
              <span className={`grid h-5 w-5 place-items-center rounded-full text-[10.5px] font-bold ${i === 0 ? "bg-brand-400 text-[#001522]" : "border border-white/15 text-muted"}`}>{i + 1}</span>
              <span className={i === 0 ? "font-medium text-ink" : ""}>{s}</span>
              {i < 2 && <span className="h-px w-3 bg-white/15 sm:w-5" aria-hidden />}
            </li>
          ))}
        </ol>
      )}

      <button
        type="button"
        onClick={google}
        disabled={!!busy || done}
        aria-busy={busy === "google"}
        className="btn btn-primary group mt-7 h-[52px] w-full !gap-3 !rounded-[14px] text-[15.5px] font-semibold disabled:cursor-default"
        data-testid="google"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#fff] shadow-[0_1px_2px_rgb(0_0_0/0.18)]" aria-hidden>
          {busy === "google" ? <Loader2 size={15} className="animate-spin text-[#5f6368]" /> : <GoogleIcon size={16} />}
        </span>
        {busy === "google" ? (
          "Opening Google…"
        ) : mode === "signup" && forDownload ? (
          // one flex item: as two, the button's gap opened a hole between "Google" and "to download Flo"
          <span>
            Continue with Google<span className="hidden min-[400px]:inline">&nbsp;to download Flo</span>
          </span>
        ) : (
          "Continue with Google"
        )}
      </button>
      <p className="mt-2.5 text-center text-[12.5px] text-faint">{mode === "signup" ? "One click. No new password to remember." : "The fastest way in."}</p>

      {!emailOpen && (
        <AnimatePresence initial={false}>
          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              role="alert"
              className="mt-5 flex items-start gap-2.5 rounded-[14px] border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-[13.5px] leading-snug text-amber-100"
            >
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-200" />
              <span>{error}</span>
            </motion.p>
          )}
        </AnimatePresence>
      )}

      <div className="my-6 flex items-center gap-3 text-[12.5px] text-faint">
        <span className="h-px flex-1 bg-white/12" /> or use email <span className="h-px flex-1 bg-white/12" />
      </div>

      {!emailOpen ? (
        <button
          type="button"
          onClick={() => {
            setEmailOpen(true);
            setError(null);
            requestAnimationFrame(() => (mode === "signup" ? nameRef : emailRef).current?.focus());
          }}
          disabled={!!busy || done}
          aria-expanded={false}
          className="btn btn-glass h-12 w-full !rounded-[14px] text-[15px]"
          data-testid="use-email"
        >
          <Mail size={16} aria-hidden /> {mode === "signup" ? "Sign up with email" : "Sign in with email"}
          <ChevronDown size={16} className="opacity-60" aria-hidden />
        </button>
      ) : (
      <motion.form
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-4"
        initial={reduce ? false : { opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE }}
        data-testid="email-form"
      >
        {mode === "signup" && (
          <Field id={`${ids}-name`} label="Your name" error={fieldErr.name}>
            <input
              ref={nameRef}
              id={`${ids}-name`}
              className={fieldCls(!!fieldErr.name)}
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => (setName(e.target.value), clear("name"))}
              placeholder="What should Flo call you?"
              aria-invalid={!!fieldErr.name}
              aria-describedby={fieldErr.name ? `${ids}-name-msg` : undefined}
            />
          </Field>
        )}
        <Field id={`${ids}-email`} label="Email" error={fieldErr.email}>
          <input
            ref={emailRef}
            id={`${ids}-email`}
            className={fieldCls(!!fieldErr.email)}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            value={email}
            onChange={(e) => (setEmail(e.target.value), clear("email"))}
            placeholder="you@example.com"
            aria-invalid={!!fieldErr.email}
            aria-describedby={fieldErr.email ? `${ids}-email-msg` : undefined}
          />
        </Field>
        <Field
          id={`${ids}-pw`}
          label="Password"
          error={fieldErr.password}
          hint={caps ? <><AlertCircle size={13} className="shrink-0" /> Caps Lock is on</> : null}
          aside={
            mode === "signup" ? (
              <Strength value={password} />
            ) : (
              <Link
                href={`/auth/forgot?next=${encodeURIComponent(next)}`}
                className="text-[12.5px] font-medium text-brand-300 underline-offset-4 hover:text-brand-200 hover:underline"
                data-testid="forgot"
              >
                Forgot password?
              </Link>
            )
          }
        >
          <span className="relative block">
            <input
              ref={pwRef}
              id={`${ids}-pw`}
              className={`${fieldCls(!!fieldErr.password)} !pr-12`}
              name="password"
              type={show ? "text" : "password"}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => (setPassword(e.target.value), clear("password"))}
              onKeyDown={capsKey}
              onKeyUp={capsKey}
              onBlur={() => setCaps(false)}
              placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
              aria-invalid={!!fieldErr.password}
              aria-describedby={fieldErr.password || caps ? `${ids}-pw-msg` : undefined}
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

        {mode === "login" && (
          <label className="flex w-fit cursor-pointer items-center gap-2.5 text-[13.5px] text-muted">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="peer sr-only" />
            <span className="grid h-[18px] w-[18px] place-items-center rounded-[6px] border border-white/20 bg-white/5 transition peer-checked:border-transparent peer-checked:bg-brand-400 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-400 [&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100">
              <Check size={12} strokeWidth={3} className="text-[#001522]" />
            </span>
            Remember me on this device
          </label>
        )}

        <AnimatePresence initial={false}>
          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              role="alert"
              className="flex items-start gap-2.5 rounded-[14px] border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-[13.5px] leading-snug text-amber-100"
            >
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-200" />
              <span>{error}</span>
            </motion.p>
          )}
        </AnimatePresence>
        {unconfirmed && (
          <button
            type="button"
            onClick={() => resendConfirmation(email.trim())}
            disabled={resend === "busy" || resend === "sent"}
            className="btn btn-glass h-11 w-full !rounded-[14px] text-[14px]"
            data-testid="resend"
          >
            {resend === "busy" ? <Loader2 size={16} className="animate-spin" /> : resend === "sent" ? <Check size={16} /> : <RotateCw size={15} />}
            {resend === "sent" ? "Sent. Check your inbox" : "Resend confirmation email"}
          </button>
        )}

        <button type="submit" disabled={!!busy || done} aria-busy={busy === "form"} className="btn btn-primary group mt-1 h-12 w-full !rounded-[14px] text-[15px] disabled:cursor-default" data-testid="submit">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={done ? "done" : busy === "form" ? "busy" : "idle"}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: 0.16 }}
              className="flex items-center gap-2"
            >
              {done ? (
                <>
                  <Check size={18} strokeWidth={2.8} /> You&apos;re in
                </>
              ) : busy === "form" ? (
                <>
                  <Loader2 size={17} className="animate-spin" /> {mode === "signup" ? "Creating your account…" : "Signing you in…"}
                </>
              ) : (
                <>
                  {mode === "signup" ? "Create account" : "Sign in"}
                  <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
                </>
              )}
            </motion.span>
          </AnimatePresence>
        </button>
      </motion.form>
      )}

      <p className="mt-6 text-center text-[14px] text-muted">
        {other.text}{" "}
        <Link href={other.href} className="font-semibold text-brand-300 underline-offset-4 hover:text-brand-200 hover:underline">
          {other.cta}
        </Link>
      </p>
      <p className="mt-6 text-center text-[12.5px] leading-relaxed text-faint text-balance">
        <Lock size={12} className="mr-1.5 inline-block -translate-y-px align-middle" aria-hidden />Your words stay on your computer. The account only signs you in.
      </p>
      {mode === "signup" && (
        <p className="mt-2 text-center text-[12px] text-faint">
          By continuing you agree to the{" "}
          <Link href="/terms" className="underline underline-offset-2 hover:text-muted">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-muted">
            Privacy policy
          </Link>
          .
        </p>
      )}
    </motion.div>
  );
}
