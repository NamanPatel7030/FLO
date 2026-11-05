// Subtle synthesized onboarding sounds (WebAudio, no files). Same approach as keySounds.ts:
// soft tones built from oscillators + gain envelopes. Muteable; default on.
const KEY = "flo.onboard.sound";
let ctx: AudioContext | null = null;

export function soundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}
export function setSoundOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* private mode */
  }
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** A soft bell-ish note: sine + a fifth, gentle attack, long release. */
function note(a: AudioContext, freq: number, at: number, dur: number, gain: number, type: OscillatorType = "sine") {
  const t = a.currentTime + at;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(a.destination);
  const o = a.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.connect(g);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Gentle tick on a selection/toggle. */
export function playTick() {
  if (!soundOn()) return;
  const a = audio();
  if (!a) return;
  note(a, 1320, 0, 0.06, 0.05, "triangle");
}

/** Soft rising two-note chime when advancing a step. */
export function playStep() {
  if (!soundOn()) return;
  const a = audio();
  if (!a) return;
  note(a, 587.33, 0, 0.5, 0.06); // D5
  note(a, 880.0, 0.08, 0.6, 0.05); // A5
}

/** Warm success tone when a demo completes. */
export function playSuccess() {
  if (!soundOn()) return;
  const a = audio();
  if (!a) return;
  note(a, 659.25, 0, 0.5, 0.07); // E5
  note(a, 987.77, 0.09, 0.7, 0.06); // B5
  note(a, 1318.51, 0.18, 0.9, 0.04); // E6 shimmer
}

/** Tasteful resolving chord on finish (D major add9, arpeggiated). */
export function playFinish() {
  if (!soundOn()) return;
  const a = audio();
  if (!a) return;
  [587.33, 739.99, 880.0, 1174.66, 1318.51].forEach((f, i) => note(a, f, i * 0.1, 1.6 - i * 0.12, 0.06 - i * 0.004));
}
