// Active / Away switch (sidebar + Settings) and paired phones (Settings → General).
// Away = AFK: Claude sessions, to-do reminders, scheduled skills and meeting notes go to your
// phone as short summaries. Active = nothing leaves the Mac. Backend: src-tauri/src/push.rs.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import clsx from "clsx";
import { BellRing, Check, Moon, QrCode, RefreshCw, ShieldCheck, Smartphone, Trash2, X } from "lucide-react";
import { api } from "../lib/api";
import { relativeTime } from "../lib/format";
import { countdown, presenceHint, qrMatrix, qrPath, usePresence } from "../lib/presence";
import type { PairCode, PhoneDevice, PresenceStatus, Settings } from "../lib/types";
import { Button, Card, Select, Toggle } from "./ui";

const errText = (e: unknown) => String((e as { message?: string })?.message ?? e).replace(/^Error:\s*/, "");

/** Two-segment Active | Away switch. */
export function PresenceSwitch({ status, onChange, busy, size = "sm" }: { status: PresenceStatus; onChange: (s: PresenceStatus) => void; busy?: boolean; size?: "sm" | "md" }) {
  const opts: { id: PresenceStatus; label: string }[] = [
    { id: "active", label: "Active" },
    { id: "away", label: "Away" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Presence"
      className={clsx("relative grid grid-cols-2 rounded-[11px] bg-[var(--glass)] p-[3px] ring-1 ring-inset ring-[var(--border)]", size === "md" ? "w-[196px]" : "w-full")}
    >
      {opts.map((o) => {
        const on = status === o.id;
        return (
          <button
            key={o.id}
            role="radio"
            aria-checked={on}
            disabled={busy}
            onClick={() => !on && onChange(o.id)}
            className={clsx(
              "relative flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors",
              size === "md" ? "h-8 text-[13px]" : "h-[28px] text-[12.5px]",
              on ? (o.id === "away" ? "text-amber-100" : "text-[var(--fg)]") : "text-muted hover:text-[var(--fg)]",
            )}
          >
            {on && (
              <motion.span
                layoutId={`presence-pill-${size}`}
                transition={{ type: "spring", stiffness: 520, damping: 38 }}
                className={clsx(
                  "absolute inset-0 rounded-lg",
                  o.id === "away" ? "bg-amber-500/25 ring-1 ring-inset ring-amber-300/35" : "glass-strong ring-1 ring-inset ring-emerald-300/20",
                )}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {o.id === "active" ? (
                <span className={clsx("h-[7px] w-[7px] rounded-full transition", on ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" : "bg-emerald-400/35")} />
              ) : (
                <Moon size={12} className={clsx("transition", on ? "fill-amber-300/60 text-amber-300" : "text-amber-300/45")} />
              )}
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Sidebar card above the status card. */
export function PresenceSidebarCard() {
  const { info, status, busy, set } = usePresence();
  const away = status === "away";
  return (
    <motion.div
      data-testid="presence-card"
      data-status={status}
      layout
      className={clsx(
        "mb-2.5 rounded-2xl p-2 transition-colors duration-300",
        away ? "bg-amber-500/[0.09] ring-1 ring-inset ring-amber-300/25 shadow-[0_8px_28px_-14px_rgba(245,158,11,0.55)]" : "glass-strong",
      )}
    >
      <PresenceSwitch status={status} busy={busy} onChange={(s) => set(s).catch(() => {})} />
      <AnimatePresence initial={false} mode="wait">
        <motion.div
          key={status + String(info?.signedIn)}
          initial={{ opacity: 0, y: -2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          data-testid="presence-hint"
          className={clsx("mt-1.5 flex items-start gap-1.5 px-1 text-[11.5px] leading-snug text-balance", away ? "text-amber-200/90" : "text-muted")}
        >
          {away ? (
            <>
              <Smartphone size={12} className="mt-[1px] shrink-0 text-amber-300" />
              <span>{info?.signedIn === false ? "Away · sign in to reach your phone" : "Away · notifications go to your phone"}</span>
            </>
          ) : (
            <span>At your Mac · no phone alerts</span>
          )}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Settings → General → "Presence & phone". */
export function PresenceSettings({ s, set }: { s: Settings; set: (patch: Partial<Settings>) => void }) {
  const p = usePresence();
  const away = p.status === "away";
  return (
    <div className="space-y-4" data-testid="presence-settings">
      <Card className={clsx("divide-y divide-[var(--border)] px-5 py-1 transition-colors", away && "ring-1 ring-inset ring-amber-300/20")}>
        <Row label="Status" hint={<span className={away ? "text-amber-200/90" : undefined}>{presenceHint(p.info)}</span>}>
          <PresenceSwitch size="md" status={p.status} busy={p.busy} onChange={(st) => p.set(st).catch(() => {})} />
        </Row>
        <div className="py-1">
          <Toggle
            checked={!!s.autoAway}
            onChange={(v) => set({ autoAway: v })}
            label="Go away automatically"
            hint="When the screen locks, or after a while without keyboard or mouse. Comes back when you do."
          />
          {s.autoAway && (
            <div className="flex items-center justify-between gap-6 pb-2.5">
              <div className="text-[12px] text-muted">Idle for</div>
              <Select
                value={String(s.autoAwayMinutes ?? 10)}
                onChange={(v) => set({ autoAwayMinutes: Number(v) })}
                options={["5", "10", "15", "30", "60"].map((m) => ({ value: m, label: `${m} minutes` }))}
              />
            </div>
          )}
        </div>
      </Card>
      <PhonesCard signedIn={p.info?.signedIn ?? false} away={away} />
    </div>
  );
}

function PhonesCard({ signedIn, away }: { signedIn: boolean; away: boolean }) {
  const [devices, setDevices] = useState<PhoneDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const [test, setTest] = useState<{ busy?: boolean; text?: string; ok?: boolean }>({});

  const refresh = () =>
    api
      .listPhones()
      .then((d) => {
        setDevices(d);
        setError(null);
      })
      .catch((e) => setError(errText(e)));
  useEffect(() => {
    if (signedIn) refresh();
  }, [signedIn]);

  const sendTest = async () => {
    setTest({ busy: true });
    try {
      const r = await api.sendTestPush();
      setTest({
        ok: r.pushed > 0,
        text:
          r.pushed > 0
            ? `Sent to ${r.pushed} phone${r.pushed === 1 ? "" : "s"}.`
            : r.reason === "push not configured"
              ? "Saved to your phone's inbox. Instant push isn't set up on this server yet."
              : r.reason === "no paired devices"
                ? "Pair a phone first."
                : `Saved to your phone's inbox${r.reason ? ` (${r.reason})` : ""}.`,
      });
    } catch (e) {
      setTest({ ok: false, text: errText(e) });
    }
  };

  return (
    <div data-testid="phones-card"><Card className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13.5px] font-medium">
            <Smartphone size={15} className="text-brand-300" /> Your phones
          </div>
          <div className="mt-0.5 text-[12px] text-muted">While you're Away, Flo sends short summaries here: Claude finished or needs you, to-dos due, skills that ran, meeting notes.</div>
        </div>
        {signedIn && (
          <Button size="sm" variant="primary" icon={<QrCode size={13} />} onClick={() => setPairing(true)}>
            Pair your Android phone
          </Button>
        )}
      </div>

      {!signedIn ? (
        <div className="mt-3 rounded-xl bg-[var(--glass)] px-3.5 py-3 text-[12.5px] text-muted">Sign in to your Flo account (above) to pair a phone.</div>
      ) : (
        <>
          <div className="mt-3 space-y-1.5" data-testid="phones-list">
            {error ? (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-[12.5px] text-amber-200">
                <span>{error}</span>
                <Button size="sm" variant="ghost" icon={<RefreshCw size={12} />} onClick={refresh}>
                  Retry
                </Button>
              </div>
            ) : devices === null ? (
              <div className="h-12 animate-pulse rounded-xl bg-[var(--glass)]" />
            ) : devices.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border-strong)] px-3.5 py-3 text-[12.5px] text-muted">No phones yet. Pair one to get notifications while you're away.</div>
            ) : (
              devices.map((d) => (
                <div key={d.id} data-testid="phone-row" className="flex items-center gap-3 rounded-xl bg-[var(--glass)] px-3.5 py-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-400/15 text-brand-300">
                    <Smartphone size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{d.name}</div>
                    <div className="text-[11.5px] text-faint">
                      {d.platform === "android" ? "Android" : d.platform} · last seen {relativeTime(d.lastSeen)}
                    </div>
                  </div>
                  <button
                    aria-label={`Remove ${d.name}`}
                    title="Remove"
                    className="rounded-lg p-1.5 text-faint transition hover:bg-red-500/10 hover:text-red-300"
                    onClick={async () => {
                      try {
                        await api.removePhone(d.id);
                        setDevices((cur) => cur?.filter((x) => x.id !== d.id) ?? null);
                      } catch (e) {
                        setError(errText(e));
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="mt-3 flex items-center justify-between gap-4 border-t border-[var(--border)] pt-3">
            <div className="min-w-0 text-[12px]" data-testid="test-push-status">
              {test.text ? (
                <span className={test.ok ? "text-emerald-300" : "text-amber-200"}>{test.text}</span>
              ) : away ? (
                <span className="text-muted">Check that notifications reach your phone.</span>
              ) : (
                <span className="text-muted">Works while you're Away: Flo never notifies your phone while you're at your Mac.</span>
              )}
            </div>
            <Button size="sm" icon={<BellRing size={13} />} disabled={!away || test.busy || !devices?.length} onClick={sendTest}>
              {test.busy ? "Sending…" : "Send test notification"}
            </Button>
          </div>
        </>
      )}
      <AnimatePresence>
        {pairing && (
          <PairDialog
            known={devices ?? []}
            onClose={() => {
              setPairing(false);
              refresh();
            }}
          />
        )}
      </AnimatePresence>
    </Card></div>
  );
}

/** QR + 6-digit code + countdown; watches for the phone to show up. */
function PairDialog({ known, onClose }: { known: PhoneDevice[]; onClose: () => void }) {
  const [code, setCode] = useState<PairCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [paired, setPaired] = useState<PhoneDevice | null>(null);
  const knownIds = useRef(new Set(known.map((d) => d.id)));

  const start = () => {
    setError(null);
    setCode(null);
    api
      .pairPhoneStart()
      .then(setCode)
      .catch((e) => setError(errText(e)));
  };
  useEffect(start, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  // poll for the new phone while a code is live
  const left = code ? Date.parse(code.expiresAt) - now : 0;
  const live = !!code && left > 0 && !paired;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => {
      api
        .listPhones()
        .then((list) => {
          const fresh = list.find((d) => !knownIds.current.has(d.id));
          if (fresh) setPaired(fresh);
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(t);
  }, [live]);

  const path = useMemo(() => (code ? qrPath(qrMatrix(code.payload)) : ""), [code]);
  const size = useMemo(() => (code ? qrMatrix(code.payload).length + 4 : 29), [code]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="Pair your Android phone" data-testid="pair-dialog">
      <motion.div className="absolute inset-0 bg-black/70 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
        className="hw relative w-full max-w-[400px] overflow-hidden rounded-[22px] border border-white/10 p-6 text-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
        style={{ background: "linear-gradient(180deg, #0f1b27 0%, #0a121b 100%)" }}
      >
        <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-brand-400/20 blur-3xl" />
        <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white">
          <X size={16} />
        </button>

        {paired ? (
          <div className="relative flex flex-col items-center py-6 text-center" data-testid="pair-success">
            <motion.div
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 420, damping: 20 }}
              className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-400/15 ring-1 ring-emerald-300/40"
            >
              <Check size={26} strokeWidth={2.6} className="text-emerald-300" />
            </motion.div>
            <div className="text-[17px] font-semibold">{paired.name} is paired</div>
            <div className="mt-1 max-w-[280px] text-[12.5px] text-white/60">Switch to Away when you step out, and Flo will keep you posted there.</div>
            <Button variant="primary" className="mt-5 w-40" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <div className="relative">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-300/80">Flo for Android</div>
            <h2 className="mt-1 text-[18px] font-semibold tracking-tight">Pair your Android phone</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-white/60">Open Flo on your phone, tap “Pair with Mac”, and scan this code. Or type the 6 digits.</p>

            <div className="mt-5 flex flex-col items-center">
              <div className="relative rounded-[18px] bg-[#fff] p-3 shadow-[0_12px_40px_-12px_rgba(61,187,255,0.45)]" data-testid="pair-qr">
                {code ? (
                  <svg
                    viewBox={`0 0 ${size} ${size}`}
                    width={196}
                    height={196}
                    shapeRendering="crispEdges"
                    role="img"
                    aria-label="Pairing QR code"
                    className={clsx("block transition", left <= 0 && "opacity-15 blur-[2px]")}
                  >
                    <path d={path} fill="#0a121b" />
                  </svg>
                ) : (
                  <div className="flex h-[196px] w-[196px] items-center justify-center">
                    {error ? <QrCode size={40} className="text-slate-300" /> : <RefreshCw size={22} className="animate-spin text-slate-400" />}
                  </div>
                )}
                {code && left <= 0 && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Button size="sm" variant="primary" icon={<RefreshCw size={12} />} onClick={start}>
                      New code
                    </Button>
                  </div>
                )}
              </div>

              {error ? (
                <div className="mt-4 text-center text-[12.5px] text-amber-200" data-testid="pair-error">
                  {error}
                  <div className="mt-2">
                    <Button size="sm" icon={<RefreshCw size={12} />} onClick={start}>
                      Try again
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mt-5 font-mono text-[30px] font-semibold tabular-nums tracking-[0.18em] text-white" data-testid="pair-code" aria-label="Pairing code">
                    {code ? code.code : "··· ···"}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-white/55" data-testid="pair-countdown">
                    {code && left > 0 ? (
                      <>
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-300/60" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-300" />
                        </span>
                        Waiting for your phone · expires in {countdown(left)}
                      </>
                    ) : code ? (
                      "Code expired"
                    ) : (
                      "Making a code…"
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="mt-5 flex items-center gap-2 rounded-xl bg-white/[0.05] px-3 py-2.5 text-[11.5px] leading-snug text-white/55">
              <ShieldCheck size={13} className="shrink-0 text-brand-300/70" />
              Single use, valid 5 minutes. Your phone gets short summaries only, never transcripts or code.
            </div>
          </div>
        )}
      </motion.div>
    </div>,
    document.body,
  );
}
