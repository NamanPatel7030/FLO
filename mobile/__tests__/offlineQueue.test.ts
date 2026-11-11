import {
  MAX_ATTEMPTS,
  MAX_ITEMS,
  adoptLate,
  awaiting,
  parseLate,
  clearDone,
  enqueue,
  fromNative,
  markAnswered,
  markFailed,
  markSent,
  nextToSend,
  parseQueue,
  pendingCount,
  prune,
  savedMessage,
  statusLine,
  type QueuedAsk,
} from '../src/lib/offlineQueue';

const T = 1_700_000_000_000;

describe('offline queue', () => {
  it('queues questions oldest first and sends them in order', () => {
    let q: QueuedAsk[] = [];
    q = enqueue(q, { mode: 'ask', text: '  what is on my calendar  ' }, T);
    q = enqueue(q, { mode: 'todo', text: 'buy milk' }, T + 20_000);
    expect(q.map((x) => x.text)).toEqual(['what is on my calendar', 'buy milk']);
    expect(pendingCount(q)).toBe(2);
    expect(nextToSend(q)?.text).toBe('what is on my calendar');
  });

  it('ignores empty text and a double send of the same words', () => {
    let q = enqueue([], { mode: 'ask', text: '   ' }, T);
    expect(q).toHaveLength(0);
    q = enqueue(q, { mode: 'ask', text: 'hi' }, T);
    q = enqueue(q, { mode: 'ask', text: 'hi' }, T + 2000);
    expect(q).toHaveLength(1);
    q = enqueue(q, { mode: 'ask', text: 'hi' }, T + 60_000); // later: a new question
    expect(q).toHaveLength(2);
  });

  it('sent → waiting → answered', () => {
    let q = enqueue([], { mode: 'ask', text: 'weather?', id: 'a' }, T);
    q = markSent(q, 'a', 'r1');
    expect(nextToSend(q)).toBeUndefined();
    expect(awaiting(q).map((x) => x.requestId)).toEqual(['r1']);
    q = markAnswered(q, 'a', 'Sunny', 'cloud', T + 5000);
    expect(q[0]).toMatchObject({ status: 'answered', answer: 'Sunny', answeredBy: 'cloud' });
    expect(pendingCount(q)).toBe(0);
    expect(statusLine(q[0])).toBe('Answered in the cloud');
  });

  it('retries a lost connection a few times, then gives up', () => {
    let q = enqueue([], { mode: 'ask', text: 'x', id: 'a' }, T);
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      q = markFailed(q, 'a', 'offline', true, T);
      expect(q[0].status).toBe('queued');
      expect(q[0].attempts).toBe(i);
    }
    q = markFailed(q, 'a', 'offline', true, T);
    expect(q[0].status).toBe('failed');
  });

  it('a refusal from the server fails at once with its words', () => {
    let q = enqueue([], { mode: 'ask', text: 'x', id: 'a' }, T);
    q = markFailed(q, 'a', 'This phone is not paired', false, T);
    expect(q[0]).toMatchObject({ status: 'failed', error: 'This phone is not paired' });
    expect(statusLine(q[0])).toBe('This phone is not paired');
  });

  it('keeps at most MAX_ITEMS, dropping finished ones first', () => {
    let q = enqueue([], { mode: 'ask', text: 'done one', id: 'd' }, T);
    q = markAnswered(markSent(q, 'd', 'r'), 'd', 'ok', 'computer', T);
    for (let i = 0; i < MAX_ITEMS; i++) q = enqueue(q, { mode: 'ask', text: `q${i}` }, T + i * 20_000);
    expect(q).toHaveLength(MAX_ITEMS);
    expect(q.find((x) => x.id === 'd')).toBeUndefined();
    expect(q[0].text).toBe('q0');
  });

  it('prunes old finished items and stops waiting after a day', () => {
    let q = enqueue([], { mode: 'ask', text: 'old', id: 'o' }, T);
    q = markAnswered(markSent(q, 'o', 'r'), 'o', 'ok', 'computer', T);
    q = enqueue(q, { mode: 'ask', text: 'stuck', id: 's' }, T);
    q = markSent(q, 's', 'r2');
    const later = prune(q, T + 25 * 3600_000);
    expect(later.find((x) => x.id === 's')?.status).toBe('failed');
    const week = prune(later, T + 8 * 24 * 3600_000 + 25 * 3600_000);
    expect(week).toHaveLength(0);
    expect(clearDone(later)).toHaveLength(0);
  });

  it('survives junk storage', () => {
    expect(parseQueue(null)).toEqual([]);
    expect(parseQueue('{bad')).toEqual([]);
    expect(parseQueue(JSON.stringify([{ id: 1 }, { id: 'a', text: 't', createdAt: 1, status: 'queued', mode: 'ask', source: 'app', attempts: 0 }]))).toHaveLength(1);
  });

  it('says what happens next', () => {
    expect(savedMessage('ask')).toMatch(/answer when you're back online/);
    expect(savedMessage('todo')).toMatch(/to-do/);
  });

  it('watches for late answers to bubble questions, once each', () => {
    const late = parseLate(JSON.stringify([{ requestId: 'r9', text: 'lunch?', at: 3 }, { requestId: '', text: 'x' }]));
    expect(late).toEqual([{ requestId: 'r9', text: 'lunch?', createdAt: 3 }]);
    let q = adoptLate([], late[0]);
    q = adoptLate(q, late[0]);
    expect(q).toHaveLength(1);
    expect(awaiting(q)[0]).toMatchObject({ requestId: 'r9', source: 'bubble', status: 'waiting' });
  });

  it('takes over questions the bubble kept', () => {
    const items = fromNative(JSON.stringify([{ id: '7', text: 'reply to Priya', at: 5 }, { text: '' }]));
    expect(items).toEqual([{ id: 'b-7', text: 'reply to Priya', createdAt: 5 }]);
    expect(fromNative('nope')).toEqual([]);
  });
});
