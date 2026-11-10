import { ApiError, createHttpApi, describeError, parseAsk } from '../src/api/client';
import { DEFAULT_SERVER } from '../src/lib/pairing';
import { voiceError } from '../src/lib/voice';

describe('parseAsk', () => {
  it('reads a request', () => {
    expect(parseAsk({ request: { id: 12, mode: 'todo', text: 'Call Priya', status: 'done', answer: 'Added', createdAt: '2026-11-09T10:00:00Z' } })).toEqual({
      id: '12',
      mode: 'todo',
      text: 'Call Priya',
      status: 'done',
      answer: 'Added',
      createdAt: '2026-11-09T10:00:00Z',
    });
  });
  it('fills safe defaults', () => {
    const r = parseAsk({ request: { id: '7', mode: 'weird', status: 'zzz' } });
    expect(r.mode).toBe('ask');
    expect(r.status).toBe('pending');
    expect(r.answer).toBeNull();
  });
  it('says when the cloud answered (computer off)', () => {
    const r = parseAsk({ request: { id: 3, mode: 'ask', text: 'q', status: 'done', answer: 'A', createdAt: 'x', answeredBy: 'cloud' } });
    expect(r.answeredBy).toBe('cloud');
    expect(parseAsk({ request: { id: 3, status: 'done', answeredBy: 'computer' } }).answeredBy).toBe('computer');
    expect(parseAsk({ request: { id: 3, status: 'done', answeredBy: 'mars' } }).answeredBy).toBeUndefined();
  });
  it('marks a to-do or note saved for when the computer is back', () => {
    const r = parseAsk({ request: { id: 4, mode: 'todo', status: 'pending' }, hint: { reason: 'queued', text: 'Saved. Your computer will add it when it\'s back online.' } });
    expect(r.queued).toBe(true);
    expect(r.hint).toMatch(/Saved/);
    expect(parseAsk({ request: { id: 4, status: 'pending' }, hint: { reason: 'offline', text: 'x' } }).queued).toBeUndefined();
  });
  it('rejects garbage', () => {
    expect(() => parseAsk({})).toThrow(ApiError);
  });
});

describe('ask over HTTP', () => {
  it('posts the mode and text with the device token', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ request: { id: 1, mode: 'ask', text: 'hi', status: 'pending', answer: null } }), { status: 202 });
    };
    const api = createHttpApi('https://flo.hellonaman.com/', 'tok', fetchImpl);
    const r = await api.ask('ask', 'hi');
    expect(r.id).toBe('1');
    expect(calls[0].url).toBe('https://flo.hellonaman.com/api/mobile/ask');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ mode: 'ask', text: 'hi' });
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });
  it('waits long enough for a cloud answer while polling', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      await new Promise((r) => setTimeout(r, 20));
      return new Response(JSON.stringify({ request: { id: 1, mode: 'ask', text: 'hi', status: 'done', answer: 'A', answeredBy: 'cloud' } }), { status: 200 });
    };
    const api = createHttpApi('https://flo.hellonaman.com', 'tok', fetchImpl);
    const r = await api.getAsk('1');
    expect(r.answeredBy).toBe('cloud');
    expect(signal?.aborted).toBe(false);
  });
});

describe('errors', () => {
  it('tells "no connection" apart from a server message', () => {
    expect(describeError(new ApiError("Couldn't reach your Flo server.", 0))).toMatch(/internet connection/);
    expect(describeError(new ApiError('That code is invalid.', 401))).toBe('That code is invalid.');
  });
  it('maps recognizer errors to plain words', () => {
    expect(voiceError('not-allowed')).toMatch(/microphone/);
    expect(voiceError('no-speech')).toMatch(/didn't hear/);
    expect(voiceError('aborted')).toBe('');
  });
});

it('pairs with the live server by default', () => {
  expect(DEFAULT_SERVER).toBe('https://flo.hellonaman.com');
});

describe('parseAsk hint', () => {
  it('carries the server reason while the computer has not picked the question up', () => {
    const r = parseAsk({
      request: { id: 3, mode: 'ask', text: 'hi', status: 'pending', answer: null, createdAt: '2026-11-10T10:00:00Z' },
      hint: { reason: 'no_computer', text: 'No computer is signed in to Flo as a@b.c.' },
    });
    expect(r.hint).toBe('No computer is signed in to Flo as a@b.c.');
  });
  it('has no hint when the server sends none', () => {
    const r = parseAsk({ request: { id: 3, mode: 'ask', text: 'hi', status: 'pending', answer: null, createdAt: 'x' } });
    expect(r.hint).toBeUndefined();
  });
});
