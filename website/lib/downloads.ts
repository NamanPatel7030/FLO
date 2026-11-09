// Where each installer lives. Server-only: these env vars are never sent to the browser.
export type DownloadOS = "mac" | "windows" | "linux" | "android";

const ENV: Record<DownloadOS, string> = { mac: "DOWNLOAD_MAC", windows: "DOWNLOAD_WINDOWS", linux: "DOWNLOAD_LINUX", android: "DOWNLOAD_ANDROID" };

export function isOS(v: string): v is DownloadOS {
  return v === "mac" || v === "windows" || v === "linux" || v === "android";
}

export function downloadUrl(os: DownloadOS): string | null {
  const v = process.env[ENV[os]]?.trim();
  return v ? v : null;
}

/** The link the download page shows: always through the signed-in check. */
export const gatedHref = (os: DownloadOS) => `/api/download/${os}`;
