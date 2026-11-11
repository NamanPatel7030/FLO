import { manualSteps, packStatus, packTag, parseSupport, worksOffline, type SpeechSupport } from '../src/lib/offlineSpeech';

const full = (p: Partial<SpeechSupport>): SpeechSupport => ({ api: 'full', onDevice: true, installed: [], pending: [], supported: [], online: [], ...p });

describe('offline speech packs', () => {
  it('reads installed, downloading and downloadable packs (any tag spelling)', () => {
    const s = full({ installed: ['en_IN'], pending: ['hi-IN'], supported: ['gu-in', 'en-IN', 'hi-IN'] });
    expect(packStatus('en-IN', s)).toBe('installed');
    expect(packStatus('hi-IN', s)).toBe('downloading');
    expect(packStatus('gu-IN', s)).toBe('available');
    expect(packStatus('ta-IN', s)).toBe('unsupported');
  });

  it('another region of the same language still counts', () => {
    expect(packStatus('en-IN', full({ installed: ['en-US'] }))).toBe('installed');
  });

  it('Android 12 can only say on-device exists; older phones need internet', () => {
    expect(packStatus('en-IN', full({ api: 'basic', onDevice: true }))).toBe('unknown');
    expect(packStatus('en-IN', full({ api: 'basic', onDevice: false }))).toBe('unsupported');
    expect(packStatus('en-IN', parseSupport(null))).toBe('unsupported');
  });

  it('Auto and Hinglish need the Indian English pack', () => {
    expect(packTag('auto')).toBe('en-IN');
    expect(packTag('hinglish')).toBe('en-IN');
    expect(packTag('gu-IN')).toBe('gu-IN');
    expect(worksOffline('hinglish', full({ installed: ['en-IN'] }))).toBe(true);
    expect(worksOffline('gu-IN', full({ installed: ['en-IN'] }))).toBe(false);
    expect(worksOffline('auto', full({ api: 'basic' }))).toBeNull();
  });

  it('parses native JSON defensively', () => {
    expect(parseSupport('{bad').api).toBe('none');
    expect(parseSupport(JSON.stringify({ api: 'full', onDevice: true, installed: ['en-IN', 3] })).installed).toEqual(['en-IN']);
  });

  it('gives the right manual steps per Android version', () => {
    expect(manualSteps(34)[1]).toMatch(/On-device speech/);
    expect(manualSteps(30)[1]).toMatch(/Offline speech recognition/);
  });
});
