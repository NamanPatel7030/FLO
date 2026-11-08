"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { AVATARS, avatarIndexFor, avatarName, avatarUrl } from "@/lib/avatars";

/**
 * Naman's portrait. `screen` (or, by default, the current page) picks which of the 52 designs it
 * opens with, so every page shows a different one. With `cycle`, each click cross-fades to the next.
 */
export function NamanAvatar({ size, screen, cycle = false, className = "" }: { size: number; screen?: string; cycle?: boolean; className?: string }) {
  const path = usePathname() ?? "/";
  const [i, setI] = useState(() => avatarIndexFor(screen ?? path));
  const slug = AVATARS[i];
  return (
    <span
      className={`relative inline-flex shrink-0 overflow-hidden rounded-full ${cycle ? "cursor-pointer" : ""} ${className}`}
      style={{ width: size, height: size }}
      onClick={
        cycle
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              setI((n) => (n + 1) % AVATARS.length);
            }
          : undefined
      }
      title={cycle ? `${avatarName(slug)} · click for another (${i + 1}/${AVATARS.length})` : undefined}
      data-avatar={slug}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={slug} src={avatarUrl(slug)} alt="Naman Gundaniya" width={size} height={size} className="avatar-fade h-full w-full object-cover" draggable={false} />
    </span>
  );
}
