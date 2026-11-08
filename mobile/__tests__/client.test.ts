import { ApiError, claimPairing, createHttpApi, parseInboxResponse, type FetchLike } from '../src/api/client';

type Call = { url: string; init: RequestInit };

function mockFetch(responses: Array<{ status?: number; body?: unknown }>) {
  const calls: Call[] = [];
  const fn: FetchLike = async (url, init = {}) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 200, body: {} };
    const status = r.status ?? 200;
    const text = r.body === undefined ? '' : JSON.stringify(r.body);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
    } as Response;
  };
  return { fn, calls };
}

const headers = (c: Call) => c.init.headers as Record<string, string>;

describe('claimPairing', () => {
  it('POSTs the code, device name, platform and push token', async () => {
    const { fn, calls } = mockFetch([
      { body: { deviceToken: 'dt_1', user: { name: 'Parth', email: 'p@x.io' }, server: 'https://flo.app' } },
    ]);
    const res = await claimPairing(
      'https://flo.app/',
      { code: '483920', deviceName: 'Pixel 9', platform: 'android', pushToken: 'fcm-abc' },
      fn,
    );
    expect(calls[0].url).toBe('https://flo.app/api/mobile/pair/claim');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      code: '483920',
      deviceName: 'Pixel 9',
      platform: 'android',
      pushToken: 'fcm-abc',
    });
    expect(headers(calls[0]).Authorization).toBeUndefined();
    expect(res).toEqual({ deviceToken: 'dt_1', user: { name: 'Parth', email: 'p@x.io' }, server: 'https://flo.app' });
  });

  it('omits pushToken when unavailable and falls back to the typed server', async () => {
    const { fn, calls } = mockFetch([{ body: { deviceToken: 'dt', user: { name: 'A', email: 'a@b' } } }]);
    const res = await claimPairing('192.168.1.4:3000', { code: '111222', deviceName: 'P', platform: 'android' }, fn);
    expect(calls[0].url).toBe('http://192.168.1.4:3000/api/mobile/pair/claim');
    expect(JSON.parse(calls[0].init.body as string).pushToken).toBeUndefined();
    expect(res.server).toBe('http://192.168.1.4:3000');
  });

  it('surfaces server errors with the server message', async () => {
    const { fn } = mockFetch([{ status: 410, body: { error: 'Code expired' } }]);
    await expect(claimPairing('https://flo.app', { code: '1', deviceName: 'P', platform: 'android' }, fn)).rejects.toMatchObject({
      status: 410,
      message: 'Code expired',
    });
  });

  it('errors when no device token is returned', async () => {
    const { fn } = mockFetch([{ body: { user: {} } }]);
    await expect(
      claimPairing('https://flo.app', { code: '123456', deviceName: 'P', platform: 'android' }, fn),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('maps network failures to status 0', async () => {
    const fn: FetchLike = async () => {
      throw new TypeError('Network request failed');
    };
    await expect(
      claimPairing('https://flo.app', { code: '123456', deviceName: 'P', platform: 'android' }, fn),
    ).rejects.toMatchObject({ status: 0 });
  });
});

describe('createHttpApi', () => {
  it('sends the bearer device token and parses presence', async () => {
    const { fn, calls } = mockFetch([
      { body: { status: 'away', since: '2026-11-08T10:00:00Z' } },
      { body: { status: 'active', since: '2026-11-08T11:00:00Z' } },
    ]);
    const api = createHttpApi('https://flo.app/', 'dt_9', fn);
    expect(await api.getPresence()).toEqual({ status: 'away', since: '2026-11-08T10:00:00Z' });
    expect(calls[0].url).toBe('https://flo.app/api/presence');
    expect(headers(calls[0]).Authorization).toBe('Bearer dt_9');

    expect(await api.setPresence('active')).toEqual({ status: 'active', since: '2026-11-08T11:00:00Z' });
    expect(calls[1].init.method).toBe('POST');
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ status: 'active' });
  });

  it('fetches the inbox incrementally with ?after=', async () => {
    const { fn, calls } = mockFetch([
      { body: [{ id: 3, kind: 'reminder', title: 'Stretch', body: '', data: null, createdAt: '2026-11-08T10:00:00Z' }] },
      { body: [] },
    ]);
    const api = createHttpApi('https://flo.app', 'dt', fn);
    const items = await api.inbox('a b');
    expect(calls[0].url).toBe('https://flo.app/api/mobile/inbox?after=a%20b');
    expect(items[0].id).toBe('3');
    await api.inbox();
    expect(calls[1].url).toBe('https://flo.app/api/mobile/inbox');
  });

  it('updates the push token and unpairs', async () => {
    const { fn, calls } = mockFetch([{ body: { ok: true } }, { status: 204 }]);
    const api = createHttpApi('https://flo.app', 'dt', fn);
    await api.updatePushToken('new-token');
    expect(calls[0].url).toBe('https://flo.app/api/mobile/device');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ pushToken: 'new-token' });
    await api.unpair();
    expect(calls[1].url).toBe('https://flo.app/api/mobile/device');
    expect(calls[1].init.method).toBe('DELETE');
  });

  it('flags 401 as unauthorized', async () => {
    const { fn } = mockFetch([{ status: 401 }]);
    const api = createHttpApi('https://flo.app', 'dt', fn);
    const err = await api.getPresence().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.isUnauthorized).toBe(true);
  });
});

describe('parseInboxResponse', () => {
  it('accepts a bare array or { items }', () => {
    expect(parseInboxResponse([{ id: 'a', createdAt: '2026-01-01T00:00:00Z' }])).toHaveLength(1);
    expect(parseInboxResponse({ items: [{ id: 'a' }, { bad: 1 }] })).toHaveLength(1);
    expect(parseInboxResponse(null)).toEqual([]);
  });
});
