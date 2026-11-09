// What's published right now, for the download page: read from the newest GitHub Release, so the
// version on the page changes by itself whenever a release goes out. Cached for 10 minutes.
const REPO = process.env.RELEASE_REPO || "NamanPatel7030/FLO";

export type ReleaseInfo = { version: string; date: string; android?: { version: string } };

export async function latestRelease(): Promise<ReleaseInfo | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 600 },
    });
    if (!res.ok) return null;
    const r = (await res.json()) as { tag_name: string; published_at: string; assets?: { name: string }[] };
    const info: ReleaseInfo = { version: r.tag_name.replace(/^v/, ""), date: r.published_at };
    // The Android app has its own version; when the release carries android-latest.json, use it.
    if (r.assets?.some((a) => a.name === "android-latest.json")) {
      const a = await fetch(`https://github.com/${REPO}/releases/latest/download/android-latest.json`, { next: { revalidate: 600 } }).catch(() => null);
      const j = a && a.ok ? ((await a.json().catch(() => null)) as { versionName?: string } | null) : null;
      if (j?.versionName) info.android = { version: j.versionName };
    }
    return info;
  } catch {
    return null;
  }
}
