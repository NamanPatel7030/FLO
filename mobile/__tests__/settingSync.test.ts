import { keep, MSG, QUEUE_MS, sameValue, spins, startChange, statusLine, step, TIMEOUT_MS, type SyncView } from '../src/lib/settingSync';

const base: SyncView = { tracked: { sent: true, done: false }, value: 'dark', offline: false, never: false, notice: null };
const view = (p: Partial<SyncView>): SyncView => ({ ...base, ...p });
const text = (v: unknown) => String(v);

describe('setting change state machine', () => {
  const t0 = 1_000_000;
  const c0 = startChange('theme', 'dark', 'light', t0);

  it('starts sending, with a spinner', () => {
    expect(c0.phase).toBe('sending');
    expect(spins(c0)).toBe(true);
    expect(step(c0, base, t0 + 1000)).toBe(c0); // unchanged object while nothing happens
  });

  it('is applied as soon as the computer confirms', () => {
    const c = step(c0, view({ tracked: { sent: true, done: true } }), t0 + 9000);
    expect(c.phase).toBe('applied');
    expect(spins(c)).toBe(false);
    expect(statusLine(c, text)).toBe('Applied on your computer');
    expect(keep(c, t0 + 10_000)).toBe(true);
    expect(keep(c, t0 + 9000 + 3000)).toBe(false);
  });

  it('gives the Computer state a moment to start tracking a fresh change', () => {
    expect(step(c0, view({ tracked: null, value: 'light' }), t0 + 500)).toBe(c0);
  });

  it('is applied when tracking ends and the computer shows the new value', () => {
    expect(step(c0, view({ tracked: null, value: 'dark' }), t0 + 5000).phase).toBe('applied');
  });

  it('fails with the computer\'s reason and says what it went back to', () => {
    const c = step(c0, view({ tracked: null, value: 'light', notice: 'That setting changes only on your computer.' }), t0 + 4000);
    expect(c.phase).toBe('failed');
    expect(statusLine(c, text)).toBe("That setting changes only on your computer. It's back to light.");
    expect(keep(c, t0 + 4000 + 8000)).toBe(false);
  });

  it('never spins past the timeout: offline computer', () => {
    const c = step(c0, view({ offline: true }), t0 + TIMEOUT_MS);
    expect(c.phase).toBe('waiting');
    expect(spins(c)).toBe(false);
    expect(c.message).toBe(MSG.offline);
  });

  it('says precisely why it waits', () => {
    expect(step(c0, base, t0 + TIMEOUT_MS).message).toBe(MSG.busy);
    expect(step(c0, view({ tracked: { sent: false, done: false } }), t0 + TIMEOUT_MS).message).toBe(MSG.unsent);
    expect(step(c0, view({ never: true }), t0 + TIMEOUT_MS).message).toBe(MSG.never);
  });

  it('a waiting change still lands when the computer comes back', () => {
    const w = step(c0, view({ offline: true }), t0 + TIMEOUT_MS);
    expect(step(w, view({ tracked: { sent: true, done: true } }), t0 + 60_000).phase).toBe('applied');
  });

  it('once the phone stops tracking it, it stays queued (not failed) until the server drops it', () => {
    const w = step(c0, view({ offline: true }), t0 + TIMEOUT_MS);
    const q = step(w, view({ tracked: null, value: 'light', offline: true }), t0 + 95_000);
    expect(q.phase).toBe('queued');
    expect(statusLine(q, text)).toBe(`Will change to dark. ${MSG.offline}`);
    expect(keep(q, t0 + 5 * 60_000)).toBe(true);
    // the computer catches up within 10 minutes
    expect(step(q, view({ tracked: null, value: 'dark' }), t0 + 4 * 60_000).phase).toBe('applied');
    // or it never does
    const f = step(q, view({ tracked: null, value: 'light', offline: true }), t0 + QUEUE_MS);
    expect(f.phase).toBe('failed');
    expect(f.message).toBe(MSG.expired);
  });

  it('settled changes stay settled', () => {
    const a = step(c0, view({ tracked: { sent: true, done: true } }), t0 + 1);
    expect(step(a, view({ tracked: null, value: 'light' }), t0 + 2)).toBe(a);
  });
});

describe('sameValue', () => {
  it('compares scalars and lists', () => {
    expect(sameValue(true, true)).toBe(true);
    expect(sameValue(3, 4)).toBe(false);
    expect(sameValue(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameValue(['a'], ['a', 'b'])).toBe(false);
    expect(sameValue(undefined, 'x')).toBe(false);
  });
});
