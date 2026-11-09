import { createHttpApi } from '../src/api/client';
import {
  computerName,
  dueLabel,
  freshness,
  groupSettings,
  liveApprovals,
  overlay,
  parseAction,
  parseComputer,
  reconcile,
  settingText,
  type Pending,
} from '../src/lib/computer';
import type { ComputerState, PhoneAction } from '../src/api/types';

const NOW = Date.parse('2026-11-09T12:00:00Z');

const raw = {
  state: {
    v: 1,
    computer: { platform: 'windows', appVersion: '0.9.1' },
    todos: {
      open: [
        { id: 't1', title: 'Call the bank', due: '2026-11-09T15:00:00Z', source: 'phone', createdAt: '2026-11-09T08:00:00Z' },
        { id: 2, title: 'bad id' },
        { id: 't2', title: '' },
      ],
      done: [{ id: 't0', title: 'Pay rent', completedAt: '2026-11-08T08:00:00Z' }],
    },
    approvals: [
      { id: 'q1', project: 'api', summary: 'Run: npm publish', tool: 'Bash', at: '2026-11-09T11:59:00Z', expiresAt: '2026-11-09T12:01:00Z' },
      { id: 'q0', project: 'api', summary: 'Edit main.rs', tool: 'Edit', at: '2026-11-09T11:50:00Z', expiresAt: '2026-11-09T11:52:00Z' },
    ],
    waiting: [{ id: 's1', project: 'web', message: 'Claude is waiting for your input', status: 'waiting_reply', at: '2026-11-09T11:00:00Z' }],
    settings: [
      { key: 'playSounds', label: 'Play sounds', section: 'Sounds and alerts', kind: 'toggle', value: true, editable: true },
      { key: 'theme', label: 'Theme', section: 'Appearance', kind: 'select', value: 'light', editable: true, options: [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] },
      { key: 'soundVolume', label: 'Volume', section: 'Sounds and alerts', kind: 'number', value: 70, editable: true, min: 0, max: 100 },
      { key: 'autoLanguages', label: 'Languages', section: 'Dictation', kind: 'list', value: ['en', 'hi'], editable: false, hint: 'Change this on your computer.' },
      { key: 'weird', label: 'Weird', section: 'X', kind: 'nope', value: 1, editable: true },
    ],
  },
  updatedAt: '2026-11-09T11:59:30Z',
  actions: [{ id: 9, kind: 'approve', target: 'q1', value: null, status: 'pending', message: null, createdAt: '2026-11-09T11:59:40Z' }],
};

const parsed = () => parseComputer(raw);
const state = () => parsed().state as ComputerState;

describe('parseComputer', () => {
  it('reads the snapshot and drops malformed entries', () => {
    const r = parsed();
    expect(r.updatedAt).toBe('2026-11-09T11:59:30Z');
    expect(r.state?.computer.platform).toBe('windows');
    expect(r.state?.todos.open.map((t) => t.id)).toEqual(['t1']);
    expect(r.state?.todos.done[0].title).toBe('Pay rent');
    expect(r.state?.approvals).toHaveLength(2);
    expect(r.state?.settings.map((s) => s.key)).toEqual(['playSounds', 'theme', 'soundVolume', 'autoLanguages']);
    expect(r.actions[0]).toEqual({ id: '9', kind: 'approve', target: 'q1', value: null, status: 'pending', message: null, createdAt: '2026-11-09T11:59:40Z' });
  });
  it('no snapshot yet (computer never published, or no phone was paired then)', () => {
    expect(parseComputer({ state: null, updatedAt: null, actions: [] })).toEqual({ state: null, updatedAt: null, actions: [] });
    expect(parseComputer('garbage')).toEqual({ state: null, updatedAt: null, actions: [] });
  });
  it('parses a single action reply', () => {
    expect(parseAction({ action: { id: 4, kind: 'setting', target: 'theme', value: 'dark', status: 'pending', createdAt: 'x' } }).value).toBe('dark');
    expect(() => parseAction({})).toThrow();
  });
});

describe('liveApprovals', () => {
  it('hides questions the computer already handed back to the terminal', () => {
    expect(liveApprovals(state(), NOW).map((a) => a.id)).toEqual(['q1']);
  });
});

describe('overlay (optimistic changes)', () => {
  const p = (o: Partial<Pending>): Pending => ({ key: 'x', kind: 'todo_done', target: 't1', value: null, createdAt: NOW, ...o });
  it('moves a completed to-do to done right away', () => {
    const s = overlay(state(), [p({ key: 'todo:t1' })], NOW);
    expect(s.todos.open).toHaveLength(0);
    expect(s.todos.done[0].id).toBe('t1');
  });
  it('moves a reopened to-do back', () => {
    const s = overlay(state(), [p({ key: 'todo:t0', kind: 'todo_reopen', target: 't0' })], NOW);
    expect(s.todos.done).toHaveLength(0);
    expect(s.todos.open.map((t) => t.id)).toContain('t0');
  });
  it('marks an answered approval as sending', () => {
    const s = overlay(state(), [p({ key: 'approval:q1', kind: 'reject', target: 'q1' })], NOW);
    expect(s.approvals.find((a) => a.id === 'q1')?.sending).toBe('reject');
  });
  it('shows a changed setting immediately', () => {
    const s = overlay(state(), [p({ key: 'setting:theme', kind: 'setting', target: 'theme', value: 'dark' })], NOW);
    expect(s.settings.find((x) => x.key === 'theme')?.value).toBe('dark');
    expect(s.settings.find((x) => x.key === 'theme')?.sending).toBe(true);
  });
});

describe('reconcile', () => {
  const act = (o: Partial<PhoneAction>): PhoneAction => ({ id: '9', kind: 'approve', target: 'q1', value: null, status: 'pending', message: null, createdAt: '', ...o });
  const pend = (o: Partial<Pending> = {}): Pending => ({ key: 'approval:q1', kind: 'approve', target: 'q1', value: null, createdAt: NOW - 1000, actionId: '9', ...o });

  it('keeps waiting while the computer has not finished', () => {
    const r = reconcile([pend()], { updatedAt: 'a', actions: [act({ status: 'taken' })] }, NOW);
    expect(r.pending).toHaveLength(1);
    expect(r.failures).toEqual([]);
  });
  it('drops a failed action and reports why', () => {
    const r = reconcile([pend()], { updatedAt: 'a', actions: [act({ status: 'failed', message: 'That question already closed on your computer.' })] }, NOW);
    expect(r.pending).toHaveLength(0);
    expect(r.failures).toEqual(['That question already closed on your computer.']);
  });
  it('after done, waits for a newer snapshot (or 15 s) before trusting it', () => {
    const first = reconcile([pend()], { updatedAt: 'a', actions: [act({ status: 'done' })] }, NOW);
    expect(first.pending).toHaveLength(1);
    const same = reconcile(first.pending, { updatedAt: 'a', actions: [act({ status: 'done' })] }, NOW + 2000);
    expect(same.pending).toHaveLength(1);
    const newer = reconcile(first.pending, { updatedAt: 'b', actions: [act({ status: 'done' })] }, NOW + 3000);
    expect(newer.pending).toHaveLength(0);
    const timeout = reconcile(first.pending, { updatedAt: 'a', actions: [act({ status: 'done' })] }, NOW + 16_000);
    expect(timeout.pending).toHaveLength(0);
  });
  it('gives up when the computer does not pick it up', () => {
    const r = reconcile([pend()], { updatedAt: 'a', actions: [act({ status: 'pending' })] }, NOW + 120_000);
    expect(r.pending).toHaveLength(0);
    expect(r.failures[0]).toMatch(/your computer/i);
    expect(r.failures[0]).not.toMatch(/Mac/);
  });
  it('keeps an action that is still being sent (no id yet)', () => {
    expect(reconcile([pend({ actionId: undefined })], { updatedAt: 'a', actions: [] }, NOW).pending).toHaveLength(1);
  });
});

describe('labels', () => {
  it('groups settings by section in order of first appearance', () => {
    expect(groupSettings(state().settings).map((g) => [g.section, g.items.length])).toEqual([
      ['Sounds and alerts', 2],
      ['Appearance', 1],
      ['Dictation', 1],
    ]);
  });
  it('formats setting values', () => {
    const s = state().settings;
    expect(settingText(s[0])).toBe('On');
    expect(settingText(s[1])).toBe('Light');
    expect(settingText(s[2])).toBe('70');
    expect(settingText(s[3])).toBe('en, hi');
  });
  it('names the computer without assuming a Mac', () => {
    expect(computerName('macos')).toBe('Mac');
    expect(computerName('windows')).toBe('Windows PC');
    expect(computerName('linux')).toBe('Linux computer');
    expect(computerName('other')).toBe('computer');
  });
  it('freshness says when the computer looks offline', () => {
    expect(freshness('2026-11-09T11:59:30Z', NOW).offline).toBe(false);
    expect(freshness('2026-11-09T11:30:00Z', NOW).offline).toBe(true);
    expect(freshness(null, NOW).offline).toBe(true);
  });
  it('due labels', () => {
    const d = new Date(NOW);
    const today = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 18, 30).toISOString();
    expect(dueLabel(today, NOW)).toMatch(/^Today/);
    expect(dueLabel(new Date(NOW - 86_400_000 * 2).toISOString(), NOW)).toMatch(/^Overdue/);
    expect(dueLabel(undefined, NOW)).toBe('');
  });
});

describe('computer over HTTP', () => {
  it('reads state and posts actions with the device token', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const body = url.endsWith('/api/mobile/state') ? raw : { action: { id: 5, kind: 'todo_done', target: 't1', value: null, status: 'pending', createdAt: 'x' } };
      return new Response(JSON.stringify(body), { status: url.endsWith('/actions') ? 202 : 200 });
    };
    const api = createHttpApi('https://flo.example', 'flod_x', fetchImpl);
    const s = await api.getComputer();
    expect(s.state?.todos.open[0].id).toBe('t1');
    const a = await api.sendAction('todo_done', 't1');
    expect(a.id).toBe('5');
    expect(calls[1].url).toBe('https://flo.example/api/mobile/actions');
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ kind: 'todo_done', target: 't1' });
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe('Bearer flod_x');
  });
});
