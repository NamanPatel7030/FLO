// Sound cues (WebAudio, no files). Smooth and pleasant, never buzzy: pure sine/triangle tones through a
// gentle low-pass, a soft ~15 ms attack and an exponential release (no clicks), low master gain.
// Four packs share the same cues so users can pick a character without losing the meaning:
//   chime (default, warm two-note) · glass (bell partials) · soft (single low notes) · pop (bubbly glides)
// Only the island window plays push-to-talk cues so they never double-trigger from the dashboard.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export type SoundPack = "chime" | "glass" | "soft" | "pop";
export type Cue = "ready" | "working" | "done" | "error" | "notify";

export const SOUND_PACKS: { id: SoundPack; label: string; hint: string }[] = [
  { id: "chime", label: "Chime", hint: "Warm two-note chimes" },
  { id: "glass", label: "Glass", hint: "Light, bell-like taps" },
  { id: "soft", label: "Soft", hint: "Single low notes, barely there" },
  { id: "pop", label: "Pop", hint: "Playful bubbly blips" },
];

function audio(volume: number): { ctx: AudioContext; out: GainNode } | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  master!.gain.value = 1.3 * Math.max(0, Math.min(1, volume));
  return { ctx, out: master! };
}

type A = { ctx: AudioContext; out: GainNode };

/** One soft note. `glide` bends the pitch to that frequency over the note (for "pop"). */
function tone(a: A, freq: number, at: number, dur: number, peak: number, type: OscillatorType = "sine", cutoff = Math.max(1100, freq * 3.2), glide?: number) {
  const { ctx: c, out } = a;
  const t = c.currentTime + at;
  const attack = 0.015;
  const release = Math.max(0.08, dur - attack);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.setTargetAtTime(0.0001, t + attack, release / 3.2);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = cutoff;
  lp.Q.value = 0.3;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + Math.min(dur, 0.12));
  o.connect(lp);
  lp.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(t + attack + release + 0.05);
}

/** A bell: fundamental + a quiet inharmonic partial (gives "glass" its shimmer). */
function bell(a: A, freq: number, at: number, dur: number, peak: number) {
  tone(a, freq, at, dur, peak, "sine", freq * 4);
  tone(a, freq * 2.76, at, dur * 0.6, peak * 0.22, "sine", freq * 6);
}

const PACKS: Record<SoundPack, Record<Cue, (a: A) => void>> = {
  chime: {
    ready: (a) => (tone(a, 587.33, 0, 0.16, 0.07), tone(a, 880.0, 0.08, 0.22, 0.075)),
    working: (a) => tone(a, 660, 0, 0.07, 0.03),
    done: (a) => (tone(a, 392.0, 0, 0.3, 0.035), tone(a, 783.99, 0.02, 0.34, 0.075)),
    error: (a) => (tone(a, 329.63, 0, 0.2, 0.06, "triangle", 900), tone(a, 246.94, 0.1, 0.3, 0.06, "triangle", 760)),
    notify: (a) => (tone(a, 659.25, 0, 0.18, 0.065), tone(a, 987.77, 0.11, 0.3, 0.07)),
  },
  glass: {
    ready: (a) => (bell(a, 1046.5, 0, 0.22, 0.05), bell(a, 1318.5, 0.07, 0.28, 0.05)),
    working: (a) => bell(a, 1567.98, 0, 0.08, 0.02),
    done: (a) => bell(a, 1567.98, 0, 0.42, 0.055),
    error: (a) => (bell(a, 783.99, 0, 0.22, 0.045), bell(a, 659.25, 0.1, 0.3, 0.045)),
    notify: (a) => (bell(a, 1318.5, 0, 0.25, 0.05), bell(a, 1760, 0.12, 0.4, 0.05)),
  },
  soft: {
    ready: (a) => tone(a, 523.25, 0, 0.2, 0.05),
    working: (a) => tone(a, 440, 0, 0.06, 0.018),
    done: (a) => tone(a, 392.0, 0, 0.32, 0.05),
    error: (a) => tone(a, 261.63, 0, 0.3, 0.05, "sine", 700),
    notify: (a) => (tone(a, 523.25, 0, 0.2, 0.045), tone(a, 659.25, 0.14, 0.26, 0.045)),
  },
  pop: {
    ready: (a) => tone(a, 520, 0, 0.12, 0.07, "sine", 2400, 980),
    working: (a) => tone(a, 900, 0, 0.05, 0.025, "sine", 2400, 1100),
    done: (a) => (tone(a, 620, 0, 0.1, 0.06, "sine", 2400, 1240), tone(a, 930, 0.09, 0.14, 0.06, "sine", 2400, 1500)),
    error: (a) => tone(a, 420, 0, 0.22, 0.06, "triangle", 1200, 210),
    notify: (a) => (tone(a, 700, 0, 0.1, 0.06, "sine", 2400, 1300), tone(a, 1050, 0.1, 0.16, 0.06, "sine", 2400, 1600)),
  },
};

let last = { cue: "" as Cue | "", at: 0 };

/**
 * Play a cue. `enabled` = the matching on/off setting; `pack` and `volume` (0–1) come from
 * Settings → Notch → Sounds. Debounced so rapid start/stop stays clean.
 */
export function playCue(cue: Cue, enabled: boolean, pack: SoundPack = "chime", volume = 0.7): void {
  if (!enabled || volume <= 0) return;
  const now = Date.now();
  if (last.cue === cue && now - last.at < 250) return;
  last = { cue, at: now };
  const a = audio(volume);
  if (!a) return;
  (PACKS[pack] ?? PACKS.chime)[cue](a);
}

/** The subset of settings that decides how a cue sounds. */
export interface SoundPrefs {
  playSounds?: boolean;
  soundPack?: string;
  soundVolume?: number;
  soundStart?: string;
  soundStop?: string;
  soundNotify?: string;
  startSoundOn?: boolean;
  stopSoundOn?: boolean;
  notifySound?: boolean;
}

const asPack = (v: string | undefined, fallback: SoundPack): SoundPack => (v && v in PACKS ? (v as SoundPack) : fallback);

/** Which style plays a cue and whether it plays at all (start / stop / notification each customizable). */
export function cueSetting(cue: Cue, s: SoundPrefs | null | undefined): { on: boolean; pack: SoundPack; volume: number } {
  const base = asPack(s?.soundPack, "chime");
  const volume = (s?.soundVolume ?? 70) / 100;
  const master = s?.playSounds ?? true;
  if (cue === "ready") return { on: master && (s?.startSoundOn ?? true), pack: asPack(s?.soundStart, base), volume };
  if (cue === "notify") return { on: master && (s?.notifySound ?? true), pack: asPack(s?.soundNotify, base), volume };
  return { on: master && (s?.stopSoundOn ?? true), pack: asPack(s?.soundStop, base), volume };
}

/** Play a cue exactly as the user configured it. */
export function playConfigured(cue: Cue, s: SoundPrefs | null | undefined): void {
  const c = cueSetting(cue, s);
  playCue(cue, c.on, c.pack, c.volume);
}
