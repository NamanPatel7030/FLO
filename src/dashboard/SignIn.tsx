// Full-window sign-in gate (shown while account_status().signedIn is false).
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, CloudOff, ExternalLink, Loader2 } from "lucide-react";
import { accountApi, friendlyAuthError, setAccountUser, continueOffline, type AccountStatus } from "../lib/account";
import { Logo } from "./Logo";
import { Button, Input } from "./ui";
import { MAKER_SITE, openExternal, SignatureMark } from "./Signature";
import { Ribbon } from "../island/Ribbon";

function GoogleG() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
    </svg>
  );
}

export function SignIn({ status }: { status: AccountStatus }) {
  const [email, setEmail] = useState(status.user?.email ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "password" | "google" | "code">(null);
  const [err, setErr] = useState<string | null>(null);
  const [google, setGoogle] = useState<{ state: string } | null>(null);
  const [code, setCode] = useState("");
  const site = status.accountUrl || "http://localhost:3000";

  // the deep link (flo://account) completes Google sign-in on its own; the store listens for it
  useEffect(() => setErr(null), [google]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy("password");
    setErr(null);
    try {
      setAccountUser(await accountApi.login(email.trim(), password));
    } catch (x) {
      setErr(friendlyAuthError(x));
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
    if (!code.trim()) return;
    setBusy("code");
    setErr(null);
    try {
      setAccountUser(await accountApi.exchange(code.trim(), google?.state));
    } catch (x) {
      setErr(friendlyAuthError(x));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-6" data-testid="signin" role="dialog" aria-label="Sign in to Flo">
      <div className="absolute inset-0" style={{ background: "radial-gradient(900px 520px at 50% -10%, rgba(61,187,255,0.22), transparent 70%), linear-gradient(180deg,#03070c,#000)" }} />
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
        className="relative w-full max-w-[400px] rounded-3xl border border-brand-200/15 px-8 pb-7 pt-8 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.85)]"
        style={{ background: "var(--sheet-bg)" }}
      >
        <div className="flex flex-col items-center text-center">
          <Logo size={56} />
          <h1 className="mt-4 text-[24px] font-semibold tracking-tight">Welcome to Flo</h1>
          <p className="mt-1 text-[13.5px] text-muted">Your Assistant. Sign in to get started.</p>
          {/* the notch ribbon, as a quiet signature */}
          <div className="mt-4 h-[26px] w-[220px] overflow-hidden" aria-hidden>
            <Ribbon width={220} height={26} notchWidth={0} wing={110} mode="transcribe" leftWing />
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {!google ? (
            <motion.div key="main" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.18 }} className="mt-5">
              <button
                onClick={startGoogle}
                disabled={!!busy}
                className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-[var(--border)] bg-white text-[14px] font-medium text-[#1f1f1f] transition hover:bg-white/90 disabled:opacity-60"
              >
                {busy === "google" ? <Loader2 size={16} className="animate-spin" /> : <GoogleG />} Continue with Google
              </button>
              <div className="my-4 flex items-center gap-3 text-[11.5px] text-faint">
                <span className="h-px flex-1 bg-[var(--border)]" /> or <span className="h-px flex-1 bg-[var(--border)]" />
              </div>
              <form onSubmit={login} className="flex flex-col gap-2.5">
                <Input type="email" autoComplete="email" aria-label="Email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="!h-11" />
                <Input type="password" autoComplete="current-password" aria-label="Password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="!h-11" />
                <Button type="submit" variant="primary" disabled={!email.trim() || !password || !!busy} className="!h-11 justify-center">
                  {busy === "password" ? "Signing in…" : "Sign in"}
                </Button>
              </form>
            </motion.div>
          ) : (
            <motion.div key="google" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.18 }} className="mt-5" data-testid="google-wait">
              <div className="flex items-center gap-3 rounded-2xl bg-[var(--glass)] px-4 py-3">
                <Loader2 size={18} className="shrink-0 animate-spin text-brand-500 dark:text-brand-300" />
                <div className="text-left">
                  <div className="text-[14px] font-medium">Finish in your browser</div>
                  <div className="text-[12px] text-muted">We'll bring you right back. If it doesn't, paste the code shown there.</div>
                </div>
              </div>
              <form onSubmit={exchange} className="mt-3 flex gap-2">
                <Input aria-label="Paste code" placeholder="Paste code" value={code} onChange={(e) => setCode(e.target.value)} className="!h-11 font-mono tracking-wider" />
                <Button type="submit" variant="primary" disabled={!code.trim() || !!busy} className="!h-11">
                  {busy === "code" ? "…" : "Continue"}
                </Button>
              </form>
              <button className="mt-3 flex items-center gap-1 text-[12.5px] text-muted hover:text-[var(--fg)]" onClick={() => setGoogle(null)}>
                <ArrowLeft size={13} /> Back
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="min-h-[22px] pt-3" aria-live="polite">
          {err && (
            <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-center text-[12.5px] text-amber-500 dark:text-amber-300" role="alert">
              {err}
            </motion.p>
          )}
        </div>

        <div className="mt-2 flex flex-col items-center gap-2 text-[12.5px] text-muted">
          <button className="flex items-center gap-1 hover:text-[var(--fg)]" onClick={() => openExternal(`${site}/signup`)}>
            New here? <span className="font-medium text-brand-500 dark:text-brand-300">Create an account</span> <ExternalLink size={11} />
          </button>
          {status.offline && status.user && (
            <button className="flex items-center gap-1.5 rounded-full px-3 py-1 hover:bg-[var(--glass)] hover:text-[var(--fg)]" onClick={continueOffline}>
              <CloudOff size={13} /> Use offline as {status.user.email}
            </button>
          )}
        </div>
        <p className="mt-5 text-center text-[11px] leading-relaxed text-faint">Your voice, notes and keys stay on this Mac. The account only signs you in.</p>
      </motion.div>
      <button
        onClick={() => openExternal(MAKER_SITE)}
        aria-label="Crafted by Naman Gundaniya"
        title="hellonaman.com"
        className="group absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1.5 text-faint opacity-60 transition hover:opacity-100"
      >
        <span className="text-[9.5px] font-medium uppercase tracking-[0.14em]">crafted by</span>
        <SignatureMark id="signin-sig" className="h-[20px] w-[48px]" />
      </button>
    </div>
  );
}
