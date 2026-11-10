// Settings → Integrations → Google. One click "Connect with Google" (OAuth through our website,
// tokens land in the keychain via flo://google, like Slack), then Calendar meeting alerts in the
// notch and Gmail (read + reply by voice, always confirmed in the notch). Only the chosen scopes are
// requested; turning on one that wasn't granted asks Google again (incremental consent).
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { CalendarDays, ExternalLink, Loader2, Mail, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { api, on } from "../lib/api";
import { DEFAULT_GOOGLE_SETTINGS, EV, type GoogleCalendar, type GoogleEvent, type GoogleSettings, type GoogleStatus } from "../lib/types";
import { useStore } from "./store";
import { Button, Card, CardTitle, Select, Skeleton, Toggle } from "./ui";

/** The official four-colour Google "G" (Google sign-in branding guidelines). */
export const GoogleG = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden>
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    <path fill="none" d="M0 0h48v48H0z" />
  </svg>
);

/** Google's light "Sign in with Google" button style: white, 1px #747775 stroke, #1F1F1F text, G on the left. */
export function ConnectGoogleButton({ onClick, busy, disabled, className }: { onClick: () => void; busy?: boolean; disabled?: boolean; className?: string }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      disabled={busy || disabled}
      className={clsx(
        "inline-flex h-10 items-center gap-2.5 rounded-full border border-[#747775] bg-[#FFFFFF] pl-3 pr-4 text-[14px] font-medium text-[#1F1F1F] transition hover:bg-[#F8F9FA] hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      style={{ fontFamily: "Roboto, 'Google Sans', system-ui, sans-serif" }}
    >
      {busy ? <Loader2 size={20} className="animate-spin text-[#4285F4]" /> : <GoogleG size={20} />}
      Connect with Google
    </motion.button>
  );
}

type Phase = "idle" | "starting" | "waiting";
const LEAD = [1, 2, 5, 10];

export function GoogleCard() {
  const { toast, settings, setSettings } = useStore();
  const [status, setStatus] = useState<GoogleStatus | null | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [want, setWant] = useState<{ calendar: boolean; gmail: boolean }>({ calendar: true, gmail: true });
  const [lastAsk, setLastAsk] = useState<{ calendar: boolean; gmail: boolean }>({ calendar: true, gmail: true });
  const [cals, setCals] = useState<GoogleCalendar[] | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const g: GoogleSettings = { ...DEFAULT_GOOGLE_SETTINGS, ...(settings?.google ?? {}) };

  useEffect(() => {
    let alive = true;
    const refresh = () => api.googleStatus().then((s) => alive && setStatus(s));
    refresh();
    // the flo://google deep link finishing in the backend (or a disconnect elsewhere)
    const off = on<GoogleEvent>(EV.google, (e) => {
      if (e.connected) {
        setError(null);
        refresh();
      } else if (e.error) setError(e.error);
      else setStatus(null);
      setPhase("idle");
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  useEffect(() => {
    if (!status?.calendar) return setCals(null);
    let alive = true;
    api
      .googleCalendars()
      .then((c) => alive && setCals(c))
      .catch(() => alive && setCals([]));
    return () => {
      alive = false;
    };
  }, [status?.calendar, status?.email]);

  /** a service being asked for right now shows checked while the browser round trip runs */
  const asking = (k: "calendar" | "gmail") => phase !== "idle" && lastAsk[k];

  const saveGoogle = (patch: Partial<GoogleSettings>) => settings && setSettings({ ...settings, google: { ...g, ...patch } });

  const start = async (ask: { calendar: boolean; gmail: boolean }) => {
    setError(null);
    setLastAsk(ask);
    setPhase("starting");
    try {
      await api.googleOauthStart(ask.calendar, ask.gmail);
      setPhase("waiting");
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
      setPhase("idle");
    }
  };

  /** Turning a service on asks Google for it when it wasn't granted yet (incremental consent). */
  const setService = (k: "calendar" | "gmail", on: boolean) => {
    saveGoogle({ [k]: on });
    if (on && status && !status[k]) start({ calendar: k === "calendar" || status.calendar, gmail: k === "gmail" || status.gmail });
  };

  const toggleCal = (id: string, on: boolean) => {
    if (!cals) return;
    const next = cals.map((c) => (c.id === id ? { ...c, selected: on } : c));
    setCals(next);
    const ids = next.filter((c) => c.selected).map((c) => c.id);
    // empty = primary only
    saveGoogle({ calendars: ids.length === 1 && next.find((c) => c.id === ids[0])?.primary ? [] : ids });
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await api.googleDisconnect();
      setStatus(null);
      setConfirmOff(false);
      toast({ kind: "success", text: "Google disconnected and access revoked" });
    } catch (e) {
      toast({ kind: "error", text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const waiting =
    phase === "waiting" ? (
      <div className="flex items-center gap-3 rounded-2xl bg-[var(--glass)] p-3" data-testid="google-waiting">
        <Loader2 size={18} className="shrink-0 animate-spin text-brand-300" />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium">Finish in your browser</div>
          <div className="text-[12px] text-muted">Approve Flo on Google. This card updates by itself.</div>
        </div>
        <Button size="sm" variant="ghost" icon={<ExternalLink size={13} />} onClick={() => start(lastAsk)}>
          Open again
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setPhase("idle")}>
          Cancel
        </Button>
      </div>
    ) : null;

  const errorBox = error && (
    <p role="alert" className="rounded-xl border border-rose-300/25 bg-rose-400/10 px-3 py-2 text-[12.5px] text-rose-200">
      {error}
    </p>
  );

  return (
    <Card className="p-5">
      <div data-testid="google-card">
        <CardTitle icon={<GoogleG />}>Google</CardTitle>
        {status === undefined ? (
          <Skeleton className="h-16" />
        ) : status ? (
          <div className="flex flex-col gap-3" data-testid="google-connected">
            <div className="flex items-center gap-3 rounded-2xl bg-[var(--glass)] p-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#fff] shadow-sm">
                <GoogleG size={22} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold" data-testid="google-email">
                  {status.email}
                </div>
                <div className="truncate text-[12px] text-muted">
                  {[status.calendar && "Calendar", status.gmail && "Gmail"].filter(Boolean).join(" and ") || "No services yet"}
                </div>
              </div>
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10.5px] font-medium text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" /> Connected
              </span>
            </div>
            {waiting}
            {errorBox}

            <ServiceCheck
              icon={<CalendarDays size={14} />}
              label="Calendar"
              hint={status.calendar ? "Meeting alerts in the notch and your agenda" : "Not allowed yet: checking it asks Google"}
              checked={g.calendar && (status.calendar || asking("calendar"))}
              onChange={(v) => setService("calendar", v)}
            />
            {g.calendar && status.calendar && (
              <div className="ml-6 flex flex-col gap-1 border-l border-[var(--border)] pl-4">
                <div className="flex items-center justify-between gap-6 py-1.5">
                  <div>
                    <div className="text-[13.5px] font-medium">Alert before meetings</div>
                    <div className="mt-0.5 text-[12px] text-muted">A card in the notch with Join and Take notes</div>
                  </div>
                  <Select
                    value={String(g.alertMinutes)}
                    onChange={(v) => saveGoogle({ alertMinutes: Number(v) })}
                    options={LEAD.map((m) => ({ value: String(m), label: `${m} min before` }))}
                  />
                </div>
                <Toggle label="Alert for events without other guests" hint="Focus blocks and reminders you made for yourself" checked={g.alertSolo} onChange={(v) => saveGoogle({ alertSolo: v })} />
                <div className="py-1.5">
                  <div className="text-[13.5px] font-medium">Calendars</div>
                  {!cals ? (
                    <Skeleton className="mt-2 h-8" />
                  ) : (
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5" data-testid="google-calendars">
                      {cals.map((c) => (
                        <label key={c.id} className="flex cursor-pointer items-center gap-2 text-[12.5px]">
                          <input type="checkbox" checked={c.selected} onChange={(e) => toggleCal(c.id, e.target.checked)} className="accent-brand-400" />
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color ?? "var(--fg-faint)" }} />
                          {c.summary}
                          {c.primary && <span className="text-faint">(primary)</span>}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <ServiceCheck
              icon={<Mail size={14} />}
              label="Gmail"
              hint={status.gmail ? "Ask about your email and reply by voice. Flo always asks before sending." : "Not allowed yet: checking it asks Google"}
              checked={g.gmail && (status.gmail || asking("gmail"))}
              onChange={(v) => setService("gmail", v)}
            />
            {g.gmail && status.gmail && (
              <div className="ml-6 border-l border-[var(--border)] pl-4">
                <Toggle label="Turn emails that need a reply into to-dos" hint="Checked on this computer. Nothing is sent without your OK." checked={g.gmailTodos} onChange={(v) => saveGoogle({ gmailTodos: v })} />
              </div>
            )}

            {/* no mode="wait": a quick Cancel → Disconnect must show the question again at once */}
            <AnimatePresence initial={false}>
              {confirmOff ? (
                <motion.div
                  key="confirm"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col gap-2.5 rounded-2xl border border-rose-300/20 bg-rose-400/[0.06] p-3"
                  data-testid="google-disconnect-confirm"
                >
                  <div className="text-[13px] font-medium">Disconnect Google from Flo?</div>
                  <div className="text-[12.5px] text-muted">Flo revokes its access at Google and forgets the tokens on this computer.</div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="danger" icon={<Unplug size={13} />} disabled={busy} onClick={disconnect}>
                      Disconnect
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmOff(false)}>
                      Cancel
                    </Button>
                  </div>
                </motion.div>
              ) : (
                <motion.div key="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex gap-2">
                  {status.gmail && g.gmail && (
                    <Button
                      size="sm"
                      icon={<RefreshCw size={13} />}
                      onClick={async () => {
                        try {
                          const n = await api.gmailSyncNow();
                          toast({ kind: "success", text: `${n} email to-do${n === 1 ? "" : "s"} added` });
                        } catch (e) {
                          toast({ kind: "error", text: String(e) });
                        }
                      }}
                    >
                      Check email now
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" icon={<Unplug size={13} />} onClick={() => setConfirmOff(true)}>
                    Disconnect
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <div className="flex flex-col gap-3" data-testid="google-disconnected">
            <p className="-mt-1.5 text-[12.5px] text-muted">See your next meeting in the notch, take notes in one click, and answer email by voice. Flo always asks before sending.</p>
            <div className="flex flex-col">
              <ServiceCheck icon={<CalendarDays size={14} />} label="Calendar" hint="Meeting alerts in the notch and your agenda" checked={want.calendar} onChange={(v) => setWant((w) => ({ ...w, calendar: v }))} />
              <ServiceCheck icon={<Mail size={14} />} label="Gmail" hint="Read and reply to email by voice" checked={want.gmail} onChange={(v) => setWant((w) => ({ ...w, gmail: v }))} />
            </div>
            {waiting ?? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <ConnectGoogleButton
                  onClick={() => {
                    saveGoogle({ calendar: want.calendar, gmail: want.gmail });
                    start(want);
                  }}
                  busy={phase === "starting"}
                  disabled={!want.calendar && !want.gmail}
                />
                <span className="flex items-center gap-1.5 text-[12px] text-faint">
                  <ShieldCheck size={13} /> Opens Google in your browser. Tokens stay on your computer.
                </span>
              </div>
            )}
            {errorBox}
          </div>
        )}
      </div>
    </Card>
  );
}

function ServiceCheck({ icon, label, hint, checked, onChange }: { icon: React.ReactNode; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 py-1.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-[3px] accent-brand-400" aria-label={label} />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[13.5px] font-medium">
          <span className="text-muted">{icon}</span>
          {label}
        </span>
        <span className="mt-0.5 block text-[12px] text-muted">{hint}</span>
      </span>
    </label>
  );
}
