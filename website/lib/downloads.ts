// Where each installer lives. Server-only: these env vars are never sent to the browser.
export type DownloadOS = "mac" | "windows" | "linux" | "android";
/** Linux ships two installers: a .deb (Ubuntu, Debian, Mint, Pop!_OS) and an AppImage (anything else). */
export type LinuxFormat = "deb" | "appimage";

const ENV: Record<DownloadOS, string> = { mac: "DOWNLOAD_MAC", windows: "DOWNLOAD_WINDOWS", linux: "DOWNLOAD_LINUX", android: "DOWNLOAD_ANDROID" };

/** Stable release asset names (.github/workflows/desktop.yml) */
const DEB = "Flo-linux-amd64.deb";
const APPIMAGE = "Flo-linux-x86_64.AppImage";

export function isOS(v: string): v is DownloadOS {
  return v === "mac" || v === "windows" || v === "linux" || v === "android";
}

export function downloadUrl(os: DownloadOS): string | null {
  const v = process.env[ENV[os]]?.trim();
  return v ? v : null;
}

/** ?format= on /api/download/linux: anything but "appimage" means the .deb. */
export function linuxFormat(v: string | null | undefined): LinuxFormat {
  return v === "appimage" ? "appimage" : "deb";
}

/** The Linux installer for a format: DOWNLOAD_LINUX_DEB / DOWNLOAD_LINUX_APPIMAGE when set, else
 *  derived from DOWNLOAD_LINUX (whichever asset it points at, the other sits next to it in the
 *  same release under its stable name). */
export function linuxDownload(format: LinuxFormat): string | null {
  const explicit = process.env[format === "deb" ? "DOWNLOAD_LINUX_DEB" : "DOWNLOAD_LINUX_APPIMAGE"]?.trim();
  if (explicit) return explicit;
  const base = downloadUrl("linux");
  if (!base) return null;
  const isDeb = /\.deb$/i.test(base);
  const isImage = /\.AppImage$/i.test(base);
  if (format === "deb") return isImage ? base.replace(/[^/]*$/, DEB) : base;
  return isImage ? base : isDeb ? base.replace(/[^/]*$/, APPIMAGE) : null;
}

/** The link the download page shows: always through the signed-in check. */
export const gatedHref = (os: DownloadOS, format?: LinuxFormat) => `/api/download/${os}${os === "linux" && format === "appimage" ? "?format=appimage" : ""}`;
