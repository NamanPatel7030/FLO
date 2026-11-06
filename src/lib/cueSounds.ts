// Push-to-talk cues (WebAudio, no files). Designed to be smooth and pleasant, never buzzy:
// every tone is a pure sine/triangle run through a gentle low-pass (kills harsh harmonics), with a
// soft ~15 ms attack and an exponential release (no clicks). Low master gain keeps them subtle.
// Only the island window plays these so cues never double-trigger from the dashboard.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return { ctx, out: master! };
}

/**
 * One soft note. `peak` is the envelope peak gain (~0.03–0.09). The low-pass cutoff defaults to a
 * few multiples of the fundamental so triangles lose their edge but the note keeps its body.
 */
function tone(
  a: { ctx: AudioContext; out: GainNode },
  freq: number,
  at: number,
  dur: number,
  peak: number,
  type: OscillatorType = "sine",
  cutoff = Math.max(1100, freq * 3.2),
) {
  const { ctx: c, out } = a;
  const t = c.currentTime + at;
  const attack = 0.015;
  const release = Math.max(0.08, dur - attack);

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  // exponential approach to silence — smooth, no tail click
  g.gain.setTargetAtTime(0.0001, t + attack, release / 3.2);

  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = cutoff;
  lp.Q.value = 0.3;

  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.connect(lp);
  lp.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(t + attack + release + 0.05);
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
    case "ready": // soft rising two-note "listening" chime (D5 → A5), rounded
      tone(a, 587.33, 0, 0.16, 0.07);
      tone(a, 880.0, 0.08, 0.22, 0.075);
      break;
    case "working": // barely-there tick
      tone(a, 660, 0, 0.07, 0.03, "sine");
      break;
    case "done": // warm confirmation: a settled note (G5) over a soft lower octave
      tone(a, 392.0, 0, 0.3, 0.035);
      tone(a, 783.99, 0.02, 0.34, 0.075);
      break;
    case "error": // gentle, low two-note fall (E4 → B3), filtered soft so it never buzzes
      tone(a, 329.63, 0, 0.2, 0.06, "triangle", 900);
      tone(a, 246.94, 0.1, 0.3, 0.06, "triangle", 760);
      break;
  }
}
