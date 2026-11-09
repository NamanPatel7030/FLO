import type { LocalModel } from "./types";

/** MB taken by downloaded speech models other than the one in use (what "Free up space" removes). */
export function unusedModelMb(models: LocalModel[], inUse: string): number {
  return models.filter((m) => m.installed && m.id !== inUse).reduce((sum, m) => sum + m.sizeMb, 0);
}
