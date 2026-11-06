// Subtle push-to-talk cues (WebAudio, no files), like Wispr Flow's "ready" chime.
// Clean sine/triangle tones, low gain, soft attack/release. Gated by settings.playSounds.
// Only used in the island window so cues never double-trigger from the dashboard.
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(a: AudioContext, freq: number, at: number, dur: number, gain: number, type: OscillatorType = "sine") {
  const t = a.currentTime + at;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(a.destination);
  const o = a.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.connect(g);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export type Cue = "ready" | "working" | "done" | "error";

let last = { cue: "" as Cue | "", at: 0 };

/** Play a push-to-talk cue. `enabled` = settings.playSounds. Debounced so rapid start/stop is clean. */
export function playCue(cue: Cue, enabled: boolean): void {
  if (!enabled) return;
  const now = Date.now();
  if (last.cue === cue && now - last.at < 250) return; // debounce doubles
  last = { cue, at: now };
  const a = audio();
  if (!a) return;
  switch (cue) {
    case "ready": // soft rising two-note "listening" chime
      tone(a, 587.33, 0, 0.14, 0.05); // D5
      tone(a, 880.0, 0.07, 0.2, 0.055); // A5
      break;
    case "working": // very subtle tick
      tone(a, 740, 0, 0.06, 0.025, "triangle");
      break;
    case "done": // gentle confirmation (up a fourth)
      tone(a, 660, 0, 0.12, 0.045);
      tone(a, 880, 0.08, 0.18, 0.05);
      break;
    case "error": // soft low tone
      tone(a, 311.13, 0, 0.26, 0.05, "triangle"); // Eb4
      break;
  }
}
