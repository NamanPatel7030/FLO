// One layout for every content card on the island (result, error, correction, confirm, Claude,
// meeting prompt): the notch row stays empty, and icon + text + actions sit in ONE row below it,
// 16px side padding, icon vertically centred with the text. Compact live states (listening /
// working / done) keep their wing icons and don't use this.
import { ISLAND_GAP } from "../lib/format";
import type { IslandGeometry } from "../lib/types";

export function CardRow({
  notch,
  geo,
  icon,
  children,
  actions,
  testId,
  label,
}: {
  notch: boolean;
  geo: IslandGeometry;
  icon: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  testId?: string;
  label?: string;
}) {
  return (
    <div
      className="absolute inset-x-0 bottom-0 flex items-center gap-3 px-4 pb-1.5"
      style={{ top: notch ? geo.notchHeight + ISLAND_GAP : 8 }}
      data-testid={testId}
      data-card-row
      aria-label={label}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center" data-card-icon>
        {icon}
      </span>
      <div className="min-w-0 flex-1" data-card-text>
        {children}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-1" data-card-actions>
          {actions}
        </div>
      )}
    </div>
  );
}
