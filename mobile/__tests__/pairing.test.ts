import { formatCode, isValidCode, normalizeCode, normalizeServerUrl, parsePairPayload } from '../src/lib/pairing';

describe('code validation', () => {
  it('accepts six digits with or without a space/dash', () => {
    expect(isValidCode('483920')).toBe(true);
    expect(isValidCode('483 920')).toBe(true);
    expect(isValidCode(' 483-920 ')).toBe(true);
  });

  it('rejects wrong lengths and non-digits', () => {
    expect(isValidCode('')).toBe(false);
    expect(isValidCode('48392')).toBe(false);
    expect(isValidCode('4839201')).toBe(false);
    expect(isValidCode('48a920')).toBe(false);
    expect(isValidCode('abcdef')).toBe(false);
  });

  it('normalises and formats', () => {
    expect(normalizeCode('483 920')).toBe('483920');
    expect(formatCode('483920')).toBe('483 920');
    expect(formatCode('48')).toBe('48');
    expect(formatCode('4839201234')).toBe('483 920');
  });
});

describe('normalizeServerUrl', () => {
  it('adds https for public hosts and http for LAN/localhost', () => {
    expect(normalizeServerUrl('flo.app')).toBe('https://flo.app');
    expect(normalizeServerUrl('localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeServerUrl('192.168.1.20:3000/')).toBe('http://192.168.1.20:3000');
    expect(normalizeServerUrl('parths-mac.local:3000')).toBe('http://parths-mac.local:3000');
    expect(normalizeServerUrl('10.0.2.2:3000')).toBe('http://10.0.2.2:3000');
  });

  it('keeps explicit schemes and strips trailing slashes', () => {
    expect(normalizeServerUrl('http://flo.app/')).toBe('http://flo.app');
    expect(normalizeServerUrl('HTTPS://Flo.App/base/')).toBe('https://flo.app/base');
  });

  it('rejects garbage', () => {
    expect(normalizeServerUrl('')).toBeNull();
    expect(normalizeServerUrl('ftp://flo.app')).toBeNull();
    expect(normalizeServerUrl('not a url')).toBeNull();
  });
});

describe('parsePairPayload', () => {
  it('parses flo-pair://<host>/<code>', () => {
    expect(parsePairPayload('flo-pair://flo.app/483920')).toEqual({ server: 'https://flo.app', code: '483920' });
  });

  it('handles ports, LAN hosts and encoded spaces', () => {
    expect(parsePairPayload('flo-pair://192.168.1.20:3000/483%20920')).toEqual({
      server: 'http://192.168.1.20:3000',
      code: '483920',
    });
    expect(parsePairPayload('flo-pair://localhost:3000/483-920/')).toEqual({
      server: 'http://localhost:3000',
      code: '483920',
    });
  });

  it('honours an optional ?scheme= override and base paths', () => {
    expect(parsePairPayload('flo-pair://mac.example.com:3000/483920?scheme=http')).toEqual({
      server: 'http://mac.example.com:3000',
      code: '483920',
    });
    expect(parsePairPayload('flo-pair://flo.app/flo/483920')).toEqual({ server: 'https://flo.app/flo', code: '483920' });
  });

  it('rejects other schemes, missing or bad codes', () => {
    expect(parsePairPayload('https://flo.app/483920')).toBeNull();
    expect(parsePairPayload('flo-pair://flo.app')).toBeNull();
    expect(parsePairPayload('flo-pair://flo.app/')).toBeNull();
    expect(parsePairPayload('flo-pair://flo.app/12345')).toBeNull();
    expect(parsePairPayload('flo-pair://flo.app/abcdef')).toBeNull();
    expect(parsePairPayload('flo-pair://flo.app/%E0%A4%A')).toBeNull();
    expect(parsePairPayload('')).toBeNull();
  });
});
