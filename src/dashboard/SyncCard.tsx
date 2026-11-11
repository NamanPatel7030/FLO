// Settings → Privacy → "Sync your data": end-to-end encrypted backup and multi-Mac sync.
import { deviceWord } from "../lib/os";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Cloud, Copy, KeyRound, Laptop, Loader2, Lock, RefreshCw, Trash2 } from "lucide-react";
import { relativeTime } from "../lib/format";
import { SYNC_CATEGORIES, syncApi, type SyncCategory, type SyncStatus } from "../lib/sync";
import { Button, Card, CardTitle, Input, Toggle } from "./ui";

function errText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/** The recovery key, shown in groups, with copy. */
function KeyBox({ value, onDone, first }: { value: string; onDone: () => void; first?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(!first);
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--glass)] p-4" data-testid="sync-recovery">
      <div className="flex items-center gap-2 text-[13px] font-semibold">
        <KeyRound size={15} className="text-brand-400" /> {first ? "Save your recovery key" : "Your recovery key"}
      </div>
      <p className="mt-1 text-[12px] text-muted">
        It unlocks your synced data on another {deviceWord()}. Flo can't recover it for you: keep it in your password manager.
      </p>
      <code className="mt-3 block select-all break-all rounded-xl bg-[var(--bg-soft,rgba(0,0,0,0.04))] px-3 py-2.5 font-mono text-[13px] tracking-wide" data-testid="sync-recovery-key">
        {value}
      </code>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          icon={copied ? <Check size={14} /> : <Copy size={14} />}
          onClick={() => {
            navigator.clipboard?.writeText(value).then(() => setCopied(true), () => {});
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        {first && (
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} data-testid="sync-saved" /> I saved it somewhere safe
          </label>
        )}
        <Button size="sm" variant={first ? "primary" : "ghost"} disabled={!saved} onClick={onDone} className="ml-auto">
          {first ? "Done" : "Hide"}
        </Button>
      </div>
    </motion.div>
  );
}

export function SyncCard() {
  const [st, setSt] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState<{ value: string; first: boolean } | null>(null);
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = () => syncApi.status().then(setSt, (e) => setErr(errText(e)));
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const act = async (name: string, f: () => Promise<unknown>) => {
    setBusy(name);
    setErr(null);
    try {
      await f();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
      load();
    }
  };

  const turnOn = () =>
    act("enable", async () => {
      const r = await syncApi.enable();
      if (r.needsRecoveryKey) setJoining(true);
      else if (r.recoveryKey) setKey({ value: r.recoveryKey, first: true });
    });

  const toggleCategory = (c: SyncCategory, on: boolean) => {
    if (!st) return;
    const next = on ? [...st.categories, c] : st.categories.filter((x) => x !== c);
    act("cats", () => syncApi.setCategories(next));
  };

  if (!st) return null;
  return (
    <div data-testid="sync-card">
    <Card className="p-5">
      <CardTitle
        icon={<Cloud size={16} />}
        action={
          st.enabled ? (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-600">
              <Lock size={11} /> On, encrypted
            </span>
          ) : null
        }
      >
        Sync your data
      </CardTitle>
      <p className="-mt-1 text-[12.5px] text-muted">
        Back up Flo and keep your {deviceWord()}s in step. End-to-end encrypted: everything is locked on this {deviceWord()} with a key only you hold, so the server stores data it can't read.
      </p>

      <div className="mt-2 divide-y divide-[var(--border)]">
        <Toggle
          label="Sync your data"
          hint={st.enabled ? (st.lastSync ? `Last synced ${relativeTime(st.lastSync)} · ${st.syncedItems} items` : "Syncing for the first time…") : `Off. Nothing leaves this ${deviceWord()}.`}
          checked={st.enabled}
          onChange={(v) => (v ? turnOn() : act("disable", syncApi.disable))}
        />
      </div>

      <AnimatePresence>
        {joining && !st.enabled && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--glass)] p-4" data-testid="sync-join">
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                <Laptop size={15} className="text-brand-400" /> Set up on another {deviceWord()}
              </div>
              <p className="mt-1 text-[12px] text-muted">Your account already syncs from another {deviceWord()}. Enter the recovery key you saved there.</p>
              <div className="mt-3 flex gap-2">
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXXX-XXXXX-XXXXX-…" aria-label="Recovery key" className="font-mono" />
                <Button
                  variant="primary"
                  disabled={!code.trim() || busy === "join"}
                  icon={busy === "join" ? <Loader2 size={14} className="animate-spin" /> : undefined}
                  onClick={() =>
                    act("join", async () => {
                      await syncApi.join(code);
                      setJoining(false);
                      setCode("");
                    })
                  }
                >
                  Unlock
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {key && <KeyBox value={key.value} first={key.first} onDone={() => setKey(null)} />}

      {st.enabled && (
        <>
          <div className="mt-3 text-[12px] font-semibold uppercase tracking-wider text-muted">What syncs</div>
          <div className="mt-1 divide-y divide-[var(--border)]">
            {SYNC_CATEGORIES.map((c) => (
              <Toggle key={c.id} label={c.label} hint={c.hint} checked={st.categories.includes(c.id)} onChange={(v) => toggleCategory(c.id, v)} />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              size="sm"
              icon={busy === "now" || st.running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              disabled={busy === "now" || st.running}
              onClick={() => act("now", syncApi.now)}
            >
              Sync now
            </Button>
            <Button size="sm" variant="ghost" icon={<KeyRound size={14} />} onClick={() => act("key", async () => setKey({ value: await syncApi.recoveryKey(), first: false }))}>
              Show recovery key
            </Button>
            <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => setConfirmDelete(true)} className="ml-auto">
              Delete my synced data
            </Button>
          </div>
        </>
      )}

      {!st.enabled && !joining && (
        <button type="button" className="mt-3 text-[12.5px] font-medium text-brand-500 hover:underline" onClick={() => setJoining(true)}>
          Already syncing on another {deviceWord()}? Set up this one
        </button>
      )}

      {confirmDelete && (
        <div className="mt-3 rounded-2xl border border-red-400/30 bg-red-500/5 p-4" role="alertdialog" aria-label="Delete synced data">
          <p className="text-[13px] font-medium">Delete everything you've synced?</p>
          <p className="mt-1 text-[12px] text-muted">This removes your encrypted copy from the server and turns Sync off. Data on this {deviceWord()} stays. Your other {deviceWord()}s keep their copies too.</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="danger" onClick={() => act("delete", async () => { await syncApi.deleteRemote(); setConfirmDelete(false); })}>
              Delete synced data
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {(err || st.lastError) && (
        <p className="mt-3 text-[12.5px] text-amber-600" role="status">
          {err ?? st.lastError}
        </p>
      )}
    </Card>
    </div>
  );
}
