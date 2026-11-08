// Shared helpers for Flo's update server.

export type Manifest = {
  version: string;
  notes?: string;
  pub_date?: string;
  /** keyed by `${target}-${arch}`, e.g. darwin-aarch64, windows-x86_64 */
  platforms: Record<string, { url: string; signature: string }>;
};

/** Tauri sends target = darwin | windows | linux and arch = aarch64 | x86_64 | ... */
export function platformKey(target: string, arch: string): string {
  return `${target}-${arch}`.toLowerCase();
}

function parts(v: string): [number[], string] {
  const [core, pre = ""] = v.trim().replace(/^v/, "").split("-", 2);
  const nums = core.split(".").map((n) => parseInt(n, 10) || 0);
  while (nums.length < 3) nums.push(0);
  return [nums, pre];
}

/** Semver comparison: is `latest` strictly newer than `current`? (a pre-release sorts before its release) */
export function isNewer(latest: string, current: string): boolean {
  const [a, ap] = parts(latest);
  const [b, bp] = parts(current);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  if (ap === bp) return false;
  if (!ap) return true; // 1.0.0 > 1.0.0-beta
  if (!bp) return false;
  return ap > bp;
}
