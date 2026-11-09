// Keeping the phone app current, with no Play Store:
//  1. Over-the-air (expo-updates + EAS Update): JS and assets download in the background and apply
//     on the next restart. Covers almost every release.
//  2. Native updates (new permissions, new native modules): the latest APK is announced in
//     android-latest.json on the newest GitHub Release. We download it and open Android's installer.
import * as Application from 'expo-application';
import { Platform } from 'react-native';

export const ANDROID_MANIFEST_URL = 'https://github.com/NamanPatel7030/FLO/releases/latest/download/android-latest.json';

export interface AndroidRelease {
  versionCode: number;
  versionName: string;
  url: string;
  notes: string;
}

/** Validate android-latest.json (unit-tested). Only https APK links on GitHub or our own site. */
export function parseAndroidManifest(json: unknown): AndroidRelease | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as Record<string, unknown>;
  const versionCode = typeof j.versionCode === 'number' ? j.versionCode : typeof j.versionCode === 'string' ? Number(j.versionCode) : NaN;
  if (!Number.isInteger(versionCode) || versionCode <= 0) return null;
  if (typeof j.url !== 'string') return null;
  let u: URL;
  try {
    u = new URL(j.url);
  } catch {
    return null;
  }
  const trusted = u.protocol === 'https:' && /(^|\.)github\.com$|(^|\.)githubusercontent\.com$|^flo\.hellonaman\.com$/.test(u.hostname);
  if (!trusted || !u.pathname.endsWith('.apk')) return null;
  return {
    versionCode,
    versionName: typeof j.versionName === 'string' ? j.versionName.slice(0, 32) : String(versionCode),
    url: u.toString(),
    notes: typeof j.notes === 'string' ? j.notes.slice(0, 2000) : '',
  };
}

/** Is `latest` newer than the installed build? (unit-tested) */
export function isNewerBuild(latest: number, installed: number | null): boolean {
  if (installed == null || !Number.isFinite(installed)) return false;
  return latest > installed;
}

export function installedBuild(): number | null {
  const v = Number(Application.nativeBuildVersion);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function installedVersion(): string {
  if (Application.nativeApplicationVersion) return Application.nativeApplicationVersion;
  // web preview: the version from app.json
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const v = (require('expo-constants').default?.expoConfig?.version as string | undefined) ?? '0.0.0';
  return v;
}

/** Fetch the manifest; null if there's nothing newer (or we're offline / on web). */
export async function checkNativeUpdate(fetchImpl: typeof fetch = fetch): Promise<AndroidRelease | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const res = await fetchImpl(`${ANDROID_MANIFEST_URL}?t=${Date.now()}`);
    if (!res.ok) return null;
    const rel = parseAndroidManifest(await res.json());
    return rel && isNewerBuild(rel.versionCode, installedBuild()) ? rel : null;
  } catch {
    return null;
  }
}

/** Download the APK and hand it to Android's installer (asks to allow installs from Flo the first time). */
export async function installApk(rel: AndroidRelease, onProgress?: (p: number) => void): Promise<void> {
  const FileSystem = await import('expo-file-system/legacy');
  const IntentLauncher = await import('expo-intent-launcher');
  const target = `${FileSystem.cacheDirectory}Flo-${rel.versionCode}.apk`;
  const dl = FileSystem.createDownloadResumable(rel.url, target, {}, (p) => {
    if (p.totalBytesExpectedToWrite > 0) onProgress?.(p.totalBytesWritten / p.totalBytesExpectedToWrite);
  });
  const res = await dl.downloadAsync();
  if (!res?.uri) throw new Error("The download didn't finish. Try again.");
  const contentUri = await FileSystem.getContentUriAsync(res.uri);
  // FLAG_GRANT_READ_URI_PERMISSION (1) | FLAG_ACTIVITY_NEW_TASK (0x10000000)
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    type: 'application/vnd.android.package-archive',
    flags: 1 | 0x10000000,
  });
}

/** The "Install unknown apps" switch for Flo, for when Android blocks the installer. */
export async function openInstallPermission(): Promise<void> {
  const IntentLauncher = await import('expo-intent-launcher');
  const Constants = (await import('expo-constants')).default;
  const pkg = (Constants.expoConfig?.android?.package as string | undefined) ?? 'com.flo.companion';
  await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES, { data: `package:${pkg}` });
}

// ── over-the-air ─────────────────────────────────────────────────────────────

/** Check, and download in the background. Resolves true when an update is ready to apply. */
export async function fetchOtaUpdate(): Promise<boolean> {
  if (Platform.OS === 'web' || __DEV__) return false;
  try {
    const Updates = await import('expo-updates');
    if (!Updates.isEnabled) return false;
    const r = await Updates.checkForUpdateAsync();
    if (!r.isAvailable) return false;
    const f = await Updates.fetchUpdateAsync();
    return !!f.isNew;
  } catch {
    return false;
  }
}

export async function applyOtaUpdate(): Promise<void> {
  const Updates = await import('expo-updates');
  await Updates.reloadAsync();
}
