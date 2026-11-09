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
