// Writes android-latest.json for a release, from app.json's version/versionCode.
// Upload it to the GitHub Release next to Flo-android.apk; installed apps compare versionCode and
// offer the download (src/lib/updates.ts).
//   node scripts/write-android-manifest.mjs <apk-url> "What's new" [out.json]
import { readFileSync, writeFileSync } from 'node:fs';

const [url, notes = '', out = 'android-latest.json'] = process.argv.slice(2);
if (!url || !/^https:\/\/.+\.apk$/.test(url)) {
  console.error('usage: node scripts/write-android-manifest.mjs <https://…/Flo-android.apk> "notes" [out.json]');
  process.exit(1);
}
const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;
const manifest = { versionCode: app.android.versionCode, versionName: app.version, url, notes };
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(`${out}: Flo ${manifest.versionName} (${manifest.versionCode})`);
