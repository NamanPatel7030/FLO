// Claude Code sessions on the phone: parsing, optimistic replies, the 20 s "not picked up yet" stage,
// "finished" banners and ordering.
import {
  finishedSince,
  finishedText,
  needsYouCount,
  overlay,
  parseComputer,
  pendingKey,
  reconcile,
  replyStage,
  sortSessions,
  type Pending,
} from '../src/lib/computer';
import type { ClaudeSessionView, PhoneAction } from '../src/api/types';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const SID = '0b9f6a52-3c1e-4d7a-9e55-1f2a3b4c5d6e';

const session = (o: Record<string, unknown> = {}) => ({
  id: SID,
  project: 'api-server',
  folder: 'api-server',
  state: 'waiting_reply',
  message: 'Which database should I use?',
  updatedAt: '2026-11-10T11:59:00Z',
  reply: 'answer',
  question: { id: 'q7', questions: [{ question: 'Which database?', header: 'DB', multiSelect: false, options: ['Postgres', 'SQLite'] }] },
  ...o,
});

const snapshot = (sessions: unknown[], actions: unknown[] = []) =>
  parseComputer({
    state: { v: 1, computer: { platform: 'macos', appVersion: '1' }, todos: { open: [], done: [] }, approvals: [], waiting: [], sessions, settings: [] },
    updatedAt: '2026-11-10T12:00:00Z',
    actions,
  });

describe('sessions in the snapshot', () => {
  it('reads every session with state, reply mode and question options', () => {
    const s = snapshot([session(), session({ id: 's2', state: 'working', question: undefined, reply: 'queued' }), { id: '' }, session({ id: 's3', state: 'odd', reply: 'shell' })]).state!;
    expect(s.sessions.map((x) => x.id)).toEqual([SID, 's2', 's3']);
    expect(s.sessions[0].question?.questions[0].options).toEqual(['Postgres', 'SQLite']);
    expect(s.sessions[1].reply).toBe('queued');
    expect(s.sessions[2].state).toBe('idle');
    expect(s.sessions[2].reply).toBe('none');
  });

  it('older computers send no sessions', () => {
    const s = parseComputer({ state: { v: 1, todos: {}, approvals: [], waiting: [], settings: [] } }).state!;
    expect(s.sessions).toEqual([]);
  });

  it('reply and choose actions parse, including a choice value', () => {
    const snap = snapshot([], [
      { id: 5, kind: 'reply', target: SID, value: 'use postgres', status: 'done', message: 'Sent to api-server.', createdAt: '2026-11-10T11:59:50Z' },
      { id: 6, kind: 'choose', target: SID, value: { id: 'q7', answers: [['Postgres']] }, status: 'pending', message: null, createdAt: '2026-11-10T11:59:55Z' },
    ]);
    expect(snap.actions.map((a) => a.kind)).toEqual(['reply', 'choose']);
    expect(snap.actions[1].value).toEqual({ id: 'q7', answers: [['Postgres']] });
  });
});

describe('replying optimistically', () => {
  const state = snapshot([session(), session({ id: 's2', state: 'done', question: undefined, reply: 'instant' })]).state!;

  it('reply and choose for a session share one pending slot', () => {
    expect(pendingKey('reply', SID)).toBe(`session:${SID}`);
    expect(pendingKey('choose', SID)).toBe(`session:${SID}`);
  });

  it('marks the session as sending with what was sent', () => {
    const p: Pending = { key: pendingKey('reply', 's2'), kind: 'reply', target: 's2', value: 'add tests', createdAt: NOW };
    const s = overlay(state, [p], NOW).sessions.find((x) => x.id === 's2')!;
    expect(s.sending).toEqual({ kind: 'reply', text: 'add tests', since: NOW });
  });

  it('a choice shows the picked labels', () => {
    const p: Pending = { key: pendingKey('choose', SID), kind: 'choose', target: SID, value: { id: 'q7', answers: [['SQLite']] }, createdAt: NOW };
    expect(overlay(state, [p], NOW).sessions[0].sending?.text).toBe('SQLite');
  });

  it('after 20 s without the computer confirming, says so instead of spinning', () => {
    expect(replyStage(NOW, NOW + 5_000)).toBe('sending');
    expect(replyStage(NOW, NOW + 20_000)).toBe('slow');
  });

  it('a confirmed reply hands back the computer message', () => {
    const p: Pending = { key: pendingKey('reply', 's2'), kind: 'reply', target: 's2', value: 'add tests', createdAt: NOW, actionId: '9' };
    const done: PhoneAction = { id: '9', kind: 'reply', target: 's2', value: 'add tests', status: 'done', message: 'Sent to api-server. Claude is on it.', createdAt: '' };
    const r = reconcile([p], { updatedAt: 'u1', actions: [done] }, NOW + 4000);
    expect(r.confirmations).toEqual([{ key: `session:s2`, message: 'Sent to api-server. Claude is on it.' }]);
    expect(r.failures).toEqual([]);
  });

  it('a failed reply reports the precise reason', () => {
    const p: Pending = { key: pendingKey('reply', 's2'), kind: 'reply', target: 's2', value: 'x', createdAt: NOW, actionId: '9' };
    const failed: PhoneAction = { id: '9', kind: 'reply', target: 's2', value: 'x', status: 'failed', message: 'That session is gone from your computer.', createdAt: '' };
    expect(reconcile([p], { updatedAt: 'u1', actions: [failed] }, NOW + 4000).failures).toEqual(['That session is gone from your computer.']);
  });
});

describe('finished banners and ordering', () => {
  const v = (id: string, state: string, project = id) => ({ ...session({ id, project, folder: project, state, question: undefined }) }) as unknown as ClaudeSessionView;

  it('names sessions that went from working to done', () => {
    const prev = [v('a', 'working', 'api-server'), v('b', 'working', 'web'), v('c', 'done')];
    const next = [v('a', 'done', 'api-server'), v('b', 'working', 'web'), v('c', 'done'), v('d', 'done')];
    expect(finishedSince(prev, next)).toEqual(['api-server']);
    // nothing on first load
    expect(finishedSince([], next)).toEqual([]);
  });

  it('banner text', () => {
    expect(finishedText([])).toBeNull();
    expect(finishedText(['api-server'])).toBe('api-server finished');
    expect(finishedText(['api-server', 'web'])).toBe('api-server and web finished');
    expect(finishedText(['a', 'b', 'c'])).toBe('3 sessions finished');
  });

  it('puts sessions that need you first, then finished, working, quiet', () => {
    const list = [v('i', 'idle'), v('w', 'working'), v('d', 'done'), v('q', 'waiting_reply'), v('a', 'needs_approval')];
    expect(sortSessions(list).map((s) => s.id)).toEqual(['a', 'q', 'd', 'w', 'i']);
  });

  it('counts questions and approvals that need you', () => {
    const state = snapshot([session(), session({ id: 's2', state: 'done', question: undefined })]).state!;
    expect(needsYouCount(state, NOW)).toBe(1);
  });
});
