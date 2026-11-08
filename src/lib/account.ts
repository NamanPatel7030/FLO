// Flo account (docs/03-accounts-contract.md). The account only gates sign-in; everything else
// stays on this Mac. Types: lib/types.ts.
import { useEffect, useSyncExternalStore } from "react";
import { invokeRaw, on } from "./api";
import { EV, type AccountStatus, type AccountUser } from "./types";

export type { AccountStatus, AccountUser };

export interface AccountEvent {
  signedIn: boolean;
  user?: AccountUser;
}

export const EV_ACCOUNT = EV.account;

export const accountApi = {
  status: () => invokeRaw<AccountStatus>("account_status"),
  login: (email: string, password: string) => invokeRaw<AccountUser>("account_login", { email, password }),
  googleStart: () => invokeRaw<{ state: string }>("account_google_start"),
  exchange: (code: string, state?: string) => invokeRaw<AccountUser>("account_exchange", { code, state }),
  logout: () => invokeRaw<void>("account_logout"),
};

/** Turn backend / network errors into something a person can act on. */
export function friendlyAuthError(e: unknown): string {
  const s = String((e as { message?: string })?.message ?? e).toLowerCase();
  if (/offline|network|connect|unreachable|timed? ?out|dns|fetch|resolve/.test(s)) return "Can't reach Flo right now. Check your internet and try again.";
  if (/401|invalid (email|credentials)|wrong|password|unauthori[sz]ed/.test(s)) return "That email and password don't match. Try again or reset it on the website.";
  if (/400|invalid code|expired|code/.test(s)) return "That code didn't work. Codes expire after 5 minutes, start again to get a new one.";
  if (/rate|429|too many/.test(s)) return "Too many tries. Wait a minute and try again.";
  return "Something went wrong signing in. Please try again.";
}

/** "Naman Gundaniya" → "NG", "p@x.co" → "P" */
export function initials(user?: Pick<AccountUser, "name" | "email">): string {
  const n = (user?.name || "").trim();
  if (n) return n.split(/\s+/).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return (user?.email?.[0] ?? "?").toUpperCase();
}

// ── tiny shared store (dashboard gate + Settings → Account) ─────────────────
let current: AccountStatus | null = null;
/** "Use offline" for this run only (cached user, server unreachable) */
let offlineOk = false;
const subs = new Set<() => void>();
/** one immutable snapshot per change (useSyncExternalStore compares by identity) */
let snapshot: { status: AccountStatus | null; offlineOk: boolean } = { status: null, offlineOk: false };
/** while the sign-in screen plays its short "you're in" beat, a signed-in update waits (UI only) */
let holding = false;
let held = false;
let holdTimer: ReturnType<typeof setTimeout> | undefined;
const emit = () => {
  if (holding && current?.signedIn) {
    held = true;
    return;
  }
  snapshot = { status: current, offlineOk };
  subs.forEach((f) => f());
};

/** Defer the gate closing (sign-in success animation). Always released within 10 s. */
export function holdSignInGate(on: boolean) {
  clearTimeout(holdTimer);
  holding = on;
  if (on) holdTimer = setTimeout(() => holdSignInGate(false), 10_000);
  else if (held) {
    held = false;
    emit();
  }
}

export async function refreshAccount(): Promise<AccountStatus | null> {
  try {
    current = await accountApi.status();
  } catch {
    current = current ?? { signedIn: false, accountUrl: "", offline: true };
  }
  emit();
  return current;
}

export function setAccountUser(user: AccountUser) {
  current = { ...(current ?? { accountUrl: "", offline: false }), signedIn: true, user, offline: false };
  emit();
}

export function continueOffline() {
  offlineOk = true;
  emit();
}

export function useAccount(): { status: AccountStatus | null; offlineOk: boolean } {
  const snap = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => snapshot,
  );
  useEffect(() => {
    if (!current) refreshAccount();
    return on<AccountEvent>(EV_ACCOUNT, (e) => {
      if (e?.signedIn && e.user) setAccountUser(e.user);
      else refreshAccount();
    });
  }, []);
  return snap;
}

/** Backend refuses dictation / assistant while signed out; its error says so. */
export const isSignInError = (msg?: string) => !!msg && /sign(ed)? ?in|signed out|not signed|log ?in to flo|account/i.test(msg);
