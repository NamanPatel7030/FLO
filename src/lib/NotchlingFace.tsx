// <Notchling/>: Flo's mascot as a React element. The drawing lives in notchling.ts; this wrapper
// gives it a unique id, a size, and pauses its CSS animations whenever it's off screen (so a
// hidden window or a scrolled-away preview costs nothing).
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { VIEWBOX, notchlingMarkup, type AvatarSettings, type NotchlingMood, MOOD_LABEL } from "./notchling";

export function Notchling({
  mood = "happy",
  avatar,
  variant = "icon",
  size = 64,
  accent,
  className,
  title,
  testId,
}: {
  mood?: NotchlingMood;
  avatar?: Partial<AvatarSettings> | AvatarSettings;
  variant?: "icon" | "bare";
  /** height in px (bare is a little wider than tall) */
  size?: number;
  accent?: string;
  className?: string;
  title?: string;
  testId?: string;
}) {
  const raw = useId();
  const uid = "nl" + raw.replace(/[^a-zA-Z0-9]/g, "");
  const markup = useMemo(
    () => notchlingMarkup({ mood, avatar: avatar as AvatarSettings, variant, uid, accent }),
    [mood, avatar, variant, uid, accent],
  );
  const ref = useRef<SVGSVGElement>(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setPaused(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const [, , vw, vh] = VIEWBOX[variant].split(" ").map(Number);
  const width = Math.round((size * vw) / vh);
  return (
    <svg
      ref={ref}
      viewBox={VIEWBOX[variant]}
      width={width}
      height={size}
      role="img"
      aria-label={title ?? `Flo, ${MOOD_LABEL[mood].toLowerCase()}`}
      className={`notchling ${className ?? ""}`}
      data-mood={mood}
      data-paused={paused || undefined}
      data-testid={testId}
      style={{ overflow: "visible", flex: "none" }}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
