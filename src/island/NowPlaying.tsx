// Now Playing UI: the live music activity in the collapsed notch (artwork left of the camera,
// an equalizer right of it) and the rich player inside the hover panel / Settings preview.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Music2, Pause, Play, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react";
import { api } from "../lib/api";
import { formatClock, MUSIC_WING } from "../lib/format";
import { mediaControl, useElapsed, useMediaTint, useNowPlaying } from "../lib/nowPlaying";
import type { IslandGeometry, NowPlaying } from "../lib/types";

const FALLBACK_TINT = "var(--accent)";

/** Album art, else the app icon on a dark tile, else an accent tile with a note. */
export function Artwork({ np, size, radius, className = "" }: { np: NowPlaying | null; size: number; radius: number; className?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  const art = np?.artwork && broken !== np.artwork ? np.artwork : null;
  const icon = !art && np?.appIcon && broken !== np.appIcon ? np.appIcon : null;
  const box = { width: size, height: size, borderRadius: radius };
  if (art)
    return (
      <img
        src={art}
        alt=""
        draggable={false}
        onError={() => setBroken(art)}
        className={"shrink-0 object-cover " + className}
        style={box}
        data-testid="np-artwork"
      />
    );
  if (icon)
    return (
      <span className={"flex shrink-0 items-center justify-center bg-white/[0.07] " + className} style={box} data-testid="np-appicon">
        <img src={icon} alt="" draggable={false} onError={() => setBroken(icon)} style={{ width: size * 0.66, height: size * 0.66 }} />
      </span>
    );
  return (
    <span className={"flex shrink-0 items-center justify-center " + className} style={{ ...box, background: "linear-gradient(135deg, var(--accent-grad-from), var(--accent-grad-to))" }}>
      <Music2 size={Math.round(size * 0.5)} className="text-white/90" />
    </span>
  );
}

const EQ_BARS = [
  { d: 0.92, delay: -0.3, rest: 0.35 },
  { d: 0.71, delay: -0.55, rest: 0.6 },
  { d: 1.07, delay: -0.15, rest: 0.45 },
  { d: 0.83, delay: -0.7, rest: 0.3 },
];

/** Animated equalizer (compositor-only: scaleY on four bars). Paused → dim, static. */
export function Equalizer({ playing, tint, height = 14, bar = 3, gap = 2 }: { playing: boolean; tint: string; height?: number; bar?: number; gap?: number }) {
  return (
    <span
      className="flo-eq inline-flex items-center"
      style={{ height, gap, opacity: playing ? 1 : 0.42, transition: "opacity 0.4s ease" }}
      data-playing={playing ? "true" : "false"}
      data-testid="np-equalizer"
      aria-hidden
    >
      {EQ_BARS.map((b, i) => (
        <span
          key={i}
          className="flo-eq-bar block rounded-full"
          style={
            {
              width: bar,
              height,
              background: tint,
              boxShadow: playing ? `0 0 6px -1px ${tint}` : "none",
              "--d": `${b.d}s`,
              "--delay": `${b.delay}s`,
              transform: playing ? undefined : `scaleY(${b.rest})`,
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  );
}

/** The music live activity in the notch: artwork on the left wing, equalizer on the right. */
export function MusicWings({ np, geo }: { np: NowPlaying; geo: IslandGeometry }) {
  const tint = useMediaTint(np) ?? FALLBACK_TINT;
  const off = geo.notchWidth / 2 + MUSIC_WING / 2;
  const art = Math.min(22, geo.notchHeight - 10);
  const label = `${np.playing ? "Playing" : "Paused"}: ${np.title}${np.artist ? ` · ${np.artist}` : ""}`;
  const wing = (cx: number, child: React.ReactNode, delay: number) => (
    <motion.div
      className="pointer-events-none absolute top-0 flex items-center justify-center"
      style={{ left: `calc(50% + ${cx}px)`, width: MUSIC_WING, marginLeft: -MUSIC_WING / 2, height: geo.notchHeight }}
      // a plain fade (no scale-pop, no animated blur filter: both repaint every frame)
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ type: "tween", duration: 0.24, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {child}
    </motion.div>
  );
  return (
    <div data-testid="music-activity" aria-label={label} role="img" className="pointer-events-none absolute inset-x-0 top-0" style={{ height: geo.notchHeight }}>
      {wing(-off, <Artwork np={np} size={art} radius={6} className={np.playing ? "" : "opacity-60"} />, 0.02)}
      {wing(off, <Equalizer playing={np.playing} tint={tint} height={Math.min(14, geo.notchHeight - 16)} bar={2.5} />, 0.04)}
    </div>
  );
}

/** Single-line text that slowly scrolls back and forth when it doesn't fit. */
export function Marquee({ text, className = "" }: { text: string; className?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const b = box.current;
    const i = inner.current;
    if (!b || !i) return;
    setShift(Math.max(0, Math.ceil(i.scrollWidth - b.clientWidth)));
  }, [text]);
  return (
    <span
      ref={box}
      className={"block overflow-hidden whitespace-nowrap " + className}
      title={text}
      style={shift > 0 ? { WebkitMaskImage: "linear-gradient(90deg, transparent, #000 6px, #000 calc(100% - 14px), transparent)", maskImage: "linear-gradient(90deg, transparent, #000 6px, #000 calc(100% - 14px), transparent)" } : undefined}
    >
      <span
        ref={inner}
        className={"inline-block " + (shift > 0 ? "flo-marquee" : "")}
        style={shift > 0 ? ({ "--shift": `${shift + 8}px`, "--dur": `${Math.max(6, shift / 18)}s` } as React.CSSProperties) : undefined}
      >
        {text}
      </span>
    </span>
  );
}

function VolumeRow({ tint }: { tint: string }) {
  const [vol, setVol] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .getVolume()
      .then((v) => alive && setVol(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (vol === null) return null;
  const Icon = vol === 0 ? VolumeX : vol < 50 ? Volume1 : Volume2;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <Icon size={14} className="shrink-0 text-white/50" />
      <input
        type="range"
        min={0}
        max={100}
        value={vol}
        aria-label="Volume"
        onChange={(e) => {
          const v = Number(e.target.value);
          setVol(v);
          api.setVolume(v).catch(() => {});
        }}
        className="flo-range flo-range-np h-1 min-w-0 flex-1"
        style={{ "--np-tint": tint, "--np-fill": `${vol}%` } as React.CSSProperties}
      />
    </div>
  );
}

/** The Now Playing widget: a rich player (artwork, marquee title, progress, transport, volume). */
export function NowPlayingCard() {
  const { np } = useNowPlaying();
  const tint = useMediaTint(np) ?? FALLBACK_TINT;
  const elapsed = useElapsed(np);
  if (!np) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 rounded-xl bg-white/[0.04] px-3 text-center" data-testid="np-empty">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06]">
          <Music2 size={16} className="text-white/45" />
        </span>
        <span className="text-[12px] font-medium text-white/55">Nothing playing</span>
        <span className="text-[10.5px] text-white/30">Play music or a video and it shows up here</span>
      </div>
    );
  }
  const dur = np.duration && np.duration > 0 ? np.duration : undefined;
  const pct = dur && elapsed !== undefined ? Math.min(100, (elapsed / dur) * 100) : 0;
  const btn = "flex items-center justify-center rounded-full text-white/80 transition-colors duration-150 hover:bg-white/10 hover:text-white active:bg-white/[0.06]";
  return (
    <div
      className="relative flex h-full flex-col justify-between overflow-hidden rounded-xl p-3"
      style={{ background: `radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, ${tint} 22%, transparent), transparent 62%), rgb(255 255 255 / 0.05)` }}
      data-testid="np-player"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="relative shrink-0">
          {/* soft glow of the cover behind it */}
          <span className="absolute inset-1 rounded-[14px] opacity-70 blur-md" style={{ background: tint }} aria-hidden />
          <Artwork np={np} size={60} radius={13} className="relative shadow-[0_6px_16px_-6px_rgba(0,0,0,0.8)] ring-1 ring-white/10" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
            {np.appIcon && <img src={np.appIcon} alt="" className="h-3 w-3 rounded-[3px]" />}
            <span className="truncate">{np.app}</span>
            {!np.playing && <span className="rounded-full bg-white/10 px-1.5 py-px text-[9px] tracking-normal text-white/55">Paused</span>}
          </div>
          <Marquee text={np.title} className="mt-0.5 text-[13.5px] font-semibold leading-tight text-white/95" />
          <div className="truncate text-[12px] leading-tight text-white/55">{np.artist || np.album}</div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[10px] tabular-nums text-white/45">
        <span className="w-8 shrink-0">{elapsed !== undefined ? formatClock(elapsed) : ""}</span>
        <div className="relative h-[4px] flex-1 overflow-hidden rounded-full bg-white/12" role="progressbar" aria-label="Progress" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          {dur ? (
            <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: tint, transition: "width 0.25s linear" }} />
          ) : (
            <span className="absolute inset-0 rounded-full opacity-40" style={{ background: tint }} />
          )}
        </div>
        <span className="w-8 shrink-0 text-right">{dur ? formatClock(dur) : "live"}</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex shrink-0 items-center gap-1">
          <button aria-label="Previous" onClick={() => mediaControl("previous")} className={btn + " h-8 w-8"}>
            <SkipBack size={16} fill="currentColor" />
          </button>
          <button
            aria-label={np.playing ? "Pause" : "Play"}
            onClick={() => mediaControl("playpause")}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black shadow-[0_4px_14px_-4px_rgba(255,255,255,0.45)] transition-[background-color,opacity] duration-150 hover:bg-white/90 active:opacity-80"
          >
            {np.playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="translate-x-[1px]" />}
          </button>
          <button aria-label="Next" onClick={() => mediaControl("next")} className={btn + " h-8 w-8"}>
            <SkipForward size={16} fill="currentColor" />
          </button>
        </div>
        <VolumeRow tint={tint} />
      </div>
    </div>
  );
}
