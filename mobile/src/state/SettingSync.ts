// Progress of the phone's changes to your computer's settings (see lib/settingSync.ts).
//
// Kept at module level so leaving the screen and coming back still shows "Waiting for your
// computer" instead of forgetting. A 1 s tick runs only while a change is on the screen.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { ComputerSetting } from '../api/types';
import { freshness, pendingKey } from '../lib/computer';
import { keep, startChange, step, type SettingChange, type SettingValue, type SyncView } from '../lib/settingSync';
import { useComputer } from './Computer';

let changes: Record<string, SettingChange> = {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const snapshot = () => changes;

function put(next: Record<string, SettingChange>) {
  if (next === changes) return;
  changes = next;
  emit();
}

export function useSettingSync() {
  const c = useComputer();
  const all = useSyncExternalStore(subscribe, snapshot, snapshot);
  const busy = Object.keys(all).length > 0;

  const viewOf = useCallback(
    (key: string): SyncView => {
      const p = c.pending.find((x) => x.key === pendingKey('setting', key));
      const s = c.state?.settings.find((x) => x.key === key);
      return {
        tracked: p ? { sent: !!p.actionId, done: !!p.doneSeen } : null,
        value: s?.value,
        offline: freshness(c.updatedAt).offline,
        never: !c.state,
        notice: c.notice,
      };
    },
    [c.pending, c.state, c.updatedAt, c.notice],
  );

  const advance = useCallback(() => {
    const now = Date.now();
    let next = changes;
    for (const [key, ch] of Object.entries(changes)) {
      const stepped = step(ch, viewOf(key), now);
      if (!keep(stepped, now)) {
        if (next === changes) next = { ...changes };
        delete next[key];
      } else if (stepped !== ch) {
        if (next === changes) next = { ...changes };
        next[key] = stepped;
      }
    }
    put(next);
  }, [viewOf]);

  // re-evaluate whenever the computer state moves, plus a gentle clock while anything is in
  // flight so "sending" turns into a message on time
  useEffect(() => {
    if (!busy) return;
    advance();
    const t = setInterval(advance, 1000);
    return () => clearInterval(t);
  }, [busy, advance]);

  const send = useCallback(
    (s: ComputerSetting, value: SettingValue) => {
      // "before" is what the computer has, not an earlier change still on its way
      const old = changes[s.key];
      const prev = old && (old.phase === 'sending' || old.phase === 'waiting') ? old.prev : s.value;
      put({ ...changes, [s.key]: startChange(s.key, value, prev, Date.now()) });
      void c.act('setting', s.key, value as boolean | number | string);
    },
    [c],
  );

  return { changes: all, send };
}
