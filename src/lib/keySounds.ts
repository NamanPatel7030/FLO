// Soft synthesized key sounds (WebAudio, no files): tiny noise click + low sine "thock".
// Errors are softer and duller; Space is a deeper thock; finish plays a gentle two-note chime.

const KEY = "flo.typing.sound";
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

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
  if (!ctx) {
    ctx = new AC();
    const len = Math.floor(ctx.sampleRate * 0.03);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export type KeyKind = "key" | "space" | "error";

export function playKey(kind: KeyKind) {
  if (!soundOn()) return;
  const a = audio();
  if (!a || !noise) return;
  const t = a.currentTime;
  const jitter = 1 + (Math.random() - 0.5) * 0.12;
  const out = a.createGain();
  out.gain.value = kind === "error" ? 0.18 : 0.32;
  out.connect(a.destination);

  // click: short filtered noise burst
  const src = a.createBufferSource();
  src.buffer = noise;
  const bp = a.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = (kind === "error" ? 1400 : kind === "space" ? 1800 : 2600) * jitter;
  bp.Q.value = 1.2;
  const cg = a.createGain();
  cg.gain.setValueAtTime(kind === "error" ? 0.25 : 0.5, t);
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  src.connect(bp).connect(cg).connect(out);
  src.start(t);

  // thock: low sine with a fast pitch drop
  const osc = a.createOscillator();
  osc.type = "sine";
  const f = (kind === "space" ? 82 : kind === "error" ? 120 : 150) * jitter;
  osc.frequency.setValueAtTime(f * 1.6, t);
  osc.frequency.exponentialRampToValueAtTime(f, t + 0.04);
  const og = a.createGain();
  og.gain.setValueAtTime(kind === "space" ? 0.55 : 0.35, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + (kind === "space" ? 0.12 : 0.07));
  osc.connect(og).connect(out);
  osc.start(t);
  osc.stop(t + 0.14);
}

export function playChime() {
  if (!soundOn()) return;
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  [659.25, 987.77].forEach((f, i) => {
    const o = a.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t + i * 0.12);
    g.gain.exponentialRampToValueAtTime(0.12, t + i * 0.12 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.9);
    o.connect(g).connect(a.destination);
    o.start(t + i * 0.12);
    o.stop(t + i * 0.12 + 1);
  });
}
