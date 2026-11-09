jest.mock('expo-application', () => ({ nativeBuildVersion: '1', nativeApplicationVersion: '0.1.0' }));
import { isNewerBuild, parseAndroidManifest } from '../src/lib/updates';

const ok = {
  versionCode: 3,
  versionName: '0.3.0',
  url: 'https://github.com/NamanPatel7030/FLO/releases/download/v0.3.0/Flo-android.apk',
  notes: 'New notch moods',
};

describe('parseAndroidManifest', () => {
  it('accepts a good manifest', () => {
    expect(parseAndroidManifest(ok)).toEqual(ok);
    expect(parseAndroidManifest({ ...ok, versionCode: '4' })?.versionCode).toBe(4);
  });

  it('rejects untrusted or broken links', () => {
    expect(parseAndroidManifest({ ...ok, url: 'http://github.com/x.apk' })).toBeNull();
    expect(parseAndroidManifest({ ...ok, url: 'https://evil.example.com/Flo.apk' })).toBeNull();
    expect(parseAndroidManifest({ ...ok, url: 'https://github.com/x/y.zip' })).toBeNull();
    expect(parseAndroidManifest({ ...ok, url: 'not a url' })).toBeNull();
    expect(parseAndroidManifest({ ...ok, versionCode: 0 })).toBeNull();
    expect(parseAndroidManifest({ ...ok, versionCode: 1.5 })).toBeNull();
    expect(parseAndroidManifest(null)).toBeNull();
  });

  it('allows our own site', () => {
    expect(parseAndroidManifest({ ...ok, url: 'https://flo.hellonaman.com/releases/Flo.apk' })).not.toBeNull();
  });
});

describe('isNewerBuild', () => {
  it('compares build numbers', () => {
    expect(isNewerBuild(3, 2)).toBe(true);
    expect(isNewerBuild(2, 2)).toBe(false);
    expect(isNewerBuild(1, 2)).toBe(false);
    expect(isNewerBuild(5, null)).toBe(false);
  });
});
