/**
 * Tiny WebAudio previews for the notch sounds. Sine partials only, through a gentle low-pass,
 * soft attack and exponential release at low gain. Only ever called from a click handler.
 */
let ctx: AudioContext | null = null;

type Note = { f: number; at: number; dur: number; peak: number; attack?: number; glide?: number };

const SOUNDS: { cutoff: number; notes: Note[] }[] = [
  // Chime: a bright major arpeggio, C6 E6 G6
  { cutoff: 3200, notes: [{ f: 1046.5, at: 0, dur: 0.9, peak: 0.06 }, { f: 1318.5, at: 0.08, dur: 1.0, peak: 0.045 }, { f: 1568, at: 0.16, dur: 1.2, peak: 0.035 }] },
  // Glass: high and airy, with a quiet fifth above
  { cutoff: 4200, notes: [{ f: 1760, at: 0, dur: 1.3, peak: 0.04, attack: 0.006 }, { f: 2637, at: 0.01, dur: 0.8, peak: 0.014, attack: 0.006 }, { f: 2217.5, at: 0.12, dur: 1.1, peak: 0.026, attack: 0.006 }] },
  // Soft: low and round, slow attack
  { cutoff: 1500, notes: [{ f: 523.25, at: 0, dur: 1.1, peak: 0.07, attack: 0.07 }, { f: 659.25, at: 0.15, dur: 1.2, peak: 0.05, attack: 0.07 }] },
  // Pop: a quick upward blip with a tiny sparkle
  { cutoff: 2600, notes: [{ f: 440, at: 0, dur: 0.16, peak: 0.08, attack: 0.004, glide: 880 }, { f: 1320, at: 0.05, dur: 0.22, peak: 0.02, attack: 0.004 }] },
];

export function playSound(kind: number) {
  if (typeof window === "undefined") return;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  try {
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume();
    const s = SOUNDS[kind % SOUNDS.length];
    const now = ctx.currentTime + 0.02;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = s.cutoff;
    lp.Q.value = 0.4;
    const out = ctx.createGain();
    out.gain.value = 0.9;
    lp.connect(out).connect(ctx.destination);
    for (const n of s.notes) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(n.f, now + n.at);
      if (n.glide) o.frequency.exponentialRampToValueAtTime(n.glide, now + n.at + 0.07);
      g.gain.setValueAtTime(0.0001, now + n.at);
      g.gain.exponentialRampToValueAtTime(n.peak, now + n.at + (n.attack ?? 0.015));
      g.gain.exponentialRampToValueAtTime(0.0001, now + n.at + n.dur);
      o.connect(g).connect(lp);
      o.start(now + n.at);
      o.stop(now + n.at + n.dur + 0.05);
    }
  } catch {
    /* audio is a nicety; never break the page over it */
  }
}
