// A change to one of your computer's settings, from tap to "Applied on your Mac".
//
// The phone can't change the computer directly: it queues an action on the server, the computer
// picks it up on its next poll (every 10-20 s while Flo runs there), applies it and reports back.
// So a change is never instant, and if the computer is off it may not happen for a while. This
// state machine makes sure the screen always says which of those is going on, and that nothing
// spins for more than a few seconds:
//
//   sending ──(confirmed)──────────────▶ applied   (a check for a moment, then the row is plain)
//      │  └──(the computer refused)────▶ failed    (the computer's reason; the old value is back)
//      └──(no answer in TIMEOUT_MS)────▶ waiting   (no spinner; says the computer is offline/busy,
//                                         │          the new value stays and will apply later)
//                                         ├─(confirmed)────────▶ applied
//                                         └─(phone stops showing it)▶ queued (old value, "will
//                                                                      change when it's back")
//   queued ──(the computer catches up)─▶ applied;  after QUEUE_MS (the server drops it) ▶ failed
//
// Pure functions (unit-tested in __tests__/settingSync.test.ts).
import type { ComputerSetting } from '../api/types';

export type SettingValue = ComputerSetting['value'];
export type SyncPhase = 'sending' | 'waiting' | 'applied' | 'queued' | 'failed';

export interface SettingChange {
  key: string;
  value: SettingValue;
  /** what it was before, to say what it went back to */
  prev: SettingValue;
  /** phone clock, ms */
  sentAt: number;
  phase: SyncPhase;
  message: string | null;
  /** when it reached applied / failed (for how long to keep showing that) */
  settledAt?: number;
}

/** What the phone can see right now about one change. */
export interface SyncView {
  /**
   * The Computer state's entry for this change, if it is still tracking it (`null` once it
   * stopped: confirmed and republished, refused, or given up). `done` = the computer said it did it.
   */
  tracked: { sent: boolean; done: boolean } | null;
  /** the setting's value as shown now (the computer's value once nothing is tracked) */
  value: SettingValue | undefined;
  /** the computer hasn't republished for a long time */
  offline: boolean;
  /** the computer has never checked in */
  never: boolean;
  /** the latest failure message from the Computer state, if any */
  notice: string | null;
}

/** No spinner after this long: say what's happening instead. */
export const TIMEOUT_MS = 18_000;
/** The server drops an action nobody picked up after 10 minutes. */
export const QUEUE_MS = 10 * 60_000;
/** The Computer state starts tracking a change in the same tick, but give it a moment. */
const GRACE_MS = 2_000;
const APPLIED_LINGER_MS = 2_500;
const FAILED_LINGER_MS = 7_000;

export const MSG = {
  offline: "Your computer is offline. This will apply when it's back.",
  busy: "Your computer hasn't picked this up yet. It will apply once Flo there checks in.",
  unsent: "Couldn't reach Flo's server yet. Check your connection; Flo keeps trying.",
  never: "Your computer hasn't checked in yet. Open Flo there and sign in to the same account.",
  refused: "Your computer couldn't change this.",
  expired: "Your computer didn't pick this up in time. Try again when it's online.",
} as const;

export function sameValue(a: SettingValue | undefined, b: SettingValue | undefined): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
  return a === b;
}

export function startChange(key: string, value: SettingValue, prev: SettingValue, now: number): SettingChange {
  return { key, value, prev, sentAt: now, phase: 'sending', message: null };
}

function waitingMessage(v: SyncView): string {
  if (v.never) return MSG.never;
  if (v.tracked && !v.tracked.sent) return MSG.unsent;
  return v.offline ? MSG.offline : MSG.busy;
}

/** Advance one change given what the phone sees now. Returns the same object if nothing changed. */
export function step(c: SettingChange, v: SyncView, now: number): SettingChange {
  const to = (phase: SyncPhase, message: string | null): SettingChange => {
    if (phase === c.phase && message === c.message) return c;
    const settled = phase === 'applied' || phase === 'failed';
    return { ...c, phase, message, settledAt: settled ? now : undefined };
  };
  if (c.phase === 'applied' || c.phase === 'failed') return c;

  if (v.tracked?.done) return to('applied', null);

  if (!v.tracked && c.phase === 'sending' && now - c.sentAt < GRACE_MS) return c;

  if (!v.tracked) {
    // the Computer state let go of it: the value shown is the computer's own
    if (sameValue(v.value, c.value)) return to('applied', null);
    if (c.phase === 'waiting' || c.phase === 'queued') {
      if (now - c.sentAt >= QUEUE_MS) return to('failed', MSG.expired);
      return to('queued', v.offline ? MSG.offline : MSG.busy);
    }
    return to('failed', v.notice || MSG.refused);
  }

  if (now - c.sentAt >= TIMEOUT_MS) return to('waiting', waitingMessage(v));
  return to('sending', null);
}

/** Should the row still show this change? (applied and failed fade after a moment) */
export function keep(c: SettingChange, now: number): boolean {
  if (c.phase === 'applied') return now - (c.settledAt ?? now) < APPLIED_LINGER_MS;
  if (c.phase === 'failed') return now - (c.settledAt ?? now) < FAILED_LINGER_MS;
  if (c.phase === 'queued') return now - c.sentAt < QUEUE_MS + FAILED_LINGER_MS;
  return true;
}

/** Only `sending` shows a spinner, and only for at most TIMEOUT_MS. */
export const spins = (c: SettingChange | undefined) => c?.phase === 'sending';

/** The short line under the setting. */
export function statusLine(c: SettingChange | undefined, valueText: (v: SettingValue) => string): string | null {
  if (!c) return null;
  switch (c.phase) {
    case 'sending':
      return 'Sending to your computer…';
    case 'applied':
      return 'Applied on your computer';
    case 'waiting':
      return c.message;
    case 'queued':
      return `Will change to ${valueText(c.value)}. ${c.message ?? ''}`.trim();
    case 'failed':
      return `${c.message ?? MSG.refused} It's back to ${valueText(c.prev)}.`;
  }
}
