// Full-window sign-in gate (shown while account_status().signedIn is false).
// Split layout: the form on the left, a living notch illustration on the right (stacks when narrow).
import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertCircle, ArrowLeft, ArrowRight, Check, CloudOff, Eye, EyeOff, Globe, Loader2, Lock } from "lucide-react";
import { accountApi, friendlyAuthError, setAccountUser, continueOffline, holdSignInGate, type AccountStatus, type AccountUser } from "../lib/account";
import { greeting } from "../lib/format";
import { LogoMark } from "./Logo";
import { MAKER_SITE, openExternal, SignatureMark } from "./Signature";
import { SignInScene } from "./SignInScene";

const EASE = [0.2, 0.8, 0.2, 1] as const;
const REMEMBER_KEY = "flo.signin.email";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const store = {
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
      /* private mode: nothing to remember */
    }
  },
};

export function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 2.9-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.5z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.9-6.2z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

const firstName = (u?: Pick<AccountUser, "name" | "email">) => (u?.name || "").trim().split(/\s+/)[0] || "";

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string | null;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12.5px] font-medium text-[var(--fg-muted)]">
        {label}
      </label>
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
            className={`flex items-center gap-1.5 overflow-hidden text-[12px] ${error ? "text-amber-300 [html[data-theme=light]_&]:text-amber-700" : "text-[var(--fg-muted)]"}`}
          >
            {error || hint}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

const inputCls =
  "h-12 w-full rounded-[14px] border bg-[var(--glass)] px-4 text-[14.5px] text-[var(--fg)] outline-none transition placeholder:text-[var(--fg-faint)] focus:bg-[var(--glass-strong)] focus:ring-4";
const inputState = (bad: boolean) => (bad ? "border-amber-400/60 focus:border-amber-400/70 focus:ring-amber-400/15" : "border-[var(--border-strong)] focus:border-brand-400/70 focus:ring-brand-500/15");

export function SignIn({ status }: { status: AccountStatus }) {
  const reduce = !!useReducedMotion();
  const remembered = useRef(store.get()).current;
  const [email, setEmail] = useState(status.user?.email ?? remembered);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState<null | "password" | "google" | "code">(null);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<{ email?: string | null; password?: string | null }>({});
  const [google, setGoogle] = useState<{ state: string } | null>(null);
  const [code, setCode] = useState("");
  const [done, setDone] = useState<AccountUser | null>(null);
  const site = status.accountUrl || "http://localhost:3000";
  const ids = useId().replace(/:/g, "");
  const emailRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  const hello = greeting(new Date().getHours());
  const knownName = firstName(status.user);
  const returning = !!(status.user || remembered);

  // the deep link (flo://account) completes Google sign-in on its own; the store listens for it
  useEffect(() => setErr(null), [google]);
  // land the cursor where the person needs it
  useEffect(() => {
    if (google) return;
    (email ? pwRef : emailRef).current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [google]);

  /** a short "you're in" beat, then hand over to the app */
  const enter = (user: AccountUser) => {
    setDone(user);
    setTimeout(() => {
      holdSignInGate(false);
      setAccountUser(user);
    }, reduce ? 250 : 900);
  };
  // never leave the gate held if this screen goes away mid-flight
  useEffect(() => () => holdSignInGate(false), []);

  const validate = () => {
    const e = email.trim();
    const next = {
      email: !e ? "Add your email so we know it's you." : EMAIL_RE.test(e) ? null : "That email looks incomplete. It needs an @ and a domain, like name@example.com.",
      password: password ? null : "Type your password to continue.",
    };
    setFieldErr(next);
    if (next.email) emailRef.current?.focus();
    else if (next.password) pwRef.current?.focus();
    return !next.email && !next.password;
  };

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || done) return;
    if (!validate()) return;
    setBusy("password");
    setErr(null);
    holdSignInGate(true);
    try {
      const user = await accountApi.login(email.trim(), password);
      store.set(remember ? email.trim() : null);
      enter(user);
    } catch (x) {
      holdSignInGate(false);
      setErr(friendlyAuthError(x));
      pwRef.current?.select();
    } finally {
      setBusy(null);
    }
  };

  const startGoogle = async () => {
    setBusy("google");
    setErr(null);
    try {
      setGoogle(await accountApi.googleStart());
    } catch (x) {
      setErr(friendlyAuthError(x));
    } finally {
      setBusy(null);
    }
  };

  const exchange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || busy || done) return;
    setBusy("code");
    setErr(null);
    holdSignInGate(true);
    try {
      enter(await accountApi.exchange(code.trim(), google?.state));
    } catch (x) {
      holdSignInGate(false);
      setErr(friendlyAuthError(x));
    } finally {
      setBusy(null);
    }
  };

  const capsKey = (e: React.KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.("CapsLock") ?? false);
  const slide = (dir: 1 | -1) => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, x: 16 * dir },
    animate: { opacity: 1, x: 0 },
    exit: reduce ? { opacity: 0 } : { opacity: 0, x: -16 * dir },
    transition: { duration: 0.22, ease: EASE },
  });

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--bg)] text-[var(--fg)]" data-testid="signin" role="dialog" aria-modal="true" aria-labelledby={`${ids}-title`}>
      {/* soft aurora, tinted by the live accent */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(900px 600px at 0% -10%, rgb(var(--accent-rgb) / 0.20), transparent 60%), radial-gradient(700px 520px at 45% 120%, rgb(var(--accent-rgb) / 0.12), transparent 60%), var(--bg)",
        }}
      />
      <div className="relative grid min-h-full md:grid-cols-[minmax(400px,1fr)_minmax(0,1.08fr)]">
        {/* ── left: the form ─────────────────────────────────────────────── */}
        <section className="flex min-h-full flex-col px-8 pb-6 pt-7 sm:px-12 lg:px-16">
          <div className="flex items-center gap-2.5">
            <LogoMark size={30} />
            <span className="text-[16px] font-semibold tracking-tight">Flo</span>
          </div>

          <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-10">
            <AnimatePresence mode="wait" initial={false}>
              {done ? (
                <motion.div key="done" {...slide(1)} className="flex flex-col items-center text-center" data-testid="signin-success" role="status">
                  <motion.span
                    initial={reduce ? false : { scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 380, damping: 20 }}
                    className="accent-gradient grid h-16 w-16 place-items-center rounded-full shadow-[0_0_40px_-6px_rgb(var(--accent-rgb)/0.8)]"
                  >
                    <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden>
                      <motion.path d="M5 12.5 10 17 19 7.5" fill="none" stroke="#00243a" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.45, delay: 0.12, ease: EASE }} />
                    </svg>
                  </motion.span>
                  <h1 id={`${ids}-title`} className="mt-5 text-[26px] font-semibold tracking-tight">
                    You're in{firstName(done) ? `, ${firstName(done)}` : ""}.
                  </h1>
                  <p className="mt-1.5 text-[14px] text-[var(--fg-muted)]">Opening Flo…</p>
                </motion.div>
              ) : !google ? (
                <motion.div key="main" {...slide(-1)}>
                  <p className="flex items-center gap-2 text-[13px] font-medium text-brand-300 [html[data-theme=light]_&]:text-brand-700">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inset-0 animate-ping rounded-full bg-brand-400/60 motion-reduce:animate-none" />
                      <span className="relative h-2 w-2 rounded-full bg-brand-400" />
                    </span>
                    {hello}
                  </p>
                  <h1 id={`${ids}-title`} className="mt-2 text-[30px] font-semibold leading-[1.15] tracking-tight">
                    {returning ? <>Welcome back{knownName ? `, ${knownName}` : ""}</> : "Sign in to Flo"}
                  </h1>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--fg-muted)]">
                    {returning ? "Let's pick up where you left off." : "One quick sign-in, then Flo is all yours."}
                  </p>

                  <button
                    type="button"
                    onClick={startGoogle}
                    disabled={!!busy}
                    className="mt-7 flex h-12 w-full items-center justify-center gap-3 rounded-[14px] border border-black/10 bg-white text-[14.5px] font-semibold text-[#1f1f1f] shadow-[0_1px_0_rgb(255_255_255/0.6)_inset,0_10px_24px_-14px_rgb(0_0_0/0.6)] transition hover:bg-[#f5f8fb] active:scale-[0.99] disabled:opacity-60"
                  >
                    {busy === "google" ? <Loader2 size={18} className="animate-spin text-[#5f6368]" /> : <GoogleG />} Continue with Google
                  </button>

                  <div className="my-6 flex items-center gap-3 text-[12px] text-[var(--fg-faint)]">
                    <span className="h-px flex-1 bg-[var(--border-strong)]" /> or use your email <span className="h-px flex-1 bg-[var(--border-strong)]" />
                  </div>

                  <form onSubmit={login} noValidate className="flex flex-col gap-4">
                    <Field id={`${ids}-email`} label="Email" error={fieldErr.email}>
                      <input
                        ref={emailRef}
                        id={`${ids}-email`}
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        spellCheck={false}
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (fieldErr.email) setFieldErr((f) => ({ ...f, email: null }));
                        }}
                        aria-invalid={!!fieldErr.email}
                        aria-describedby={fieldErr.email ? `${ids}-email-msg` : undefined}
                        className={`${inputCls} ${inputState(!!fieldErr.email)}`}
                      />
                    </Field>
                    <Field
                      id={`${ids}-pw`}
                      label="Password"
                      error={fieldErr.password}
                      hint={caps ? <><AlertCircle size={13} className="shrink-0" /> Caps Lock is on</> : null}
                    >
                      <div className="relative">
                        <input
                          ref={pwRef}
                          id={`${ids}-pw`}
                          type={show ? "text" : "password"}
                          autoComplete="current-password"
                          placeholder="Your password"
                          value={password}
                          onChange={(e) => {
                            setPassword(e.target.value);
                            if (fieldErr.password) setFieldErr((f) => ({ ...f, password: null }));
                          }}
                          onKeyDown={capsKey}
                          onKeyUp={capsKey}
                          onBlur={() => setCaps(false)}
                          aria-invalid={!!fieldErr.password}
                          aria-describedby={fieldErr.password || caps ? `${ids}-pw-msg` : undefined}
                          className={`${inputCls} pr-12 ${inputState(!!fieldErr.password)}`}
                        />
                        <button
                          type="button"
                          onClick={() => setShow((v) => !v)}
                          aria-pressed={show}
                          title={show ? "Hide" : "Show"}
                          aria-label={show ? "Hide what you typed" : "Show what you typed"}
                          className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-[10px] text-[var(--fg-faint)] transition hover:bg-[var(--glass-hover)] hover:text-[var(--fg)]"
                        >
                          {show ? <EyeOff size={17} /> : <Eye size={17} />}
                        </button>
                      </div>
                    </Field>

                    <label className="flex w-fit cursor-pointer items-center gap-2.5 text-[13px] text-[var(--fg-muted)]">
                      <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="peer sr-only" />
                      <span className="grid h-[18px] w-[18px] place-items-center rounded-[6px] border border-[var(--border-strong)] bg-[var(--glass)] transition peer-checked:border-transparent peer-checked:bg-brand-500 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-400 [&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100">
                        <Check size={12} strokeWidth={3} className="text-white" />
                      </span>
                      Remember me on this Mac
                    </label>

                    <AnimatePresence initial={false}>
                      {err && (
                        <motion.p
                          key={err}
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          role="alert"
                          className="flex items-start gap-2.5 rounded-[14px] border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-[13px] leading-snug text-amber-200 [html[data-theme=light]_&]:text-amber-800"
                        >
                          <AlertCircle size={16} className="mt-px shrink-0" /> {err}
                        </motion.p>
                      )}
                    </AnimatePresence>

                    <motion.button
                      type="submit"
                      whileTap={busy ? undefined : { scale: 0.985 }}
                      disabled={!!busy}
                      aria-busy={busy === "password"}
                      className="btn-primary group mt-1 flex h-12 [html[data-theme=light]_&]:!text-[#03304d] [html[data-theme=light]_&]:[text-shadow:none] w-full items-center justify-center gap-2 rounded-[14px] text-[15px] disabled:opacity-80"
                    >
                      {busy === "password" ? (
                        <>
                          <Loader2 size={17} className="animate-spin" /> Signing you in…
                        </>
                      ) : (
                        <>
                          Sign in <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
                        </>
                      )}
                    </motion.button>
                  </form>

                  <p className="mt-6 text-center text-[13.5px] text-[var(--fg-muted)]">
                    New to Flo?{" "}
                    <button type="button" className="inline-flex items-center gap-1 font-semibold text-brand-300 underline-offset-4 hover:underline [html[data-theme=light]_&]:text-brand-700" onClick={() => openExternal(`${site}/signup`)}>
                      Create a free account <Globe size={12} aria-hidden />
                    </button>
                  </p>
                  {status.offline && status.user && (
                    <div className="mt-4 flex justify-center">
                      <button
                        type="button"
                        className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--glass)] px-4 py-2 text-[13px] text-[var(--fg-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--fg)]"
                        onClick={continueOffline}
                      >
                        <CloudOff size={14} /> Use offline as {status.user.email}
                      </button>
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div key="google" {...slide(1)} data-testid="google-wait">
                  <button type="button" className="-ml-1 flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-[13px] text-[var(--fg-muted)] hover:text-[var(--fg)]" onClick={() => setGoogle(null)}>
                    <ArrowLeft size={14} /> Back
                  </button>
                  <div className="mt-6 grid h-14 w-14 place-items-center rounded-2xl border border-[var(--border)] bg-white shadow-[0_10px_30px_-12px_rgb(var(--accent-rgb)/0.6)]">
                    <GoogleG size={26} />
                  </div>
                  <h1 id={`${ids}-title`} className="mt-5 text-[28px] font-semibold leading-tight tracking-tight">
                    Finish in your browser
                  </h1>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--fg-muted)]">
                    We opened Google in your browser. Pick your account and we'll bring you right back here.
                  </p>
                  <div className="mt-5 flex items-center gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--glass)] px-4 py-3 text-[13px] text-[var(--fg-muted)]">
                    <Loader2 size={16} className="shrink-0 animate-spin text-brand-300 [html[data-theme=light]_&]:text-brand-600" /> Waiting for Google…
                  </div>

                  <form onSubmit={exchange} className="mt-7">
                    <label htmlFor={`${ids}-code`} className="text-[12.5px] font-medium text-[var(--fg-muted)]">
                      Didn't come back? Paste the code from the browser.
                    </label>
                    <div className="mt-1.5 flex gap-2">
                      <input
                        id={`${ids}-code`}
                        aria-label="Paste code"
                        placeholder="ABC-123"
                        autoComplete="one-time-code"
                        spellCheck={false}
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        className={`${inputCls} ${inputState(false)} font-mono uppercase tracking-[0.2em]`}
                      />
                      <button type="submit" disabled={!code.trim() || !!busy} className="btn-primary flex h-12 shrink-0 [html[data-theme=light]_&]:!text-[#03304d] [html[data-theme=light]_&]:[text-shadow:none] items-center gap-1.5 rounded-[14px] px-5 text-[14.5px] disabled:opacity-50">
                        {busy === "code" ? <Loader2 size={16} className="animate-spin" aria-label="Checking" /> : "Continue"}
                      </button>
                    </div>
                  </form>
                  <AnimatePresence initial={false}>
                    {err && (
                      <motion.p
                        key={err}
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        role="alert"
                        className="mt-4 flex items-start gap-2.5 rounded-[14px] border border-amber-400/30 bg-amber-400/10 px-3.5 py-3 text-[13px] leading-snug text-amber-200 [html[data-theme=light]_&]:text-amber-800"
                      >
                        <AlertCircle size={16} className="mt-px shrink-0" /> {err}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="mx-auto flex w-full max-w-[380px] flex-col items-center gap-4">
            <p className="text-balance text-center text-[12px] leading-relaxed text-[var(--fg-faint)]">
              <Lock size={12} className="mr-1.5 inline-block -translate-y-px align-middle" aria-hidden />Your words stay on your Mac. The account only signs you in.
            </p>
            <button
              type="button"
              onClick={() => openExternal(MAKER_SITE)}
              aria-label="Crafted by Naman Gundaniya"
              title="hellonaman.com"
              className="flex items-center gap-1.5 text-[var(--fg-faint)] opacity-70 transition hover:opacity-100"
            >
              <span className="text-[9.5px] font-medium uppercase tracking-[0.14em]">crafted by</span>
              <SignatureMark id="signin-sig" className="h-[20px] w-[48px]" />
            </button>
          </div>
        </section>

        {/* ── right: the notch, alive ────────────────────────────────────── */}
        <aside className="relative hidden p-3 md:block" aria-hidden>
          <div
            className="relative flex h-full min-h-[560px] flex-col overflow-hidden rounded-[28px] border border-white/10"
            style={{
              background:
                "radial-gradient(120% 70% at 50% -10%, rgba(61,187,255,0.30), transparent 60%), radial-gradient(80% 60% at 100% 100%, rgba(26,155,224,0.22), transparent 60%), linear-gradient(170deg, #0a2a44 0%, #061726 45%, #03080e 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12), 0 30px 80px -40px rgba(0,0,0,0.8)",
            }}
          >
            <div className="flex flex-1">
              <SignInScene greeting={hello} name={knownName || undefined} />
            </div>
            <div className="px-10 pb-9">
              <p className="text-[22px] font-semibold leading-snug tracking-tight text-[#f3f9ff]">Speak. Flo writes, answers and remembers.</p>
              <p className="mt-1.5 text-[13.5px] text-[rgba(226,240,255,0.62)]">Dictation, to-dos and translation, right in your notch.</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
